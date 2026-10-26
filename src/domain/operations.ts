/**
 * 场景原子操作：放置/删除/移动对象。
 *
 * 每个操作返回新场景（不可变更新）或 null（非法操作不破坏原状态）。
 * 操作只做局部结构校验（越界、重叠），完整业务校验由 validateScene 负责。
 *
 * 纯函数，不依赖 React/Canvas。
 */
import type { Scene, GridPos, Booth, Portal } from './types';
import {
  posEqual,
  inBounds,
  isOnBoundary,
  ORTHO_DIRS,
} from './geometry';
import {
  MIN_SERVICE_TICKS,
  MAX_SERVICE_TICKS,
  DEFAULT_QUEUE_K,
  DEFAULT_SERVICE_TICKS_MIN,
  DEFAULT_SERVICE_TICKS_MAX,
} from './constants';

/** 格子种类 */
export type CellKind =
  | 'empty'
  | 'obstacle'
  | 'entrance'
  | 'exit'
  | 'booth-footprint'
  | 'booth-service'
  | 'booth-queue';

/** 格子信息 */
export interface CellInfo {
  kind: CellKind;
  boothId?: string;
  queueIndex?: number;
  portalId?: string;
}

/** 查询某格被什么占用 */
export function cellAt(scene: Scene, pos: GridPos): CellInfo {
  if (scene.obstacles.some((o) => posEqual(o, pos))) return { kind: 'obstacle' };
  const ent = scene.entrances.find((e) => posEqual(e.pos, pos));
  if (ent) return { kind: 'entrance', portalId: ent.id };
  const ex = scene.exits.find((e) => posEqual(e.pos, pos));
  if (ex) return { kind: 'exit', portalId: ex.id };
  for (const b of scene.booths) {
    if (posEqual(b.footprint, pos)) return { kind: 'booth-footprint', boothId: b.id };
    if (posEqual(b.serviceCell, pos)) return { kind: 'booth-service', boothId: b.id };
    for (let i = 0; i < b.queueCells.length; i++) {
      if (posEqual(b.queueCells[i], pos)) return { kind: 'booth-queue', boothId: b.id, queueIndex: i };
    }
  }
  return { kind: 'empty' };
}

/** 判断格子是否可放置新对象（空且在界内） */
export function canPlaceAt(scene: Scene, pos: GridPos): boolean {
  if (!inBounds(pos, scene.width, scene.height)) return false;
  return cellAt(scene, pos).kind === 'empty';
}

/** 生成下一个不冲突的展位 ID */
export function nextBoothId(scene: Scene): string {
  const used = new Set(scene.booths.map((b) => b.id));
  let n = 1;
  while (used.has(`booth-${n}`)) n++;
  return `booth-${n}`;
}

/** 生成下一个不冲突的入口 ID */
export function nextEntranceId(scene: Scene): string {
  const used = new Set(scene.entrances.map((e) => e.id));
  let n = 1;
  while (used.has(`entrance-${n}`)) n++;
  return `entrance-${n}`;
}

/** 生成下一个不冲突的出口 ID */
export function nextExitId(scene: Scene): string {
  const used = new Set(scene.exits.map((e) => e.id));
  let n = 1;
  while (used.has(`exit-${n}`)) n++;
  return `exit-${n}`;
}

/**
 * 尝试为展位实体生成默认服务格和队列格。
 * 按四个正交方向依次尝试，选择第一个能完整放下服务格 + K 个队列格的方向。
 * 队列沿服务格起的同一直线向外延伸。
 */
