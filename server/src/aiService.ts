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

// Generation parameters — tweak to trade speed vs quality
const MAX_NEW_TOKENS = 250;
const TEMPERATURE    = 0.2;
const DO_SAMPLE      = true;

// cuDNN library path — where libcudnn.so.9 was installed
// Found via: find /usr -name "libcudnn.so.9"
const CUDNN_LIB_PATH = '/usr/lib/x86_64-linux-gnu';

// ─────────────────────────────────────────
// LITERAL TYPES
// Matches exactly what @huggingface/transformers expects
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
 * Programmatically adds the cuDNN library path to LD_LIBRARY_PATH
 * so onnxruntime can find libcudnn.so.9 at runtime.
 *
 * This is needed because WSL2 doesn't always pick up paths added
 * via /etc/ld.so.conf.d until ldconfig is re-run AND the shell
 * is restarted. Setting it here guarantees it's always present
 * when the Node process starts.
 */
function ensureLibraryPaths(): void {
  const currentLdPath = process.env.LD_LIBRARY_PATH || '';

  // Only add if not already present
  if (!currentLdPath.includes(CUDNN_LIB_PATH)) {
    process.env.LD_LIBRARY_PATH = `${CUDNN_LIB_PATH}:${currentLdPath}`;
    console.log(`  📚 Added ${CUDNN_LIB_PATH} to LD_LIBRARY_PATH`);
  }

  // Also ensure CUDA lib path is included
  const cudaLibPath = '/usr/local/cuda/lib64';
  if (!currentLdPath.includes(cudaLibPath) && fs.existsSync(cudaLibPath)) {
    process.env.LD_LIBRARY_PATH = `${cudaLibPath}:${process.env.LD_LIBRARY_PATH}`;
    console.log(`  📚 Added ${cudaLibPath} to LD_LIBRARY_PATH`);
  }
}

/**
 * verifyCudnnLibrary()
 *
 * Checks that libcudnn.so.9 is actually accessible on the filesystem
 * before attempting to load the CUDA provider.
 * Returns true if found, false otherwise.
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

/**
 * isCudaAvailable()
 *
 * Runs nvidia-smi to check if a CUDA-capable GPU is accessible.
 * Works on Linux and WSL2 with NVIDIA drivers installed.
 * Returns false on any error — never throws.
 */
function isCudaAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    exec('nvidia-smi', (error) => {
      resolve(!error);
    });
  });
}

/**
 * getOptimalDevice()
 *
 * Determines the best device to run inference on.
 *
 * Priority:
 *   1. DEVICE env var if explicitly set (auto | cpu | cuda)
 *   2. Auto-detect via nvidia-smi + cuDNN library check
 *
 * Set in server/.env:
 *   DEVICE=auto   → detect automatically (default)
 *   DEVICE=cuda   → force GPU
 *   DEVICE=cpu    → force CPU always
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

  // Auto-detect
  console.log('  🔍 Auto-detecting available device...');

  const gpuFound  = await isCudaAvailable();
  if (!gpuFound) {
    console.log('  💻 No GPU detected — using CPU.');
    return 'cpu';
  }

  console.log('  🎮 NVIDIA GPU detected.');

  // Extra check — verify cuDNN is accessible before committing to CUDA
  // This prevents the onnxruntime CUDA provider crash at model load time
  const cudnnFound = verifyCudnnLibrary();
  if (!cudnnFound) {
    console.warn(
      '  ⚠️  GPU found but libcudnn.so.9 is not accessible.\n' +
      '  Run: sudo apt install -y libcudnn9-cuda-12\n' +
      '  Then: sudo ldconfig\n' +
      '  Falling back to CPU for this session.'
    );
    return 'cpu';
  }

  console.log('  ✅ GPU + cuDNN both available — using CUDA.');
  return 'cuda';
}

/**
 * getDtype()
 *
 * Always fp32 — the Maincoder-1B-ONNX model only ships
 * with the fp32 ONNX file (decoder_with_past_model.onnx).
 * fp16 would require decoder_with_past_model_fp16.onnx
 * which is not included in the download.
 */
function getDtype(_device: DeviceType): DtypeType {
  return 'fp32';
}

