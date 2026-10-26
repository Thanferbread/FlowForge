/**
 * FlowForge 主应用：场景编辑器
 *
 * 布局：顶部标题栏 + 左侧工具栏 + 中间画布 + 右侧属性/校验面板。
 * 状态管理使用 React useState；校验结果由 useMemo 派生。
 * 纯引擎输出发布为人员与指标；模型提交与调度代次隔离旧运行。
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { Scene, GridPos } from './domain/types';
import { createEmptyScene, orthoPath } from './domain/geometry';
import { validateScene } from './domain/validation';
import {
  addObstacle,
  addEntrance,
  addExit,
  addBooth,
  eraseAt,
  moveBooth,
  updateBoothService,
  updateBoothQueueLength,
  cellAt,
} from './domain/operations';
import { exportScene, importScene } from './domain/serialization';
import { createCampusFairScene } from './scenarios/campusFair';
import { downloadJson, readJsonFile } from './components/fileIo';
import { Header } from './components/Header';
import { AnniversaryArtwork } from './components/AnniversaryArtwork';
import { Toolbar } from './components/Toolbar';
import { SceneCanvas } from './components/SceneCanvas';
import { PropertyPanel } from './components/PropertyPanel';
import { ValidationPanel } from './components/ValidationPanel';
import { createEngine } from './simulation/engine';
import { canonicalSceneJson, stableStringify } from './simulation/hash';
import type { Engine, AgentView, Metrics, UiRunState, SimulationConfig } from './simulation/types';
import { DEFAULT_SEED, DEFAULT_H, DEFAULT_DEMAND_COUNT, MIN_H, MAX_H, MAX_DEMAND_COUNT, MAX_H_TIMES_DEMANDS } from './simulation/constants';
import { optimizeLayout } from './optimization';
import type { OptimizationResult, OptimizationProgress } from './optimization/types';
import { AnalysisPanel } from './components/AnalysisPanel';

/** 编辑工具 */
export type Tool = 'select' | 'obstacle' | 'erase' | 'entrance' | 'exit' | 'booth';

/** Toast 提示 */
interface Toast {
  message: string;
  type: 'info' | 'error' | 'success';
}

/** 确认对话框 */
interface ConfirmDialog {
  message: string;
  onConfirm: () => void;
}

/** JSON 模态框 */
interface JsonModal {
  mode: 'export' | 'import';
  text: string;
}

const DEFAULT_WIDTH = 32;
const DEFAULT_HEIGHT = 22;

