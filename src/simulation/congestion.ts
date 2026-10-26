/**
 * 拥堵判定与暴露。
 *
 * - detectCongestion：每个 3×3 邻域中心独立判断，局部密度≥0.6 且
 *   该邻域内至少有一个 walking/exiting 因占位/竞争失败而未移动时 streak+1，
 *   否则清零；连续 5 次达标才为当前拥堵邻域。
 * - exposeCongestion：按当前所有拥堵邻域并集，对其中 walking/exiting 人员
 *   每人每 tick 计 1（人·秒），不追计前 4 tick，不因空间重叠重复计。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { GridPos } from '../domain/types';
import { posKey, inBounds } from '../domain/geometry';
import type { AgentRecord, MovementFailure } from './types';
import { CONGESTION_DENSITY_THRESHOLD, CONGESTION_CONSECUTIVE_TICKS } from './constants';

/** 拥堵检测结果 */
export interface CongestionResult {
  centers: GridPos[];
  updatedStreaks: Map<string, number>;
}

/**
 * 检测拥堵邻域。
 * @param streaks 每邻域中心连续达标次数
 * @param localDensities 各邻域中心的局部密度
 * @param moveFailures 本 step 的移动失败记录
 * @returns 拥堵中心列表和更新后的 streaks
 */
export function detectCongestion(
  streaks: Map<string, number>,
  localDensities: { center: GridPos; density: number | null }[],
  moveFailures: MovementFailure[],
): CongestionResult {
  const updatedStreaks = new Map<string, number>();
  const centers: GridPos[] = [];

  for (const { center, density } of localDensities) {
    const centerKey = posKey(center);
    const currentStreak = streaks.get(centerKey) ?? 0;

    // 检查邻域内是否有移动失败
    const hasMoveFailure = moveFailures.some((f) => {
      if (f.reason !== 'occupied' && f.reason !== 'conflict') return false;
      const dx = Math.abs(f.pos.x - center.x);
      const dy = Math.abs(f.pos.y - center.y);
      return dx <= 1 && dy <= 1;
    });

    const isDense = density !== null && density >= CONGESTION_DENSITY_THRESHOLD;

    if (isDense && hasMoveFailure) {
      const newStreak = currentStreak + 1;
      updatedStreaks.set(centerKey, newStreak);
      if (newStreak >= CONGESTION_CONSECUTIVE_TICKS) {
        centers.push({ ...center });
      }
    } else {
      updatedStreaks.set(centerKey, 0);
    }
  }

  return { centers, updatedStreaks };
}

/**
 * 计算拥堵暴露。
 * 按当前所有拥堵邻域并集，对其中 walking/exiting 人员每人每 tick 计 1。
 * @param regions 拥堵邻域中心列表
 * @param agents 当前人员列表
 * @param sceneWidth 场景宽度
 * @param sceneHeight 场景高度
 * @returns 拥堵暴露增量（人·秒）
 */
export function exposeCongestion(
  regions: GridPos[],
  agents: AgentRecord[],
  sceneWidth: number,
  sceneHeight: number,
): number {
  if (regions.length === 0) return 0;

  // 计算拥堵邻域并集
  const congestionUnion = new Set<string>();
  for (const center of regions) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const pos: GridPos = { x: center.x + dx, y: center.y + dy };
        if (inBounds(pos, sceneWidth, sceneHeight)) {
          congestionUnion.add(posKey(pos));
        }
      }
    }
  }

  // 统计在并集中的 walking/exiting 人员
  let count = 0;
  for (const agent of agents) {
    if ((agent.state === 'walking' || agent.state === 'exiting') && agent.pos) {
      if (congestionUnion.has(posKey(agent.pos))) {
        count++;
      }
    }
  }

  return count;
}