// ─────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────

/**
 * validateModelDirectory()
 *
 * Checks that the model folder and required files exist
 * before attempting to load.
 */
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

/**
 * loadModel()
 *
 * Loads the tokenizer and ONNX model on the specified device.
 * Throws on failure so initializeAI() can retry with fallback.
 */
async function loadModel(
  device: DeviceType,
  dtype: DtypeType
): Promise<void> {
  // Set library paths before loading — critical for CUDA provider
  ensureLibraryPaths();

  // For CPU path — explicitly disable CUDA provider so onnxruntime
  // doesn't try to dlopen libonnxruntime_providers_cuda.so at all
  if (device === 'cpu') {
    process.env.ORT_DISABLE_CUDA    = '1';
    process.env.TRANSFORMERS_OFFLINE = '1';
  } else {
    // For CUDA path — make sure we don't have ORT_DISABLE_CUDA set
    // from a previous failed attempt
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
 *
 * Flow:
 *   1. Validate model files exist
 *   2. Ensure library paths are set (LD_LIBRARY_PATH)
 *   3. Detect best device — GPU if nvidia-smi + cuDNN both pass
 *   4. Attempt load on preferred device
 *   5. If GPU load fails → automatically retry on CPU
 *   6. If CPU also fails → throw (server starts with AI disabled)
 */
export async function initializeAI(): Promise<void> {
  if (model && tokenizer) {
    console.log('AI model already initialized, skipping.');
    return;
  }

  validateModelDirectory();

  console.log(`\n📂 Model path : ${MODEL_DIR}`);

  // Set library paths early — before any device detection
  ensureLibraryPaths();

  const preferredDevice = await getOptimalDevice();
  const dtype           = getDtype(preferredDevice);

  console.log(`  Target device : ${preferredDevice.toUpperCase()}`);
  console.log(`  dtype         : ${dtype}`);
  console.log(`  This may take 30–60 seconds on first load...`);

  // ── Attempt 1: preferred device ──
  try {
    await loadModel(preferredDevice, dtype);
    return; // success

  } catch (primaryErr: any) {

    // ── Attempt 2: CPU fallback (only if preferred was CUDA) ──
    if (preferredDevice === 'cuda') {
      console.warn(`\n  ⚠️  CUDA load failed: ${primaryErr?.message}`);
      console.warn('  ↩️  Retrying on CPU (fp32)...\n');

      // Clear partial state before retry
      tokenizer = null;
      model     = null;

      try {
        await loadModel('cpu', 'fp32');
        console.warn(
          '\n  ⚠️  Running on CPU fallback.\n' +
          '  To fix GPU, run:\n' +
          '    sudo apt install -y libcudnn9-cuda-12\n' +
          '    sudo ldconfig\n' +
          '  Then restart the server.'
        );
        return; // success on fallback

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

    // CPU was preferred and failed
    tokenizer = null;
    model     = null;
    throw new Error(
      `Failed to load model on CPU: ${primaryErr?.message}`
    );
  }
}

/**
 * getAICompletion()
 *
 * Tokenizes the prompt, runs inference, decodes the output,
 * and strips the echoed prompt from the result.
 */
export async function getAICompletion(prompt: string): Promise<string> {
  if (!model || !tokenizer) {
    throw new Error(
      'AI model is not initialized. ' +
      'Ensure initializeAI() completed successfully ' +
      'before calling getAICompletion().'
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

    // Strip echoed prompt from start of decoded output
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
    throw new Error(
      `Model generation failed: ${err?.message ?? String(err)}`
    );
  }
}

/**
 * isAIAvailable()
 * Returns true if the model is loaded and ready for inference.
 */
export function isAIAvailable(): boolean {
  return model !== null && tokenizer !== null;
}

/**
 * getActiveDevice()
 * Returns which device the model is running on ('cuda' | 'cpu').
 * Reported by the /health endpoint.
 */
export function getActiveDevice(): string {
  return activeDevice;
}

/**
 * resetAI()
 * Clears model from memory — useful for testing.
 */
export function resetAI(): void {
  tokenizer    = null;
  model        = null;
  activeDevice = 'cpu';
  console.log('AI model cleared from memory.');
}