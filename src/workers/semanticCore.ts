/**
 * Model side of the semantic engine.
 *
 * Everything CPU-heavy lives here: downloading/creating ONNX sessions, tokenizing,
 * running the forward pass, and pulling the numbers out of the output tensors.
 * `semantic.worker.ts` hosts one instance of this class inside a Web Worker, so
 * the page's main thread only ever posts a string and receives a few plain
 * numbers back — typing, scrolling and React renders are never blocked by a
 * transformer pass.
 *
 * The same class can also run on the main thread (see `semanticTransport.ts`)
 * as a fallback for browsers/hosts where module workers are unavailable, so the
 * engine keeps working there exactly as it did before workers were introduced.
 *
 * This file must stay free of DOM/React/`window` references: it runs in a
 * worker global scope.
 */
import { applyGuardToEnv, installOfflineFetchGuard } from './offlineFetchGuard.js';

export type CoreModelKey = 'neuroscope' | 'sentiment' | 'emotion' | 'embedding';

/** Same ids/dtype the engine has always used. `neuroscope-distilbert` is a LOCAL
 * model served from /models/neuroscope-distilbert; the rest resolve on the hub. */
export const CORE_MODEL_IDS: Record<CoreModelKey, string> = {
  neuroscope: 'neuroscope-distilbert',
  sentiment: 'Xenova/twitter-roberta-base-sentiment-latest',
  emotion: 'nicky48/emotion-english-distilroberta-base-ONNX',
  embedding: 'Xenova/all-MiniLM-L6-v2',
};

const DTYPE = 'q8';

export type CoreRequest =
  | { op: 'init'; numThreads?: number }
  | { op: 'load'; key: CoreModelKey }
  | { op: 'neuroscope'; text: string }
  | { op: 'classify'; key: 'sentiment' | 'emotion'; text: string; topk: number }
  | { op: 'embed'; texts: string[] }
  | { op: 'dispose' };

export type CoreEvent = { type: 'progress'; key: CoreModelKey; event: Record<string, unknown> };

export interface CoreReply {
  result: unknown;
  /** Buffers to hand over to the caller without copying (worker mode only). */
  transfer?: Transferable[];
}

/** Raw logits of the dual-head NeuroScope model. Post-processing (softmax, risk
 * bands, safety overrides) stays with the engine, which owns the risk logic. */
export interface NeuroScopeRaw {
  status: number[];
  risk: number[];
}

/** Download progress events arrive many times per second per file. Forwarding
 * every one makes the UI re-render for no visible gain, so they are thinned. */
const PROGRESS_INTERVAL_MS = 120;

function disposeTensors(output: any): void {
  try {
    if (!output) return;
    if (typeof output.dispose === 'function') {
      output.dispose();
      return;
    }
    for (const value of Object.values(output)) {
      (value as any)?.dispose?.();
    }
  } catch {
    // releasing memory early is an optimisation, never a requirement
  }
}

export class SemanticCore {
  private modulePromise: Promise<any> | null = null;
  private numThreads = 0;
  private loads = new Map<CoreModelKey, Promise<void>>();
  private pipes: Partial<Record<'sentiment' | 'emotion' | 'embedding', any>> = {};
  private tokenizer: any = null;
  private model: any = null;
  private lastProgressAt = new Map<CoreModelKey, number>();

  constructor(private readonly emit: (event: CoreEvent) => void) {}

  async handle(req: CoreRequest): Promise<CoreReply> {
    switch (req.op) {
      case 'init':
        this.numThreads = req.numThreads ?? 0;
        return { result: true };
      case 'load':
        await this.load(req.key);
        return { result: true };
      case 'neuroscope':
        return { result: await this.runNeuroScope(req.text) };
      case 'classify':
        return { result: await this.runClassifier(req.key, req.text, req.topk) };
      case 'embed':
        return this.runEmbed(req.texts);
      case 'dispose':
        await this.dispose();
        return { result: true };
      default:
        throw new Error(`Unknown semantic op: ${(req as { op?: string }).op}`);
    }
  }

  // -------------------------------------------------------------------------
  // Runtime
  // -------------------------------------------------------------------------

  private getModule(): Promise<any> {
    if (!this.modulePromise) {
      const guardedFetch = installOfflineFetchGuard(); // before transformers.js loads
      this.modulePromise = import('@huggingface/transformers')
        .then((mod: any) => {
          const env = mod?.env;
          if (env) {
            // NeuroScope DistilBERT is a LOCAL model (not a hub id): local model
            // loading must stay on or every load 404s against huggingface.co.
            // The hub models each throw away one quick local-probe 404 before
            // falling through to the hub — far cheaper than losing the primary.
            applyGuardToEnv(env, guardedFetch);
            env.allowLocalModels = true;
            env.localModelPath = '/models/';
            env.allowRemoteModels = true;
            env.useBrowserCache = true;

            const wasm = env.backends?.onnx?.wasm;
            if (wasm) {
              // This code already runs off the main thread, so ORT's own proxy
              // worker would only add another hop.
              wasm.proxy = false;
              // Multi-threaded WASM needs SharedArrayBuffer (a cross-origin
              // isolated page). Without it ORT stays single-threaded on its own.
              const isolated = (globalThis as any).crossOriginIsolated === true;
              if (isolated && this.numThreads > 0) wasm.numThreads = this.numThreads;
            }
          }
          return mod;
        })
        .catch((err) => {
          this.modulePromise = null;
          throw err;
        });
    }
    return this.modulePromise;
  }

