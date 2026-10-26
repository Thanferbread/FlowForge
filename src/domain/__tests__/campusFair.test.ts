/**
 * 校园招聘会示例平移空间验证：每个展位至少有一个方向 1–3 格平移后仍合法。
 * 对应 spec 5.6.1.3「示例中每个展位须支持整体平移 1–3 格的搜索」。
 */
import { describe, it, expect } from 'vitest';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { moveBooth } from '../operations';
import type { GridPos } from '../types';

const DIRECTIONS: GridPos[] = [
  { x: 0, y: -1 }, // 上
  { x: 0, y: 1 }, // 下
  { x: -1, y: 0 }, // 左
  { x: 1, y: 0 }, // 右
];
const DISTANCES = [1, 2, 3];

describe('校园招聘会示例平移空间', () => {
  it('每个展位至少有一个方向 1–3 格平移后仍合法', () => {
    const scene = createCampusFairScene();
    for (const booth of scene.booths) {
      const candidates: { dir: GridPos; dist: number; ok: boolean }[] = [];
      for (const dir of DIRECTIONS) {
        for (const dist of DISTANCES) {
          const newFootprint: GridPos = {
            x: booth.footprint.x + dir.x * dist,
            y: booth.footprint.y + dir.y * dist,
          };
          const result = moveBooth(scene, booth.id, newFootprint);
          candidates.push({ dir, dist, ok: result !== null });
        }
      }
      const hasValid = candidates.some((c) => c.ok);
      expect(hasValid).toBe(true);
    }
  });

  it('示例场景应包含多个展位', () => {
    const scene = createCampusFairScene();
    expect(scene.booths.length).toBeGreaterThanOrEqual(2);
  });
});
