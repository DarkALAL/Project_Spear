// server/src/analysisService.ts
import 'dotenv/config';
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { getFileContent, getProjectPath } from './projectService';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

export interface Diagnostic {
  filePath: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: string;
}

// Diagnostic without filePath — used internally before we attach the file path
type RawDiagnostic = Omit<Diagnostic, 'filePath'>;

// ─────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────

/**
 * runCommand()
 *
 * Runs a shell command and returns stdout + stderr combined.
 * Never rejects — linters return non-zero exit codes when they
 * find issues, which would cause exec to call the error callback.
 * We always want the output regardless of exit code.
 *
 * @param command - The shell command to run
 * @param timeoutMs - Max time to wait before killing the process (default 30s)
 */
function runCommand(command: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs },
      (_error, stdout, stderr) => {
        // Return whichever stream has content
        // Some tools write to stderr (e.g. cppcheck), others to stdout
        resolve(stdout || stderr || '');
      }
    );
  });
}

/**
 * toolExists()
 *
 * Checks if a CLI tool is available on PATH before trying to run it.
 * Prevents cryptic errors if a tool isn't installed.
 */
async function toolExists(toolName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const checkCmd = process.platform === 'win32'
      ? `where ${toolName}`
      : `which ${toolName}`;
    exec(checkCmd, (error) => resolve(!error));
  });
}

// ─────────────────────────────────────────
// INDIVIDUAL ANALYZER FUNCTIONS
// ─────────────────────────────────────────

/**
 * runPylint()
 * Python linter — checks for errors, warnings, conventions, and refactors.
 * Requires: pip install pylint
 */
async function runPylint(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('pylint'))) {
    console.warn('⚠️  pylint not found on PATH, skipping.');
    return [];
  }

  const output = await runCommand(
    `pylint --msg-template="{line}:{column}:{msg_id}:{msg}" --score=no "${filePath}"`
  );

  const diagnostics: RawDiagnostic[] = [];
  // Format: line:column:MSG_ID:message text
  const regex = /^(\d+):(\d+):([A-Z]\d{4}):(.*)/;

  for (const line of output.split('\n')) {
    const match = line.trim().match(regex);
    if (!match) continue;

    const msgId = match[3];
    // C = convention, R = refactor, W = warning, E = error, F = fatal
    const severity: Diagnostic['severity'] =
      msgId.startsWith('E') || msgId.startsWith('F') ? 'error' : 'warning';

    diagnostics.push({
      line: parseInt(match[1]),
      column: parseInt(match[2]),
      message: `[${msgId}] ${match[4].trim()}`,
      severity,
      source: 'Pylint',
    });
  }

  return diagnostics;
}

/**
 * runFlake8()
 * Python style checker — PEP8 compliance, unused imports, undefined names.
 * Requires: pip install flake8
 */
async function runFlake8(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('flake8'))) {
    console.warn('⚠️  flake8 not found on PATH, skipping.');
    return [];
  }

  const output = await runCommand(
    `flake8 --format="%(row)d:%(col)d:%(code)s:%(text)s" "${filePath}"`
  );

  const diagnostics: RawDiagnostic[] = [];
  // Format: row:col:CODE:message
  const regex = /^(\d+):(\d+):([A-Z]\d+):(.*)/;

  for (const line of output.split('\n')) {
    const match = line.trim().match(regex);
    if (!match) continue;

    const code = match[3];
    // E = error, W = warning, F = pyflakes, C = complexity
    const severity: Diagnostic['severity'] =
      code.startsWith('E') || code.startsWith('F') ? 'error' : 'warning';

    diagnostics.push({
      line: parseInt(match[1]),
      column: parseInt(match[2]),
      message: `[${code}] ${match[4].trim()}`,
      severity,
      source: 'Flake8',
    });
  }

  return diagnostics;
}

/**
 * runBandit()
 * Python security linter — finds common security issues.
 * Requires: pip install bandit
 */
