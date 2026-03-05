// client/src/components/CodeEditor.tsx
import React, { useRef, useEffect, useCallback } from 'react';
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

/**
 * getLanguage()
 *
 * Maps file extension to a Monaco language identifier.
 * Falls back to 'plaintext' for unknown types.
 */
function getLanguage(filePath: string | null): string {
  if (!filePath) return 'plaintext';
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'c':   return 'c';
    case 'h':   return 'c';         // C header files use C syntax
    case 'py':  return 'python';
    case 'ts':  return 'typescript';
    case 'tsx': return 'typescript';
    case 'js':  return 'javascript';
    case 'jsx': return 'javascript';
    case 'json': return 'json';
    case 'md':  return 'markdown';
    case 'css': return 'css';
    case 'html': return 'html';
    default:    return 'plaintext';
  }
}

/**
 * getSeverity()
 *
 * Maps our Diagnostic severity string to Monaco's MarkerSeverity enum value.
 * We pass the monaco instance in so we don't need a top-level import of
 * monaco-editor (which would bloat the bundle).
 */
function getSeverity(
  severity: Diagnostic['severity'],
  monaco: any
): number {
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

// Defined outside the component so the object reference is stable
// and doesn't cause unnecessary Monaco re-renders
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
  overviewRulerLanes: 3,       // Show error/warning markers in the scrollbar gutter
  glyphMargin: true,           // Space for breakpoint-style glyph icons
  folding: true,               // Enable code folding
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

  // ── Mount handler ──
  // Fires once when Monaco finishes initializing.
  // Store refs so effects below can access the editor instance.
  // NOTE: We no longer call applyDiagnostics here — the combined effect
  // below handles both the initial application and file-switch re-apply.
  const handleEditorDidMount: OnMount = useCallback(
    (editorInstance, monacoInstance) => {
      editorRef.current = editorInstance;
      monacoRef.current = monacoInstance;
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

      const markers: editor.IMarkerData[] = diags.map((d) => ({
        startLineNumber: d.line,
        endLineNumber: d.line,
        // Use the reported column as start; extend to end of line for visibility
        startColumn: d.column || 1,
        endColumn: model.getLineMaxColumn(d.line) || 1000,
        message: `${d.message}  [${d.source}]`,
        severity: getSeverity(d.severity, monacoInstance),
      }));

      // 'project-spear' is our owner ID — scopes our markers so they
      // don't interfere with Monaco's own built-in language markers
      monacoInstance.editor.setModelMarkers(model, 'project-spear', markers);
    },
    []
  );

  // ─────────────────────────────────────────
  // FIX: Single combined effect for filePath + diagnostics
  //
  // PROBLEM with the original two-effect approach:
  //   Effect A (dep: [diagnostics]) → applies markers when diags change
  //   Effect B (dep: [filePath])    → clears markers on file switch
  //
  //   When the user clicks a different file, only filePath changes.
  //   Effect B fires and wipes the markers. diagnostics didn't change,
  //   so Effect A never fires → squiggles are cleared, never restored.
  //
  // FIX: One effect that depends on BOTH [filePath, diagnostics].
  //   requestAnimationFrame defers by one paint frame so Monaco has
  //   time to swap its internal ITextModel (triggered by the `path`
  //   prop on <Editor>) before we call setModelMarkers on it.
  //   Without the rAF, getModel() returns the OLD model and markers
  //   land on the wrong buffer.
  // ─────────────────────────────────────────

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    const frameId = requestAnimationFrame(() => {
      if (!editorRef.current || !monacoRef.current) return;
      applyDiagnostics(editorRef.current, monacoRef.current, diagnostics);
    });

    return () => cancelAnimationFrame(frameId);

    // filePath is intentionally included: when the user switches files the
    // `path` prop on <Editor> changes, Monaco swaps its model, and we must
    // re-apply the already-filtered diagnostics onto the new model.
  }, [diagnostics, filePath, applyDiagnostics]);

  // ─────────────────────────────────────────
  // EFFECT: navigate to line when issue is clicked
  // ─────────────────────────────────────────

  useEffect(() => {
    if (!navigateTo || !editorRef.current) return;

    const { line, column } = navigateTo;

    // Clamp line to valid range in case the diagnostic has a stale line number
    const model = editorRef.current.getModel();
    const lineCount = model?.getLineCount() ?? 1;
    const safeLine = Math.max(1, Math.min(line, lineCount));
    const safeColumn = Math.max(1, column || 1);

    // Reveal the line in the center of the viewport with smooth scrolling
    editorRef.current.revealLineInCenter(safeLine, 0 /* Smooth */);

    // Move the cursor to the exact position
    editorRef.current.setPosition({
      lineNumber: safeLine,
      column: safeColumn,
    });

    // Highlight the entire line briefly using a decoration
    const decorations = editorRef.current.createDecorationsCollection([
      {
        range: new monacoRef.current.Range(safeLine, 1, safeLine, 1),
        options: {
          isWholeLine: true,
          className: 'highlighted-line',
          // Also show a marker in the overview ruler (scrollbar)
          overviewRuler: {
            color: '#0e639c',
            position: monacoRef.current.editor.OverviewRulerLane.Full,
          },
        },
      },
    ]);

    // Remove the highlight decoration after 2 seconds
    const timer = setTimeout(() => {
      decorations.clear();
    }, 2000);

    // Focus the editor so keyboard navigation works immediately
    editorRef.current.focus();

    return () => clearTimeout(timer);
  }, [navigateTo]);

  // ─────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <Editor
        height="100%"
        width="100%"
        // Using path as the model key — Monaco keeps separate undo/scroll
        // history per unique path, which feels natural when switching files
        path={filePath || 'welcome.txt'}
        language={getLanguage(filePath)}
        value={content}
        theme="vs-dark"
        onMount={handleEditorDidMount}
        options={EDITOR_OPTIONS}
        // Show a subtle loading state while Monaco itself initialises
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