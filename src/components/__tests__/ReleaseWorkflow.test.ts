// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { App } from '../../App';
import * as engines from '../../simulation/engine';
import * as optimization from '../../optimization';
import * as files from '../fileIo';
import * as canvas from '../SceneCanvas';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { canonicalSceneJson, hashDemands, hashScene } from '../../simulation/hash';
import type { Scene } from '../../domain/types';
import type { Engine, SimulationConfig } from '../../simulation/types';
import type { EvaluationSummary, OptimizationOptions, OptimizationResult } from '../../optimization/types';

interface Job { scene: Scene; config: SimulationConfig; options: OptimizationOptions; resolve: (result: OptimizationResult) => void }
let jobs: Job[];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let createSpy: MockInstance<typeof engines.createEngine>;
let canvasFrames: ComponentProps<typeof canvas.SceneCanvas>[];

function button(text: string) {
  const node = [...host.querySelectorAll('button')].find((b) => b.textContent?.trim() === text || [...b.querySelectorAll('span')].some((span) => span.textContent === text));
  if (!node) throw new Error(`Missing button ${text}`);
  return node;
}
function click(text: string) { act(() => button(text).click()); }
function config(label: string, value: string) {
  const row = [...host.querySelectorAll('.prop-row')].find((r) => r.querySelector('label')?.textContent === label);
  const input = row?.querySelector('input');
  if (!input) throw new Error(`Missing input ${label}`);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}
function engine(): Engine {
  const results = createSpy.mock.results;
  const result = results[results.length - 1]?.value as ReturnType<typeof engines.createEngine>;
  if (!result?.ok) throw new Error('No real App engine');
  return result.engine;
}
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function editObstacle() {
  click('障碍');
  act(() => host.querySelector('canvas')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 15 * 26 + 13, clientY: 5 * 26 + 13 })));
}
function latestCanvas() { return canvasFrames[canvasFrames.length - 1]; }

// Only the asynchronous optimizer boundary is controlled. The fixture's
// observations and every App simulation come from the real simulation engine.
function resultFor(job: Job, status: 'accepted' | 'no-improvement' = 'no-improvement'): OptimizationResult {
  const created = engines.createEngine(job.scene, job.config);
  if (!created.ok) throw new Error(created.error);
  created.engine.runTo(job.config.H);
  const report = created.engine.getReport();
  const summary: EvaluationSummary = {
    seed: job.config.seed, H: job.config.H, configDemandCount: job.config.demandCount,
    actualDemandCount: report.demands.length, sceneHash: hashScene(job.scene), demandHash: hashDemands(report.demands),
    executedTicks: job.config.H, metrics: created.engine.getMetrics(), heatmap: [],
  };
  const move = { boothId: 'booth-1', dx: -2, dy: 0 };
  return {
    version: 'controlled-async-boundary-fixture', status, originalScene: job.scene,
    selectedScene: status === 'accepted' ? optimization.translateBooth(job.scene, move) : job.scene,
    selectedMove: status === 'accepted' ? move : null, config: job.config,
    trainingSeeds: [11, 29, 47], holdoutSeeds: [83, 101], ranking: 'fixture', acceptanceRule: 'fixture',
    baselineTraining: [], baselineHoldout: [], candidateRecords: [], comparison: null,
    preview: { seed: job.config.seed, before: summary, after: summary }, bottlenecks: [],
    budget: { maxCandidates: 8, generated: 0, legal: 0, rejected: 0, evaluated: 0, failed: 0,
      skipped: 0, completedRuns: 1, attemptedRuns: 1, executedTicks: job.config.H, maxRuns: 33, maxTicks: 33 * job.config.H },
    explanation: ['Controlled asynchronous lifecycle fixture; not evidence of optimization gains.'], error: null,
  };
}
async function resolveJob(index: number, result: OptimizationResult) {
  await act(async () => { jobs[index].resolve(result); await Promise.resolve(); });
}

beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  jobs = []; canvasFrames = [];
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D);
  vi.spyOn(files, 'downloadJson').mockImplementation(() => {});
  vi.spyOn(optimization, 'optimizeLayout').mockImplementation((scene, settings, options = {}) => new Promise((resolve) => {
    jobs.push({ scene, config: settings, options, resolve });
  }));
  const actualCanvas = canvas.SceneCanvas;
  vi.spyOn(canvas, 'SceneCanvas').mockImplementation((props) => { canvasFrames.push(props); return createElement(actualCanvas, props); });
  createSpy = vi.spyOn(engines, 'createEngine');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(App)));
  config('时长 H', '10'); config('人数 N', '4');
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('release workflow with a real App and real simulation engine', () => {
  it('one-click demo restores the canonical scene, defaults and 16x then advances exactly once', () => {
    config('种子', '99'); editObstacle(); click('一键运行示例');
    expect(host.querySelector('[role="dialog"]')).not.toBeNull(); click('确定');
    const running = engine();
    expect(running.getReport().config).toEqual({ seed: 42, H: 300, demandCount: 180 });
    expect(canonicalSceneJson(running.getReport().sceneSnapshot)).toBe(canonicalSceneJson(createCampusFairScene()));
    expect(host.querySelector('select')?.value).toBe('16'); expect(running.executedTicks).toBe(0);
    advance(62.5); expect(running.executedTicks).toBe(1); click('暂停');
  });

  it('optimization pauses the running engine and cannot advance it in the background', () => {
    click('运行仿真'); const current = engine(); advance(1000);
    click('搜索更好布局'); expect(jobs).toHaveLength(1); expect(current.runState).toBe('paused');
    expect(jobs[0].options.signal?.aborted).toBe(false);
    advance(5000); expect(current.executedTicks).toBe(1);
    click('运行仿真'); expect(current.runState).toBe('paused'); expect(jobs).toHaveLength(1);
  });

  it.each(['scene', 'parameter', 'reset', 'unmount'] as const)('%s invalidates search and rejects late progress and completion', async (operation) => {
    click('单步'); click('布局优化'); const job = jobs[0]; const staleResult = resultFor(job, 'accepted');
    if (operation === 'scene') editObstacle();
    else if (operation === 'parameter') config('种子', '43');
    else if (operation === 'reset') click('重置');
    else { act(() => root.unmount()); root = createRoot(host); act(() => root.render(createElement(App))); }
    expect(job.options.signal?.aborted).toBe(true);
    act(() => job.options.onProgress?.({ phase: 'candidates', completedRuns: 999, maxRuns: 999, currentTick: 999, H: 10, candidateId: 'late', seed: 999 }));
    await resolveJob(0, staleResult);
    expect(host.querySelector('.analysis-overlay')).toBeNull(); expect(host.querySelector('.search-progress')).toBeNull();
    expect(button('A/B 对比').disabled).toBe(true); expect(host.textContent).not.toContain('999/999');
  });

  it('stopping an uncooperative asynchronous search rejects a late accepted result', async () => {
    click('布局优化'); const job = jobs[0]; const late = resultFor(job, 'accepted');
    click('停止搜索'); expect(job.options.signal?.aborted).toBe(true);
    act(() => job.options.onProgress?.({ phase: 'preview', completedRuns: 999, maxRuns: 999, currentTick: 999, H: 10, candidateId: null, seed: 999 }));
    expect(host.textContent).not.toContain('999/999');
    await resolveJob(0, late);
    expect(button('A/B 对比').disabled).toBe(true); expect(host.querySelector('.analysis-overlay')).toBeNull();
    expect(button('布局优化').disabled).toBe(false);
  });

  it('a stale first search cannot replace a newer result or erase its active status', async () => {
    click('布局优化'); const first = resultFor(jobs[0], 'accepted');
    config('种子', '43'); click('布局优化'); expect(jobs).toHaveLength(2);
    await resolveJob(0, first);
    expect(host.querySelector('.search-progress')).not.toBeNull(); expect(button('A/B 对比').disabled).toBe(true);
    await resolveJob(1, resultFor(jobs[1]));
    expect(host.querySelector('.analysis-overlay')).not.toBeNull(); expect(host.textContent).toContain('本轮保留原布局');
  });

  it('no improvement cannot apply a layout; download errors retain the result for retry', async () => {
    click('布局优化'); const result = resultFor(jobs[0]); await resolveJob(0, result);
    expect(button('应用推荐布局').disabled).toBe(true);
    vi.mocked(files.downloadJson).mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    click('下载对比报告'); expect(host.querySelector('.toast.error')?.textContent).toContain('disk unavailable');
    expect(host.querySelector('.analysis-overlay')).not.toBeNull(); expect(button('A/B 对比').disabled).toBe(false);
    click('下载对比报告');
    const calls = vi.mocked(files.downloadJson).mock.calls;
    expect(calls).toHaveLength(2); expect(JSON.parse(calls[1][0]).status).toBe('no-improvement');
    click('返回编辑器'); click('单步');
    expect(canonicalSceneJson(engine().getReport().sceneSnapshot)).toBe(canonicalSceneJson(result.originalScene));
  });

  it('applying an accepted layout commits its complete geometry and resets the old simulation', async () => {
    click('单步'); const previous = engine(); click('布局优化');
    const result = resultFor(jobs[0], 'accepted'); await resolveJob(0, result);
    expect(button('应用推荐布局').disabled).toBe(false); click('应用推荐布局');
    expect(previous.runState).toBe('cancelled'); expect(button('下载报告').disabled).toBe(true);
    click('单步');
    expect(canonicalSceneJson(engine().getReport().sceneSnapshot)).toBe(canonicalSceneJson(result.selectedScene));
  });

  it('same-tick controls preserve published snapshot projections instead of replaying the animation segment', () => {
    click('运行仿真'); advance(1000);
    const current = engine(); const { agents, prevAgents } = latestCanvas();
    click('暂停'); expect(latestCanvas().agents).toBe(agents); expect(latestCanvas().prevAgents).toBe(prevAgents);
    click('运行仿真'); expect(latestCanvas().agents).toBe(agents); expect(latestCanvas().prevAgents).toBe(prevAgents);
    const select = host.querySelector('select')!;
    act(() => { select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(latestCanvas().agents).toBe(agents); expect(latestCanvas().prevAgents).toBe(prevAgents);
    expect(engine()).toBe(current); expect(current.executedTicks).toBe(1);
    advance(250); expect(latestCanvas().agents).not.toBe(agents); expect(current.executedTicks).toBe(2);
  });
});
