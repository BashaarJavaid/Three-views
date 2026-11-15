// Build interaction (T-03): taps add and remove blocks, the walls show the
// build's shadows, the box turns, undo/clear, solve detection. Every action is
// a RayInteractable click (hand ray + pinch in XR, mouse in a flat tab).
import {
  BoxGeometry,
  createSystem,
  EdgesGeometry,
  type Entity,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  PlaneGeometry,
  RayInteractable,
  type UIKit,
  type UIKitMLAsset,
  Vector3,
} from '@iwsdk/core';
import {
  cellIndex,
  isSolved,
  type Puzzle,
  type Shape,
  wallMatches,
} from '../game/logic.js';
import {
  BLOCK_SIZE,
  type BoxSize,
  cellCenter,
  setGlassBoxSize,
} from '../scene-assets/glass-box.scene-asset.js';
import { emit, type Mode, type Wall } from './events.js';
import {
  countMismatches,
  createOverlays,
  drawBuild,
  GhostMesh,
  type Overlays,
  setOverlayContrast,
  setTarget,
  WALLS,
} from './walls.js';

const TURN_MS = 250;
const POP_MS = 120;
const CLEAR_CONFIRM_MS = 3000;
/** T-07: build taps this soon after a start are ignored, so a double tap on Daily/Practice/Next adds no stray block. */
const START_GUARD_MS = 300;
/** Resting yaw about the box's local Y, so the side wall faces the seat too (DESIGN.md §4). */
export const REST_YAW = (-30 * Math.PI) / 180;

class NoRayLines extends LineSegments {
  override raycast(): void {}
}

const blockMat = new MeshStandardMaterial({ color: '#e9a25f', roughness: 0.55, metalness: 0 });
const edgeMat = new LineBasicMaterial({ color: '#5a3416' });
const ghostMat = new MeshBasicMaterial({
  color: '#ffd29a',
  transparent: true,
  opacity: 0.4,
  depthWrite: false,
});
// Invisible but hittable floor (Add mode only).
const floorMat = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
floorMat.colorWrite = false;

interface SizeKit {
  blocks: Mesh[]; // one per cell index, attached only while filled
  floor: Mesh;
  ghost: GhostMesh;
  overlays: Overlays;
}

let active: PlaySystem | null = null;

export class PlaySystem extends createSystem({}) {
  private box!: Object3D;
  private buildRoot!: Group;
  private kits = new Map<BoxSize, SizeKit>();
  private kit: SizeKit | null = null;
  private tmp = new Vector3();
  private tmp2 = new Vector3();

  private puzzle: Puzzle | null = null;
  private n: BoxSize = 3;
  private shape: Shape = new Uint8Array(27);
  private history: number[] = []; // index * 2 + (1 = was an add)
  private mode: Mode = 'add';
  private matched: Record<Wall, boolean> = { top: false, front: false, side: false };
  private solved = false;
  private startMs = 0;
  private endMs = 0;
  private quarterTurns = 0;
  private turnFrom = 0;
  private turnTo = 0;
  private turnStart = -1;
  private popStart = new Float64Array(64).fill(-1);
  private clearArmedAt = -1;
  private hint = -1;
  private highContrast = false;
  private shownSeconds = -1;
  private shownBlocks = -1;
  private textProps = { text: '' };

  private bar!: Entity;
  private readout!: Entity;
  private el: Record<string, UIKit.Text> = {};

  init(): void {
    const boxEntity = this.world.requireSceneEntity('glass-box');
    this.box = boxEntity.object3D!;
    this.buildRoot = new Group();
    this.buildRoot.name = 'play-build';
    const rootEntity = this.world.createTransformEntity(this.buildRoot, boxEntity);
    rootEntity.addComponent(RayInteractable);

    const onClick = (e: { object: Object3D; point: Vector3 }): void =>
      this.onBuildTap(e.object, e.point);
    this.buildRoot.addEventListener('click' as never, onClick as never);
    this.cleanupFuncs.push(() =>
      this.buildRoot.removeEventListener('click' as never, onClick as never),
    );

    this.bar = this.world.requireSceneEntity('play-controls');
    this.readout = this.world.requireSceneEntity('play-readout');
    const barPanel = this.world.requireSceneObject<UIKitMLAsset>('play-controls');
    const readPanel = this.world.requireSceneObject<UIKitMLAsset>('play-readout');
    barPanel.requireElementById('readout').setProperties({ display: 'none' });
    readPanel.requireElementById('bar').setProperties({ display: 'none' });
    for (const id of ['label-add', 'label-remove', 'label-clear', 'btn-add', 'btn-remove']) {
      this.el[id] = barPanel.requireElementById<UIKit.Text>(id);
    }
    this.el.blocks = readPanel.requireElementById<UIKit.Text>('readout-blocks');
    this.el.time = readPanel.requireElementById<UIKit.Text>('readout-time');

    const buttons: [string, () => void][] = [
      ['btn-add', () => this.setMode('add')],
      ['btn-remove', () => this.setMode('remove')],
      ['btn-left', () => this.turn(-1)],
      ['btn-right', () => this.turn(1)],
      ['btn-undo', () => this.undo()],
      ['btn-clear', () => this.clear()],
      ['btn-home', () => this.home()],
    ];
    for (const [id, fn] of buttons) {
      const button = barPanel.requireElementById(id);
      button.name = id;
      button.addEventListener('click', fn);
      this.cleanupFuncs.push(() => button.removeEventListener('click', fn));
    }

    this.showPanels(false);
    active = this;
    this.cleanupFuncs.push(() => {
      if (active === this) active = null;
    });
  }

