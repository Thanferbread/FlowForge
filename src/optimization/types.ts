import type { GridPos, Scene } from '../domain/types';
import type { SimulationConfig } from '../simulation/types';

export interface LayoutMove { boothId: string; dx: number; dy: number }

/** Compact observations; all rates use requested demand. */
export interface OptimizationMetrics {
  demandCount: number; admitted: number; pending: number;
  serviceCompleted: number; exited: number; incomplete: number;
  serviceCompletionRate: number | null; systemCompletionRate: number | null;
  throughput: number | null; waitAverage: number | null; waitSampleCount: number;
  truncatedAvgDuration: number | null; truncatedCount: number | null;
  congestionExposure: number;
}

export interface EvaluationSummary {
  seed: number; H: number; configDemandCount: number; actualDemandCount: number;
  sceneHash: string; demandHash: string; executedTicks: number;
  metrics: OptimizationMetrics;
  heatmap: { pos: GridPos; density: number | null; occupiedSamples: number }[];
}

export interface AggregateScore {
  systemCompletionRate: number | null;
  serviceCompletionRate: number | null;
  truncatedAvgDuration: number | null;
  congestionExposure: number;
  waitAverage: number | null;
}

export interface Bottleneck {
  pos: GridPos; congestionTicks: number; blockedAgentTicks: number;
}

export interface CandidateRecord {
  id: string; move: LayoutMove; sceneHash: string;
  state: 'invalid' | 'budget-skipped' | 'pending' | 'evaluated' | 'failed';
  rejectionReasons: string[]; training: EvaluationSummary[]; score: AggregateScore | null;
}

export interface PairedDifference {
  seed: number; demandHash: string;
  serviceCompleted: number; exited: number;
  serviceCompletionRate: number | null; systemCompletionRate: number | null;
  truncatedAvgDuration: number | null; waitAverage: number | null;
  congestionExposure: number;
}

export interface OptimizationProgress {
  phase: 'baseline' | 'candidates' | 'holdout' | 'preview';
  completedRuns: number; maxRuns: number; currentTick: number; H: number;
  candidateId: string | null; seed: number;
}

export interface OptimizationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: OptimizationProgress) => void;
  /** Default 8, integer 0–12. */
  maxCandidates?: number;
  /** Event-loop yield every 1–10 ticks, default 10. */
  yieldEveryTicks?: number;
}

export interface OptimizationResult {
  version: string;
  status: 'accepted' | 'no-improvement' | 'cancelled' | 'failed';
  originalScene: Scene; selectedScene: Scene; selectedMove: LayoutMove | null;
  config: SimulationConfig; trainingSeeds: number[]; holdoutSeeds: number[];
  ranking: string; acceptanceRule: string;
  baselineTraining: EvaluationSummary[]; baselineHoldout: EvaluationSummary[];
  candidateRecords: CandidateRecord[];
  /** Training winner, even if rejected; selected only if accepted. */
  comparison: {
    candidateId: string; move: LayoutMove;
    training: EvaluationSummary[]; holdout: EvaluationSummary[];
    trainingDifferences: PairedDifference[]; holdoutDifferences: PairedDifference[];
  } | null;
  /** Descriptive comparison only: never used to select a candidate. */
  preview: {
    seed: number; before: EvaluationSummary; after: EvaluationSummary;
    /** Training winner, possibly rejected. Never conflate this with the selected after layout. */
    proposed?: EvaluationSummary; proposedScene?: Scene;
  } | null;
  bottlenecks: Bottleneck[];
  budget: {
    maxCandidates: number; generated: number; legal: number; rejected: number;
    evaluated: number; failed: number; skipped: number;
    completedRuns: number; attemptedRuns: number; executedTicks: number;
    maxRuns: number; maxTicks: number;
  };
  explanation: string[]; error: string | null;
}
