/**
 * BFS 最短路径与距离场缓存。
 *
 * - buildDistanceField：BFS 从 target 反向构建，先显式检查 inBounds，
 *   按 ORTHO_DIRS（下→右→上→左）固定顺序遍历邻居，每格最多访问一次，不可达用 Infinity。
 * - bfsPath：返回含起终点的最短路径，不可达返回 null。
 *   startException 仅在 engine 已确认人员服务完成且 from 等于其自身 q0 时提供。
 *
 * 纯函数，不依赖 React/Canvas/DOM。
 */
import type { Scene, GridPos } from '../domain/types';
import { inBounds, posKey, ORTHO_DIRS } from '../domain/geometry';
import type { DistanceField } from './types';

/**
 * 从 target 反向 BFS 构建距离场。
 * @param scene 场景
 * @param target 目标格
 * @param permFilter 通行权限过滤函数
 */
export function buildDistanceField(
  scene: Scene,
  target: GridPos,
  permFilter: (pos: GridPos) => boolean,
): DistanceField {
  const distances = new Map<string, number>();
  const targetKey = posKey(target);

  if (!inBounds(target, scene.width, scene.height) || !permFilter(target)) {
    return {
      target: { ...target },
      distances,
      distance(pos: GridPos): number {
        return distances.get(posKey(pos)) ?? Infinity;
      },
    };
  }

  const queue: GridPos[] = [{ ...target }];
  distances.set(targetKey, 0);

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = distances.get(posKey(current))!;
    const nextDist = currentDist + 1;

    for (const d of ORTHO_DIRS) {
      const neighbor: GridPos = { x: current.x + d.x, y: current.y + d.y };
      if (!inBounds(neighbor, scene.width, scene.height)) continue;
      const nKey = posKey(neighbor);
      if (distances.has(nKey)) continue;
      if (!permFilter(neighbor)) continue;
      distances.set(nKey, nextDist);
      queue.push(neighbor);
    }
  }

  return {
    target: { ...target },
    distances,
    distance(pos: GridPos): number {
      return distances.get(posKey(pos)) ?? Infinity;
    },
  };
}

/**
 * BFS 最短路径：返回含起终点的最短路径，不可达返回 null。
 * @param scene 场景
 * @param from 起点
 * @param target 终点
 * @param permFilter 通行权限过滤函数
 * @param startException 起点例外（仅当 from 是自身已完成服务的 q0 时提供）
 */
export function bfsPath(
  scene: Scene,
  from: GridPos,
  target: GridPos,
  permFilter: (pos: GridPos) => boolean,
  startException?: { ownCompletedServiceBoothId: string },
): GridPos[] | null {
  if (!inBounds(from, scene.width, scene.height)) return null;
  if (!inBounds(target, scene.width, scene.height)) return null;

  const ownBooth = startException
    ? scene.booths.find(b => b.id === startException.ownCompletedServiceBoothId) : undefined;
  const validStartException = ownBooth !== undefined
    && from.x === ownBooth.serviceCell.x && from.y === ownBooth.serviceCell.y;

  // from === target 的特殊情况
  if (from.x === target.x && from.y === target.y) {
    if (permFilter(target)) {
      return [{ ...target }];
    }
    return null;
  }

  // 构建从 target 反向的距离场
  const field = buildDistanceField(scene, target, permFilter);

  // 检查 from 是否可达
  const fromKey = posKey(from);
  const fromDist = field.distances.get(fromKey);

  if (fromDist !== undefined && fromDist !== Infinity) {
    // from 在距离场中，沿距离递减方向构建路径
    return reconstructPath(from, target, field);
  }

  // from 不在距离场中，检查 startException
  if (validStartException) {
    // from 是 q0，需要找到一个通过 permFilter 的邻居，然后沿距离场到 target
    let bestNeighbor: GridPos | null = null;
    let bestDist = Infinity;

    for (const d of ORTHO_DIRS) {
      const neighbor: GridPos = { x: from.x + d.x, y: from.y + d.y };
      if (!inBounds(neighbor, scene.width, scene.height)) continue;
      if (!permFilter(neighbor)) continue;
      const nDist = field.distances.get(posKey(neighbor));
      if (nDist !== undefined && nDist < bestDist) {
        bestDist = nDist;
        bestNeighbor = neighbor;
      }
    }

    if (bestNeighbor && bestDist !== Infinity) {
      // 路径：from → bestNeighbor → ... → target
      const restPath = reconstructPath(bestNeighbor, target, field);
      if (restPath) {
        return [{ ...from }, ...restPath];
      }
    }
  }

  return null;
}

/** 沿距离递减方向重建路径 */
function reconstructPath(
  from: GridPos,
  target: GridPos,
  field: DistanceField,
): GridPos[] | null {
  const path: GridPos[] = [{ ...from }];
  const targetKey = posKey(target);
  let current = { ...from };

  while (posKey(current) !== targetKey) {
    const currentDist = field.distances.get(posKey(current));
    if (currentDist === undefined || currentDist === Infinity) return null;

    // 找距离减 1 的邻居（按 ORTHO_DIRS 顺序）
    let nextStep: GridPos | null = null;
    for (const d of ORTHO_DIRS) {
      const neighbor: GridPos = { x: current.x + d.x, y: current.y + d.y };
      const nKey = posKey(neighbor);
      const nDist = field.distances.get(nKey);
      if (nDist !== undefined && nDist === currentDist - 1) {
        nextStep = neighbor;
        break;
      }
    }

    if (!nextStep) return null;
    path.push({ ...nextStep });
    current = nextStep;
  }

  return path;
}
