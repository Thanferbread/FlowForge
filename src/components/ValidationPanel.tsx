/** 底部校验结果面板：列出所有校验问题 */
import type { ValidationIssue } from '../domain/types';

interface ValidationPanelProps {
  issues: ValidationIssue[];
  ready: boolean;
}

export function ValidationPanel({ issues, ready }: ValidationPanelProps) {
  if (ready) {
    return null; // 无问题时不占空间
  }

  return (
    <div className="validation-summary">
      <div className="validation-summary-title">
        校验问题（{issues.length} 项）
      </div>
      <ul className="issue-list">
        {issues.map((issue, i) => (
          <li key={i} className={`issue-item ${issue.severity}`}>
            <span className="issue-code">[{issue.code}]</span>
            {issue.message}
            {issue.pos && (
              <span className="issue-code"> ({issue.pos.x},{issue.pos.y})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
