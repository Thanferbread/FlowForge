import { expect, it } from 'vitest';
import { optimizeLayout } from '../src/optimization/index.ts';
import { createCampusFairScene } from '../src/scenarios/campusFair.ts';
import { aggregateRuns } from '../src/optimization/scoring.ts';
import fs from 'node:fs';
import path from 'node:path';

it('runs the real bounded paired search and saves compact observations', async () => {
  const maxCandidates = Number(process.env.FLOWFORGE_OPT_CANDIDATES ?? 8);
  const config = { seed: 42, H: 300, demandCount: 180 };
  const start = performance.now();
  const result = await optimizeLayout(createCampusFairScene(), config, { maxCandidates });
  const elapsedMs = performance.now() - start;
  const runId = (process.env.FLOWFORGE_RUN_ID ?? `${new Date().toISOString()}_${process.pid}`).replace(/[^A-Za-z0-9_-]/g, '');
  const attempt = (process.env.FLOWFORGE_OPT_ATTEMPT ?? '01').replace(/[^A-Za-z0-9_-]/g, '');
  const folder = path.resolve('runs'); fs.mkdirSync(folder, { recursive: true });
  // Preserve preview heatmaps for figures. Other run summaries retain scalar raw metrics only.
  const withoutHeatmap = ({ heatmap, ...run }) => run;
  const compact = { ...result,
    baselineTraining: result.baselineTraining.map(withoutHeatmap),
    baselineHoldout: result.baselineHoldout.map(withoutHeatmap),
    candidateRecords: result.candidateRecords.map(c => ({ ...c, training: c.training.map(withoutHeatmap) })),
    comparison: result.comparison ? { ...result.comparison,
      training: result.comparison.training.map(withoutHeatmap), holdout: result.comparison.holdout.map(withoutHeatmap) } : null,
    nonCoreMetadata: { runId, exportedAt: new Date().toISOString(), elapsedMs, source: 'real optimizeLayout/createEngine execution' },
  };
  const output = path.join(folder, `optimization_${runId}_attempt${attempt}_seed42_H300_N180.json`);
  fs.writeFileSync(output, JSON.stringify(compact, null, 2), { encoding: 'utf8', flag: 'wx' });
  console.log(JSON.stringify({ output, elapsedMs, status: result.status, budget: result.budget,
    selectedMove: result.selectedMove, baselineTraining: aggregateRuns(result.baselineTraining),
    candidateTraining: result.comparison ? aggregateRuns(result.comparison.training) : null,
    baselineHoldout: aggregateRuns(result.baselineHoldout),
    candidateHoldout: result.comparison ? aggregateRuns(result.comparison.holdout) : null,
    previewBefore: result.preview?.before.metrics, previewAfter: result.preview?.after.metrics,
    previewProposed: result.preview?.proposed?.metrics }, null, 2));
  expect(result.status, result.error ?? '').not.toBe('failed');
  expect(result.status).not.toBe('cancelled');
  expect(result.preview?.before.demandHash).toBe(result.preview?.after.demandHash);
  expect(result.budget.completedRuns).toBeLessThanOrEqual(result.budget.maxRuns);
  expect(result.budget.executedTicks).toBe(result.budget.completedRuns * 300);
}, 240000);
