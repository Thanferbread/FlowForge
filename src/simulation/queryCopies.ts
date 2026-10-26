/** Query values never share mutable history or nested positions with the engine. */
import type { EventRecord, SimSnapshot } from './types';

export function copySnapshot(snapshot: SimSnapshot): SimSnapshot {
  return {
    tick: snapshot.tick,
    notYetArrivedIds: [...snapshot.notYetArrivedIds],
    agents: snapshot.agents.map(agent => ({
      ...agent,
      pos: agent.pos ? { ...agent.pos } : null,
      replanPath: agent.replanPath ? agent.replanPath.map(pos => ({ ...pos })) : null,
    })),
    occupancy: snapshot.occupancy.map(entry => ({ ...entry, pos: { ...entry.pos } })),
    moveFailures: snapshot.moveFailures.map(failure => ({ ...failure, pos: { ...failure.pos } })),
    congestionCenters: snapshot.congestionCenters.map(pos => ({ ...pos })),
  };
}

export function copyEvent(event: EventRecord): EventRecord {
  return {
    type: event.type, tick: event.tick, agentId: event.agentId,
    ...(event.boothId === undefined ? {} : { boothId: event.boothId }),
    ...(event.pos === undefined ? {} : { pos: { ...event.pos } }),
  };
}
