/**
 * geometry 纯函数测试：orthoPath 路径插值。
 */
import { describe, it, expect } from 'vitest';
import { orthoPath, areAdjacent } from '../geometry';
import type { GridPos } from '../types';

describe('orthoPath 路径插值', () => {
  it('起点等于终点时返回单元素数组', () => {
    const p: GridPos = { x: 3, y: 4 };
    const path = orthoPath(p, p);
    expect(path).toHaveLength(1);
    expect(path[0]).toEqual(p);
  });

  it('水平路径应包含所有中间格', () => {
    const from: GridPos = { x: 2, y: 5 };
    const to: GridPos = { x: 6, y: 5 };
    const path = orthoPath(from, to);
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual(from);
    expect(path[4]).toEqual(to);
    expect(path).toEqual([
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 },
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ]);
  });

  it('水平反向路径应正确递减', () => {
    const from: GridPos = { x: 6, y: 5 };
    const to: GridPos = { x: 2, y: 5 };
    const path = orthoPath(from, to);
    expect(path).toHaveLength(5);
    expect(path[0]).toEqual(from);
    expect(path[4]).toEqual(to);
  });

  it('垂直路径应包含所有中间格', () => {
    const from: GridPos = { x: 4, y: 1 };
    const to: GridPos = { x: 4, y: 4 };
    const path = orthoPath(from, to);
    expect(path).toHaveLength(4);
    expect(path[0]).toEqual(from);
    expect(path[3]).toEqual(to);
  });

  it('一般曼哈顿路径先沿 x 后沿 y', () => {
    const from: GridPos = { x: 1, y: 1 };
    const to: GridPos = { x: 4, y: 3 };
    const path = orthoPath(from, to);
    // 曼哈顿距离 |4-1|+|3-1| = 5，路径长度 = 6
    expect(path).toHaveLength(6);
    expect(path[0]).toEqual(from);
    expect(path[5]).toEqual(to);
    // 先沿 x：(1,1)->(2,1)->(3,1)->(4,1)，再沿 y：(4,1)->(4,2)->(4,3)
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 1 },
      { x: 4, y: 2 },
      { x: 4, y: 3 },
    ]);
  });

  it('所有相邻元素正交相邻且路径长度等于曼哈顿距离加 1', () => {
    const cases: [GridPos, GridPos][] = [
      [{ x: 0, y: 0 }, { x: 0, y: 0 }],
      [{ x: 0, y: 0 }, { x: 5, y: 0 }],
      [{ x: 5, y: 0 }, { x: 0, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 5 }],
      [{ x: 3, y: 2 }, { x: 7, y: 8 }],
      [{ x: 7, y: 8 }, { x: 3, y: 2 }],
    ];
    for (const [from, to] of cases) {
      const path = orthoPath(from, to);
      const manhattan = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
      expect(path).toHaveLength(manhattan + 1);
      expect(path[0]).toEqual(from);
      expect(path[path.length - 1]).toEqual(to);
      for (let i = 1; i < path.length; i++) {
        expect(areAdjacent(path[i - 1], path[i])).toBe(true);
      }
    }
  });
});
