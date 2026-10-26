/**
 * 几何辅助函数：纯函数，不依赖 React/Canvas。
 */
import type { GridPos, Scene } from './types';
import { SCHEMA_VERSION } from './types';

/** 将坐标转为字符串键，用于 Map/Set */
export function posKey(p: GridPos): string {
  return `${p.x},${p.y}`;
}

/** 坐标相等判断 */
export function posEqual(a: GridPos, b: GridPos): boolean {
  return a.x === b.x && a.y === b.y;
}

/** 坐标是否在地图范围内 */
export function inBounds(p: GridPos, width: number, height: number): boolean {
  return p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
}

/** 坐标是否在地图边界上 */
export function isOnBoundary(p: GridPos, width: number, height: number): boolean {
  return p.x === 0 || p.x === width - 1 || p.y === 0 || p.y === height - 1;
}

/** 两个坐标是否正交相邻（四邻接） */
export function areAdjacent(a: GridPos, b: GridPos): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

/**
 * 判断格子序列是否沿同一直线连续相邻。
 * 序列长度 < 2 时视为合法。
 */
export function isStraightLine(cells: GridPos[]): boolean {
  if (cells.length < 2) return true;
  const first = cells[0];
  const second = cells[1];
  const dx = Math.sign(second.x - first.x);
  const dy = Math.sign(second.y - first.y);
  // 必须是正交方向（水平或垂直）
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  for (let i = 1; i < cells.length; i++) {
    const expectedX = first.x + dx * i;
    const expectedY = first.y + dy * i;
    if (cells[i].x !== expectedX || cells[i].y !== expectedY) return false;
  }
  return true;
}

/** 四个正交方向 */
export const ORTHO_DIRS: readonly GridPos[] = [
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: -1, y: 0 },
];

/**
 * 正交逐格路径插值：返回从 from 到 to 的正交相邻格序列。
 *
 * - from === to 时返回 [to]。
 * - 水平（y 相同）或垂直（x 相同）时返回含两端的所有中间格。
 * - 非正交时返回先沿 x 后沿 y 的曼哈顿路径。
 *
 * 返回数组首元素为 from、末元素为 to，相邻元素正交相邻（|dx|+|dy|===1）。
 * 纯函数，不依赖 React/Canvas/DOM。
 */
export function orthoPath(from: GridPos, to: GridPos): GridPos[] {
  if (from.x === to.x && from.y === to.y) return [to];
  const path: GridPos[] = [{ ...from }];
  // 先沿 x 方向移动
  const dx = Math.sign(to.x - from.x);
  let x = from.x;
  while (x !== to.x) {
    x += dx;
    path.push({ x, y: from.y });
  }
  // 再沿 y 方向移动
  const dy = Math.sign(to.y - from.y);
  let y = from.y;
  while (y !== to.y) {
    y += dy;
    path.push({ x: to.x, y });
  }
  return path;
}

/** 创建空场景 */
export function createEmptyScene(width: number, height: number): Scene {
  return {
    schemaVersion: SCHEMA_VERSION,
    width,
    height,
    obstacles: [],
    entrances: [],
    exits: [],
    booths: [],
  };
}
