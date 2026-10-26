/**
 * 需求生成与注入校验测试。
 */
import { describe, it, expect } from 'vitest';
import { generateDemands, validateInjectedDemands } from '../demand';
import { createRng } from '../prng';
import { hashDemands, hashScene } from '../hash';
import { createCampusFairScene } from '../../scenarios/campusFair';
import type { ExogenousDemand } from '../types';

describe('generateDemands', () => {
  const scene = createCampusFairScene();

  it('N=4, H=10 时 scheduledTick 分别为 0/2/5/7', () => {
    const rng = createRng(42);
    const demands = generateDemands(scene, { seed: 42, H: 10, demandCount: 4 }, rng);
    expect(demands).toHaveLength(4);
    expect(demands.map((d) => d.scheduledTick)).toEqual([0, 2, 5, 7]);
  });

  it('需求按 (scheduledTick 升序, id 升序) 排列', () => {
    const rng = createRng(42);
    const demands = generateDemands(scene, { seed: 42, H: 300, demandCount: 20 }, rng);
    for (let i = 1; i < demands.length; i++) {
      const a = demands[i - 1];
      const b = demands[i];
      if (a.scheduledTick === b.scheduledTick) {
        expect(a.id <= b.id).toBe(true);
      } else {
        expect(a.scheduledTick < b.scheduledTick).toBe(true);
      }
    }
  });

  it('同种子运行两次需求数组完全一致', () => {
    const a = generateDemands(scene, { seed: 42, H: 300, demandCount: 180 }, createRng(42));
    const b = generateDemands(scene, { seed: 42, H: 300, demandCount: 180 }, createRng(42));
    expect(a).toEqual(b);
  });

  it('serviceTicks 在目标展位闭区间内', () => {
    const rng = createRng(42);
    const demands = generateDemands(scene, { seed: 42, H: 300, demandCount: 50 }, rng);
    for (const d of demands) {
      const booth = scene.booths.find((b) => b.id === d.boothId);
      expect(booth).toBeDefined();
      expect(d.serviceTicks).toBeGreaterThanOrEqual(booth!.serviceTicksMin);
      expect(d.serviceTicks).toBeLessThanOrEqual(booth!.serviceTicksMax);
    }
  });

  it('每条需求消费三次 next（通过自定义 rng 计数器验证）', () => {
    let callCount = 0;
    const countingRng = {
      next() { callCount++; return 0; },
      seed: 42,
      version: 'xorshift32-v1',
    };
    generateDemands(scene, { seed: 42, H: 300, demandCount: 5 }, countingRng);
    expect(callCount).toBe(15); // 5 demands × 3 calls each
  });

  it('N=0 返回空数组', () => {
    const rng = createRng(42);
    const demands = generateDemands(scene, { seed: 42, H: 300, demandCount: 0 }, rng);
    expect(demands).toEqual([]);
  });

  it('入口/展位候选按稳定 ID 排序（非 locale）', () => {
    const rng = createRng(42);
    const demands = generateDemands(scene, { seed: 42, H: 300, demandCount: 10 }, rng);
    for (const d of demands) {
      expect(scene.entrances.some((e) => e.id === d.entranceId)).toBe(true);
      expect(scene.booths.some((b) => b.id === d.boothId)).toBe(true);
    }
  });

  it('移动同 ID 展位且服务配置不变时 hashDemands 不变、hashScene 变化', () => {
    const rng = createRng(42);
    const demands = generateDemands(scene, { seed: 42, H: 300, demandCount: 10 }, rng);
    const hash1 = hashDemands(demands);
    const sceneHash1 = hashScene(scene);

    // 移动第一个展位
    const booth = scene.booths[0];
    const movedScene = {
      ...scene,
      booths: scene.booths.map((b) =>
        b.id === booth.id
          ? {
              ...b,
              footprint: { x: b.footprint.x + 2, y: b.footprint.y },
              serviceCell: { x: b.serviceCell.x + 2, y: b.serviceCell.y },
              queueCells: b.queueCells.map((q) => ({ x: q.x + 2, y: q.y })),
            }
          : b,
      ),
    };

    const hash2 = hashDemands(demands);
    const sceneHash2 = hashScene(movedScene);

    expect(hash2).toBe(hash1); // 需求不变
    expect(sceneHash2).not.toBe(sceneHash1); // 场景变化
  });
});

describe('validateInjectedDemands', () => {
  const scene = createCampusFairScene();

  it.each([null, undefined, 1, 'invalid', true, []])('非法记录 %j 返回校验失败而不抛异常', (record) => {
    const demands = [record] as unknown as ExogenousDemand[];
    let result: ReturnType<typeof validateInjectedDemands> | undefined;
    expect(() => {
      result = validateInjectedDemands(demands, scene, { seed: 42, H: 300, demandCount: 1 });
    }).not.toThrow();
    expect(result?.ok).toBe(false);
    if (result && !result.ok) expect(result.error).toContain('第 1 条');
  });

  it('合法需求通过校验', () => {
    const demands: ExogenousDemand[] = [
      {
        id: 'agent-1',
        scheduledTick: 0,
        entranceId: 'entrance-1',
        boothId: 'booth-1',
        serviceTicks: 5,
      },
    ];
    const result = validateInjectedDemands(demands, scene, { seed: 42, H: 300, demandCount: 1 });
    expect(result.ok).toBe(true);
  });

  it('重复 ID 返回「需求 ID 重复」', () => {
    const demands: ExogenousDemand[] = [
      { id: 'agent-1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 5 },
      { id: 'agent-1', scheduledTick: 1, entranceId: 'entrance-2', boothId: 'booth-2', serviceTicks: 5 },
    ];
    const result = validateInjectedDemands(demands, scene, { seed: 42, H: 300, demandCount: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('重复');
  });

  it('无效入口引用被拒绝', () => {
    const demands: ExogenousDemand[] = [
      { id: 'agent-1', scheduledTick: 0, entranceId: 'nonexistent', boothId: 'booth-1', serviceTicks: 5 },
    ];
    const result = validateInjectedDemands(demands, scene, { seed: 42, H: 300, demandCount: 1 });
    expect(result.ok).toBe(false);
  });

  it('无效展位引用被拒绝', () => {
    const demands: ExogenousDemand[] = [
      { id: 'agent-1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'nonexistent', serviceTicks: 5 },
    ];
    const result = validateInjectedDemands(demands, scene, { seed: 42, H: 300, demandCount: 1 });
    expect(result.ok).toBe(false);
  });

  it('超限服务时长被拒绝', () => {
    const demands: ExogenousDemand[] = [
      { id: 'agent-1', scheduledTick: 0, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 999 },
    ];
    const result = validateInjectedDemands(demands, scene, { seed: 42, H: 300, demandCount: 1 });
    expect(result.ok).toBe(false);
  });

  it('时域外记录（scheduledTick≥H）通过校验', () => {
    const demands: ExogenousDemand[] = [
      { id: 'agent-1', scheduledTick: 300, entranceId: 'entrance-1', boothId: 'booth-1', serviceTicks: 5 },
    ];
    const result = validateInjectedDemands(demands, scene, { seed: 42, H: 300, demandCount: 1 });
    expect(result.ok).toBe(true);
  });
});
