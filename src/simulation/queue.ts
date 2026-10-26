/**
 * 排队服务逻辑。
 *
 * - enqueue：walking 占据 qK 时转 queued，记 enqueueTick。
 * - queueMoveIntent：为已 queued 者生成沿 qK→…→q0 方向唯一相邻前格的移动意图。
 *   队首在 q0 时不生成移动意图。
 * - startService：queued 队首实际占据 q0 时转 serving，记 serviceStartTick，
 *   初始化 remainingService=serviceTicks，当 tick 不扣时。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { Booth, GridPos } from '../domain/types';
import { posEqual } from '../domain/geometry';
import type { AgentRecord } from './types';
import { transition } from './state';

/**
 * 入队：walking 占据 qK 时转 queued。
 * @param agent 当前 walking 人员
 * @param tick 当前 tick
 */
export function enqueue(agent: AgentRecord, tick: number): AgentRecord {
  return transition(agent, { type: 'ENQUEUE', tick });
}

/**
 * 为已 queued 者生成沿 qK→…→q0 方向的移动意图。
 * @param agent 已 queued 人员
 * @param booth 目标展位
 * @returns 移动意图 {from, to} 或 null（队首在 q0 时不生成）
 */
export function queueMoveIntent(
  agent: AgentRecord,
  booth: Booth,
): { from: GridPos; to: GridPos } | null {
  if (!agent.pos) return null;
  if (agent.state !== 'queued') return null;

  // 检查是否在 q0（serviceCell）
  if (posEqual(agent.pos, booth.serviceCell)) {
    return null;
  }

  // 查找当前在 queueCells 中的位置
  let currentIdx = -1;
  for (let i = 0; i < booth.queueCells.length; i++) {
    if (posEqual(agent.pos, booth.queueCells[i])) {
      currentIdx = i;
      break;
    }
  }

  if (currentIdx === -1) return null;

  // qK→…→q0 方向：queueCells[i] 的前格是 queueCells[i-1] 或 serviceCell
  const from: GridPos = { ...agent.pos };
  let to: GridPos;

  if (currentIdx === 0) {
    // 在 q1，前格是 q0（serviceCell）
    to = { ...booth.serviceCell };
  } else {
    // 在 q[i]，前格是 q[i-1]
    to = { ...booth.queueCells[currentIdx - 1] };
  }

  return { from, to };
}

/**
 * 开始服务：queued 队首实际占据 q0 时转 serving。
 * @param agent 已 queued 且占据 q0 的队首
 * @param serviceTicks 服务时长
 * @param tick 当前 tick
 */
export function startService(
  agent: AgentRecord,
  serviceTicks: number,
  tick: number,
): AgentRecord {
  return transition(agent, { type: 'SERVICE_START', tick, serviceTicks });
}
