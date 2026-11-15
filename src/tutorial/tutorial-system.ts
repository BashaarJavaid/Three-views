// The first minute (T-06): three scripted teaching puzzles (TUTORIAL in
// src/game/logic.ts), one sentence each, a ghost block, a pulsing Turn button,
// a stronger pulse after 8 s idle, and Skip. Listens to the play events and
// drives play only through its API.
import {
  BoxGeometry,
  createSystem,
  type Entity,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  RayInteractable,
  type UIKit,
  type UIKitMLAsset,
} from '@iwsdk/core';
import { TUTORIAL } from '../game/logic.js';
import { on } from '../play/events.js';
import { setHint, startPuzzle } from '../play/play-system.js';
import { BLOCK_SIZE, cellCenter } from '../scene-assets/glass-box.scene-asset.js';

const LINES = ['Tap to add a block.', "This one doesn't belong. Tap it.", 'Turn the box to reach the back.'];
/** Matches flow's RESULT_DELAY_MS, so T-04's solve moment plays before the next step. */
const NEXT_DELAY_MS = 1500;
const IDLE_MS = 8000;
const TURN_STEP = 2;
// TUTORIAL[2]'s block goes on the -x face of (1,1,1). The box rests at yaw -30 deg,
// where that face points away from the seat. Turn right (+90, quarterTurns 1) or
// Turn left twice (quarterTurns 2) brings it round to face the player.
const reachable = (quarterTurns: number): boolean => quarterTurns === 1 || quarterTurns === 2;

class HaloMesh extends Mesh {
  override raycast(): void {}
}

const haloMat = new MeshBasicMaterial({
  color: '#ffd29a',
  transparent: true,
  opacity: 0,
  depthWrite: false,
  toneMapped: false,
});
const HALO_ADD = '#ffd29a';
const HALO_REMOVE = '#ff3b30';

// Turn-button pulse: two prebuilt property sets, toggled (no allocation per frame).
const LIT = { borderWidth: 5, borderColor: '#ffd29a', backgroundColor: '#7a5220' };
const UNLIT = { borderWidth: 0, backgroundColor: undefined };
const DAILY_LIT = { borderWidth: 5, borderColor: '#ffd29a' };
const DAILY_UNLIT = { borderWidth: 0 };

let active: TutorialSystem | null = null;
let pending: (() => void) | null = null;

export class TutorialSystem extends createSystem({}) {
  private panel!: Entity;
  private readout!: Entity;
  private line!: UIKit.Text;
  private turnBtn!: Record<'left' | 'right', UIKit.Text>;
  private daily!: UIKit.Text;
  private box!: Object3D;
  private halo!: HaloMesh;
  private textProps = { text: '' };

  private step = -1; // -1: not running
  private onDone: (() => void) | null = null;
  private timer = -1;
  private lastInput = 0;
  private quarterTurns = 0;
  private waiting = false; // between `solved` and the next step
  private lit: 'left' | 'right' | null = null;
  private litOn = false;
  private dailyLit = false;