export function tryGenerateBoothCells(
  scene: Scene,
  footprint: GridPos,
  K: number,
): { serviceCell: GridPos; queueCells: GridPos[] } | null {
  for (const d of ORTHO_DIRS) {
    const serviceCell = { x: footprint.x + d.x, y: footprint.y + d.y };
    if (!canPlaceAt(scene, serviceCell)) continue;
    const queueCells: GridPos[] = [];
    let ok = true;
    // 临时占用 serviceCell 以检查队列格不与之重叠
    const tempScene: Scene = { ...scene, booths: [...scene.booths] };
    // 用 canPlaceAt 检查队列格，但需排除已规划的 serviceCell/queueCells
    const reserved = new Set<string>([`${serviceCell.x},${serviceCell.y}`]);
    for (let i = 1; i <= K; i++) {
      const q = { x: serviceCell.x + d.x * i, y: serviceCell.y + d.y * i };
      const k = `${q.x},${q.y}`;
      if (!inBounds(q, tempScene.width, tempScene.height) || !canPlaceAt(tempScene, q) || reserved.has(k)) {
        ok = false;
        break;
      }
      queueCells.push(q);
      reserved.add(k);
    }
    if (ok && queueCells.length === K) {
      return { serviceCell, queueCells };
    }
  }
  return null;
}

/** 放置障碍 */
export function addObstacle(scene: Scene, pos: GridPos): Scene | null {
  if (!canPlaceAt(scene, pos)) return null;
  return { ...scene, obstacles: [...scene.obstacles, pos] };
}

/** 放置入口（必须在边界） */
export function addEntrance(scene: Scene, pos: GridPos): Scene | null {
  if (!canPlaceAt(scene, pos)) return null;
  if (!isOnBoundary(pos, scene.width, scene.height)) return null;
  const id = nextEntranceId(scene);
  const portal: Portal = { id, pos };
  return { ...scene, entrances: [...scene.entrances, portal] };
}

/** 放置出口（必须在边界） */
export function addExit(scene: Scene, pos: GridPos): Scene | null {
  if (!canPlaceAt(scene, pos)) return null;
  if (!isOnBoundary(pos, scene.width, scene.height)) return null;
  const id = nextExitId(scene);
  const portal: Portal = { id, pos };
  return { ...scene, exits: [...scene.exits, portal] };
}

/** 放置展位（自动生成服务格和队列格） */
export function addBooth(scene: Scene, footprint: GridPos, K = DEFAULT_QUEUE_K): Scene | null {
  if (!canPlaceAt(scene, footprint)) return null;
  const cells = tryGenerateBoothCells(scene, footprint, K);
  if (!cells) return null;
  const id = nextBoothId(scene);
  const booth: Booth = {
    id,
    footprint,
    serviceCell: cells.serviceCell,
    queueCells: cells.queueCells,
    serviceTicksMin: DEFAULT_SERVICE_TICKS_MIN,
    serviceTicksMax: DEFAULT_SERVICE_TICKS_MAX,
  };
  return { ...scene, booths: [...scene.booths, booth] };
}

/** 删除展位（连带移除服务格和队列格） */
export function removeBooth(scene: Scene, id: string): Scene | null {
  if (!scene.booths.some((b) => b.id === id)) return null;
  return { ...scene, booths: scene.booths.filter((b) => b.id !== id) };
}

/**
 * 擦除格子：移除障碍/入口/出口，或移除整个展位包（点击实体/服务格/队列格均可）。
 * 空格返回 null（无操作）。
 */
export function eraseAt(scene: Scene, pos: GridPos): Scene | null {
  const info = cellAt(scene, pos);
  switch (info.kind) {
    case 'obstacle':
      return { ...scene, obstacles: scene.obstacles.filter((o) => !posEqual(o, pos)) };
    case 'entrance':
      return { ...scene, entrances: scene.entrances.filter((e) => e.id !== info.portalId) };
    case 'exit':
      return { ...scene, exits: scene.exits.filter((e) => e.id !== info.portalId) };
    case 'booth-footprint':
    case 'booth-service':
    case 'booth-queue':
      return removeBooth(scene, info.boothId!);
    default:
      return null;
  }
}

/**
 * 移动展位：整体平移到新实体位置，保持服务格/队列格相对偏移不变。
 * 检查新位置不越界、不与其他对象（排除自身）冲突。
 */
