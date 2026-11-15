// Feedback (T-04): a sound for every play event and two small visuals, the
// wall-matched glow and the solve pulse (top, front, side). Listens to the
// play events only; finds the wall overlays by name (`overlay-<wall>`).
import {
  AdditiveBlending,
  createSystem,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Path,
  Shape,
  ShapeGeometry,
} from '@iwsdk/core';
import { BLOCK_SIZE, type BoxSize } from '../scene-assets/glass-box.scene-asset.js';
import { on, type Wall } from '../play/events.js';
import { installAudioUnlock, play } from './sound.js';

export { setSoundEnabled, soundEnabled, soundLog } from './sound.js';

const WALLS: readonly Wall[] = ['top', 'front', 'side'];
const MATCH_MS = 400;
const PULSE_MS = 600;
const PULSE_GAP_MS = 250; // solve: last pulse ends at 2 * 250 + 600 = 1100 ms
const MATCH_COLOR = '#5ef0a0';
const SOLVE_COLOR = '#fff1d6';

class GlowMesh extends Mesh {
  override raycast(): void {}
}

/** A square ring around an N box's wall, in the overlay group's XY plane. */
const ringCache = new Map<BoxSize, ShapeGeometry>();
function ring(n: BoxSize): ShapeGeometry {
  let g = ringCache.get(n);
  if (g !== undefined) return g;
  const h = (n * BLOCK_SIZE[n]) / 2;
  const o = h + 0.016;
  const i = h - 0.012;
  const s = new Shape().moveTo(-o, -o).lineTo(o, -o).lineTo(o, o).lineTo(-o, o).closePath();
  s.holes.push(new Path().moveTo(-i, -i).lineTo(-i, i).lineTo(i, i).lineTo(i, -i).closePath());
  g = new ShapeGeometry(s);
  g.translate(0, 0, 0.004);
  ringCache.set(n, g);
  return g;
}

// Recorded at import, so a puzzle started before this system registers is still found.
let lastN: BoxSize | null = null;
on('puzzle-started', ({ puzzle }) => {
  lastN = puzzle.n;
});

interface WallFx {
  group: Object3D | null;
  glow: GlowMesh | null;
  mat: MeshBasicMaterial;
  start: number; // ms; -1 idle
  dur: number;
  peak: number;
  scale: number; // extra group scale at the peak
}

export class FeedbackSystem extends createSystem({}) {
  private fx: Record<Wall, WallFx> = {} as Record<Wall, WallFx>;
  private blocks = 0;
  // One chime per tap: wall-matched events from the same tap collapse into one,
  // and none plays when that tap also solved (the solve rise covers it).
  private chime: 'none' | 'pending' | 'solved' = 'none';
  private flushChime = (): void => {
    if (this.chime === 'pending') play('matched');
    this.chime = 'none';
  };

  init(): void {
    for (const w of WALLS) {
      this.fx[w] = {
        group: null,
        glow: null,
        mat: new MeshBasicMaterial({
          color: MATCH_COLOR,
          transparent: true,
          opacity: 0,
          side: DoubleSide,
          forceSinglePass: true, // T-07b: a flat ring needs one pass, not two
          depthWrite: false,
          blending: AdditiveBlending,
        }),
        start: -1,
        dur: 0,
        peak: 0,
        scale: 0,
      };
    }
    const c = this.cleanupFuncs;
    c.push(installAudioUnlock());
    if (lastN !== null) this.attach(lastN);
    c.push(
      on('puzzle-started', ({ puzzle }) => {
        this.blocks = 0;
        this.attach(puzzle.n);
      }),
    );
    c.push(
      on('block-added', () => {
        this.blocks++;
        play('add', this.blocks);
      }),
    );
    c.push(
      on('block-removed', () => {
        this.blocks = Math.max(0, this.blocks - 1);
        play('remove');
      }),
    );
    c.push(on('tap-rejected', () => play('rejected')));
    c.push(on('button-pressed', () => play('button')));
    c.push(
      on('wall-matched', ({ wall }) => {
        if (this.chime === 'none') queueMicrotask(this.flushChime);
        if (this.chime !== 'solved') this.chime = 'pending';
        this.start(wall, 0, MATCH_MS, 0.9, 0.015, MATCH_COLOR);
      }),
    );
    c.push(
      on('solved', () => {
        if (this.chime === 'none') queueMicrotask(this.flushChime);
        this.chime = 'solved';
        play('solved');
        for (let k = 0; k < WALLS.length; k++)
          this.start(WALLS[k], k * PULSE_GAP_MS, PULSE_MS, 1, 0.05, SOLVE_COLOR);
      }),
    );
  }

  /** Find the live overlay groups and give each a glow ring (once per group). */
  private attach(n: BoxSize): void {
    for (const w of WALLS) {
      const f = this.fx[w];
      this.reset(f);
      const group = this.scene.getObjectByName(`overlay-${w}`) ?? null;
      f.group = group;
      f.glow = null;
      if (group === null) continue;
      let glow = group.getObjectByName('feedback-glow') as GlowMesh | undefined;
      if (glow === undefined) {
        glow = new GlowMesh(ring(n), f.mat);
        glow.name = 'feedback-glow';
        glow.renderOrder = 8;
        glow.visible = false;
        group.add(glow);
      }
      f.glow = glow;
    }
  }

  private start(w: Wall, delay: number, dur: number, peak: number, scale: number, color: string): void {
    const f = this.fx[w];
    if (f.glow === null) return;
    f.start = performance.now() + delay;
    f.dur = dur;
    f.peak = peak;
    f.scale = scale;
    f.mat.color.set(color);
    f.mat.opacity = 0;
    if (f.group !== null) f.group.scale.setScalar(1);
  }

  private reset(f: WallFx): void {
    f.start = -1;
    f.mat.opacity = 0;
    if (f.glow !== null) f.glow.visible = false;
    if (f.group !== null) f.group.scale.setScalar(1);
  }

  update(): void {
    const now = performance.now();
    for (let k = 0; k < WALLS.length; k++) {
      const f = this.fx[WALLS[k]];
      if (f.start < 0 || now < f.start || f.glow === null) continue;
      const t = (now - f.start) / f.dur;
      if (t >= 1) {
        this.reset(f);
        continue;
      }
      // Quick rise, slow fall.
      const e = t < 0.2 ? t / 0.2 : (1 - t) / 0.8;
      f.glow.visible = true;
      f.mat.opacity = f.peak * e * e;
      f.group!.scale.setScalar(1 + f.scale * Math.sin(Math.PI * t));
    }
  }
}
