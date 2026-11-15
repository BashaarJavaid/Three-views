// Wall overlays (DESIGN.md §6 wall states): target frames, live shadow fills,
// crosses on wrong squares, and the matched border with a tick. Children of
// the glass box, so they turn with it. They never take ray hits.
import {
  BufferGeometry,
  DoubleSide,
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

const mat = (color: string, opacity: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color, transparent: true, opacity, side: DoubleSide, depthWrite: false });

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
  g.computeBoundingSphere();
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

interface WallGeo {
  fill: BufferGeometry;
  frameThin: BufferGeometry;
  frameThick: BufferGeometry;
  cross: BufferGeometry;
  borderThin: BufferGeometry;
  borderThick: BufferGeometry;
  tick: BufferGeometry;
}

const geoCache = new Map<BoxSize, WallGeo>();

function wallGeo(n: BoxSize): WallGeo {
  let g = geoCache.get(n);
  if (g !== undefined) return g;
  const b = BLOCK_SIZE[n];
  const s = n * b;
  const c = b * 0.28;
  const t = 0.022;
  const fill = new PlaneGeometry(b * 0.84, b * 0.84);
  fill.translate(0, 0, 0.0015);
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
    borderThin: strips(squareSegs(s, 0.008), 0.008, 0.0035),
    borderThick: strips(squareSegs(s, 0.014), 0.014, 0.0035),
    tick: strips(
      [
        [-t, 0, -t / 3, -t * 0.7],
        [-t / 3 - 0.003, -t * 0.7 - 0.003, t, t * 0.8],
      ],
      0.009,
      0.0035,
    ),
  };
  geoCache.set(n, g);
  return g;
}

export interface WallOverlay {
  group: Group;
  frames: GhostMesh[];
  fills: GhostMesh[];
  crosses: GhostMesh[];
  border: GhostMesh;
  tick: GhostMesh;
}

export interface Overlays {
  n: BoxSize;
  root: Group;
  walls: Record<Wall, WallOverlay>;
}

function ghost(geo: BufferGeometry, material: MeshBasicMaterial, order: number): GhostMesh {
  const m = new GhostMesh(geo, material);
  m.renderOrder = order;
  m.visible = false;
  return m;
}

/** Overlay groups for every wall of an N box, in the box's local frame. */
export function createOverlays(n: BoxSize): Overlays {
  const g = wallGeo(n);
  const b = BLOCK_SIZE[n];
  const half = (n * b) / 2;
  const c = (i: number): number => -half + b * (i + 0.5);
  const root = new Group();
  root.name = 'play-walls';
  const make = (wall: Wall): WallOverlay => {
    const group = new Group();
    group.name = `overlay-${wall}`;
    const frames: GhostMesh[] = [];
    const fills: GhostMesh[] = [];
    const crosses: GhostMesh[] = [];
    for (let bIdx = 0; bIdx < n; bIdx++)
      for (let a = 0; a < n; a++) {
        // Outline (a, b) in the wall's local XY plane (see glass-box transforms).
        const x = wall === 'side' ? -c(a) : c(a);
        const y = wall === 'top' ? -c(bIdx) : c(bIdx);
        const f = ghost(g.frameThin, frameMat, 5);
        const fi = ghost(g.fill, fillMat, 4);
        const cr = ghost(g.cross, crossMat, 6);
        for (const m of [f, fi, cr]) {
          m.position.set(x, y, 0);
          group.add(m);
        }
        frames.push(f);
        fills.push(fi);
        crosses.push(cr);
      }
    const border = ghost(g.borderThin, matchedMat, 7);
    const tick = ghost(g.tick, matchedMat, 7);
    tick.scale.setScalar(1.4);
    // Tick sits just outside the wall, on the edge nearest the player's view.
    tick.position.set(0, wall === 'top' ? -half - 0.04 : half + 0.04, 0);
    group.add(border, tick);
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
    return { group, frames, fills, crosses, border, tick };
  };
  return { n, root, walls: { top: make('top'), front: make('front'), side: make('side') } };
}

/** Show the target frames. */
export function setTarget(o: Overlays, target: Outlines): void {
  for (const w of WALLS) {
    const t = target[w];
    const wo = o.walls[w];
    for (let i = 0; i < t.length; i++) wo.frames[i].visible = t[i] === 1;
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
      wo.fills[i].visible = covered;
      wo.fills[i].material = wrong ? wrongMat : fillMat;
      wo.crosses[i].visible = wrong;
    }
    wo.border.visible = matched[w];
    wo.tick.visible = matched[w];
  }
  return live;
}

/** Number of squares whose drawn state differs from `project(shape)` and the target. */
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
    let same = true;
    for (let i = 0; i < live[w].length; i++) {
      const covered = live[w][i] === 1;
      const wrong = covered && target[w][i] !== 1;
      if (covered !== target[w][i] > 0) same = false;
      if (wo.fills[i].visible !== covered) bad++;
      if (wo.crosses[i].visible !== wrong) bad++;
      if (covered && (wo.fills[i].material === wrongMat) !== wrong) bad++;
      if (wo.frames[i].visible !== (target[w][i] === 1)) bad++;
    }
    if (same !== matched[w] || wo.tick.visible !== same || wo.border.visible !== same) bad++;
  }
  return bad;
}

/** High contrast: brighter frames, heavier lines (DESIGN.md §10). */
export function setOverlayContrast(o: Overlays, on: boolean): void {
  const g = wallGeo(o.n);
  frameMat.opacity = on ? 1 : 0.9;
  frameMat.color.set(on ? '#ffffff' : '#dff0ff');
  fillMat.opacity = on ? 0.8 : 0.55;
  wrongMat.opacity = on ? 0.9 : 0.65;
  for (const w of WALLS) {
    const wo = o.walls[w];
    for (const f of wo.frames) f.geometry = on ? g.frameThick : g.frameThin;
    wo.border.geometry = on ? g.borderThick : g.borderThin;
  }
}
