// server/src/index.ts
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';

import { analyzeProject } from './analysisService'; // Updated service
import { handleFileUpload, getProjectPath, getFileContent } from './projectService'; // New service

const app = express();
const port = 3001;
const upload = multer({ dest: 'temp_uploads/' });

app.use(cors());
app.use(express.json());

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

// Endpoint to analyze the entire project
app.post('/api/project/:projectId/analyze', async (req, res) => {
  const { projectId } = req.params;
  const projectPath = getProjectPath(projectId);

  if (!projectPath) {
    return res.status(404).json({ error: 'Project not found.' });
  }

  try {
    const diagnostics = await analyzeProject(projectPath);
    res.json(diagnostics);
  } catch (error) {
    res.status(500).json({ error: 'An error occurred during analysis.' });
  }
});

app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});