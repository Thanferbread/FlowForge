/**
 * 运行报告测试。
 *
 * 断言报告字段完整、核心报告字节可比、hash 覆盖、事件排序、矩阵排序。
 */
import { describe, it, expect } from 'vitest';
import { createEngine } from '../engine';
import { createCampusFairScene } from '../../scenarios/campusFair';
import type { Scene } from '../../domain/types';
import { stableStringify, hashScene, hashDemands } from '../hash';
import type { RunReport } from '../types';

/** 获取核心报告（排除 nonCoreMetadata） */
function coreReport(report: RunReport): string {
  const { nonCoreMetadata: _, ...core } = report;
  return stableStringify(core);
}

describe('报告字段完整性', () => {
  it('真实运行报告包含所有必要字段', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(50);
    const report = engine.getReport({ speed: 1, exportTimestamp: '2026-10-26T00:00:00Z' });

    expect(report.modelVersion).toBeTruthy();
    expect(report.generatorVersion).toBeTruthy();
    expect(report.hashVersion).toBeTruthy();
    expect(report.serializationVersion).toBeTruthy();
    expect(report.limits).toBeDefined();
    expect(report.limits.minH).toBe(1);
    expect(report.limits.maxH).toBe(1800);
    expect(report.sceneSnapshot).toBeDefined();
    expect(report.sceneHash).toBeTruthy();
    expect(report.config).toBeDefined();
    expect(report.demandSource).toBe('generated');
    expect(report.configDemandCount).toBe(10);
    expect(report.demands).toBeDefined();
    expect(report.demands.length).toBe(10);
    expect(report.demandHash).toBeTruthy();
    expect(report.H).toBe(50);
    expect(report.executedTicks).toBe(50);
    expect(report.isComplete).toBe(true);
    expect(report.failureDiagnostic).toBe(null);
    expect(report.trace).toBeDefined();
    expect(report.trace.length).toBe(50);
    expect(report.events).toBeDefined();
    expect(report.metrics).toBeDefined();
    expect(report.occupancyMatrix).toBeDefined();
    expect(report.sampleCount).toBe(50);
    expect(report.congestionExposure).toBeGreaterThanOrEqual(0);
    expect(report.stagnationDiagnostics).toBeDefined();
    expect(report.nonCoreMetadata).toBeDefined();
    expect(report.nonCoreMetadata.speed).toBe(1);
    expect(report.nonCoreMetadata.exportTimestamp).toBe('2026-10-26T00:00:00Z');
  });
});

describe('核心报告字节可比', () => {
  it('同输入同 tick 不同速度，核心报告一致', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 50, demandCount: 10 };

    const r1 = createEngine(scene, config);
    const r2 = createEngine(scene, config);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    r1.engine.runTo(50);
    r2.engine.runTo(50);

    const report1 = r1.engine.getReport({ speed: 1, exportTimestamp: '2026-01-01T00:00:00Z' });
    const report2 = r2.engine.getReport({ speed: 16, exportTimestamp: '2026-12-31T23:59:59Z' });

    expect(coreReport(report1)).toBe(coreReport(report2));
  });
});

describe('需求 hash 覆盖完整输入', () => {
  it('hash 覆盖完整稳定排序输入数组', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    const report = engine.getReport();

    const expectedHash = hashDemands(report.demands);
    expect(report.demandHash).toBe(expectedHash);
  });
});

describe('场景 hash', () => {
  it('移动展位后场景 hash 变化', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 10, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    const report = engine.getReport();

    const originalHash = hashScene(scene);
    expect(report.sceneHash).toBe(originalHash);

    const modifiedScene: Scene = {
      ...scene,
      booths: scene.booths.map((b, i) =>
        i === 0
          ? { ...b, footprint: { x: b.footprint.x + 1, y: b.footprint.y } }
          : b,
      ),
    };
    const modifiedHash = hashScene(modifiedScene);
    expect(modifiedHash).not.toBe(originalHash);
  });
});

describe('事件排序', () => {
  it('事件按 (tick, 固定类型顺序, agentId) 排列', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 30, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(30);
    const report = engine.getReport();

    const events = report.events;
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      expect(prev.tick).toBeLessThanOrEqual(curr.tick);
    }
  });
});

describe('占用矩阵按 y/x 行序', () => {
  it('矩阵条目按 y 升序、x 升序排列', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 20, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(20);
    const report = engine.getReport();

    const matrix = report.occupancyMatrix;
    for (let i = 1; i < matrix.length; i++) {
      const prev = matrix[i - 1];
      const curr = matrix[i];
      if (prev.pos.y === curr.pos.y) {
        expect(prev.pos.x).toBeLessThanOrEqual(curr.pos.x);
      } else {
        expect(prev.pos.y).toBeLessThan(curr.pos.y);
      }
    }
  });
});

describe('报告无敏感信息', () => {
  it('报告 JSON 不含密码/密钥/token', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 10, demandCount: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    const report = engine.getReport();
    const json = stableStringify(report);

    expect(json.toLowerCase()).not.toContain('password');
    expect(json.toLowerCase()).not.toContain('secret');
    expect(json.toLowerCase()).not.toContain('apikey');
    expect(json.toLowerCase()).not.toContain('token');
  });
});

describe('部分运行报告', () => {
  it('initialized 状态可导出空报告', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const report = result.engine.getReport();
    expect(report.executedTicks).toBe(0);
    expect(report.trace.length).toBe(0);
    expect(report.sampleCount).toBe(0);
    expect(report.isComplete).toBe(false);
  });

  it('部分运行 trace 长度与 sampleCount 一致', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(20);
    const report = engine.getReport();

    expect(report.trace.length).toBe(report.sampleCount);
    expect(report.executedTicks).toBe(20);
  });
});
