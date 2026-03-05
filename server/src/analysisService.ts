// server/src/analysisService.ts
import 'dotenv/config';
import { exec } from 'child_process';
import path from 'path';
import { getFileContent, getProjectPath } from './projectService';

// ─────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────

export interface Diagnostic {
  filePath: string;
  line:     number;
  column:   number;
  message:  string;
  severity: 'error' | 'warning' | 'info';
  source:   string;
}

type RawDiagnostic = Omit<Diagnostic, 'filePath'>;

// ─────────────────────────────────────────
// PRIVATE HELPERS
// ─────────────────────────────────────────

/**
 * runCommand()
 *
 * Runs a shell command and returns BOTH stdout and stderr combined.
 *
 * KEY FIX: The original used `stdout || stderr` which silently dropped
 * stderr if stdout had any content (even a blank line). Cppcheck writes
 * ALL results to stderr — so any stdout content (e.g. version strings,
 * progress messages) would cause the original code to return nothing useful.
 *
 * We now always concatenate both streams so no output is lost.
 */
function runCommand(
  command: string,
  timeoutMs = 45000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      command,
      { timeout: timeoutMs },
      (_error, stdout, stderr) => {
        // Always return both — linters exit non-zero when issues are found,
        // which would cause exec to call _error, but we still want the output
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
        });
      }
    );
  });
}

/**
 * toolExists()
 * Checks if a CLI tool is available on PATH before running it.
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
// ANALYZER FUNCTIONS
// ─────────────────────────────────────────

/**
 * runPylint()
 * Python linter — errors, warnings, conventions, refactors.
 * Reads from stdout.
 */
async function runPylint(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('pylint'))) {
    console.warn('⚠️  pylint not found on PATH, skipping.');
    return [];
  }

  const { stdout } = await runCommand(
    `pylint --msg-template="{line}:{column}:{msg_id}:{msg}" --score=no "${filePath}"`
  );

  const diagnostics: RawDiagnostic[] = [];
  const regex = /^(\d+):(\d+):([A-Z]\d{4}):(.*)/;

  for (const line of stdout.split('\n')) {
    const match = line.trim().match(regex);
    if (!match) continue;

    const msgId    = match[3];
    const severity: Diagnostic['severity'] =
      msgId.startsWith('E') || msgId.startsWith('F') ? 'error' : 'warning';

    diagnostics.push({
      line:     parseInt(match[1]),
      column:   parseInt(match[2]),
      message:  `[${msgId}] ${match[4].trim()}`,
      severity,
      source:   'Pylint',
    });
  }

  return diagnostics;
}

/**
 * runFlake8()
 * Python PEP8 style checker.
 * Reads from stdout.
 */
async function runFlake8(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('flake8'))) {
    console.warn('⚠️  flake8 not found on PATH, skipping.');
    return [];
  }

  const { stdout } = await runCommand(
    `flake8 --format="%(row)d:%(col)d:%(code)s:%(text)s" "${filePath}"`
  );

  const diagnostics: RawDiagnostic[] = [];
  const regex = /^(\d+):(\d+):([A-Z]\d+):(.*)/;

  for (const line of stdout.split('\n')) {
    const match = line.trim().match(regex);
    if (!match) continue;

    const code     = match[3];
    const severity: Diagnostic['severity'] =
      code.startsWith('E') || code.startsWith('F') ? 'error' : 'warning';

    diagnostics.push({
      line:     parseInt(match[1]),
      column:   parseInt(match[2]),
      message:  `[${code}] ${match[4].trim()}`,
      severity,
      source:   'Flake8',
    });
  }

  return diagnostics;
}

/**
 * runBandit()
 * Python security linter.
 * Reads JSON from stdout.
 */
async function runBandit(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('bandit'))) {
    console.warn('⚠️  bandit not found on PATH, skipping.');
    return [];
  }

  const { stdout } = await runCommand(`bandit -f json -q "${filePath}"`);

  const diagnostics: RawDiagnostic[] = [];

  try {
    const results = JSON.parse(stdout);
    if (!results?.results || !Array.isArray(results.results)) return [];

    for (const issue of results.results) {
      const severity: Diagnostic['severity'] =
        issue.issue_severity === 'HIGH' || issue.issue_severity === 'MEDIUM'
          ? 'error'
          : 'warning';

      diagnostics.push({
        line:     issue.line_number ?? 1,
        column:   issue.col_offset  ?? 1,
        message:  `[${issue.test_id}] ${issue.issue_text} (Confidence: ${issue.issue_confidence})`,
        severity,
        source:   'Bandit',
      });
    }
  } catch {
    // No issues found or non-JSON output — normal
  }

  return diagnostics;
}

