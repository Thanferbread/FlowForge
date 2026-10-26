/**
 * 单步推进核心。
 *
 * 五步固定顺序：
 * 1. 入场（事件记 t）
 * 2. 服务计时（事件记 t+1）
 * 3. 统一移动
 * 4. 转换（事件记 t+1）
 * 5. 采样推进
 *
 * 纯函数，不可变更新，不依赖 React/Canvas/DOM/Math.random。
 */
import type { Scene, GridPos, Booth } from '../domain/types';
import { posKey, posEqual, inBounds, ORTHO_DIRS } from '../domain/geometry';
import { detectCongestion, exposeCongestion } from './congestion';
import { createStepContext, type StepContext } from './runtime';
import { assertStepInvariants } from './invariants';
import type {
  SimState,
  SimSnapshot,
  AgentRecord,
  AgentSnapshot,
  ExogenousDemand,
  SimulationConfig,
  MovementFailure,
} from './types';
import { transition } from './state';
import { queueMoveIntent } from './queue';
import { canPass } from './permission';
import { shouldReplan, tryReplan } from './replan';
import { fnv1aUint } from './hash';
import { stableStringify } from './hash';
import {
  STAGNATION_TICKS,
} from './constants';

/** 非.locale 字典序比较 */
function lexCompare(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** 深复制 agent */
function cloneAgent(agent: AgentRecord): AgentRecord {
  return {
    ...agent,
    pos: agent.pos ? { ...agent.pos } : null,
    replanPath: agent.replanPath ? agent.replanPath.map((p) => ({ ...p })) : null,
  };
}

/** 获取展位 qK（队尾最后一格） */
function getQK(booth: Booth): GridPos {
  return booth.queueCells[booth.queueCells.length - 1];
}

/** 判断 agent 是否在指定展位的 q0 */
function isAtQ0(agent: AgentRecord, booth: Booth): boolean {
  return agent.pos !== null && posEqual(agent.pos, booth.serviceCell);
}

/** 判断位置是否在某出口 */
function isAtExit(scene: Scene, pos: GridPos): string | null {
  for (const ex of scene.exits) {
    if (posEqual(ex.pos, pos)) return ex.id;
  }
  return null;
}

/** 创建 agent 快照（不含 demand） */
function toSnapshot(agent: AgentRecord): AgentSnapshot {
  return {
    id: agent.id,
    state: agent.state,
    pos: agent.pos ? { ...agent.pos } : null,
    remainingService: agent.remainingService,
    admitTick: agent.admitTick,
    enqueueTick: agent.enqueueTick,
    serviceStartTick: agent.serviceStartTick,
    serviceCompleteTick: agent.serviceCompleteTick,
    reachExitTick: agent.reachExitTick,
    exitTick: agent.exitTick,
    selectedExitId: agent.selectedExitId,
    consecutiveFailures: agent.consecutiveFailures,
    replanCount: agent.replanCount,
    replanPath: agent.replanPath ? agent.replanPath.map((p) => ({ ...p })) : null,
  };
}

/** 移动意图 */
interface MoveIntent {
  agentId: string;
  from: GridPos;
  to: GridPos;
  state: 'walking' | 'exiting' | 'queued';
}

/** 计算冲突优先级哈希 */
function conflictPriority(seed: number, tick: number, agentId: string): number {
  return fnv1aUint(stableStringify([seed, tick, agentId]));
}

/** 找最近出口（静态距离 + 稳定 ID） */
function findNearestExit(
  scene: Scene,
  from: GridPos,
  isAtOwnQ0: boolean,
  ownBoothId: string | null,
  context: StepContext,
): { exitId: string; exitPos: GridPos; distance: number } | null {
  const candidates: { exitId: string; exitPos: GridPos; distance: number }[] = [];

  for (const ex of scene.exits) {
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'exiting', null);
    const field = context.exitFields.get(ex.id)!;

    let dist = field.distance(from);

    // 如果在自身 q0，用 startException 逻辑
    if (isAtOwnQ0 && ownBoothId) {
      const booth = scene.booths.find((b) => b.id === ownBoothId);
      if (booth && isAtQ0({ ...({} as AgentRecord), pos: from } as AgentRecord, booth)) {
        // 检查邻居中最小距离 + 1
        let minNeighborDist = Infinity;
        for (const d of ORTHO_DIRS) {
          const neighbor: GridPos = { x: from.x + d.x, y: from.y + d.y };
          if (!inBounds(neighbor, scene.width, scene.height)) continue;
          if (!permFilter(neighbor)) continue;
          const nDist = field.distance(neighbor);
          if (nDist < minNeighborDist) minNeighborDist = nDist;
        }
        if (minNeighborDist !== Infinity) {
          dist = Math.min(dist, minNeighborDist + 1);
        }
      }
    }

    if (dist !== Infinity) {
      candidates.push({ exitId: ex.id, exitPos: { ...ex.pos }, distance: dist });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return lexCompare(a.exitId, b.exitId);
  });
  return candidates[0];
}

