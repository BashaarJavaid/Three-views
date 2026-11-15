// Flow (T-05): Home, daily puzzle, practice ladder, result card and settings,
// around the play API. All saving goes through src/game/progress.ts.
import { createSystem, type Entity, type Object3D, RayInteractable, type UIKit, type UIKitMLAsset } from '@iwsdk/core';
import { dailyPuzzle, puzzleForLevel } from '../game/logic.js';
import {
  currentStreak,
  dateKey,
  load,
  type Progress,
  recordDaily,
  recordPractice,
  save,
} from '../game/progress.js';
import { setSoundEnabled } from '../feedback/feedback-system.js';
import { on } from '../play/events.js';
import { setControlsVisible, setHighContrast, startPuzzle, stopPuzzle } from '../play/play-system.js';
import { runTutorial } from '../tutorial/tutorial-system.js';

/** Wait after `solved` so T-04's solve moment plays before the card. */
const RESULT_DELAY_MS = 1500;

type TutorialEntry = (onDone: () => void) => void;
// T-06: import `runTutorial` from '../tutorial/...' and assign it here. While
// undefined, a first visit goes straight to Home and "Tutorial" is hidden.
const tutorial = runTutorial as TutorialEntry | undefined;

const applySound = setSoundEnabled;

type Session = { kind: 'daily'; key: string } | { kind: 'practice' } | null;

export class FlowSystem extends createSystem({}) {
  private p!: Progress;
  private session: Session = null;
  private resultTimer = -1;
  private home!: UIKitMLAsset;
  private result!: UIKitMLAsset;
  private screens: Entity[] = [];
  private box!: Object3D;

  init(): void {
    this.home = this.world.requireSceneObject<UIKitMLAsset>('home-panel');
    this.result = this.world.requireSceneObject<UIKitMLAsset>('result-panel');
    this.box = this.world.requireSceneObject('glass-box');
    this.screens = ['home-panel', 'result-panel', 'welcome-panel'].map((id) =>
      this.world.requireSceneEntity(id),
    );

    const buttons: [UIKitMLAsset, string, () => void][] = [
      [this.home, 'btn-daily', () => this.startDaily()],
      [this.home, 'btn-practice', () => this.startPractice()],
      [this.home, 'btn-sound', () => this.toggle('sound')],
      [this.home, 'btn-contrast', () => this.toggle('highContrast')],
      [this.home, 'btn-tutorial', () => this.runTutorial()],
      [this.result, 'btn-next', () => this.startPractice()],
      [this.result, 'btn-result-home', () => this.showHome()],
    ];
    for (const [panel, id, fn] of buttons) {
      const button = panel.requireElementById(id);
      button.name = id;
      button.addEventListener('click', fn);
      this.cleanupFuncs.push(() => button.removeEventListener('click', fn));
    }
    if (tutorial === undefined) {
      this.home.requireElementById('btn-tutorial').setProperties({ display: 'none' });
    }

    this.cleanupFuncs.push(
      on('solved', (e) => this.onSolved(e.seconds, e.blocks, e.par)),
      on('home-requested', () => this.showHome()),
      () => clearTimeout(this.resultTimer),
    );

    this.restart();
  }

  /** Load progress, apply settings, then the tutorial (first visit) or Home. */
  restart(): void {
    this.p = load();
    applySound(this.p.sound);
    setHighContrast(this.p.highContrast);
    if (!this.p.tutorialDone && tutorial !== undefined) this.runTutorial();
    else this.showHome();
  }

  // ---- Screens -------------------------------------------------------------

  private show(home: boolean, result: boolean): void {
    this.box.visible = !home; // Home sits in front of the box; the result card sits below it
    const on = [home, result, home];
    this.screens.forEach((e, i) => {
      e.object3D!.visible = on[i];
      if (on[i] && !e.hasComponent(RayInteractable)) e.addComponent(RayInteractable);
      if (!on[i] && e.hasComponent(RayInteractable)) e.removeComponent(RayInteractable);
    });
  }

