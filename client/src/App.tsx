// client/src/App.tsx
import React, { useState } from 'react';
import './App.css';
import CodeEditor from './components/CodeEditor';
import IssuesPanel from './components/IssuesPanel';

// Interface for diagnostic data
interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

// A type to pass navigation commands to the CodeEditor
type NavigationTarget = { line: number; column: number };

function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [navigateTo, setNavigateTo] = useState<NavigationTarget | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setUploadedFileName(file.name); // Store file name for display
    const formData = new FormData();
    formData.append('project', file);

    try {
      const response = await fetch('http://localhost:3001/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      setProjectId(data.projectId);
      setFiles(data.files);
      setSelectedFile(null);
      setFileContent('');
      setDiagnostics([]);
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = async (file: string) => {
    if (!projectId || file === selectedFile) return;
    setIsLoading(true);
    try {
      const response = await fetch(`http://localhost:3001/api/project/${projectId}/file?path=${encodeURIComponent(file)}`);
      const content = await response.text();
      setSelectedFile(file);
      setFileContent(content);
      setNavigateTo(null);
    } catch (error) {
      console.error('Failed to fetch file content:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!projectId) return;
    setIsLoading(true);
    setDiagnostics([]);
    try {
      const response = await fetch(`http://localhost:3001/api/project/${projectId}/analyze`, { method: 'POST' });
      const data = await response.json();
      setDiagnostics(data);
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleIssueClick = (issue: Diagnostic) => {
    const navigate = () => {
      setNavigateTo({ line: issue.line, column: issue.column });
    };
    if (issue.filePath !== selectedFile) {
      handleFileSelect(issue.filePath).then(navigate);
    } else {
      navigate();
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Project Spear: AI Code Analysis</h1>
        <div className="controls">
          <input type="file" id="file-upload" accept=".zip" onChange={handleFileUpload} disabled={isLoading} style={{ display: 'none' }} />
          <label htmlFor="file-upload" className="browse-button">Browse...</label>
          {uploadedFileName && <span className="file-name">{uploadedFileName}</span>}
          {projectId && <button onClick={handleAnalyze} disabled={isLoading}>Analyze Project</button>}
        </div>
        {isLoading && <div className="loader">Processing...</div>}
      </header>
      <main className="main-content">
        {projectId ? (
          <>
            <div className="file-tree">
              <h3>Project Files</h3>
              <ul>
                {files.map(file => (
                  <li key={file} onClick={() => handleFileSelect(file)} className={selectedFile === file ? 'selected' : ''}>
                    {file}
                  </li>
                ))}
              </ul>
            </div>
            <div className="editor-container">
              <CodeEditor 
                filePath={selectedFile} 
                content={fileContent} 
                diagnostics={diagnostics.filter(d => d.filePath === selectedFile)}
                navigateTo={navigateTo}
              />
            </div>
            <IssuesPanel diagnostics={diagnostics} onIssueClick={handleIssueClick} />
          </>
        ) : (
          <div className="placeholder">Please upload a project .zip file to begin.</div>
        )}
      </main>
    </div>
  );
}

export default App;