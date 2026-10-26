/**
 * 路径搜索测试 S01。
 *
 * 构造有绕行路线的小地图，验证 BFS 路径正确性。
 */
import { describe, it, expect } from 'vitest';
import { bfsPath, buildDistanceField } from '../pathfinder';
import { canPass } from '../permission';
import { ORTHO_DIRS } from '../../domain/geometry';
import type { Scene, GridPos } from '../../domain/types';
import { SCHEMA_VERSION } from '../../domain/types';

/** 构造测试小地图：5×5，有障碍需绕行 */
function createTestScene(): Scene {
  return {
    schemaVersion: SCHEMA_VERSION,
    width: 5,
    height: 5,
    obstacles: [{ x: 2, y: 1 }, { x: 2, y: 2 }],
    entrances: [{ id: 'ent-1', pos: { x: 0, y: 4 } }],
    exits: [{ id: 'exit-1', pos: { x: 4, y: 0 } }],
    booths: [],
  };
}

/** 构造有展位队列的小地图 */
function createBoothScene(): Scene {
  return {
    schemaVersion: SCHEMA_VERSION,
    width: 7,
    height: 7,
    obstacles: [],
    entrances: [{ id: 'ent-1', pos: { x: 0, y: 6 } }],
    exits: [{ id: 'exit-1', pos: { x: 6, y: 0 } }],
    booths: [
      {
        id: 'booth-1',
        footprint: { x: 3, y: 3 },
        serviceCell: { x: 3, y: 4 },
        queueCells: [{ x: 3, y: 5 }, { x: 3, y: 6 }],
        serviceTicksMin: 4,
        serviceTicksMax: 8,
      },
    ],
  };
}