  // ---- Play API -----------------------------------------------------------

  start(puzzle: Puzzle, start?: Shape, mode: Mode = 'add'): void {
    this.puzzle = puzzle;
    this.n = puzzle.n;
    setGlassBoxSize(this.box, this.n);
    if (this.kit !== null) this.detachKit(this.kit);
    this.kit = this.kitFor(this.n);
    this.box.add(this.kit.overlays.root);
    this.buildRoot.add(this.kit.ghost);
    setOverlayContrast(this.kit.overlays, this.highContrast);

    const cells = this.n ** 3;
    this.shape = new Uint8Array(cells);
    if (start !== undefined) this.shape.set(start.subarray(0, cells));
    for (let i = 0; i < cells; i++) this.setBlockAttached(i, this.shape[i] === 1, false);
    this.history = [];
    this.mode = mode;
    this.refreshMode();
    this.solved = false;
    this.clearArmedAt = -1;
    this.refreshClear();
    this.setHint(null);
    this.quarterTurns = 0;
    this.turnStart = -1;
    this.box.rotation.y = REST_YAW;
    this.startMs = performance.now();
    this.endMs = 0;
    setTarget(this.kit.overlays, puzzle.target);
    this.matched = wallMatches(this.n, this.shape, puzzle.target);
    drawBuild(this.kit.overlays, this.shape, puzzle.target, this.matched);
    this.shownSeconds = -1;
    this.shownBlocks = -1;
    this.showPanels(true);
    emit('puzzle-started', { puzzle });
  }

  stop(): void {
    this.puzzle = null;
    if (this.kit !== null) this.detachKit(this.kit);
    this.kit = null;
    this.box.rotation.y = REST_YAW;
    this.turnStart = -1;
    this.showPanels(false);
  }

  setHint(index: number | null): void {
    this.hint = index ?? -1;
    if (this.kit === null) return;
    const g = this.kit.ghost;
    g.visible = this.hint >= 0;
    if (this.hint >= 0) {
      const n = this.n;
      const i = this.hint;
      cellCenter(n, i % n, Math.floor(i / n) % n, Math.floor(i / (n * n)), g.position);
    }
    this.syncGhostHit();
  }

  /** The ghost intercepts rays only while a hint shows in Add mode. */
  private syncGhostHit(): void {
    if (this.kit === null) return;
    const g: Mesh = this.kit.ghost;
    g.raycast =
      this.hint >= 0 && this.mode === 'add' && this.shape[this.hint] !== 1
        ? Mesh.prototype.raycast
        : GhostMesh.prototype.raycast; // T-07: a filled hinted cell is tapped as a normal block
  }

  setHighContrast(on: boolean): void {
    this.highContrast = on;
    if (this.kit !== null) setOverlayContrast(this.kit.overlays, on);
  }

  // ---- Taps ---------------------------------------------------------------

  private get locked(): boolean {
    return this.puzzle === null || this.solved || this.turnStart >= 0;
  }

