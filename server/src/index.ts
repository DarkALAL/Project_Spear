// server/src/index.ts
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';

// Import all our services
import { analyzeProject, getAIContext } from './analysisService';
import { handleFileUpload, getProjectPath, getFileContent } from './projectService';
import { initializeAI, getAICompletion } from './aiService';

const app = express();
const port = parseInt(process.env.PORT || '3001');
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const tempUploadsDir = process.env.TEMP_UPLOADS_DIR || 'temp_uploads';

// --- MIDDLEWARE ---
app.use(cors({
  origin: clientOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

const upload = multer({ dest: tempUploadsDir });

// --- AI AVAILABILITY FLAG ---
// Tracks whether the AI model loaded successfully.
// All endpoints still work even if AI is unavailable.
let aiAvailable = false;

// --- HEALTH ENDPOINT ---
// Useful for checking if server + AI are up before using the UI.
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    ai: aiAvailable,
    timestamp: new Date().toISOString(),
  });
});

// --- ENDPOINT: Upload a project zip file ---
app.post('/api/upload', upload.single('project'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }
  try {
    const result = await handleFileUpload(req.file.path);
    res.json(result);
  } catch (error: any) {
    console.error('Upload failed:', error);
    res.status(500).json({ error: 'Failed to process upload.' });
  }
});

// --- ENDPOINT: Get content of a specific file in a project ---
app.get('/api/project/:projectId/file', async (req, res) => {
  const { projectId } = req.params;
  const { path: filePath } = req.query;

  if (typeof filePath !== 'string') {
    return res.status(400).json({ error: 'File path query parameter is required.' });
  }

  try {
    const content = await getFileContent(projectId, filePath);
    res.send(content);
  } catch (error: any) {
    console.error('File fetch failed:', error);
    res.status(404).json({ error: error.message });
  }
});

// --- ENDPOINT: Run static analysis on the entire project ---
app.post('/api/project/:projectId/analyze', async (req, res) => {
  const { projectId } = req.params;
  const { files } = req.body;

  if (!files || !Array.isArray(files)) {
    return res.status(400).json({ error: 'A "files" array is required in the request body.' });
  }

  const projectPath = getProjectPath(projectId);
  if (!projectPath) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  try {
    const diagnostics = await analyzeProject(projectPath, files);
    res.json(diagnostics);
  } catch (error: any) {
    console.error('Analysis failed:', error);
    res.status(500).json({ error: 'An error occurred during analysis.' });
  }
});

// --- ENDPOINT: AI Explanation for a diagnostic ---
app.post('/api/project/:projectId/explain', async (req, res) => {
  // Return a helpful message instead of crashing if model isn't loaded
  if (!aiAvailable) {
    return res.status(503).json({
      explanation:
        '⚠️ The AI model is not currently loaded.\n\n' +
        'To enable AI explanations:\n' +
        '1. Download Maincoder-1B-ONNX from HuggingFace\n' +
        '2. Place it in server/models/Maincoder-1B-ONNX/\n' +
        '3. Restart the server',
    });
  }

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
    // Step 1: Build a contextual prompt from the diagnostic + surrounding code
    const prompt = await getAIContext(projectId, diagnostic);

    // Step 2: Send to the local AI model
    const explanation = await getAICompletion(prompt);

    // Step 3: Return explanation to client
    res.json({ explanation });
  } catch (error: any) {
    console.error('AI explanation failed:', error);
    res.status(500).json({ error: `AI explanation failed: ${error.message}` });
  }
});

// --- 404 HANDLER for unknown routes ---
app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// --- SERVER STARTUP ---
// AI model loads in the background. Server starts regardless of model status.
console.log('Starting Project Spear server...');

initializeAI()
  .then(() => {
    aiAvailable = true;
    console.log('✅ AI model loaded successfully.');
  })
  .catch((err: Error) => {
    aiAvailable = false;
    console.warn('⚠️  AI model failed to load. AI features will be disabled.');
    console.warn('   Reason:', err.message);
    console.warn('   Static analysis features will still work normally.');
  })
  .finally(() => {
    app.listen(port, () => {
      console.log('─────────────────────────────────────────');
      console.log(`🚀 Server running at http://localhost:${port}`);
      console.log(`   CORS origin : ${clientOrigin}`);
      console.log(`   AI features : ${aiAvailable ? '✅ ENABLED' : '❌ DISABLED (model not found)'}`);
      console.log(`   Health check: http://localhost:${port}/health`);
      console.log('─────────────────────────────────────────');
    });
  });