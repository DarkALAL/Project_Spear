// server/src/aiService.ts
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { AutoTokenizer, AutoModelForCausalLM } from '@huggingface/transformers';

// ─────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────

const SERVER_DIR = path.resolve(__dirname, '..');
const MODEL_DIR  = process.env.MODEL_DIR
  ? path.resolve(SERVER_DIR, process.env.MODEL_DIR)
  : path.join(SERVER_DIR, 'models', 'Maincoder-1B-ONNX');

// ── Generation parameters ──
// MAX_NEW_TOKENS increased from 250 → 1024 so the model can finish
// its explanation without being cut off mid-sentence or mid-codeblock.
// TEMPERATURE slightly raised for more natural phrasing.
const MAX_NEW_TOKENS = 1024;
const TEMPERATURE    = 0.3;
const DO_SAMPLE      = true;

// cuDNN library path — where libcudnn.so.9 is installed
const CUDNN_LIB_PATH = '/usr/lib/x86_64-linux-gnu';

// ─────────────────────────────────────────
// LITERAL TYPES
// Matches exactly what @huggingface/transformers PretrainedModelOptions expects
// ─────────────────────────────────────────

type DeviceType =
  | 'cpu'
  | 'cuda'
  | 'auto'
  | 'gpu'
  | 'wasm'
  | 'webgpu'
  | 'dml'
  | 'webnn';

type DtypeType =
  | 'fp16'
  | 'fp32'
  | 'auto'
  | 'q8'
  | 'int8'
  | 'uint8'
  | 'q4'
  | 'bnb4'
  | 'q4f16';

// ─────────────────────────────────────────
// STATE
// ─────────────────────────────────────────

let tokenizer: any           = null;
let model: any               = null;
let activeDevice: DeviceType = 'cpu';

// ─────────────────────────────────────────
// LIBRARY PATH SETUP
// ─────────────────────────────────────────

/**
 * ensureLibraryPaths()
 *
 * Adds cuDNN and CUDA lib paths to LD_LIBRARY_PATH programmatically
 * so onnxruntime can find libcudnn.so.9 at runtime.
 *
 * Needed because WSL2 doesn't always pick up /etc/ld.so.conf.d changes
 * until the shell is fully restarted. Setting here guarantees it works.
 */
function ensureLibraryPaths(): void {
  const currentLdPath = process.env.LD_LIBRARY_PATH || '';

  if (!currentLdPath.includes(CUDNN_LIB_PATH)) {
    process.env.LD_LIBRARY_PATH = `${CUDNN_LIB_PATH}:${currentLdPath}`;
    console.log(`  📚 Added ${CUDNN_LIB_PATH} to LD_LIBRARY_PATH`);
  }

  const cudaLibPath = '/usr/local/cuda/lib64';
  if (!currentLdPath.includes(cudaLibPath) && fs.existsSync(cudaLibPath)) {
    process.env.LD_LIBRARY_PATH = `${cudaLibPath}:${process.env.LD_LIBRARY_PATH}`;
    console.log(`  📚 Added ${cudaLibPath} to LD_LIBRARY_PATH`);
  }
}

/**
 * verifyCudnnLibrary()
 * Checks libcudnn.so.9 is on disk before committing to CUDA.
 */
function verifyCudnnLibrary(): boolean {
  const cudnnPath = path.join(CUDNN_LIB_PATH, 'libcudnn.so.9');
  const exists    = fs.existsSync(cudnnPath);
  if (exists) {
    console.log(`  ✓ libcudnn.so.9 found at ${cudnnPath}`);
  } else {
    console.warn(`  ⚠️  libcudnn.so.9 not found at ${cudnnPath}`);
  }
  return exists;
}

// ─────────────────────────────────────────
// GPU DETECTION
// ─────────────────────────────────────────

function isCudaAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('nvidia-smi', (error) => resolve(!error));
  });
}

