/** Validate every candidate tick before it becomes the last valid engine state. */
import type { Scene } from '../domain/types';
import { inBounds, posEqual, posKey } from '../domain/geometry';
import { canPass } from './permission';
import type { ExogenousDemand, SimState, AgentState } from './types';

const STATE_ORDER: AgentState[] = ['pending', 'walking', 'queued', 'serving', 'exiting', 'exited'];
function requireInvariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Simulation invariant: ${message}`);
}
export function assertStepInvariants(
  previous: SimState, next: SimState, scene: Scene, demands: ExogenousDemand[], H: number,
): void {
  requireInvariant(next.tick === previous.tick + 1 && next.tick <= H, 'invalid tick advance');
  const D = demands.filter(d => d.scheduledTick >= 0 && d.scheduledTick < H);
  const arrived = new Set(D.filter(d => d.scheduledTick < next.tick).map(d => d.id));
  requireInvariant(next.agents.size === arrived.size, 'arrived/pending/active/exited conservation');
  const occupied = new Map<string, string>();
  let admitted = 0;
  let serviceCompleted = 0;
  let exited = 0;
  for (const [id, agent] of next.agents) {
    requireInvariant(arrived.has(id) && agent.id === id && agent.demand.id === id, `unknown agent ${id}`);
    requireInvariant(STATE_ORDER.includes(agent.state), `unknown state ${id}`);
    if (agent.admitTick !== null) admitted++;
    const before = previous.agents.get(id);
    if (before) {
      requireInvariant(STATE_ORDER.indexOf(agent.state) >= STATE_ORDER.indexOf(before.state), `state reversal ${id}`);
      if (before.pos && agent.pos) {
        const distance = Math.abs(before.pos.x - agent.pos.x) + Math.abs(before.pos.y - agent.pos.y);
        requireInvariant(distance <= 1, `multiple-cell or diagonal movement ${id}`);
      }
    }
    requireInvariant(agent.replanCount >= 0 && agent.replanCount <= 3, `replan budget ${id}`);
    if (agent.serviceCompleteTick !== null) serviceCompleted++;
    if (agent.state === 'exited') exited++;
    if (agent.state === 'pending' || agent.state === 'exited') {
      requireInvariant(agent.pos === null, `nonphysical agent has occupancy ${id}`);
      continue;
    }
    requireInvariant(agent.pos !== null, `physical agent has no position ${id}`);
    const pos = agent.pos;
    requireInvariant(Number.isInteger(pos.x) && Number.isInteger(pos.y) && inBounds(pos, scene.width, scene.height), `out-of-bounds ${id}`);
    const booth = scene.booths.find(b => b.id === agent.demand.boothId);
    requireInvariant(booth !== undefined, `unknown booth ${id}`);
    const atQ0 = posEqual(pos, booth.serviceCell);
    const inQueue = booth.queueCells.some(q => posEqual(q, pos));
    const permitted = agent.state === 'walking' ? canPass(scene, pos, 'walking', booth.id)
      : agent.state === 'queued' ? inQueue || atQ0
      : agent.state === 'serving' ? atQ0
      : canPass(scene, pos, 'exiting', null) || (atQ0 && agent.serviceCompleteTick !== null);
    requireInvariant(permitted, `illegal cell permission ${id}`);
    const key = posKey(pos);
    requireInvariant(!occupied.has(key), `two agents occupy ${key}`);
    occupied.set(key, id);
  }
  requireInvariant(occupied.size === next.occupancy.size, 'occupancy cardinality');
  for (const [key, id] of occupied) requireInvariant(next.occupancy.get(key) === id, `occupancy mismatch ${key}`);
  requireInvariant(exited <= serviceCompleted && serviceCompleted <= admitted && admitted <= D.length, 'service/exit/admitted counts');
  requireInvariant(D.length === (D.length - arrived.size) + next.agents.size, 'demand conservation');
}