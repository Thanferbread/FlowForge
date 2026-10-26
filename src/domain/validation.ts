/**
 * 场景校验：分为结构校验（error 级别，原子拒绝）和业务校验（warning 级别，可达性）。
 *
 * 结构校验：宽高、坐标整数有限、边界、ID 唯一、对象不重叠、队列连续共线、
 *   服务格与实体相邻、队列首格与服务格相邻、服务时长范围。
 * 业务校验（BFS）：入口可达出口、展位队尾可从入口到达、服务格可到出口。
 *
 * 纯函数，不依赖 React/Canvas。
 */
import type { Scene, ValidationIssue, ValidationResult, SceneCounts, GridPos } from './types';
import { SCHEMA_VERSION } from './types';
import {
  MIN_WIDTH,
  MAX_WIDTH,
  MIN_HEIGHT,
  MAX_HEIGHT,
  MIN_QUEUE_K,
  MAX_QUEUE_K,
  MIN_SERVICE_TICKS,
  MAX_SERVICE_TICKS,
} from './constants';
import { posKey, inBounds, isOnBoundary, areAdjacent, isStraightLine, ORTHO_DIRS } from './geometry';

/** 判断数值是否为有限整数 */
function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}

/**
 * 结构校验：返回所有结构问题（severity 全为 error）。
 * 出现结构错误时场景不可序列化、不可用于仿真。
 */
