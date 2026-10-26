/**
 * 内置校园招聘会示例场景（示意，非真实场地）。
 *
 * 32×22 格，两个入口在底部边界，两个出口在顶部边界。
 * 6 个展位分两列三行排列，每个展位含实体 + 服务格 + 3 格队列。
 * 少量障碍作为展位侧板装饰，不影响连通性。
 *
 * 该场景完整合法，可作为后续拥堵仿真基线。
 * 没有仿真实验前不声称已验证存在拥堵或可改善百分比。
 */
import type { Scene, Booth, Portal, GridPos } from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';

export const CAMPUS_FAIR_WIDTH = 32;
export const CAMPUS_FAIR_HEIGHT = 22;

/** 创建校园招聘会示例场景 */
export function createCampusFairScene(): Scene {
  const width = CAMPUS_FAIR_WIDTH;
  const height = CAMPUS_FAIR_HEIGHT;

  const entrances: Portal[] = [
    { id: 'entrance-1', pos: { x: 8, y: height - 1 } },
    { id: 'entrance-2', pos: { x: 23, y: height - 1 } },
  ];

  const exits: Portal[] = [
    { id: 'exit-1', pos: { x: 8, y: 0 } },
    { id: 'exit-2', pos: { x: 23, y: 0 } },
  ];

  // 两列展位，每列 3 个；服务格在实体下方（朝向入口），队列继续向下
  const colX = [10, 21];
  const rowY = [5, 10, 15];
  const booths: Booth[] = [];
  let num = 1;
  for (const x of colX) {
    for (const y of rowY) {
      booths.push({
        id: `booth-${num}`,
        footprint: { x, y },
        serviceCell: { x, y: y + 1 },
        queueCells: [
          { x, y: y + 2 },
          { x, y: y + 3 },
          { x, y: y + 4 },
        ],
        serviceTicksMin: 4,
        serviceTicksMax: 8,
      });
      num++;
    }
  }

  // 装饰性障碍：展位实体左右两侧的侧板，增强视觉真实感，不影响连通性
  const obstacles: GridPos[] = [];
  for (const x of colX) {
    for (const y of rowY) {
      obstacles.push({ x: x - 1, y });
      obstacles.push({ x: x + 1, y });
    }
  }

  // 顶部和底部添加少量隔断墙，留出主通道
  // 在 y=2 和 y=height-3 处加水平短墙，中间留通道
  obstacles.push({ x: 4, y: 2 });
  obstacles.push({ x: 5, y: 2 });
  obstacles.push({ x: 26, y: 2 });
  obstacles.push({ x: 27, y: 2 });
  obstacles.push({ x: 4, y: height - 3 });
  obstacles.push({ x: 5, y: height - 3 });
  obstacles.push({ x: 26, y: height - 3 });
  obstacles.push({ x: 27, y: height - 3 });

  return {
    schemaVersion: SCHEMA_VERSION,
    width,
    height,
    obstacles,
    entrances,
    exits,
    booths,
  };
}
