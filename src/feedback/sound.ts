// Synthesized sounds (DESIGN.md §10, D9): no files, Web Audio only. The
// AudioContext is created on the first user gesture so browsers never warn.
import { load } from '../game/progress.js';

export type SoundName = 'add' | 'remove' | 'rejected' | 'matched' | 'solved' | 'button';

const MASTER = 0.3;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = load().sound;

/** Dev-only record of every oscillator start, readable from `window.__threeViews`. */
export const soundLog: string[] = [];

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

export function soundEnabled(): boolean {
  return enabled;
}

function unlock(): void {
  try {
    if (ctx === null) {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null; // no audio on this device; visuals still play
  }
}

/** Call once at startup: the first tap or key creates/resumes the context. */
export function installAudioUnlock(): () => void {
  const opts = { capture: true } as const;
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('keydown', unlock, opts);
  return () => {
    window.removeEventListener('pointerdown', unlock, opts);
    window.removeEventListener('keydown', unlock, opts);
  };
}

/** One enveloped oscillator; both nodes are disconnected when it ends. */
function tone(
  type: OscillatorType,
  f0: number,
  f1: number,
  at: number,
  dur: number,
  peak: number,
): void {
  const c = ctx!;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master!);
  osc.onended = () => {
    osc.disconnect();
    g.disconnect();
  };
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Play a sound. `blocks` raises the add tick's pitch. Returns whether audio started. */
export function play(name: SoundName, blocks = 0): boolean {
  if (!enabled) return false;
  if (ctx === null || ctx.state !== 'running') unlock();
  if (ctx === null || master === null) return false;
  switch (name) {
    case 'add': {
      const f = 520 * 2 ** (Math.min(blocks, 24) / 24);
      tone('triangle', f, f * 1.05, 0, 0.09, 0.5);
      break;
    }
    case 'remove':
      tone('sine', 330, 220, 0, 0.12, 0.55);
      break;
    case 'rejected':
      tone('sine', 140, 70, 0, 0.16, 0.6);
      break;
    case 'matched':
      tone('sine', 1318.5, 1318.5, 0, 0.5, 0.3);
      tone('sine', 2637, 2637, 0, 0.3, 0.08);
      break;
    case 'solved':
      // C5, E5, G5 rising, in step with the wall pulses.
      tone('triangle', 523.25, 523.25, 0, 0.45, 0.4);
      tone('triangle', 659.25, 659.25, 0.25, 0.45, 0.4);
      tone('triangle', 783.99, 783.99, 0.5, 0.7, 0.45);
      tone('sine', 1567.98, 1567.98, 0.5, 0.6, 0.1);
      break;
    case 'button':
      tone('square', 1800, 1200, 0, 0.03, 0.08);
      break;
  }
  if (import.meta.env.DEV) {
    soundLog.push(name);
    console.debug(`[feedback] sound ${name} (ctx ${ctx.state})`);
  }
  return true;
}
