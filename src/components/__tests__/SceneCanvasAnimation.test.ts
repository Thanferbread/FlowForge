// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SceneCanvas } from '../SceneCanvas';
import { createEmptyScene } from '../../domain/geometry';
import type { AgentView } from '../../simulation/types';

type Props = ComponentProps<typeof SceneCanvas>;
type Context = CanvasRenderingContext2D & { fillText: ReturnType<typeof vi.fn>; clearRect: ReturnType<typeof vi.fn> };
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
      context = new Proxy({ fillText: vi.fn(), clearRect: vi.fn() }, {
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
