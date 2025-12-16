// client/src/components/IssuesPanel.tsx
import React from 'react';

// Re-using the Diagnostic interface
interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

interface IssuesPanelProps {
  diagnostics: Diagnostic[];
  onIssueClick: (issue: Diagnostic) => void;
}

const IssuesPanel: React.FC<IssuesPanelProps> = ({ diagnostics, onIssueClick }) => {
  return (
    <div className="issues-panel">
      <h3>Analysis Results ({diagnostics.length} issues)</h3>
      {diagnostics.length > 0 ? (
        <ul>
          {diagnostics.map((d, index) => (
            <li key={index} onClick={() => onIssueClick(d)} className={`issue-${d.severity}`}>
              <div className="issue-message">
                <span>{d.severity.toUpperCase()}</span>
                <p>{d.message} ({d.source})</p>
              </div>
              <div className="issue-location">
                {d.filePath} (L{d.line})
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="no-issues">No issues found.</p>
      )}
    </div>
  );
};

export default IssuesPanel;