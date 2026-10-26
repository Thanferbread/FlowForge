// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneCanvas } from '../SceneCanvas';
import { createEmptyScene } from '../../domain/geometry';
import type { AgentView } from '../../simulation/types';

type Props = ComponentProps<typeof SceneCanvas>;
type Context = CanvasRenderingContext2D & { fillText: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn>; arc: ReturnType<typeof vi.fn> };
let now: number;
let nextId: number;
let pending: Map<number, FrameRequestCallback>;
let callbacks: FrameRequestCallback[];
let contexts: WeakMap<HTMLCanvasElement, Context>;
let heatColors: WeakMap<HTMLCanvasElement, string[]>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let props: Props;

function person(x: number, y = 1): AgentView { return { id: 'a1', pos: { x, y }, state: 'walking', remainingService: null }; }
function render(change: Partial<Props> = {}, strict = false) {
  props = { ...props, ...change };
  act(() => root.render(strict ? createElement(StrictMode, null, createElement(SceneCanvas, props)) : createElement(SceneCanvas, props)));
}
function layer() { return contexts.get(host.querySelectorAll('canvas')[1])!; }
function position() {
  const calls = layer().fillText.mock.calls.filter((args) => args[0] === 'a1');
  const last = calls[calls.length - 1];
  if (!last) throw new Error('No rendered agent');
  return { x: last[1] as number, y: last[2] as number };
}
function frame(time: number) {
  now = time;
  const work = [...pending.values()];
  pending.clear();
  act(() => work.forEach((callback) => callback(time)));
}
function moveToTwo() { render({ animationTick: 1, prevAgents: [person(1)], agents: [person(2)], animationRunState: 'running' }); }
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, pointerId = 1, isPrimary = true) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'touch' }, isPrimary: { value: isPrimary } });
  act(() => canvas.dispatchEvent(event));
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  now = 0; nextId = 0; pending = new Map(); callbacks = []; contexts = new WeakMap(); heatColors = new WeakMap();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextId; pending.set(id, callback); callbacks.push(callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (!context) {
      const canvas = this;
      heatColors.set(canvas, []);
      context = new Proxy({ fillText: vi.fn(), clearRect: vi.fn(), arc: vi.fn((_x: number, _y: number, radius: number) => {
        if (radius < 0) throw new DOMException('The radius provided is negative.', 'IndexSizeError');
      }) }, {
        get(target, key) { return key in target ? Reflect.get(target, key) : () => {}; },
        set(target, key, value) {
          if (key === 'fillStyle' && typeof value === 'string' && value.startsWith('rgba(')) heatColors.get(canvas)!.push(value);
          Reflect.set(target, key, value); return true;
        },
      }) as unknown as Context;
      contexts.set(this, context);
    }
    return context;
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  props = { scene: createEmptyScene(8, 6), tool: 'select', zoom: 1, selectedBoothId: null,
    onZoomChange: vi.fn(), onCellClick: vi.fn(), onCellDrag: vi.fn(), onResetView: vi.fn(),
    animationTick: 0, animationRunState: 'running', animationContext: {}, tickIntervalMs: 1000,
    agents: [person(1)], prevAgents: [person(1)] };
  render();
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Canvas presentation clock draws actual coordinates', () => {
  it('pause freezes at the fractional position; resume completes the remaining segment', () => {
    moveToTwo(); frame(400); expect(position().x).toBeCloseTo(49.4);
    render({ animationRunState: 'paused' }); expect(position().x).toBeCloseTo(49.4); expect(pending.size).toBe(0);
    frame(900); expect(position().x).toBeCloseTo(49.4);
    render({ animationRunState: 'running', agents: [person(2)], prevAgents: [person(1)] });
    expect(position().x).toBeCloseTo(49.4); expect(pending.size).toBe(1);
    frame(1200); expect(position().x).toBeCloseTo(57.2);
    frame(1500); expect(position().x).toBe(65); expect(pending.size).toBe(0);
  });
  it('speed changes preserve the current fraction and invalidate already queued callbacks', () => {
    moveToTwo(); frame(400); const stale = callbacks[callbacks.length - 1]!;
    render({ tickIntervalMs: 250 }); expect(position().x).toBeCloseTo(49.4); expect(pending.size).toBe(1);
    const draws = layer().clearRect.mock.calls.length;
    act(() => stale(475)); expect(layer().clearRect.mock.calls.length).toBe(draws); expect(pending.size).toBe(1);
    frame(475); expect(position().x).toBeCloseTo(57.2);
    frame(550); expect(position().x).toBe(65); expect(pending.size).toBe(0);
  });
  it('paused speed changes and view changes do not rewind the segment', () => {
    moveToTwo(); frame(400); render({ animationRunState: 'paused' });
    now = 900; render({ tickIntervalMs: 250, zoom: 2 });
    expect(position().x).toBeCloseTo(98.8); expect(pending.size).toBe(0);
    render({ animationRunState: 'running' }); frame(975); expect(position().x).toBeCloseTo(114.4);
  });
  it('a paused new tick is a single step, snaps exactly and leaves no loop', () => {
    moveToTwo(); frame(400); render({ animationRunState: 'paused' });
    render({ animationTick: 2, prevAgents: [person(2)], agents: [person(3)] });
    expect(position().x).toBe(91); expect(pending.size).toBe(0);
  });
  it('complete finishes the final valid segment; cancellation immediately freezes it', () => {
    moveToTwo(); frame(1000);
    render({ animationTick: 2, prevAgents: [person(2)], agents: [person(3)], animationRunState: 'complete' });
    frame(1500); expect(position().x).toBe(78); expect(pending.size).toBe(1);
    frame(2000); expect(position().x).toBe(91); expect(pending.size).toBe(0);
    render({ animationContext: {}, animationTick: 0, animationRunState: 'running', agents: [person(1)], prevAgents: [] });
    moveToTwo(); frame(2400); render({ animationRunState: 'cancelled' });
    expect(position().x).toBeCloseTo(49.4); expect(pending.size).toBe(0);
  });
  it('reset/new run with the same IDs cannot inherit a previous movement or stale rAF', () => {
    moveToTwo(); frame(400); const stale = callbacks[callbacks.length - 1]!;
    render({ animationContext: null, animationTick: 0, animationRunState: 'idle', agents: [], prevAgents: [] });
    const draws = layer().clearRect.mock.calls.length;
    act(() => stale(600)); expect(layer().clearRect.mock.calls.length).toBe(draws); expect(pending.size).toBe(0);
    render({ animationContext: {}, animationRunState: 'running', agents: [person(5)], prevAgents: [person(1)] });
    expect(position().x).toBe(143); expect(pending.size).toBe(0);
  });
  it('a skipped tick snaps safely instead of interpolating a synthesized shortcut', () => {
    moveToTwo(); frame(400);
    render({ animationTick: 3, prevAgents: [person(2)], agents: [person(2, 2)] });
    expect(position()).toEqual({ x: 65, y: 65 }); expect(pending.size).toBe(0);
  });
  it('DPR and resize update both backing stores without restarting a paused segment', () => {
    moveToTwo(); frame(400); render({ animationRunState: 'paused' });
    vi.stubGlobal('devicePixelRatio', 2);
    act(() => window.dispatchEvent(new Event('resize')));
    const [staticCanvas, agentsCanvas] = [...host.querySelectorAll('canvas')];
    expect(staticCanvas.width).toBe(416); expect(agentsCanvas.width).toBe(416);
    expect(staticCanvas.height).toBe(312); expect(agentsCanvas.height).toBe(312);
    expect(position().x).toBeCloseTo(49.4); expect(pending.size).toBe(0);
  });
  it('large viewports enlarge the map to fit while both canvases remain exactly map-sized', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
    render({ scene: createEmptyScene(32, 22) });
    act(() => window.dispatchEvent(new Event('resize')));
    const canvases = [...host.querySelectorAll('canvas')];
    for (const canvas of canvases) {
      expect(canvas.style.width).toBe('1088px');
      expect(canvas.style.height).toBe('748px');
      expect(canvas.width).toBe(1088);
      expect(canvas.height).toBe(748);
    }
    expect(host.querySelector<HTMLElement>('.canvas-stage')!.style.width).toBe('1088px');
  });
  it.each([320, 360, 390, 430])('keeps the default map fully visible at a %ipx phone width', (phoneWidth) => {
    const wrapperWidth = phoneWidth - 18;
    const wrapperHeight = Math.max(315, (phoneWidth - 42) * .6875 + 130) - 96;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(wrapperWidth);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(wrapperHeight);
    render({ scene: createEmptyScene(32, 22) });
    act(() => window.dispatchEvent(new Event('resize')));
    const [canvas, agentsCanvas] = [...host.querySelectorAll('canvas')];
    expect(canvas.width + 24).toBeLessThanOrEqual(wrapperWidth);
    expect(canvas.height + 44).toBeLessThanOrEqual(wrapperHeight);
    expect(canvas.width).toBeGreaterThanOrEqual(256);
    expect(agentsCanvas.width).toBe(canvas.width); expect(agentsCanvas.height).toBe(canvas.height);
    const shrink = host.querySelector<HTMLButtonElement>('button[aria-label="缩小"]')!;
    if (canvas.width === 256) expect(shrink.disabled).toBe(true);
    else {
      act(() => shrink.click());
      const calls = vi.mocked(props.onZoomChange).mock.calls;
      render({ zoom: calls[calls.length - 1]![0] });
      expect(canvas.width).toBe(256);
    }
  });
  it('short viewports keep a safe minimum cell size and never draw negative portal radii', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(30);
    const scene = createEmptyScene(32, 22);
    scene.entrances.push({ id: 'entrance-1', pos: { x: 0, y: 21 } });
    expect(() => {
      render({ scene });
      act(() => window.dispatchEvent(new Event('resize')));
    }).not.toThrow();
    const canvas = host.querySelector('canvas')!;
    expect(canvas.width).toBe(256); expect(canvas.height).toBe(176);
    expect(contexts.get(canvas)!.arc).toHaveBeenCalledWith(4, 172, 2, 0, Math.PI * 2);
  });
  it('fits the whole map and preserves layer alignment and hit testing after centering', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(188);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(158);
    act(() => window.dispatchEvent(new Event('resize')));
    const [canvas, agentsCanvas] = [...host.querySelectorAll('canvas')];
    expect(canvas.width).toBe(152); expect(canvas.height).toBe(114);
    expect(agentsCanvas.width).toBe(152); expect(agentsCanvas.height).toBe(114);
    expect(position()).toEqual({ x: 28.5, y: 28.5 });
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 400, top: 150, width: 152, height: 114, right: 552, bottom: 264, x: 400, y: 150,
      toJSON: () => ({}),
    });
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 448, clientY: 178 })));
    expect(props.onCellClick).toHaveBeenCalledWith({ x: 2, y: 1 });
    const zoomIn = host.querySelector<HTMLButtonElement>('button[aria-label="放大"]')!;
    act(() => zoomIn.click());
    const zoomCalls = vi.mocked(props.onZoomChange).mock.calls;
    const nextZoom = zoomCalls[zoomCalls.length - 1]![0];
    render({ zoom: nextZoom });
    expect(canvas.width).toBe(192);
    act(() => window.dispatchEvent(new Event('resize')));
    expect(canvas.width).toBe(192);
    const reset = [...host.querySelectorAll('button')].find((button) => button.textContent === '重置视图')!;
    act(() => reset.click()); render({ zoom: 1 });
    expect(canvas.width).toBe(152);
  });
  it('touch captures a booth drag, maps the centered canvas correctly and avoids duplicate mouse edits', () => {
    const scene = createEmptyScene(8, 6);
    scene.booths.push({ id: 'booth-1', footprint: { x: 2, y: 1 }, serviceCell: { x: 2, y: 2 },
      queueCells: [{ x: 2, y: 3 }], serviceTicksMin: 1, serviceTicksMax: 1 });
    render({ scene });
    const canvas = host.querySelector('canvas')!;
    const capture = vi.fn(); const release = vi.fn();
    canvas.setPointerCapture = capture; canvas.releasePointerCapture = release; canvas.hasPointerCapture = () => true;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      left: 400, top: 150, width: 208, height: 156, right: 608, bottom: 306, x: 400, y: 150, toJSON: () => ({}),
    });
    pointer(canvas, 'pointerdown', 465, 189);
    pointer(canvas, 'pointermove', 491, 189);
    pointer(canvas, 'pointerup', 491, 189);
    expect(capture).toHaveBeenCalledWith(1); expect(release).toHaveBeenCalledWith(1);
    expect(props.onCellDrag).toHaveBeenCalledTimes(1);
    expect(props.onCellDrag).toHaveBeenCalledWith({ x: 2, y: 1 }, { x: 3, y: 1 });
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 491, clientY: 189 })));
    expect(props.onCellClick).not.toHaveBeenCalled();
  });
  it('touch paints obstacles and cancellation prevents an unfinished booth move', () => {
    render({ tool: 'obstacle' });
    const canvas = host.querySelector('canvas')!;
    pointer(canvas, 'pointerdown', 39, 39);
    pointer(canvas, 'pointermove', 65, 39);
    pointer(canvas, 'pointerup', 65, 39);
    expect(props.onCellClick).toHaveBeenCalledTimes(1);
    expect(props.onCellClick).toHaveBeenCalledWith({ x: 1, y: 1 });
    expect(props.onCellDrag).toHaveBeenCalledTimes(1);
    expect(props.onCellDrag).toHaveBeenCalledWith({ x: 1, y: 1 }, { x: 2, y: 1 });
    vi.mocked(props.onCellDrag).mockClear();
    const scene = createEmptyScene(8, 6);
    scene.booths.push({ id: 'booth-1', footprint: { x: 2, y: 1 }, serviceCell: { x: 2, y: 2 },
      queueCells: [{ x: 2, y: 3 }], serviceTicksMin: 1, serviceTicksMax: 1 });
    render({ scene, tool: 'select' });
    pointer(canvas, 'pointerdown', 65, 39);
    pointer(canvas, 'pointercancel', 91, 39);
    pointer(canvas, 'pointerup', 91, 39);
    expect(props.onCellDrag).not.toHaveBeenCalled();
  });
  it('pan mode scrolls an enlarged viewport with a finger without editing the map', () => {
    const toggle = host.querySelector<HTMLButtonElement>('button[aria-label="切换画布平移"]')!;
    act(() => toggle.click());
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const wrapper = host.querySelector<HTMLElement>('.canvas-wrapper')!;
    wrapper.scrollLeft = 100; wrapper.scrollTop = 50;
    const canvas = host.querySelector('canvas')!;
    pointer(canvas, 'pointerdown', 80, 80);
    pointer(canvas, 'pointermove', 50, 60);
    pointer(canvas, 'pointerup', 50, 60);
    expect(wrapper.scrollLeft).toBe(130); expect(wrapper.scrollTop).toBe(70);
    expect(props.onCellClick).not.toHaveBeenCalled(); expect(props.onCellDrag).not.toHaveBeenCalled();
    expect(canvas.style.touchAction).toBe('none');
    expect(document.body.style.touchAction).toBeFalsy();
  });
  it('StrictMode and unmount leave only one loop, and late callbacks cannot draw', () => {
    act(() => root.unmount()); root = createRoot(host); render({}, true);
    render({ animationTick: 1, prevAgents: [person(1)], agents: [person(2)] }, true);
    expect(pending.size).toBe(1); const stale = callbacks[callbacks.length - 1]!;
    const context = layer(); const draws = context.clearRect.mock.calls.length;
    act(() => root.unmount()); expect(pending.size).toBe(0);
    act(() => stale(500)); expect(context.clearRect.mock.calls.length).toBe(draws);
    root = createRoot(host);
  });
  it('heatmap does not change grid hit-testing and ignores invalid or zero counts', () => {
    render({ heatmap: [[0, 2, NaN], [1, -1, Infinity]], showHeatmap: true, animationRunState: 'paused' });
    const canvas = host.querySelector('canvas')!;
    act(() => canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 65, clientY: 39 })));
    expect(props.onCellClick).toHaveBeenCalledWith({ x: 2, y: 1 });
    expect(position()).toEqual({ x: 39, y: 39 });
  });
  it('heatmap uses a fixed density scale so adding a hotter cell does not recolour existing cells', () => {
    render({ heatmap: [[0.25]], showHeatmap: true });
    const canvas = host.querySelector('canvas')!;
    const original = heatColors.get(canvas)!.slice(-1)[0];
    heatColors.set(canvas, []);
    render({ heatmap: [[0.25, 0.5, 12, NaN, 0, -1, Infinity]], showHeatmap: true });
    const colors = heatColors.get(canvas)!;
    expect(colors).toHaveLength(3); expect(colors[0]).toBe(original); expect(colors[1]).toBe(colors[2]);
  });
  it('animation frames leave the static map and its backing dimensions untouched', () => {
    moveToTwo(); const canvas = host.querySelector('canvas')!; const context = contexts.get(canvas)!;
    const draws = context.fillText.mock.calls.length;
    frame(100); frame(300); frame(700);
    expect(context.fillText.mock.calls.length).toBe(draws);
    expect(canvas.width).toBe(208); expect(canvas.height).toBe(156); expect(pending.size).toBe(1);
  });
});
