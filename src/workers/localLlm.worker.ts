/**
 * Offline Phi-3 mini worker.
 *
 * Runs in its own dedicated worker so a 3.8B-parameter model can never block the
 * UI thread or queue behind the NeuroScope / support workers. WebGPU only: a
 * model this size is not usable on the WASM CPU backend, so the main thread
 * checks for WebGPU before it ever starts this worker.
 *
 * The worker is a plain text-in / text-out engine. It knows nothing about risk
 * or tone; every rule that governs how its output may be used lives in
 * `utils/toneRules.ts` and `utils/semanticEngine.ts`.
 */
import type { LlmWorkerEvent, LlmWorkerRequest } from './localLlmProtocol.js';
import { applyGuardToEnv, installOfflineFetchGuard } from './offlineFetchGuard.js';

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<LlmWorkerRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (event: LlmWorkerEvent) => scope.postMessage(event);

let tf: any = null;
let tokenizer: any = null;
let model: any = null;
let stopping: any = null;

const PROGRESS_INTERVAL_MS = 150;

async function load(modelId: string, dtype: string, externalData?: boolean) {
  const guardedFetch = installOfflineFetchGuard(); // must run before transformers.js is imported
  tf = tf ?? (await import('@huggingface/transformers'));
  const { AutoTokenizer, AutoModelForCausalLM, env } = tf;
  applyGuardToEnv(env, guardedFetch);
  env.allowLocalModels = false;
  env.useBrowserCache = true; // Cache API: this is what makes the model work offline afterwards

  // Aggregate per-file progress into one byte counter, throttled so the UI is not flooded.
  const files = new Map<string, { loaded: number; total: number }>();
  let lastPost = 0;
  const progress_callback = (e: any) => {
    if (e?.status !== 'progress' || !e.file) return;
    files.set(e.file, { loaded: Number(e.loaded) || 0, total: Number(e.total) || 0 });
    const now = Date.now();
    if (now - lastPost < PROGRESS_INTERVAL_MS) return;
    lastPost = now;
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: 'progress', loaded, total, file: String(e.file) });
  };

  tokenizer = await AutoTokenizer.from_pretrained(modelId, { progress_callback });
  model = await AutoModelForCausalLM.from_pretrained(modelId, {
    dtype,
    device: 'webgpu',
    // Phi-3 keeps its weights in model_q4f16.onnx_data; single-file models must not set this.
    ...(externalData ? { use_external_data_format: true } : {}),
    progress_callback,
  });

  // One tiny warm-up pass so the first real answer does not pay for shader compilation.
  await generate(-1, 'Reply with the word OK.', '', 2, true);
  post({ type: 'ready' });
}

async function generate(id: number, system: string, user: string, maxNewTokens: number, silent = false) {
  const { InterruptableStoppingCriteria } = tf;
  stopping = new InterruptableStoppingCriteria();
  // System text is folded into the user turn: it works with every Phi-3 chat template revision.
  const messages = [{ role: 'user', content: user ? `${system}\n\n${user}` : system }];
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true });
  const { sequences } = await model.generate({
    ...inputs,
    do_sample: false, // deterministic: the same answer text always yields the same reading
    max_new_tokens: maxNewTokens,
    stopping_criteria: stopping,
    return_dict_in_generate: true,
  });
  const promptLen = inputs.input_ids.dims.at(-1);
  const [text] = tokenizer.batch_decode(sequences.slice(null, [promptLen, null]), { skip_special_tokens: true });
  if (!silent) post({ type: 'result', id, ok: true, text: String(text ?? '') });
  return text;
}

scope.onmessage = async (event) => {
  const req = event.data;
  try {
    if (req.op === 'load') await load(req.modelId, req.dtype, req.externalData);
    else if (req.op === 'generate') await generate(req.id, req.system, req.user, req.maxNewTokens);
    else if (req.op === 'interrupt') stopping?.interrupt();
    else if (req.op === 'dispose') {
      try {
        await model?.dispose?.();
      } catch {
        // best effort
      }
      model = null;
      tokenizer = null;
    }
  } catch (err: any) {
    const error = String(err?.message || err);
    if (req.op === 'generate') post({ type: 'result', id: req.id, ok: false, error });
    else post({ type: 'error', error });
  }
};
