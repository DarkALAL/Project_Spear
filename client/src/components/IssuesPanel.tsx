// client/src/components/IssuesPanel.tsx
import React, { useState, useMemo } from 'react';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

type SeverityFilter = 'all' | 'error' | 'warning' | 'info';
type SortMode = 'file' | 'severity';

interface IssuesPanelProps {
  diagnostics: Diagnostic[];
  onIssueClick: (issue: Diagnostic) => void;
  onAskAI: (issue: Diagnostic) => void;
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

/**
 * getSeverityRank()
 * Used for sorting — errors first, then warnings, then info.
 */
function getSeverityRank(severity: Diagnostic['severity']): number {
  switch (severity) {
    case 'error':   return 0;
    case 'warning': return 1;
    case 'info':    return 2;
    default:        return 3;
  }
}

/**
 * getSeverityLabel()
 * Short uppercase label shown in the badge.
 */
function getSeverityLabel(severity: Diagnostic['severity']): string {
  switch (severity) {
    case 'error':   return 'ERR';
    case 'warning': return 'WARN';
    case 'info':    return 'INFO';
    default:        return 'UNKNOWN'; // ✅ safe plain string
  }
}

/**
 * getSourceColor()
 * Gives each linter tool a unique accent color so users can
 * visually distinguish where an issue came from at a glance.
 */
function getSourceColor(source: string): string {
  switch (source) {
    case 'Pylint':     return '#c586c0'; // purple
    case 'Flake8':     return '#9cdcfe'; // light blue
    case 'Bandit':     return '#f48771'; // red-orange
    case 'Cppcheck':   return '#4ec9b0'; // teal
    case 'Clang-Tidy': return '#dcdcaa'; // yellow
    default:           return '#8b9ba8'; // grey
  }
}

// ─────────────────────────────────────────
// SUB-COMPONENT: Single Issue Row
// ─────────────────────────────────────────

interface IssueRowProps {
  diagnostic: Diagnostic;
  onIssueClick: (issue: Diagnostic) => void;
  onAskAI: (issue: Diagnostic) => void;
}

const IssueRow: React.FC<IssueRowProps> = ({
  diagnostic: d,
  onIssueClick,
  onAskAI,
}) => {
  return (
    <li className={`issue-${d.severity}`}>

      {/* Clickable area — navigates editor to the issue location */}
      <div
        className="issue-content"
        onClick={() => onIssueClick(d)}
        title={`Click to navigate to ${d.filePath} line ${d.line}`}
      >
        {/* Top row: severity badge + message */}
        <div className="issue-message">
          <span>{getSeverityLabel(d.severity)}</span>
          <p>{d.message}</p>
        </div>

        {/* Bottom row: file path + line + source tool */}
        <div className="issue-location">
          <span className="issue-filepath">{d.filePath}</span>
          <span className="issue-line">L{d.line}:{d.column}</span>
          <span
            className="issue-source"
            style={{ color: getSourceColor(d.source) }}
          >
            {d.source}
          </span>
        </div>
      </div>

      {/* Ask AI button — stopPropagation prevents triggering onIssueClick */}
      <button
        className="ai-button"
        onClick={(e) => {
          e.stopPropagation();
          onAskAI(d);
        }}
        title="Ask AI to explain and fix this issue"
        aria-label={`Ask AI about: ${d.message}`}
      >
        Ask AI ✨
      </button>

    </li>
  );
};

// ─────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────

const IssuesPanel: React.FC<IssuesPanelProps> = ({
  diagnostics,
  onIssueClick,
  onAskAI,
}) => {
  // ── Local UI State ──
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('file');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // ── Counts for filter badges ──
  const errorCount   = diagnostics.filter((d) => d.severity === 'error').length;
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length;
  const infoCount    = diagnostics.filter((d) => d.severity === 'info').length;

  // ── Filtered + sorted diagnostics ──
  // useMemo so we don't recompute on every render unless inputs change
  const visibleDiagnostics = useMemo(() => {
    let result = [...diagnostics];

    // 1. Apply severity filter
    if (severityFilter !== 'all') {
      result = result.filter((d) => d.severity === severityFilter);
    }

    // 2. Apply search query (matches message, filePath, or source)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (d) =>
          d.message.toLowerCase().includes(q) ||
          d.filePath.toLowerCase().includes(q) ||
          d.source.toLowerCase().includes(q)
      );
    }

    // 3. Apply sort
    if (sortMode === 'severity') {
      result.sort((a, b) => {
        const rankDiff = getSeverityRank(a.severity) - getSeverityRank(b.severity);
        if (rankDiff !== 0) return rankDiff;
        // Secondary sort: file then line within same severity
        if (a.filePath < b.filePath) return -1;
        if (a.filePath > b.filePath) return 1;
        return a.line - b.line;
      });
    } else {
      // Default: sort by file then line (matches backend sort)
      result.sort((a, b) => {
        if (a.filePath < b.filePath) return -1;
        if (a.filePath > b.filePath) return 1;
        return a.line - b.line;
      });
    }

    return result;
  }, [diagnostics, severityFilter, sortMode, searchQuery]);

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div className="issues-panel">

      {/* ── PANEL HEADER ── */}
      <h3>
        Issues
        {diagnostics.length > 0 && (
          <span className="issues-total-badge">{diagnostics.length}</span>
        )}
      </h3>

      {/* ── Only show controls if there are diagnostics ── */}
      {diagnostics.length > 0 && (
        <>
          {/* Severity filter buttons */}
          <div className="issues-filters">
            <button
              className={`filter-btn ${severityFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSeverityFilter('all')}
              title="Show all issues"
            >
              All ({diagnostics.length})
            </button>
            {errorCount > 0 && (
              <button
                className={`filter-btn filter-btn-error ${severityFilter === 'error' ? 'active' : ''}`}
                onClick={() => setSeverityFilter('error')}
                title="Show errors only"
              >
                Errors ({errorCount})
              </button>
            )}
            {warningCount > 0 && (
              <button
                className={`filter-btn filter-btn-warning ${severityFilter === 'warning' ? 'active' : ''}`}
                onClick={() => setSeverityFilter('warning')}
                title="Show warnings only"
              >
                Warnings ({warningCount})
              </button>
            )}
            {infoCount > 0 && (
              <button
                className={`filter-btn filter-btn-info ${severityFilter === 'info' ? 'active' : ''}`}
                onClick={() => setSeverityFilter('info')}
                title="Show info only"
              >
                Info ({infoCount})
              </button>
            )}
          </div>

          {/* Search + sort row */}
          <div className="issues-toolbar">
            <input
              type="text"
              className="issues-search"
              placeholder="Search issues..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search issues"
            />
            <select
              className="issues-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              aria-label="Sort issues"
            >
              <option value="file">Sort: File</option>
              <option value="severity">Sort: Severity</option>
            </select>
          </div>
        </>
      )}

      {/* ── ISSUES LIST ── */}
      {diagnostics.length === 0 ? (
        // No analysis run yet or project has no issues
        <p className="no-issues">
          No issues found. Run "Analyze Project" to begin.
        </p>
      ) : visibleDiagnostics.length === 0 ? (
        // Filter/search returned no results
        <p className="no-issues">
          No issues match the current filter.
        </p>
      ) : (
        <ul>
          {visibleDiagnostics.map((d, index) => (
            <IssueRow
              key={`${d.filePath}:${d.line}:${d.column}:${d.source}:${index}`}
              diagnostic={d}
              onIssueClick={onIssueClick}
              onAskAI={onAskAI}
            />
          ))}
        </ul>
      )}

    </div>
  );
};

export default IssuesPanel;