export function validateStructure(scene: Scene): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // schemaVersion
  if (scene.schemaVersion !== SCHEMA_VERSION) {
    issues.push({
      severity: 'error',
      code: 'SCHEMA_VERSION',
      message: `schemaVersion 必须为 ${SCHEMA_VERSION}，当前为 ${scene.schemaVersion}`,
    });
  }

  // 宽高
  if (!isInt(scene.width) || scene.width < MIN_WIDTH || scene.width > MAX_WIDTH) {
    issues.push({
      severity: 'error',
      code: 'WIDTH',
      message: `宽度必须为 ${MIN_WIDTH}–${MAX_WIDTH} 的整数，当前为 ${scene.width}`,
    });
  }
  if (!isInt(scene.height) || scene.height < MIN_HEIGHT || scene.height > MAX_HEIGHT) {
    issues.push({
      severity: 'error',
      code: 'HEIGHT',
      message: `高度必须为 ${MIN_HEIGHT}–${MAX_HEIGHT} 的整数，当前为 ${scene.height}`,
    });
  }

  // 宽高非法时后续校验无意义（越界检查会误报）
  if (issues.some((i) => i.code === 'WIDTH' || i.code === 'HEIGHT')) {
    return issues;
  }

  const w = scene.width;
  const h = scene.height;

  // 已占用格子表：key -> 描述
  const occupied = new Map<string, string>();
  const markOccupied = (p: GridPos, desc: string): boolean => {
    const k = posKey(p);
    if (occupied.has(k)) {
      issues.push({
        severity: 'error',
        code: 'OVERLAP',
        message: `${desc} 与 ${occupied.get(k)} 重叠于 (${p.x},${p.y})`,
        pos: p,
      });
      return false;
    }
    occupied.set(k, desc);
    return true;
  };

  // ID 唯一性集合
  const allIds = new Set<string>();
  const checkId = (id: unknown, ctx: string): id is string => {
    if (typeof id !== 'string' || id.length === 0) {
      issues.push({ severity: 'error', code: 'ID_INVALID', message: `${ctx} ID 必须为非空字符串` });
      return false;
    }
    if (allIds.has(id)) {
      issues.push({ severity: 'error', code: 'ID_DUPLICATE', message: `${ctx} ID 重复：${id}` });
      return false;
    }
    allIds.add(id);
    return true;
  };

  // 坐标校验
  const checkPos = (p: unknown, ctx: string): p is GridPos => {
    if (typeof p !== 'object' || p === null) {
      issues.push({ severity: 'error', code: 'POS_INVALID', message: `${ctx} 必须为对象` });
      return false;
    }
    const obj = p as Record<string, unknown>;
    if (!isInt(obj.x) || !isInt(obj.y)) {
      issues.push({
        severity: 'error',
        code: 'COORD_NOT_INT',
        message: `${ctx} 坐标必须为有限整数`,
        pos: { x: Number(obj.x) || 0, y: Number(obj.y) || 0 },
      });
      return false;
    }
    const gp = obj as unknown as GridPos;
    if (!inBounds(gp, w, h)) {
      issues.push({
        severity: 'error',
        code: 'OUT_OF_BOUNDS',
        message: `${ctx} 越界 (${gp.x},${gp.y})，地图范围 ${w}×${h}`,
        pos: gp,
      });
      return false;
    }
    return true;
  };

  // 障碍
  if (!Array.isArray(scene.obstacles)) {
    issues.push({ severity: 'error', code: 'OBSTACLES_NOT_ARRAY', message: 'obstacles 必须为数组' });
    return issues;
  }
  scene.obstacles.forEach((o, i) => {
    if (checkPos(o, `障碍[${i}]`)) markOccupied(o, `障碍[${i}]`);
  });

  // 入口
  if (!Array.isArray(scene.entrances)) {
    issues.push({ severity: 'error', code: 'ENTRANCES_NOT_ARRAY', message: 'entrances 必须为数组' });
    return issues;
  }
  scene.entrances.forEach((e) => {
    const idOk = checkId(e.id, '入口');
    if (!checkPos(e.pos, `入口 ${e.id}`)) return;
    if (!isOnBoundary(e.pos, w, h)) {
      issues.push({
        severity: 'error',
        code: 'ENTRANCE_NOT_BOUNDARY',
        message: `入口 ${e.id} 必须位于地图边界`,
        pos: e.pos,
      });
    }
    markOccupied(e.pos, `入口${idOk ? ' ' + e.id : ''}`);
  });

  // 出口
  if (!Array.isArray(scene.exits)) {
    issues.push({ severity: 'error', code: 'EXITS_NOT_ARRAY', message: 'exits 必须为数组' });
    return issues;
  }
  scene.exits.forEach((e) => {
    const idOk = checkId(e.id, '出口');
    if (!checkPos(e.pos, `出口 ${e.id}`)) return;
    if (!isOnBoundary(e.pos, w, h)) {
      issues.push({
        severity: 'error',
        code: 'EXIT_NOT_BOUNDARY',
        message: `出口 ${e.id} 必须位于地图边界`,
        pos: e.pos,
      });
    }
    markOccupied(e.pos, `出口${idOk ? ' ' + e.id : ''}`);
  });

  // 展位
  if (!Array.isArray(scene.booths)) {
    issues.push({ severity: 'error', code: 'BOOTHS_NOT_ARRAY', message: 'booths 必须为数组' });
    return issues;
  }
  scene.booths.forEach((b) => {
    const idOk = checkId(b.id, '展位');
    const label = idOk ? `展位 ${b.id}` : '展位';

    // 实体占格
    if (checkPos(b.footprint, `${label} 实体`)) markOccupied(b.footprint, `${label}实体`);

    // 服务格
    if (checkPos(b.serviceCell, `${label} 服务格`)) markOccupied(b.serviceCell, `${label}服务格`);

    // 队列格
    if (!Array.isArray(b.queueCells)) {
      issues.push({ severity: 'error', code: 'QUEUE_NOT_ARRAY', message: `${label} queueCells 必须为数组` });
      return;
    }
    const kLen = b.queueCells.length;
    if (kLen < MIN_QUEUE_K || kLen > MAX_QUEUE_K) {
      issues.push({
        severity: 'error',
        code: 'QUEUE_LEN',
        message: `${label} 队列长度必须为 ${MIN_QUEUE_K}–${MAX_QUEUE_K}，当前为 ${kLen}`,
      });
    }
    b.queueCells.forEach((q, i) => {
      if (checkPos(q, `${label} 队列格[${i}]`)) markOccupied(q, `${label}队列格[${i}]`);
    });

    // 服务格必须与实体相邻
    if (checkPos(b.footprint, '') && checkPos(b.serviceCell, '')) {
      if (!areAdjacent(b.serviceCell, b.footprint)) {
        issues.push({
          severity: 'error',
          code: 'SERVICE_NOT_ADJACENT',
          message: `${label} 服务格必须与实体正交相邻`,
          pos: b.serviceCell,
        });
      }
    }

    // 队列首格必须与服务格相邻
    if (kLen > 0 && checkPos(b.serviceCell, '') && checkPos(b.queueCells[0], '')) {
      if (!areAdjacent(b.queueCells[0], b.serviceCell)) {
        issues.push({
          severity: 'error',
          code: 'QUEUE_NOT_ADJACENT',
          message: `${label} 队列首格 q1 必须与服务格 q0 相邻`,
          pos: b.queueCells[0],
        });
      }
    }

    // 服务格 q0 与队列 q1…qK 必须沿同一直线连续，不能在 q0→q1 后拐弯。
    if (kLen >= 1 && checkPos(b.serviceCell, '') && b.queueCells.every((q) => checkPos(q, '')) &&
      !isStraightLine([b.serviceCell, ...b.queueCells])) {
      issues.push({
        severity: 'error',
        code: 'QUEUE_NOT_LINEAR',
        message: `${label} 服务格与队列格必须沿同一直线连续相邻`,
      });
    }

    // 服务时长
    if (!isInt(b.serviceTicksMin) || b.serviceTicksMin < MIN_SERVICE_TICKS || b.serviceTicksMin > MAX_SERVICE_TICKS) {
      issues.push({
        severity: 'error',
        code: 'SERVICE_MIN',
        message: `${label} 服务时长下限必须为 ${MIN_SERVICE_TICKS}–${MAX_SERVICE_TICKS} 的整数`,
      });
    }
    if (!isInt(b.serviceTicksMax) || b.serviceTicksMax < MIN_SERVICE_TICKS || b.serviceTicksMax > MAX_SERVICE_TICKS) {
      issues.push({
        severity: 'error',
        code: 'SERVICE_MAX',
        message: `${label} 服务时长上限必须为 ${MIN_SERVICE_TICKS}–${MAX_SERVICE_TICKS} 的整数`,
      });
    }
    if (isInt(b.serviceTicksMin) && isInt(b.serviceTicksMax) && b.serviceTicksMin > b.serviceTicksMax) {
      issues.push({
        severity: 'error',
        code: 'SERVICE_RANGE',
        message: `${label} 服务时长下限不能大于上限`,
      });
    }
  });

  return issues;
}

