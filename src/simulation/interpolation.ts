/**
 * 纯显示插值模块：在相邻格心间线性插值人员显示坐标。
 *
 * 不修改引擎状态、快照或报告。不依赖 DOM/Canvas/React。
 * 仅对同一 ID、正交相邻（|dx|+|dy|===1）的有效位置插值；
 * 非相邻、新入、离场或状态不一致时安全对齐到当前位置。
 */
import type { GridPos } from '../domain/types';
import type { AgentView } from './types';

/** 显示坐标（小数允许，仅用于绘制） */
export interface DisplayPos {
  x: number;
  y: number;
}

/** 人员显示状态（独立于 AgentView，含小数坐标） */
export interface AgentDisplay {
  id: string;
  displayPos: DisplayPos;
  state: AgentView['state'];
  remainingService: number | null;
}

/** 夹紧进度到 [0, 1] */
export function clampProgress(progress: number): number {
  // Invalid presentation clocks must never send NaN coordinates to Canvas.
  if (Number.isNaN(progress)) return 1;
  if (progress < 0) return 0;
  if (progress > 1) return 1;
  return progress;
}

/** 判断两格是否正交相邻（曼哈顿距离 === 1） */
export function isOrthoAdjacent(a: GridPos, b: GridPos): boolean {
  if (![a.x, a.y, b.x, b.y].every(Number.isInteger)) return false;
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return dx + dy === 1;
}

/** 在两格心间线性插值。progress=0 返回 from，progress=1 返回 to。 */
export function interpolatePos(from: GridPos, to: GridPos, progress: number): DisplayPos {
  const p = clampProgress(progress);
  return {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
  };
}

/**
 * 计算所有人员的显示状态。
 *
 * 匹配规则（按 agent.id）：
 * - 在 prev 和 curr 中均存在且位置正交相邻：插值显示。
 * - 在 prev 和 curr 中均存在但位置相同：静止在格心（等待/排队/服务）。
 * - 在 prev 和 curr 中均存在但位置非相邻（跳跃/瞬移）：安全对齐到 curr。
 * - 仅在 curr 中存在（新入场）：对齐到 curr 格心，不从 (0,0) 飞入。
 * - 仅在 prev 中存在（已离场）：不包含在结果中。
 * - 状态不同（如 walking→queued）：使用 curr 状态，位置按上述规则。
 *
 * 仅匹配的相邻位置在 progress=0 时使用 prev；新入/不连续位置始终对齐 curr。
 */
export function computeAgentDisplays(
  prevAgents: readonly AgentView[],
  currAgents: readonly AgentView[],
  progress: number,
): AgentDisplay[] {
  const p = clampProgress(progress);
  const prevMap = new Map<string, AgentView>();
  for (const a of prevAgents) prevMap.set(a.id, a);

  const result: AgentDisplay[] = [];
  for (const curr of currAgents) {
    const prev = prevMap.get(curr.id);
    if (prev && isOrthoAdjacent(prev.pos, curr.pos)) {
      const pos = interpolatePos(prev.pos, curr.pos, p);
      result.push({
        id: curr.id,
        displayPos: pos,
        state: curr.state,
        remainingService: curr.remainingService,
      });
    } else {
      result.push({
        id: curr.id,
        displayPos: { x: curr.pos.x, y: curr.pos.y },
        state: curr.state,
        remainingService: curr.remainingService,
      });
    }
  }
  return result;
}

/**
 * 计算从当前时间戳开始的动画进度。
 *
 * @param now 当前时间（performance.now() 毫秒）
 * @param tickStartTime 本次 tick 提交时的时间戳
 * @param tickIntervalMs tick 间隔（1000/250/62.5）
 * @returns 夹紧到 [0, 1] 的进度
 */
export function computeProgress(
  now: number,
  tickStartTime: number,
  tickIntervalMs: number,
): number {
  if (![now, tickStartTime, tickIntervalMs].every(Number.isFinite) || tickIntervalMs <= 0) return 1;
  return clampProgress((now - tickStartTime) / tickIntervalMs);
}
