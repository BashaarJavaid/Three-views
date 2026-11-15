// Wall overlays (DESIGN.md §6 wall states): target frames, live shadow fills,
// crosses on wrong squares, and the matched border with a tick. Children of
// the glass box, so they turn with it. They never take ray hits.
//
// T-07b: each kind of mark on a wall is one merged mesh (a "layer") holding a
// copy for every square. Showing or hiding squares rewrites the layer's index
// buffer and draw range, so a wall costs at most five draw calls.
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from '@iwsdk/core';
import { type Outlines, project } from '../game/logic.js';
import { BLOCK_SIZE, type BoxSize } from '../scene-assets/glass-box.scene-asset.js';
import type { Wall } from './events.js';

export const WALLS: readonly Wall[] = ['top', 'front', 'side'];

/** A mesh that rays pass through. */
export class GhostMesh extends Mesh {
  override raycast(): void {}
}

// forceSinglePass: three draws transparent double-sided materials twice (back
// faces, then front). These marks are flat, so one pass looks the same at half the draws.
const mat = (color: string, opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: DoubleSide,
    depthWrite: false,
    forceSinglePass: true,
  });

const frameMat = mat('#dff0ff', 0.9);
const fillMat = mat('#e0a060', 0.55);
const wrongMat = mat('#ff4d4d', 0.65);
const crossMat = mat('#ffffff', 1);
const matchedMat = mat('#5ef0a0', 1);

type Seg = [number, number, number, number];

/** Flat strips along segments, in the XY plane at height z. */
function strips(segs: Seg[], width: number, z: number): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [x0, y0, x1, y1] of segs) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = (-(y1 - y0) / len) * (width / 2);
    const ny = ((x1 - x0) / len) * (width / 2);
    const base = pos.length / 3;
    pos.push(x0 + nx, y0 + ny, z, x1 + nx, y1 + ny, z, x1 - nx, y1 - ny, z, x0 - nx, y0 - ny, z);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/** Square outline of side s centred at the origin; strips stay inside it. */
function squareSegs(s: number, w: number): Seg[] {
  const h = s / 2 - w / 2;
  return [
    [-h - w / 2, h, h + w / 2, h],
    [-h - w / 2, -h, h + w / 2, -h],
    [h, -h, h, h],
    [-h, -h, -h, h],
  ];
}

/** Copies of each template placed at the given offsets, merged into one indexed geometry. */
function merged(parts: { geo: BufferGeometry; x: number; y: number }[]): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const { geo, x, y } of parts) {
    const p = geo.getAttribute('position');
    const base = pos.length / 3;
    for (let v = 0; v < p.count; v++) pos.push(p.getX(v) + x, p.getY(v) + y, p.getZ(v));
    const ix = geo.getIndex()!;
    for (let k = 0; k < ix.count; k++) idx.push(ix.getX(k) + base);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** One kind of mark for every square of a wall, drawn in one call. */
export class Layer {
  readonly mesh: GhostMesh;
  /** Which squares are shown (1) or hidden (0). */
  readonly on: Uint8Array;
  /** Layer allowed to draw at all (high-contrast swaps thin and thick frames). */
  enabled = true;
  private readonly full: Uint16Array;
  private readonly index: BufferAttribute;
  private readonly per: number;

  constructor(template: BufferGeometry, centres: number[], material: MeshBasicMaterial, order: number) {
    const parts = [];
    for (let i = 0; i < centres.length; i += 2) parts.push({ geo: template, x: centres[i], y: centres[i + 1] });
    const geo = merged(parts);
    this.full = new Uint16Array(geo.getIndex()!.array);
    this.index = new BufferAttribute(new Uint16Array(this.full.length), 1);
    this.index.setUsage(DynamicDrawUsage);
    geo.setIndex(this.index);
    this.per = this.full.length / (centres.length / 2);
    this.on = new Uint8Array(centres.length / 2);
    this.mesh = new GhostMesh(geo, material);
    this.mesh.renderOrder = order;
    this.apply();
  }

  /** Rewrite the index buffer from `on`. */
  apply(): void {
    const a = this.index.array as Uint16Array;
    const per = this.per;
    let k = 0;
    for (let i = 0; i < this.on.length; i++) {
      if (this.on[i] !== 1) continue;
      a.set(this.full.subarray(i * per, (i + 1) * per), k);
      k += per;
    }
    this.index.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, k);
    this.mesh.visible = this.enabled && k > 0;
  }

  /** Number of squares the layer currently draws. */
  drawn(): number {
    return this.mesh.visible ? this.mesh.geometry.drawRange.count / this.per : 0;
  }
}

