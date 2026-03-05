// server/src/index.ts
import express from 'express';
import cors from 'cors';
import multer from 'multer';

// Import all our services
import { analyzeProject, getAIContext } from './analysisService';
import { handleFileUpload, getProjectPath, getFileContent } from './projectService';
import { initializeAI, getAICompletion } from './aiService';

const app = express();
const port = 3001;
const upload = multer({ dest: 'temp_uploads/' });

app.use(cors());
app.use(express.json());

// --- Existing Endpoints (No Changes Needed) ---

// Endpoint to upload a project zip file
app.post('/api/upload', upload.single('project'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }
  try {
    const result = await handleFileUpload(req.file.path);
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).send('Failed to process upload.');
  }
});

// Endpoint to get the content of a specific file in a project
app.get('/api/project/:projectId/file', async (req, res) => {
    const { projectId } = req.params;
    const { path: filePath } = req.query;

    if (typeof filePath !== 'string') {
        return res.status(400).send('File path is required.');
    }
    try {
        const content = await getFileContent(projectId, filePath);
        res.send(content);
    } catch (error: any) {
        res.status(404).send(error.message);
    }
});

// Endpoint to run static analysis on the entire project
app.post('/api/project/:projectId/analyze', async (req, res) => {
  const { projectId } = req.params;
  const projectPath = getProjectPath(projectId);
  const { files } = req.body; // Pass files from frontend to avoid re-reading dir

  if (!projectPath || !files) {
    return res.status(404).json({ error: 'Project not found or file list missing.' });
  }

  try {
    const diagnostics = await analyzeProject(projectPath, files);
    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred during analysis.' });
  }
});

// --- NEW ENDPOINT for Milestone 5: AI Explanation ---
app.post('/api/project/:projectId/explain', async (req, res) => {
    const { projectId } = req.params;
    const { diagnostic } = req.body;

    if (!diagnostic) {
        return res.status(400).json({ error: 'A "diagnostic" object is required in the request body.' });
    }

    const projectPath = getProjectPath(projectId);
    if (!projectPath) {
        return res.status(404).json({ error: 'Project not found.' });
    }

    try {
        // Step 1: Generate a detailed, contextual prompt for the AI model
        const prompt = await getAIContext(projectId, diagnostic);
        
        // Step 2: Send the prompt to the AI model and get the completion
        const explanation = await getAICompletion(prompt);

        // Step 3: Send the AI's response back to the client
        res.json({ explanation });
    } catch (error: any) {
        console.error('AI explanation failed:', error);
        res.status(500).json({ error: error.message });
    }
});


// --- MODIFIED SERVER STARTUP LOGIC ---
// This ensures the AI model is loaded and ready before the server accepts any requests.
console.log("Starting server...");
initializeAI().then(() => {
    app.listen(port, () => {
        console.log(`🚀 Server is fully initialized and listening at http://localhost:${port}`);
    });
}).catch(error => {
    console.error("Fatal: Server failed to start due to AI model initialization error.", error);
    process.exit(1); // Exit with an error code if the AI can't load
});