/** 计算 walking agent 的下一步目标 */
function computeWalkingNextStep(
  scene: Scene,
  agent: AgentRecord,
  booth: Booth,
  context: StepContext,
): GridPos | null {
  if (!agent.pos) return null;
  const qK = getQK(booth);

  // 如果已在 qK，不需要移动
  if (posEqual(agent.pos, qK)) return null;

  // 如果有重规划路径，使用下一节点
  if (agent.replanPath && agent.replanPath.length > 1) {
    const next = agent.replanPath[1];
    if (areOrthoAdjacent(agent.pos, next)) return { ...next };
    // 路径失效，清空
    return null;
  }

  // BFS 找最短路径的下一步
  const field = context.walkingFields.get(booth.id)!;
  const currentDist = field.distance(agent.pos);
  if (currentDist === Infinity) return null;

  // 沿距离递减方向找下一格（ORTHO_DIRS 顺序）
  for (const d of ORTHO_DIRS) {
    const neighbor: GridPos = { x: agent.pos.x + d.x, y: agent.pos.y + d.y };
    if (!inBounds(neighbor, scene.width, scene.height)) continue;
    const nDist = field.distance(neighbor);
    if (nDist === currentDist - 1) return neighbor;
  }

  return null;
}

/** 计算 exiting agent 的下一步目标 */
function computeExitingNextStep(
  scene: Scene,
  agent: AgentRecord,
  context: StepContext,
): GridPos | null {
  if (!agent.pos) return null;

  // 如果有重规划路径，使用下一节点
  if (agent.replanPath && agent.replanPath.length > 1) {
    const next = agent.replanPath[1];
    if (areOrthoAdjacent(agent.pos, next)) return { ...next };
    return null;
  }

  const booth = scene.booths.find((b) => b.id === agent.demand.boothId);
  const isOwnQ0 = booth ? isAtQ0(agent, booth) : false;

  // 找最近出口
  const nearest = findNearestExit(scene, agent.pos, isOwnQ0, agent.demand.boothId, context);
  if (!nearest) return null;

  // 如果已在出口，不需要移动
  if (posEqual(agent.pos, nearest.exitPos)) return null;

  // BFS 找最短路径的下一步
  const permFilter = (pos: GridPos) => canPass(scene, pos, 'exiting', null);
  const field = context.exitFields.get(nearest.exitId)!;
  const currentDist = field.distance(agent.pos);

  // 如果在自身 q0，用 startException 逻辑
  if (isOwnQ0 && currentDist === Infinity) {
    // 检查邻居中最小距离
    let bestNeighbor: GridPos | null = null;
    let bestDist = Infinity;
    for (const d of ORTHO_DIRS) {
      const neighbor: GridPos = { x: agent.pos.x + d.x, y: agent.pos.y + d.y };
      if (!inBounds(neighbor, scene.width, scene.height)) continue;
      if (!permFilter(neighbor)) continue;
      const nDist = field.distance(neighbor);
      if (nDist < bestDist) {
        bestDist = nDist;
        bestNeighbor = neighbor;
      }
    }
    return bestNeighbor;
  }

  if (currentDist === Infinity) return null;

  // 沿距离递减方向找下一格（ORTHO_DIRS 顺序）
  for (const d of ORTHO_DIRS) {
    const neighbor: GridPos = { x: agent.pos.x + d.x, y: agent.pos.y + d.y };
    if (!inBounds(neighbor, scene.width, scene.height)) continue;
    const nDist = field.distance(neighbor);
    if (nDist === currentDist - 1) return neighbor;
  }

  return null;
}

