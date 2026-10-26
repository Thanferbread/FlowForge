/**
 * 场景操作测试：放置/删除/移动的原子性与非法操作不破坏状态。
 */
import { describe, it, expect } from 'vitest';
import {
  addObstacle,
  addEntrance,
  addExit,
  addBooth,
  eraseAt,
  moveBooth,
  removeBooth,
  updateBoothService,
  updateBoothQueueLength,
  cellAt,
  canPlaceAt,
  nextBoothId,
} from '../operations';
import { createEmptyScene } from '../geometry';
import { validateScene } from '../validation';
import type { Scene } from '../types';
import { SCHEMA_VERSION } from '../types';

describe('放置操作', () => {
  it('放置障碍应生效且占用格子', () => {
    const scene = createEmptyScene(10, 10);
    const result = addObstacle(scene, { x: 3, y: 3 });
    expect(result).not.toBeNull();
    expect(result!.obstacles).toHaveLength(1);
    expect(cellAt(result!, { x: 3, y: 3 }).kind).toBe('obstacle');
  });

  it('在已占用格放置应返回 null 且不破坏原状态', () => {
    const scene = createEmptyScene(10, 10);
    const s1 = addObstacle(scene, { x: 3, y: 3 })!;
    const s2 = addObstacle(s1, { x: 3, y: 3 });
    expect(s2).toBeNull();
    expect(s1.obstacles).toHaveLength(1); // 原状态不变
  });

  it('越界放置应返回 null', () => {
    const scene = createEmptyScene(10, 10);
    expect(addObstacle(scene, { x: -1, y: 0 })).toBeNull();
    expect(addObstacle(scene, { x: 10, y: 0 })).toBeNull();
    expect(addObstacle(scene, { x: 0, y: 10 })).toBeNull();
  });

  it('入口不在边界应返回 null', () => {
    const scene = createEmptyScene(10, 10);
    expect(addEntrance(scene, { x: 5, y: 5 })).toBeNull();
    expect(addEntrance(scene, { x: 0, y: 0 })).not.toBeNull();
  });

  it('放置展位应自动生成服务格和队列格', () => {
    const scene = createEmptyScene(10, 10);
    const result = addBooth(scene, { x: 5, y: 5 });
    expect(result).not.toBeNull();
    expect(result!.booths).toHaveLength(1);
    const booth = result!.booths[0];
    expect(booth.queueCells).toHaveLength(3);
    // 服务格应与实体相邻
    expect(Math.abs(booth.serviceCell.x - booth.footprint.x) + Math.abs(booth.serviceCell.y - booth.footprint.y)).toBe(1);
  });

  it('空间不足时放置展位应返回 null', () => {
    // 3×3 地图，展位实体在中间 (1,1)，需要服务格+3队列格=4格，加实体5格
    // 3×3=9格，但实体在中间，4方向各只有1-2格空间
    const scene = createEmptyScene(3, 3);
    const result = addBooth(scene, { x: 1, y: 1 }, 3);
    // 中间格4方向：下(1,2)然后(1,3)越界；右(2,1)然后(3,1)越界；上(1,0)然后(1,-1)越界；左(0,1)然后(-1,1)越界
    // 每个方向只能放服务格+1队列格，不够3格队列
    expect(result).toBeNull();
  });
});

describe('删除操作', () => {
  it('擦除障碍应移除该格', () => {
    const scene = createEmptyScene(10, 10);
    const s1 = addObstacle(scene, { x: 3, y: 3 })!;
    const s2 = eraseAt(s1, { x: 3, y: 3 });
    expect(s2).not.toBeNull();
    expect(s2!.obstacles).toHaveLength(0);
  });

  it('删除展位应连带移除服务格和队列格', () => {
    const scene = createEmptyScene(10, 10);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    const booth = s1.booths[0];
    // 删除前服务格和队列格存在
    expect(cellAt(s1, booth.serviceCell).kind).toBe('booth-service');
    // 擦除实体
    const s2 = eraseAt(s1, booth.footprint);
    expect(s2).not.toBeNull();
    expect(s2!.booths).toHaveLength(0);
    // 服务格和队列格都应清空
    expect(cellAt(s2!, booth.serviceCell).kind).toBe('empty');
    for (const q of booth.queueCells) {
      expect(cellAt(s2!, q).kind).toBe('empty');
    }
  });

  it('擦除队列格也能删除整个展位', () => {
    const scene = createEmptyScene(10, 10);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    const booth = s1.booths[0];
    const s2 = eraseAt(s1, booth.queueCells[0]);
    expect(s2).not.toBeNull();
    expect(s2!.booths).toHaveLength(0);
  });

  it('擦除空格应返回 null', () => {
    const scene = createEmptyScene(10, 10);
    expect(eraseAt(scene, { x: 3, y: 3 })).toBeNull();
  });
});

