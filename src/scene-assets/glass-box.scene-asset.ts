import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PlaneGeometry,
  Vector3,
} from '@iwsdk/core';

/**
 * The glass box: three thin translucent walls with grid lines, the stage of
 * every puzzle (DESIGN.md §4).
 *
 * Local frame, origin at the box centre, size S = N * block:
 *   cell (x, y, z) occupies [-S/2 + x*b, -S/2 + (x+1)*b] on each axis;
 *   +x is the player's right, +y up, +z toward the player.
 *   Top view   = floor wall at y = -S/2, faces +y.
 *   Front view = back wall  at z = -S/2, faces +z.
 *   Side view  = left wall  at x = -S/2, faces +x.
 *
 * Hierarchy: `glass-box` (root) > `glass-box-walls` > `wall-top|front|side`
 * > `pane`, `grid`. `setGlassBoxSize()` swaps the `glass-box-walls` child; the
 * wall geometry for each N is built once per JS realm and shared, so switching
 * N repeatedly allocates nothing new and nothing needs disposing.
 *
 * Walls never take ray hits (DESIGN.md §5): every wall mesh is a `WallMesh`,
 * whose raycast is empty. The class survives `clone()`.
 */

export type BoxSize = 3 | 4;

/** Block edge in metres for each grid size (DESIGN.md §4). */
export const BLOCK_SIZE: Record<BoxSize, number> = { 3: 0.12, 4: 0.1 };

export const GLASS_BOX_NAME = 'glass-box';
const WALLS_NAME = 'glass-box-walls';

class WallMesh extends Mesh {
  override raycast(): void {}
}

const paneMaterial = new MeshBasicMaterial({
  color: '#6f9fd8',
  transparent: true,
  opacity: 0.1,
  side: DoubleSide,
  depthWrite: false,
});

const gridMaterial = new MeshBasicMaterial({
  color: '#a9d2ff',
  transparent: true,
  opacity: 0.55,
  side: DoubleSide,
  depthWrite: false,
});

/** Grid line width in metres: inner lines and the outer frame. */
const LINE_WIDTH = 0.003;
const FRAME_WIDTH = 0.006;
/** Lift of the grid above its pane, toward the inside of the box. */
const GRID_LIFT = 0.0008;

/**
 * Grid strips for one wall in its local XY plane (normal +Z): N+1 lines each
 * way, the outer two drawn wider as a frame. Strips stay inside the S x S
 * square so the three walls meet cleanly at the shared edges.
 */
function gridGeometry(n: number, block: number): BufferGeometry {
  const half = (n * block) / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number): void => {
    const base = positions.length / 3;
    positions.push(x0, y0, GRID_LIFT, x1, y0, GRID_LIFT);
    positions.push(x1, y1, GRID_LIFT, x0, y1, GRID_LIFT);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (let i = 0; i <= n; i += 1) {
    const edge = i === 0 || i === n;
    const w = edge ? FRAME_WIDTH : LINE_WIDTH;
    // Edge strips sit just inside the square; inner strips are centred.
    let c = -half + i * block;
    if (i === 0) c += w / 2;
    if (i === n) c -= w / 2;
    quad(c - w / 2, -half, c + w / 2, half); // vertical line
    quad(-half, c - w / 2, half, c + w / 2); // horizontal line
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const normals = new Float32Array(positions.length);
  for (let i = 2; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

interface WallGeometry {
  pane: BufferGeometry;
  grid: BufferGeometry;
}

const geometryCache = new Map<BoxSize, WallGeometry>();

function wallGeometry(n: BoxSize): WallGeometry {
  let cached = geometryCache.get(n);
  if (cached === undefined) {
    const size = n * BLOCK_SIZE[n];
    cached = {
      pane: new PlaneGeometry(size, size),
      grid: gridGeometry(n, BLOCK_SIZE[n]),
    };
    geometryCache.set(n, cached);
  }
  return cached;
}

function createWall(name: string, n: BoxSize): Group {
  const { pane, grid } = wallGeometry(n);
  const wall = new Group();
  wall.name = name;
  const paneMesh = new WallMesh(pane, paneMaterial);
  paneMesh.name = 'pane';
  paneMesh.renderOrder = 1;
  const gridMesh = new WallMesh(grid, gridMaterial);
  gridMesh.name = 'grid';
  gridMesh.renderOrder = 2;
  wall.add(paneMesh, gridMesh);
  return wall;
}

function createWalls(n: BoxSize): Group {
  const half = (n * BLOCK_SIZE[n]) / 2;
  const walls = new Group();
  walls.name = WALLS_NAME;
  walls.userData.n = n;

  const top = createWall('wall-top', n);
  top.rotation.x = -Math.PI / 2; // local +Z -> +Y
  top.position.y = -half;

  const front = createWall('wall-front', n);
  front.position.z = -half;

  const side = createWall('wall-side', n);
  side.rotation.y = Math.PI / 2; // local +Z -> +X
  side.position.x = -half;

  walls.add(top, front, side);
  return walls;
}

/** The manifest prototype: an empty box for N (default 3). */
export function createGlassBox(n: BoxSize = 3): Group {
  const root = new Group();
  root.name = GLASS_BOX_NAME;
  root.userData.n = n;
  root.add(createWalls(n));
  return root;
}

/**
 * Rebuild a placed glass box for a new N. Replaces only the walls; any other
 * children (blocks, outlines added by later tickets) are left alone.
 * Geometry and materials are shared per N, so nothing is disposed here.
 */
export function setGlassBoxSize(box: Object3D, n: BoxSize): void {
  const old = box.getObjectByName(WALLS_NAME);
  if (old !== undefined && old.userData.n === n) return;
  if (old !== undefined) old.removeFromParent();
  box.add(createWalls(n));
  box.userData.n = n;
}

/** Current N of a placed glass box. */
export function getGlassBoxSize(box: Object3D): BoxSize {
  return (box.userData.n as BoxSize | undefined) ?? 3;
}

/** Centre of cell (x, y, z) in the box's local frame, written into `out`. */
export function cellCenter(
  n: BoxSize,
  x: number,
  y: number,
  z: number,
  out: Vector3,
): Vector3 {
  const b = BLOCK_SIZE[n];
  const start = (-n * b) / 2 + b / 2;
  return out.set(start + x * b, start + y * b, start + z * b);
}