export function moveBooth(scene: Scene, id: string, newFootprint: GridPos): Scene | null {
  const booth = scene.booths.find((b) => b.id === id);
  if (!booth) return null;
  if (!inBounds(newFootprint, scene.width, scene.height)) return null;

  const dx = newFootprint.x - booth.footprint.x;
  const dy = newFootprint.y - booth.footprint.y;
  const newServiceCell = { x: booth.serviceCell.x + dx, y: booth.serviceCell.y + dy };
  const newQueueCells = booth.queueCells.map((q) => ({ x: q.x + dx, y: q.y + dy }));

  // 全部位置必须在界内
  if (!inBounds(newServiceCell, scene.width, scene.height)) return null;
  for (const q of newQueueCells) {
    if (!inBounds(q, scene.width, scene.height)) return null;
  }

  // 排除自身后检查不与其他对象冲突
  const others: Scene = { ...scene, booths: scene.booths.filter((b) => b.id !== id) };
  if (!canPlaceAt(others, newFootprint)) return null;
  if (!canPlaceAt(others, newServiceCell)) return null;
  for (const q of newQueueCells) {
    if (!canPlaceAt(others, q)) return null;
  }
  // 队列格之间、与服务格、与实体不能互相重叠（平移保持原结构，只需检查目标位置互不重叠）
  const targetKeys = new Set<string>();
  for (const p of [newFootprint, newServiceCell, ...newQueueCells]) {
    const k = `${p.x},${p.y}`;
    if (targetKeys.has(k)) return null;
    targetKeys.add(k);
  }

  const newBooth: Booth = {
    ...booth,
    footprint: newFootprint,
    serviceCell: newServiceCell,
    queueCells: newQueueCells,
  };
  return { ...scene, booths: [...others.booths, newBooth] };
}

/** 更新展位服务时长参数 */
export function updateBoothService(
  scene: Scene,
  id: string,
  min: number,
  max: number,
): Scene | null {
  const booth = scene.booths.find((b) => b.id === id);
  if (!booth) return null;
  if (!Number.isInteger(min) || min < MIN_SERVICE_TICKS || min > MAX_SERVICE_TICKS) return null;
  if (!Number.isInteger(max) || max < MIN_SERVICE_TICKS || max > MAX_SERVICE_TICKS) return null;
  if (min > max) return null;
  const newBooth: Booth = { ...booth, serviceTicksMin: min, serviceTicksMax: max };
  return { ...scene, booths: scene.booths.map((b) => (b.id === id ? newBooth : b)) };
}

/** 更新展位队列长度（重新生成队列格，保持方向） */
export function updateBoothQueueLength(scene: Scene, id: string, newK: number): Scene | null {
  const booth = scene.booths.find((b) => b.id === id);
  if (!booth) return null;
  if (!Number.isInteger(newK) || newK < 1 || newK > 8) return null;
  // 计算队列方向（从 serviceCell 到 queueCells[0]）
  if (booth.queueCells.length === 0) return null;
  const dir = {
    x: Math.sign(booth.queueCells[0].x - booth.serviceCell.x),
    y: Math.sign(booth.queueCells[0].y - booth.serviceCell.y),
  };
  if (Math.abs(dir.x) + Math.abs(dir.y) !== 1) return null;

  const newQueueCells: GridPos[] = [];
  const others: Scene = { ...scene, booths: scene.booths.filter((b) => b.id !== id) };
  const reserved = new Set<string>([`${booth.footprint.x},${booth.footprint.y}`, `${booth.serviceCell.x},${booth.serviceCell.y}`]);
  for (let i = 1; i <= newK; i++) {
    const q = { x: booth.serviceCell.x + dir.x * i, y: booth.serviceCell.y + dir.y * i };
    const k = `${q.x},${q.y}`;
    if (!inBounds(q, scene.width, scene.height) || !canPlaceAt(others, q) || reserved.has(k)) return null;
    newQueueCells.push(q);
    reserved.add(k);
  }
  const newBooth: Booth = { ...booth, queueCells: newQueueCells };
  return { ...scene, booths: [...others.booths, newBooth] };
}