interface WallGeo {
  fill: BufferGeometry;
  frameThin: BufferGeometry;
  frameThick: BufferGeometry;
  cross: BufferGeometry;
  matchedThin: BufferGeometry;
  matchedThick: BufferGeometry;
}

const geoCache = new Map<string, WallGeo>();

/** Templates for one square (and the whole-wall matched mark); `top` puts the tick below the wall. */
function wallGeo(n: BoxSize, wall: Wall): WallGeo {
  const key = `${n}-${wall === 'top' ? 'top' : 'up'}`;
  let g = geoCache.get(key);
  if (g !== undefined) return g;
  const b = BLOCK_SIZE[n];
  const s = n * b;
  const c = b * 0.28;
  const t = 0.022;
  const fill = new PlaneGeometry(b * 0.84, b * 0.84);
  fill.translate(0, 0, 0.0015);
  const tick = strips(
    [
      [-t, 0, -t / 3, -t * 0.7],
      [-t / 3 - 0.003, -t * 0.7 - 0.003, t, t * 0.8],
    ],
    0.009,
    0.0035,
  );
  tick.scale(1.4, 1.4, 1);
  // Tick sits just outside the wall, on the edge nearest the player's view.
  const tickY = wall === 'top' ? -s / 2 - 0.04 : s / 2 + 0.04;
  const matched = (w: number): BufferGeometry =>
    merged([
      { geo: strips(squareSegs(s, w), w, 0.0035), x: 0, y: 0 },
      { geo: tick, x: 0, y: tickY },
    ]);
  g = {
    fill,
    frameThin: strips(squareSegs(b * 0.9, 0.005), 0.005, 0.0025),
    frameThick: strips(squareSegs(b * 0.9, 0.01), 0.01, 0.0025),
    cross: strips(
      [
        [-c, -c, c, c],
        [-c, c, c, -c],
      ],
      0.008,
      0.003,
    ),
    matchedThin: matched(0.008),
    matchedThick: matched(0.014),
  };
  geoCache.set(key, g);
  return g;
}

export interface WallOverlay {
  group: Group;
  frameThin: Layer;
  frameThick: Layer;
  fills: Layer;
  wrong: Layer;
  crosses: Layer;
  matchedThin: GhostMesh;
  matchedThick: GhostMesh;
  matched: boolean;
}

export interface Overlays {
  n: BoxSize;
  root: Group;
  walls: Record<Wall, WallOverlay>;
  highContrast: boolean;
}

/** Overlay groups for every wall of an N box, in the box's local frame. */
export function createOverlays(n: BoxSize): Overlays {
  const b = BLOCK_SIZE[n];
  const half = (n * b) / 2;
  const c = (i: number): number => -half + b * (i + 0.5);
  const root = new Group();
  root.name = 'play-walls';
  const make = (wall: Wall): WallOverlay => {
    const g = wallGeo(n, wall);
    const group = new Group();
    group.name = `overlay-${wall}`;
    // Square (a, b) in the wall's local XY plane (see glass-box transforms).
    const centres: number[] = [];
    for (let bIdx = 0; bIdx < n; bIdx++)
      for (let a = 0; a < n; a++) centres.push(wall === 'side' ? -c(a) : c(a), wall === 'top' ? -c(bIdx) : c(bIdx));
    const wo: WallOverlay = {
      group,
      frameThin: new Layer(g.frameThin, centres, frameMat, 5),
      frameThick: new Layer(g.frameThick, centres, frameMat, 5),
      fills: new Layer(g.fill, centres, fillMat, 4),
      wrong: new Layer(g.fill, centres, wrongMat, 4),
      crosses: new Layer(g.cross, centres, crossMat, 6),
      matchedThin: new GhostMesh(g.matchedThin, matchedMat),
      matchedThick: new GhostMesh(g.matchedThick, matchedMat),
      matched: false,
    };
    wo.frameThick.enabled = false;
    for (const m of [wo.matchedThin, wo.matchedThick]) {
      m.renderOrder = 7;
      m.visible = false;
    }
    group.add(
      wo.fills.mesh,
      wo.wrong.mesh,
      wo.frameThin.mesh,
      wo.frameThick.mesh,
      wo.crosses.mesh,
      wo.matchedThin,
      wo.matchedThick,
    );
    if (wall === 'top') {
      group.rotation.x = -Math.PI / 2;
      group.position.y = -half;
    } else if (wall === 'front') {
      group.position.z = -half;
    } else {
      group.rotation.y = Math.PI / 2;
      group.position.x = -half;
    }
    root.add(group);
    return wo;
  };
  return {
    n,
    root,
    walls: { top: make('top'), front: make('front'), side: make('side') },
    highContrast: false,
  };
}

