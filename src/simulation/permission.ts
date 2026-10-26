/**
 * 通行权限判定。
 *
 * - canPass：目的格权限判定，先 inBounds 再 cellAt，越界一律 false。
 *   walking 可走普通地面 + 目标展位 qK；exiting 仅走普通地面；
 *   queued/serving 不走 BFS。墙与展位实体永远不可走。
 * - getWalkableFor：个人通行集合（仅供路径搜索用，不作为物理面积统计）。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { Scene, GridPos } from '../domain/types';
import { inBounds, posKey } from '../domain/geometry';
import { cellAt } from '../domain/operations';
import type { AgentState } from './types';

/**
 * 判断格子是否可通行。
 * @param scene 场景
 * @param pos 待判定格子
 * @param agentState 人员状态
 * @param targetBoothId 目标展位 ID（walking 用，可为 null）
 */
export function canPass(
  scene: Scene,
  pos: GridPos,
  agentState: AgentState,
  targetBoothId: string | null,
): boolean {
  if (!inBounds(pos, scene.width, scene.height)) return false;
  const info = cellAt(scene, pos);

  switch (info.kind) {
    case 'obstacle':
      return false;
    case 'booth-footprint':
      return false;
    case 'booth-service':
      // q0 永远不能作为通行目的格（exiting 从 q0 离开由 startException 处理）
      return false;
    case 'empty':
    case 'entrance':
    case 'exit':
      // 普通地面：walking 和 exiting 可走
      return agentState === 'walking' || agentState === 'exiting';
    case 'booth-queue':
      // 只有 walking 可走目标展位的 qK（队尾最后一格）
      if (agentState !== 'walking') return false;
      if (info.boothId !== targetBoothId) return false;
      const booth = scene.booths.find((b) => b.id === targetBoothId);
      if (!booth || booth.queueCells.length === 0) return false;
      // qK 是 queueCells 最后一格
      const qK = booth.queueCells[booth.queueCells.length - 1];
      return pos.x === qK.x && pos.y === qK.y;
    default:
      return false;
  }
}

/**
 * 获取个人通行集合（posKey 集合）。
 * 仅供路径搜索用，不作为物理面积统计。
 */
export function getWalkableFor(
  scene: Scene,
  agentState: AgentState,
  targetBoothId: string | null,
): Set<string> {
  const result = new Set<string>();
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const pos: GridPos = { x, y };
      if (canPass(scene, pos, agentState, targetBoothId)) {
        result.add(posKey(pos));
      }
    }
  }
  return result;
}
