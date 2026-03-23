// client/src/components/CodeEditor.tsx
import React, { useRef, useEffect, useCallback, useState } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';

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

interface NavigationTarget {
  line: number;
  column: number;
}

interface CodeEditorProps {
  filePath: string | null;
  content: string;
  diagnostics: Diagnostic[];
  navigateTo: NavigationTarget | null;
}

// ─────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────

function getLanguage(filePath: string | null): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'c':    return 'c';
    case 'h':    return 'c';
    case 'py':   return 'python';
    case 'ts':   return 'typescript';
    case 'tsx':  return 'typescript';
    case 'js':   return 'javascript';
    case 'jsx':  return 'javascript';
    case 'json': return 'json';
    case 'md':   return 'markdown';
    case 'css':  return 'css';
    case 'html': return 'html';
    default:     return 'plaintext';
  }
}

function getSeverity(severity: Diagnostic['severity'], monaco: any): number {
  switch (severity) {
    case 'error':   return monaco.MarkerSeverity.Error;
    case 'warning': return monaco.MarkerSeverity.Warning;
    case 'info':    return monaco.MarkerSeverity.Info;
    default:        return monaco.MarkerSeverity.Warning;
  }
}

// ─────────────────────────────────────────
// MONACO EDITOR OPTIONS
// ─────────────────────────────────────────

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  readOnly: true,
  minimap: { enabled: true },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 20,
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', 'Courier New', monospace",
  fontLigatures: true,
  renderLineHighlight: 'line',
  cursorStyle: 'line',
  smoothScrolling: true,
  scrollbar: {
    verticalScrollbarSize: 6,
    horizontalScrollbarSize: 6,
  },
  overviewRulerLanes: 3,
  glyphMargin: true,
  folding: true,
  lineNumbers: 'on',
  renderWhitespace: 'none',
  tabSize: 4,
  wordWrap: 'off',
};

// ─────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────

const CodeEditor: React.FC<CodeEditorProps> = ({
  filePath,
  content,
  diagnostics,
  navigateTo,
}) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);

  // ── THE FIX ──
  //
  // The original bug: diagnostics arrive and the useEffect runs, but
  // editorRef.current is still null because Monaco hasn't mounted yet.
  // The effect returns early and squiggles are dropped.
  //
  // When Monaco finally mounts, handleEditorDidMount writes to editorRef
  // (a ref mutation) — but ref mutations do NOT trigger re-renders, so
  // the effect NEVER re-runs. Squiggles stay missing permanently.
  //
  // Fix: use a boolean state flag `editorReady`. Setting it inside
  // handleEditorDidMount causes a React re-render, which re-runs the
  // squiggles effect with a live editorRef.current. One extra render,
  // zero race condition.
  const [editorReady, setEditorReady] = useState(false);

  // ── Mount handler ──
  const handleEditorDidMount: OnMount = useCallback(
    (editorInstance, monacoInstance) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;
      // Flip the flag → triggers re-render → squiggles effect re-runs
      setEditorReady(true);
    },
    []
  );

  // ─────────────────────────────────────────
  // HELPER: apply diagnostic markers to Monaco
  // ─────────────────────────────────────────

  const applyDiagnostics = useCallback(
    (
      editorInstance: editor.IStandaloneCodeEditor,
      monacoInstance: any,
      diags: Diagnostic[]
    ) => {
      const model = editorInstance.getModel();
      if (!model) return;

      const lineCount = model.getLineCount();
      console.log('[Spear] setModelMarkers →', diags.length, 'markers on', editorInstance.getModel()?.uri.path);

      const markers: editor.IMarkerData[] = diags
        // Guard: skip any diagnostic whose line number exceeds the file.
        // Monaco silently rejects the ENTIRE batch if even one marker is
        // out of range — this filter prevents all squiggles being wiped.
        .filter((d) => d.line >= 1 && d.line <= lineCount)
        .map((d) => ({
          startLineNumber: d.line,
          endLineNumber:   d.line,
          startColumn:     d.column || 1,
          endColumn:       model.getLineMaxColumn(d.line) || 1000,
          message:         `${d.message}  [${d.source}]`,
          severity:        getSeverity(d.severity, monacoInstance),
        }));

      // 'project-spear' scopes our markers away from Monaco's built-in ones
      monacoInstance.editor.setModelMarkers(model, 'project-spear', markers);
    },
    []
  );

  // ─────────────────────────────────────────
  // EFFECT: apply / refresh squiggle markers
  //
  // Dependencies:
  //   diagnostics  — new analysis results
  //   filePath     — user switched file; Monaco swapped its ITextModel
  //   editorReady  — Monaco just finished mounting (the key fix)
  //
  // requestAnimationFrame defers by one paint so Monaco has time to
  // swap its internal ITextModel (triggered by the `path` prop) before
  // we call setModelMarkers. Without the rAF, getModel() may return
  // the old model and markers land on the wrong buffer.
  // ─────────────────────────────────────────

  useEffect(() => {
    if (!editorReady || !editorRef.current || !monacoRef.current) return;

    const frameId = requestAnimationFrame(() => {
      if (!editorRef.current || !monacoRef.current) return;
      applyDiagnostics(editorRef.current, monacoRef.current, diagnostics);
    });

    return () => cancelAnimationFrame(frameId);
  }, [diagnostics, filePath, editorReady, applyDiagnostics]);

  // ─────────────────────────────────────────
  // EFFECT: navigate to line when issue is clicked
  // ─────────────────────────────────────────

  useEffect(() => {
    if (!navigateTo || !editorRef.current) return;

    const { line, column } = navigateTo;

    const model      = editorRef.current.getModel();
    const lineCount  = model?.getLineCount() ?? 1;
    const safeLine   = Math.max(1, Math.min(line, lineCount));
    const safeColumn = Math.max(1, column || 1);

    editorRef.current.revealLineInCenter(safeLine, 0 /* Smooth */);
    editorRef.current.setPosition({ lineNumber: safeLine, column: safeColumn });

    const decorations = editorRef.current.createDecorationsCollection([
      {
        range: new monacoRef.current.Range(safeLine, 1, safeLine, 1),
        options: {
          isWholeLine: true,
          className: 'highlighted-line',
          overviewRuler: {
            color: '#0e639c',
            position: monacoRef.current.editor.OverviewRulerLane.Full,
          },
        },
      },
    ]);

    const timer = setTimeout(() => decorations.clear(), 2000);
    editorRef.current.focus();

    return () => clearTimeout(timer);
  }, [navigateTo]);

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Editor
        height="100%"
        width="100%"
        path={filePath || 'welcome.txt'}
        language={getLanguage(filePath)}
        value={content}
        theme="vs-dark"
        onMount={handleEditorDidMount}
        options={EDITOR_OPTIONS}
        loading={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: '#5a6470',
              fontSize: '13px',
            }}
          >
            Loading editor...
          </div>
        }
      />
    </div>
  );
};

export default CodeEditor;