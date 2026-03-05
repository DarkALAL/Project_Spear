// server/src/aiService.ts
import path from 'path';
import fs from 'fs';
import { AutoTokenizer, AutoModelForCausalLM } from '@huggingface/transformers';

// Adjust to your project layout
const SERVER_DIR = path.resolve(__dirname, '..');
const MODEL_DIR = path.join(SERVER_DIR, 'models', 'Maincoder-1B-ONNX');

let tokenizer: any = null;
let model: any = null;

/**
 * Initialize tokenizer + model.
 * This follows the Maincoder repo example and passes:
 *  - model_file_name: 'decoder_with_past_model'
 *  - use_external_data_format: true
 *
 * NOTE: this requires @huggingface/transformers installed (npm i @huggingface/transformers)
 * and enough memory to load the model files.
 */
export async function initializeAI() {
  // Already initialized
  if (model && tokenizer) return;

  // Basic sanity checks
  if (!fs.existsSync(MODEL_DIR)) {
    throw new Error(`Model folder not found at ${MODEL_DIR}. Please place the model there or update MODEL_DIR.`);
  }

  console.log('Initializing Maincoder-1B AI Model (huggingface/transformers)...');

  try {
    // Load tokenizer from local folder
    // Accepts either a HF repo id or a local path
    tokenizer = await AutoTokenizer.from_pretrained(MODEL_DIR);

    // Load the ONNX model that uses external tensor data.
    // IMPORTANT: subfolder set to '.' since model files are at the model root.
    model = await AutoModelForCausalLM.from_pretrained(MODEL_DIR, {
      subfolder: '.',
      model_file_name: 'decoder_with_past_model',
      use_external_data_format: true,
    });

    console.log('✅ Maincoder-1B AI Model initialized successfully.');
  } catch (err: any) {
    console.error('❌ Failed to initialize AI Model:', err?.message ?? err);
    // If initialization fails, clear partial state so next attempt is clean
    tokenizer = null;
    model = null;
    throw err;
  }
}

/**
 * Get a completion from the loaded model.
 * Returns the decoded generated text (prompt removed).
 */
export async function getAICompletion(prompt: string): Promise<string> {
  if (!model || !tokenizer) {
    throw new Error('AI model/tokenizer is not initialized. Call initializeAI() and wait for it to succeed.');
  }

  try {
    // Tokenize input (returns tensors appropriate to the backend; example uses 'pt' like repo)
    const inputs = await tokenizer(prompt, { return_tensors: 'pt' });

    // Generate tokens (adjust params as needed)
    const outputs = await model.generate({
      input_ids: inputs.input_ids,
      attention_mask: inputs.attention_mask,
      max_new_tokens: 200,
      temperature: 0.2,
      do_sample: true,
    });

    // outputs[0] should be the generated token ids for the first (and only) batch entry
    const decoded = tokenizer.decode(outputs[0], { skip_special_tokens: true });

    // Remove the prompt from returned text and trim
    return decoded.replace(prompt, '').trim();
  } catch (err) {
    console.error('AI completion failed:', err);
    throw new Error('Failed to get a response from the AI model.');
  }
}