  private progressCallback(key: CoreModelKey) {
    return (event: any) => {
      if (!event) return;
      const isProgress = event.status === 'progress';
      if (isProgress) {
        const now = Date.now();
        const last = this.lastProgressAt.get(key) ?? 0;
        // Always let the final tick through so the bar reaches its end.
        if (now - last < PROGRESS_INTERVAL_MS && !(typeof event.progress === 'number' && event.progress >= 99.5)) {
          return;
        }
        this.lastProgressAt.set(key, now);
      }
      this.emit({
        type: 'progress',
        key,
        event: { status: event.status, file: event.file ?? event.name, progress: event.progress },
      });
    };
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  private load(key: CoreModelKey): Promise<void> {
    let promise = this.loads.get(key);
    if (!promise) {
      promise = this.doLoad(key).catch((err) => {
        this.loads.delete(key); // a failed download must be retryable
        throw err;
      });
      this.loads.set(key, promise);
    }
    return promise;
  }

  private async doLoad(key: CoreModelKey): Promise<void> {
    const mod = await this.getModule();
    const id = CORE_MODEL_IDS[key];
    const progress_callback = this.progressCallback(key);

    if (key === 'neuroscope') {
      // Driven directly (tokenizer + model) instead of via the text-classification
      // pipeline: its ONNX graph exposes two outputs (status_logits + risk_logits)
      // that the stock pipeline cannot read.
      const tokenizer = await mod.AutoTokenizer.from_pretrained(id);
      const model = await mod.AutoModel.from_pretrained(id, { dtype: DTYPE, device: 'wasm', progress_callback });
      // One throwaway pass so the first real answer does not pay for WASM
      // kernel/memory initialisation.
      disposeTensors(await model(tokenizer('ok')));
      this.tokenizer = tokenizer;
      this.model = model;
      return;
    }

    const task = key === 'embedding' ? 'feature-extraction' : 'text-classification';
    const pipe = await mod.pipeline(task, id, { dtype: DTYPE, device: 'wasm', progress_callback });
    if (key === 'embedding') disposeTensors(await pipe(['ok'], { pooling: 'mean', normalize: true }));
    else await pipe('ok', { topk: 1 });
    this.pipes[key] = pipe;
  }

  // -------------------------------------------------------------------------
  // Inference
  // -------------------------------------------------------------------------

  private async runNeuroScope(text: string): Promise<NeuroScopeRaw> {
    if (!this.tokenizer || !this.model) throw new Error('NeuroScope model is not loaded');
    const inputs = this.tokenizer(text, { padding: true, truncation: true, max_length: 512 });
    const output = await this.model(inputs);
    try {
      const statusTensor = output.status_logits ?? output.logits;
      const riskTensor = output.risk_logits;
      // Copy into plain arrays BEFORE releasing the tensors.
      const status: number[] = statusTensor
        ? Array.from((statusTensor.data ?? statusTensor.tolist?.()[0] ?? []) as ArrayLike<number>)
        : [];
      const risk: number[] = riskTensor
        ? Array.from((riskTensor.data ?? riskTensor.tolist?.() ?? []) as ArrayLike<number>)
        : [];
      return { status, risk };
    } finally {
      disposeTensors(output);
    }
  }

  private async runClassifier(key: 'sentiment' | 'emotion', text: string, topk: number): Promise<unknown> {
    const pipe = this.pipes[key];
    if (!pipe) throw new Error(`${key} model is not loaded`);
    // Result is an array of { label, score } — already structured-cloneable.
    return pipe(text, { topk });
  }

  private async runEmbed(texts: string[]): Promise<CoreReply> {
    const pipe = this.pipes.embedding;
    if (!pipe) throw new Error('embedding model is not loaded');
    const output = await pipe(texts, { pooling: 'mean', normalize: true });
    try {
      const dims: number[] = output.dims ?? [];
      const dim = dims[dims.length - 1] || 0;
      const count = dims.length >= 2 ? dims[0] : 1;
      const raw = output.data as ArrayLike<number>;
      const flat = raw instanceof Float32Array ? raw : Float32Array.from(raw);
      const rows: Float32Array[] = [];
      for (let i = 0; i < count; i++) rows.push(flat.slice(i * dim, (i + 1) * dim));
      return { result: rows, transfer: rows.map((r) => r.buffer as ArrayBuffer) };
    } finally {
      disposeTensors(output);
    }
  }

  // -------------------------------------------------------------------------

  private async dispose(): Promise<void> {
    const targets = [this.model, ...Object.values(this.pipes)];
    for (const target of targets) {
      try {
        await target?.dispose?.();
      } catch {
        // ignore
      }
    }
    this.model = null;
    this.tokenizer = null;
    this.pipes = {};
    this.loads.clear();
  }
}
