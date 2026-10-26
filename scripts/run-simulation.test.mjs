import { describe, it, expect } from 'vitest';
import { runHeadless } from '../src/simulation/headless.ts';
import { createCampusFairScene } from '../src/scenarios/campusFair.ts';
import { stableStringify } from '../src/simulation/hash.ts';
import fs from 'node:fs';
import path from 'node:path';

describe('headless 仿真运行', () => {
  it('默认参数运行并保存报告到 runs/', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 300, demandCount: 180 };

    const result = runHeadless(scene, config);
    const report = result.report;
    expect(report, result.ok ? undefined : result.error).toBeDefined();
    if (!report) throw new Error(result.error);
    const json = stableStringify(report);
    expect(JSON.parse(json)).toEqual(report);

    const runsDir = path.resolve(process.cwd(), 'runs');
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    // Wall time is export provenance only; it never enters the deterministic engine.
    const runId = (process.env.FLOWFORGE_RUN_ID ?? `${new Date().toISOString()}_${process.pid}`)
      .replace(/[^A-Za-z0-9_-]/g, '');
    let attempt = 1;
    let filePath;
    for (;;) {
      const attemptStr = String(attempt).padStart(2, '0');
      filePath = path.join(runsDir, `round2_${runId}_attempt${attemptStr}_seed42_H300.json`);
      attempt++;
      try {
        fs.writeFileSync(filePath, json, { encoding: 'utf-8', flag: 'wx' });
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    expect(JSON.parse(fs.readFileSync(filePath, 'utf-8'))).toEqual(report);

    console.log(`报告已保存到: ${filePath}`);
    console.log(`执行 tick: ${report.executedTicks}, 事件数: ${report.events.length}, 服务完成: ${report.metrics.serviceCompleted}`);
    expect(result.ok, result.ok ? undefined : result.error).toBe(true);
    expect(report.isComplete).toBe(true);
    expect(report.executedTicks).toBe(300);
    expect(report.trace.length).toBe(300);
    expect(report.events.length).toBeGreaterThan(0);
    expect(report.metrics.demandCount).toBe(180);
  }, 30000);
});