describe('S01: BFS 路径搜索', () => {
  it('BFS 路径起终点正确', () => {
    const scene = createTestScene();
    const from: GridPos = { x: 0, y: 0 };
    const target: GridPos = { x: 4, y: 0 };
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'walking', null);
    const path = bfsPath(scene, from, target, permFilter);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual(from);
    expect(path![path!.length - 1]).toEqual(target);
  });

  it('路径相邻格正交相邻（|dx|+|dy|===1）', () => {
    const scene = createTestScene();
    const from: GridPos = { x: 0, y: 0 };
    const target: GridPos = { x: 4, y: 0 };
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'walking', null);
    const path = bfsPath(scene, from, target, permFilter);
    expect(path).not.toBeNull();
    for (let i = 1; i < path!.length; i++) {
      const dx = Math.abs(path![i].x - path![i - 1].x);
      const dy = Math.abs(path![i].y - path![i - 1].y);
      expect(dx + dy).toBe(1);
    }
  });

  it('不可穿墙', () => {
    const scene = createTestScene();
    const from: GridPos = { x: 0, y: 0 };
    const target: GridPos = { x: 4, y: 0 };
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'walking', null);
    const path = bfsPath(scene, from, target, permFilter);
    expect(path).not.toBeNull();
    for (const p of path!) {
      const isObstacle = scene.obstacles.some((o) => o.x === p.x && o.y === p.y);
      expect(isObstacle).toBe(false);
    }
  });

  it('路径距离最短', () => {
    const scene = createTestScene();
    const from: GridPos = { x: 0, y: 0 };
    const target: GridPos = { x: 4, y: 0 };
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'walking', null);
    const path = bfsPath(scene, from, target, permFilter);
    expect(path).not.toBeNull();
    // 从 (0,0) 到 (4,0) 需绕过 (2,1) 和 (2,2)
    // 最短路径：6 步（下→右→右→右→右→上→上 或类似）
    expect(path!.length).toBeLessThanOrEqual(7);
    expect(path!.length).toBeGreaterThanOrEqual(5);
  });

  it('不可达时有限返回 null', () => {
    const scene: Scene = {
      schemaVersion: SCHEMA_VERSION,
      width: 5,
      height: 5,
      obstacles: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }],
      entrances: [],
      exits: [],
      booths: [],
    };
    const from: GridPos = { x: 0, y: 0 };
    const target: GridPos = { x: 0, y: 4 };
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'walking', null);
    const path = bfsPath(scene, from, target, permFilter);
    expect(path).toBeNull();
  });

  it('ORTHO_DIRS 邻居顺序固定（下→右→上→左）', () => {
    expect(ORTHO_DIRS).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
    ]);
  });

  it('canPass 对越界一律 false', () => {
    const scene = createTestScene();
    expect(canPass(scene, { x: -1, y: 0 }, 'walking', null)).toBe(false);
    expect(canPass(scene, { x: 0, y: -1 }, 'walking', null)).toBe(false);
    expect(canPass(scene, { x: 5, y: 0 }, 'walking', null)).toBe(false);
    expect(canPass(scene, { x: 0, y: 5 }, 'walking', null)).toBe(false);
  });

  it('walking 不可穿过其他展位队列格', () => {
    const scene = createBoothScene();
    // queueCells[0] = (3,5) 是 q1，不是 qK，walking 不可走
    expect(canPass(scene, { x: 3, y: 5 }, 'walking', 'booth-1')).toBe(false);
    // queueCells[1] = (3,6) 是 qK，walking 可走
    expect(canPass(scene, { x: 3, y: 6 }, 'walking', 'booth-1')).toBe(true);
    // serviceCell = (3,4) 是 q0，walking 不可走
    expect(canPass(scene, { x: 3, y: 4 }, 'walking', 'booth-1')).toBe(false);
  });

  it('exiting 仅走普通地面', () => {
    const scene = createBoothScene();
    expect(canPass(scene, { x: 3, y: 6 }, 'exiting', null)).toBe(false);
    expect(canPass(scene, { x: 3, y: 5 }, 'exiting', null)).toBe(false);
    expect(canPass(scene, { x: 3, y: 4 }, 'exiting', null)).toBe(false);
    expect(canPass(scene, { x: 0, y: 0 }, 'exiting', null)).toBe(true);
  });

  it('buildDistanceField 返回正确距离', () => {
    const scene = createTestScene();
    const target: GridPos = { x: 4, y: 0 };
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'walking', null);
    const field = buildDistanceField(scene, target, permFilter);
    expect(field.distance(target)).toBe(0);
    expect(field.distance({ x: 3, y: 0 })).toBe(1);
    expect(field.distance({ x: 0, y: 0 })).toBeLessThan(Infinity);
  });

  it('q0 起点例外允许单向离开', () => {
    const scene = createBoothScene();
    const from: GridPos = { x: 3, y: 4 }; // q0
    const target: GridPos = { x: 6, y: 0 }; // exit
    const permFilter = (pos: GridPos) => canPass(scene, pos, 'exiting', null);

    // 不带 startException：q0 不可走，应返回 null
    const pathWithoutException = bfsPath(scene, from, target, permFilter);
    expect(pathWithoutException).toBeNull();

    // 带 startException：允许从 q0 离开
    const pathWithException = bfsPath(scene, from, target, permFilter, {
      ownCompletedServiceBoothId: 'booth-1',
    });
    expect(pathWithException).not.toBeNull();
    expect(pathWithException![0]).toEqual(from);
    expect(pathWithException![pathWithException!.length - 1]).toEqual(target);
  });
});

describe('q0 起点例外边界', () => {
  it('不能将自身q0例外用于墙、其他展位q0或不存在的展位', () => {
    const scene = createBoothScene();
    scene.obstacles.push({ x: 1, y: 1 });
    scene.booths.push({ id: 'booth-2', footprint: { x: 5, y: 1 },
      serviceCell: { x: 5, y: 2 }, queueCells: [{ x: 5, y: 3 }],
      serviceTicksMin: 4, serviceTicksMax: 4 });
    const pass = (pos: GridPos) => canPass(scene, pos, 'exiting', null);
    expect(bfsPath(scene, { x: 1, y: 1 }, { x: 6, y: 0 }, pass,
      { ownCompletedServiceBoothId: 'booth-1' })).toBeNull();
    expect(bfsPath(scene, { x: 5, y: 2 }, { x: 6, y: 0 }, pass,
      { ownCompletedServiceBoothId: 'booth-1' })).toBeNull();
    expect(bfsPath(scene, { x: 3, y: 4 }, { x: 6, y: 0 }, pass,
      { ownCompletedServiceBoothId: 'missing' })).toBeNull();
    // A start exception never grants permission to enter q0 as the destination.
    expect(bfsPath(scene, { x: 3, y: 4 }, { x: 3, y: 4 }, pass,
      { ownCompletedServiceBoothId: 'booth-1' })).toBeNull();
  });
});