/** 判断两格正交相邻 */
function areOrthoAdjacent(a: GridPos, b: GridPos): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

/** 创建边界快照 */
function createSnapshot(
  tick: number,
  H: number,
  agents: Map<string, AgentRecord>,
  demands: ExogenousDemand[],
  occupancy: Map<string, string>,
  moveFailures: MovementFailure[],
  congestionCenters: GridPos[],
): SimSnapshot {
  const notYetArrivedIds = demands
    .filter((d) => d.scheduledTick < H && d.scheduledTick >= tick && !agents.has(d.id))
    .map((d) => d.id)
    .sort(lexCompare);

  const agentSnapshots = Array.from(agents.values())
    .sort((a, b) => lexCompare(a.id, b.id))
    .map(toSnapshot);

  const occupancyList: { pos: GridPos; agentId: string }[] = [];
  for (const [k, agentId] of occupancy) {
    const [x, y] = k.split(',').map(Number);
    occupancyList.push({ pos: { x, y }, agentId });
  }
  occupancyList.sort((a, b) => {
    if (a.pos.y !== b.pos.y) return a.pos.y - b.pos.y;
    return a.pos.x - b.pos.x;
  });

  const sortedFailures = [...moveFailures].sort((a, b) => lexCompare(a.agentId, b.agentId));
  const sortedCenters = [...congestionCenters].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  return {
    tick,
    notYetArrivedIds,
    agents: agentSnapshots,
    occupancy: occupancyList,
    moveFailures: sortedFailures,
    congestionCenters: sortedCenters,
  };
}

/**
 * 单步推进核心。
 * 内部按五步固定顺序执行，返回新 SimState（不可变）。
 */
