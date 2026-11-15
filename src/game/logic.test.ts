/// <reference types="node" />
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TUTORIAL,
  cellIndex,
  dailyPuzzle,
  generate,
  generatorShape,
  isSolved,
  maxFill,
  project,
  puzzleForLevel,
  wallMatches,
  // Node runs .ts directly and needs the extension; tsconfig lacks allowImportingTsExtensions.
  // @ts-ignore TS5097
} from './logic.ts';

const LEVEL_BLOCKS = [4, 5, 7, 7, 9, 12, 15, 18];

function grid(n: number, o: Uint8Array): string[] {
  const rows: string[] = [];
  for (let b = 0; b < n; b++) {
    let r = '';
    for (let a = 0; a < n; a++) r += o[a + b * n] ? '#' : '.';
    rows.push(r);
  }
  return rows;
}

function sum(a: Uint8Array): number {
  let c = 0;
  for (const v of a) c += v;
  return c;
}

test('project follows the DESIGN.md §4 wall table on a 3x3x3 case', () => {
  const n = 3;
  const s = new Uint8Array(27);
  s[cellIndex(n, 2, 0, 0)] = 1; // right, floor, far
  s[cellIndex(n, 0, 2, 1)] = 1; // left, top, middle depth
  s[cellIndex(n, 1, 1, 2)] = 1; // centre x, middle height, nearest the player
  assert.equal(cellIndex(n, 2, 1, 2), 2 + 1 * 3 + 2 * 9);
  const o = project(n, s);
  // Rows are b = 0..N-1, columns a = 0..N-1, index a + b*N.
  assert.deepEqual(grid(n, o.top), ['..#', '#..', '.#.']); // (x, z)
  assert.deepEqual(grid(n, o.front), ['..#', '.#.', '#..']); // (x, y)
  assert.deepEqual(grid(n, o.side), ['#..', '..#', '.#.']); // (z, y)
});

test('isSolved and wallMatches compare outlines, not shapes', () => {
  const n = 3;
  const a = new Uint8Array(27);
  a[cellIndex(n, 0, 0, 0)] = 1;
  a[cellIndex(n, 1, 1, 1)] = 1;
  const target = project(n, a);
  const b = new Uint8Array(27);
  b[cellIndex(n, 1, 0, 0)] = 1;
  b[cellIndex(n, 0, 1, 1)] = 1;
  assert.deepEqual(wallMatches(n, b, target), { top: false, front: false, side: true });
  assert.equal(isSolved(n, a, target), true);
  assert.equal(isSolved(n, b, target), false);
  // A different, larger shape with the same three shadows also solves (D2).
  const c = new Uint8Array(27);
  c[cellIndex(n, 0, 0, 0)] = 1;
  c[cellIndex(n, 1, 0, 1)] = 1;
  c[cellIndex(n, 1, 1, 0)] = 1;
  const full = maxFill(n, project(n, c));
  assert.equal(full[cellIndex(n, 1, 0, 0)], 1);
  assert.equal(sum(full), 4);
  assert.equal(isSolved(n, full, project(n, c)), true);
});

test('500 seeds at every level: own shape and maxFill solve, block count = par', () => {
  for (let level = 1; level <= 8; level++) {
    for (let seed = 0; seed < 500; seed++) {
      const p = puzzleForLevel(level, seed);
      const at = `level ${level} seed ${seed}`;
      assert.equal(p.n, level <= 3 ? 3 : 4, at);
      assert.equal(p.par, LEVEL_BLOCKS[level - 1], at);
      const own = generatorShape(p);
      assert.equal(sum(own), p.par, at);
      assert.ok(isSolved(p.n, own, p.target), `own shape ${at}`);
      assert.ok(isSolved(p.n, maxFill(p.n, p.target), p.target), `maxFill ${at}`);
      const sums = [p.target.top, p.target.front, p.target.side].map(sum);
      assert.ok(sums.every((c) => c > 0), `non-empty ${at}`);
      assert.ok(!sums.every((c) => c === 1), `not one block ${at}`);
    }
  }
});

test('generate is deterministic', () => {
  for (const [seed, n, b] of [[1, 3, 4], [42, 4, 10], [99999, 4, 18]] as const) {
    assert.deepEqual(generate(seed, n, b), generate(seed, n, b));
  }
  assert.notDeepEqual(generate(1, 4, 10).target, generate(2, 4, 10).target);
});

test('dailyPuzzle is stable and differs by date', () => {
  const a = dailyPuzzle('2026-11-18');
  assert.deepEqual(a, dailyPuzzle('2026-11-18'));
  assert.equal(a.n, 4);
  assert.equal(a.par, 10);
  assert.notDeepEqual(a.target, dailyPuzzle('2026-11-19').target);
  // Pinned so a code change that alters the judging-day puzzle fails loudly.
  assert.deepEqual(
    { seed: a.seed, top: grid(4, a.target.top), front: grid(4, a.target.front), side: grid(4, a.target.side) },
    DAILY_2026_11_18,
  );
});

const DAILY_2026_11_18 = {
  seed: 1947985822,
  top: ['.###', '####', '#...', '....'],
  front: ['####', '.##.', '....', '....'],
  side: ['###.', '#...', '....', '....'],
};

test('each tutorial puzzle is solved by its one intended move', () => {
  assert.deepEqual(TUTORIAL.map((t) => t.mode), ['add', 'remove', 'add']);
  for (const [i, t] of TUTORIAL.entries()) {
    const n = t.puzzle.n;
    assert.equal(n, 3);
    assert.equal(isSolved(n, t.start, t.puzzle.target), false, `tutorial ${i + 1} starts unsolved`);
    const after = new Uint8Array(t.start);
    assert.equal(after[t.hint], t.mode === 'add' ? 0 : 1);
    after[t.hint] = t.mode === 'add' ? 1 : 0;
    assert.ok(isSolved(n, after, t.puzzle.target), `tutorial ${i + 1} solved by its hint`);
  }
  // Tutorial 2: the extra block's shadow shows a cross on at least one wall.
  const t2 = TUTORIAL[1];
  const m2 = wallMatches(3, t2.start, t2.puzzle.target);
  assert.ok(!m2.top || !m2.front || !m2.side);
  // Tutorial 3: tapping the visible floor square under the hint does not solve it.
  const t3 = TUTORIAL[2];
  const floor = new Uint8Array(t3.start);
  floor[cellIndex(3, 0, 0, 1)] = 1;
  assert.equal(isSolved(3, floor, t3.puzzle.target), false);
});
