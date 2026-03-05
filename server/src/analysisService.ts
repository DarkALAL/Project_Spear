// server/src/analysisService.ts
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { getFileContent } from './projectService'; // Import from projectService

// --- Diagnostic Interface ---
export interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

// --- Helper function to find project files ---
// This is now imported from projectService, but if you need it here for some reason, it would go here.
// For now, we assume projectService is the source of truth for file listings.

// --- Helper function to run any command ---
function runCommand(command: string): Promise<string> {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      resolve(stdout || stderr);
    });
  });
}

// --- Individual Analyzer Functions ---
// (These functions remain unchanged from your provided code)
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
    const output = await runCommand(`bandit -f json ${filePath}`);
    const diagnostics: Omit<Diagnostic, 'filePath'>[] = [];
    try {
        const results = JSON.parse(output);
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


// --- Main Project Static Analysis Function ---
// This function does NOT change. It remains the source of truth for static analysis.
export async function analyzeProject(projectPath: string, projectFiles: string[]): Promise<Diagnostic[]> {
  let allDiagnostics: Diagnostic[] = [];

  for (const file of projectFiles) {
    const fullPath = path.join(projectPath, file);
    let analysisPromises: Promise<Omit<Diagnostic, 'filePath'>[]>[] = [];

    if (file.endsWith('.py')) {
      analysisPromises = [runPylint(fullPath), runFlake8(fullPath), runBandit(fullPath)];
    } else if (file.endsWith('.c')) {
      analysisPromises = [runCppcheck(fullPath), runClangTidy(fullPath)];
    }

    if (analysisPromises.length > 0) {
        const results = await Promise.all(analysisPromises);
        const fileDiagnostics = results.flat().map(d => ({ ...d, filePath: file }));
        allDiagnostics.push(...fileDiagnostics);
    }
  }

  const uniqueDiagnostics = new Map<string, Diagnostic>();
  for (const diag of allDiagnostics) {
    const key = `${diag.filePath}:${diag.line}:${diag.message}`;
    if (!uniqueDiagnostics.has(key)) {
      uniqueDiagnostics.set(key, diag);
    }
  }
  
  return Array.from(uniqueDiagnostics.values()).sort((a,b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    return a.line - b.line;
  });
}


// --- NEW FUNCTION for Milestone 5: Generate AI Prompts ---
export async function getAIContext(
  projectId: string, 
  diagnostic: Diagnostic // Use the full Diagnostic type
): Promise<string> {
  
  const fileContent = await getFileContent(projectId, diagnostic.filePath);
  const fileLines = fileContent.split('\n');
  
  // Get a snippet of code around the error line for context (e.g., 3 lines before, 3 lines after)
  const startLine = Math.max(0, diagnostic.line - 4);
  const endLine = Math.min(fileLines.length, diagnostic.line + 3);
  const codeSnippet = fileLines.slice(startLine, endLine).join('\n');

  // This is "Prompt Engineering". We create a highly structured prompt for the code model.
  const prompt = `
// You are an expert code analysis assistant.
// An error was found in the following code snippet from the file "${diagnostic.filePath}".

// ERROR:
// ${diagnostic.message} (Reported by: ${diagnostic.source})

// CODE SNIPPET (Error is on line ${diagnostic.line}):
\`\`\`${diagnostic.filePath.endsWith('.c') ? 'c' : 'python'}
${codeSnippet}
\`\`\`

// TASK:
// 1. Briefly explain the root cause of this specific error in simple terms.
// 2. Provide the corrected version of the code snippet.

// EXPLANATION:
`;

  return prompt;
}