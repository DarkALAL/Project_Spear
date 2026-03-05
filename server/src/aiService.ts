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
// MAX_NEW_TOKENS: 512 is enough for root cause + fixed code + explanation.
// Higher values give the 1B model too much rope and cause repetition loops.
const MAX_NEW_TOKENS = 512;
const TEMPERATURE    = 0.3;   // slightly raised for more natural phrasing
const DO_SAMPLE      = true;

// ── Repetition controls ──
// Small LLMs (1B) loop without these. The model generates a good answer
// once, then copies itself verbatim until hitting MAX_NEW_TOKENS.
//
// repetition_penalty > 1.0  → penalises tokens already seen in the output.
//   1.3 is a safe sweet-spot: strong enough to break loops, but not so high
//   that it distorts word choice on first use.
//
// no_repeat_ngram_size = 4  → hard-bans any 4-gram (4-token sequence)
//   that already appeared in the output. Catches "Here is the solution:"
//   copy-paste loops that repetition_penalty alone sometimes misses.
const REPETITION_PENALTY   = 1.3;
const NO_REPEAT_NGRAM_SIZE = 4;

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
let activeDevice: DeviceType = 'cpu'; // updated after successful load

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
 *   2. Auto-detect via nvidia-smi
 *
 * Set in server/.env:
 *   DEVICE=auto   → detect automatically (default)
 *   DEVICE=cuda   → force GPU (crashes if not available)
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
  const gpuFound = await isCudaAvailable();

  if (gpuFound) {
    console.log('  🎮 NVIDIA GPU detected — will attempt CUDA.');
    return 'cuda';
  }

  console.log('  💻 No GPU detected — using CPU.');
  return 'cpu';
}

/**
 * getDtype()
 *
 * fp16 = half precision — 2x faster, uses half VRAM on GPU.
 * fp32 = full precision — required on CPU (fp16 not supported).
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
 * Checks that the model folder and required files exist before
 * attempting to load — gives a clear error instead of a cryptic
 * ONNX runtime crash.
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
 * Attempts to load the tokenizer and ONNX model on the given
 * device with the given dtype.
 *
 * Throws on failure so the caller (initializeAI) can retry
 * with a fallback device.
 *
 * @param device - DeviceType literal ('cuda' | 'cpu' | ...)
 * @param dtype  - DtypeType literal ('fp16' | 'fp32' | ...)
 */
async function loadModel(
  device: DeviceType,
  dtype: DtypeType
): Promise<void> {
  console.log(`  Loading tokenizer...`);
  tokenizer = await AutoTokenizer.from_pretrained(MODEL_DIR);
  console.log(`  ✓ Tokenizer loaded`);

  console.log(`  Loading ONNX model on ${device.toUpperCase()} (${dtype})...`);

  // For CPU — set env var to prevent onnxruntime from
  // attempting to load CUDA shared libraries at all
  if (device === 'cpu') {
    process.env.ORT_DISABLE_CUDA = '1';
    process.env.TRANSFORMERS_OFFLINE = '1'; // use local files only
  }

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
 *   2. Detect best device (GPU > CPU)
 *   3. Attempt load on preferred device
 *   4. If GPU load fails → automatically retry on CPU (fp32)
 *   5. If CPU also fails → throw so server logs the error
 *
 * The server (index.ts) catches the throw and starts anyway
 * with AI features disabled — static analysis still works.
 */
export async function initializeAI(): Promise<void> {
  // Skip if already loaded
  if (model && tokenizer) {
    console.log('AI model already initialized, skipping.');
    return;
  }

  // Validate files before anything else
  validateModelDirectory();

  console.log(`\n📂 Model path : ${MODEL_DIR}`);

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
          '  To fix GPU: verify CUDA runtime is installed ' +
          'and DEVICE=cuda in .env'
        );
        return; // success on fallback

      } catch (fallbackErr: any) {
        // Both attempts failed
        tokenizer = null;
        model     = null;
        throw new Error(
          `Failed to load model on both CUDA and CPU.\n` +
          `  CUDA error : ${primaryErr?.message}\n` +
          `  CPU error  : ${fallbackErr?.message}`
        );
      }
    }

    // CPU was preferred and it failed — nothing to fall back to
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
 *
 * @param prompt - Full structured prompt from analysisService.getAIContext()
 * @returns      - The model's generated explanation as plain text
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
    // Tokenize prompt into tensor format
    const inputs = await tokenizer(prompt, { return_tensors: 'pt' });

    // Run inference
    const outputs = await model.generate({
      input_ids:             inputs.input_ids,
      attention_mask:        inputs.attention_mask,
      max_new_tokens:        MAX_NEW_TOKENS,
      temperature:           TEMPERATURE,
      do_sample:             DO_SAMPLE,
      // Prevent the 1B model from looping / repeating its answer verbatim.
      // Without these, responses like "Here is the solution: [code]" get
      // copy-pasted 4–5 times until MAX_NEW_TOKENS is exhausted.
      repetition_penalty:    REPETITION_PENALTY,
      no_repeat_ngram_size:  NO_REPEAT_NGRAM_SIZE,
    });

    // Decode token IDs → string
    // outputs[0] = token ID array for the first (only) batch entry
    const decoded: string = tokenizer.decode(outputs[0], {
      skip_special_tokens: true,
    });

    // The model echoes the prompt before its completion — strip it
    const completion = decoded.startsWith(prompt)
      ? decoded.slice(prompt.length).trim()
      : decoded.trim();

    // ── Post-process: strip repetition loops ──
    // Even with repetition_penalty, small models sometimes emit the same
    // paragraph 2–3 times. We split on double-newlines (paragraph breaks),
    // deduplicate adjacent identical paragraphs, then rejoin.
    const deduped = completion
      .split(/\n{2,}/)
      .filter((para, i, arr) => i === 0 || para.trim() !== arr[i - 1].trim())
      .join('\n\n')
      .trim();

    // Guard against empty or trivially short responses
    if (!deduped || deduped.length < 5) {
      return (
        'The AI model did not generate a meaningful response for this issue.\n' +
        'Try clicking "Ask AI" on a different diagnostic.'
      );
    }

    return deduped;

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
 *
 * Returns which device the model is actually running on.
 * Exposed via the /health endpoint so you can verify GPU/CPU
 * status without checking server logs.
 *
 * Returns: 'cuda' | 'cpu'
 */
export function getActiveDevice(): string {
  return activeDevice;
}

/**
 * resetAI()
 *
 * Clears the loaded model and tokenizer from memory.
 * Useful for testing or triggering a hot reload of the model.
 */
export function resetAI(): void {
  tokenizer    = null;
  model        = null;
  activeDevice = 'cpu';
  console.log('AI model cleared from memory.');
}