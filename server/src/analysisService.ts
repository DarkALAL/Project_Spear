// server/src/analysisService.ts
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

// --- Updated Diagnostic Interface ---
export interface Diagnostic {
  filePath: string; // REQUIRED: The relative path to the file
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

// --- Helper function to find all C and Python files in a directory ---
async function getProjectFiles(dir: string, baseDir: string = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(baseDir, fullPath);
      if (entry.isDirectory()) {
        return getProjectFiles(fullPath, baseDir);
      }
      if (entry.name.endsWith('.c') || entry.name.endsWith('.py')) {
        return [relativePath];
      }
      return [];
    })
  );
  return files.flat();
}

// --- Helper function to run any command ---
function runCommand(command: string): Promise<string> {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      // Many tools output to stderr by default. We resolve with the output regardless of exit code.
      resolve(stdout || stderr);
    });
  });
}


// --- Individual Analyzer Functions (largely unchanged, they still operate on a single file path) ---
// Note: They no longer need to add the filePath property themselves.
async function runPylint(filePath: string): Promise<Omit<Diagnostic, 'filePath'>[]> {
  const output = await runCommand(`pylint --msg-template="{line}:{column}:{msg_id}:{msg}" ${filePath}`);
  const diagnostics: Omit<Diagnostic, 'filePath'>[] = [];
  const regex = /^(\d+):(\d+):([A-Z]\d{4}):(.*)/;
  for (const line of output.split('\n')) {
    const match = line.match(regex);
    if (match) {
      diagnostics.push({
        line: parseInt(match[1]),
        column: parseInt(match[2]),
        message: `[${match[3]}] ${match[4].trim()}`,
        severity: match[3].startsWith('E') || match[3].startsWith('F') ? 'error' : 'warning',
        source: 'Pylint',
      });
    }
  }
  return diagnostics;
}

async function runFlake8(filePath: string): Promise<Omit<Diagnostic, 'filePath'>[]> {
    const output = await runCommand(`flake8 --format="%(row)d:%(col)d:%(code)s:%(text)s" ${filePath}`);
    const diagnostics: Omit<Diagnostic, 'filePath'>[] = [];
    const regex = /^(\d+):(\d+):([A-Z]\d+):(.*)/;
    for (const line of output.split('\n')) {
        const match = line.match(regex);
        if (match) {
            diagnostics.push({
                line: parseInt(match[1]),
                column: parseInt(match[2]),
                message: `[${match[3]}] ${match[4].trim()}`,
                severity: match[3].startsWith('E') ? 'error' : 'warning',
                source: 'Flake8',
            });
        }
    }
    return diagnostics;
}

async function runBandit(filePath: string): Promise<Omit<Diagnostic, 'filePath'>[]> {
    // FIX: Removed the '-r' flag. Now it correctly scans a single file.
    const output = await runCommand(`bandit -f json ${filePath}`); 
    const diagnostics: Omit<Diagnostic, 'filePath'>[] = [];
    try {
        const results = JSON.parse(output);
        // This part remains the same
        for (const issue of results.results) {
            diagnostics.push({
                line: issue.line_number,
                column: issue.col_offset,
                message: `[${issue.test_id}] ${issue.issue_text}`,
                severity: issue.issue_severity === 'HIGH' || issue.issue_severity === 'MEDIUM' ? 'error' : 'warning',
                source: 'Bandit',
            });
        }
    } catch (e) { /* Ignore parsing errors */ }
    return diagnostics;
}

async function runCppcheck(filePath: string): Promise<Omit<Diagnostic, 'filePath'>[]> {
  const output = await runCommand(`cppcheck --enable=all --template="{file}:{line}:{column}:{severity}:{message}" ${filePath}`);
  const diagnostics: Omit<Diagnostic, 'filePath'>[] = [];
  const regex = /^(.+):(\d+):(\d+):(\w+):(.+)/;
  for (const line of output.split('\n')) {
    const match = line.match(regex);
    if (match) {
      diagnostics.push({
        line: parseInt(match[2]),
        column: parseInt(match[3]),
        message: match[5].trim(),
        severity: match[4] === 'error' ? 'error' : 'warning',
        source: 'Cppcheck',
      });
    }
  }
  return diagnostics;
}

async function runClangTidy(filePath: string): Promise<Omit<Diagnostic, 'filePath'>[]> {
    // Note: Clang-Tidy requires a compilation database for accurate checks on complex projects.
    // The '--' tells clang-tidy that no more flags are coming and the rest are file names.
    const output = await runCommand(`clang-tidy ${filePath} --`);
    const diagnostics: Omit<Diagnostic, 'filePath'>[] = [];
    const regex = /.+:(\d+):(\d+):\s+(warning|error):\s+(.*)\[(.*)\]/;
    for (const line of output.split('\n')) {
        const match = line.match(regex);
        if (match) {
            diagnostics.push({
                line: parseInt(match[1]),
                column: parseInt(match[2]),
                message: `[${match[5]}] ${match[4].trim()}`,
                severity: match[3] === 'error' ? 'error' : 'warning',
                source: 'Clang-Tidy',
            });
        }
    }
    return diagnostics;
}

// --- NEW Main Project Analysis Function ---
export async function analyzeProject(projectPath: string): Promise<Diagnostic[]> {
  const files = await getProjectFiles(projectPath);
  let allDiagnostics: Diagnostic[] = [];

  for (const file of files) {
    const fullPath = path.join(projectPath, file);
    let analysisPromises: Promise<Omit<Diagnostic, 'filePath'>[]>[] = [];

    if (file.endsWith('.py')) {
      analysisPromises = [runPylint(fullPath), runFlake8(fullPath), runBandit(fullPath)];
    } else if (file.endsWith('.c')) {
      analysisPromises = [runCppcheck(fullPath), runClangTidy(fullPath)];
    }

    if (analysisPromises.length > 0) {
        const results = await Promise.all(analysisPromises);
        // Add the relative filePath to each diagnostic and flatten the array
        const fileDiagnostics = results.flat().map(d => ({ ...d, filePath: file }));
        allDiagnostics.push(...fileDiagnostics);
    }
  }

  // Deduplicate diagnostics based on file, line, and message
  const uniqueDiagnostics = new Map<string, Diagnostic>();
  for (const diag of allDiagnostics) {
    const key = `${diag.filePath}:${diag.line}:${diag.message}`;
    if (!uniqueDiagnostics.has(key)) {
      uniqueDiagnostics.set(key, diag);
    }
  }
  
  // Sort by file path first, then by line number for a clean report
  return Array.from(uniqueDiagnostics.values()).sort((a,b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    return a.line - b.line;
  });
}