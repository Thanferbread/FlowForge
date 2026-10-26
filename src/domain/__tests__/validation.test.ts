/**
 * 场景校验测试：正常示例、封闭通路、越界/重叠、服务/队列连接。
 */
import { describe, it, expect } from 'vitest';
import { validateScene, validateStructure, validateBusiness } from '../validation';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { createEmptyScene } from '../geometry';
import type { Scene, Booth } from '../types';
import { SCHEMA_VERSION } from '../types';

/** 构建一个最小合法场景的辅助函数 */
function makeValidMiniScene(): Scene {
  // 7×7 地图：入口底部 (3,6)，出口顶部 (3,0)
  // 展位实体 (3,3)，服务格 (3,4)，队列 (3,5),(3,6)? 不行 (3,6)是入口
  // 改：展位实体 (2,3)，服务格 (2,4)，队列 (2,5)
  // 但队列只有1格，队尾(2,5)邻居普通地面 (1,5),(3,5),(2,6)
  // 入口 (3,6)，从入口能到 (3,5)→(2,5)的邻居？(3,5)是普通地面，(2,5)是队列格
  // 队尾(2,5)的邻居(3,5)普通地面，从入口(3,6)→(3,5)可达 ✓
  // q0=(2,4)邻居普通地面(1,4),(3,4)（上方(2,3)实体，下方(2,5)队列）
  // 从(3,4)→(3,0)出口 ✓
  return {
    schemaVersion: SCHEMA_VERSION,
    width: 7,
    height: 7,
    obstacles: [],
    entrances: [{ id: 'entrance-1', pos: { x: 3, y: 6 } }],
    exits: [{ id: 'exit-1', pos: { x: 3, y: 0 } }],
    booths: [
      {
        id: 'booth-1',
        footprint: { x: 2, y: 3 },
        serviceCell: { x: 2, y: 4 },
        queueCells: [{ x: 2, y: 5 }],
        serviceTicksMin: 4,
        serviceTicksMax: 8,
      },
    ],
  };
}

describe('正常示例校验', () => {
  it('校园招聘会示例应完整合法', () => {
    const scene = createCampusFairScene();
    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    expect(result.readyForSimulation).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('最小合法场景应通过校验', () => {
    const scene = makeValidMiniScene();
    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    expect(result.readyForSimulation).toBe(true);
  });

  it('空地图应显示缺少入口、出口和展位', () => {
    const scene = createEmptyScene(10, 10);
    const result = validateScene(scene);
    expect(result.ok).toBe(true); // 结构合法
    expect(result.readyForSimulation).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('NO_ENTRANCE');
    expect(codes).toContain('NO_EXIT');
    expect(codes).toContain('NO_BOOTH');
  });
});

describe('封闭通路校验', () => {
  it('用障碍封死唯一通道时入口无法到达出口', () => {
    const scene = makeValidMiniScene();
    // 在 x=3 列的 y=1..5 放满障碍，封死入口到出口的 x=3 通道
    // 但要留其他路径？7×7，入口(3,6)出口(3,0)
    // 在 y=1 整行放障碍除 x=3 外，再封 x=3,y=1
    // 简单做法：在出口周围放障碍使其不可达
    const blocked: Scene = {
      ...scene,
      obstacles: [
        { x: 2, y: 0 },
        { x: 4, y: 0 },
        { x: 2, y: 1 },
        { x: 3, y: 1 },
        { x: 4, y: 1 },
      ],
    };
    const result = validateScene(blocked);
    expect(result.ok).toBe(true);
    expect(result.readyForSimulation).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('ENTRANCE_NO_EXIT');
  });

  it('删除出口后应报告缺少出口', () => {
    const scene = makeValidMiniScene();
    const noExit: Scene = { ...scene, exits: [] };
    const result = validateScene(noExit);
    expect(result.readyForSimulation).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('NO_EXIT');
  });

  it('服务格被障碍包围无法离开时应报告', () => {
    // 构造：展位服务格 q0 的所有普通地面邻居被障碍封死
    const scene: Scene = {
      schemaVersion: SCHEMA_VERSION,
      width: 9,
      height: 9,
      obstacles: [
        { x: 3, y: 3 },
        { x: 5, y: 3 },
        { x: 3, y: 5 },
        { x: 5, y: 5 },
      ],
      entrances: [{ id: 'entrance-1', pos: { x: 0, y: 8 } }],
      exits: [{ id: 'exit-1', pos: { x: 8, y: 0 } }],
      booths: [
        {
          id: 'booth-1',
          footprint: { x: 4, y: 2 },
          serviceCell: { x: 4, y: 3 },
          queueCells: [{ x: 4, y: 4 }],
          serviceTicksMin: 4,
          serviceTicksMax: 8,
        },
      ],
    };
    // serviceCell (4,3) 邻居：(3,3)障碍 (5,3)障碍 (4,2)实体 (4,4)队列
    // 所以服务格无普通地面邻居 → SERVICE_NO_EXIT
    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    expect(result.readyForSimulation).toBe(false);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('SERVICE_NO_EXIT');
  });
});

describe('越界与重叠校验', () => {
  it('宽高超出上限应报结构错误', () => {
    const scene: Scene = { ...makeValidMiniScene(), width: 100 };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'WIDTH')).toBe(true);
  });

  it('坐标越界应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      obstacles: [{ x: 100, y: 100 }],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'OUT_OF_BOUNDS')).toBe(true);
  });

  it('入口不在边界应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      entrances: [{ id: 'entrance-1', pos: { x: 3, y: 3 } }],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'ENTRANCE_NOT_BOUNDARY')).toBe(true);
  });

  it('对象重叠应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      obstacles: [{ x: 2, y: 3 }], // 与展位实体重叠
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'OVERLAP')).toBe(true);
  });

  it('重复 ID 应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      exits: [
        { id: 'exit-1', pos: { x: 3, y: 0 } },
        { id: 'exit-1', pos: { x: 4, y: 0 } },
      ],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'ID_DUPLICATE')).toBe(true);
  });

  it('非整数坐标应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      obstacles: [{ x: 1.5, y: 2 }],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'COORD_NOT_INT')).toBe(true);
  });
});

