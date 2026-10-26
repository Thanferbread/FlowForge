// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { App } from '../../App';
import * as engines from '../../simulation/engine';
import * as files from '../fileIo';
import { createCampusFairScene } from '../../scenarios/campusFair';
import type { Engine } from '../../simulation/types';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let createSpy: MockInstance<typeof engines.createEngine>;
let rafSpy: MockInstance<typeof requestAnimationFrame>;

function button(text: string) {
  const b = [...container.querySelectorAll('button')].find((x) => x.textContent?.trim() === text || [...x.querySelectorAll('span')].some((s) => s.textContent === text));
  if (!b) throw new Error(`Missing button: ${text}`);
  return b;
}
function click(text: string) { act(() => button(text).click()); }
function input(label: string) {
  const row = [...container.querySelectorAll('.prop-row')].find((r) => r.querySelector('label')?.textContent === label);
  const field = row?.querySelector('input');
  if (!field) throw new Error(`Missing input: ${label}`);
  return field;
}
function change(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  act(() => {
    const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function blur(field: HTMLInputElement) { act(() => field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); }
function config(label: string, value: string) { const field = input(label); change(field, value); blur(field); }
function advance(ms: number) { act(() => vi.advanceTimersByTime(ms)); }
function engine(): Engine {
  const calls = createSpy.mock.results;
  const result = calls[calls.length - 1]?.value as ReturnType<typeof engines.createEngine>;
  if (!result?.ok) throw new Error('No successful App engine');
  return result.engine;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D);
  vi.spyOn(files, 'downloadJson').mockImplementation(() => {});
  createSpy = vi.spyOn(engines, 'createEngine');
  rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 16) as unknown as number;
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(createElement(App)));
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('动画显示层与模型边界', () => {
  it('rAF 不调用 engine.step：运行时模型仅由 setInterval 推进', () => {
    const stepSpy = vi.spyOn(engines, 'createEngine');
    click('运行仿真');
    const eng = engine();
    const stepCountBefore = eng.executedTicks;
    advance(1000);
    expect(eng.executedTicks).toBe(stepCountBefore + 1);
    click('暂停');
    advance(5000);
    expect(eng.executedTicks).toBe(stepCountBefore + 1);
    stepSpy.mockRestore();
  });

  it('单步立即显示格心位置：无持续动画循环', () => {
    click('单步');
    const eng = engine();
    expect(eng.executedTicks).toBe(1);
    expect(eng.runState).toBe('paused');
    const rafCallsAfterStep = rafSpy.mock.calls.length;
    advance(100);
    expect(rafSpy.mock.calls.length).toBe(rafCallsAfterStep);
  });

  it('暂停冻结显示进度；继续复用同一引擎不倒退', () => {
    click('运行仿真');
    const eng = engine();
    advance(1000);
    expect(eng.executedTicks).toBe(1);
    click('暂停');
    const ticksAfterPause = eng.executedTicks;
    advance(5000);
    expect(eng.executedTicks).toBe(ticksAfterPause);
    click('运行仿真');
    expect(engine()).toBe(eng);
    advance(1000);
    expect(eng.executedTicks).toBe(ticksAfterPause + 1);
  });

  it('途中切速不重建引擎不额外推进 tick', () => {
    click('运行仿真');
    const eng = engine();
    advance(1000);
    expect(eng.executedTicks).toBe(1);
    const select = container.querySelector('select')!;
    act(() => { select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(engine()).toBe(eng);
    expect(eng.executedTicks).toBe(1);
    advance(250);
    expect(eng.executedTicks).toBe(2);
  });

  it('complete 后不再推进模型；rAF 自然停止', () => {
    config('时长 H', '1');
    config('人数 N', '0');
    click('单步');
    const eng = engine();
    expect(eng.runState).toBe('complete');
    const ticksAtComplete = eng.executedTicks;
    advance(5000);
    expect(eng.executedTicks).toBe(ticksAtComplete);
  });

  it('cancelled 立即冻结显示保留部分报告', () => {
    click('运行仿真');
    const eng = engine();
    advance(1000);
    click('取消');
    expect(eng.runState).toBe('cancelled');
    const ticksAtCancel = eng.executedTicks;
    advance(5000);
    expect(eng.executedTicks).toBe(ticksAtCancel);
    expect(button('下载报告').disabled).toBe(false);
  });

  it('failed 立即冻结显示保留失败报告', () => {
    const original = engines.createEngine;
    createSpy.mockImplementationOnce((scene, cfg, demands) => {
      const result = original(scene, cfg, demands);
      if (result.ok) {
        const actual = result.engine;
        Object.defineProperty(actual, 'runState', { get: () => 'failed' });
        Object.defineProperty(actual, 'isTerminal', { get: () => true });
        vi.spyOn(actual, 'step').mockImplementation(() => ({ ok: false, snapshot: actual.getSnapshot(), error: 'animation test failure' }));
      }
      return result;
    });
    click('单步');
    expect(button('下载报告').disabled).toBe(false);
    expect(button('运行仿真').disabled).toBe(true);
  });

  it('重置后旧 rAF 无效：不推进新引擎', () => {
    click('运行仿真');
    const old = engine();
    advance(1000);
    click('重置');
    expect(button('下载报告').disabled).toBe(true);
    advance(5000);
    expect(old.executedTicks).toBe(1);
    click('单步');
    const newEng = engine();
    expect(newEng).not.toBe(old);
    expect(newEng.executedTicks).toBe(1);
  });

  it('换图后旧 rAF 无效：旧引擎不推进', () => {
    click('运行仿真');
    const old = engine();
    advance(1000);
    click('障碍');
    const canvas = container.querySelector('canvas')!;
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 15 * 26 + 13, clientY: 5 * 26 + 13 })));
    expect(button('下载报告').disabled).toBe(true);
    advance(5000);
    expect(old.executedTicks).toBe(1);
  });

  it('卸载后旧 rAF 不推进已卸载引擎', () => {
    click('运行仿真');
    const eng = engine();
    advance(1000);
    act(() => root.unmount());
    advance(5000);
    expect(eng.executedTicks).toBe(1);
    root = createRoot(container);
  });

  it('后台标签页自动暂停；返回后保持暂停并提示', () => {
    click('运行仿真');
    const eng = engine();
    advance(500);
    expect(eng.runState).toBe('running');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    act(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
    expect(eng.runState).toBe('paused');
    advance(5000);
    expect(eng.executedTicks).toBe(0);
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    act(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })));
    expect(eng.runState).toBe('paused');
    expect(container.textContent).toContain('后台');
  });

  it('显示层处于两格之间时报告来自最近已提交 tick', () => {
    click('运行仿真');
    const eng = engine();
    advance(500);
    const snap = eng.getSnapshot();
    const metrics = eng.getMetrics();
    expect(snap.tick).toBe(0);
    expect(metrics).toEqual(eng.getMetrics());
    advance(500);
    expect(eng.getSnapshot().tick).toBe(1);
  });
});

