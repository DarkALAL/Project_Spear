// server/src/projectService.ts
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import unzipper from 'unzipper';

// --- DIRECTORIES ---
// Read from .env with safe fallbacks
const SERVER_DIR = path.resolve(__dirname, '..');
const UPLOADS_DIR = path.resolve(
  SERVER_DIR,
  process.env.UPLOADS_DIR || 'project_uploads'
);
const TEMP_UPLOADS_DIR = path.resolve(
  SERVER_DIR,
  process.env.TEMP_UPLOADS_DIR || 'temp_uploads'
);
const PROJECT_TTL_MS = parseInt(process.env.PROJECT_TTL_MS || '3600000'); // 1 hour default

// --- SUPPORTED FILE EXTENSIONS ---
// Add more here if you expand language support later
const SUPPORTED_EXTENSIONS = ['.c', '.h', '.py'];

// --- IN-MEMORY PROJECT STORE ---
// Maps projectId -> absolute path on disk
// NOTE: This is cleared on server restart. Fine for a local/college project.
// For production, replace with a database or Redis.
const projectStore = new Map<string, string>();

// --- ENSURE BASE DIRECTORIES EXIST ---
// Run at module load time so we never get ENOENT on first upload
(async () => {
  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });
  await fs.promises.mkdir(TEMP_UPLOADS_DIR, { recursive: true });
})();

// ─────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────

/**
 * getProjectFiles()
 *
 * Recursively walks a directory and returns all file paths
 * that match SUPPORTED_EXTENSIONS, relative to baseDir.
 *
 * Skips hidden directories (e.g. .git, .vscode) and
 * common noise directories (node_modules, __pycache__).
 */
async function getProjectFiles(
  dir: string,
  baseDir: string = dir
): Promise<string[]> {
  const SKIP_DIRS = new Set([
    'node_modules',
    '__pycache__',
    '.git',
    '.vscode',
    '.idea',
    'dist',
    'build',
    '.cache',
  ]);

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (err: any) {
    console.error(`Failed to read directory ${dir}:`, err.message);
    return [];
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      // Skip hidden entries and known noise directories
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
        return [];
      }

      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);

      if (entry.isDirectory()) {
        return getProjectFiles(fullPath, baseDir);
      }

      // Only include files with supported extensions
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        return [relativePath];
      }

      return [];
    })
  );

  return files.flat();
}

/**
 * scheduleProjectCleanup()
 *
 * Deletes the extracted project directory and removes it from
 * the store after PROJECT_TTL_MS milliseconds.
 */
function scheduleProjectCleanup(projectId: string, extractPath: string): void {
  setTimeout(async () => {
    try {
      await fs.promises.rm(extractPath, { recursive: true, force: true });
      projectStore.delete(projectId);
      console.log(`🗑️  Project ${projectId} cleaned up after TTL.`);
    } catch (err: any) {
      console.error(`Failed to clean up project ${projectId}:`, err.message);
    }
  }, PROJECT_TTL_MS);
}

/**
 * validateZipFile()
 *
 * Basic validation before we try to extract.
 * Checks the file exists and has a non-zero size.
 */
async function validateZipFile(filePath: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      throw new Error('Uploaded file is empty.');
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error('Uploaded file not found on server.');
    }
    throw err;
  }
}

// ─────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────

/**
 * handleFileUpload()
 *
 * Takes the temp file path written by multer, extracts it as a zip,
 * registers the project in memory, schedules cleanup, and returns
 * the projectId and list of supported source files.
 *
 * @param tempFilePath - Absolute path to the temp zip written by multer
 * @returns            - { projectId, files } where files are relative paths
 */
export async function handleFileUpload(
  tempFilePath: string
): Promise<{ projectId: string; files: string[] }> {
  await validateZipFile(tempFilePath);

  const projectId = uuidv4();
  const extractPath = path.join(UPLOADS_DIR, projectId);

  await fs.promises.mkdir(extractPath, { recursive: true });

  try {
    // Extract the zip into the project directory
    await fs.createReadStream(tempFilePath)
      .pipe(unzipper.Extract({ path: extractPath }))
      .promise();
  } catch (err: any) {
    // Clean up the directory if extraction failed
    await fs.promises.rm(extractPath, { recursive: true, force: true });
    throw new Error(`Failed to extract zip file: ${err.message}`);
  } finally {
    // Always delete the temp file uploaded by multer, success or failure
    await fs.promises.unlink(tempFilePath).catch((err) => {
      console.warn(`Could not delete temp file ${tempFilePath}:`, err.message);
    });
  }

  // Get all supported source files from the extracted project
  const files = await getProjectFiles(extractPath);

  if (files.length === 0) {
    // Clean up and tell the user — no point keeping an empty project
    await fs.promises.rm(extractPath, { recursive: true, force: true });
    throw new Error(
      'No supported source files found in the uploaded zip.\n' +
      `Supported file types: ${SUPPORTED_EXTENSIONS.join(', ')}`
    );
  }

  // Register project in memory
  projectStore.set(projectId, extractPath);

  // Schedule automatic cleanup after TTL
  scheduleProjectCleanup(projectId, extractPath);

  console.log(
    `📦 Project ${projectId} uploaded: ${files.length} file(s) found.`
  );

  return { projectId, files };
}

/**
 * getProjectPath()
 *
 * Returns the absolute path on disk for a given projectId,
 * or undefined if the project doesn't exist / has expired.
 */
export function getProjectPath(projectId: string): string | undefined {
  return projectStore.get(projectId);
}

/**
 * getFileContent()
 *
 * Safely reads and returns the content of a file within a project.
 * Includes path traversal protection — rejects any path that
 * tries to escape outside the project directory.
 *
 * @param projectId - The project session ID
 * @param filePath  - Relative path to the file within the project
 * @returns         - File contents as a UTF-8 string
 */
export async function getFileContent(
  projectId: string,
  filePath: string
): Promise<string> {
  const projectPath = getProjectPath(projectId);
  if (!projectPath) {
    throw new Error(`Project not found or session expired: ${projectId}`);
  }

  // Resolve the full path and verify it stays within the project directory
  // This prevents directory traversal attacks like ../../etc/passwd
  const resolvedPath = path.resolve(projectPath, filePath);
  if (!resolvedPath.startsWith(projectPath + path.sep)) {
    throw new Error(
      `Access denied: "${filePath}" is outside the project directory.`
    );
  }

  // Check the file actually exists before reading
  try {
    await fs.promises.access(resolvedPath, fs.constants.R_OK);
  } catch {
    throw new Error(`File not found or not readable: ${filePath}`);
  }

  return fs.promises.readFile(resolvedPath, 'utf-8');
}

/**
 * listProjects()
 *
 * Returns all currently active projectIds.
 * Useful for debugging / admin tooling.
 */
export function listProjects(): string[] {
  return Array.from(projectStore.keys());
}