function showMatched(o: Overlays, wo: WallOverlay): void {
  wo.matchedThin.visible = wo.matched && !o.highContrast;
  wo.matchedThick.visible = wo.matched && o.highContrast;
}

/** Show the target frames. */
export function setTarget(o: Overlays, target: Outlines): void {
  for (const w of WALLS) {
    const t = target[w];
    const wo = o.walls[w];
    for (let i = 0; i < t.length; i++) {
      wo.frameThin.on[i] = t[i] === 1 ? 1 : 0;
      wo.frameThick.on[i] = wo.frameThin.on[i];
    }
    wo.frameThin.apply();
    wo.frameThick.apply();
  }
}

/** Redraw fills, crosses and matched marks from the build. Returns the build's outlines. */
export function drawBuild(
  o: Overlays,
  shape: Uint8Array,
  target: Outlines,
  matched: Record<Wall, boolean>,
): Outlines {
  const live = project(o.n, shape);
  for (const w of WALLS) {
    const l = live[w];
    const t = target[w];
    const wo = o.walls[w];
    for (let i = 0; i < l.length; i++) {
      const covered = l[i] === 1;
      const wrong = covered && t[i] !== 1;
      wo.fills.on[i] = covered && !wrong ? 1 : 0;
      wo.wrong.on[i] = wrong ? 1 : 0;
      wo.crosses.on[i] = wrong ? 1 : 0;
    }
    wo.fills.apply();
    wo.wrong.apply();
    wo.crosses.apply();
    wo.matched = matched[w];
    showMatched(o, wo);
  }
  return live;
}

/**
 * Number of squares whose drawn state differs from `project(shape)` and the
 * target. Reads what each layer actually draws (its draw range), not only flags.
 */
export function countMismatches(
  o: Overlays,
  shape: Uint8Array,
  target: Outlines,
  matched: Record<Wall, boolean>,
): number {
  const live = project(o.n, shape);
  let bad = 0;
  for (const w of WALLS) {
    const wo = o.walls[w];
    const frames = o.highContrast ? wo.frameThick : wo.frameThin;
    let same = true;
    let nFill = 0;
    let nWrong = 0;
    let nFrame = 0;
    for (let i = 0; i < live[w].length; i++) {
      const covered = live[w][i] === 1;
      const wrong = covered && target[w][i] !== 1;
      if (covered !== target[w][i] > 0) same = false;
      if (covered && !wrong) nFill++;
      if (wrong) nWrong++;
      if (target[w][i] === 1) nFrame++;
      if (wo.fills.on[i] !== (covered && !wrong ? 1 : 0)) bad++;
      if (wo.wrong.on[i] !== (wrong ? 1 : 0)) bad++;
      if (wo.crosses.on[i] !== (wrong ? 1 : 0)) bad++;
      if (frames.on[i] !== (target[w][i] === 1 ? 1 : 0)) bad++;
    }
    bad += Math.abs(wo.fills.drawn() - nFill) + Math.abs(wo.wrong.drawn() - nWrong);
    bad += Math.abs(wo.crosses.drawn() - nWrong) + Math.abs(frames.drawn() - nFrame);
    const shown = wo.matchedThin.visible || wo.matchedThick.visible;
    if (same !== matched[w] || shown !== same) bad++;
  }
  return bad;
}

/** High contrast: brighter frames, heavier lines (DESIGN.md §10). */
export function setOverlayContrast(o: Overlays, on: boolean): void {
  o.highContrast = on;
  frameMat.opacity = on ? 1 : 0.9;
  frameMat.color.set(on ? '#ffffff' : '#dff0ff');
  fillMat.opacity = on ? 0.8 : 0.55;
  wrongMat.opacity = on ? 0.9 : 0.65;
  for (const w of WALLS) {
    const wo = o.walls[w];
    wo.frameThin.enabled = !on;
    wo.frameThick.enabled = on;
    wo.frameThin.apply();
    wo.frameThick.apply();
    showMatched(o, wo);
  }
}