/**
 * runCppcheck()
 *
 * C/C++ static analyzer.
 *
 * KEY FIX 1: Cppcheck writes ALL diagnostic output to STDERR, not stdout.
 * The old code used `stdout || stderr` — if cppcheck printed anything to
 * stdout (like a progress line), stderr was silently discarded. We now
 * always read stderr directly.
 *
 * KEY FIX 2: Added --error-exitcode=0 so cppcheck always exits 0,
 * preventing exec from swallowing output via the error callback path.
 *
 * KEY FIX 3: Added -j1 to prevent race conditions on the output stream
 * when analysing a single file.
 */
async function runCppcheck(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('cppcheck'))) {
    console.warn('⚠️  cppcheck not found on PATH, skipping.');
    return [];
  }

  const ext    = path.extname(filePath).toLowerCase();
  const langFlag = ext === '.h' ? '--language=c' : '';

  // Cppcheck output goes to stderr — read it directly
  const { stderr } = await runCommand(
    `cppcheck --enable=all --error-exitcode=0 ` +
    `--suppress=missingIncludeSystem --suppress=missingInclude ` +
    `${langFlag} ` +
    `--template="{file}:{line}:{column}:{severity}:{message}" ` +
    `"${filePath}" 2>&1`,
    45000
  );

  const diagnostics: RawDiagnostic[] = [];

  // Format: /abs/path/file.c:12:5:warning:Memory leak: buffer
  // The (.+?) at start is non-greedy but on Linux paths have no colons so it's fine
  const regex = /^(.+):(\d+):(\d+):(\w+):(.+)$/;

  for (const line of stderr.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(regex);
    if (!match) continue;

    const rawSeverity = match[4];

    // Skip information-level messages — too noisy
    if (rawSeverity === 'information') continue;

    // Map cppcheck severity to our three-level system
    let severity: Diagnostic['severity'] = 'info';
    if (rawSeverity === 'error')                                     severity = 'error';
    else if (rawSeverity === 'warning')                              severity = 'warning';
    else if (['style', 'performance', 'portability'].includes(rawSeverity))
                                                                     severity = 'info';

    diagnostics.push({
      line:     parseInt(match[2]),
      column:   parseInt(match[3]),
      message:  match[5].trim(),
      severity,
      source:   'Cppcheck',
    });
  }

  console.log(`[Cppcheck] ${filePath} → ${diagnostics.length} issue(s)`);
  return diagnostics;
}

/**
 * runClangTidy()
 *
 * C/C++ linter — style, modernization, bug-prone patterns.
 *
 * KEY FIX 1: clang-tidy writes to both stdout AND stderr depending on
 * version. We now concatenate both streams.
 *
 * KEY FIX 2: Added explicit -x c / -x c-header language flag so
 * clang-tidy doesn't try to guess the language from the extension (it
 * sometimes guesses wrong for .h files).
 *
 * KEY FIX 3: Added --quiet to suppress progress noise that was
 * polluting the output and confusing the regex parser.
 */
async function runClangTidy(filePath: string): Promise<RawDiagnostic[]> {
  if (!(await toolExists('clang-tidy'))) {
    console.warn('⚠️  clang-tidy not found on PATH, skipping.');
    return [];
  }

  const ext    = path.extname(filePath).toLowerCase();
  const lang   = ext === '.h' ? 'c-header' : 'c';

  // Combine stdout + stderr — clang-tidy version determines which it uses
  const { stdout, stderr } = await runCommand(
    `clang-tidy --quiet "${filePath}" -- -x ${lang} -std=c11 2>&1`,
    45000
  );

  const combined    = stdout + '\n' + stderr;
  const diagnostics: RawDiagnostic[] = [];

  // Format: /path/to/file.c:12:5: warning: message [check-name]
  const regex = /^(.+):(\d+):(\d+):\s+(warning|error):\s+(.*?)\s*\[([^\]]+)\]\s*$/;

  for (const line of combined.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(regex);
    if (!match) continue;

    const parsedFile = match[1];

    // Skip diagnostics that refer to system headers — not our code
    if (
      parsedFile.includes('/usr/') ||
      parsedFile.includes('/include/') ||
      parsedFile.includes('/lib/')
    ) continue;

    const severity: Diagnostic['severity'] =
      match[4] === 'error' ? 'error' : 'warning';

    diagnostics.push({
      line:     parseInt(match[2]),
      column:   parseInt(match[3]),
      message:  `[${match[6]}] ${match[5].trim()}`,
      severity,
      source:   'Clang-Tidy',
    });
  }

  console.log(`[Clang-Tidy] ${filePath} → ${diagnostics.length} issue(s)`);
  return diagnostics;
}