export function step(
  state: SimState,
  scene: Scene,
  demands: ExogenousDemand[],
  config: SimulationConfig,
  context: StepContext = createStepContext(scene),
): SimState {
  if (context.scene !== scene) throw new Error('Step context belongs to another scene');
  const t = state.tick;
  if (t >= config.H) throw new Error('Cannot step beyond configured horizon');

  // 深复制状态
  const newAgents = new Map<string, AgentRecord>();
  for (const [id, agent] of state.agents) {
    newAgents.set(id, cloneAgent(agent));
  }
  const newOccupancy = new Map(state.occupancy);
  const newEvents = [...state.events];
  const newTrace = [...state.trace];
  const newOccupancyMatrix = new Map(state.occupancyMatrix);
  const newStagnationDiagnostics = [...state.stagnationDiagnostics];


  // === Step 1: 入场（事件记 t） ===
  const newEntrantIds = new Set<string>();

  // 找到 scheduledTick === t 的新到达
  const newArrivals = demands.filter((d) => d.scheduledTick < config.H && d.scheduledTick === t && !newAgents.has(d.id));

  // 为新到达创建 pending 记录
  for (const d of newArrivals) {
    const agent: AgentRecord = {
      id: d.id,
      demand: d,
      state: 'pending',
      pos: null,
      remainingService: null,
      admitTick: null,
      enqueueTick: null,
      serviceStartTick: null,
      serviceCompleteTick: null,
      reachExitTick: null,
      exitTick: null,
      selectedExitId: null,
      consecutiveFailures: 0,
      replanCount: 0,
      replanPath: null,
    };
    newAgents.set(d.id, agent);
  }

  // 按入口分组 pending agents，FIFO 入场
  const pendingByEntrance = new Map<string, AgentRecord[]>();
  for (const agent of newAgents.values()) {
    if (agent.state === 'pending') {
      const list = pendingByEntrance.get(agent.demand.entranceId) ?? [];
      list.push(agent);
      pendingByEntrance.set(agent.demand.entranceId, list);
    }
  }

  for (const [entranceId, pendingList] of pendingByEntrance) {
    // 按 (scheduledTick, id) 排序
    pendingList.sort((a, b) => {
      if (a.demand.scheduledTick !== b.demand.scheduledTick) {
        return a.demand.scheduledTick - b.demand.scheduledTick;
      }
      return lexCompare(a.id, b.id);
    });

    const entrance = scene.entrances.find((e) => e.id === entranceId);
    if (!entrance) continue;

    const entranceKey = posKey(entrance.pos);
    const entranceOccupied = newOccupancy.has(entranceKey);

    if (!entranceOccupied) {
      // 最多一人入场
      const agent = pendingList[0];
      const updated = transition(agent, { type: 'ADMIT', tick: t, pos: entrance.pos });
      newAgents.set(agent.id, updated);
      newOccupancy.set(entranceKey, agent.id);
      newEntrantIds.add(agent.id);
      newEvents.push({
        type: 'ADMIT',
        tick: t,
        agentId: agent.id,
        pos: { ...entrance.pos },
      });
    }
  }

  // === Step 2: 服务计时（事件记 t+1） ===
  const completedServiceIds = new Set<string>();

  for (const agent of newAgents.values()) {
    if (agent.state === 'serving' && agent.remainingService !== null) {
      const newRemaining = agent.remainingService - 1;
      if (newRemaining <= 0) {
        // 服务完成
        const updated = transition(agent, { type: 'SERVICE_COMPLETE', tick: t + 1 });
        newAgents.set(agent.id, updated);
        completedServiceIds.add(agent.id);
        newEvents.push({
          type: 'SERVICE_COMPLETE',
          tick: t + 1,
          agentId: agent.id,
          boothId: agent.demand.boothId,
        });
      } else {
        newAgents.set(agent.id, { ...agent, remainingService: newRemaining });
      }
    }
  }

  // === Step 3: 统一移动 ===
  // 冻结 step 开始已在出口的 exiting IDs
  const exitingAtExitIds = new Set<string>();
  for (const agent of newAgents.values()) {
    if (agent.state === 'exiting' && agent.pos) {
      if (isAtExit(scene, agent.pos)) {
        exitingAtExitIds.add(agent.id);
      }
    }
  }

  // 移动阶段开始的占位快照
  const moveSnapshot = new Map(newOccupancy);

  // 生成移动意图
  const intents: MoveIntent[] = [];
  const noPathAgentIds = new Set<string>();

  for (const agent of newAgents.values()) {
    if (newEntrantIds.has(agent.id)) continue; // 新入场者不移动
    if (completedServiceIds.has(agent.id)) continue; // 刚完成服务者不移动
    if (exitingAtExitIds.has(agent.id)) continue; // 开始时已在出口者不移动
    if (!agent.pos) continue;

    if (agent.state === 'walking') {
      const booth = scene.booths.find((b) => b.id === agent.demand.boothId);
      if (!booth) continue;
      const nextStep = computeWalkingNextStep(scene, agent, booth, context);
      if (nextStep) {
        intents.push({
          agentId: agent.id,
          from: { ...agent.pos },
          to: { ...nextStep },
          state: 'walking',
        });
      } else {
        // 检查是否已在 qK（不需要移动）
        const qK = getQK(booth);
        if (!posEqual(agent.pos, qK)) {
          noPathAgentIds.add(agent.id);
        }
      }
    } else if (agent.state === 'exiting') {
      const nextStep = computeExitingNextStep(scene, agent, context);
      if (nextStep) {
        intents.push({
          agentId: agent.id,
          from: { ...agent.pos },
          to: { ...nextStep },
          state: 'exiting',
        });
      } else {
        // 检查是否已在出口
        if (!isAtExit(scene, agent.pos)) {
          noPathAgentIds.add(agent.id);
        }
      }
    } else if (agent.state === 'queued') {
      const booth = scene.booths.find((b) => b.id === agent.demand.boothId);
      if (!booth) continue;
      const intent = queueMoveIntent(agent, booth);
      if (intent) {
        intents.push({
          agentId: agent.id,
          from: { ...intent.from },
          to: { ...intent.to },
          state: 'queued',
        });
      }
    }
  }

  // 解冲突
  const approvedMoves = new Map<string, MoveIntent>(); // agentId → intent
  const moveFailures: MovementFailure[] = [];

  // 按目标格分组
  const byTarget = new Map<string, MoveIntent[]>();
  for (const intent of intents) {
    const k = posKey(intent.to);
    const list = byTarget.get(k) ?? [];
    list.push(intent);
    byTarget.set(k, list);
  }

  // 检查目标格是否在快照中为空
  for (const [targetKey, list] of byTarget) {
    // 过滤：目标格必须在快照中为空
    const eligible = list.filter(() => !moveSnapshot.has(targetKey));

    if (eligible.length === 0) {
      // 所有意图的目标格被占
      for (const intent of list) {
        if (intent.state === 'walking' || intent.state === 'exiting') {
          moveFailures.push({
            agentId: intent.agentId,
            sampleTick: t + 1,
            pos: { ...intent.from },
            state: intent.state,
            reason: 'occupied',
          });
        }
      }
      continue;
    }

    if (eligible.length === 1) {
      // 只有一人竞争
      const intent = eligible[0];
      // 检查相向交换
      const fromKey = posKey(intent.from);
      const otherIntent = intents.find(
        (i) => posKey(i.from) === targetKey && posKey(i.to) === fromKey,
      );
      if (otherIntent) {
        // 相向交换，双方都拒绝
        if (intent.state === 'walking' || intent.state === 'exiting') {
          moveFailures.push({
            agentId: intent.agentId,
            sampleTick: t + 1,
            pos: { ...intent.from },
            state: intent.state,
            reason: 'conflict',
          });
        }
        if (otherIntent.state === 'walking' || otherIntent.state === 'exiting') {
          moveFailures.push({
            agentId: otherIntent.agentId,
            sampleTick: t + 1,
            pos: { ...otherIntent.from },
            state: otherIntent.state,
            reason: 'conflict',
          });
        }
      } else {
        approvedMoves.set(intent.agentId, intent);
      }
      continue;
    }

    // 多人竞争同一格
    // 按冲突优先级排序：哈希降序 + agentId 升序
    eligible.sort((a, b) => {
      const hashA = conflictPriority(config.seed, t, a.agentId);
      const hashB = conflictPriority(config.seed, t, b.agentId);
      if (hashA !== hashB) return hashB - hashA; // 降序
      return lexCompare(a.agentId, b.agentId); // 升序
    });

    const winner = eligible[0];
    approvedMoves.set(winner.agentId, winner);

    // 其余竞争失败
    for (let i = 1; i < eligible.length; i++) {
      const intent = eligible[i];
      if (intent.state === 'walking' || intent.state === 'exiting') {
        moveFailures.push({
          agentId: intent.agentId,
          sampleTick: t + 1,
          pos: { ...intent.from },
          state: intent.state,
          reason: 'conflict',
        });
      }
    }
  }

  // 检查已批准移动是否有相向交换
  const finalApproved = new Map<string, MoveIntent>();
  for (const [agentId, intent] of approvedMoves) {
    const fromKey = posKey(intent.from);
    const toKey = posKey(intent.to);
    const swapPartner = approvedMoves.get(
      [...approvedMoves.values()].find(
        (i) => posKey(i.from) === toKey && posKey(i.to) === fromKey,
      )?.agentId ?? '',
    );
    if (swapPartner) {
      // 相向交换，双方拒绝
      if (intent.state === 'walking' || intent.state === 'exiting') {
        moveFailures.push({
          agentId,
          sampleTick: t + 1,
          pos: { ...intent.from },
          state: intent.state,
          reason: 'conflict',
        });
      }
    } else {
      finalApproved.set(agentId, intent);
    }
  }

  // 提交移动
  for (const [agentId, intent] of finalApproved) {
    const agent = newAgents.get(agentId);
    if (!agent) continue;

    const fromKey = posKey(intent.from);
    const toKey = posKey(intent.to);

    // 更新占位
    newOccupancy.delete(fromKey);
    newOccupancy.set(toKey, agentId);

    // 更新 agent 位置
    const updated = { ...agent, pos: { ...intent.to } };

    // 消费重规划路径
    if (updated.replanPath && updated.replanPath.length > 1) {
      updated.replanPath = updated.replanPath.slice(1);
      if (updated.replanPath.length <= 1) {
        updated.replanPath = null;
      }
    }

    // 清零连续失败
    updated.consecutiveFailures = 0;

    newAgents.set(agentId, updated);
  }

  // 处理失败：no-path
  for (const agentId of noPathAgentIds) {
    if (finalApproved.has(agentId)) continue; // 已批准（不应该发生）
    const agent = newAgents.get(agentId);
    if (!agent || !agent.pos) continue;
    if (agent.state !== 'walking' && agent.state !== 'exiting') continue;
    moveFailures.push({
      agentId,
      sampleTick: t + 1,
      pos: { ...agent.pos },
      state: agent.state as 'walking' | 'exiting',
      reason: 'no-path',
    });
  }

  // 更新连续失败计数和重规划
  const failureAgentIds = new Set(moveFailures.map((f) => f.agentId));
  for (const agentId of failureAgentIds) {
    const agent = newAgents.get(agentId);
    if (!agent) continue;

    const newConsecutiveFailures = agent.consecutiveFailures + 1;
    let updated: AgentRecord = { ...agent, consecutiveFailures: newConsecutiveFailures };

    // 检查是否需要重规划
    if (shouldReplan(updated) && updated.pos) {
      // 确定目标
      let target: GridPos | null = null;
      if (updated.state === 'walking') {
        const booth = scene.booths.find((b) => b.id === updated.demand.boothId);
        if (booth) target = getQK(booth);
      } else if (updated.state === 'exiting') {
        const ownBooth = scene.booths.find(b => b.id === updated.demand.boothId);
        const atOwnQ0 = ownBooth ? isAtQ0(updated, ownBooth) : false;
        const nearest = findNearestExit(scene, updated.pos, atOwnQ0, updated.demand.boothId, context);
        if (nearest) target = nearest.exitPos;
      }

      // All attempts consume the lifetime budget, including unsuccessful searches.
      updated = { ...updated, replanCount: updated.replanCount + 1 };
      if (target) {
        const permFilter = (pos: GridPos) =>
          canPass(scene, pos, updated.state, updated.state === 'walking' ? updated.demand.boothId : null);
        const newPath = tryReplan(scene, moveSnapshot, updated, target, permFilter);
        if (newPath) {
          updated = {
            ...updated,

            replanPath: newPath.map((p) => ({ ...p })),
          };
        }
      }
    }

    // 检查停滞
    if (newConsecutiveFailures >= STAGNATION_TICKS) {
      newStagnationDiagnostics.push({
        agentId,
        tick: t + 1,
        consecutiveFailures: newConsecutiveFailures,
        replanCount: updated.replanCount,
      });
    }

    newAgents.set(agentId, updated);
  }

  // === Step 4: 转换（事件记 t+1） ===
  // 4a. 入队（walking 占据 qK → queued）
  for (const agent of newAgents.values()) {
    if (agent.state !== 'walking' || !agent.pos) continue;
    if (newEntrantIds.has(agent.id)) continue; // 新入场者不当步入队
    const booth = scene.booths.find((b) => b.id === agent.demand.boothId);
    if (!booth) continue;
    const qK = getQK(booth);
    if (posEqual(agent.pos, qK)) {
      const updated = transition(agent, { type: 'ENQUEUE', tick: t + 1 });
      newAgents.set(agent.id, updated);
      newEvents.push({
        type: 'ENQUEUE',
        tick: t + 1,
        agentId: agent.id,
        boothId: booth.id,
      });
    }
  }

  // 4b. 开始服务（queued 队首占据 q0 → serving）
  for (const agent of newAgents.values()) {
    if (agent.state !== 'queued' || !agent.pos) continue;
    const booth = scene.booths.find((b) => b.id === agent.demand.boothId);
    if (!booth) continue;
    if (posEqual(agent.pos, booth.serviceCell)) {
      // 检查是否队首（没有其他 queued/serving 在该 booth 的队列中更靠前）
      const updated = transition(agent, {
        type: 'SERVICE_START',
        tick: t + 1,
        serviceTicks: agent.demand.serviceTicks,
      });
      newAgents.set(agent.id, updated);
      newEvents.push({
        type: 'SERVICE_START',
        tick: t + 1,
        agentId: agent.id,
        boothId: booth.id,
      });
    }
  }

  // 4c. 抵达出口（exiting 到达出口 → REACH_EXIT）
  for (const agent of newAgents.values()) {
    if (agent.state !== 'exiting' || !agent.pos) continue;
    if (exitingAtExitIds.has(agent.id)) continue; // step 开始已在出口者由 4d 处理
    if (completedServiceIds.has(agent.id)) continue; // 刚完成服务者不当步抵达
    const exitId = isAtExit(scene, agent.pos);
    if (exitId) {
      const updated = transition(agent, {
        type: 'REACH_EXIT',
        tick: t + 1,
        boothId: exitId,
      });
      newAgents.set(agent.id, updated);
      newEvents.push({
        type: 'REACH_EXIT',
        tick: t + 1,
        agentId: agent.id,
        pos: { ...agent.pos },
      });
    }
  }

  // 4d. 离场（step 开始已在出口的 exiting → EXIT）
  for (const agentId of exitingAtExitIds) {
    const agent = newAgents.get(agentId);
    if (!agent || !agent.pos) continue;
    const updated = transition(agent, { type: 'EXIT', tick: t + 1 });
    newAgents.set(agentId, updated);
    newOccupancy.delete(posKey(agent.pos));
    newEvents.push({
      type: 'EXIT',
      tick: t + 1,
      agentId,
      pos: { ...agent.pos },
    });
  }

  // === Step 5: 采样推进 ===
  const newTick = t + 1;

  // 累计占用矩阵
  for (const [k, _] of newOccupancy) {
    newOccupancyMatrix.set(k, (newOccupancyMatrix.get(k) ?? 0) + 1);
  }
  const newSampleCount = state.sampleCount + 1;

  // Reuse the same pure congestion contract as metrics/tests.
  const localDensities = context.localAreas.map(({ center, cells }) => ({
    center,
    density: cells.length === 0 ? null : cells.reduce((count, key) => count + Number(newOccupancy.has(key)), 0) / cells.length,
  }));
  const { centers: congestionCenters, updatedStreaks: newCongestionStreaks } = detectCongestion(
    state.congestionStreaks, localDensities, moveFailures,
  );
  const congestionExposureDelta = exposeCongestion(
    congestionCenters, [...newAgents.values()], scene.width, scene.height,
  );

  // 创建快照
  const snapshot = createSnapshot(
    newTick,
    config.H,
    newAgents,
    demands,
    newOccupancy,
    moveFailures,
    congestionCenters,
  );

  newTrace.push(snapshot);

  const nextState: SimState = {
    tick: newTick,
    agents: newAgents,
    occupancy: newOccupancy,
    events: newEvents,
    trace: newTrace,
    occupancyMatrix: newOccupancyMatrix,
    sampleCount: newSampleCount,
    congestionExposure: state.congestionExposure + congestionExposureDelta,
    congestionStreaks: newCongestionStreaks,
    lastMoveFailures: moveFailures,
    stagnationDiagnostics: newStagnationDiagnostics,
    failureDiagnostic: state.failureDiagnostic,
  };
  assertStepInvariants(state, nextState, scene, demands, config.H);
  return nextState;
}

/** 创建初始 SimState */
export function createInitialSimState(): SimState {
  return {
    tick: 0,
    agents: new Map(),
    occupancy: new Map(),
    events: [],
    trace: [],
    occupancyMatrix: new Map(),
    sampleCount: 0,
    congestionExposure: 0,
    congestionStreaks: new Map(),
    lastMoveFailures: [],
    stagnationDiagnostics: [],
    failureDiagnostic: null,
  };
}