describe('服务与队列连接校验', () => {
  it('服务格与队列格不沿同一直线应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      booths: [
        {
          id: 'booth-1',
          footprint: { x: 2, y: 3 },
          serviceCell: { x: 2, y: 4 },
          queueCells: [{ x: 2, y: 5 }, { x: 3, y: 5 }], // q0→q1 向下，q1→q2 向右
          serviceTicksMin: 4,
          serviceTicksMax: 8,
        },
      ],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'QUEUE_NOT_LINEAR')).toBe(true);
  });

  it('队列中段拐弯应报结构错误', () => {
    const scene = makeValidMiniScene();
    scene.booths[0].queueCells = [{ x: 2, y: 5 }, { x: 2, y: 6 }, { x: 1, y: 6 }];
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'QUEUE_NOT_LINEAR')).toBe(true);
  });

  it('服务格不与实体相邻应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      booths: [
        {
          id: 'booth-1',
          footprint: { x: 2, y: 3 },
          serviceCell: { x: 4, y: 4 }, // 不相邻
          queueCells: [{ x: 4, y: 5 }],
          serviceTicksMin: 4,
          serviceTicksMax: 8,
        },
      ],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'SERVICE_NOT_ADJACENT')).toBe(true);
  });

  it('服务时长下限大于上限应报结构错误', () => {
    const scene: Scene = {
      ...makeValidMiniScene(),
      booths: [
        {
          ...(makeValidMiniScene().booths[0] as Booth),
          serviceTicksMin: 10,
          serviceTicksMax: 5,
        },
      ],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === 'SERVICE_RANGE')).toBe(true);
  });

  it('队尾无法从入口到达应报业务问题', () => {
    // 构造一个队尾被隔离的场景
    const scene: Scene = {
      schemaVersion: SCHEMA_VERSION,
      width: 9,
      height: 9,
      obstacles: [
        // 围绕队尾 (4,6) 的普通地面邻居放障碍
        { x: 3, y: 6 },
        { x: 5, y: 6 },
        { x: 4, y: 7 },
      ],
      entrances: [{ id: 'entrance-1', pos: { x: 0, y: 8 } }],
      exits: [{ id: 'exit-1', pos: { x: 8, y: 0 } }],
      booths: [
        {
          id: 'booth-1',
          footprint: { x: 4, y: 4 },
          serviceCell: { x: 4, y: 5 },
          queueCells: [{ x: 4, y: 6 }],
          serviceTicksMin: 4,
          serviceTicksMax: 8,
        },
      ],
    };
    // 队尾 (4,6) 邻居：(3,6)障碍 (5,6)障碍 (4,5)服务格 (4,7)障碍
    // 无普通地面邻居 → QUEUE_TAIL_ISOLATED
    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    expect(result.readyForSimulation).toBe(false);
    expect(result.issues.some((i) => i.code === 'QUEUE_TAIL_ISOLATED')).toBe(true);
  });
});

