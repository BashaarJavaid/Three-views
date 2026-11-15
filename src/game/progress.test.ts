/// <reference types="node" />
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
// Node runs .ts directly and needs the extension; tsconfig lacks allowImportingTsExtensions.
// @ts-ignore TS5097
import { currentStreak, dateKey, load, recordDaily, recordPractice, save, type Progress } from './progress.ts';

const store = new Map<string, string>();
const memoryStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
};

function setStorage(s: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value: s, configurable: true, writable: true });
}

beforeEach(() => {
  store.clear();
  setStorage(memoryStorage);
});

const DEFAULTS: Progress = {
  level: 1,
  solvesAtLevel: 0,
  streak: 0,
  lastDaily: null,
  dailyTimes: {},
  tutorialDone: false,
  sound: true,
  highContrast: false,
  practiceSeed: 1,
};

test('load returns defaults when storage is empty', () => {
  assert.deepEqual(load(), DEFAULTS);
});

test('load returns defaults when localStorage throws', () => {
  setStorage({
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('SecurityError');
    },
  });
  assert.deepEqual(load(), DEFAULTS);
  assert.doesNotThrow(() => save({ ...DEFAULTS, level: 3 }));
});

test('load returns defaults when localStorage is missing', () => {
  setStorage(undefined);
  assert.deepEqual(load(), DEFAULTS);
  assert.doesNotThrow(() => save(DEFAULTS));
});

test('load returns defaults for bad data, per field', () => {
  memoryStorage.setItem('three-views.progress.v1', '{not json');
  assert.deepEqual(load(), DEFAULTS);
  memoryStorage.setItem('three-views.progress.v1', 'null');
  assert.deepEqual(load(), DEFAULTS);
  memoryStorage.setItem(
    'three-views.progress.v1',
    JSON.stringify({ level: 99, streak: -1, sound: 'yes', lastDaily: 'tuesday', dailyTimes: { bad: 1, '2026-11-15': 30 } }),
  );
  assert.deepEqual(load(), { ...DEFAULTS, dailyTimes: { '2026-11-15': 30 } });
});

test('save then load round-trips', () => {
  const p: Progress = { ...DEFAULTS, level: 4, solvesAtLevel: 1, streak: 2, lastDaily: '2026-11-15', dailyTimes: { '2026-11-15': 42 }, tutorialDone: true, sound: false, highContrast: true, practiceSeed: 17 };
  save(p);
  assert.deepEqual(load(), p);
});

test('two practice solves raise the level by one, capped at 8', () => {
  let p = DEFAULTS;
  p = recordPractice(p, 10);
  assert.equal(p.level, 1);
  assert.equal(p.solvesAtLevel, 1);
  p = recordPractice(p, 10);
  assert.equal(p.level, 2);
  assert.equal(p.solvesAtLevel, 0);
  for (let i = 0; i < 40; i++) p = recordPractice(p, 10);
  assert.equal(p.level, 8);
  assert.equal(DEFAULTS.level, 1, 'input not mutated');
});

test('streak rules', () => {
  let p = recordDaily(DEFAULTS, '2026-11-15', 50);
  assert.equal(p.streak, 1);
  p = recordDaily(p, '2026-11-16', 40);
  assert.equal(p.streak, 2);
  // Month boundary counts as consecutive.
  const q = recordDaily({ ...DEFAULTS, streak: 5, lastDaily: '2026-10-31', dailyTimes: { '2026-10-31': 9 } }, '2026-11-01', 9);
  assert.equal(q.streak, 6);
  // Solving twice in a day changes nothing.
  const again = recordDaily(p, '2026-11-16', 5);
  assert.deepEqual(again, p);
  assert.equal(again.dailyTimes['2026-11-16'], 40);
  // Skipping a day restarts at 1.
  p = recordDaily(p, '2026-11-18', 30);
  assert.equal(p.streak, 1);
  assert.equal(p.lastDaily, '2026-11-18');
  assert.deepEqual(p.dailyTimes, { '2026-11-15': 50, '2026-11-16': 40, '2026-11-18': 30 });
});

test('dailyTimes keeps the last 30', () => {
  let p = DEFAULTS;
  const d = new Date(2026, 0, 1, 12);
  for (let i = 0; i < 40; i++) {
    p = recordDaily(p, dateKey(d), i);
    d.setDate(d.getDate() + 1);
  }
  const keys = Object.keys(p.dailyTimes).sort();
  assert.equal(keys.length, 30);
  assert.equal(keys[0], '2026-01-11');
  assert.equal(keys[29], '2026-02-09');
  assert.equal(p.streak, 40);
});

test('dateKey uses the local date, zero-padded', () => {
  assert.equal(dateKey(new Date(2026, 10, 18, 0, 5)), '2026-11-18');
  assert.equal(dateKey(new Date(2026, 0, 2, 23, 59)), '2026-01-02');
});

test('practiceSeed increments on every practice solve and survives load', () => {
  let p = DEFAULTS;
  for (let i = 0; i < 20; i++) p = recordPractice(p, 10); // crosses level-ups and the level 8 cap
  assert.equal(p.level, 8);
  assert.equal(p.practiceSeed, 21);
  save(p);
  assert.equal(load().practiceSeed, 21);
  memoryStorage.setItem('three-views.progress.v1', JSON.stringify({ ...p, practiceSeed: 'x' }));
  assert.equal(load().practiceSeed, 1);
});

test('currentStreak: today and yesterday keep it, older or null shows 0', () => {
  const p: Progress = { ...DEFAULTS, streak: 4, lastDaily: '2026-11-17' };
  assert.equal(currentStreak(p, '2026-11-17'), 4);
  assert.equal(currentStreak(p, '2026-11-18'), 4);
  assert.equal(currentStreak(p, '2026-11-19'), 0);
  assert.equal(currentStreak({ ...p, lastDaily: null }, '2026-11-18'), 0);
  assert.equal(currentStreak({ ...p, lastDaily: '2026-11-30' }, '2026-12-01'), 4);
});
