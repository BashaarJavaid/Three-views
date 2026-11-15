// Pure puzzle logic (DESIGN.md §3, §4, §7, §9). No SDK, DOM or project imports.

export type Shape = Uint8Array; // length N*N*N, 1 = filled
export type Outline = Uint8Array; // length N*N, 1 = covered
export interface Outlines {
  top: Outline;
  front: Outline;
  side: Outline;
}
export interface Puzzle {
  n: 3 | 4;
  seed: number;
  target: Outlines;
  par: number;
}

export function cellIndex(n: number, x: number, y: number, z: number): number {
  return x + y * n + z * n * n;
}

// Top: (x, z), drop y. Front: (x, y), drop z. Side: (z, y), drop x. Index a + b*N.
export function project(n: number, shape: Shape): Outlines {
  const top = new Uint8Array(n * n);
  const front = new Uint8Array(n * n);
  const side = new Uint8Array(n * n);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!shape[cellIndex(n, x, y, z)]) continue;
        top[x + z * n] = 1;
        front[x + y * n] = 1;
        side[z + y * n] = 1;
      }
  return { top, front, side };
}

function sameOutline(a: Outline, b: Outline): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!a[i] !== !b[i]) return false;
  return true;
}

export function wallMatches(
  n: number,
  shape: Shape,
  target: Outlines,
): { top: boolean; front: boolean; side: boolean } {
  const o = project(n, shape);
  return {
    top: sameOutline(o.top, target.top),
    front: sameOutline(o.front, target.front),
    side: sameOutline(o.side, target.side),
  };
}

export function isSolved(n: number, shape: Shape, target: Outlines): boolean {
  const m = wallMatches(n, shape, target);
  return m.top && m.front && m.side;
}

// Every cell whose three projections all land inside the targets.
export function maxFill(n: number, target: Outlines): Shape {
  const shape = new Uint8Array(n * n * n);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (target.top[x + z * n] && target.front[x + y * n] && target.side[z + y * n])
          shape[cellIndex(n, x, y, z)] = 1;
  return shape;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function count(o: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < o.length; i++) if (o[i]) c++;
  return c;
}

// Grows a connected shape of `blocks` cells from a random floor cell.
function growShape(rand: () => number, n: number, blocks: number): Shape {
  const shape = new Uint8Array(n * n * n);
  shape[cellIndex(n, Math.floor(rand() * n), 0, Math.floor(rand() * n))] = 1;
  for (let placed = 1; placed < blocks; placed++) {
    // Frontier: empty cells face-adjacent to the shape, in index order (deterministic).
    const frontier: number[] = [];
    for (let z = 0; z < n; z++)
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const i = cellIndex(n, x, y, z);
          if (shape[i]) continue;
          if (
            (x > 0 && shape[i - 1]) ||
            (x < n - 1 && shape[i + 1]) ||
            (y > 0 && shape[i - n]) ||
            (y < n - 1 && shape[i + n]) ||
            (z > 0 && shape[i - n * n]) ||
            (z < n - 1 && shape[i + n * n])
          )
            frontier.push(i);
        }
    shape[frontier[Math.floor(rand() * frontier.length)]] = 1;
  }
  return shape;
}

// Retries with seed+1, seed+2, … until all outlines are non-empty and no single
// block solves it. The returned puzzle's `seed` is the seed that was used.
export function generate(seed: number, n: 3 | 4, blocks: number): Puzzle {
  const b = Math.max(1, Math.min(n * n * n, Math.floor(blocks)));
  for (let s = seed >>> 0, tries = 0; tries < 1000; s = (s + 1) >>> 0, tries++) {
    const target = project(n, growShape(mulberry32(s), n, b));
    const nonEmpty = count(target.top) > 0 && count(target.front) > 0 && count(target.side) > 0;
    const oneBlock = count(target.top) === 1 && count(target.front) === 1 && count(target.side) === 1;
    if (nonEmpty && !oneBlock) return { n, seed: s, target, par: b };
  }
  throw new Error(`generate: no valid puzzle for n=${n}, blocks=${blocks}`);
}

// The generator's hidden shape for a generated puzzle (one valid solution, par blocks).
// Not part of the §7 contract; used by tests and available for debugging.
export function generatorShape(p: Puzzle): Shape {
  return growShape(mulberry32(p.seed), p.n, p.par);
}

const LEVELS: { n: 3 | 4; blocks: number }[] = [
  { n: 3, blocks: 4 },
  { n: 3, blocks: 5 },
  { n: 3, blocks: 7 },
  { n: 4, blocks: 7 },
  { n: 4, blocks: 9 },
  { n: 4, blocks: 12 },
  { n: 4, blocks: 15 },
  { n: 4, blocks: 18 },
];

export function puzzleForLevel(level: number, seed: number): Puzzle {
  const l = Math.max(1, Math.min(LEVELS.length, Math.floor(level) || 1));
  const { n, blocks } = LEVELS[l - 1];
  return generate(seed, n, blocks);
}

// FNV-1a hash of the date key gives the daily seed.
export function dailyPuzzle(dateKey: string): Puzzle {
  let h = 0x811c9dc5;
  for (let i = 0; i < dateKey.length; i++) {
    h ^= dateKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return generate(h, 4, 10);
}

function shapeOf(n: number, cells: [number, number, number][]): Shape {
  const s = new Uint8Array(n * n * n);
  for (const [x, y, z] of cells) s[cellIndex(n, x, y, z)] = 1;
  return s;
}

function tutorialPuzzle(cells: [number, number, number][]): Puzzle {
  return { n: 3, seed: 0, target: project(3, shapeOf(3, cells)), par: cells.length };
}

// The three teaching puzzles (DESIGN.md §6.1). All N = 3; seed 0 marks hand-written.
const L_SHAPE: [number, number, number][] = [[0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 1, 1], [0, 2, 1]];
const T_SHAPE: [number, number, number][] = [[0, 0, 1], [1, 0, 1], [2, 0, 1], [1, 1, 1]];
const RIDGE: [number, number, number][] = [
  [1, 0, 0], [1, 0, 1], [1, 0, 2],
  [1, 1, 0], [1, 1, 1], [1, 1, 2],
];

export const TUTORIAL: { puzzle: Puzzle; start: Shape; mode: 'add' | 'remove'; hint: number }[] = [
  // 1. Add: an L in the front plane, missing its bottom-right block.
  {
    puzzle: tutorialPuzzle(L_SHAPE),
    start: shapeOf(3, L_SHAPE.filter(([x, y, z]) => !(x === 2 && y === 0 && z === 1))),
    mode: 'add',
    hint: cellIndex(3, 2, 0, 1),
  },
  // 2. Remove: a T plus one extra block toward the player; its shadow crosses top and side.
  {
    puzzle: tutorialPuzzle(T_SHAPE),
    start: shapeOf(3, [...T_SHAPE, [1, 0, 2]]),
    mode: 'remove',
    hint: cellIndex(3, 1, 0, 2),
  },
  // 3. Turn: a front-to-back ridge at x = 1; the missing block sits on the left face of
  // (1,1,1), edge-on from the start view. Tapping the floor at (0,0,1) does not solve it.
  {
    puzzle: tutorialPuzzle([...RIDGE, [0, 1, 1]]),
    start: shapeOf(3, RIDGE),
    mode: 'add',
    hint: cellIndex(3, 0, 1, 1),
  },
];