/**
 * getOptimalDevice()
 *
 * DEVICE env var overrides auto-detection:
 *   DEVICE=auto   → detect (default)
 *   DEVICE=cuda   → force GPU
 *   DEVICE=cpu    → force CPU
 */
async function getOptimalDevice(): Promise<DeviceType> {
  const envDevice = process.env.DEVICE?.toLowerCase().trim();

  if (envDevice === 'cpu') {
    console.log('  ℹ️  Device forced to CPU via DEVICE=cpu in .env');
    return 'cpu';
  }

  if (envDevice === 'cuda') {
    console.log('  ℹ️  Device forced to CUDA via DEVICE=cuda in .env');
    return 'cuda';
  }

  console.log('  🔍 Auto-detecting available device...');
  const gpuFound = await isCudaAvailable();

  if (!gpuFound) {
    console.log('  💻 No GPU detected — using CPU.');
    return 'cpu';
  }

  console.log('  🎮 NVIDIA GPU detected.');

  const cudnnFound = verifyCudnnLibrary();
  if (!cudnnFound) {
    console.warn(
      '  ⚠️  GPU found but libcudnn.so.9 is not accessible.\n' +
      '  Run: sudo apt install -y libcudnn9-cuda-12 && sudo ldconfig\n' +
      '  Falling back to CPU for this session.'
    );
    return 'cpu';
  }

  console.log('  ✅ GPU + cuDNN both available — using CUDA.');
  return 'cuda';
}

/**
 * getDtype()
 * Always fp32 — model only ships with fp32 ONNX file.
 * fp16 would require decoder_with_past_model_fp16.onnx (not included).
 */
function getDtype(_device: DeviceType): DtypeType {
  return 'fp32';
}

// ─────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────

function validateModelDirectory(): void {
  if (!fs.existsSync(MODEL_DIR)) {
    throw new Error(
      `Model directory not found at: ${MODEL_DIR}\n` +
      `Please download Maincoder-1B-ONNX from HuggingFace and place it at:\n` +
      `  server/models/Maincoder-1B-ONNX/\n\n` +
      `Required files:\n` +
      `  - tokenizer.json\n` +
      `  - decoder_with_past_model.onnx\n` +
      `  - decoder_with_past_model.onnx_data`
    );
  }

  const requiredFiles = [
    'tokenizer.json',
    'decoder_with_past_model.onnx',
  ];

  const missingFiles = requiredFiles.filter(
    (f) => !fs.existsSync(path.join(MODEL_DIR, f))
  );

  if (missingFiles.length > 0) {
    throw new Error(
      `Model directory found but missing required files:\n` +
      missingFiles.map((f) => `  - ${f}`).join('\n') + '\n' +
      `Please re-download the model from HuggingFace.`
    );
  }
}

// ─────────────────────────────────────────
// MODEL LOADER
// ─────────────────────────────────────────

async function loadModel(
  device: DeviceType,
  dtype: DtypeType
): Promise<void> {
  // Ensure library paths are set before loading — critical for CUDA
  ensureLibraryPaths();

  // For CPU: explicitly disable CUDA provider so onnxruntime doesn't
  // try to dlopen libonnxruntime_providers_cuda.so at all
  if (device === 'cpu') {
    process.env.ORT_DISABLE_CUDA     = '1';
    process.env.TRANSFORMERS_OFFLINE = '1';
  } else {
    // Clear ORT_DISABLE_CUDA in case it was set by a previous failed attempt
    delete process.env.ORT_DISABLE_CUDA;
  }

  console.log(`  Loading tokenizer...`);
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_DIR);
  console.log(`  ✓ Tokenizer loaded`);

  console.log(`  Loading ONNX model on ${device.toUpperCase()} (${dtype})...`);
  model = await AutoModelForCausalLM.from_pretrained(MODEL_DIR, {
    subfolder:                '.',
    model_file_name:          'decoder_with_past_model',
    use_external_data_format: true,
    device:                   device,
    dtype:                    dtype,
  });

  console.log(`  ✓ Model loaded on ${device.toUpperCase()} (${dtype})`);
  activeDevice = device;
}