export function App() {
  const [scene, setScene] = useState<Scene>(() => createCampusFairScene());
  const [tool, setTool] = useState<Tool>('select');
  const [selectedBoothId, setSelectedBoothId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null);
  const [jsonModal, setJsonModal] = useState<JsonModal | null>(null);

  // 仿真状态
  const engineRef = useRef<Engine | null>(null);
  const simTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const workCtxRef = useRef(0);
  const scheduleGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const importRequestRef = useRef(0);
  const sceneRef = useRef(scene);
  const sceneJsonRef = useRef(canonicalSceneJson(scene));
  const [simSnapshot, setSimSnapshot] = useState<ReturnType<Engine['getSnapshot']> | null>(null);
  const [simMetrics, setSimMetrics] = useState<Metrics | null>(null);
  const [simConfig, setSimConfig] = useState<SimulationConfig>({
    seed: DEFAULT_SEED,
    H: DEFAULT_H,
    demandCount: DEFAULT_DEMAND_COUNT,
  });
  const [simSpeed, setSimSpeed] = useState<1 | 4 | 16>(1);
  const [simRunState, setSimRunState] = useState<UiRunState>('idle');
  const simConfigRef = useRef(simConfig);
  const [simDraft, setSimDraft] = useState(() => ({ seed: String(DEFAULT_SEED), H: String(DEFAULT_H), demandCount: String(DEFAULT_DEMAND_COUNT) }));
  const prevAgentsRef = useRef<AgentView[]>([]);
  const [prevSimAgents, setPrevSimAgents] = useState<AgentView[]>([]);
  const wasRunningBeforeHiddenRef = useRef(false);
  const optimizationController = useRef<AbortController | null>(null);
  const optimizationGeneration = useRef(0);
  const [optimizationResult, setOptimizationResult] = useState<OptimizationResult | null>(null);
  const [optimizationProgress, setOptimizationProgress] = useState<OptimizationProgress | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const lastPublishedTick = useRef(-1);

  // 校验结果派生
  const validation = useMemo(() => validateScene(scene), [scene]);

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    setToast({ message, type });
  }, []);

  /** 每次失效都换代次，已排队的旧回调也不能推进。 */
  const clearSimTimer = useCallback(() => {
    scheduleGenerationRef.current++;
    if (simTimerRef.current !== null) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
  }, []);

  const clearSimulation = useCallback(() => {
    optimizationController.current?.abort();
    optimizationController.current = null;
    optimizationGeneration.current++;
    setOptimizing(false);
    setOptimizationProgress(null);
    setOptimizationResult(null);
    setShowComparison(false);
    clearSimTimer();
    workCtxRef.current++;
    engineRef.current?.cancel();
    engineRef.current = null;
    setSimSnapshot(null);
    setSimMetrics(null);
    setSimRunState('idle');
    prevAgentsRef.current = [];
    setPrevSimAgents([]);
    lastPublishedTick.current = -1;
  }, [clearSimTimer]);

  /** 所有场景写入都经完整规范内容比较；有效 no-op 保留仿真。 */
  const commitScene = useCallback((next: Scene, modified = true) => {
    if (!validateScene(next).ok) {
      showToast('场景存在结构错误，已保留当前工作', 'error');
      return false;
    }
    const canonical = canonicalSceneJson(next);
    if (canonical !== sceneJsonRef.current) {
      clearSimulation();
      importRequestRef.current++;
      sceneRef.current = next;
      sceneJsonRef.current = canonical;
      setScene(next);
      setDirty(modified);
      return true;
    }
    if (!modified) setDirty(false);
    return false;
  }, [clearSimulation, showToast]);

  const applyScene = useCallback((next: Scene | null, errorMsg?: string) => {
    if (next === null) {
      showToast(errorMsg ?? '操作无效：越界或重叠', 'error');
      return false;
    }
    commitScene(next);
    return true;
  }, [commitScene, showToast]);
  /** 画布点击处理 */
  const handleCellClick = useCallback(
    (pos: GridPos) => {
      switch (tool) {
        case 'obstacle':
          applyScene(addObstacle(scene, pos), '该格已被占用，无法放置障碍');
          break;
        case 'entrance':
          applyScene(addEntrance(scene, pos), '入口必须放在边界空格上');
          break;
        case 'exit':
          applyScene(addExit(scene, pos), '出口必须放在边界空格上');
          break;
        case 'booth':
          applyScene(addBooth(scene, pos), '该位置无法放置展位（空间不足或被占用）');
          break;
        case 'erase': {
          const result = eraseAt(scene, pos);
          if (result) {
            commitScene(result);
            // 如果删除的是选中展位，取消选中
            const info = cellAt(scene, pos);
            if (info.boothId === selectedBoothId) setSelectedBoothId(null);
          }
          break;
        }
        case 'select': {
          const info = cellAt(scene, pos);
          if (info.kind === 'booth-footprint' || info.kind === 'booth-service' || info.kind === 'booth-queue') {
            setSelectedBoothId(info.boothId ?? null);
          } else {
            setSelectedBoothId(null);
          }
          break;
        }
      }
    },
    [tool, scene, selectedBoothId, applyScene, commitScene],
  );

  /** 画布拖拽处理：obstacle 涂抹（orthoPath 逐格放置）/ select 移动展位 */
  const handleCellDrag = useCallback(
    (from: GridPos, to: GridPos) => {
      if (tool === 'obstacle') {
        // 拖拽涂抹障碍：用 orthoPath 计算从上一格到当前格的正交路径，逐格放置
        const path = orthoPath(from, to);
        let cur = scene;
        let changed = false;
        for (const p of path) {
          const next = addObstacle(cur, p);
          if (next) {
            cur = next;
            changed = true;
          }
        }
        if (changed) {
          commitScene(cur);
        }
      } else if (tool === 'select') {
        // 移动展位
        const info = cellAt(scene, from);
        if (info.boothId && (info.kind === 'booth-footprint')) {
          const result = moveBooth(scene, info.boothId, to);
          if (result) {
            commitScene(result);
          } else {
            showToast('展位无法移动到该位置（越界或重叠）', 'error');
          }
        }
      }
    },
    [tool, scene, showToast, commitScene],
  );

  /** 要求确认（如果有未保存修改） */
  const requireConfirm = useCallback(
    (action: () => void, msg: string) => {
      if (dirty) {
        const context = workCtxRef.current;
        setConfirmDialog({ message: msg, onConfirm: () => {
          if (!mountedRef.current || context !== workCtxRef.current) {
            showToast('工作内容已变化，请重新执行操作', 'info');
            return;
          }
          action();
        } });
      } else {
        action();
      }
    },
    [dirty, showToast],
  );

  /** 载入招聘会示例 */
  const handleLoadExample = useCallback(() => {
    requireConfirm(() => {
      commitScene(createCampusFairScene(), false);
      setSelectedBoothId(null);
      setDirty(false);
      showToast('已载入校园招聘会示例', 'success');
    }, '当前场景有未保存修改，确定要载入示例并覆盖吗？');
  }, [requireConfirm, commitScene, showToast]);

  /** 新建空白场景 */
  const handleNewScene = useCallback(() => {
    requireConfirm(() => {
      commitScene(createEmptyScene(DEFAULT_WIDTH, DEFAULT_HEIGHT), false);
      setSelectedBoothId(null);
      setDirty(false);
      showToast('已新建空白场景', 'success');
    }, '当前场景有未保存修改，确定要新建空白场景并覆盖吗？');
  }, [requireConfirm, commitScene, showToast]);

  /** 校验场景（校验结果已在面板实时显示，此处仅给提示） */
  const handleValidate = useCallback(() => {
    if (validation.readyForSimulation) {
      showToast('场景校验通过，可用于仿真', 'success');
    } else {
      const errs = validation.issues.length;
      showToast(`场景有 ${errs} 项问题待解决`, 'error');
    }
  }, [validation, showToast]);

  /** 导出 JSON */
  const handleExport = useCallback(() => {
    const result = exportScene(scene);
    if (!result.ok) {
      showToast(result.error, 'error');
      return;
    }
    importRequestRef.current++;
    setJsonModal({ mode: 'export', text: result.json });
  }, [scene, showToast]);

  /** 打开导入框 */
  const handleOpenImport = useCallback(() => {
    importRequestRef.current++;
    setJsonModal({ mode: 'import', text: '' });
  }, []);

  /** 执行导入 */
  const handleDoImport = useCallback(
    (text: string) => {
      const request = ++importRequestRef.current;
      const result = importScene(text);
      if (!result.ok || !result.scene) {
        showToast(result.error ?? '导入失败', 'error');
        return;
      }
      requireConfirm(() => {
        if (request !== importRequestRef.current) {
          showToast('导入上下文已变化，请重新导入', 'info');
          return;
        }
        commitScene(result.scene!);
        setSelectedBoothId(null);
        setDirty(true);
        setJsonModal(null);
        showToast('场景导入成功', 'success');
      }, '当前场景有未保存修改，确定要导入并覆盖吗？');
    },
    [requireConfirm, commitScene, showToast],
  );

  /** 更新展位服务时长 */
  const handleUpdateService = useCallback(
    (id: string, min: number, max: number) => {
      applyScene(updateBoothService(scene, id, min, max), '服务时长参数无效');
    },
    [scene, applyScene],
  );

  /** 更新展位队列长度 */
  const handleUpdateQueueLength = useCallback(
    (id: string, k: number) => {
      applyScene(updateBoothQueueLength(scene, id, k), '队列长度无效或空间不足');
    },
    [scene, applyScene],
  );

  /** 重置视图 */
  const handleResetView = useCallback(() => {
    setZoom(1);
  }, []);

  /** 复制 JSON 到剪贴板 */
  const handleCopyJson = useCallback(async () => {
    if (!jsonModal) return;
    try {
      await navigator.clipboard.writeText(jsonModal.text);
      showToast('已复制到剪贴板', 'success');
    } catch {
      showToast('复制失败，请手动选择文本复制', 'error');
    }
  }, [jsonModal, showToast]);

  /** 下载失败只反馈并保留当前工作，供用户重试。 */
  const handleDownloadJson = useCallback(() => {
    if (!jsonModal || jsonModal.mode !== 'export') return;
    try {
      const filename = `flowforge-scene-${Date.now()}.json`;
      downloadJson(jsonModal.text, filename);
      showToast(`已下载 ${filename}`, 'success');
    } catch (error) {
      showToast(`场景下载失败：${error instanceof Error ? error.message : String(error)}，可重试`, 'error');
    }
  }, [jsonModal, showToast]);

  const closeJsonModal = useCallback(() => {
    importRequestRef.current++;
    setJsonModal(null);
  }, []);

  /** 文件读取与确认可能晚到，禁止旧结果覆盖后续工作。 */
  const handleFileImport = useCallback(async (file: File) => {
    const request = ++importRequestRef.current;
    const context = workCtxRef.current;
    try {
      const text = await readJsonFile(file);
      if (!mountedRef.current || request !== importRequestRef.current || context !== workCtxRef.current) return;
      handleDoImport(text);
    } catch {
      if (mountedRef.current && request === importRequestRef.current && context === workCtxRef.current) showToast('文件读取失败', 'error');
    }
  }, [handleDoImport, showToast]);
  const publishSimState = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) {
      setSimSnapshot(null);
      setSimMetrics(null);
      setSimRunState('idle');
      prevAgentsRef.current = [];
      setPrevSimAgents([]);
      return;
    }
    const snapshot = engine.getSnapshot();
    if (snapshot.tick !== lastPublishedTick.current) {
      setPrevSimAgents(prevAgentsRef.current);
      prevAgentsRef.current = snapshot.agents
        .filter((a) => a.pos !== null && a.state !== 'pending' && a.state !== 'exited')
        .map((a) => ({ id: a.id, pos: a.pos!, state: a.state as AgentView['state'], remainingService: a.remainingService }));
      lastPublishedTick.current = snapshot.tick;
      setSimSnapshot(snapshot);
    }
    setSimMetrics(engine.getMetrics());
    setSimRunState(engine.runState);
  }, []);

  const scheduleEngine = useCallback((engine: Engine, speed: 1 | 4 | 16) => {
    clearSimTimer();
    const generation = scheduleGenerationRef.current;
    const interval = speed === 1 ? 1000 : speed === 4 ? 250 : 62.5;
    simTimerRef.current = setInterval(() => {
      if (!mountedRef.current || generation !== scheduleGenerationRef.current || engine !== engineRef.current || engine.runState !== 'running') return;
      const result = engine.step();
      publishSimState();
      if (!result.ok || engine.isTerminal) {
        clearSimTimer();
        if (!result.ok) showToast(result.error, 'error');
      }
    }, interval);
  }, [clearSimTimer, publishSimState, showToast]);

  const ensureEngine = useCallback(() => {
    if (engineRef.current) return engineRef.current;
    const result = createEngine(sceneRef.current, simConfigRef.current);
    if (!result.ok) {
      showToast(result.error, 'error');
      return null;
    }
    engineRef.current = result.engine;
    return result.engine;
  }, [showToast]);

  const handleSimRun = useCallback(() => {
    if (optimizationController.current) { showToast('请先停止布局搜索再运行仿真'); return; }
    const engine = ensureEngine();
    if (!engine) return;
    const result = engine.start();
    publishSimState();
    if (!result.ok) { showToast(result.error, 'error'); return; }
    workCtxRef.current++;
    scheduleEngine(engine, simSpeed);
  }, [ensureEngine, publishSimState, scheduleEngine, simSpeed, showToast]);

  const handleSimPause = useCallback(() => {
    clearSimTimer();
    const engine = engineRef.current;
    if (!engine) return;
    const result = engine.pause();
    publishSimState();
    if (!result.ok) showToast(result.error, 'error');
  }, [clearSimTimer, publishSimState, showToast]);

  const handleSimStep = useCallback(() => {
    if (optimizationController.current) { showToast('请先停止布局搜索再单步'); return; }
    const engine = ensureEngine();
    if (!engine) return;
    if (engine.isTerminal || engine.runState === 'running') { publishSimState(); return; }
    clearSimTimer();
    workCtxRef.current++;
    const result = engine.step();
    publishSimState();
    if (!result.ok) showToast(result.error, 'error');
  }, [ensureEngine, clearSimTimer, publishSimState, showToast]);

  const handleSimCancel = useCallback(() => {
    clearSimTimer();
    workCtxRef.current++;
    engineRef.current?.cancel();
    publishSimState();
  }, [clearSimTimer, publishSimState]);

  const handleSimReset = clearSimulation;

  const handleSimSpeedChange = useCallback((speed: 1 | 4 | 16) => {
    setSimSpeed(speed);
    const engine = engineRef.current;
    clearSimTimer();
    if (engine?.runState === 'running') scheduleEngine(engine, speed);
  }, [clearSimTimer, scheduleEngine]);

  const commitSimParameter = useCallback((field: keyof SimulationConfig, raw: string) => {
    const value = raw.trim() === '' ? NaN : Number(raw);
    const next = { ...simConfigRef.current, [field]: value };
    const valid = Number.isInteger(next.seed) && next.seed >= 0 && next.seed <= 4294967295
      && Number.isInteger(next.H) && next.H >= MIN_H && next.H <= MAX_H
      && Number.isInteger(next.demandCount) && next.demandCount >= 0 && next.demandCount <= MAX_DEMAND_COUNT
      && next.H * next.demandCount <= MAX_H_TIMES_DEMANDS;
    if (!valid) {
      setSimDraft((draft) => ({ ...draft, [field]: String(simConfigRef.current[field]) }));
      showToast('参数须为范围内整数，且 H × N 不超过 300000；已保留原值', 'error');
      return;
    }
    setSimDraft((draft) => ({ ...draft, [field]: String(value) }));
    if (value === simConfigRef.current[field]) return;
    clearSimulation();
    simConfigRef.current = next;
    setSimConfig(next);
  }, [clearSimulation, showToast]);
  /** 导出边界异常不能改变模型状态或删除可重试的报告。 */
  const handleDownloadReport = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const report = engine.getReport({ speed: simSpeed, exportTimestamp: new Date().toISOString() });
      const json = stableStringify(report);
      const filename = `flowforge-report-${Date.now()}.json`;
      downloadJson(json, filename);
      showToast(`已下载 ${filename}`, 'success');
    } catch (error) {
      showToast(`报告下载失败：${error instanceof Error ? error.message : String(error)}，可重试`, 'error');
    }
  }, [simSpeed, showToast]);

  /** StrictMode 的 setup/cleanup 同样作废旧回调与异步工作。 */
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workCtxRef.current++;
      importRequestRef.current++;
      clearSimTimer();
      optimizationGeneration.current++;
      optimizationController.current?.abort();
      optimizationController.current = null;
    };
  }, [clearSimTimer]);

  /** 后台标签页自动暂停模型和动画；返回后保持暂停并提示。 */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const engine = engineRef.current;
        if (engine && engine.runState === 'running') {
          wasRunningBeforeHiddenRef.current = true;
          clearSimTimer();
          engine.pause();
          publishSimState();
        } else {
          wasRunningBeforeHiddenRef.current = false;
        }
      } else if (wasRunningBeforeHiddenRef.current) {
        wasRunningBeforeHiddenRef.current = false;
        if (mountedRef.current) showToast('已从后台恢复，请点击运行继续', 'info');
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [clearSimTimer, publishSimState, showToast]);

  const selectedBooth = useMemo(
    () => (selectedBoothId ? scene.booths.find((b) => b.id === selectedBoothId) ?? null : null),
    [selectedBoothId, scene.booths],
  );

  const simAgents: AgentView[] = useMemo(() => {
    if (!simSnapshot) return [];
    return simSnapshot.agents
      .filter((a) => a.pos !== null && (a.state === 'walking' || a.state === 'queued' || a.state === 'serving' || a.state === 'exiting'))
      .map((a) => ({
        id: a.id,
        pos: a.pos!,
        state: a.state as 'walking' | 'queued' | 'serving' | 'exiting',
        remainingService: a.remainingService,
      }));
  }, [simSnapshot]);

  const tickIntervalMs = simSpeed === 1 ? 1000 : simSpeed === 4 ? 250 : 62.5;
  const animationActive = simRunState === 'running';
  const heatmap = useMemo(() => {
    const values = Array.from({ length: scene.height }, () => Array<number>(scene.width).fill(0));
    for (const cell of simMetrics?.density.cells ?? []) {
      if (cell.applicable && cell.density !== null && values[cell.pos.y]) values[cell.pos.y][cell.pos.x] = cell.density;
    }
    return values;
  }, [scene.width, scene.height, simMetrics]);

  const handleOptimize = useCallback(async () => {
    if (!validateScene(sceneRef.current).readyForSimulation || optimizationController.current) return;
    clearSimTimer();
    if (engineRef.current?.runState === 'running') { engineRef.current.pause(); publishSimState(); }
    const controller = new AbortController();
    optimizationController.current = controller;
    const generation = ++optimizationGeneration.current;
    const original = sceneJsonRef.current;
    setOptimizing(true); setOptimizationResult(null); setOptimizationProgress(null);
    try {
      const result = await optimizeLayout(sceneRef.current, simConfigRef.current, {
        signal: controller.signal, maxCandidates: 8,
        onProgress: (progress) => {
          if (mountedRef.current && !controller.signal.aborted && generation === optimizationGeneration.current) setOptimizationProgress(progress);
        },
      });
      if (!mountedRef.current || generation !== optimizationGeneration.current || original !== sceneJsonRef.current) return;
      if (controller.signal.aborted && result.status !== 'cancelled') return;
      setOptimizationResult(result);
      if (result.status === 'accepted' || result.status === 'no-improvement') setShowComparison(true);
      else showToast(result.error ?? (result.status === 'cancelled' ? '搜索已停止，原布局保留' : '本轮搜索未完成'), result.status === 'failed' ? 'error' : 'info');
    } catch (error) {
      if (mountedRef.current && generation === optimizationGeneration.current) showToast(`搜索失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      if (mountedRef.current && generation === optimizationGeneration.current) {
        optimizationController.current = null; setOptimizing(false); setOptimizationProgress(null);
      }
    }
  }, [clearSimTimer, publishSimState, showToast]);

  const handleDemo = useCallback(() => {
    requireConfirm(() => {
      clearSimulation();
      const demoScene = createCampusFairScene();
      commitScene(demoScene, false);
      const config = { seed: DEFAULT_SEED, H: DEFAULT_H, demandCount: DEFAULT_DEMAND_COUNT };
      simConfigRef.current = config; setSimConfig(config);
      setSimDraft({ seed: String(config.seed), H: String(config.H), demandCount: String(config.demandCount) });
      setSimSpeed(16); setZoom(1); setSelectedBoothId(null); setShowHeatmap(false);
      const result = createEngine(demoScene, config);
      if (!result.ok) { showToast(result.error, 'error'); return; }
      engineRef.current = result.engine;
      result.engine.start(); publishSimState(); scheduleEngine(result.engine, 16);
      showToast('已载入招聘会示例，以16×运行；结束后可搜索布局并查看A/B对比');
    }, '演示将载入默认场景，覆盖未保存的编辑，是否继续？');
  }, [requireConfirm, clearSimulation, commitScene, publishSimState, scheduleEngine, showToast]);

  const handleApplyLayout = useCallback(() => {
    if (!optimizationResult || optimizationResult.status !== 'accepted') return;
    const result = optimizationResult;
    commitScene(result.selectedScene);
    setOptimizationResult(result); setShowComparison(false);
    showToast('已应用通过留出验证的布局，可重新运行或导出场景', 'success');
  }, [optimizationResult, commitScene, showToast]);

  return (
    <div className="app">
      <Header stage="活动空间规划" ready={validation.readyForSimulation} />
      <section className="workspace-overview" aria-label="运行概览">
        <AnniversaryArtwork />
        <div className="workspace-title">
          <span className="workspace-eyebrow">上理生日派队 <i /> 上理建校120周年 · 学生作品</span>
          <h2>校园活动空间规划</h2>
          <p>为校庆集市、校园展览与招聘会，提前看见人流。</p>
          <div className="overview-actions">
            <button onClick={handleDemo}><span>一键运行示例</span> <span className="overview-start-icon" aria-hidden="true">↗</span></button>
            <button onClick={handleOptimize} disabled={optimizing || !validation.readyForSimulation}>搜索更好布局</button>
            <button onClick={() => setShowComparison(true)} disabled={!optimizationResult?.preview}>查看方案对比</button>
          </div>
        </div>
        <div className="overview-metrics">
          <p className="overview-caption">运行观测 <span>LIVE OBSERVATION</span></p>
          <div><span>服务完成</span><strong>{simMetrics ? <>{simMetrics.serviceCompleted}<small> / {simMetrics.demandCount}</small></> : '—'}</strong></div>
          <div><span>系统完成率</span><strong>{simMetrics?.systemCompletionRate === null || !simMetrics ? '—' : `${(simMetrics.systemCompletionRate * 100).toFixed(1)}%`}</strong></div>
          <div><span>等待均值</span><strong>{simMetrics?.waitAverage == null ? '—' : `${simMetrics.waitAverage.toFixed(1)} s`}</strong></div>
          <div><span>仿真进度</span><strong>{simSnapshot?.tick ?? 0}<small> / {simConfig.H}</small></strong></div>
        </div>
      </section>
      {optimizing && <div className="search-progress" role="status"><span>正在进行配对布局搜索{optimizationProgress ? ` · ${optimizationProgress.completedRuns}/${optimizationProgress.maxRuns} 次运行 · seed ${optimizationProgress.seed} · T${optimizationProgress.currentTick}` : ''}</span><button onClick={() => optimizationController.current?.abort()}>停止搜索</button></div>}
      <div className="workspace-note"><span><b>场地实验</b>{showHeatmap ? '热力图：累计占用频次 / 采样次数 / 格面积；各图使用一致标尺' : '动画为显示插值，指标按已提交的离散时间步统计'}</span><button onClick={() => setShowHeatmap((value) => !value)} aria-pressed={showHeatmap}>{showHeatmap ? '隐藏热图' : '显示热图'}</button></div>
      <div className="app-body">
        <Toolbar
          tool={tool}
          onToolChange={setTool}
          onLoadExample={handleLoadExample}
          onNewScene={handleNewScene}
          onValidate={handleValidate}
          onExport={handleExport}
          onImport={handleOpenImport}
          canRunSimulation={validation.readyForSimulation}
          simControls={{
            seed: simConfig.seed,
            H: simConfig.H,
            demandCount: simConfig.demandCount,
            speed: simSpeed,
            runState: simRunState,
            hasEngine: engineRef.current !== null,
            parameterDraft: simDraft,
            onParameterDraftChange: (field, value) => setSimDraft((draft) => ({ ...draft, [field]: value })),
            onParameterCommit: commitSimParameter,
            onSeedChange: (value) => commitSimParameter('seed', String(value)),
            onHChange: (value) => commitSimParameter('H', String(value)),
            onDemandCountChange: (value) => commitSimParameter('demandCount', String(value)),
            onSpeedChange: handleSimSpeedChange,
            onRun: handleSimRun,
            onPause: handleSimPause,
            onStep: handleSimStep,
            onCancel: handleSimCancel,
            onReset: handleSimReset,
            onDownloadReport: handleDownloadReport,
          }}
          advancedControls={{ busy: optimizing, hasResult: Boolean(optimizationResult?.preview), showHeatmap,
            onOptimize: handleOptimize, onCompare: () => setShowComparison(true), onCancel: () => optimizationController.current?.abort(),
            onHeatmap: () => setShowHeatmap((value) => !value), onDemo: handleDemo }}
        />
        <SceneCanvas
          scene={scene}
          tool={tool}
          selectedBoothId={selectedBoothId}
          zoom={zoom}
          onZoomChange={setZoom}
          onCellClick={handleCellClick}
          onCellDrag={handleCellDrag}
          onResetView={handleResetView}
          agents={simAgents}
          prevAgents={prevSimAgents}
          tickIntervalMs={tickIntervalMs}
          animationActive={animationActive}
          animationRunState={simRunState}
          animationTick={simSnapshot?.tick ?? 0}
          animationContext={engineRef.current}
          heatmap={heatmap}
          showHeatmap={showHeatmap}
        />
        <PropertyPanel
          scene={scene}
          selectedBooth={selectedBooth}
          validation={validation}
          onUpdateService={handleUpdateService}
          onUpdateQueueLength={handleUpdateQueueLength}
          onSelectBooth={setSelectedBoothId}
          metrics={simMetrics}
          runState={simRunState}
        />
      </div>
      <ValidationPanel issues={validation.issues} ready={validation.readyForSimulation} />
      {showComparison && optimizationResult && <AnalysisPanel result={optimizationResult} onClose={() => setShowComparison(false)} onApply={handleApplyLayout} onDownload={() => {
        try { downloadJson(stableStringify(optimizationResult), `flowforge-comparison-${Date.now()}.json`); }
        catch (error) { showToast(`对比报告下载失败：${error instanceof Error ? error.message : String(error)}`, 'error'); }
      }} />}

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      {confirmDialog && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-dialog">
            <p>{confirmDialog.message}</p>
            <div className="actions">
              <button className="action-btn" onClick={() => setConfirmDialog(null)}>
                取消
              </button>
              <button
                className="action-btn primary"
                onClick={() => {
                  confirmDialog.onConfirm();
                  setConfirmDialog(null);
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {jsonModal && (
        <div className="confirm-overlay" role="dialog" aria-modal="true">
          <div className="confirm-dialog" style={{ minWidth: 520, maxWidth: 700 }}>
            <p>
              {jsonModal.mode === 'export'
                ? '场景 JSON（可复制或下载保存）：'
                : '粘贴场景 JSON、或选择文件导入：'}
            </p>
            <textarea
              className="json-textarea"
              value={jsonModal.text}
              readOnly={jsonModal.mode === 'export'}
              onChange={(e) => { importRequestRef.current++; setJsonModal({ ...jsonModal, text: e.target.value }); }}
            />
            {jsonModal.mode === 'import' && (
              <div style={{ marginTop: 8 }}>
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileImport(f);
                    e.target.value = '';
                  }}
                  style={{ fontSize: 13 }}
                />
              </div>
            )}
            <div className="actions">
              <button className="action-btn" onClick={closeJsonModal}>
                关闭
              </button>
              {jsonModal.mode === 'export' ? (
                <>
                  <button className="action-btn" onClick={handleCopyJson}>
                    复制
                  </button>
                  <button className="action-btn primary" onClick={handleDownloadJson}>
                    下载文件
                  </button>
                </>
              ) : (
                <button
                  className="action-btn primary"
                  onClick={() => handleDoImport(jsonModal.text)}
                  disabled={!jsonModal.text.trim()}
                >
                  导入文本
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}





