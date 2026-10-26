import { describe, expect, it } from 'vitest';
import type { Scene } from '../../domain/types';
import { validateScene } from '../../domain/validation';
import { canonicalSceneJson, stableStringify } from '../../simulation/hash';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { optimizeLayout, enumerateCandidates, translateBooth, pairedDifferences,
  passesHoldout, compareScores, aggregateRuns } from '../index';
import type { EvaluationSummary } from '../types';

function tinyScene(): Scene {
  return { schemaVersion: 1, width: 12, height: 12, obstacles: [],
    entrances: [{ id: 'in', pos: { x: 2, y: 11 } }], exits: [{ id: 'out', pos: { x: 2, y: 0 } }],
    booths: [{ id: 'booth', footprint: { x: 5, y: 2 }, serviceCell: { x: 5, y: 3 },
      queueCells: [{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }], serviceTicksMin: 2, serviceTicksMax: 3 }] };
}

function summary(seed: number, exited = 50, duration = 40): EvaluationSummary {
  return { seed, H: 100, configDemandCount: 100, actualDemandCount: 100, sceneHash: 'scene',
    demandHash: `demands-${seed}`, executedTicks: 100, heatmap: [],
    metrics: { demandCount: 100, admitted: 100, pending: 0, serviceCompleted: 60, exited,
      incomplete: 100 - exited, serviceCompletionRate: 0.6, systemCompletionRate: exited / 100,
      throughput: 36, waitAverage: 3, waitSampleCount: 60,
      truncatedAvgDuration: duration, truncatedCount: 100 - exited, congestionExposure: 100 } };
}

describe('legal translation and finite candidate search', () => {
  it('translates the complete booth package without changing fixed geometry or service', () => {
    const scene = tinyScene(), before = canonicalSceneJson(scene);
    const move = { boothId: 'booth', dx: 2, dy: 0 };
    const next = translateBooth(scene, move);
    expect(next.booths[0].footprint).toEqual({ x: 7, y: 2 });
    expect(next.booths[0].serviceCell).toEqual({ x: 7, y: 3 });
    expect(next.booths[0].queueCells).toEqual([{ x: 7, y: 4 }, { x: 7, y: 5 }, { x: 7, y: 6 }]);
    expect(next.entrances).toEqual(scene.entrances); expect(next.exits).toEqual(scene.exits);
    expect(next.obstacles).toEqual(scene.obstacles);
    expect(next.booths[0].serviceTicksMin).toBe(2); expect(next.booths[0].serviceTicksMax).toBe(3);
    expect(canonicalSceneJson(scene)).toBe(before);
    expect(() => translateBooth(scene, { boothId: 'booth', dx: 1, dy: 1 })).toThrow();
    expect(() => translateBooth(scene, { boothId: 'booth', dx: 4, dy: 0 })).toThrow();
  });

  it('rejects overlapping or unreachable packages before simulation and retains rejection reasons', () => {
    const scene = createCampusFairScene();
    const records = enumerateCandidates(scene, [], 2);
    expect(records).toHaveLength(scene.booths.length * 12);
    expect(records.filter(r => r.state === 'pending')).toHaveLength(2);
    expect(records.some(r => r.state === 'invalid')).toBe(true);
    for (const r of records) {
      const valid = validateScene(translateBooth(scene, r.move)).readyForSimulation;
      expect(r.state === 'invalid').toBe(!valid);
      if (!valid) expect(r.rejectionReasons.length).toBeGreaterThan(0);
    }
  });
});

describe('paired scoring and conservative holdout acceptance', () => {
  it('ranks completed system journeys before lower waiting among survivors', () => {
    const baseline = summary(83), candidate = summary(83, 49, 10);
    expect(compareScores(aggregateRuns([candidate]), aggregateRuns([baseline]))).toBeGreaterThan(0);
  });
  it('rejects condition mismatches instead of comparing different demand or time horizons', () => {
    const before = [summary(83)], after = [summary(83, 51)];
    after[0].demandHash = 'changed';
    expect(() => pairedDifferences(before, after)).toThrow(/不匹配/);
    after[0].demandHash = before[0].demandHash; after[0].executedTicks = 90;
    expect(() => pairedDifferences(before, after)).toThrow(/不匹配/);
  });
  it('requires no per-seed exit regression and predeclared minimum gains', () => {
    const before = [summary(83), summary(101)];
    expect(passesHoldout(before, [summary(83, 52, 39), summary(101, 49, 39)])).toBe(false);
    expect(passesHoldout(before, [summary(83, 51, 40), summary(101, 51, 40)])).toBe(true);
    expect(passesHoldout(before, [summary(83, 50, 39), summary(101, 50, 39)])).toBe(true);
    expect(passesHoldout(before, [summary(83, 50, 39.5), summary(101, 50, 39.5)])).toBe(false);
    expect(passesHoldout(before, [summary(83, 51, 41), summary(101, 51, 41)])).toBe(false);
  });
});

