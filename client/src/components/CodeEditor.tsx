// client/src/components/CodeEditor.tsx
import React, { useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import type { OnMount } from '@monaco-editor/react';
import { editor } from 'monaco-editor';

// Interface for diagnostic data
interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

interface CodeEditorProps {
    filePath: string | null;
    content: string;
    diagnostics: Diagnostic[];
    navigateTo: { line: number, column: number } | null;
}

const CodeEditor: React.FC<CodeEditorProps> = ({ filePath, content, diagnostics, navigateTo }) => {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);

  const handleEditorDidMount: OnMount = (editorInstance, monacoInstance) => {
    editorRef.current = editorInstance;
    monacoRef.current = monacoInstance;
  };

  // Effect to set the diagnostic markers (squiggles)
  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;
    
    const model = editorRef.current.getModel();
    if (!model) return;

    const markers: editor.IMarkerData[] = diagnostics.map(d => ({
        startLineNumber: d.line,
        endLineNumber: d.line,
        startColumn: d.column,
        endColumn: 1000,
        message: `${d.message} (${d.source})`,
        severity: d.severity === 'error' ? monacoRef.current.MarkerSeverity.Error : monacoRef.current.MarkerSeverity.Warning,
    }));
    
    monacoRef.current.editor.setModelMarkers(model, 'owner', markers);
  }, [diagnostics]);

  // Effect to handle navigation when an issue is clicked
  useEffect(() => {
    if (navigateTo && editorRef.current) {
        editorRef.current.revealLineInCenter(navigateTo.line, editor.ScrollType.Smooth);
        editorRef.current.setPosition({ lineNumber: navigateTo.line, column: navigateTo.column });
        editorRef.current.focus();
    }
  }, [navigateTo]);

  const language = filePath?.endsWith('.c') ? 'c' : 'python';

  return (
    <div style={{ 
      position: 'absolute', 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0 
    }}>
      <Editor
        height="100%"
        width="100%"
        path={filePath || 'placeholder.txt'}
        language={language}
        value={content}
        theme="vs-dark"
        onMount={handleEditorDidMount}
        options={{ 
          readOnly: !filePath,
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
};

export default CodeEditor;