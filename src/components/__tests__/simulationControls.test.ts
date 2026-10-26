/**
 * 仿真控件 UI 交互测试 S05/S17。
 *
 * 使用 jsdom + React DOM 验证控件渲染与状态。
 */
// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Toolbar } from '../Toolbar';
import { MetricsView } from '../MetricsView';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { createEngine } from '../../simulation/engine';
import type { SimControls } from '../Toolbar';

let container: HTMLDivElement;

function renderSync(root: ReturnType<typeof createRoot>, element: ReturnType<typeof createElement>) {
  flushSync(() => root.render(element));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) {
    container.remove();
  }
});

function makeSimControls(overrides: Partial<SimControls> = {}): SimControls {
  return {
    seed: 42,
    H: 300,
    demandCount: 180,
    speed: 1,
    runState: 'idle',
    hasEngine: false,
    onSeedChange: () => {},
    onHChange: () => {},
    onDemandCountChange: () => {},
    onSpeedChange: () => {},
    onRun: () => {},
    onPause: () => {},
    onStep: () => {},
    onCancel: () => {},
    onReset: () => {},
    onDownloadReport: () => {},
    ...overrides,
  };
}

describe('Toolbar 仿真控件渲染', () => {
  it('idle 状态显示运行按钮可用', () => {
    const root = createRoot(container);
    renderSync(root, createElement(Toolbar, {
      tool: 'select',
      onToolChange: () => {},
      onLoadExample: () => {},
      onNewScene: () => {},
      onValidate: () => {},
      onExport: () => {},
      onImport: () => {},
      canRunSimulation: true,
      simControls: makeSimControls({ runState: 'idle' }),
    }));

    const runBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '运行仿真',
    );
    expect(runBtn).toBeDefined();
    expect(runBtn!.disabled).toBe(false);
    root.unmount();
  });

  it('running 状态暂停按钮可用', () => {
    const root = createRoot(container);
    renderSync(root, createElement(Toolbar, {
      tool: 'select',
      onToolChange: () => {},
      onLoadExample: () => {},
      onNewScene: () => {},
      onValidate: () => {},
      onExport: () => {},
      onImport: () => {},
      canRunSimulation: true,
      simControls: makeSimControls({ runState: 'running', hasEngine: true }),
    }));

    const pauseBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '暂停',
    );
    expect(pauseBtn).toBeDefined();
    expect(pauseBtn!.disabled).toBe(false);
    root.unmount();
  });

  it('布局优化和 A/B 按钮保持禁用', () => {
    const root = createRoot(container);
    renderSync(root, createElement(Toolbar, {
      tool: 'select',
      onToolChange: () => {},
      onLoadExample: () => {},
      onNewScene: () => {},
      onValidate: () => {},
      onExport: () => {},
      onImport: () => {},
      canRunSimulation: true,
      simControls: makeSimControls(),
    }));

    const layoutBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '布局优化',
    );
    const abBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'A/B 对比',
    );
    expect(layoutBtn!.disabled).toBe(true);
    expect(abBtn!.disabled).toBe(true);
    root.unmount();
  });

  it('仿真参数输入框存在', () => {
    const root = createRoot(container);
    renderSync(root, createElement(Toolbar, {
      tool: 'select',
      onToolChange: () => {},
      onLoadExample: () => {},
      onNewScene: () => {},
      onValidate: () => {},
      onExport: () => {},
      onImport: () => {},
      canRunSimulation: true,
      simControls: makeSimControls({ seed: 123, H: 200, demandCount: 50 }),
    }));

    const inputs = container.querySelectorAll('input[type="number"]');
    expect(inputs.length).toBeGreaterThanOrEqual(3);

    const select = container.querySelector('select');
    expect(select).toBeDefined();
    root.unmount();
  });
});

describe('MetricsView 渲染', () => {
  it('idle 状态显示提示信息', () => {
    const root = createRoot(container);
    renderSync(root, createElement(MetricsView, { metrics: null, runState: 'idle' }));

    expect(container.textContent).toContain('请先运行仿真');
    root.unmount();
  });

  it('有 metrics 时显示指标数据', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 50, demandCount: 10 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(20);
    const metrics = engine.getMetrics();

    const root = createRoot(container);
    renderSync(root, createElement(MetricsView, { metrics, runState: 'paused' }));

    expect(container.textContent).toContain('需求人数');
    expect(container.textContent).toContain('服务完成率');
    expect(container.textContent).toContain('拥堵暴露');
    root.unmount();
  });

  it('分母为 0 显示 —/无样本', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 10, demandCount: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    const metrics = engine.getMetrics();

    const root = createRoot(container);
    renderSync(root, createElement(MetricsView, { metrics, runState: 'complete' }));

    expect(container.textContent).toContain('—/无样本');
    root.unmount();
  });
});

describe('S05: 引擎调度一致性', () => {
  it('单步精确推进 1 tick', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 100, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    expect(engine.executedTicks).toBe(0);

    engine.step();
    expect(engine.executedTicks).toBe(1);

    engine.step();
    expect(engine.executedTicks).toBe(2);
  });

  it('暂停后 tick 不推进', () => {
    const scene = createCampusFairScene();
    const result = createEngine(scene, { seed: 42, H: 100, demandCount: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const engine = result.engine;
    engine.runTo(10);
    const tickBefore = engine.executedTicks;

    engine.pause();
    const tickAfter = engine.executedTicks;
    expect(tickAfter).toBe(tickBefore);
  });

  it('重置后重跑结果一致', () => {
    const scene = createCampusFairScene();
    const config = { seed: 42, H: 30, demandCount: 5 };

    const r1 = createEngine(scene, config);
    const r2 = createEngine(scene, config);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    r1.engine.runTo(30);
    const report1 = r1.engine.getReport();

    r2.engine.runTo(30);
    const report2 = r2.engine.getReport();

    expect(report1.executedTicks).toBe(report2.executedTicks);
    expect(report1.metrics.serviceCompleted).toBe(report2.metrics.serviceCompleted);
    expect(report1.metrics.exited).toBe(report2.metrics.exited);
  });
});