  private onBuildTap(object: Object3D, worldPoint: Vector3): void {
    if (this.locked || this.kit === null || performance.now() - this.startMs < START_GUARD_MS) return;
    const local = this.box.worldToLocal(this.tmp.copy(worldPoint));
    const n = this.n;
    const b = BLOCK_SIZE[n];
    if (object === this.kit.floor) {
      const half = (n * b) / 2;
      const x = Math.min(n - 1, Math.max(0, Math.floor((local.x + half) / b)));
      const z = Math.min(n - 1, Math.max(0, Math.floor((local.z + half) / b)));
      this.tapFloor(x, z);
      return;
    }
    if (object === this.kit.ghost) {
      // The hint ghost takes hits only in Add mode (syncGhostHit): add the hinted cell.
      const i = this.hint;
      if (i >= 0 && this.mode === 'add') this.tryAdd(i % n, Math.floor(i / n) % n, Math.floor(i / (n * n)));
      return;
    }
    const cell = object.userData.cell as number | undefined;
    if (cell === undefined) return;
    // Hit face = the largest component of (hit point - block centre), in the
    // box's own frame, so turning never mirrors placement.
    const c = cellCenter(n, cell % n, Math.floor(cell / n) % n, Math.floor(cell / (n * n)), this.tmp2);
    const dx = local.x - c.x;
    const dy = local.y - c.y;
    const dz = local.z - c.z;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const sign = (axis === 0 ? dx : axis === 1 ? dy : dz) >= 0 ? 1 : -1;
    this.tapBlock(cell, axis, sign);
  }

  /** Tap on floor square (x, z): place at y = 0 in Add mode. */
  tapFloor(x: number, z: number): void {
    if (this.locked || this.mode !== 'add') return;
    this.tryAdd(x, 0, z);
  }

  /** Tap on a block face (axis 0/1/2 = x/y/z, sign ±1). */
  tapBlock(cell: number, axis: number, sign: number): void {
    if (this.locked || this.shape[cell] !== 1) return;
    if (this.mode === 'remove') {
      this.change(cell, false, true);
      return;
    }
    const n = this.n;
    const p = [cell % n, Math.floor(cell / n) % n, Math.floor(cell / (n * n))];
    p[axis] += sign;
    this.tryAdd(p[0], p[1], p[2]);
  }

  private tryAdd(x: number, y: number, z: number): void {
    const n = this.n;
    if (x < 0 || y < 0 || z < 0 || x >= n || y >= n || z >= n) {
      emit('tap-rejected', {});
      return;
    }
    const i = cellIndex(n, x, y, z);
    if (this.shape[i] === 1) {
      emit('tap-rejected', {});
      return;
    }
    this.change(i, true, true);
  }

  private change(i: number, add: boolean, record: boolean): void {
    this.shape[i] = add ? 1 : 0;
    this.setBlockAttached(i, add, add);
    if (record) this.history.push(i * 2 + (add ? 1 : 0));
    emit(add ? 'block-added' : 'block-removed', { index: i });
    this.afterChange();
  }

  private afterChange(): void {
    const puzzle = this.puzzle!;
    const m = wallMatches(this.n, this.shape, puzzle.target);
    for (const w of WALLS) {
      if (m[w] !== this.matched[w]) emit(m[w] ? 'wall-matched' : 'wall-unmatched', { wall: w });
    }
    this.matched = m;
    this.syncGhostHit();
    drawBuild(this.kit!.overlays, this.shape, puzzle.target, m);
    if (!this.solved && isSolved(this.n, this.shape, puzzle.target)) {
      this.solved = true;
      this.endMs = performance.now();
      this.setHint(null);
      emit('solved', {
        seconds: Math.round((this.endMs - this.startMs) / 1000),
        blocks: this.blockCount(),
        par: puzzle.par,
      });
    }
  }

  // ---- Buttons ------------------------------------------------------------

  /**
   * Gate for control-bar taps. No puzzle or solved: nothing happens. During a
   * turn: `tap-rejected`. Otherwise the caller decides and calls `pressed()`.
   */
  private barOpen(): boolean {
    if (this.puzzle === null || this.solved) return false;
    if (this.turnStart >= 0) {
      emit('tap-rejected', {});
      return false;
    }
    return true;
  }

  private pressed(): void {
    emit('button-pressed', {});
  }

  private home(): void {
    this.pressed();
    emit('home-requested', {});
  }

  private setMode(mode: Mode): void {
    if (!this.barOpen()) return;
    this.pressed();
    if (mode === this.mode) return;
    this.mode = mode;
    this.refreshMode();
    emit('mode-changed', { mode });
  }

  private turn(dir: 1 | -1): void {
    if (!this.barOpen()) return;
    this.pressed();
    this.quarterTurns = (this.quarterTurns + dir + 4) % 4;
    this.turnFrom = this.box.rotation.y;
    this.turnTo = this.turnFrom + (dir * Math.PI) / 2;
    this.turnStart = performance.now();
    emit('box-turned', { quarterTurns: this.quarterTurns });
  }

