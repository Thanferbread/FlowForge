import type { Scene } from '../domain/types';
import type { EvaluationSummary, OptimizationResult } from '../optimization/types';

const rate = (v: number | null) => v === null ? '无样本' : `${(v * 100).toFixed(1)}%`;
const seconds = (v: number | null) => v === null ? '无样本' : `${v.toFixed(2)} s`;
const delta = (a: number | null, b: number | null, unit = '') => a === null || b === null ? '不适用' : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(2)}${unit}`;
function heatColor(density: number) {
  const w = Math.min(1, Math.max(0, density / .5));
  return `rgba(${Math.round(30 + 220 * w)},${Math.round(170 - 90 * w)},${Math.round(200 - 160 * w)},${.12 + .5 * w})`;
}

function Heatmap({ scene, summary, title }: { scene: Scene; summary: EvaluationSummary; title: string }) {
  const size = 16;
  return <figure className="comparison-map"><figcaption>{title}<span>seed {summary.seed} · H {summary.H} · N {summary.actualDemandCount}</span></figcaption>
    <svg viewBox={`0 0 ${scene.width * size} ${scene.height * size}`} role="img" aria-label={`${title}人员累计密度热力图`}>
      <rect width="100%" height="100%" fill="#f4f7f8" />
      {scene.obstacles.map((p) => <rect key={`o${p.x},${p.y}`} x={p.x * size} y={p.y * size} width={size} height={size} fill="#727d88" />)}
      {scene.booths.map((b) => <g key={b.id}><rect x={b.footprint.x * size} y={b.footprint.y * size} width={size} height={size} rx="2" fill="#224c7e" /><rect x={b.serviceCell.x * size + 2} y={b.serviceCell.y * size + 2} width={size - 4} height={size - 4} fill="#087f8c" /><text x={b.footprint.x * size + size / 2} y={b.footprint.y * size + size * .72} textAnchor="middle" fill="white" fontSize="9">{b.id.replace('booth-', '')}</text>{b.queueCells.map((p, i) => <rect key={i} x={p.x * size + 2} y={p.y * size + 2} width={size - 4} height={size - 4} fill="none" stroke="#5f8da2" />)}</g>)}
      {scene.entrances.map((e) => <circle key={e.id} cx={(e.pos.x + .5) * size} cy={(e.pos.y + .5) * size} r="6" fill="#259775" />)}
      {scene.exits.map((e) => <rect key={e.id} x={e.pos.x * size + 2} y={e.pos.y * size + 2} width="12" height="12" fill="#b65342" />)}
      {summary.heatmap.filter((cell) => cell.density !== null && cell.density > 0).map((cell) => <rect key={`${cell.pos.x},${cell.pos.y}`} x={cell.pos.x * size} y={cell.pos.y * size} width={size} height={size} fill={heatColor(cell.density ?? 0)} />)}
    </svg>
  </figure>;
}

export function AnalysisPanel({ result: r, onClose, onApply, onDownload }: {
  result: OptimizationResult; onClose: () => void; onApply: () => void; onDownload: () => void;
}) {
  const before = r.preview?.before;
  const isRejectedProposal = r.status !== 'accepted' && Boolean(r.preview?.proposed);
  const after = isRejectedProposal ? r.preview?.proposed : r.preview?.after;
  const comparisonScene = isRejectedProposal ? r.preview?.proposedScene ?? r.selectedScene : r.selectedScene;
  const previewSource = r.preview && r.trainingSeeds.includes(r.preview.seed) ? '该种子属于训练集，复用训练结果' : r.preview && r.holdoutSeeds.includes(r.preview.seed) ? '该种子属于留出集，复用留出结果' : '该种子仅作展示，未参与候选选择';
  const status = r.status === 'accepted' ? '找到通过留出验证的布局' : r.status === 'no-improvement' ? '本轮保留原布局' : r.status === 'cancelled' ? '搜索已停止' : '搜索未完成';
  return <div className="analysis-overlay" role="dialog" aria-modal="true" aria-labelledby="analysis-title">
    <section className="analysis-panel">
      <header className="analysis-heading"><div><span>FLOWFORGE / A/B 对比</span><h2 id="analysis-title">{status}</h2><p>训练种子 {r.trainingSeeds.join(' / ')}　留出种子 {r.holdoutSeeds.join(' / ')}</p></div><button onClick={onClose} aria-label="关闭对比">关闭</button></header>
      <div className="analysis-summary"><span>枚举 {r.budget.generated} 个方案</span><span>合法 {r.budget.legal} 个</span><span>已评估 {r.budget.evaluated} 个</span><span>实际运行 {r.budget.completedRuns} 次</span></div>
      {r.explanation.map((line, i) => <p className="analysis-explanation" key={i}>{line}</p>)}
      {before && after && <>
        <div className="comparison-maps"><Heatmap scene={r.originalScene} summary={before} title="原始布局" /><Heatmap scene={comparisonScene} summary={after} title={r.status === 'accepted' ? '推荐布局' : isRejectedProposal ? '训练最佳候选（未采用）' : '采用布局（保留原方案）'} /></div>
        <div className="heatmap-key"><i /> 低 <span /> 高　同一标尺：0–0.5 人/m²，超过上限按最高颜色显示</div>
        <p className="comparison-caption">seed {r.preview!.seed}：{previewSource}；两方案使用相同需求、人数和时长。{isRejectedProposal ? '候选未通过留出门槛，当前采用布局仍为原方案。' : ''}</p>
        <table className="comparison-table"><thead><tr><th>指标</th><th>原始布局</th><th>{isRejectedProposal ? '未采用候选' : '采用布局'}</th><th>变化</th></tr></thead><tbody>
          <tr><th>系统完成率</th><td>{rate(before.metrics.systemCompletionRate)}</td><td>{rate(after.metrics.systemCompletionRate)}</td><td>{delta(before.metrics.systemCompletionRate === null ? null : before.metrics.systemCompletionRate * 100, after.metrics.systemCompletionRate === null ? null : after.metrics.systemCompletionRate * 100, ' 个百分点')}</td></tr>
          <tr><th>服务完成数</th><td>{before.metrics.serviceCompleted}</td><td>{after.metrics.serviceCompleted}</td><td>{after.metrics.serviceCompleted - before.metrics.serviceCompleted}</td></tr>
          <tr><th>截尾平均耗时</th><td>{seconds(before.metrics.truncatedAvgDuration)}</td><td>{seconds(after.metrics.truncatedAvgDuration)}</td><td>{delta(before.metrics.truncatedAvgDuration, after.metrics.truncatedAvgDuration, ' s')}</td></tr>
          <tr><th>等待均值</th><td>{seconds(before.metrics.waitAverage)}</td><td>{seconds(after.metrics.waitAverage)}</td><td>{delta(before.metrics.waitAverage, after.metrics.waitAverage, ' s')}</td></tr>
          <tr><th>拥堵暴露</th><td>{before.metrics.congestionExposure} 人·秒</td><td>{after.metrics.congestionExposure} 人·秒</td><td>{after.metrics.congestionExposure - before.metrics.congestionExposure} 人·秒</td></tr>
        </tbody></table>
      </>}
      {r.comparison && <><h3>独立留出验证</h3><table className="comparison-table"><thead><tr><th>种子</th><th>离场人数变化</th><th>系统完成率变化</th><th>截尾耗时变化</th></tr></thead><tbody>{r.comparison.holdoutDifferences.map((d) => <tr key={d.seed}><td>{d.seed}</td><td>{d.exited >= 0 ? '+' : ''}{d.exited}</td><td>{d.systemCompletionRate === null ? '不适用' : `${(d.systemCompletionRate * 100).toFixed(2)} 个百分点`}</td><td>{d.truncatedAvgDuration === null ? '不适用' : `${d.truncatedAvgDuration.toFixed(2)} s`}</td></tr>)}</tbody></table></>}
      <details><summary>候选记录与拒绝原因</summary><table className="comparison-table"><thead><tr><th>方案</th><th>调整</th><th>状态</th><th>训练系统完成率</th><th>说明</th></tr></thead><tbody>{r.candidateRecords.map((c) => <tr key={c.id}><td>{c.id}</td><td>{c.move.boothId} ({c.move.dx}, {c.move.dy})</td><td>{{ invalid: '非法', 'budget-skipped': '预算跳过', pending: '未运行', evaluated: '已评估', failed: '失败' }[c.state]}</td><td>{c.score ? rate(c.score.systemCompletionRate) : '—'}</td><td>{c.rejectionReasons.join('；') || '—'}</td></tr>)}</tbody></table></details>
      <p className="model-limit">格点仿真与有限候选搜索，用于场地方案比较；未标定现实行为，不用于应急疏散或安全认证。</p>
      <footer className="analysis-actions"><button onClick={onDownload}>下载对比报告</button><button className="primary" onClick={onApply} disabled={r.status !== 'accepted'}>应用推荐布局</button><button onClick={onClose}>返回编辑器</button></footer>
    </section>
  </div>;
}
