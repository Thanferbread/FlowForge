/**
 * 人员状态机流转。
 *
 * - createInitialAgents：返回空 Map，仅已到达 D 中需求在入场阶段创建记录。
 * - transition：按事件类型不可变更新 agent 状态与对应 tick 字段。
 *   状态单向流转不可回退。pos 在 pending/exited 时为 null。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { GridPos } from '../domain/types';
import type { AgentRecord, EventType } from './types';

/** 创建初始空 agents Map */
export function createInitialAgents(): Map<string, AgentRecord> {
  return new Map();
}

/** 状态机事件 */
export interface StateEvent {
  type: EventType;
  tick: number;
  pos?: GridPos;
  boothId?: string;
  serviceTicks?: number;
}

/**
 * 按事件不可变更新 agent 状态。
 * 状态单向流转：pending→walking→queued→serving→exiting→exited。
 */
export function transition(agent: AgentRecord, event: StateEvent): AgentRecord {
  const next: AgentRecord = { ...agent };

  switch (event.type) {
    case 'ADMIT':
      next.state = 'walking';
      next.admitTick = event.tick;
      if (event.pos) next.pos = { ...event.pos };
      break;
    case 'ENQUEUE':
      next.state = 'queued';
      next.enqueueTick = event.tick;
      break;
    case 'SERVICE_START':
      next.state = 'serving';
      next.serviceStartTick = event.tick;
      next.remainingService = event.serviceTicks ?? agent.demand.serviceTicks;
      break;
    case 'SERVICE_COMPLETE':
      next.state = 'exiting';
      next.serviceCompleteTick = event.tick;
      next.remainingService = null;
      break;
    case 'REACH_EXIT':
      next.reachExitTick = event.tick;
      if (event.boothId) next.selectedExitId = event.boothId;
      break;
    case 'EXIT':
      next.state = 'exited';
      next.exitTick = event.tick;
      next.pos = null;
      break;
  }

  return next;
}
