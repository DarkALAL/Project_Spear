// client/src/components/IssuesPanel.tsx
import React from 'react';

// Re-using the Diagnostic interface from App.tsx
interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

// Updated props to include the handler for the AI button
interface IssuesPanelProps {
  diagnostics: Diagnostic[];
  onIssueClick: (issue: Diagnostic) => void;
  onAskAI: (issue: Diagnostic) => void; // New prop for the AI functionality
}

const IssuesPanel: React.FC<IssuesPanelProps> = ({ diagnostics, onIssueClick, onAskAI }) => {
  return (
    <div className="issues-panel">
      <h3>Analysis Results ({diagnostics.length} issues)</h3>
      {diagnostics.length > 0 ? (
        <ul>
          {diagnostics.map((d, index) => (
            <li key={index} className={`issue-${d.severity}`}>
              {/* This div handles the navigation click */}
              <div className="issue-content" onClick={() => onIssueClick(d)}>
                <div className="issue-message">
                  <span>{d.severity.toUpperCase()}</span>
                  <p>{d.message} ({d.source})</p>
                </div>
                <div className="issue-location">
                  {d.filePath} (L{d.line})
                </div>
              </div>

              {/* NEW: This button handles the AI explanation request */}
              <button 
                className="ai-button" 
                onClick={(e) => {
                  e.stopPropagation(); // Prevents the navigation click from firing
                  onAskAI(d);
                }}
              >
                Ask AI ✨
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="no-issues">No issues found or analysis not yet run.</p>
      )}
    </div>
  );
};

export default IssuesPanel;