describe('移动展位', () => {
  it('移动展位到合法位置应保持相对结构', () => {
    const scene = createEmptyScene(15, 15);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    const booth = s1.booths[0];
    const dx = 2, dy = 1;
    const newFootprint = { x: booth.footprint.x + dx, y: booth.footprint.y + dy };
    const s2 = moveBooth(s1, booth.id, newFootprint);
    expect(s2).not.toBeNull();
    const moved = s2!.booths[0];
    expect(moved.footprint).toEqual(newFootprint);
    expect(moved.serviceCell.x).toBe(booth.serviceCell.x + dx);
    expect(moved.serviceCell.y).toBe(booth.serviceCell.y + dy);
    expect(moved.queueCells).toHaveLength(booth.queueCells.length);
  });

  it('移动到越界位置应返回 null', () => {
    const scene = createEmptyScene(10, 10);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    const s2 = moveBooth(s1, s1.booths[0].id, { x: 9, y: 9 });
    expect(s2).toBeNull();
  });

  it('移动到重叠位置应返回 null', () => {
    const scene = createEmptyScene(15, 15);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    // 在目标位置放障碍
    const s2 = addObstacle(s1, { x: 7, y: 6 })!;
    // 移动展位到障碍位置
    const s3 = moveBooth(s2, s1.booths[0].id, { x: 7, y: 5 });
    expect(s3).toBeNull();
  });
});

describe('更新展位属性', () => {
  it('更新服务时长应生效', () => {
    const scene = createEmptyScene(10, 10);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    const s2 = updateBoothService(s1, s1.booths[0].id, 6, 10);
    expect(s2).not.toBeNull();
    expect(s2!.booths[0].serviceTicksMin).toBe(6);
    expect(s2!.booths[0].serviceTicksMax).toBe(10);
  });

  it('非法服务时长应返回 null', () => {
    const scene = createEmptyScene(10, 10);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    expect(updateBoothService(s1, s1.booths[0].id, 0, 10)).toBeNull();
    expect(updateBoothService(s1, s1.booths[0].id, 10, 5)).toBeNull();
    expect(updateBoothService(s1, s1.booths[0].id, 5, 200)).toBeNull();
  });

  it('更新队列长度应重新生成队列格', () => {
    const scene = createEmptyScene(15, 15);
    const s1 = addBooth(scene, { x: 5, y: 3 })!;
    const s2 = updateBoothQueueLength(s1, s1.booths[0].id, 5);
    expect(s2).not.toBeNull();
    expect(s2!.booths[0].queueCells).toHaveLength(5);
  });
});

describe('ID 生成', () => {
  it('nextBoothId 应跳过已用 ID', () => {
    const scene: Scene = {
      schemaVersion: SCHEMA_VERSION,
      width: 20,
      height: 20,
      obstacles: [],
      entrances: [],
      exits: [],
      booths: [
        {
          id: 'booth-1',
          footprint: { x: 5, y: 5 },
          serviceCell: { x: 5, y: 6 },
          queueCells: [{ x: 5, y: 7 }],
          serviceTicksMin: 4,
          serviceTicksMax: 8,
        },
        {
          id: 'booth-3',
          footprint: { x: 8, y: 5 },
          serviceCell: { x: 8, y: 6 },
          queueCells: [{ x: 8, y: 7 }],
          serviceTicksMin: 4,
          serviceTicksMax: 8,
        },
      ],
    };
    expect(nextBoothId(scene)).toBe('booth-2');
  });
});

describe('操作后场景一致性', () => {
  it('合法操作后场景仍应通过结构校验', () => {
    const scene = createEmptyScene(15, 15);
    const s1 = addBooth(scene, { x: 5, y: 5 })!;
    const s2 = addEntrance(s1, { x: 0, y: 7 })!;
    const s3 = addExit(s2, { x: 14, y: 7 })!;
    const result = validateScene(s3);
    expect(result.ok).toBe(true);
  });

  it('canPlaceAt 对空格返回 true', () => {
    const scene = createEmptyScene(10, 10);
    expect(canPlaceAt(scene, { x: 5, y: 5 })).toBe(true);
  });

  it('removeBooth 不存在的 ID 返回 null', () => {
    const scene = createEmptyScene(10, 10);
    expect(removeBooth(scene, 'no-such')).toBeNull();
  });
});
