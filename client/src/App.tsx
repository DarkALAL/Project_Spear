// client/src/App.tsx
import React, { useState, useCallback } from 'react';
import './App.css';
import CodeEditor from './components/CodeEditor';
import IssuesPanel from './components/IssuesPanel';
import AIExplanationModal from './components/AIExplanationModal';
import DependencyGraph from './components/DependencyGraph';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

export interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

type NavigationTarget = { line: number; column: number };

type AppTab = 'editor' | 'dependencies';

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────

// Reads from client/.env — falls back to localhost for local dev
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

// ─────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────

function App() {
  // --- Project State ---
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');

  // --- Editor State ---
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');

  // Cache of all fetched file contents — passed to DependencyGraph
  // so it can parse imports and draw edges between files
  const [fileContents, setFileContents] = useState<Record<string, string>>({});

  // --- Analysis State ---
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  // --- UI State ---
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<AppTab>('editor');
  const [navigateTo, setNavigateTo] = useState<NavigationTarget | null>(null);

  // Error banner state — shown at top of UI if a fetch fails
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // --- AI Modal State ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);

  // ─────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────

  const showError = (msg: string) => {
    setErrorMessage(msg);
    // Auto-dismiss after 6 seconds
    setTimeout(() => setErrorMessage(null), 6000);
  };

  // ─────────────────────────────────────────
  // EVENT HANDLERS
  // ─────────────────────────────────────────

  /**
   * handleFileUpload()
   * Sends the zip to the server, stores the returned projectId and file list.
   */
  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate it's a zip before sending
    if (!file.name.endsWith('.zip')) {
      showError('Please upload a .zip file.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setUploadedFileName(file.name);

    // Reset all project state on new upload
    setProjectId(null);
    setFiles([]);
    setSelectedFile(null);
    setFileContent('');
    setFileContents({});
    setDiagnostics([]);
    setNavigateTo(null);
    setActiveTab('editor');

    const formData = new FormData();
    formData.append('project', file);

    try {
      const response = await fetch(`${API_BASE}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${response.status})`);
      }

      const data = await response.json();
      setProjectId(data.projectId);
      setFiles(data.files);
    } catch (error: any) {
      console.error('Upload failed:', error);
      showError(`Upload failed: ${error.message}`);
      setUploadedFileName('');
    } finally {
      setIsLoading(false);
      // Reset the input so the same file can be re-uploaded if needed
      event.target.value = '';
    }
  };

  /**
   * handleFileSelect()
   * Fetches file content from the server and updates the editor.
   * Also caches the content for the DependencyGraph.
   * Returns a Promise so callers can await it before navigating.
   */
  const handleFileSelect = useCallback(
    async (file: string): Promise<void> => {
      if (!projectId) return;

      // If content is already cached, just switch to it without a fetch
      if (fileContents[file]) {
        setSelectedFile(file);
        setFileContent(fileContents[file]);
        setNavigateTo(null);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(
          `${API_BASE}/api/project/${projectId}/file?path=${encodeURIComponent(file)}`
        );

        if (!response.ok) {
          throw new Error(`Could not load file (${response.status})`);
        }

        const content = await response.text();

        setSelectedFile(file);
        setFileContent(content);
        setNavigateTo(null);

        // Cache the content — used by DependencyGraph to parse imports
        setFileContents((prev) => ({ ...prev, [file]: content }));
      } catch (error: any) {
        console.error('Failed to fetch file content:', error);
        showError(`Failed to load file: ${error.message}`);
      } finally {
        setIsLoading(false);
      }
    },
    [projectId, fileContents]
  );

  /**
   * handleAnalyze()
   * Triggers static analysis on the entire project.
   */
  const handleAnalyze = async () => {
    if (!projectId) return;

    setIsLoading(true);
    setDiagnostics([]);
    setErrorMessage(null);

    try {
      const response = await fetch(
        `${API_BASE}/api/project/${projectId}/analyze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Analysis failed (${response.status})`);
      }

      const data: Diagnostic[] = await response.json();
      setDiagnostics(data);

      if (data.length === 0) {
        showError('✅ No issues found! Your code looks clean.');
      }
    } catch (error: any) {
      console.error('Analysis failed:', error);
      showError(`Analysis failed: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * handleIssueClick()
   * Navigates the editor to the file and line of a clicked diagnostic.
   * Awaits file loading before setting the navigation target.
   */
  const handleIssueClick = async (issue: Diagnostic) => {
    if (issue.filePath !== selectedFile) {
      await handleFileSelect(issue.filePath);
    }
    // Small delay lets Monaco finish mounting the new file content
    // before we tell it to scroll to a line
    setTimeout(() => {
      setNavigateTo({ line: issue.line, column: issue.column });
    }, 100);
  };

  /**
   * handleAskAI()
   * Opens the AI modal and fetches an explanation for a diagnostic.
   */
  const handleAskAI = async (diagnostic: Diagnostic) => {
    if (!projectId) return;

    setIsModalOpen(true);
    setIsAIThinking(true);
    setAiExplanation('');

    try {
      const response = await fetch(
        `${API_BASE}/api/project/${projectId}/explain`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diagnostic }),
        }
      );

      const data = await response.json();

      // Both success (200) and graceful AI-unavailable (503) return
      // an { explanation } field — show whatever the server sends
      setAiExplanation(
        data.explanation || 'The AI did not return a response.'
      );
    } catch (error: any) {
      console.error('AI explanation failed:', error);
      setAiExplanation(
        `Failed to reach the AI service.\n\nError: ${error.message}`
      );
    } finally {
      setIsAIThinking(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setAiExplanation('');
  };

  // ─────────────────────────────────────────
  // DERIVED DATA
  // ─────────────────────────────────────────

  // Files with cached content — passed to DependencyGraph for edge parsing
  const filesWithContent = files.map((f) => ({
    path: f,
    content: fileContents[f],
  }));

  // Diagnostics for the currently open file — passed to Monaco for squiggles
  const currentFileDiagnostics = diagnostics.filter(
    (d) => d.filePath === selectedFile
  );

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div className="App">

      {/* ── HEADER ── */}
      <header className="App-header">
        <div className="header-left">
          <h1>Project Spear</h1>
          <nav className="top-nav">
            <button
              className={`nav-button ${activeTab === 'editor' ? 'active' : ''}`}
              onClick={() => setActiveTab('editor')}
              disabled={!projectId}
            >
              Editor
            </button>
            <button
              className={`nav-button ${activeTab === 'dependencies' ? 'active' : ''}`}
              onClick={() => setActiveTab('dependencies')}
              disabled={!projectId}
            >
              Dependencies
            </button>
          </nav>
        </div>

        <div className="header-right">
          <div className="controls">
            {/* Hidden file input — triggered by the label below */}
            <input
              type="file"
              id="file-upload"
              accept=".zip"
              onChange={handleFileUpload}
              disabled={isLoading}
              style={{ display: 'none' }}
            />
            <label
              htmlFor="file-upload"
              className={`browse-button ${isLoading ? 'disabled' : ''}`}
            >
              Browse...
            </label>

            {uploadedFileName && (
              <span className="file-name" title={uploadedFileName}>
                {uploadedFileName}
              </span>
            )}

            {projectId && (
              <button onClick={handleAnalyze} disabled={isLoading}>
                {isLoading ? 'Working...' : 'Analyze Project'}
              </button>
            )}

            {projectId && (
              <span className="status ready">
                {diagnostics.length > 0
                  ? `${diagnostics.length} issue${diagnostics.length !== 1 ? 's' : ''}`
                  : '● Ready'}
              </span>
            )}
          </div>
        </div>
      </header>

      {/* ── ERROR BANNER ── */}
      {errorMessage && (
        <div className="error-banner">
          <span>{errorMessage}</span>
          <button
            className="error-dismiss"
            onClick={() => setErrorMessage(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="main-content">

        {/* Loading overlay */}
        {isLoading && (
          <div className="loader-overlay">
            <div className="loader-spinner" />
            <span>Working...</span>
          </div>
        )}

        {/* No project uploaded yet */}
        {!projectId && !isLoading && (
          <div className="placeholder">
            <div className="placeholder-inner">
              <p>📁 Upload a <strong>.zip</strong> file containing your C or Python project to begin.</p>
              <p className="placeholder-sub">Supported file types: .c, .h, .py</p>
            </div>
          </div>
        )}

        {/* Project loaded — Editor tab */}
        {projectId && activeTab === 'editor' && (
          <>
            {/* File Tree */}
            <div className="file-tree">
              <h3>Project Files</h3>
              {files.length === 0 ? (
                <p className="no-issues">No files found.</p>
              ) : (
                <ul>
                  {files.map((file) => {
                    const issueCount = diagnostics.filter(
                      (d) => d.filePath === file
                    ).length;
                    return (
                      <li
                        key={file}
                        onClick={() => handleFileSelect(file)}
                        className={selectedFile === file ? 'selected' : ''}
                        title={file}
                      >
                        <span className="file-name-tree">{file}</span>
                        {issueCount > 0 && (
                          <span className="file-issue-badge">{issueCount}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Code Editor */}
            <div className="editor-container">
              {!selectedFile && (
                <div className="editor-placeholder">
                  Select a file from the tree to view it.
                </div>
              )}
              <CodeEditor
                filePath={selectedFile}
                content={fileContent}
                diagnostics={currentFileDiagnostics}
                navigateTo={navigateTo}
              />
            </div>

            {/* Issues Panel */}
            <IssuesPanel
              diagnostics={diagnostics}
              onIssueClick={handleIssueClick}
              onAskAI={handleAskAI}
            />
          </>
        )}

        {/* Project loaded — Dependencies tab */}
        {projectId && activeTab === 'dependencies' && (
          <div className="dependency-graph-wrapper">
            <DependencyGraph files={filesWithContent} />
          </div>
        )}

      </main>

      {/* ── AI MODAL ── */}
      {isModalOpen && (
        <AIExplanationModal
          isLoading={isAIThinking}
          explanation={aiExplanation}
          onClose={handleCloseModal}
        />
      )}

    </div>
  );
}

export default App;