// server/src/projectService.ts
import fs from 'fs'; // Import the main 'fs' module
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import unzipper from 'unzipper';

const UPLOADS_DIR = path.join(__dirname, '..', 'project_uploads');
// Use the promises API from the main fs module
fs.promises.mkdir(UPLOADS_DIR, { recursive: true });

// In-memory store for project paths. In a real app, use a database.
const projectStore = new Map<string, string>();

async function getProjectFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      if (entry.isDirectory()) {
        return getProjectFiles(fullPath, baseDir);
      }
      // Filter for only C and Python files
      if (entry.name.endsWith('.c') || entry.name.endsWith('.py')) {
        return [relativePath];
      }
      return [];
    })
  );
  return files.flat();
}

export async function handleFileUpload(filePath: string): Promise<{ projectId: string; files: string[] }> {
  const projectId = uuidv4();
  const extractPath = path.join(UPLOADS_DIR, projectId);
  await fs.promises.mkdir(extractPath, { recursive: true });

  // CORRECTED: Use fs.createReadStream from the main module
  await fs.createReadStream(filePath).pipe(unzipper.Extract({ path: extractPath })).promise();
  
  // Use the promises API for file operations
  await fs.promises.unlink(filePath);

  const files = await getProjectFiles(extractPath);
  projectStore.set(projectId, extractPath);

  // Optional: Clean up old projects after some time
  setTimeout(() => {
    fs.promises.rm(extractPath, { recursive: true, force: true });
    projectStore.delete(projectId);
  }, 3600 * 1000); // Cleanup after 1 hour

  return { projectId, files };
}

export function getProjectPath(projectId: string): string | undefined {
  return projectStore.get(projectId);
}

export async function getFileContent(projectId: string, filePath: string): Promise<string> {
    const projectPath = getProjectPath(projectId);
    if (!projectPath) throw new Error('Project not found');

    // SECURITY: Prevent directory traversal attacks
    const safeFilePath = path.join(projectPath, filePath);
    if (!safeFilePath.startsWith(projectPath)) {
        throw new Error('Access denied: Invalid file path');
    }
    
    // Use the promises API for reading files
    return await fs.promises.readFile(safeFilePath, 'utf-8');
}