  init(): void {
    this.panel = this.world.requireSceneEntity('tutorial-panel');
    this.readout = this.world.requireSceneEntity('play-readout');
    const panel = this.world.requireSceneObject<UIKitMLAsset>('tutorial-panel');
    const bar = this.world.requireSceneObject<UIKitMLAsset>('play-controls');
    const home = this.world.requireSceneObject<UIKitMLAsset>('home-panel');
    this.line = panel.requireElementById<UIKit.Text>('tut-line');
    this.turnBtn = {
      left: bar.requireElementById<UIKit.Text>('btn-left'),
      right: bar.requireElementById<UIKit.Text>('btn-right'),
    };
    this.daily = home.requireElementById<UIKit.Text>('btn-daily');
    this.box = this.world.requireSceneObject('glass-box');

    this.halo = new HaloMesh(new BoxGeometry(1, 1, 1), haloMat);
    this.halo.name = 'tutorial-halo';
    this.halo.visible = false;
    this.box.add(this.halo);

    const skip = panel.requireElementById('btn-skip');
    skip.name = 'btn-skip';
    const onSkip = (): void => this.finish();
    skip.addEventListener('click', onSkip);

    const input = (): void => {
      this.lastInput = performance.now();
    };
    this.cleanupFuncs.push(
      () => skip.removeEventListener('click', onSkip),
      () => clearTimeout(this.timer),
      () => this.halo.removeFromParent(),
      on('block-added', input),
      on('block-removed', input),
      on('tap-rejected', input),
      on('mode-changed', input),
      on('button-pressed', input),
      on('box-turned', (e) => this.onTurned(e.quarterTurns)),
      on('solved', () => this.onSolved()),
      on('home-requested', () => {
        if (this.step >= 0) this.finish(); // leaving from the bar counts as Skip
      }),
      on('puzzle-started', () => this.lightDaily(false)),
    );

    this.showPanel(false);
    active = this;
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
    });
    if (pending !== null) {
      const done = pending;
      pending = null;
      this.run(done);
    }
  }

  // ---- Steps ---------------------------------------------------------------

  run(onDone: () => void): void {
    this.onDone = onDone;
    this.lightDaily(false);
    this.showPanel(true);
    this.begin(0);
  }

  private begin(i: number): void {
    const t = TUTORIAL[i];
    this.step = i;
    this.waiting = false;
    this.quarterTurns = 0;
    startPuzzle(t.puzzle, t.start, t.mode);
    this.readout.object3D!.visible = false; // the line takes its place; play re-shows it on the next start
    this.textProps.text = LINES[i];
    this.line.setProperties(this.textProps);
    this.lastInput = performance.now();

    const n = t.puzzle.n;
    const b = BLOCK_SIZE[n];
    const h = t.hint;
    cellCenter(n, h % n, Math.floor(h / n) % n, Math.floor(h / (n * n)), this.halo.position);
    this.halo.scale.setScalar(b * (t.mode === 'remove' ? 1.12 : 1.2));
    haloMat.color.set(t.mode === 'remove' ? HALO_REMOVE : HALO_ADD);

    // Add steps show play's ghost. The remove step's target is a real block, so
    // the ghost would sit hidden inside it; the halo marks it instead.
    setHint(t.mode === 'add' && i !== TURN_STEP ? h : null);
    this.setLit(i === TURN_STEP ? 'right' : null);
  }

  private onTurned(quarterTurns: number): void {
    if (this.step < 0) return;
    this.lastInput = performance.now();
    this.quarterTurns = quarterTurns;
    if (this.step !== TURN_STEP || this.waiting) return;
    const ok = reachable(quarterTurns);
    setHint(ok ? TUTORIAL[TURN_STEP].hint : null);
    // Hidden again: point at the shorter way back (from quarterTurns 3, two lefts).
    this.setLit(ok ? null : quarterTurns === 3 ? 'left' : 'right');
  }

  private onSolved(): void {
    if (this.step < 0 || this.waiting) return;
    this.waiting = true;
    this.halo.visible = false;
    this.setLit(null);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.step < 0) return;
      if (this.step < TUTORIAL.length - 1) this.begin(this.step + 1);
      else this.finish();
    }, NEXT_DELAY_MS);
  }

  /** Last step solved, Skip, or the bar's Home: flow saves `tutorialDone` and shows Home. */
  private finish(): void {
    if (this.step < 0) return;
    clearTimeout(this.timer);
    this.step = -1;
    this.waiting = false;
    this.halo.visible = false;
    this.setLit(null);
    this.showPanel(false);
    const done = this.onDone;
    this.onDone = null;
    done?.();
    this.lightDaily(true); // after flow's showHome; cleared by the next puzzle-started
  }

  // ---- Frame ---------------------------------------------------------------

  update(): void {
    if (this.step < 0 || this.waiting) return;
    const now = performance.now();
    const idle = now - this.lastInput > IDLE_MS;
    const t = TUTORIAL[this.step];

    // Halo: always on for the remove step; on add steps only when idle and the
    // ghost is showing (step 3: once the box has turned).
    const ghostShown = this.step !== TURN_STEP || reachable(this.quarterTurns);
    const show = t.mode === 'remove' || (idle && ghostShown);
    this.halo.visible = show;
    if (show) {
      const s = Math.sin(now / (idle ? 110 : 220));
      haloMat.opacity = idle ? 0.55 + 0.3 * s : 0.45 + 0.15 * s;
    }

    if (this.lit !== null) {
      const on = Math.floor(now / (idle ? 250 : 500)) % 2 === 0;
      if (on !== this.litOn) {
        this.litOn = on;
        this.turnBtn[this.lit].setProperties(on ? LIT : UNLIT);
      }
    }
  }

  // ---- Helpers -------------------------------------------------------------

  private setLit(which: 'left' | 'right' | null): void {
    if (this.lit !== null && this.lit !== which) this.turnBtn[this.lit].setProperties(UNLIT);
    this.lit = which;
    this.litOn = false;
  }

  private lightDaily(on: boolean): void {
    if (on === this.dailyLit) return;
    this.dailyLit = on;
    this.daily.setProperties(on ? DAILY_LIT : DAILY_UNLIT);
  }

  private showPanel(on: boolean): void {
    this.panel.object3D!.visible = on;
    if (on && !this.panel.hasComponent(RayInteractable)) this.panel.addComponent(RayInteractable);
    if (!on && this.panel.hasComponent(RayInteractable)) this.panel.removeComponent(RayInteractable);
  }

  /** Dev only: current step, for emulator checks. */
  debugState(): { step: number; waiting: boolean; quarterTurns: number; lit: string | null } {
    return { step: this.step, waiting: this.waiting, quarterTurns: this.quarterTurns, lit: this.lit };
  }
}

/** Flow's entry point: first visit and Settings > Tutorial. */
export function runTutorial(onDone: () => void): void {
  if (active !== null) active.run(onDone);
  else pending = onDone; // flow can call this before the system registers
}
