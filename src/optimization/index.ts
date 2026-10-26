import type { GridPos, Scene } from '../domain/types';
import { validateScene } from '../domain/validation';
import { createEngine } from '../simulation/engine';
import { generateDemands } from '../simulation/demand';
import { createRng } from '../simulation/prng';
import { hashDemands, hashScene } from '../simulation/hash';
import { MODEL_VERSION, GENERATOR_VERSION } from '../simulation/constants';
import type { ExogenousDemand, SimulationConfig } from '../simulation/types';
import { copyScene, enumerateCandidates, translateBooth } from './candidates';
import { aggregateRuns, compareScores, pairedDifferences, passesHoldout } from './scoring';
import type { Bottleneck, EvaluationSummary, OptimizationOptions, OptimizationProgress, OptimizationResult } from './types';

export type * from './types';
export { aggregateRuns, compareScores, pairedDifferences, passesHoldout } from './scoring';
export { enumerateCandidates, translateBooth } from './candidates';

export const TRAINING_SEEDS = [11, 29, 47] as const;
export const HOLDOUT_SEEDS = [83, 101] as const;
export const OPTIMIZATION_LIMITS = { maxH: 300, maxDemandCount: 180, maxCandidates: 12,
  defaultCandidates: 8, maxCells: 1600, maxBooths: 12 } as const;
export const OPTIMIZATION_VERSION = `layout-search-v1/${MODEL_VERSION}/${GENERATOR_VERSION}`;
const CANCELLED = 'LAYOUT_OPTIMIZATION_CANCELLED';