/** 构建普通地面格集合（可公共通行的格子） */
function buildWalkableSet(scene: Scene): Set<string> {
  const blocked = new Set<string>();
  for (const o of scene.obstacles) blocked.add(posKey(o));
  for (const b of scene.booths) {
    blocked.add(posKey(b.footprint));
    blocked.add(posKey(b.serviceCell));
    for (const q of b.queueCells) blocked.add(posKey(q));
  }
  const walkable = new Set<string>();
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const k = `${x},${y}`;
      if (!blocked.has(k)) walkable.add(k);
    }
  }
  return walkable;
}

/** BFS：从起点集合出发，返回可达的普通地面格键集合 */
function bfsReachable(starts: GridPos[], walkable: Set<string>, w: number, h: number): Set<string> {
  const visited = new Set<string>();
  const queue: GridPos[] = [];
  for (const s of starts) {
    const k = posKey(s);
    if (walkable.has(k) && !visited.has(k)) {
      visited.add(k);
      queue.push(s);
    }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const d of ORTHO_DIRS) {
      const nx = cur.x + d.x;
      const ny = cur.y + d.y;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const k = `${nx},${ny}`;
      if (walkable.has(k) && !visited.has(k)) {
        visited.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return visited;
}

/** 获取格子的普通地面邻居 */
function walkableNeighbors(p: GridPos, walkable: Set<string>, w: number, h: number): GridPos[] {
  const result: GridPos[] = [];
  for (const d of ORTHO_DIRS) {
    const nx = p.x + d.x;
    const ny = p.y + d.y;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
    if (walkable.has(`${nx},${ny}`)) result.push({ x: nx, y: ny });
  }
  return result;
}

/**
 * 业务校验（可达性）：返回所有业务问题（severity 全为 warning）。
 * 仅在结构校验通过后调用。
 */
export function validateBusiness(scene: Scene): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (scene.entrances.length === 0) {
    issues.push({ severity: 'warning', code: 'NO_ENTRANCE', message: '场景缺少入口' });
  }
  if (scene.exits.length === 0) {
    issues.push({ severity: 'warning', code: 'NO_EXIT', message: '场景缺少出口' });
  }
  if (scene.booths.length === 0) {
    issues.push({ severity: 'warning', code: 'NO_BOOTH', message: '场景缺少展位' });
  }

  // 缺少必要元素时无法做可达性校验
  if (scene.entrances.length === 0 || scene.exits.length === 0 || scene.booths.length === 0) {
    return issues;
  }

  const walkable = buildWalkableSet(scene);
  const w = scene.width;
  const h = scene.height;

  // 从所有出口 BFS（无向图，等价于"能到达出口"的格子集合）
  const canReachExit = bfsReachable(
    scene.exits.map((e) => e.pos),
    walkable,
    w,
    h,
  );

  // 1. 每个入口可到达至少一个出口
  for (const e of scene.entrances) {
    const reach = bfsReachable([e.pos], walkable, w, h);
    const reached = scene.exits.some((ex) => reach.has(posKey(ex.pos)));
    if (!reached) {
      issues.push({
        severity: 'warning',
        code: 'ENTRANCE_NO_EXIT',
        message: `入口 ${e.id} 无法通过普通地面到达任何出口`,
        pos: e.pos,
      });
    }
  }

  // 2. 每个展位队尾 qK 有相邻普通地面格可从每个入口到达（逐入口独立 BFS）
  //    某入口无法到达某展位队尾时产出 QUEUE_TAIL_UNREACHABLE_FROM_ENTRANCE
  for (const b of scene.booths) {
    const qK = b.queueCells[b.queueCells.length - 1];
    const neighbors = walkableNeighbors(qK, walkable, w, h);
    if (neighbors.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'QUEUE_TAIL_ISOLATED',
        message: `展位 ${b.id} 队尾 q${b.queueCells.length} 无相邻普通地面格，行人无法入队`,
        pos: qK,
      });
      continue;
    }
    // 对每个入口单独 BFS，检查该入口能否到达队尾的某个相邻普通地面格
    for (const ent of scene.entrances) {
      const reach = bfsReachable([ent.pos], walkable, w, h);
      const reachable = neighbors.some((n) => reach.has(posKey(n)));
      if (!reachable) {
        issues.push({
          severity: 'warning',
          code: 'QUEUE_TAIL_UNREACHABLE_FROM_ENTRANCE',
          message: `展位 ${b.id} 队尾无法从入口 ${ent.id} 到达`,
          pos: qK,
        });
      }
    }
  }

  // 3. 每个展位服务格 q0 有相邻普通地面格可到出口
  for (const b of scene.booths) {
    const neighbors = walkableNeighbors(b.serviceCell, walkable, w, h);
    if (neighbors.length === 0) {
      issues.push({
        severity: 'warning',
        code: 'SERVICE_NO_EXIT',
        message: `展位 ${b.id} 服务格 q0 无相邻普通地面格，服务后无法离开`,
        pos: b.serviceCell,
      });
    } else {
      const canExit = neighbors.some((n) => canReachExit.has(posKey(n)));
      if (!canExit) {
        issues.push({
          severity: 'warning',
          code: 'SERVICE_NO_EXIT',
          message: `展位 ${b.id} 服务格离开后无法到达任何出口`,
          pos: b.serviceCell,
        });
      }
    }
  }

  return issues;
}