describe('StrictMode 动画无重复调度', () => {
  it('StrictMode 下运行不创建重复引擎或重复推进', () => {
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(StrictMode, null, createElement(App))));
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    click('运行仿真');
    const eng = engine();
    advance(1000);
    expect(eng.executedTicks).toBe(1);
    click('暂停');
    const intervalsAfterPause = intervalSpy.mock.calls.length;
    advance(5000);
    expect(eng.executedTicks).toBe(1);
    expect(intervalSpy.mock.calls.length).toBe(intervalsAfterPause);
    intervalSpy.mockRestore();
  });

  it.each([1, 4, 16] as const)('StrictMode %ix 同 tick 与 headless 一致', (speed) => {
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(createElement(StrictMode, null, createElement(App))));
    config('时长 H', '10');
    config('人数 N', '4');
    const select = container.querySelector('select')!;
    act(() => { select.value = String(speed); select.dispatchEvent(new Event('change', { bubbles: true })); });
    click('运行仿真');
    const current = engine();
    advance(3000 / speed);
    click('暂停');
    const headless = engines.createEngine(createCampusFairScene(), { seed: 42, H: 10, demandCount: 4 });
    if (!headless.ok) throw new Error(headless.error);
    headless.engine.runTo(3);
    expect(current.getSnapshot()).toEqual(headless.engine.getSnapshot());
    expect(current.getMetrics()).toEqual(headless.engine.getMetrics());
    act(() => root.unmount());
    advance(3000);
    expect(current.executedTicks).toBe(3);
    root = createRoot(container);
  });
});
