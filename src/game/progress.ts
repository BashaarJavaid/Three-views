// Saved progress (DESIGN.md §7, §9). The only code that touches localStorage.

export interface Progress {
  level: number; // 1..8
  solvesAtLevel: number;
  streak: number; // consecutive days with the daily solved
  lastDaily: string | null; // date key
  dailyTimes: Record<string, number>; // date key → seconds, last 30 kept
  tutorialDone: boolean;
  sound: boolean;
  highContrast: boolean;
  practiceSeed: number; // next practice seed; +1 per practice solve
}

const KEY = 'three-views.progress.v1';
const MAX_LEVEL = 8;
const KEEP_TIMES = 30;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function defaults(): Progress {
  return {
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
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function load(): Progress {
  const d = defaults();
  try {
    const raw = globalThis.localStorage.getItem(KEY);
    if (!raw) return d;
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== 'object') return d;
    const r = o as Record<string, unknown>;
    const times: Record<string, number> = {};
    if (r.dailyTimes && typeof r.dailyTimes === 'object') {
      for (const [k, v] of Object.entries(r.dailyTimes as Record<string, unknown>))
        if (DATE_RE.test(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) times[k] = v;
    }
    return {
      level: int(r.level, 1, MAX_LEVEL, d.level),
      solvesAtLevel: int(r.solvesAtLevel, 0, Number.MAX_SAFE_INTEGER, d.solvesAtLevel),
      streak: int(r.streak, 0, Number.MAX_SAFE_INTEGER, d.streak),
      lastDaily: typeof r.lastDaily === 'string' && DATE_RE.test(r.lastDaily) ? r.lastDaily : null,
      dailyTimes: times,
      tutorialDone: bool(r.tutorialDone, d.tutorialDone),
      sound: bool(r.sound, d.sound),
      highContrast: bool(r.highContrast, d.highContrast),
      practiceSeed: int(r.practiceSeed, 0, 0xffffffff, d.practiceSeed),
    };
  } catch {
    return d;
  }
}

export function save(p: Progress): void {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage missing, blocked or full: the app keeps working without it.
  }
}

// Two practice solves at a level move up one, capped at 8. Levels never go down.
export function recordPractice(p: Progress, _seconds: number): Progress {
  const solves = p.solvesAtLevel + 1;
  const practiceSeed = p.practiceSeed + 1;
  if (solves >= 2 && p.level < MAX_LEVEL) return { ...p, level: p.level + 1, solvesAtLevel: 0, practiceSeed };
  return { ...p, solvesAtLevel: solves, practiceSeed };
}

function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d - 1, 12)); // noon avoids DST edges
}

// Streak grows when yesterday's daily was solved, otherwise restarts at 1.
// Solving the same day twice changes nothing.
export function recordDaily(p: Progress, key: string, seconds: number): Progress {
  if (p.lastDaily === key || p.dailyTimes[key] !== undefined) return p;
  const streak = p.lastDaily !== null && p.lastDaily === previousDay(key) ? p.streak + 1 : 1;
  const times: Record<string, number> = {};
  const keys = [...Object.keys(p.dailyTimes), key].sort().slice(-KEEP_TIMES);
  for (const k of keys) times[k] = k === key ? seconds : p.dailyTimes[k];
  return { ...p, streak, lastDaily: key, dailyTimes: times };
}

// The streak Home shows: alive only if the last daily was today or yesterday.
export function currentStreak(p: Progress, todayKey: string): number {
  return p.lastDaily !== null && (p.lastDaily === todayKey || p.lastDaily === previousDay(todayKey)) ? p.streak : 0;
}

export function dateKey(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
