/**
 * 占位感知重规划。
 *
 * - shouldReplan：仅对 walking/exiting 且 consecutiveFailures ∈ {10,20,30}
 *   且 replanCount < 3 时返回 true。
 * - tryReplan：按本步统一占位快照作有界 BFS，成功返回新路径，失败返回 null。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { Scene, GridPos } from '../domain/types';
import { posKey } from '../domain/geometry';
import type { AgentRecord } from './types';
import { REPLAN_THRESHOLDS, MAX_REPLANS_PER_AGENT } from './constants';
import { bfsPath } from './pathfinder';

/**
 * 判断是否需要重规划。
 * 仅对 walking/exiting 且 consecutiveFailures ∈ {10,20,30} 且 replanCount < 3。
 */
export function shouldReplan(agent: AgentRecord): boolean {
  if (agent.state !== 'walking' && agent.state !== 'exiting') return false;
  if (!REPLAN_THRESHOLDS.includes(agent.consecutiveFailures)) return false;
  return agent.replanCount < MAX_REPLANS_PER_AGENT;
}

/**
 * 占位感知重规划路径搜索。
 * @param scene 场景
 * @param occupancy 占位快照 posKey → agentId
 * @param agent 当前人员
 * @param target 目标格
 * @param permFilter 基础通行权限过滤
 * @returns 新路径或 null
 */
export function tryReplan(
  scene: Scene,
  occupancy: Map<string, string>,
  agent: AgentRecord,
  target: GridPos,
  permFilter: (pos: GridPos) => boolean,
): GridPos[] | null {
  if (!agent.pos) return null;

  const agentPosKey = posKey(agent.pos);

  // 占位感知过滤：基础权限 + 非占位（起点自身例外）
  const occupiedFilter = (pos: GridPos): boolean => {
    if (!permFilter(pos)) return false;
    const k = posKey(pos);
    if (k === agentPosKey) return true;
    return !occupancy.has(k);
  };

  const booth = scene.booths.find(b => b.id === agent.demand.boothId);
  const ownCompletedQ0 = agent.state === 'exiting' && agent.serviceCompleteTick !== null
    && booth && agent.pos.x === booth.serviceCell.x && agent.pos.y === booth.serviceCell.y;
  return bfsPath(scene, agent.pos, target, occupiedFilter,
    ownCompletedQ0 ? { ownCompletedServiceBoothId: booth.id } : undefined);
}