/** Finite paired search. No candidate can change demand, service rate, IDs, portals or obstacles. */
export async function optimizeLayout(scene: Scene, requestedConfig: SimulationConfig,
  options: OptimizationOptions = {}): Promise<OptimizationResult> {
  // This operation yields to the host. Retain a run-local snapshot so callers
  // changing their form/config object cannot alter later seeds or preview runs.
  const config: SimulationConfig = { ...requestedConfig };
  const maxCandidates = options.maxCandidates ?? OPTIMIZATION_LIMITS.defaultCandidates;
  const yieldEvery = options.yieldEveryTicks ?? 10;
  const original = copyScene(scene);
  const result: OptimizationResult = {
    version: OPTIMIZATION_VERSION, status: 'no-improvement', originalScene: original,
    selectedScene: copyScene(original), selectedMove: null, config: { ...config },
    trainingSeeds: [...TRAINING_SEEDS], holdoutSeeds: [...HOLDOUT_SEEDS],
    ranking: '训练集平均系统完成率降序 → 截尾平均耗时升序 → 模型内拥堵暴露升序；同分保留原布局',
    acceptanceRule: '每个留出种子离场人数不减，且平均完成率至少提高1个百分点且耗时不增，或耗时至少降低1秒且完成率不减。非统计显著性声明。',
    baselineTraining: [], baselineHoldout: [], candidateRecords: [], comparison: null,
    preview: null, bottlenecks: [],
    budget: { maxCandidates, generated: 0, legal: 0, rejected: 0, evaluated: 0, failed: 0,
      skipped: 0, completedRuns: 0, attemptedRuns: 0, executedTicks: 0,
      maxRuns: 9 + maxCandidates * 3, maxTicks: (9 + maxCandidates * 3) * config.H },
    explanation: [], error: null,
  };
  const checkCancelled = () => { if (options.signal?.aborted) throw new Error(CANCELLED); };
  const demandCache = new Map<number, ExogenousDemand[]>();
  const runCache = new Map<string, EvaluationSummary>();
  const hotspots = new Map<string, Bottleneck>();
  const addHotspot = (pos: GridPos, kind: 'congestionTicks' | 'blockedAgentTicks') => {
    const key = `${pos.x},${pos.y}`;
    const item = hotspots.get(key) ?? { pos: { ...pos }, congestionTicks: 0, blockedAgentTicks: 0 };
    item[kind]++;
    hotspots.set(key, item);
  };
  const evaluate = async (layout: Scene, seed: number, phase: OptimizationProgress['phase'],
    candidateId: string | null, collectBottlenecks = false): Promise<EvaluationSummary> => {
    checkCancelled();
    const sceneHash = hashScene(layout);
    const cacheKey = `${sceneHash}:${seed}`;
    const cached = runCache.get(cacheKey);
    if (cached) return cached;
    const runConfig = { ...config, seed };
    let demands = demandCache.get(seed);
    if (!demands) {
      demands = generateDemands(original, runConfig, createRng(seed));
      demandCache.set(seed, demands);
    }
    result.budget.attemptedRuns++;
    const created = createEngine(layout, runConfig, demands);
    if (!created.ok) throw new Error(created.error);
    const engine = created.engine;
    while (engine.executedTicks < config.H) {
      checkCancelled();
      const target = Math.min(config.H, engine.executedTicks + yieldEvery);
      while (engine.executedTicks < target) {
        const advance = engine.step();
        if (!advance.ok) throw new Error(`seed ${seed}: ${advance.error}`);
        result.budget.executedTicks++;
        if (collectBottlenecks) {
          for (const pos of advance.snapshot.congestionCenters) addHotspot(pos, 'congestionTicks');
          for (const failure of advance.snapshot.moveFailures) {
            if (failure.reason === 'occupied' || failure.reason === 'conflict') addHotspot(failure.pos, 'blockedAgentTicks');
          }
        }
      }
      options.onProgress?.({ phase, completedRuns: result.budget.completedRuns,
        maxRuns: result.budget.maxRuns, currentTick: engine.executedTicks, H: config.H, candidateId, seed });
      // A timer yields rendering/input to the host; every pending batch checks cancellation.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      if (options.signal?.aborted) { engine.cancel(); throw new Error(CANCELLED); }
    }
    if (!engine.isComplete) throw new Error(`seed ${seed}: 仿真未完整到达 H`);
    const m = engine.getMetrics();
    const summary: EvaluationSummary = {
      seed, H: config.H, configDemandCount: config.demandCount, actualDemandCount: demands.length,
      sceneHash, demandHash: hashDemands(demands), executedTicks: engine.executedTicks,
      metrics: { demandCount: m.demandCount, admitted: m.admitted, pending: m.pending,
        serviceCompleted: m.serviceCompleted, exited: m.exited, incomplete: m.incomplete,
        serviceCompletionRate: m.serviceCompletionRate, systemCompletionRate: m.systemCompletionRate,
        throughput: m.throughput, waitAverage: m.waitAverage, waitSampleCount: m.waitSampleCount,
        truncatedAvgDuration: m.truncatedAvgDuration, truncatedCount: m.truncatedCount,
        congestionExposure: m.congestionExposure },
      heatmap: m.density.cells.map(c => ({ pos: { ...c.pos }, density: c.density, occupiedSamples: c.occupiedSamples })),
    };
    result.budget.completedRuns++;
    runCache.set(cacheKey, summary);
    return summary;
  };
  try {
    checkCancelled();
    if (!Number.isInteger(maxCandidates) || maxCandidates < 0 || maxCandidates > 12 ||
      !Number.isInteger(yieldEvery) || yieldEvery < 1 || yieldEvery > 10) throw new Error('候选预算必须为0–12、让出步长必须为1–10的整数');
    if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 4294967295 ||
      !Number.isInteger(config.H) || config.H < 1 || config.H > 300 ||
      !Number.isInteger(config.demandCount) || config.demandCount < 0 || config.demandCount > 180) {
      throw new Error('布局搜索资源限制：H为1–300、需求人数0–180、种子为uint32整数');
    }
    if (original.width * original.height > OPTIMIZATION_LIMITS.maxCells ||
      original.booths.length > OPTIMIZATION_LIMITS.maxBooths) throw new Error('首版搜索最多1600格、12个展位；普通仿真仍可独立运行');
    const validation = validateScene(original);
    if (!validation.readyForSimulation) throw new Error(validation.issues.map(i => i.message).join('；'));
    for (const seed of TRAINING_SEEDS) result.baselineTraining.push(await evaluate(original, seed, 'baseline', null, true));
    result.bottlenecks = [...hotspots.values()].sort((a, b) =>
      b.congestionTicks - a.congestionTicks || b.blockedAgentTicks - a.blockedAgentTicks || a.pos.y - b.pos.y || a.pos.x - b.pos.x);
    checkCancelled();
    result.candidateRecords = enumerateCandidates(original, result.bottlenecks, maxCandidates);
    result.budget.generated = result.candidateRecords.length;
    result.budget.rejected = result.candidateRecords.filter(c => c.state === 'invalid').length;
    result.budget.legal = result.budget.generated - result.budget.rejected;
    result.budget.skipped = result.candidateRecords.filter(c => c.state === 'budget-skipped').length;
    let bestScore = aggregateRuns(result.baselineTraining);
    let best: OptimizationResult['candidateRecords'][number] | null = null;
    for (const candidate of result.candidateRecords.filter(c => c.state === 'pending')) {
      checkCancelled();
      try {
        const layout = translateBooth(original, candidate.move);
        for (const seed of TRAINING_SEEDS) candidate.training.push(await evaluate(layout, seed, 'candidates', candidate.id));
        pairedDifferences(result.baselineTraining, candidate.training);
        candidate.score = aggregateRuns(candidate.training);
        candidate.state = 'evaluated';
        result.budget.evaluated++;
        if (compareScores(candidate.score, bestScore) < 0) { best = candidate; bestScore = candidate.score; }
      } catch (error) {
        if (options.signal?.aborted) throw new Error(CANCELLED);
        candidate.state = 'failed';
        candidate.rejectionReasons.push(error instanceof Error ? error.message : String(error));
        result.budget.failed++;
      }
    }
    const baselineScore = aggregateRuns(result.baselineTraining);
    for (const candidate of result.candidateRecords.filter(c => c.state === 'evaluated' && c !== best)) {
      candidate.rejectionReasons.push(candidate.score && compareScores(candidate.score, baselineScore) < 0 ?
        '训练评分未列首位，未接触留出集' : '训练评分未严格优于原布局，未接触留出集');
    }
    if (best) {
      const layout = translateBooth(original, best.move);
      result.comparison = { candidateId: best.id, move: { ...best.move }, training: best.training,
        holdout: [], trainingDifferences: pairedDifferences(result.baselineTraining, best.training), holdoutDifferences: [] };
      // Exactly one candidate reaches holdout; failure never selects the runner-up.
      for (const seed of HOLDOUT_SEEDS) {
        result.baselineHoldout.push(await evaluate(original, seed, 'holdout', null));
        result.comparison.holdout.push(await evaluate(layout, seed, 'holdout', best.id));
      }
      result.comparison.holdoutDifferences = pairedDifferences(result.baselineHoldout, result.comparison.holdout);
      if (passesHoldout(result.baselineHoldout, result.comparison.holdout)) {
        result.status = 'accepted'; result.selectedScene = layout; result.selectedMove = { ...best.move };
        result.explanation.push(`留出验证通过：展位 ${best.move.boothId} 连同服务格及队列整体平移 (${best.move.dx}, ${best.move.dy}) 格。`);
      } else {
        best.rejectionReasons.push('训练最优，但未达到预设留出接受条件；保留原布局');
        result.explanation.push('训练最优候选未达到预设留出接受条件，保留原布局；不使用训练提升冒充验证提升。');
      }
    } else result.explanation.push('有限候选中没有方案严格优于训练基线，保留原布局。');
    const before = await evaluate(original, config.seed, 'preview', null);
    const after = result.selectedMove ? await evaluate(result.selectedScene, config.seed, 'preview', 'selected') : before;
    const preview: NonNullable<OptimizationResult['preview']> = { seed: config.seed, before, after };
    if (best) {
      const proposedScene = translateBooth(original, best.move);
      preview.proposed = result.selectedMove ? after : await evaluate(proposedScene, config.seed, 'preview', best.id);
      preview.proposedScene = proposedScene;
    }
    checkCancelled();
    result.preview = preview;
    const hotspot = result.bottlenecks[0];
    result.explanation.push(hotspot ? `训练基线热点 (${hotspot.pos.x},${hotspot.pos.y})：累计${hotspot.congestionTicks}个拥堵中心tick、${hotspot.blockedAgentTicks}个占位受阻人tick；用于候选优先级。` :
      '训练基线未记录模型内拥堵或占位冲突，候选按稳定展位ID枚举。');
    const previewRole = result.trainingSeeds.includes(config.seed) ?
      '复用训练种子结果；该种子参与了候选评分，不属于独立展示样本' :
      result.holdoutSeeds.includes(config.seed) ?
        '展示种子与预设留出种子重合；若本轮进入留出验证，该种子同时参与接受门槛，不属于额外独立展示样本' :
        '只用于展示，不参加选优';
    result.explanation.push(`真实完成${result.budget.completedRuns}次仿真、${result.budget.executedTicks} tick；预览seed=${config.seed}${previewRole}。`);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.status = message === CANCELLED ? 'cancelled' : 'failed';
    result.error = result.status === 'cancelled' ? null : message;
    result.selectedScene = copyScene(original); result.selectedMove = null; result.preview = null;
    result.explanation.push(result.status === 'cancelled' ? '搜索已取消，仅保留部分执行记录；未发布优化布局。' : `搜索失败，保留原布局：${message}`);
    return result;
  }
}