  private undo(): void {
    if (!this.barOpen()) return;
    const last = this.history.pop();
    if (last === undefined) {
      emit('tap-rejected', {});
      return;
    }
    this.pressed();
    this.change(last >> 1, (last & 1) === 0, false);
  }

  private clear(): void {
    if (!this.barOpen()) return;
    this.pressed();
    const now = performance.now();
    if (this.clearArmedAt < 0 || now - this.clearArmedAt > CLEAR_CONFIRM_MS) {
      this.clearArmedAt = now;
      this.refreshClear();
      return;
    }
    this.clearArmedAt = -1;
    this.refreshClear();
    for (let i = 0; i < this.shape.length; i++) {
      if (this.shape[i] === 1) {
        this.shape[i] = 0;
        this.setBlockAttached(i, false, false);
      }
    }
    this.history = [];
    this.afterChange();
  }

  // ---- Frame --------------------------------------------------------------

  update(): void {
    if (this.puzzle === null || this.kit === null) return;
    const now = performance.now();

    if (this.turnStart >= 0) {
      const t = Math.min(1, (now - this.turnStart) / TURN_MS);
      const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.box.rotation.y = this.turnFrom + (this.turnTo - this.turnFrom) * e;
      if (t >= 1) this.turnStart = -1;
    }

    const blocks = this.kit.blocks;
    for (let i = 0; i < blocks.length; i++) {
      const s = this.popStart[i];
      if (s < 0) continue;
      const t = Math.min(1, (now - s) / POP_MS);
      blocks[i].scale.setScalar(0.6 + 0.4 * (1 - (1 - t) * (1 - t)));
      if (t >= 1) this.popStart[i] = -1;
    }

    if (this.hint >= 0) ghostMat.opacity = 0.3 + 0.25 * Math.sin(now / 160);

    if (this.clearArmedAt >= 0 && now - this.clearArmedAt > CLEAR_CONFIRM_MS) {
      this.clearArmedAt = -1;
      this.refreshClear();
    }

    // Readout: rewritten only when the second or the block count changes.
    const seconds = Math.floor(((this.solved ? this.endMs : now) - this.startMs) / 1000);
    const count = this.blockCount();
    if (seconds !== this.shownSeconds) {
      this.shownSeconds = seconds;
      this.textProps.text = formatTime(seconds);
      this.el.time.setProperties(this.textProps);
    }
    if (count !== this.shownBlocks) {
      this.shownBlocks = count;
      this.textProps.text = count === 1 ? '1 block' : `${count} blocks`;
      this.el.blocks.setProperties(this.textProps);
    }
  }

  // ---- Helpers ------------------------------------------------------------

  private blockCount(): number {
    let c = 0;
    for (let i = 0; i < this.shape.length; i++) c += this.shape[i];
    return c;
  }

  private setBlockAttached(i: number, on: boolean, pop: boolean): void {
    const mesh = this.kit!.blocks[i];
    if (on) {
      this.buildRoot.add(mesh);
      mesh.scale.setScalar(pop ? 0.6 : 1);
      this.popStart[i] = pop ? performance.now() : -1;
    } else {
      this.buildRoot.remove(mesh);
      this.popStart[i] = -1;
    }
  }

  private refreshMode(): void {
    const on = { borderRadius: 10, borderWidth: 4, borderColor: '#ffffff', backgroundColor: '#3f8fd8' };
    const off = { borderRadius: 42, borderWidth: 0, backgroundColor: undefined };
    this.el['btn-add'].setProperties(this.mode === 'add' ? on : off);
    this.el['btn-remove'].setProperties(this.mode === 'remove' ? on : off);
    this.el['label-add'].setProperties({ text: this.mode === 'add' ? 'Adding' : 'Add' });
    this.el['label-remove'].setProperties({
      text: this.mode === 'remove' ? 'Removing' : 'Remove',
    });
    if (this.kit !== null) {
      if (this.mode === 'add') this.buildRoot.add(this.kit.floor);
      else this.buildRoot.remove(this.kit.floor);
    }
    this.syncGhostHit();
  }

  private refreshClear(): void {
    this.el['label-clear'].setProperties({ text: this.clearArmedAt >= 0 ? 'Sure?' : 'Clear' });
  }

  /** Control bar and readout; also used by flow's result card (`setControlsVisible`). */
  showPanels(on: boolean): void {
    for (const e of [this.bar, this.readout]) e.object3D!.visible = on;
    if (on && !this.bar.hasComponent(RayInteractable)) this.bar.addComponent(RayInteractable);
    if (!on && this.bar.hasComponent(RayInteractable)) this.bar.removeComponent(RayInteractable);
  }