describe('real asynchronous optimizer', () => {
  it('snapshots config before yielding so caller mutations cannot change later seeds or preview', async () => {
    const scene = tinyScene();
    const config = { seed: 42, H: 12, demandCount: 2 };
    let changed = false;
    const result = await optimizeLayout(scene, config, {
      maxCandidates: 0,
      onProgress: () => {
        if (!changed) {
          changed = true;
          config.seed = 99; config.H = 1; config.demandCount = 0;
        }
      },
    });
    expect(changed).toBe(true); expect(config).toEqual({ seed: 99, H: 1, demandCount: 0 });
    expect(result.status).toBe('no-improvement'); expect(result.config).toEqual({ seed: 42, H: 12, demandCount: 2 });
    expect(result.baselineTraining).toHaveLength(3);
    for (const run of result.baselineTraining) {
      expect(run.H).toBe(12); expect(run.executedTicks).toBe(12);
      expect(run.configDemandCount).toBe(2); expect(run.actualDemandCount).toBe(2);
    }
    expect(result.preview?.seed).toBe(42); expect(result.preview?.before.H).toBe(12);
    expect(result.preview?.before.actualDemandCount).toBe(2);
    expect(result.budget.completedRuns).toBe(4); expect(result.budget.executedTicks).toBe(48);
  });

  it.each([11, 83])('reports overlapping preview seed %i without claiming independent display evidence', async (seed) => {
    const result = await optimizeLayout(tinyScene(), { seed, H: 2, demandCount: 0 }, { maxCandidates: 0 });
    const explanation = result.explanation[result.explanation.length - 1];
    expect(explanation).toContain(seed === 11 ? '复用训练种子结果' : '预设留出种子重合');
    expect(explanation).toContain('不属于');
    expect(explanation).not.toContain('只用于展示，不参加选优');
    expect(result.preview?.seed).toBe(seed);
  });

  it('uses fixed paired demands and produces identical results twice', async () => {
    const scene = tinyScene(), snapshot = canonicalSceneJson(scene);
    const config = { seed: 42, H: 60, demandCount: 12 };
    const a = await optimizeLayout(scene, config, { maxCandidates: 2 });
    const b = await optimizeLayout(scene, config, { maxCandidates: 2 });
    expect(a.status).not.toBe('failed'); expect(a.status).not.toBe('cancelled');
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(canonicalSceneJson(scene)).toBe(snapshot);
    for (const c of a.candidateRecords.filter(c => c.state === 'evaluated')) {
      expect(c.training.map(r => [r.seed, r.demandHash, r.H, r.actualDemandCount]))
        .toEqual(a.baselineTraining.map(r => [r.seed, r.demandHash, r.H, r.actualDemandCount]));
    }
    expect(a.budget.completedRuns).toBeLessThanOrEqual(a.budget.maxRuns);
    expect(a.budget.executedTicks).toBe(a.budget.completedRuns * 60);
    expect(a.preview?.before.demandHash).toBe(a.preview?.after.demandHash);
    expect(a.preview?.before.seed).toBe(42);
    if (a.comparison) {
      expect(a.preview?.proposed?.demandHash).toBe(a.preview?.before.demandHash);
      expect(a.preview?.proposedScene).toBeDefined();
      expect(a.preview?.proposed?.sceneHash).not.toBe(a.preview?.before.sceneHash);
      if (a.status === 'accepted') expect(a.preview?.proposed).toEqual(a.preview?.after);
      else expect(a.preview?.after).toEqual(a.preview?.before);
    }
    if (a.status !== 'accepted') expect(canonicalSceneJson(a.selectedScene)).toBe(snapshot);
    if (a.comparison) expect(a.comparison.holdout.map(r => r.seed)).toEqual([83, 101]);
  }, 30000);

  it('keeps original when all candidates tie, skips holdout, and reports no invented gain', async () => {
    const scene = tinyScene();
    const result = await optimizeLayout(scene, { seed: 42, H: 4, demandCount: 0 }, { maxCandidates: 3 });
    expect(result.status).toBe('no-improvement'); expect(result.selectedMove).toBeNull();
    expect(result.comparison).toBeNull(); expect(result.baselineHoldout).toEqual([]);
    expect(result.preview?.before).toEqual(result.preview?.after);
    expect(result.preview?.proposed).toBeUndefined();
    expect(canonicalSceneJson(result.selectedScene)).toBe(canonicalSceneJson(scene));
    expect(result.budget.evaluated).toBe(3);
  });

  it('yields input between batches and cancels without publishing a selected layout', async () => {
    const controller = new AbortController(); let progressCount = 0;
    const scene = tinyScene();
    const result = await optimizeLayout(scene, { seed: 42, H: 60, demandCount: 12 }, {
      signal: controller.signal, maxCandidates: 2,
      onProgress: () => { progressCount++; controller.abort(); },
    });
    expect(result.status).toBe('cancelled'); expect(result.preview).toBeNull();
    expect(result.selectedMove).toBeNull(); expect(progressCount).toBe(1);
    expect(result.budget.executedTicks).toBe(10); expect(result.budget.completedRuns).toBe(0);
    expect(canonicalSceneJson(result.selectedScene)).toBe(canonicalSceneJson(scene));
  });

  it('rejects expensive requests and invalid maps before any simulation', async () => {
    const invalid = await optimizeLayout(tinyScene(), { seed: 42, H: 301, demandCount: 180 });
    expect(invalid.status).toBe('failed'); expect(invalid.budget.attemptedRuns).toBe(0);
    const scene = tinyScene(); scene.exits = [];
    const draft = await optimizeLayout(scene, { seed: 42, H: 60, demandCount: 12 });
    expect(draft.status).toBe('failed'); expect(draft.budget.attemptedRuns).toBe(0);
  });
});