describe('结构校验与业务校验分离', () => {
  it('结构错误时不运行业务校验', () => {
    const scene: Scene = { ...makeValidMiniScene(), width: 1 };
    const structIssues = validateStructure(scene);
    expect(structIssues.some((i) => i.severity === 'error')).toBe(true);
    // validateScene 在结构错误时直接返回，不调 validateBusiness
    const result = validateScene(scene);
    expect(result.issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('业务校验只产生 warning', () => {
    const scene = makeValidMiniScene();
    const bizIssues = validateBusiness(scene);
    expect(bizIssues.every((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('校验数据模型（status / counts）', () => {
  it('合法示例场景 status===ready 且 counts 与真实计数一致', () => {
    const scene = createCampusFairScene();
    const result = validateScene(scene);
    expect(result.status).toBe('ready');
    expect(result.counts.boothCount).toBe(scene.booths.length);
    expect(result.counts.obstacleCount).toBe(scene.obstacles.length);
    expect(result.counts.entranceCount).toBe(scene.entrances.length);
    expect(result.counts.exitCount).toBe(scene.exits.length);
    expect(result.counts.totalCells).toBe(scene.width * scene.height);
    // walkableCells = totalCells - 障碍 - 展位实体 - 服务格 - 队列格
    const blockedCount =
      scene.obstacles.length +
      scene.booths.length +
      scene.booths.length +
      scene.booths.reduce((s, b) => s + b.queueCells.length, 0);
    expect(result.counts.walkableCells).toBe(scene.width * scene.height - blockedCount);
  });

  it('结构错误场景 status===structural_error 且 counts 仍被填充', () => {
    const scene: Scene = { ...makeValidMiniScene(), width: 100 };
    const result = validateScene(scene);
    expect(result.status).toBe('structural_error');
    expect(result.counts).toBeDefined();
    // counts 仍应反映 scene 数组长度（即使 totalCells 因宽高非法为 0）
    expect(result.counts.boothCount).toBe(scene.booths.length);
    expect(result.counts.entranceCount).toBe(scene.entrances.length);
  });

  it('草稿场景（缺出口）status===draft', () => {
    const scene = makeValidMiniScene();
    const noExit: Scene = { ...scene, exits: [] };
    const result = validateScene(noExit);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('draft');
  });
});

describe('逐入口队尾可达性语义', () => {
  it('多入口场景中一入口被隔离无法到达展位队尾应报 QUEUE_TAIL_UNREACHABLE_FROM_ENTRANCE', () => {
    // 构造：两个入口，entrance-1 正常，entrance-2 被障碍隔离无法到达展位队尾
    // 12×12 地图，展位实体 (5,5)，服务格 (5,6)，队列 (5,7)
    // entrance-1 在 (0,11) 底部左侧，可达
    // entrance-2 在 (11,11) 底部右侧，用贯穿 x=8 列的障碍墙封死使其无法到达左侧
    const scene: Scene = {
      schemaVersion: SCHEMA_VERSION,
      width: 12,
      height: 12,
      obstacles: [
        // 必须封满 y=0…11，否则可从底边绕过障碍墙。
        { x: 8, y: 0 },
        { x: 8, y: 1 },
        { x: 8, y: 2 },
        { x: 8, y: 3 },
        { x: 8, y: 4 },
        { x: 8, y: 5 },
        { x: 8, y: 6 },
        { x: 8, y: 7 },
        { x: 8, y: 8 },
        { x: 8, y: 9 },
        { x: 8, y: 10 },
        { x: 8, y: 11 },
      ],
      entrances: [
        { id: 'entrance-1', pos: { x: 0, y: 11 } },
        { id: 'entrance-2', pos: { x: 11, y: 11 } },
      ],
      exits: [
        { id: 'exit-1', pos: { x: 0, y: 0 } },
        { id: 'exit-2', pos: { x: 11, y: 0 } },
      ],
      booths: [
        {
          id: 'booth-1',
          footprint: { x: 5, y: 5 },
          serviceCell: { x: 5, y: 6 },
          queueCells: [{ x: 5, y: 7 }],
          serviceTicksMin: 4,
          serviceTicksMax: 8,
        },
      ],
    };
    const result = validateScene(scene);
    expect(result.ok).toBe(true);
    expect(result.status).toBe('draft');
    const codes = result.issues.map((i) => i.code);
    // entrance-2 被障碍墙隔离在右半区，无法到达展位队尾 (5,7) 的相邻普通地面
    expect(codes).toContain('QUEUE_TAIL_UNREACHABLE_FROM_ENTRANCE');
    expect(result.issues.filter((issue) => issue.code === 'QUEUE_TAIL_UNREACHABLE_FROM_ENTRANCE'))
      .toEqual([expect.objectContaining({ message: expect.stringContaining('entrance-2') })]);
    expect(codes).not.toContain('ENTRANCE_NO_EXIT');
    // entrance-2 也无法到达 exit-1（在左半区），但能到 exit-2
    // entrance-1 能到达展位队尾和 exit-1

    // 打开底边通道后两个入口均可绕过墙到达队尾，整个场景恢复 ready。
    const opened: Scene = {
      ...scene,
      obstacles: scene.obstacles.filter((pos) => pos.y !== 11),
    };
    expect(validateScene(opened).status).toBe('ready');
  });

  it('所有入口均可到达队尾时不报 QUEUE_TAIL_UNREACHABLE_FROM_ENTRANCE', () => {
    const scene = createCampusFairScene();
    const result = validateScene(scene);
    const codes = result.issues.map((i) => i.code);
    expect(codes).not.toContain('QUEUE_TAIL_UNREACHABLE_FROM_ENTRANCE');
  });
});