  private detachKit(kit: SizeKit): void {
    kit.overlays.root.removeFromParent();
    kit.ghost.removeFromParent();
    kit.floor.removeFromParent();
    for (const b of kit.blocks) b.removeFromParent();
  }

  private kitFor(n: BoxSize): SizeKit {
    let kit = this.kits.get(n);
    if (kit !== undefined) return kit;
    const b = BLOCK_SIZE[n];
    const cube = new BoxGeometry(b, b, b);
    const edges = new EdgesGeometry(cube);
    const blocks: Mesh[] = [];
    const p = new Vector3();
    for (let i = 0; i < n * n * n; i++) {
      const m = new Mesh(cube, blockMat);
      m.name = `block-${i}`;
      m.userData.cell = i;
      cellCenter(n, i % n, Math.floor(i / n) % n, Math.floor(i / (n * n)), p);
      m.position.copy(p);
      m.add(new NoRayLines(edges, edgeMat));
      blocks.push(m);
    }
    const floorGeo = new PlaneGeometry(n * b, n * b);
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new Mesh(floorGeo, floorMat);
    floor.name = 'play-floor';
    floor.position.y = (-n * b) / 2 + 0.001;
    const ghost = new GhostMesh(new BoxGeometry(b * 0.98, b * 0.98, b * 0.98), ghostMat);
    ghost.name = 'play-hint';
    ghost.visible = false;
    kit = { blocks, floor, ghost, overlays: createOverlays(n) };
    this.kits.set(n, kit);
    return kit;
  }

  // ---- Dev checks (used through window.__threeViews) ----------------------

  debugState(): {
    n: number;
    mode: Mode;
    blocks: number;
    solved: boolean;
    quarterTurns: number;
    cells: number[];
    matched: Record<Wall, boolean>;
  } {
    const cells: number[] = [];
    for (let i = 0; i < this.shape.length; i++) if (this.shape[i]) cells.push(i);
    return {
      n: this.n,
      mode: this.mode,
      blocks: cells.length,
      solved: this.solved,
      quarterTurns: this.quarterTurns,
      cells,
      matched: { ...this.matched },
    };
  }

  /** 200 random add/remove taps; compares drawn walls with project(build) after each. */
  debugShadowCheck(taps = 200, seed = 7): string {
    if (this.puzzle === null || this.kit === null) return 'no puzzle';
    let s = seed >>> 0;
    const rand = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const n = this.n;
    let mismatches = 0;
    let adds = 0;
    let removes = 0;
    let rejects = 0;
    let checks = 0;
    for (let k = 0; k < taps; k++) {
      if (this.solved) this.solved = false; // keep tapping through accidental solves
      const filled: number[] = [];
      for (let i = 0; i < this.shape.length; i++) if (this.shape[i]) filled.push(i);
      const before = this.blockCount();
      if (filled.length > 0 && rand() < 0.4) {
        this.mode = 'remove';
        this.tapBlock(filled[Math.floor(rand() * filled.length)], 0, 1);
      } else {
        this.mode = 'add';
        if (filled.length === 0 || rand() < 0.3) {
          this.tapFloor(Math.floor(rand() * n), Math.floor(rand() * n));
        } else {
          const axis = Math.floor(rand() * 3);
          this.tapBlock(filled[Math.floor(rand() * filled.length)], axis, rand() < 0.5 ? -1 : 1);
        }
      }
      const after = this.blockCount();
      if (after > before) adds++;
      else if (after < before) removes++;
      else rejects++;
      mismatches += countMismatches(this.kit.overlays, this.shape, this.puzzle.target, this.matched);
      checks++;
    }
    this.mode = 'add';
    this.refreshMode();
    return `shadow check: ${checks} taps (${adds} adds, ${removes} removes, ${rejects} rejected), ${mismatches} mismatches`;
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ---- Play API (DESIGN.md §8) ----------------------------------------------

export function startPuzzle(puzzle: Puzzle, start?: Shape, mode?: Mode): void {
  active?.start(puzzle, start, mode);
}
export function stopPuzzle(): void {
  active?.stop();
}
export function setHint(index: number | null): void {
  active?.setHint(index);
}
export function setHighContrast(on: boolean): void {
  active?.setHighContrast(on);
}
/** Hide or show the control bar and readout; the box and build stay as they are. */
export function setControlsVisible(on: boolean): void {
  active?.showPanels(on);
}
/** Dev only: the live play system, for emulator checks. */
export function playDebug(): PlaySystem | null {
  return active;
}
