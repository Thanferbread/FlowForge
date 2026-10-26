/** 左侧工具栏 */
import type { Tool } from '../App';
import type { UiRunState, SimulationConfig } from '../simulation/types';

/** 仿真控件 props */
export interface SimControls {
  seed: number;
  H: number;
  demandCount: number;
  speed: 1 | 4 | 16;
  runState: UiRunState;
  hasEngine: boolean;
  parameterDraft?: Record<keyof SimulationConfig, string>;
  onParameterDraftChange?: (field: keyof SimulationConfig, value: string) => void;
  onParameterCommit?: (field: keyof SimulationConfig, value: string) => void;
  onSeedChange: (v: number) => void;
  onHChange: (v: number) => void;
  onDemandCountChange: (v: number) => void;
  onSpeedChange: (v: 1 | 4 | 16) => void;
  onRun: () => void;
  onPause: () => void;
  onStep: () => void;
  onCancel: () => void;
  onReset: () => void;
  onDownloadReport: () => void;
}

interface ToolbarProps {
  tool: Tool;
  onToolChange: (t: Tool) => void;
  onLoadExample: () => void;
  onNewScene: () => void;
  onValidate: () => void;
  onExport: () => void;
  onImport: () => void;
  canRunSimulation: boolean;
  simControls: SimControls;
  advancedControls?: {
    busy: boolean;
    hasResult: boolean;
    showHeatmap: boolean;
    onOptimize: () => void;
    onCompare: () => void;
    onCancel: () => void;
    onHeatmap: () => void;
    onDemo: () => void;
  };
}

const TOOLS: { id: Tool; label: string; icon: string; desc: string }[] = [
  { id: 'select', label: '选择', icon: '⬚', desc: '选择/移动展位' },
  { id: 'obstacle', label: '障碍', icon: '▣', desc: '绘制墙体障碍' },
  { id: 'erase', label: '擦除', icon: '✕', desc: '删除对象' },
  { id: 'entrance', label: '入口', icon: '↓', desc: '放置入口（边界）' },
  { id: 'exit', label: '出口', icon: '↑', desc: '放置出口（边界）' },
  { id: 'booth', label: '展位', icon: '◆', desc: '放置展位包' },
];

export function Toolbar({
  tool,
  onToolChange,
  onLoadExample,
  onNewScene,
  onValidate,
  onExport,
  onImport,
  canRunSimulation,
  simControls,
  advancedControls: ac,
}: ToolbarProps) {
  const sc = simControls;
  const canRun = canRunSimulation && (sc.runState === 'idle' || sc.runState === 'initialized' || sc.runState === 'paused');
  const canPause = sc.runState === 'running';
  const canStep = canRunSimulation && (sc.runState === 'idle' || sc.runState === 'initialized' || sc.runState === 'paused');
  const canCancel = sc.hasEngine && sc.runState !== 'complete' && sc.runState !== 'cancelled' && sc.runState !== 'failed' && sc.runState !== 'idle';
  const canReset = sc.hasEngine;
  const canDownload = sc.hasEngine;

  return (
    <aside className="toolbar">
      <h2>绘制工具</h2>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? 'active' : ''}`}
          onClick={() => onToolChange(t.id)}
          title={t.desc}
          aria-pressed={tool === t.id}
        >
          <span className="tool-icon">{t.icon}</span>
          <span>{t.label}</span>
        </button>
      ))}

      <h2>场景操作</h2>
      <button className="action-btn primary" onClick={onLoadExample}>
        载入招聘会示例
      </button>
      <button className="action-btn" onClick={onNewScene}>
        新建空白场景
      </button>
      <button className="action-btn" onClick={onValidate}>
        校验场景
      </button>

      <h2>导入 / 导出</h2>
      <button className="action-btn" onClick={onExport} disabled={!canRunSimulation}>
        导出 JSON
      </button>
      <button className="action-btn" onClick={onImport}>
        导入 JSON
      </button>
      {!canRunSimulation && (
        <div style={{ fontSize: 11, color: '#8a5a00', marginTop: 4 }}>
          场景未通过校验，导出已禁用
        </div>
      )}

      <h2>仿真参数</h2>
      <div className="sim-params">
        <div className="prop-row">
          <label>种子</label>
          <input
            type="number"
            min={0}
            max={4294967295}
            aria-label="seed"
            value={sc.parameterDraft?.seed ?? sc.seed}
            onChange={(e) => sc.onParameterDraftChange ? sc.onParameterDraftChange('seed', e.target.value) : sc.onSeedChange(Number(e.target.value))}
            onBlur={(e) => sc.onParameterCommit?.('seed', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { sc.onParameterCommit?.('seed', e.currentTarget.value); e.currentTarget.blur(); } }}
          />
        </div>
        <div className="prop-row">
          <label>时长 H</label>
          <input
            type="number"
            min={1}
            max={1800}
            aria-label="H"
            value={sc.parameterDraft?.H ?? sc.H}
            onChange={(e) => sc.onParameterDraftChange ? sc.onParameterDraftChange('H', e.target.value) : sc.onHChange(Number(e.target.value))}
            onBlur={(e) => sc.onParameterCommit?.('H', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { sc.onParameterCommit?.('H', e.currentTarget.value); e.currentTarget.blur(); } }}
          />
        </div>
        <div className="prop-row">
          <label>人数 N</label>
          <input
            type="number"
            min={0}
            max={500}
            aria-label="demandCount"
            value={sc.parameterDraft?.demandCount ?? sc.demandCount}
            onChange={(e) => sc.onParameterDraftChange ? sc.onParameterDraftChange('demandCount', e.target.value) : sc.onDemandCountChange(Number(e.target.value))}
            onBlur={(e) => sc.onParameterCommit?.('demandCount', e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { sc.onParameterCommit?.('demandCount', e.currentTarget.value); e.currentTarget.blur(); } }}
          />
        </div>
        <div className="prop-row">
          <label>速度</label>
          <select
            value={sc.speed}
            onChange={(e) => sc.onSpeedChange(Number(e.target.value) as 1 | 4 | 16)}
          >
            <option value={1}>1×</option>
            <option value={4}>4×</option>
            <option value={16}>16×</option>
          </select>
        </div>
      </div>

      <h2>运行控制</h2>
      <button className="action-btn primary" onClick={sc.onRun} disabled={!canRun}>
        运行仿真
      </button>
      <button className="action-btn" onClick={sc.onPause} disabled={!canPause}>
        暂停
      </button>
      <button className="action-btn" onClick={sc.onStep} disabled={!canStep}>
        单步
      </button>
      <button className="action-btn" onClick={sc.onCancel} disabled={!canCancel}>
        取消
      </button>
      <button className="action-btn" onClick={sc.onReset} disabled={!canReset}>
        重置
      </button>
      <button className="action-btn" onClick={sc.onDownloadReport} disabled={!canDownload}>
        下载报告
      </button>

      <h2>布局分析</h2>
      <button className="action-btn" disabled={!ac || ac.busy || !canRunSimulation} onClick={ac?.onOptimize}>
        布局优化
      </button>
      {ac?.busy && <button className="action-btn" onClick={ac.onCancel}>停止搜索</button>}
      <button className="action-btn" disabled={!ac?.hasResult} onClick={ac?.onCompare}>
        A/B 对比
      </button>
      <button className="action-btn" disabled={!ac} onClick={ac?.onHeatmap} aria-pressed={ac?.showHeatmap}>密度热力图</button>
      <button className="action-btn primary" disabled={!ac} onClick={ac?.onDemo}>一键演示</button>
    </aside>
  );
}

