/** 仿真指标展示组件 */
import type { Metrics, UiRunState } from '../simulation/types';
import { MetricHelp } from './MetricHelp';

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
      <p className="metric-help-caption">点按或悬停指标，查看说明。</p>
      <div className="metrics-group">
        <h4>计数指标</h4>
        <MetricHelp metric="demandCount">
          <span className="metric-value">{m.demandCount}</span>
        </MetricHelp>
        <MetricHelp metric="notYetArrived">
          <span className="metric-value">{m.notYetArrived}</span>
        </MetricHelp>
        <MetricHelp metric="admitted">
          <span className="metric-value">{m.admitted}</span>
        </MetricHelp>
        <MetricHelp metric="pending">
          <span className="metric-value">{m.pending}</span>
        </MetricHelp>
        <MetricHelp metric="walking">
          <span className="metric-value">{m.walking}</span>
        </MetricHelp>
        <MetricHelp metric="queued">
          <span className="metric-value">{m.queued}</span>
        </MetricHelp>
        <MetricHelp metric="serving">
          <span className="metric-value">{m.serving}</span>
        </MetricHelp>
        <MetricHelp metric="exiting">
          <span className="metric-value">{m.exiting}</span>
        </MetricHelp>
        <MetricHelp metric="exited">
          <span className="metric-value">{m.exited}</span>
        </MetricHelp>
        <MetricHelp metric="serviceCompleted">
          <span className="metric-value">{m.serviceCompleted}</span>
        </MetricHelp>
        <MetricHelp metric="incomplete">
          <span className="metric-value">{m.incomplete}</span>
        </MetricHelp>
      </div>

      <div className="metrics-group">
        <h4>比率指标</h4>
        <MetricHelp metric="serviceCompletionRate">
          <span className="metric-value">{formatRate(m.serviceCompletionRate)}</span>
        </MetricHelp>
        <MetricHelp metric="systemCompletionRate">
          <span className="metric-value">{formatRate(m.systemCompletionRate)}</span>
        </MetricHelp>
        <MetricHelp metric="throughput">
          <span className="metric-value">
            {m.throughput === null
              ? m.isCompleteRun
                ? '—/无样本'
                : '未完成运行'
              : `${m.throughput.toFixed(1)} 人/分钟`}
          </span>
        </MetricHelp>
        <MetricHelp metric="waitAverage">
          <span className="metric-value">
            {m.waitAverage === null
              ? '—/无样本'
              : `${m.waitAverage.toFixed(2)}s (n=${m.waitSampleCount})`}
          </span>
        </MetricHelp>
        <MetricHelp metric="truncatedAvgDuration">
          <span className="metric-value">
            {m.truncatedAvgDuration === null
              ? m.isCompleteRun
                ? '—'
                : '未完成运行'
              : `${m.truncatedAvgDuration.toFixed(2)}s`}
          </span>
        </MetricHelp>
        <MetricHelp metric="truncatedCount">
          <span className="metric-value">
            {m.truncatedCount === null ? '—' : `${m.truncatedCount}`}
          </span>
        </MetricHelp>
      </div>

      <div className="metrics-group">
        <h4>密度与拥堵</h4>
        <MetricHelp metric="walkableArea">
          <span className="metric-value">{m.density.walkableArea} m²</span>
        </MetricHelp>
        <MetricHelp metric="sampleCount">
          <span className="metric-value">{m.density.sampleCount}</span>
        </MetricHelp>
        <MetricHelp metric="meanDensity">
          <span className="metric-value">
            {m.density.meanDensity === null
              ? '—/无样本'
              : `${m.density.meanDensity.toFixed(4)} 人/m²`}
          </span>
        </MetricHelp>
        <MetricHelp metric="congestionExposure">
          <span className="metric-value">{m.congestionExposure} 人·秒</span>
        </MetricHelp>
      </div>

      {!m.isCompleteRun && (
        <div style={{ fontSize: 11, color: '#8a5a00', marginTop: 4 }}>
          仿真尚未运行到设定终点，吞吐和截尾耗时将在完整运行后显示。
        </div>
      )}
    </div>
  );
}