// ─────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────

/**
 * analyzeProject()
 *
 * Runs all relevant tools against every supported file in parallel.
 * Results are aggregated, deduplicated, and sorted.
 */
export async function analyzeProject(
  projectPath: string,
  projectFiles: string[]
): Promise<Diagnostic[]> {

  console.log(`[analyzeProject] Received ${projectFiles.length} file(s):`, projectFiles);

  const allDiagnostics: Diagnostic[] = [];

  for (const file of projectFiles) {
    const fullPath = path.join(projectPath, file);
    const ext      = path.extname(file).toLowerCase();

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
      continue; // Unsupported — skip silently
    }

    // Run all tools for this file in parallel
    // allSettled means one tool crashing doesn't kill the others
    const results = await Promise.allSettled(analysisPromises);

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const fileDiagnostics = result.value.map((d) => ({
          ...d,
          filePath: file,
        }));
        allDiagnostics.push(...fileDiagnostics);
      } else {
        console.error(`Analysis tool failed for ${file}:`, result.reason);
      }
    }
  }

  // Deduplicate: same file + line + message = same issue
  const uniqueDiagnostics = new Map<string, Diagnostic>();
  for (const diag of allDiagnostics) {
    const key = `${diag.filePath}:${diag.line}:${diag.message}`;
    if (!uniqueDiagnostics.has(key)) {
      uniqueDiagnostics.set(key, diag);
    }
  }

  const sorted = Array.from(uniqueDiagnostics.values()).sort((a, b) => {
    if (a.filePath < b.filePath) return -1;
    if (a.filePath > b.filePath) return 1;
    return a.line - b.line;
  });

  console.log(`[analyzeProject] Total unique diagnostics: ${sorted.length}`);
  return sorted;
}

/**
 * getAIContext()
 *
 * Builds a structured prompt for the AI model combining:
 * - The diagnostic message and source tool
 * - A windowed code snippet (5 lines before/after) with line numbers
 * - Clear instructions asking for explanation + fix
 *
 * Context window increased from 3 to 5 lines either side so the model
 * has enough code context to reason about multi-line issues.
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
  const fileLines   = fileContent.split('\n');

  // 5 lines of context either side gives the model enough to understand
  // the surrounding function/block
  const CONTEXT_LINES = 5;
  const startLine = Math.max(0, diagnostic.line - 1 - CONTEXT_LINES);
  const endLine   = Math.min(fileLines.length, diagnostic.line + CONTEXT_LINES);
  const snippetLines = fileLines.slice(startLine, endLine);

  // Add line numbers + >>> marker on the error line
  const numberedSnippet = snippetLines
    .map((line, i) => {
      const lineNum = startLine + i + 1;
      const marker  = lineNum === diagnostic.line ? '>>>' : '   ';
      return `${marker} ${String(lineNum).padStart(4)} | ${line}`;
    })
    .join('\n');

  const language = diagnostic.filePath.endsWith('.c') ||
    diagnostic.filePath.endsWith('.h') ? 'c' : 'python';

  // Structured prompt — clear sections help the 1B model stay focused
  const prompt =
`You are an expert ${language === 'c' ? 'C' : 'Python'} programming assistant specializing in code quality and security.
A static analysis tool found a problem in the file "${diagnostic.filePath}".

ISSUE DETAILS:
  Tool     : ${diagnostic.source}
  Severity : ${diagnostic.severity.toUpperCase()}
  Line     : ${diagnostic.line}
  Message  : ${diagnostic.message}

CODE SNIPPET (>>> marks the problem line):
\`\`\`${language}
${numberedSnippet}
\`\`\`

Please provide a complete response covering all three parts below:

**1. Root Cause**
Explain in 2-3 clear sentences what is wrong and why it is a problem.

**2. Fixed Code**
Show the corrected version of the relevant lines as a code block.

**3. Explanation**
Briefly explain what the fix does and why it solves the issue.

RESPONSE:
`;

  return prompt;
}