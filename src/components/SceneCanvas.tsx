/**
 * 场景画布组件：使用原生 Canvas 绘制网格地图，处理鼠标交互。
 *
 * 特性：
 * - 分层 Canvas：静态底图 + 人员动画层，静态层仅在场景/缩放/DPR 变化时重绘。
 * - 高 DPI 支持：根据 devicePixelRatio 缩放 backing store。
 * - 缩放与平移：滚轮缩放，按钮重置视图。
 * - 坐标准确：CSS 缩放与高 DPI 下格点坐标仍精确映射。
 * - 不同对象用形状 + 颜色区分（不只靠颜色）。
 * - 人员层使用 requestAnimationFrame 在相邻格心间插值，不推进模型。
 */
import { useRef, useLayoutEffect, useState, useCallback } from 'react';
import type { Scene, GridPos } from '../domain/types';
import type { Tool } from '../App';
import type { AgentView, UiRunState } from '../simulation/types';
import type { AgentDisplay } from '../simulation/interpolation';
import { computeAgentDisplays, computeProgress, isOrthoAdjacent } from '../simulation/interpolation';
import { cellAt } from '../domain/operations';

interface SceneCanvasProps {
  scene: Scene;
  tool: Tool;
  selectedBoothId: string | null;
  zoom: number;
  onZoomChange: (z: number) => void;
  onCellClick: (pos: GridPos) => void;
  onCellDrag: (from: GridPos, to: GridPos) => void;
  onResetView: () => void;
  agents?: AgentView[];
  prevAgents?: AgentView[];
  tickIntervalMs?: number;
  animationActive?: boolean;
  animationRunState?: UiRunState;
  animationTick?: number;
  animationContext?: object | number | string | null;
  /** Real density in people/m², grid[y][x]; the shared colour scale saturates at 0.5. */
  heatmap?: number[][];
  showHeatmap?: boolean;
}

const BASE_CELL = 26;
// Eight CSS pixels keeps the default 32-column map visible on a 320px phone.
// Never shrink further: entrance symbols need a positive drawing radius.
const MIN_CELL = 8;
const MIN_ZOOM = MIN_CELL / BASE_CELL;
const MAX_ZOOM = 3;
const VIEW_PADDING = 24;
const COORD_HEIGHT = 20;

function sizeCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, dpr: number) {
  if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
  if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;
  const width = Math.round(cssW * dpr);
  const height = Math.round(cssH * dpr);
  // CSS dimensions can stay identical while the window moves to another DPI.
  // Setting these properties also clears the canvas, so avoid it per frame.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** 动画内部状态 */
interface AnimState {
  prevAgents: AgentView[];
  currAgents: AgentView[];
  startTime: number;
  intervalMs: number;
  active: boolean;
  frozenProgress: number | null;
  rafId: number | null;
  animGen: number;
  mounted: boolean;
  hasFrame: boolean;
  frameKey: number | string;
  context: unknown;
  runState: UiRunState;
  lastTick: number | string | null;
  finishing: boolean;
  scene: Scene | null;
}

export function SceneCanvas({
  scene,
  tool,
  selectedBoothId,
  zoom,
  onZoomChange,
  onCellClick,
  onCellDrag,
  onResetView,
  agents,
  prevAgents,
  tickIntervalMs,
  animationActive,
  animationRunState,
  animationTick,
  animationContext,
  heatmap,
  showHeatmap = false,
}: SceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentCanvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const activePointerRef = useRef<number | null>(null);
  const pointerEventsSeenRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [hoverPos, setHoverPos] = useState<GridPos | null>(null);
  const [dragState, setDragState] = useState<{ start: GridPos; current: GridPos } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [fitView, setFitView] = useState(true);
  const [panView, setPanView] = useState(false);
  const [panning, setPanning] = useState(false);

  const requestedCellSize = Math.max(MIN_CELL, Math.min(BASE_CELL * MAX_ZOOM, Math.round(BASE_CELL * zoom)));
  const fittedCellSize = viewport.width > 0 && viewport.height > 0
    ? Math.max(MIN_CELL, Math.min(BASE_CELL * MAX_ZOOM, Math.floor(Math.min(
      (viewport.width - VIEW_PADDING) / scene.width,
      (viewport.height - VIEW_PADDING - COORD_HEIGHT) / scene.height,
    ))))
    : requestedCellSize;
  const cellSize = fitView ? fittedCellSize : requestedCellSize;
  const viewZoom = cellSize / BASE_CELL;
  const changeZoom = (next: number) => {
    setFitView(false);
    onZoomChange(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100)));
  };

  useLayoutEffect(() => { setFitView(true); }, [scene.width, scene.height]);

  const animStateRef = useRef<AnimState>({
    prevAgents: [],
    currAgents: [],
    startTime: 0,
    intervalMs: 1000,
    active: false,
    frozenProgress: null,
    rafId: null,
    animGen: 0,
    mounted: false,
    hasFrame: false,
    frameKey: '',
    context: undefined,
    runState: 'idle',
    lastTick: null,
    finishing: false,
    scene: null,
  });

  /** 屏幕坐标 → 格子坐标 */
  const screenToCell = useCallback(
    (clientX: number, clientY: number): GridPos | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((clientX - rect.left) / cellSize);
      const y = Math.floor((clientY - rect.top) / cellSize);
      if (x < 0 || x >= scene.width || y < 0 || y >= scene.height) return null;
      return { x, y };
    },
    [cellSize, scene.width, scene.height],
  );

  /** 绘制静态场景底图（不含人员） */
  const drawStatic = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = scene.width * cellSize;
    const cssH = scene.height * cellSize;
    // Only the map determines the backing store. A viewport-sized in-flow
    // canvas can feed its previous width back into a flex/grid container.
    sizeCanvas(canvas, cssW, cssH, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.strokeStyle = '#cdd6dd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= scene.width; x++) {
      const px = x * cellSize + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, cssH);
    }
    for (let y = 0; y <= scene.height; y++) {
      const py = y * cellSize + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(cssW, py);
    }
    ctx.stroke();

    ctx.strokeStyle = '#7f8c8d';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);

    for (const o of scene.obstacles) {
      drawObstacle(ctx, o.x * cellSize, o.y * cellSize, cellSize);
    }

    for (const b of scene.booths) {
      const isSelected = b.id === selectedBoothId;
      for (let i = 0; i < b.queueCells.length; i++) {
        const q = b.queueCells[i];
        drawQueueCell(ctx, q.x * cellSize, q.y * cellSize, cellSize, i + 1, isSelected);
      }
      drawServiceCell(ctx, b.serviceCell.x * cellSize, b.serviceCell.y * cellSize, cellSize, isSelected);
      drawBoothFootprint(ctx, b.footprint.x * cellSize, b.footprint.y * cellSize, cellSize, b.id, isSelected);
    }

    for (const e of scene.entrances) {
      drawEntrance(ctx, e.pos.x * cellSize, e.pos.y * cellSize, cellSize, e.id);
    }
    for (const e of scene.exits) {
      drawExit(ctx, e.pos.x * cellSize, e.pos.y * cellSize, cellSize, e.id);
    }

    // Draw above the geometry: otherwise opaque queue/service cells would hide
    // the busiest locations. The transparent overlay leaves their labels visible.
    // A fixed 0–0.5 people/m² scale keeps different scenes comparable.
    if (showHeatmap && heatmap) {
      for (let y = 0; y < scene.height; y++) for (let x = 0; x < scene.width; x++) {
        const density = heatmap[y]?.[x];
        if (!Number.isFinite(density) || density <= 0) continue;
        const weight = Math.min(1, density / 0.5);
        ctx.fillStyle = `rgba(${Math.round(30 + 220 * weight)}, ${Math.round(170 - 90 * weight)}, ${Math.round(200 - 160 * weight)}, ${0.12 + weight * 0.5})`;
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    if (hoverPos) {
      ctx.strokeStyle = '#0e7c9b';
      ctx.lineWidth = 2;
      ctx.strokeRect(hoverPos.x * cellSize + 1, hoverPos.y * cellSize + 1, cellSize - 2, cellSize - 2);
    }

    if (dragState && tool === 'select') {
      const info = cellAt(scene, dragState.start);
      if (info.kind === 'booth-footprint') {
        ctx.strokeStyle = '#d68910';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(
          dragState.current.x * cellSize + 1,
          dragState.current.y * cellSize + 1,
          cellSize - 2,
          cellSize - 2,
        );
        ctx.setLineDash([]);
      }
    }

  }, [scene, cellSize, selectedBoothId, hoverPos, dragState, tool, heatmap, showHeatmap]);

  /** 绘制人员层到 agentCanvas */
  const drawAgents = useCallback((displays: AgentDisplay[]) => {
    const canvas = agentCanvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = scene.width * cellSize;
    const cssH = scene.height * cellSize;
    sizeCanvas(canvas, cssW, cssH, dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    for (const a of displays) {
      drawAgent(ctx, a.displayPos.x * cellSize, a.displayPos.y * cellSize, cellSize, a.state, a.id);
    }
  }, [scene, cellSize]);

  // Drawing functions may change for zoom, hover or resize. The current clock
  // and segment are independent, so these renders must not replay a movement.
  const drawAgentsRef = useRef(drawAgents);
  const drawStaticRef = useRef(drawStatic);
  drawAgentsRef.current = drawAgents;
  drawStaticRef.current = drawStatic;

  const redrawCurrent = useCallback(() => {
    const state = animStateRef.current;
    const progress = state.frozenProgress ?? computeProgress(performance.now(), state.startTime, state.intervalMs);
    drawAgentsRef.current(computeAgentDisplays(state.prevAgents, state.currAgents, progress));
  }, []);

  const stopAnimation = useCallback(() => {
    const state = animStateRef.current;
    state.animGen++;
    if (state.rafId !== null) cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }, []);

  const startAnimation = useCallback(() => {
    const state = animStateRef.current;
    if (!state.mounted || !state.active || state.rafId !== null) return;
    const generation = state.animGen;
    const frame = (now: number) => {
      // A cancelled browser callback can already be queued. Do not let it draw,
      // clear a newer handle, or schedule a second loop after a control change.
      if (!state.mounted || generation !== state.animGen || !state.active) return;
      state.rafId = null;
      const progress = computeProgress(now, state.startTime, state.intervalMs);
      drawAgentsRef.current(computeAgentDisplays(state.prevAgents, state.currAgents, progress));
      if (progress >= 1) {
        state.active = false;
        state.frozenProgress = 1;
      } else {
        state.rafId = requestAnimationFrame(frame);
      }
    };
    state.rafId = requestAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    animStateRef.current.mounted = true;
    return () => {
      animStateRef.current.mounted = false;
      stopAnimation();
    };
  }, [stopAnimation]);

  /** One reconciliation per committed tick or control change, never per frame. */
  useLayoutEffect(() => {
    const state = animStateRef.current;
    const now = performance.now();
    const interval = tickIntervalMs ?? 1000;
    const mode = animationRunState ?? (animationActive ? 'running' : 'paused');
    const context = animationContext === undefined ? scene : animationContext;
    const curr = agents ?? [];
    const prev = prevAgents ?? [];
    // Legacy callers can omit a tick; content, rather than array identity,
    // prevents a parent rerender from starting the same segment again.
    const frameKey = animationTick ?? curr.map((a) => `${a.id}:${a.pos.x},${a.pos.y}:${a.state}`).join('|');
    const contextChanged = !state.hasFrame || !Object.is(context, state.context) || scene !== state.scene;
    const frameChanged = contextChanged || frameKey !== state.frameKey;
    const wasRunning = state.runState === 'running';
    const oldProgress = state.frozenProgress ?? computeProgress(now, state.startTime, state.intervalMs);
    stopAnimation();

    state.context = context;
    state.scene = scene;
    state.frameKey = frameKey;
    state.hasFrame = true;
    state.runState = mode;
    state.intervalMs = interval;

    let progress = oldProgress;
    if (frameChanged) {
      state.prevAgents = prev;
      state.currAgents = curr;
      const prevById = new Map(prev.map((a) => [a.id, a]));
      const hasMovement = curr.some((a) => {
        const before = prevById.get(a.id);
        return before && isOrthoAdjacent(before.pos, a.pos);
      });
      const contiguous = !contextChanged && (typeof frameKey !== 'number' || typeof state.lastTick !== 'number' || frameKey === state.lastTick + 1);
      const mayAnimate = mode === 'running' || (mode === 'complete' && wasRunning);
      progress = hasMovement && mayAnimate && contiguous && Number.isFinite(interval) && interval > 0 ? 0 : 1;
      state.lastTick = frameKey;
    }

    const shouldPlay = mode === 'running' || (mode === 'complete' && (wasRunning || state.finishing));
    state.finishing = mode === 'complete' && shouldPlay && progress < 1;
    state.active = shouldPlay && progress < 1 && Number.isFinite(interval) && interval > 0;
    state.startTime = now - progress * interval;
    state.frozenProgress = state.active ? null : progress;
    redrawCurrent();
    startAnimation();
  }, [agents, prevAgents, animationTick, animationContext, animationRunState, animationActive, tickIntervalMs, scene, redrawCurrent, startAnimation, stopAnimation]);

  /** Resize/DPR redraws both layers at the same frozen or live presentation time. */
  useLayoutEffect(() => {
    drawStatic();
    redrawCurrent();
  }, [drawStatic, drawAgents, redrawCurrent]);

  useLayoutEffect(() => {
    const redraw = () => {
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const width = wrapper.clientWidth;
        const height = wrapper.clientHeight;
        setViewport((previous) => previous.width === width && previous.height === height ? previous : { width, height });
      }
      drawStaticRef.current();
      redrawCurrent();
    };
    redraw();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(redraw);
    if (wrapperRef.current) observer?.observe(wrapperRef.current);
    window.addEventListener('resize', redraw);
    let media: MediaQueryList | null = null;
    const watchDpr = () => {
      media?.removeEventListener('change', handleDpr);
      media = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
      media?.addEventListener('change', handleDpr);
    };
    const handleDpr = () => { redraw(); watchDpr(); };
    watchDpr();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', redraw);
      media?.removeEventListener('change', handleDpr);
    };
  }, [redrawCurrent]);

  /** 鼠标按下 */
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToCell(e.clientX, e.clientY);
      if (!pos) return;
      if (tool === 'select') {
        const info = cellAt(scene, pos);
        if (info.kind === 'booth-footprint') {
          setDragState({ start: pos, current: pos });
          return;
        }
      }
      if (tool === 'obstacle') {
        onCellClick(pos);
        setDragState({ start: pos, current: pos });
        return;
      }
      onCellClick(pos);
    },
    [screenToCell, tool, scene, onCellClick],
  );

  /** 鼠标移动 */
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToCell(e.clientX, e.clientY);
      setHoverPos(pos);
      if (dragState && pos) {
        if (tool === 'obstacle' && (pos.x !== dragState.current.x || pos.y !== dragState.current.y)) {
          onCellDrag(dragState.current, pos);
        }
        setDragState({ ...dragState, current: pos });
      }
    },
    [screenToCell, dragState, tool, onCellDrag],
  );

  /** 鼠标抬起 */
  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToCell(e.clientX, e.clientY);
      if (dragState) {
        if (tool === 'select') {
          if (pos && (pos.x !== dragState.start.x || pos.y !== dragState.start.y)) {
            onCellDrag(dragState.start, pos);
          } else if (pos) {
            onCellClick(pos);
          }
        }
        setDragState(null);
      }
    },
    [screenToCell, dragState, tool, onCellDrag, onCellClick],
  );

  /** 鼠标离开 */
  const handleMouseLeave = useCallback(() => {
    setHoverPos(null);
  }, []);

  // Capture one primary pointer so a finger can finish a booth drag outside
  // the map. Panning is explicit: scrolling the viewport must never edit cells.
  const releasePointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== e.pointerId) return;
    activePointerRef.current = null;
    panStartRef.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerEventsSeenRef.current = true;
    if (!e.isPrimary || e.button !== 0 || activePointerRef.current !== null) return;
    e.preventDefault();
    activePointerRef.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (panView) {
      const wrapper = wrapperRef.current;
      if (wrapper) panStartRef.current = { x: e.clientX, y: e.clientY, left: wrapper.scrollLeft, top: wrapper.scrollTop };
      setPanning(true);
    } else handleMouseDown(e);
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== null && activePointerRef.current !== e.pointerId) return;
    const start = panStartRef.current;
    const wrapper = wrapperRef.current;
    if (start && wrapper) {
      wrapper.scrollLeft = start.left + start.x - e.clientX;
      wrapper.scrollTop = start.top + start.y - e.clientY;
    } else if (!panView) handleMouseMove(e);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== e.pointerId) return;
    if (!panStartRef.current) handleMouseUp(e);
    releasePointer(e);
  };
  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current !== e.pointerId) return;
    setDragState(null);
    setHoverPos(null);
    releasePointer(e);
  };

  /** 滚轮缩放 */
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setFitView(false);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewZoom + delta));
      onZoomChange(Math.round(newZoom * 100) / 100);
    },
    [viewZoom, onZoomChange],
  );

  const cursor = panView ? (panning ? 'grabbing' : 'grab') : tool === 'select' ? 'pointer' : tool === 'erase' ? 'not-allowed' : 'crosshair';

  return (
    <div className="canvas-area">
      <div className="canvas-toolbar">
        <div className="zoom-control">
          <button onClick={() => changeZoom(viewZoom - 0.2)} aria-label="缩小" disabled={cellSize <= MIN_CELL}>
            －
          </button>
          <span style={{ fontSize: 13, minWidth: 48, textAlign: 'center' }}>
            {Math.round(viewZoom * 100)}%
          </span>
          <button onClick={() => changeZoom(viewZoom + 0.2)} aria-label="放大" disabled={cellSize >= BASE_CELL * MAX_ZOOM}>
            ＋
          </button>
          <button onClick={() => {
            setFitView(true);
            wrapperRef.current?.scrollTo?.(0, 0);
            onResetView();
          }}>重置视图</button>
          <button aria-label="切换画布平移" aria-pressed={panView} title="开启后拖动画布；关闭后编辑网格" onClick={() => {
            setPanView((previous) => !previous);
            setDragState(null);
            setHoverPos(null);
          }}>平移</button>
        </div>
        <span style={{ fontSize: 13, color: '#6b7a8a' }}>
          工具：{toolLabel(tool)}　地图：{scene.width}×{scene.height}
        </span>
        <span className="coord">
          {hoverPos ? `坐标 (${hoverPos.x}, ${hoverPos.y})` : '坐标 —'}
        </span>
      </div>
      <div className="canvas-wrapper" ref={wrapperRef}>
        <div className="canvas-stage" style={{ width: scene.width * cellSize, height: scene.height * cellSize + COORD_HEIGHT }}>
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handlePointerCancel}
          onMouseDown={(e) => { if (!pointerEventsSeenRef.current && !panView) handleMouseDown(e); }}
          onMouseMove={(e) => { if (!pointerEventsSeenRef.current && !panView) handleMouseMove(e); }}
          onMouseUp={(e) => { if (!pointerEventsSeenRef.current && !panView) handleMouseUp(e); }}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          style={{ cursor, touchAction: 'none' }}
        />
        <canvas
          ref={agentCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
        />
          <div className="canvas-coordinates" aria-hidden="true">
            <span>0,0</span><span>{scene.width - 1},{scene.height - 1}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function toolLabel(t: Tool): string {
  switch (t) {
    case 'select':
      return '选择';
    case 'obstacle':
      return '障碍';
    case 'erase':
      return '擦除';
    case 'entrance':
      return '入口';
    case 'exit':
      return '出口';
    case 'booth':
      return '展位';
  }
}

// ===== 绘制函数 =====

function drawObstacle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = '#7f8c8d';
  ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  ctx.strokeStyle = '#5d6d7e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 2, y + 2);
  ctx.lineTo(x + s - 2, y + s - 2);
  ctx.moveTo(x + s - 2, y + 2);
  ctx.lineTo(x + 2, y + s - 2);
  ctx.stroke();
}

