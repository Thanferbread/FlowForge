import { describe, expect, it } from 'vitest';
import { createEngine } from '../engine';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { stableStringify } from '../hash';
import type { Engine, ExogenousDemand } from '../types';

function makeEngine(H = 20, demands?: ExogenousDemand[]): Engine {
  const result = createEngine(createCampusFairScene(), { seed: 42, H, demandCount: 5 }, demands);
  if (!result.ok) throw new Error(result.error);
  return result.engine;
}

describe('R03/R04: query isolation and horizon boundaries', () => {
  it('caller changes to scene, config and demands do not change a frozen run', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 20, demandCount: 5 };
    const demands = [{ id: 'one', scheduledTick: 0, entranceId: scene.entrances[0].id,
      boothId: scene.booths[0].id, serviceTicks: 4 }];
    const result = createEngine(scene, config, demands);
    const controlResult = createEngine(scene, config, demands);
    if (!result.ok || !controlResult.ok) throw new Error('valid fixture was rejected');
    scene.obstacles[0].x = 999;
    scene.booths[0].queueCells[0].x = 999;
    config.H = 1;
    demands[0].scheduledTick = 999;
    demands[0].serviceTicks = 8;
    expect(result.engine.runTo(20).ok).toBe(true);
    expect(controlResult.engine.runTo(20).ok).toBe(true);
    expect(result.engine.getReport()).toEqual(controlResult.engine.getReport());
  });

  it('nested movement failures in both snapshot and report are detached', () => {
    const result = createEngine(createCampusFairScene(), { seed: 42, H: 60, demandCount: 180 });
    if (!result.ok) throw new Error(result.error);
    const engine = result.engine;
    expect(engine.runTo(30).ok).toBe(true);
    const blocked = engine.getReport().trace.find(snapshot => snapshot.moveFailures.length > 0);
    expect(blocked).toBeDefined();
    engine.reset();
    expect(engine.runTo(blocked!.tick).ok).toBe(true);
    const before = engine.getReport();
    const snapshot = engine.getSnapshot();
    snapshot.moveFailures[0].pos.x = 999;
    snapshot.moveFailures[0].agentId = 'externally-mutated';
    const report = engine.getReport();
    report.trace[report.trace.length - 1].moveFailures[0].pos.y = 999;
    report.events[0].pos!.x = 999;
    expect(engine.getReport()).toEqual(before);
  });

  it('returned report mutations cannot change history, snapshots or later execution', () => {
    const engine = makeEngine();
    const control = makeEngine();
    engine.runTo(4);
    control.runTo(4);
    const original = engine.getReport();
    const expected = stableStringify(control.getReport());
    original.trace[0].tick = 999;
    original.trace[3].agents[0].pos!.x = 999;
    original.events[0].tick = 999;
    original.sceneSnapshot.width = 1;
    original.demands[0].scheduledTick = 999;
    original.config.H = 1;
    expect(stableStringify(engine.getReport())).toBe(expected);
    expect(engine.getSnapshot()).toEqual(control.getSnapshot());
    engine.runTo(10);
    control.runTo(10);
    expect(engine.getReport()).toEqual(control.getReport());
  });

  it('uses configured H at initialization and every trace boundary', () => {
    const scene = createCampusFairScene();
    const demands = [0, 20, 21].map((scheduledTick, i) => ({
      id: `a${i}`, scheduledTick, entranceId: scene.entrances[0].id,
      boothId: scene.booths[0].id, serviceTicks: 4,
    }));
    const engine = makeEngine(20, demands);
    expect(engine.getSnapshot().notYetArrivedIds).toEqual(['a0']);
    engine.runTo(20);
    const report = engine.getReport();
    expect(report.totalInputRecords).toBe(3);
    expect(report.actualDemandCount).toBe(1);
    expect(report.demands).toHaveLength(3);
    for (const snapshot of report.trace) {
      expect(snapshot.notYetArrivedIds).toEqual([]);
      expect(snapshot.agents.map(agent => agent.id)).toEqual(['a0']);
    }
    expect(report.metrics.notYetArrived).toBe(0);
  });

  it('serializes a real report as JSON that preserves every value', () => {
    const engine = makeEngine();
    engine.runTo(20);
    const report = engine.getReport({ speed: 16, exportTimestamp: '2026-10-26T00:00:00Z' });
    expect(JSON.parse(stableStringify(report))).toEqual(report);
  });
});

describe('R09: lifecycle follows actual progress', () => {
  it('single steps and partial runTo pause; the final step completes', () => {
    const engine = makeEngine(3);
    expect(engine.step().ok).toBe(true);
    expect(engine.runState).toBe('paused');
    expect(engine.start().ok).toBe(true);
    expect(engine.runTo(2).ok).toBe(true);
    expect(engine.runState).toBe('paused');
    expect(engine.step().ok).toBe(true);
    expect(engine.runState).toBe('complete');
  });

  it('runTo cannot report success when cancellation prevents reaching its target', () => {
    const engine = makeEngine();
    engine.runTo(3);
    engine.cancel();
    const result = engine.runTo(10);
    expect(result.ok).toBe(false);
    expect(result.snapshot.tick).toBe(3);
    expect(engine.executedTicks).toBe(3);
    expect(engine.runState).toBe('cancelled');
  });

  it('initial partial runTo also pauses without changing valid repeated targets', () => {
    const engine = makeEngine();
    expect(engine.runTo(3).ok).toBe(true);
    expect(engine.runState).toBe('paused');
    const report = engine.getReport();
    expect(engine.runTo(3).ok).toBe(true);
    expect(engine.getReport()).toEqual(report);
  });
});