// ─────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────

/**
 * initializeAI()
 *
 * Entry point called once on server startup.
 * Tries GPU first, falls back to CPU automatically if CUDA fails.
 * Server starts regardless — AI features just get disabled.
 */
export async function initializeAI(): Promise<void> {
  if (model && tokenizer) {
    console.log('AI model already initialized, skipping.');
    return;
  }

  validateModelDirectory();

  console.log(`\n📂 Model path : ${MODEL_DIR}`);
  ensureLibraryPaths();

  const preferredDevice = await getOptimalDevice();
  const dtype           = getDtype(preferredDevice);

  console.log(`  Target device : ${preferredDevice.toUpperCase()}`);
  console.log(`  dtype         : ${dtype}`);
  console.log(`  MAX_NEW_TOKENS: ${MAX_NEW_TOKENS}`);
  console.log(`  This may take 30–60 seconds on first load...`);

  // ── Attempt 1: preferred device ──
  try {
    await loadModel(preferredDevice, dtype);
    return;

  } catch (primaryErr: any) {

    // ── Attempt 2: CPU fallback (only if preferred was CUDA) ──
    if (preferredDevice === 'cuda') {
      console.warn(`\n  ⚠️  CUDA load failed: ${primaryErr?.message}`);
      console.warn('  ↩️  Retrying on CPU (fp32)...\n');

      tokenizer = null;
      model     = null;

      try {
        await loadModel('cpu', 'fp32');
        console.warn(
          '\n  ⚠️  Running on CPU fallback.\n' +
          '  To fix GPU: sudo apt install -y libcudnn9-cuda-12 && sudo ldconfig'
        );
        return;

      } catch (fallbackErr: any) {
        tokenizer = null;
        model     = null;
        throw new Error(
          `Failed to load model on both CUDA and CPU.\n` +
          `  CUDA error : ${primaryErr?.message}\n` +
          `  CPU error  : ${fallbackErr?.message}`
        );
      }
    }

    tokenizer = null;
    model     = null;
    throw new Error(`Failed to load model on CPU: ${primaryErr?.message}`);
  }
}

/**
 * getAICompletion()
 *
 * Tokenizes prompt → runs inference → decodes → strips echoed prompt.
 * MAX_NEW_TOKENS is now 1024 so full explanations + code blocks fit.
 */
export async function getAICompletion(prompt: string): Promise<string> {
  if (!model || !tokenizer) {
    throw new Error(
      'AI model is not initialized. ' +
      'Ensure initializeAI() completed successfully before calling getAICompletion().'
    );
  }

  if (!prompt?.trim()) {
    throw new Error('Prompt cannot be empty.');
  }

  try {
    const inputs = await tokenizer(prompt, { return_tensors: 'pt' });

    const outputs = await model.generate({
      input_ids:      inputs.input_ids,
      attention_mask: inputs.attention_mask,
      max_new_tokens: MAX_NEW_TOKENS,
      temperature:    TEMPERATURE,
      do_sample:      DO_SAMPLE,
    });

    const decoded: string = tokenizer.decode(outputs[0], {
      skip_special_tokens: true,
    });

    // Strip echoed prompt from start of output
    const completion = decoded.startsWith(prompt)
      ? decoded.slice(prompt.length).trim()
      : decoded.trim();

    if (!completion || completion.length < 5) {
      return (
        'The AI model did not generate a meaningful response for this issue.\n' +
        'Try clicking "Ask AI" on a different diagnostic.'
      );
    }

    return completion;

  } catch (err: any) {
    console.error('AI completion error:', err);
    throw new Error(`Model generation failed: ${err?.message ?? String(err)}`);
  }
}

export function isAIAvailable(): boolean {
  return model !== null && tokenizer !== null;
}

export function getActiveDevice(): string {
  return activeDevice;
}

export function resetAI(): void {
  tokenizer    = null;
  model        = null;
  activeDevice = 'cpu';
  console.log('AI model cleared from memory.');
}