  private showHome(): void {
    clearTimeout(this.resultTimer);
    this.session = null;
    stopPuzzle();
    const today = dateKey(new Date());
    const time = this.p.dailyTimes[today];
    const streak = currentStreak(this.p, today);
    this.text(this.home, 'label-daily', time === undefined ? 'Daily puzzle' : `Daily: done ${formatTime(time)}`);
    this.text(this.home, 'label-practice', `Practice: level ${this.p.level}`);
    this.text(this.home, 'streak-count', String(streak));
    this.text(this.home, 'label-sound', this.p.sound ? 'Sound on' : 'Sound off');
    this.text(this.home, 'label-contrast', this.p.highContrast ? 'Contrast high' : 'Contrast off');
    const [y, m, d] = today.split('-').map(Number);
    for (let i = 0; i < 7; i++) {
      const key = dateKey(new Date(y, m - 1, d - 6 + i, 12)); // oldest left, today right
      const solved = this.p.dailyTimes[key] !== undefined;
      this.home.requireElementById(`dot-${i}`).setProperties({
        backgroundColor: solved ? '#f2a95c' : undefined,
        borderColor: solved ? '#f2a95c' : '#8c9bb5',
      });
    }
    this.show(true, false);
  }

  private runTutorial(): void {
    if (tutorial === undefined) return;
    this.session = null;
    stopPuzzle();
    this.show(false, false);
    tutorial(() => {
      this.p = { ...this.p, tutorialDone: true };
      save(this.p);
      this.showHome();
    });
  }

  // ---- Sessions ------------------------------------------------------------

  private startDaily(): void {
    const key = dateKey(new Date());
    this.session = { kind: 'daily', key };
    this.show(false, false);
    startPuzzle(dailyPuzzle(key));
  }

  private startPractice(): void {
    clearTimeout(this.resultTimer);
    this.session = { kind: 'practice' };
    this.show(false, false);
    startPuzzle(puzzleForLevel(this.p.level, this.p.practiceSeed));
  }

  private onSolved(seconds: number, blocks: number, par: number): void {
    const s = this.session;
    if (s === null) return; // tutorial puzzles are T-06's
    let change: string;
    if (s.kind === 'daily') {
      const before = this.p;
      this.p = recordDaily(this.p, s.key, seconds);
      const streak = currentStreak(this.p, s.key);
      change =
        this.p === before
          ? `Already done today: ${formatTime(this.p.dailyTimes[s.key] ?? seconds)}`
          : `Streak: ${streak} ${streak === 1 ? 'day' : 'days'}. Back tomorrow!`;
    } else {
      const level = this.p.level;
      this.p = recordPractice(this.p, seconds);
      change =
        this.p.level > level
          ? `Level up! Now level ${this.p.level}`
          : this.p.level === 8
            ? 'Top level reached'
            : `1 more solve to level ${level + 1}`;
    }
    save(this.p);

    this.text(this.result, 'result-time', formatTime(seconds));
    this.text(this.result, 'result-blocks', `${blocks} / ${par}`);
    this.result.requireElementById('result-lean').setProperties({ display: blocks <= par ? 'flex' : 'none' });
    this.text(this.result, 'result-change', change);
    this.result.requireElementById('btn-next').setProperties({ display: s.kind === 'practice' ? 'flex' : 'none' });

    clearTimeout(this.resultTimer);
    this.resultTimer = window.setTimeout(() => {
      if (this.session !== s) return;
      setControlsVisible(false); // the solved build stays, locked; the card takes the bar's place
      this.show(false, true);
    }, RESULT_DELAY_MS);
  }

  // ---- Settings ------------------------------------------------------------

  private toggle(key: 'sound' | 'highContrast'): void {
    this.p = { ...this.p, [key]: !this.p[key] };
    save(this.p);
    applySound(this.p.sound);
    setHighContrast(this.p.highContrast);
    this.showHome();
  }

  private text(panel: UIKitMLAsset, id: string, text: string): void {
    panel.requireElementById<UIKit.Text>(id).setProperties({ text });
  }

  /** Dev only: current progress and session, for emulator checks. */
  debugState(): { progress: Progress; session: Session } {
    return { progress: this.p, session: this.session };
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
