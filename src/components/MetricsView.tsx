/** 仿真指标展示组件 */
import type { Metrics, UiRunState } from '../simulation/types';

interface MetricsViewProps {
  metrics: Metrics | null;
  runState: UiRunState;
}

function formatRate(value: number | null): string {
  if (value === null) return '—/无样本';
  return `${(value * 100).toFixed(1)}%`;
}

export function MetricsView({ metrics, runState }: MetricsViewProps) {
  if (runState === 'idle' || !metrics) {
    return (
      <div className="sim-placeholder">
        <strong>请先运行仿真。</strong>
        点击左侧「运行仿真」按钮开始。
      </div>
    );
  }

  const m = metrics;

  return (
    <div className="metrics-view">
      <div className="metrics-group">
        <h4>计数指标</h4>
        <div className="metric-row">
          <span className="metric-label">需求人数</span>
          <span className="metric-value">{m.demandCount}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">未到达</span>
          <span className="metric-value">{m.notYetArrived}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">已入场</span>
          <span className="metric-value">{m.admitted}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">待入场</span>
          <span className="metric-value">{m.pending}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">行走中</span>
          <span className="metric-value">{m.walking}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">排队中</span>
          <span className="metric-value">{m.queued}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">服务中</span>
          <span className="metric-value">{m.serving}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">离场中</span>
          <span className="metric-value">{m.exiting}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">已离场</span>
          <span className="metric-value">{m.exited}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">服务完成</span>
          <span className="metric-value">{m.serviceCompleted}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">未完成</span>
          <span className="metric-value">{m.incomplete}</span>
        </div>
      </div>

      <div className="metrics-group">
        <h4>比率指标</h4>
        <div className="metric-row">
          <span className="metric-label">服务完成率</span>
          <span className="metric-value">{formatRate(m.serviceCompletionRate)}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">系统完成率</span>
          <span className="metric-value">{formatRate(m.systemCompletionRate)}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">吞吐</span>
          <span className="metric-value">
            {m.throughput === null
              ? m.isCompleteRun
                ? '—/无样本'
                : '未完成运行'
              : `${m.throughput.toFixed(1)} 人/分钟`}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">等待均值</span>
          <span className="metric-value">
            {m.waitAverage === null
              ? '—/无样本'
              : `${m.waitAverage.toFixed(2)}s (n=${m.waitSampleCount})`}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">截尾平均耗时</span>
          <span className="metric-value">
            {m.truncatedAvgDuration === null
              ? m.isCompleteRun
                ? '—'
                : '未完成运行'
              : `${m.truncatedAvgDuration.toFixed(2)}s`}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">截尾人数</span>
          <span className="metric-value">
            {m.truncatedCount === null ? '—' : `${m.truncatedCount}`}
          </span>
        </div>
      </div>

      <div className="metrics-group">
        <h4>密度与拥堵</h4>
        <div className="metric-row">
          <span className="metric-label">可走面积</span>
          <span className="metric-value">{m.density.walkableArea} m²</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">采样次数</span>
          <span className="metric-value">{m.density.sampleCount}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">平均密度</span>
          <span className="metric-value">
            {m.density.meanDensity === null
              ? '—/无样本'
              : `${m.density.meanDensity.toFixed(4)} 人/m²`}
          </span>
        </div>
        <div className="metric-row">
          <span className="metric-label">拥堵暴露</span>
          <span className="metric-value">{m.congestionExposure} 人·秒</span>
        </div>
      </div>

      {!m.isCompleteRun && (
        <div style={{ fontSize: 11, color: '#8a5a00', marginTop: 4 }}>
          仿真未完成运行，部分指标为 null。
        </div>
      )}
    </div>
  );
}