function drawEntrance(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, id: string) {
  ctx.fillStyle = '#27ae60';
  ctx.beginPath();
  ctx.arc(x + s / 2, y + s / 2, s / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(10, s - 12)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('入', x + s / 2, y + s / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#1e8449';
  ctx.font = '9px sans-serif';
  ctx.fillText(id, x + 1, y + s - 2);
}

function drawExit(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, id: string) {
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(10, s - 12)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('出', x + s / 2, y + s / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#92231a';
  ctx.font = '9px sans-serif';
  ctx.fillText(id, x + 1, y + s - 2);
}

function drawBoothFootprint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  id: string,
  selected: boolean,
) {
  ctx.fillStyle = '#2c5aa0';
  const r = 4;
  roundRect(ctx, x + 1, y + 1, s - 2, s - 2, r);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(9, s - 14)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const num = id.replace('booth-', '#');
  ctx.fillText(num, x + s / 2, y + s / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  if (selected) {
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 3;
    roundRect(ctx, x + 1, y + 1, s - 2, s - 2, r);
    ctx.stroke();
  }
}

function drawServiceCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  selected: boolean,
) {
  ctx.fillStyle = '#0e7c9b';
  ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.max(9, s - 14)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('S', x + s / 2, y + s / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  if (selected) {
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
  }
}

function drawQueueCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  index: number,
  selected: boolean,
) {
  ctx.fillStyle = '#7fb3d5';
  ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
  ctx.strokeStyle = '#3a6d8c';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 2]);
  ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
  ctx.setLineDash([]);
  ctx.fillStyle = '#1f2d3d';
  ctx.font = `${Math.max(8, s - 16)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`q${index}`, x + s / 2, y + s / 2);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
  if (selected) {
    ctx.strokeStyle = '#f1c40f';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawAgent(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  state: 'walking' | 'queued' | 'serving' | 'exiting',
  id: string,
) {
  const cx = x + s / 2;
  const cy = y + s / 2;
  const r = s / 3;
  ctx.globalAlpha = 0.75;

  switch (state) {
    case 'walking': {
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'queued': {
      ctx.fillStyle = '#2c5aa0';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      break;
    }
    case 'serving': {
      ctx.fillStyle = '#e67e22';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.lineTo(cx - r, cy + r);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'exiting': {
      ctx.fillStyle = '#8e44ad';
      ctx.beginPath();
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }

  ctx.globalAlpha = 1;
  ctx.fillStyle = '#1f2d3d';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const shortId = id.replace('agent-', '');
  ctx.fillText(shortId, cx, cy);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
