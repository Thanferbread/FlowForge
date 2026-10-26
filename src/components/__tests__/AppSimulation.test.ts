// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { App } from '../../App';
import * as engines from '../../simulation/engine';
import * as files from '../fileIo';
import { createCampusFairScene } from '../../scenarios/campusFair';
import { exportScene } from '../../domain/serialization';
import type { Engine } from '../../simulation/types';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let createSpy: MockInstance<typeof engines.createEngine>;
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
function cell(x: number, y: number, type = 'mousedown') {
  const canvas = container.querySelector('canvas')!;
  act(() => canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x * 26 + 13, clientY: y * 26 + 13 })));
}
function count(label: string) { return [...container.querySelectorAll('.stat-row')].find((r) => r.textContent?.startsWith(label))?.textContent; }
function sceneJson(changed = false, reverse = false) {
  const scene = createCampusFairScene();
  if (changed) scene.obstacles.push({ x: 15, y: 5 });
  if (reverse) { scene.obstacles.reverse(); scene.booths.reverse(); scene.entrances.reverse(); scene.exits.reverse(); }
  const result = exportScene(scene);
  if (!result.ok) throw new Error(result.error);
  return result.json;
}
function importText(json: string) {
  click('导入 JSON'); change(container.querySelector('textarea')!, json); click('导入文本');
}
function fileChange() {
  const field = container.querySelector('input[type="file"]')!;
  Object.defineProperty(field, 'files', { configurable: true, value: [new File(['{}'], 'scene.json')] });
  act(() => field.dispatchEvent(new Event('change', { bubbles: true })));
}
function downloadReport() {
  click('下载报告');
  const calls = vi.mocked(files.downloadJson).mock.calls;
  return JSON.parse(calls[calls.length - 1][0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(new Proxy({}, { get: () => () => {}, set: () => true }) as CanvasRenderingContext2D);
  vi.spyOn(files, 'downloadJson').mockImplementation(() => {});
  createSpy = vi.spyOn(engines, 'createEngine');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(createElement(App)));
});
afterEach(() => {
  act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('真实 App 仿真控件与上下文回归', () => {
  it('单步立即发布 paused；新建空地图清空指标、下载并停止旧引擎', () => {
    click('单步'); const old = engine(); expect(old.executedTicks).toBe(1); expect(old.runState).toBe('paused');
    click('运行仿真'); click('新建空白场景');
    expect(container.textContent).toContain('请先运行仿真'); expect(button('下载报告').disabled).toBe(true);
    expect(old.runState).toBe('cancelled'); advance(5000); expect(old.executedTicks).toBe(1);
  });
  it('空草稿/越界/预算失败/未改值保留运行；有效模型参数提交才清空', () => {
    click('单步'); const old = engine();
    change(input('时长 H'), ''); expect(button('下载报告').disabled).toBe(false);
    blur(input('时长 H')); expect(input('时长 H').value).toBe('300');
    config('时长 H', '300'); expect(button('下载报告').disabled).toBe(false);
    config('人数 N', '501'); expect(input('人数 N').value).toBe('180'); expect(button('下载报告').disabled).toBe(false);
    config('时长 H', '1800'); expect(input('时长 H').value).toBe('300'); expect(button('下载报告').disabled).toBe(false);
    config('人数 N', '5'); expect(button('下载报告').disabled).toBe(true); expect(old.runState).toBe('cancelled');
    click('单步'); expect(engine()).not.toBe(old); expect(engine().getReport().config.demandCount).toBe(5);
  });
  it('输入 Enter 提交，种子0是有效值', () => {
    click('单步'); change(input('种子'), '0');
    act(() => input('种子').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
    expect(button('下载报告').disabled).toBe(true); click('单步'); expect(engine().getReport().config.seed).toBe(0);
  });
  it('暂停继续复用引擎；切速保持tick且新旧回调仅新代次可推进', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval'); click('运行仿真'); const current = engine();
    expect(button('暂停').disabled).toBe(false); expect(container.textContent).not.toContain('请先运行仿真');
    advance(1000); expect(current.executedTicks).toBe(1); click('暂停'); advance(4000); expect(current.executedTicks).toBe(1);
    click('运行仿真'); expect(engine()).toBe(current);
    const oldCallback = intervalSpy.mock.calls[intervalSpy.mock.calls.length - 1][0] as () => void;
    const select = container.querySelector('select')!;
    act(() => { select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    act(() => oldCallback()); expect(current.executedTicks).toBe(1);
    advance(250); expect(current.executedTicks).toBe(2);
    click('暂停'); expect(current.runState).toBe('paused');
  });
  it('取消发布终态并保留部分报告，重置后新建引擎；旧回调不可推进新工作', () => {
    const intervals = vi.spyOn(globalThis, 'setInterval'); click('运行仿真'); const old = engine();
    const callback = intervals.mock.calls[intervals.mock.calls.length - 1][0] as () => void;
    advance(1000); click('取消');
    expect(button('运行仿真').disabled).toBe(true); expect(button('单步').disabled).toBe(true); expect(button('下载报告').disabled).toBe(false);
    expect(downloadReport()).toMatchObject({ executedTicks: 1, isComplete: false, nonCoreMetadata: { runState: 'cancelled' } });
    click('重置'); expect(button('下载报告').disabled).toBe(true); click('运行仿真'); const current = engine();
    expect(current).not.toBe(old); act(() => callback()); expect(current.executedTicks).toBe(0); expect(old.executedTicks).toBe(1);
    advance(1000); expect(current.executedTicks).toBe(1);
  });
  it('完整报告回读；完成态无法隐式重新开始或单步', () => {
    config('时长 H', '1'); config('人数 N', '0'); click('单步');
    expect(engine().runState).toBe('complete'); expect(button('运行仿真').disabled).toBe(true); expect(button('单步').disabled).toBe(true);
    expect(downloadReport()).toMatchObject({ executedTicks: 1, isComplete: true, nonCoreMetadata: { runState: 'complete' } });
  });
  it('失败态也立即发布，保留失败报告直到显式重置', () => {
    const original = engines.createEngine;
    createSpy.mockImplementationOnce((scene, cfg, demands) => {
      const result = original(scene, cfg, demands);
      if (result.ok) {
        const actual = result.engine;
        Object.defineProperty(actual, 'runState', { get: () => 'failed' });
        Object.defineProperty(actual, 'isTerminal', { get: () => true });
        vi.spyOn(actual, 'step').mockImplementation(() => ({ ok: false, snapshot: actual.getSnapshot(), error: 'intentional UI failure' }));
      }
      return result;
    });
    click('单步'); expect(button('运行仿真').disabled).toBe(true); expect(button('单步').disabled).toBe(true); expect(button('下载报告').disabled).toBe(false);
    click('重置'); expect(button('运行仿真').disabled).toBe(false);
  });
  it('选择/缩放/服务参数未改值/相同规范场景载入与导入保留当前仿真', () => {
    click('单步'); const current = engine(); cell(10, 5); cell(10, 5, 'mouseup'); blur(input('服务时长下限'));
    click('重置视图'); click('载入招聘会示例'); expect(button('下载报告').disabled).toBe(false);
    importText(sceneJson(false, true)); expect(button('下载报告').disabled).toBe(false);
    importText('{broken'); expect(button('下载报告').disabled).toBe(false); click('关闭');
    click('运行仿真'); advance(1000); expect(engine()).toBe(current); expect(current.executedTicks).toBe(2);
  });
  it('非法绘制保留；有效障碍/擦除/服务参数提交清空结果', () => {
    click('单步'); click('障碍'); cell(10, 5); expect(button('下载报告').disabled).toBe(false);
    cell(15, 5); expect(button('下载报告').disabled).toBe(true); click('单步');
    click('擦除'); cell(15, 5); expect(button('下载报告').disabled).toBe(true); click('单步');
    click('选择'); cell(10, 5); cell(10, 5, 'mouseup'); change(input('服务时长下限'), '3'); blur(input('服务时长下限'));
    expect(button('下载报告').disabled).toBe(true);
  });
  it('拖涂、移动展位和队列长度有效提交分别清空旧运行', () => {
    click('单步'); click('障碍'); cell(15, 5); cell(15, 7, 'mousemove'); cell(15, 7, 'mouseup');
    expect(count('障碍数量')).toBe('障碍数量23'); expect(button('下载报告').disabled).toBe(true);
    click('单步'); click('选择'); cell(10, 5); cell(12, 5, 'mouseup');
    expect(button('下载报告').disabled).toBe(true); click('单步'); cell(12, 5); cell(12, 5, 'mouseup');
    change(input('队列长度 K'), '2'); blur(input('队列长度 K')); expect(button('下载报告').disabled).toBe(true);
  });
  it('取消覆盖确认保留运行，晚到的旧确认不能覆盖新参数上下文', () => {
    click('障碍'); cell(15, 5); click('单步'); click('新建空白场景');
    const dialog = container.querySelector('[role="dialog"]')!;
    act(() => (dialog.querySelector('button') as HTMLButtonElement).click()); expect(button('下载报告').disabled).toBe(false);
    click('新建空白场景'); config('种子', '43'); click('确定');
    expect(count('入口数量')).toBe('入口数量2'); expect(button('运行仿真').disabled).toBe(false);
  });
  it('有效JSON导入改变场景并清空旧仿真', () => {
    click('单步'); importText(sceneJson(true)); expect(count('障碍数量')).toBe('障碍数量21'); expect(button('下载报告').disabled).toBe(true);
  });
  it.each(['close', 'parameter', 'reset'] as const)('晚到文件在 %s 后不覆盖后续工作', async (operation) => {
    let resolve!: (text: string) => void;
    vi.spyOn(files, 'readJsonFile').mockImplementation(() => new Promise<string>((r) => { resolve = r; }));
    click('单步'); click('导入 JSON'); fileChange();
    if (operation === 'close') click('关闭');
    else if (operation === 'parameter') config('种子', '43');
    else click('重置');
    await act(async () => { resolve(sceneJson(true)); await Promise.resolve(); });
    expect(count('障碍数量')).toBe('障碍数量20');
    expect(button('下载报告').disabled).toBe(operation !== 'close');
  });
  it('两个文件异步返回乱序时仅最新选择生效', async () => {
    const resolves: ((text: string) => void)[] = [];
    vi.spyOn(files, 'readJsonFile').mockImplementation(() => new Promise<string>((r) => { resolves.push(r); }));
    click('导入 JSON'); fileChange(); fileChange();
    await act(async () => { resolves[1](sceneJson(true)); await Promise.resolve(); });
    await act(async () => { resolves[0](sceneJson()); await Promise.resolve(); });
    expect(count('障碍数量')).toBe('障碍数量21');
  });
  it('文件读取期间修改导入草稿，旧文件结果不能覆盖新草稿与当前运行', async () => {
    let resolve!: (text: string) => void;
    vi.spyOn(files, 'readJsonFile').mockImplementation(() => new Promise<string>((r) => { resolve = r; }));
    click('单步'); click('导入 JSON'); fileChange();
    change(container.querySelector('textarea')!, '{new draft');
    await act(async () => { resolve(sceneJson(true)); await Promise.resolve(); });
    expect(count('障碍数量')).toBe('障碍数量20');
    expect(container.querySelector('textarea')?.value).toBe('{new draft');
    expect(button('下载报告').disabled).toBe(false);
  });
  it('导入覆盖确认在关闭导入弹窗后失效，不能覆盖原场景和运行', async () => {
    click('障碍'); cell(15, 5); click('单步'); importText(sceneJson());
    click('关闭'); click('确定');
    expect(count('障碍数量')).toBe('障碍数量21');
    expect(button('下载报告').disabled).toBe(false);
  });
  it('报告下载失败反馈错误并保留原引擎，稍后可重试成功', () => {
    click('单步'); const current = engine();
    vi.mocked(files.downloadJson).mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    click('下载报告');
    expect(container.querySelector('.toast.error')?.textContent).toContain('disk unavailable');
    expect(button('下载报告').disabled).toBe(false); expect(engine()).toBe(current); expect(current.executedTicks).toBe(1);
    expect(downloadReport()).toMatchObject({ executedTicks: 1, isComplete: false });
  });
  it('场景下载失败反馈错误，弹窗与当前仿真保留供重试', () => {
    click('单步'); const current = engine(); click('导出 JSON');
    vi.mocked(files.downloadJson).mockImplementationOnce(() => { throw new Error('URL allocation failed'); });
    click('下载文件');
    expect(container.querySelector('.toast.error')?.textContent).toContain('URL allocation failed');
    expect(container.querySelector('textarea')?.value).toContain('schemaVersion');
    expect(engine()).toBe(current); expect(button('下载报告').disabled).toBe(false);
    click('下载文件'); expect(vi.mocked(files.downloadJson)).toHaveBeenCalledTimes(2);
  });
  it.each([1, 4, 16] as const)('StrictMode %ix调度与相同输入 headless 同tick一致，卸载清理', (speed) => {
    act(() => root.unmount()); root = createRoot(container); act(() => root.render(createElement(StrictMode, null, createElement(App))));
    config('时长 H', '10'); config('人数 N', '4');
    const select = container.querySelector('select')!;
    act(() => { select.value = String(speed); select.dispatchEvent(new Event('change', { bubbles: true })); });
    click('运行仿真'); const current = engine(); advance(3000 / speed); click('暂停');
    const headless = engines.createEngine(createCampusFairScene(), { seed: 42, H: 10, demandCount: 4 });
    if (!headless.ok) throw new Error(headless.error); headless.engine.runTo(3);
    expect(current.getSnapshot()).toEqual(headless.engine.getSnapshot()); expect(current.getMetrics()).toEqual(headless.engine.getMetrics());
    click('运行仿真'); act(() => root.unmount()); advance(3000); expect(current.executedTicks).toBe(3); root = createRoot(container);
  });
});




