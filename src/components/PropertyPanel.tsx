/** 右侧属性面板：对象属性、地图统计、校验结果、仿真指标 */
import { useState } from 'react';
import type { Scene, Booth, ValidationResult } from '../domain/types';
import type { Metrics, UiRunState } from '../simulation/types';
import { MetricsView } from './MetricsView';

interface PropertyPanelProps {
  scene: Scene;
  selectedBooth: Booth | null;
  validation: ValidationResult;
  onUpdateService: (id: string, min: number, max: number) => void;
  onUpdateQueueLength: (id: string, k: number) => void;
  onSelectBooth: (id: string | null) => void;
  metrics?: Metrics | null;
  runState: UiRunState;
}

export function PropertyPanel({
  scene,
  selectedBooth,
  validation,
  onUpdateService,
  onUpdateQueueLength,
  metrics,
  runState,
}: PropertyPanelProps) {
  const [serviceMin, setServiceMin] = useState(selectedBooth?.serviceTicksMin ?? 4);
  const [serviceMax, setServiceMax] = useState(selectedBooth?.serviceTicksMax ?? 8);
  const [queueK, setQueueK] = useState(selectedBooth?.queueCells.length ?? 3);

  // 选中展位变化时同步表单
  const boothKey = selectedBooth?.id ?? null;
  const [lastKey, setLastKey] = useState<string | null>(null);
  if (boothKey !== lastKey) {
    setLastKey(boothKey ?? null);
    if (selectedBooth) {
      setServiceMin(selectedBooth.serviceTicksMin);
      setServiceMax(selectedBooth.serviceTicksMax);
      setQueueK(selectedBooth.queueCells.length);
    }
  }

  return (
    <aside className="side-panel">
      {/* 对象属性 */}
      <div className="panel-section">
        <h3>对象属性</h3>
        {selectedBooth ? (
          <div className="prop-form">
            <div className="prop-row">
              <label>展位 ID</label>
              <strong>{selectedBooth.id}</strong>
            </div>
            <div className="prop-coord">
              实体：({selectedBooth.footprint.x}, {selectedBooth.footprint.y})
            </div>
            <div className="prop-coord">
              服务格 q0：({selectedBooth.serviceCell.x}, {selectedBooth.serviceCell.y})
            </div>
            <div className="prop-cell-list">
              队列格：
              {selectedBooth.queueCells.map((q, i) => (
                <span key={i} className="cell-tag queue">
                  q{i + 1}({q.x},{q.y})
                </span>
              ))}
            </div>
            <div className="prop-row">
              <label>服务时长下限</label>
              <input
                type="number"
                min={1}
                max={120}
                value={serviceMin}
                onChange={(e) => setServiceMin(Number(e.target.value))}
                onBlur={() => onUpdateService(selectedBooth.id, serviceMin, serviceMax)}
              />
            </div>
            <div className="prop-row">
              <label>服务时长上限</label>
              <input
                type="number"
                min={1}
                max={120}
                value={serviceMax}
                onChange={(e) => setServiceMax(Number(e.target.value))}
                onBlur={() => onUpdateService(selectedBooth.id, serviceMin, serviceMax)}
              />
            </div>
            <div className="prop-row">
              <label>队列长度 K</label>
              <input
                type="number"
                min={1}
                max={8}
                value={queueK}
                onChange={(e) => setQueueK(Number(e.target.value))}
                onBlur={() => onUpdateQueueLength(selectedBooth.id, queueK)}
              />
            </div>
            <div style={{ fontSize: 11, color: '#6b7a8a', marginTop: 4 }}>
              提示：修改参数后点击空白处或切换工具会自动应用。
            </div>
          </div>
        ) : (
          <div className="no-selection">
            未选中对象。使用「选择」工具点击展位查看属性。
          </div>
        )}
      </div>

      {/* 地图统计 */}
      <div className="panel-section">
        <h3>地图统计</h3>
        <div className="stat-row">
          <span className="label">地图尺寸</span>
          <span className="value">
            {scene.width}×{scene.height}
          </span>
        </div>
        <div className="stat-row">
          <span className="label">障碍数量</span>
          <span className="value">{scene.obstacles.length}</span>
        </div>
        <div className="stat-row">
          <span className="label">入口数量</span>
          <span className="value">{scene.entrances.length}</span>
        </div>
        <div className="stat-row">
          <span className="label">出口数量</span>
          <span className="value">{scene.exits.length}</span>
        </div>
        <div className="stat-row">
          <span className="label">展位数量</span>
          <span className="value">{scene.booths.length}</span>
        </div>
        <div className="stat-row">
          <span className="label">服务格总数</span>
          <span className="value">{scene.booths.length}</span>
        </div>
        <div className="stat-row">
          <span className="label">队列格总数</span>
          <span className="value">
            {scene.booths.reduce((s, b) => s + b.queueCells.length, 0)}
          </span>
        </div>
      </div>

      {/* 校验结果摘要 */}
      <div className="panel-section">
        <h3>校验状态</h3>
        {validation.readyForSimulation ? (
          <div className="validation-ok">✓ 场景完整合法，可用于仿真</div>
        ) : validation.ok ? (
          <div className="validation-notready">
            结构合法，但存在 {validation.issues.length} 项业务问题待解决
          </div>
        ) : (
          <div className="validation-notready">
            存在 {validation.issues.filter((i) => i.severity === 'error').length} 项结构错误
          </div>
        )}
      </div>

      {/* 仿真指标 */}
      <div className="panel-section">
        <h3>仿真指标</h3>
        <MetricsView metrics={metrics ?? null} runState={runState} />
      </div>

      {/* 图例 */}
      <div className="panel-section">
        <h3>图例</h3>
        <div className="legend">
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#7f8c8d' }} />
            障碍
          </div>
          <div className="legend-item">
            <span
              className="legend-swatch"
              style={{ background: '#27ae60', borderRadius: '50%' }}
            />
            入口
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#c0392b' }} />
            出口
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#2c5aa0' }} />
            展位实体
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#0e7c9b' }} />
            服务格 S
          </div>
          <div className="legend-item">
            <span className="legend-swatch" style={{ background: '#7fb3d5' }} />
            队列格 q
          </div>
          <div className="legend-item">
            <span
              className="legend-swatch legend-agent legend-agent--walking"
              style={{ background: '#27ae60' }}
              aria-hidden="true"
            />
            行走
          </div>
          <div className="legend-item">
            <span className="legend-swatch legend-agent" style={{ background: '#2c5aa0' }} aria-hidden="true" />
            排队
          </div>
          <div className="legend-item">
            <span className="legend-swatch legend-agent legend-agent--serving" style={{ background: '#e67e22' }} aria-hidden="true" />
            服务
          </div>
          <div className="legend-item">
            <span className="legend-swatch legend-agent legend-agent--exiting" style={{ background: '#8e44ad' }} aria-hidden="true" />
            离场
          </div>
        </div>
      </div>
    </aside>
  );
}
