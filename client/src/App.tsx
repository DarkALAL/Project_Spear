// client/src/App.tsx
import React, { useState } from 'react';
import './App.css';
import CodeEditor from './components/CodeEditor';
import IssuesPanel from './components/IssuesPanel';
import AIExplanationModal from './components/AIExplanationModal'; // Re-import the modal
// Assuming you will create this component for the new tab
// import DependencyGraph from './components/DependencyGraph'; 

// --- TYPE DEFINITIONS ---
interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}
type NavigationTarget = { line: number; column: number };

function App() {
  // --- STATE MANAGEMENT (Merged) ---
  const [projectId, setProjectId] = useState<string | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [navigateTo, setNavigateTo] = useState<NavigationTarget | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');
  
  // State for the new tabbed UI
  const [activeTab, setActiveTab] = useState<'editor' | 'dependencies'>('editor');
  
  // State for the AI explanation modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aiExplanation, setAiExplanation] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);

  // --- EVENT HANDLERS ---
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setUploadedFileName(file.name);
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
      setActiveTab('editor'); // Default to editor view on new upload
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
      // FIXED: Added headers and body to the fetch call
      const response = await fetch(`http://localhost:3001/api/project/${projectId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
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

  // Re-integrated AI handler
  const handleAskAI = async (diagnostic: Diagnostic) => {
    if (!projectId) return;
    setIsModalOpen(true);
    setIsAIThinking(true);
    setAiExplanation('');
    try {
      const response = await fetch(`http://localhost:3001/api/project/${projectId}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnostic }),
      });
      const data = await response.json();
      setAiExplanation(data.explanation);
    } catch (error) {
      setAiExplanation('Sorry, the AI assistant failed to respond.');
    } finally {
      setIsAIThinking(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-left">
          <h1>Project Spear</h1>
          <div className="top-nav">
            <button className={`nav-button ${activeTab === 'editor' ? 'active' : ''}`} onClick={() => setActiveTab('editor')}>Editor</button>
            <button className={`nav-button ${activeTab === 'dependencies' ? 'active' : ''}`} onClick={() => setActiveTab('dependencies')}>Dependencies</button>
          </div>
        </div>
        <div className="header-right">
          <div className="controls">
            <input type="file" id="file-upload" accept=".zip" onChange={handleFileUpload} disabled={isLoading} style={{ display: 'none' }} />
            <label htmlFor="file-upload" className="browse-button">Browse...</label>
            {uploadedFileName && <span className="file-name">{uploadedFileName}</span>}
            {projectId && <button onClick={handleAnalyze} disabled={isLoading}>Analyze Project</button>}
          </div>
        </div>
      </header>
      <main className="main-content">
        {isLoading && <div className="loader-overlay"><div>Analyzing...</div></div>}
        {projectId ? (
          activeTab === 'editor' ? (
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
              <IssuesPanel 
                diagnostics={diagnostics} // Show all project diagnostics
                onIssueClick={handleIssueClick}
                onAskAI={handleAskAI} // Connect the AI handler
              />
            </>
          ) : (
            // <DependencyGraph files={files} /> 
            <div className="placeholder">Dependency Graph View</div> // Placeholder for your component
          )
        ) : (
          <div className="placeholder">Please upload a project .zip file to begin.</div>
        )}
      </main>
      {isModalOpen && (
        <AIExplanationModal 
          isLoading={isAIThinking}
          explanation={aiExplanation}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </div>
  );
}

export default App;