/** 计算场景真实计数统计 */
function computeCounts(scene: Scene): SceneCounts {
  const totalCells = Number.isInteger(scene.width) && Number.isInteger(scene.height) ? scene.width * scene.height : 0;
  let walkableCells = 0;
  if (totalCells > 0) {
    const walkable = buildWalkableSet(scene);
    walkableCells = walkable.size;
  }
  return {
    boothCount: scene.booths.length,
    obstacleCount: scene.obstacles.length,
    entranceCount: scene.entrances.length,
    exitCount: scene.exits.length,
    totalCells,
    walkableCells,
  };
}

/**
 * 完整校验：先结构后业务。
 * - ok：结构合法（无 error）
 * - readyForSimulation：结构合法且业务校验全通过（无 warning）
 * - status：structural_error / draft / ready
 * - counts：场景真实计数（结构错误时仍填充）
 */
export function validateScene(scene: Scene): ValidationResult {
  const counts = computeCounts(scene);
  const structIssues = validateStructure(scene);
  const hasError = structIssues.some((i) => i.severity === 'error');

  if (hasError) {
    return { ok: false, readyForSimulation: false, issues: structIssues, status: 'structural_error', counts };
  }

  const bizIssues = validateBusiness(scene);
  const ready = bizIssues.length === 0;
  return {
    ok: true,
    readyForSimulation: ready,
    issues: [...structIssues, ...bizIssues],
    status: ready ? 'ready' : 'draft',
    counts,
  };
}