async function runBandit(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('bandit'))) {
    console.warn('⚠️  bandit not found on PATH, skipping.');
    return [];
  }

  const output = await runCommand(
    `bandit -f json -q "${filePath}"`
  );

  const diagnostics: RawDiagnostic[] = [];

  try {
    const results = JSON.parse(output);

    if (!results?.results || !Array.isArray(results.results)) {
      return [];
    }

    for (const issue of results.results) {
      // HIGH/MEDIUM severity = error, LOW = warning
      const severity: Diagnostic['severity'] =
        issue.issue_severity === 'HIGH' || issue.issue_severity === 'MEDIUM'
          ? 'error'
          : 'warning';

      diagnostics.push({
        line: issue.line_number ?? 1,
        column: issue.col_offset ?? 1,
        message: `[${issue.test_id}] ${issue.issue_text} (Confidence: ${issue.issue_confidence})`,
        severity,
        source: 'Bandit',
      });
    }
  } catch {
    // Bandit returned non-JSON (e.g. no issues found, or parse error)
    // This is normal — just return empty
  }

  return diagnostics;
}

/**
 * runCppcheck()
 * C/C++ static analyzer — memory leaks, null pointers, undefined behavior.
 * Requires: apt install cppcheck / brew install cppcheck
 */
async function runCppcheck(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('cppcheck'))) {
    console.warn('⚠️  cppcheck not found on PATH, skipping.');
    return [];
  }

  // cppcheck writes results to stderr by default
  const output = await runCommand(
    `cppcheck --enable=all --suppress=missingIncludeSystem ` +
    `--template="{file}:{line}:{column}:{severity}:{message}" "${filePath}"`
  );

  const diagnostics: RawDiagnostic[] = [];
  // Format: file:line:column:severity:message
  const regex = /^(.+):(\d+):(\d+):(\w+):(.+)/;

  for (const line of output.split('\n')) {
    const match = line.trim().match(regex);
    if (!match) continue;

    // Skip 'information' level messages — too noisy
    const rawSeverity = match[4];
    if (rawSeverity === 'information') continue;

    const severity: Diagnostic['severity'] =
      rawSeverity === 'error' ? 'error' : 'warning';

    diagnostics.push({
      line: parseInt(match[2]),
      column: parseInt(match[3]),
      message: match[5].trim(),
      severity,
      source: 'Cppcheck',
    });
  }

  return diagnostics;
}

/**
 * runClangTidy()
 * C/C++ linter — style, modernization, and bug-prone patterns.
 * Requires: apt install clang-tidy / brew install llvm
 */
async function runClangTidy(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('clang-tidy'))) {
    console.warn('⚠️  clang-tidy not found on PATH, skipping.');
    return [];
  }

  // The trailing '--' tells clang-tidy not to look for a compile_commands.json
  const output = await runCommand(
    `clang-tidy "${filePath}" --`
  );

  const diagnostics: RawDiagnostic[] = [];
  // Format: file.c:line:col: warning/error: message [check-name]
  const regex = /^.+:(\d+):(\d+):\s+(warning|error):\s+(.*)\[([^\]]+)\]/;

  for (const line of output.split('\n')) {
    const match = line.trim().match(regex);
    if (!match) continue;

    const severity: Diagnostic['severity'] =
      match[3] === 'error' ? 'error' : 'warning';

    diagnostics.push({
      line: parseInt(match[1]),
      column: parseInt(match[2]),
      message: `[${match[5]}] ${match[4].trim()}`,
      severity,
      source: 'Clang-Tidy',
    });
  }

  return diagnostics;
}

// ─────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────

/**
 * analyzeProject()
 *
 * Runs all relevant static analysis tools against every supported file
 * in the project. Tools for the same file run in parallel to maximize speed.
 *
 * Results are aggregated across all files, deduplicated by
 * (filePath + line + message), and sorted by file then line number.
 *
 * @param projectPath  - Absolute path to the extracted project directory
 * @param projectFiles - Relative file paths to analyze (from projectService)
 * @returns            - Sorted, deduplicated array of Diagnostic objects
 */
