import type { Booth, Scene } from '../domain/types';
import { validateScene } from '../domain/validation';
import { hashScene } from '../simulation/hash';
import type { Bottleneck, CandidateRecord, LayoutMove } from './types';

export function copyScene(scene: Scene): Scene {
  return {
    ...scene,
    obstacles: scene.obstacles.map(p => ({ ...p })),
    entrances: scene.entrances.map(p => ({ id: p.id, pos: { ...p.pos } })),
    exits: scene.exits.map(p => ({ id: p.id, pos: { ...p.pos } })),
    booths: scene.booths.map(b => ({ ...b, footprint: { ...b.footprint },
      serviceCell: { ...b.serviceCell }, queueCells: b.queueCells.map(p => ({ ...p })) })),
  };
}

/** Translation only. Service distribution, booth IDs, walls and portals are untouched. */
export function translateBooth(scene: Scene, move: LayoutMove): Scene {
  const next = copyScene(scene);
  const booth = next.booths.find(b => b.id === move.boothId);
  if (!booth) throw new Error(`不存在展位 ${move.boothId}`);
  if (!Number.isInteger(move.dx) || !Number.isInteger(move.dy) ||
    Math.abs(move.dx) + Math.abs(move.dy) < 1 ||
    Math.abs(move.dx) + Math.abs(move.dy) > 3 || (move.dx !== 0 && move.dy !== 0)) {
    throw new Error('展位包只能沿一个正交方向整体平移 1–3 格');
  }
  const translate = (p: { x: number; y: number }) => ({ x: p.x + move.dx, y: p.y + move.dy });
  booth.footprint = translate(booth.footprint);
  booth.serviceCell = translate(booth.serviceCell);
  booth.queueCells = booth.queueCells.map(translate);
  return next;
}

function boothPriority(booth: Booth, hotspots: Bottleneck[]): number {
  return hotspots.reduce((sum, h) => {
    const cells = [booth.serviceCell, ...booth.queueCells];
    const distance = Math.min(...cells.map(p => Math.abs(p.x - h.pos.x) + Math.abs(p.y - h.pos.y)));
    return sum + (h.congestionTicks * 10 + h.blockedAgentTicks) / (distance + 1);
  }, 0);
}

/** Enumerate deterministically, reject illegal scenes before spending the simulation budget. */
export function enumerateCandidates(scene: Scene, hotspots: Bottleneck[], maxCandidates: number): CandidateRecord[] {
  const booths = [...scene.booths].sort((a, b) =>
    boothPriority(b, hotspots) - boothPriority(a, hotspots) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const records: CandidateRecord[] = [];
  const seen = new Set<string>([hashScene(scene)]);
  let scheduled = 0;
  // Breadth across booths: a small budget is not consumed by one booth alone.
  for (let distance = 1; distance <= 3; distance++) {
    for (const direction of [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }]) {
      for (const booth of booths) {
        const move = { boothId: booth.id, dx: direction.x * distance, dy: direction.y * distance };
        const candidate = translateBooth(scene, move);
        const sceneHash = hashScene(candidate);
        const validation = validateScene(candidate);
        const reasons = validation.issues.map(i => `${i.code}: ${i.message}`);
        if (seen.has(sceneHash)) reasons.push('DUPLICATE: 与已枚举场景重复');
        seen.add(sceneHash);
        const legal = validation.readyForSimulation && reasons.length === 0;
        const state = !legal ? 'invalid' : scheduled < maxCandidates ? 'pending' : 'budget-skipped';
        if (state === 'pending') scheduled++;
        records.push({ id: `${booth.id}:${move.dx},${move.dy}`, move, sceneHash, state,
          rejectionReasons: !legal ? reasons : state === 'budget-skipped' ? ['达到候选仿真预算，未评估'] : [],
          training: [], score: null });
      }
    }
  }
  return records;
}
