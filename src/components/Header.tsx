/** 顶部标题栏 */
interface HeaderProps {
  stage: string;
  ready: boolean;
}

export function Header({ stage, ready }: HeaderProps) {
  return (
    <header className="app-header">
      <h1><span className="brand-mark" aria-hidden="true">F</span>FlowForge <span className="brand-subtitle">校园人流实验室</span></h1>
      <div className="header-meta">
        <div className="header-anniversary" aria-label="上理建校120周年，1906至2026">
          <strong>120</strong>
          <span>百廿上理<small>1906 — 2026</small></span>
        </div>
        <div className="header-status">
          <span className="stage-badge">{stage}</span>
          <span className={`stage-badge ${ready ? 'ready' : 'draft'}`}>
            {ready ? '可用于仿真' : '编辑草稿'}
          </span>
        </div>
      </div>
    </header>
  );
}
