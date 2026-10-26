/** Per-engine static geometry cache. It never stores dynamic occupancy. */
import type { GridPos, Scene } from '../domain/types';
import { posKey } from '../domain/geometry';
import { cellAt } from '../domain/operations';
import { canPass } from './permission';
import { buildDistanceField } from './pathfinder';
import type { DistanceField } from './types';

export interface StepContext {
  readonly scene: Scene;
  readonly walkingFields: ReadonlyMap<string, DistanceField>;
  readonly exitFields: ReadonlyMap<string, DistanceField>;
  readonly localAreas: readonly { center: GridPos; cells: readonly string[] }[];
}

export function createStepContext(scene: Scene): StepContext {
  const walkingFields = new Map<string, DistanceField>();
  const exitFields = new Map<string, DistanceField>();
  const ordinary = new Set<string>();
  const physical = new Set<string>();
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const pos = { x, y };
      const kind = cellAt(scene, pos).kind;
      if (kind !== 'obstacle' && kind !== 'booth-footprint') physical.add(posKey(pos));
      if (canPass(scene, pos, 'exiting', null)) ordinary.add(posKey(pos));
    }
  }
  for (const booth of scene.booths) {
    const tail = booth.queueCells[booth.queueCells.length - 1];
    const tailKey = posKey(tail);
    walkingFields.set(booth.id, buildDistanceField(scene, tail,
      pos => ordinary.has(posKey(pos)) || posKey(pos) === tailKey));
  }
  for (const exit of scene.exits) {
    exitFields.set(exit.id, buildDistanceField(scene, exit.pos, pos => ordinary.has(posKey(pos))));
  }
  const localAreas: { center: GridPos; cells: string[] }[] = [];
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) {
      const cells: string[] = [];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const key = posKey({ x: x + dx, y: y + dy });
          if (physical.has(key)) cells.push(key);
        }
      }
      localAreas.push({ center: { x, y }, cells });
    }
  }
  return { scene, walkingFields, exitFields, localAreas };
}