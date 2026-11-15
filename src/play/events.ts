// Play events (DESIGN.md §8). Sound, flow and tutorial listen here; they never
// reach into the play code. No SDK imports.
import type { Puzzle } from '../game/logic.js';

export type Wall = 'top' | 'front' | 'side';
export type Mode = 'add' | 'remove';

export interface PlayEvents {
  'block-added': { index: number };
  'block-removed': { index: number };
  'tap-rejected': Record<string, never>;
  'mode-changed': { mode: Mode };
  'box-turned': { quarterTurns: number };
  'wall-matched': { wall: Wall };
  'wall-unmatched': { wall: Wall };
  solved: { seconds: number; blocks: number; par: number };
  'puzzle-started': { puzzle: Puzzle };
  'home-requested': Record<string, never>;
  'button-pressed': Record<string, never>;
}

type Listener<K extends keyof PlayEvents> = (payload: PlayEvents[K]) => void;

const listeners = new Map<keyof PlayEvents, Set<(payload: never) => void>>();

/** Subscribe; returns the unsubscribe function. */
export function on<K extends keyof PlayEvents>(type: K, fn: Listener<K>): () => void {
  let set = listeners.get(type);
  if (set === undefined) listeners.set(type, (set = new Set()));
  set.add(fn);
  return () => set.delete(fn);
}

export function emit<K extends keyof PlayEvents>(type: K, payload: PlayEvents[K]): void {
  const set = listeners.get(type) as Set<Listener<K>> | undefined;
  if (set === undefined) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (err) {
      console.error(`[play] listener for ${type} threw`, err);
    }
  }
}