export async function analyzeProject(
  projectPath: string,
  projectFiles: string[]
): Promise<Diagnostic[]> {
  const allDiagnostics: Diagnostic[] = [];

  for (const file of projectFiles) {
    const fullPath = path.join(projectPath, file);
    const ext = path.extname(file).toLowerCase();

    let analysisPromises: Promise<RawDiagnostic[]>[] = [];

    if (ext === '.py') {
      analysisPromises = [
        runPylint(fullPath),
        runFlake8(fullPath),
        runBandit(fullPath),
      ];
    } else if (ext === '.c' || ext === '.h') {
      analysisPromises = [
        runCppcheck(fullPath),
        runClangTidy(fullPath),
      ];
    } else {
      // Unsupported file type — skip silently
      continue;
    }

    // Run all tools for this file in parallel
    const results = await Promise.allSettled(analysisPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        // Attach the relative filePath to each raw diagnostic
        const fileDiagnostics = result.value.map((d) => ({
          ...d,
          filePath: file,
        }));
        allDiagnostics.push(...fileDiagnostics);
      } else {
        // One tool failed — log it but continue with others
        console.error(`Analysis tool failed for ${file}:`, result.reason);
      }
    }
  }

  // Deduplicate by filePath + line + message
  // This handles cases where multiple tools report the same issue
  const uniqueDiagnostics = new Map<string, Diagnostic>();
  for (const diag of allDiagnostics) {
    const key = `${diag.filePath}:${diag.line}:${diag.message}`;
    if (!uniqueDiagnostics.has(key)) {
      uniqueDiagnostics.set(key, diag);
    }
  }

  // Sort by file path first, then by line number within each file
  return Array.from(uniqueDiagnostics.values()).sort((a, b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    return a.line - b.line;
  });
}

/**
 * getAIContext()
 *
 * Builds a structured prompt for the AI model by combining:
 * - The diagnostic message and source tool
 * - A windowed code snippet (3 lines before and after the error line)
 * - Clear instructions for the model to explain and fix the issue
 *
 * @param projectId  - The project session ID
 * @param diagnostic - The diagnostic to explain
 * @returns          - A fully formatted prompt string ready for getAICompletion()
 */
export async function getAIContext(
  projectId: string,
  diagnostic: Diagnostic
): Promise<string> {
  const projectPath = getProjectPath(projectId);
  if (!projectPath) {
    throw new Error(`Project not found or session expired: ${projectId}`);
  }

  const fileContent = await getFileContent(projectId, diagnostic.filePath);
  const fileLines = fileContent.split('\n');

  // Build a windowed snippet around the error line
  // Show 3 lines before and 3 lines after for context
  const CONTEXT_LINES = 3;
  const startLine = Math.max(0, diagnostic.line - 1 - CONTEXT_LINES);
  const endLine = Math.min(fileLines.length, diagnostic.line + CONTEXT_LINES);
  const snippetLines = fileLines.slice(startLine, endLine);

  // Add line numbers to the snippet so the model can reference them clearly
  const numberedSnippet = snippetLines
    .map((line, i) => {
      const lineNum = startLine + i + 1;
      const marker = lineNum === diagnostic.line ? '>>>' : '   ';
      return `${marker} ${String(lineNum).padStart(4, ' ')} | ${line}`;
    })
    .join('\n');

  const language = diagnostic.filePath.endsWith('.c') ||
    diagnostic.filePath.endsWith('.h') ? 'c' : 'python';

  // Structured prompt — clear sections help the model stay on task
  const prompt =
`You are an expert ${language === 'c' ? 'C' : 'Python'} code analysis assistant.
A static analysis tool has found an issue in the file "${diagnostic.filePath}".

ISSUE DETAILS:
  Tool     : ${diagnostic.source}
  Severity : ${diagnostic.severity.toUpperCase()}
  Line     : ${diagnostic.line}
  Message  : ${diagnostic.message}

CODE SNIPPET (>>> marks the problem line):
\`\`\`${language}
${numberedSnippet}
\`\`\`

TASK:
1. Explain the root cause of this issue in simple, clear terms (2-3 sentences).
2. Show the corrected version of the code snippet.
3. Briefly explain what the fix does and why it prevents the issue.

EXPLANATION:
`;

  return prompt;
}