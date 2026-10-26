import type { AggregateScore, EvaluationSummary, PairedDifference } from './types';

function mean(values: (number | null)[]): number | null {
  return values.length && values.every(v => v !== null) ?
    (values as number[]).reduce((a, b) => a + b, 0) / values.length : null;
}

export function aggregateRuns(runs: EvaluationSummary[]): AggregateScore {
  return {
    systemCompletionRate: mean(runs.map(r => r.metrics.systemCompletionRate)),
    serviceCompletionRate: mean(runs.map(r => r.metrics.serviceCompletionRate)),
    truncatedAvgDuration: mean(runs.map(r => r.metrics.truncatedAvgDuration)),
    congestionExposure: mean(runs.map(r => r.metrics.congestionExposure)) ?? 0,
    waitAverage: mean(runs.map(r => r.metrics.waitAverage)),
  };
}

/** Negative means a is better; exact ties retain the baseline. Null never beats observed data. */
export function compareScores(a: AggregateScore, b: AggregateScore): number {
  return (b.systemCompletionRate ?? -1) - (a.systemCompletionRate ?? -1) ||
    (a.truncatedAvgDuration ?? Infinity) - (b.truncatedAvgDuration ?? Infinity) ||
    a.congestionExposure - b.congestionExposure || 0;
}

export function pairedDifferences(before: EvaluationSummary[], after: EvaluationSummary[]): PairedDifference[] {
  if (before.length !== after.length) throw new Error('配对运行数量不一致');
  return before.map((b, i) => {
    const a = after[i];
    if (a.seed !== b.seed || a.H !== b.H || a.configDemandCount !== b.configDemandCount ||
      a.actualDemandCount !== b.actualDemandCount || a.demandHash !== b.demandHash ||
      a.executedTicks !== a.H || b.executedTicks !== b.H) throw new Error('A/B 外生需求或运行条件不匹配');
    const delta = (x: number | null, y: number | null) => x === null || y === null ? null : x - y;
    return { seed: a.seed, demandHash: a.demandHash,
      serviceCompleted: a.metrics.serviceCompleted - b.metrics.serviceCompleted,
      exited: a.metrics.exited - b.metrics.exited,
      serviceCompletionRate: delta(a.metrics.serviceCompletionRate, b.metrics.serviceCompletionRate),
      systemCompletionRate: delta(a.metrics.systemCompletionRate, b.metrics.systemCompletionRate),
      truncatedAvgDuration: delta(a.metrics.truncatedAvgDuration, b.metrics.truncatedAvgDuration),
      waitAverage: delta(a.metrics.waitAverage, b.metrics.waitAverage),
      congestionExposure: a.metrics.congestionExposure - b.metrics.congestionExposure };
  });
}

/** Predeclared conservative engineering threshold; not a statistical significance test. */
export function passesHoldout(before: EvaluationSummary[], after: EvaluationSummary[]): boolean {
  if (!before.length || before.length !== after.length) return false;
  const differences = pairedDifferences(before, after);
  if (differences.some(d => d.exited < 0)) return false;
  const b = aggregateRuns(before), a = aggregateRuns(after);
  if (a.systemCompletionRate === null || b.systemCompletionRate === null ||
    a.truncatedAvgDuration === null || b.truncatedAvgDuration === null) return false;
  const rateGain = a.systemCompletionRate - b.systemCompletionRate;
  const durationGain = b.truncatedAvgDuration - a.truncatedAvgDuration;
  const tolerance = 1e-10;
  return (rateGain + tolerance >= 0.01 && durationGain >= -tolerance) ||
    (durationGain + tolerance >= 1 && rateGain >= -tolerance);
}
