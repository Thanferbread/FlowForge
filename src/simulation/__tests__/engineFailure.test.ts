import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEngine } from '../engine';
import { runHeadless } from '../headless';
import { step } from '../step';
import { createCampusFairScene } from '../../scenarios/campusFair';
import type { ExogenousDemand, SimulationConfig } from '../types';

vi.mock('../step', async importOriginal => {
  const real = await importOriginal<typeof import('../step')>();
  return { ...real, step: vi.fn(real.step) };
});

afterEach(() => vi.mocked(step).mockClear());

describe('R03/R12: transactional failures retain a usable last boundary', () => {
  it('step failure rolls back, rejects further advance, exports isolated diagnostics and can reset', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 20, demandCount: 5 });
    if (!result.ok) throw new Error(result.error);
    const engine = result.engine;
    engine.runTo(3);
    const before = engine.getReport();
    vi.mocked(step).mockImplementationOnce(() => { throw new Error('injected invariant violation'); });
    const failed = engine.step();
    expect(failed.ok).toBe(false);
    expect(engine.runState).toBe('failed');
    expect(engine.executedTicks).toBe(3);
    const report = engine.getReport();
    expect(report.trace).toEqual(before.trace);
    expect(report.events).toEqual(before.events);
    expect(report.sampleCount).toBe(3);
    expect(report.failureDiagnostic).toEqual({
      lastValidTick: 3, attemptedTick: 4, stage: 'step', reason: 'injected invariant violation',
    });
    report.failureDiagnostic!.reason = 'mutated externally';
    expect(engine.getReport().failureDiagnostic!.reason).toBe('injected invariant violation');
    expect(engine.runTo(20).ok).toBe(false);
    expect(engine.step().ok).toBe(false);
    expect(vi.mocked(step)).toHaveBeenCalledTimes(4);
    engine.reset();
    expect(engine.getReport().failureDiagnostic).toBeNull();
    expect(engine.runTo(20).ok).toBe(true);
  });

  it('headless failure is bounded and includes the partial report', () => {
    vi.mocked(step).mockImplementationOnce(() => { throw new Error('failed before first commit'); });
    const result = runHeadless(createCampusFairScene(), { seed: 42, H: 20, demandCount: 5 });
    expect(result.ok).toBe(false);
    expect(result.report?.executedTicks).toBe(0);
    expect(result.report?.failureDiagnostic?.attemptedTick).toBe(1);
    expect(vi.mocked(step)).toHaveBeenCalledTimes(1);
  });

  it('malformed external inputs return initialization errors without throwing', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 20, demandCount: 5 };
    expect(createEngine(null as unknown as typeof scene, config).ok).toBe(false);
    expect(createEngine(scene, null as unknown as SimulationConfig).ok).toBe(false);
    expect(createEngine(scene, config, [null] as unknown as ExogenousDemand[]).ok).toBe(false);
    expect(createEngine(scene, config, null as unknown as ExogenousDemand[]).ok).toBe(false);
  });
});
