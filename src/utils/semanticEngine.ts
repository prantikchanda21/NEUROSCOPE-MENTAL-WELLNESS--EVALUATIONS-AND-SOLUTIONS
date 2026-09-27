/**
 * Transformer-based semantic engine (Transformers.js).
 *
 * This module replaces two hand-rolled pieces of the original engine with real
 * neural inference that runs entirely in the browser via WebAssembly:
 *
 *   1. NeuroScope DistilBERT (this project's own fine-tuned dual-head model)
 *      is the PRIMARY valence/tone reader, mapped onto the app's tone scale
 *      via `sentimentFromNeuroScope()` below. Once the RoBERTa sentiment model
 *      (`Xenova/twitter-roberta-base-sentiment-latest`) has ALSO produced a
 *      read for the same text, the two are combined by confidence-weighted
 *      ensembling (`ensembleTransformerSentiment()`) rather than one simply
 *      discarding the other — two independently-trained models agreeing is
 *      stronger evidence than either alone, and disagreement is itself a
 *      signal (surfaced as `confidence`) that the reading is ambiguous. Only
 *      while NeuroScope is still downloading/unavailable does RoBERTa stand
 *      in alone; the fixed `SENTIMENT_LEXICON` remains the last-resort
 *      offline fallback under that.
 *   2. Multi-class emotion classification (7 Ekman emotions, distilroberta)
 *      which the original app did not have at all.
 *   3. Sentence embeddings (`Xenova/all-MiniLM-L6-v2`) that power semantic
 *      vector search, replacing TF-weighted keyword overlap for both adaptive
 *      question selection and research-passage retrieval.
 *
 * Design rules that keep the rest of the app intact:
 *  - Nothing loads until the app explicitly calls `warmSemanticEngine()`, and
 *    the dynamic `import()` means Vite code-splits the runtime into its own
 *    chunk (the initial bundle is unchanged).
 *  - Every entry point has a timeout and returns `null`/a lexicon fallback when
 *    a model is unavailable (offline, blocked CDN, very old browser). The
 *    clinical engine therefore never depends on the network.
 *  - All inference results are memoized in LRU caches keyed by normalized text,
 *    so re-analyzing an answer (which happens on submit, on review, and when
 *    building API request bodies) is free.
 */

import { hasImminentRiskLanguage, scanRiskMarkers } from './riskEngine.js';
import type {
  EmotionClassification,
  EmotionLabel,
  EmotionScore,
  NeuroScopeReading,
  NeuroScopeStatus,
  RiskLevel,
  SemanticAnalysis,
  SemanticEngineState,
  SemanticEngineStatus,
  SemanticModelKey,
  SentimentResult,
} from '../types.js';

/** Confirmed-available ONNX checkpoints (all expose `onnx/model_quantized.onnx`).
 * `neuroscope` is the project's own fine-tuned dual-head DistilBERT, hosted
 * from `/models/neuroscope-distilbert/` (see public/models) — it is the
 * PRIMARY clinical classifier; the hub models below are supporting signals. */
export const SEMANTIC_MODELS: Record<SemanticModelKey, string> = {
  neuroscope: 'neuroscope-distilbert',
  sentiment: 'Xenova/twitter-roberta-base-sentiment-latest',
  emotion: 'nicky48/emotion-english-distilroberta-base-ONNX',
  embedding: 'Xenova/all-MiniLM-L6-v2',
};

const MODEL_LABELS: Record<SemanticModelKey, string> = {
  neuroscope: 'NeuroScope DistilBERT (primary classifier)',
  sentiment: 'fine-tuned RoBERTa sentiment model',
  emotion: 'multi-class emotion classifier',
  embedding: 'semantic embedding model',
};

/** Model card metrics for the primary model, exposed so prompts (and the
 * server) can cite what the reading is backed by. */
export const NEUROSCOPE_MODEL_INFO = {
  id: 'neuroscope-distilbert',
  dimensions: ['Normal', 'Depression', 'Suicidal', 'Anxiety', 'Bipolar', 'Stress', 'Personality Disorder'] as NeuroScopeStatus[],
  statusMacroF1: 0.792,
  statusWeightedF1: 0.818,
  accuracy: 0.816,
  riskRecall: 0.916,
  riskAuc: 0.967,
  /** Recall-first risk threshold tuned on validation (risk_config.json). */
  riskThreshold: 0.22,
};

/** How strongly each dominant dimension pushes the dynamic risk band, when
 * the status head is confident about it. Suicidal dominates; Normal is
 * protective and is handled separately. */
const STATUS_BAND_WEIGHT: Record<NeuroScopeStatus, number> = {
  Normal: 0,
  Stress: 0.3,
  Anxiety: 0.4,
  'Personality Disorder': 0.45,
  Bipolar: 0.45,
  Depression: 0.55,
  Suicidal: 1,
};

/** Quantized wasm weights: sentiment ~125MB, emotion ~82MB, MiniLM ~23MB.
 * Downloaded once, then served from the browser's Cache Storage. */
const DEFAULT_DTYPE = 'q8';
const INFERENCE_TIMEOUT_MS = 7000;
const BATCH_TIMEOUT_MS = 12000;
const MODEL_WAIT_TIMEOUT_MS = 8000;
/** Classifiers are 512-token RoBERTa models; answers are short, but cap anyway
 * so a pasted essay cannot stall inference. */
const MAX_CLASSIFY_CHARS = 1100;
const MAX_EMBED_CHARS = 2000;

/**
 * First-person phrasings of active risk, paraphrased (never verbatim quotes)
 * from the safety literature the app already cites (SAMHSA TIP 57, PROMIS
 * depression item bank). A user answer is scored by cosine similarity to the
 * nearest of these, which catches crisis language the word-level lexicon was
 * never going to enumerate ("I would rather not wake up", "everyone would be
 * relieved if I were gone", ...).
 */
export const HIGH_RISK_EXEMPLARS: string[] = [
  'I want to kill myself',
  'I have been thinking about ending my life',
  'I have a plan for how I would take my own life',
  'I do not want to be alive anymore',
  'I wish I could go to sleep and never wake up',
  'I have been hurting myself on purpose',
  'I have been cutting or burning myself to cope',
  'I cannot keep myself safe right now',
  'I feel like a burden to everyone around me',
  'Everyone would be better off without me',
  'There is no reason for me to keep living',
  'I feel completely hopeless and see no way forward',
  'The thought of harming myself keeps coming back',
  'I am afraid of what I might do to myself',
];

/**
 * Compact emotion lexicon used only as the offline fallback for the multi-class
 * classifier, so `EmotionClassification` always has a value to hand back.
 */
const EMOTION_LEXICON: Record<EmotionLabel, string[]> = {
  anger: ['angry', 'anger', 'furious', 'rage', 'irritated', 'irritable', 'mad', 'resentful', 'frustrated', 'annoyed', 'snapped', 'lash', 'hate'],
  disgust: ['disgust', 'disgusting', 'revolting', 'sickened', 'repulsed', 'gross', 'contempt', 'ashamed of', 'worthless', 'disgrace'],
  fear: ['afraid', 'scared', 'fear', 'fearful', 'terrified', 'anxious', 'anxiety', 'panic', 'worried', 'worry', 'dread', 'nervous', 'uneasy', 'tense', 'overwhelmed', 'racing heart'],
  joy: ['happy', 'happiness', 'joy', 'glad', 'grateful', 'content', 'excited', 'hopeful', 'great', 'wonderful', 'good', 'calm', 'peaceful', 'steady', 'grounded', 'okay', 'fine'],
  neutral: ['neutral', 'average', 'usual', 'normal', 'same', 'nothing much', 'unsure', 'maybe'],
  sadness: ['sad', 'sadness', 'depressed', 'depression', 'down', 'empty', 'numb', 'cry', 'crying', 'tearful', 'lonely', 'alone', 'hopeless', 'worthless', 'grief', 'loss', 'miserable', 'heartbroken', 'flat', 'meaningless'],
  surprise: ['surprised', 'surprise', 'shocked', 'astonished', 'unexpected', 'suddenly', 'startled', 'amazed'],
};

const DISTRESS_EMOTIONS: EmotionLabel[] = ['fear', 'sadness', 'anger', 'disgust'];

// ---------------------------------------------------------------------------
// Runtime guards
// ---------------------------------------------------------------------------

/** The transformer stack needs a browser with WebAssembly; the Express/Netlify
 * server bundle imports this module but never invokes it. */
export function isSemanticRuntimeSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebAssembly !== 'undefined' &&
    typeof WebAssembly.instantiate === 'function' &&
    typeof navigator !== 'undefined'
  );
}

// ---------------------------------------------------------------------------
// Engine state + subscriptions (drives the loading indicator in the UI)
// ---------------------------------------------------------------------------

const engineState: SemanticEngineState = {
  status: 'idle',
  models: {
    neuroscope: { state: 'pending', progress: 0 },
    sentiment: { state: 'pending', progress: 0 },
    emotion: { state: 'pending', progress: 0 },
    embedding: { state: 'pending', progress: 0 },
  },
  progress: 0,
  detail: 'Semantic engine idle.',
};

const listeners = new Set<(state: SemanticEngineState) => void>();

function snapshot(): SemanticEngineState {
  return {
    status: engineState.status,
    models: {
      neuroscope: { ...engineState.models.neuroscope },
      sentiment: { ...engineState.models.sentiment },
      emotion: { ...engineState.models.emotion },
      embedding: { ...engineState.models.embedding },
    },
    progress: engineState.progress,
    detail: engineState.detail,
    reason: engineState.reason,
  };
}

function notify(): void {
  const state = snapshot();
  for (const fn of listeners) {
    try {
      fn(state);
    } catch {
      // a broken listener must never break inference
    }
  }
}

function recomputeOverallProgress(): void {
  const keys = Object.keys(engineState.models) as SemanticModelKey[];
  let sum = 0;
  for (const k of keys) {
    const m = engineState.models[k];
    sum += m.state === 'ready' ? 1 : m.progress;
  }
  engineState.progress = Math.max(0, Math.min(1, sum / keys.length));
}

function refreshStatus(): void {
  const keys = Object.keys(engineState.models) as SemanticModelKey[];
  const ready = keys.filter((k) => engineState.models[k].state === 'ready').length;
  const failed = keys.filter((k) => engineState.models[k].state === 'failed').length;

  let status: SemanticEngineStatus = engineState.status;
  if (ready === keys.length) status = 'ready';
  else if (ready > 0) status = 'partial';
  else if (failed === keys.length) status = 'unavailable';
  else if (keys.some((k) => engineState.models[k].state === 'loading' || engineState.models[k].state === 'ready')) {
    status = 'loading';
  }
  engineState.status = status;
  if (status === 'ready') engineState.detail = 'Semantic engine ready (NeuroScope DistilBERT × RoBERTa ensemble · emotions · embeddings).';
  else if (status === 'partial') {
    engineState.detail = isModelReady('neuroscope')
      ? 'Semantic engine partially ready — supporting models still loading.'
      : 'Primary NeuroScope classifier still loading — supporting models active.';
  } else if (status === 'unavailable') engineState.detail = engineState.reason || 'Semantic models unavailable — using the offline clinical engine.';
  recomputeOverallProgress();
  notify();
}

export function subscribeSemanticState(fn: (state: SemanticEngineState) => void): () => void {
  listeners.add(fn);
  fn(snapshot());
  return () => listeners.delete(fn);
}

export function getSemanticState(): SemanticEngineState {
  return snapshot();
}

/** Which individual models finished loading — used to label analysis output. */
export function isModelReady(key: SemanticModelKey): boolean {
  return engineState.models[key]?.state === 'ready';
}

export function isSemanticReady(): boolean {
  return engineState.status === 'ready' || engineState.status === 'partial';
}

/** True when the primary NeuroScope DistilBERT classifier is loaded and usable. */
export function isNeuroScopeReady(): boolean {
  return engineState.models.neuroscope?.state === 'ready';
}

// ---------------------------------------------------------------------------
// LRU caches
// ---------------------------------------------------------------------------

class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly max: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

const semanticsCache = new LruCache<string, SemanticAnalysis>(400);
const embeddingCache = new LruCache<string, Float32Array>(800);
/** De-duplicates identical concurrent inference calls. */
const inFlightSemantics = new Map<string, Promise<SemanticAnalysis | null>>();

function normalizeText(text: string): string {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function cacheKey(text: string): string {
  return normalizeText(text).toLowerCase();
}

/** The embedding of every question in the pool is stable for the app's
 * lifetime, so this cache is looked up on every adaptive selection. */
export function getCachedEmbedding(text: string): Float32Array | null {
  return embeddingCache.get(cacheKey(text)) || null;
}

export function getCachedSemantics(text: string): SemanticAnalysis | null {
  return semanticsCache.get(cacheKey(text)) || null;
}

export function clearSemanticCaches(): void {
  semanticsCache.clear();
  embeddingCache.clear();
  inFlightSemantics.clear();
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

interface TransformersModule {
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<any>;
  AutoTokenizer: { from_pretrained: (id: string, options?: Record<string, unknown>) => Promise<any> };
  AutoModel: { from_pretrained: (id: string, options?: Record<string, unknown>) => Promise<any> };
  env: any;
}

/** When true, ONNX Runtime executes every model in its own Web Worker instead of
 * on the page's main thread. Transformer inference is CPU-heavy WebAssembly; on the
 * main thread it freezes typing, scrolling and button feedback for as long as each
 * pass runs. The first model load smoke-tests the worker path and switches this off
 * (falling back to main-thread inference) if the browser cannot run it. */
let proxyEnabled = false;
let proxyDecision: Promise<void> | null = null;

let modulePromise: Promise<TransformersModule | null> | null = null;
const pipelinePromises: Partial<Record<SemanticModelKey, Promise<any>>> = {};
const pipelineFailures: Partial<Record<SemanticModelKey, number>> = {};
const loadedPipelines: Partial<Record<SemanticModelKey, any>> = {};
/** Per-model download progress, aggregated across the model's files. */
const fileProgress: Partial<Record<SemanticModelKey, Map<string, number>>> = {};

async function loadTransformersModule(): Promise<TransformersModule | null> {
  if (!isSemanticRuntimeSupported()) {
    engineState.reason =
      'This environment cannot run WebAssembly models (server-side or unsupported browser).';
    return null;
  }
  if (!modulePromise) {
    modulePromise = import('@huggingface/transformers')
      .then((mod: any) => {
        // NeuroScope DistilBERT is a LOCAL model served from this site's own
        // /models/neuroscope-distilbert (not a Hugging Face hub id), so local
        // model loading must stay enabled or every load attempt 404s against
        // huggingface.co/neuroscope-distilbert instead of this server — which
        // is what silently broke the primary classifier before this fix (it
        // would fail twice, get marked 'failed', and the app would run the
        // whole session on the RoBERTa/lexicon fallback with no NeuroScope
        // chip ever appearing). The one cost is that the three hub models
        // below (sentiment/emotion/embedding) each throw away one quick,
        // harmless local-probe 404 before falling through to the hub — far
        // cheaper than losing the primary model outright.
        if (mod?.env) {
          mod.env.allowLocalModels = true;
          mod.env.localModelPath = '/models/';
          mod.env.allowRemoteModels = true;
          mod.env.useBrowserCache = true;
          try {
            if (typeof Worker !== 'undefined' && mod.env.backends?.onnx?.wasm) {
              mod.env.backends.onnx.wasm.proxy = true;
              proxyEnabled = true;
            }
          } catch {
            proxyEnabled = false;
          }
        }
        return mod as TransformersModule;
      })
      .catch((err) => {
        engineState.reason = `Could not load the transformer runtime: ${err?.message || err}`;
        modulePromise = null;
        return null;
      });
  }
  return modulePromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, ms);
    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      }
    );
  });
}

function makeProgressCallback(key: SemanticModelKey) {
  if (!fileProgress[key]) fileProgress[key] = new Map<string, number>();
  const files = fileProgress[key]!;
  return (event: any) => {
    if (!event) return;
    const model = engineState.models[key];
    // Real weight downloads report pct; skip the small config/tokenizer chatter.
    if (event.status === 'progress' && typeof event.progress === 'number') {
      files.set(String(event.file || event.name || 'weights'), event.progress / 100);
      let sum = 0;
      for (const v of files.values()) sum += v;
      model.progress = Math.max(0, Math.min(0.99, files.size ? sum / files.size : 0));
      engineState.detail = `Downloading ${MODEL_LABELS[key]}… ${Math.round(model.progress * 100)}%`;
    } else if (event.status === 'ready') {
      model.progress = Math.max(model.progress, 0.99);
      engineState.detail = `Loading ${MODEL_LABELS[key]} into memory…`;
    }
    recomputeOverallProgress();
    notify();
  };
}

/** One tiny inference to prove the pipeline (and, when enabled, its worker) works. */
async function smokeTestPipeline(pipe: any, key: SemanticModelKey): Promise<void> {
  const call =
    key === 'embedding'
      ? pipe('ok', { pooling: 'mean', normalize: true })
      : key === 'neuroscope'
        ? pipe('ok', { topk: 1 })
        : pipe('ok', { topk: 1 });
  const result = await withTimeout(Promise.resolve(call), 12000);
  if (result == null) throw new Error('smoke test produced no output');
}

/**
 * Builds a pipeline. The first model to load also decides whether the ONNX
 * worker (proxy) mode is usable; every other model waits for that decision so all
 * sessions are created in the same mode.
 */
async function createPipelineSafely(mod: TransformersModule, key: SemanticModelKey, task: string): Promise<any> {
  const make = () =>
    mod.pipeline(task, SEMANTIC_MODELS[key], {
      dtype: DEFAULT_DTYPE,
      device: 'wasm',
      progress_callback: makeProgressCallback(key),
    });

  if (!proxyEnabled) return make();
  if (proxyDecision) {
    await proxyDecision;
    return make();
  }

  let settle!: () => void;
  proxyDecision = new Promise<void>((resolve) => (settle = resolve));
  let decided = false;
  try {
    let pipe = await make();
    try {
      await smokeTestPipeline(pipe, key);
    } catch (err) {
      console.info('ONNX worker mode unavailable — running the models on the main thread instead:', err);
      proxyEnabled = false;
      try {
        mod.env.backends.onnx.wasm.proxy = false;
      } catch {
        // ignore
      }
      try {
        await pipe?.dispose?.();
      } catch {
        // ignore
      }
      pipe = await make();
    }
    decided = true;
    return pipe;
  } finally {
    // A failed download must not lock the decision in; the next attempt re-decides.
    if (!decided) proxyDecision = null;
    settle();
  }
}

async function getPipeline(key: SemanticModelKey, waitMs = MODEL_WAIT_TIMEOUT_MS): Promise<any | null> {
  // The primary dual-head model is driven directly (tokenizer + model) instead
  // of through the text-classification pipeline, because its ONNX graph exposes
  // two outputs (status_logits + risk_logits) that the stock pipeline cannot read.
  if (key === 'neuroscope') {
    const ok = await ensureNeuroScope(waitMs === MODEL_WAIT_TIMEOUT_MS ? 180000 : waitMs);
    return ok ? neuroscopePipeline : null;
  }
  if (loadedPipelines[key]) return loadedPipelines[key];
  if ((pipelineFailures[key] || 0) >= 2) return null;
  if (!pipelinePromises[key]) {
    const task = key === 'embedding' ? 'feature-extraction' : 'text-classification';
    engineState.models[key].state = 'loading';
    engineState.detail = `Loading ${MODEL_LABELS[key]}…`;
    refreshStatus();

    pipelinePromises[key] = (async () => {
      const mod = await loadTransformersModule();
      if (!mod) {
        engineState.models[key].state = 'failed';
        delete fileProgress[key];
        refreshStatus();
        return null;
      }
      const pipe = await createPipelineSafely(mod, key, task);
      engineState.models[key].state = 'ready';
      engineState.models[key].progress = 1;
      loadedPipelines[key] = pipe;
      refreshStatus();
      return pipe;
    })().catch((err) => {
      pipelineFailures[key] = (pipelineFailures[key] || 0) + 1;
      pipelinePromises[key] = undefined;
      if ((pipelineFailures[key] || 0) >= 2) {
        engineState.models[key].state = 'failed';
        engineState.reason = engineState.reason || `Model unavailable: ${err?.message || err}`;
      } else {
        engineState.models[key].state = 'pending';
      }
      refreshStatus();
      return null;
    }) as Promise<any>;
  }
  return withTimeout(pipelinePromises[key]!, waitMs);
}

/**
 * Kick off model downloads in the background. Called when an assessment
 * starts, so the quantized weights (cached after the first run) download
 * while the user is still reading question one.
 *
 * The PRIMARY NeuroScope DistilBERT (65MB, served from this site) downloads
 * first — it is the classification engine every answer is scored against —
 * followed by the small embedding model, then the supporting sentiment and
 * emotion classifiers. The embedding model still gates question selection
 * and research retrieval, so it stays second rather than last.
 *
 * Safe to call repeatedly; returns true as soon as at least one model is ready.
 */
export async function warmSemanticEngine(options?: { timeoutMs?: number }): Promise<boolean> {
  if (!isSemanticRuntimeSupported()) {
    engineState.reason =
      'This environment cannot run WebAssembly models (server-side or unsupported browser).';
    engineState.status = 'unavailable';
    notify();
    return false;
  }
  if (engineState.status === 'idle') {
    engineState.status = 'loading';
    engineState.detail = 'Starting the semantic engine…';
    notify();
  }
  const budget = options?.timeoutMs ?? 45000;
  const order: SemanticModelKey[] = ['neuroscope', 'embedding', 'sentiment', 'emotion'];

  // Resolve as soon as the FIRST model is usable — the primary NeuroScope
  // classifier, whose reading is what every subsequent step consumes.
  const firstReady = await getPipeline(order[0], budget);

  // Keep loading the rest in the background (embedding gates adaptive question
  // selection + research retrieval; sentiment/emotion are supporting reads).
  void (async () => {
    for (const key of order.slice(1)) {
      await getPipeline(key, 180000);
    }
  })();

  if (firstReady) return true;
  // The primary model is slow/unavailable: report whether any other model made it.
  const fallback = await getPipeline(order[1], 3000);
  return !!fallback || isSemanticReady();
}

/** Force a retry after a transient failure (e.g. the user came back online). */
export function resetSemanticEngine(): void {
  for (const key of Object.keys(pipelinePromises) as SemanticModelKey[]) {
    pipelinePromises[key] = undefined;
    pipelineFailures[key] = 0;
  }
  modulePromise = null;
  neuroscopePipeline = null;
  neuroscopeTokenizer = null;
  neuroscopePromise = null;
  neuroscopeFailures = 0;
  clearSemanticCaches();
  engineState.status = 'idle';
  engineState.reason = undefined;
  engineState.detail = 'Semantic engine idle.';
  refreshStatus();
}

// ---------------------------------------------------------------------------
// PRIMARY model: NeuroScope DistilBERT dual-head (status + risk)
// ---------------------------------------------------------------------------

let neuroscopePipeline: any = null;
let neuroscopeTokenizer: any = null;
let neuroscopePromise: Promise<boolean> | null = null;
let neuroscopeFailures = 0;

/** Loads the tokenizer + dual-head model from this site's /models directory.
 * The plain id "neuroscope-distilbert" resolves locally first (files under
 * public/models/neuroscope-distilbert) — it is not a hub id, so the remote
 * fetch that normal hub models fall back to can never hit it. The ONNX
 * worker decision is awaited so the session is created in whichever mode
 * (proxy or main-thread) actually works in this browser. */
async function ensureNeuroScope(timeoutMs = 180000): Promise<boolean> {
  if (neuroscopePipeline) return true;
  if (neuroscopeFailures >= 2) return false;
  if (!neuroscopePromise) {
    neuroscopePromise = (async () => {
      const mod = await loadTransformersModule();
      if (!mod) return false;
      if (proxyDecision) await proxyDecision;
      const tokenizer = await mod.AutoTokenizer.from_pretrained(SEMANTIC_MODELS.neuroscope);
      const model = await mod.AutoModel.from_pretrained(SEMANTIC_MODELS.neuroscope, {
        dtype: DEFAULT_DTYPE,
        device: 'wasm',
        progress_callback: makeProgressCallback('neuroscope'),
      });
      // One tiny pass to prove the session works; on failure the main-thread
      // fallback (proxy off) gets one more attempt below.
      try {
        await withTimeout(Promise.resolve(model(tokenizer('ok'))), 12000);
      } catch (err) {
        if (proxyEnabled) {
          proxyEnabled = false;
          try {
            mod.env.backends.onnx.wasm.proxy = false;
            await model?.dispose?.();
          } catch {
            // ignore
          }
          const retry = await mod.AutoModel.from_pretrained(SEMANTIC_MODELS.neuroscope, {
            dtype: DEFAULT_DTYPE,
            device: 'wasm',
            progress_callback: makeProgressCallback('neuroscope'),
          });
          neuroscopePipeline = retry;
          neuroscopeTokenizer = tokenizer;
          engineState.models.neuroscope.state = 'ready';
          engineState.models.neuroscope.progress = 1;
          refreshStatus();
          return true;
        }
        throw err;
      }
      neuroscopePipeline = model;
      neuroscopeTokenizer = tokenizer;
      engineState.models.neuroscope.state = 'ready';
      engineState.models.neuroscope.progress = 1;
      refreshStatus();
      return true;
    })()
      .catch((err) => {
        neuroscopeFailures += 1;
        neuroscopePromise = null;
        engineState.models.neuroscope.state = neuroscopeFailures >= 2 ? 'failed' : 'pending';
        if (neuroscopeFailures >= 2) {
          engineState.reason =
            engineState.reason || `Primary classifier unavailable: ${err?.message || err}`;
        }
        refreshStatus();
        return false;
      })
      .finally(() => {
        if (neuroscopePipeline) neuroscopePromise = null;
      });
  }
  return (await withTimeout(neuroscopePromise, timeoutMs)) === true;
}

/** Softmax over one logits row. */
function softmaxRow(values: ArrayLike<number>): number[] {
  const max = Array.from(values).reduce((a, b) => Math.max(a, b), -Infinity);
  const exps = Array.from(values).map((v) => Math.exp(v - max));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map((e) => e / sum);
}

/** Derive the dynamic risk band from the model's own heads: the recall-first
 * risk probability drives the level, nudged up by a confident clinical
 * dimension and pulled toward low by a confident Normal read. Bands line up
 * with the risk engine's 0-100 score thresholds (elevated >= 30, high >= 55,
 * critical >= 80) so both engines agree when both fire. */
function bandFromHeads(pRisk: number, top: NeuroScopeStatus, pTop: number): RiskLevel {
  const confident = pTop >= 0.45;
  const weight = STATUS_BAND_WEIGHT[top];
  if (pRisk >= 0.85 || (confident && top === 'Suicidal' && pRisk >= 0.6)) return 'critical';
  if (pRisk >= 0.55 || (confident && top === 'Suicidal' && pRisk >= 0.35)) return 'high';
  if (pRisk >= NEUROSCOPE_MODEL_INFO.riskThreshold + 0.05) {
    return weight >= 0.4 ? 'elevated' : pRisk >= 0.32 ? 'elevated' : 'low';
  }
  if (pRisk >= NEUROSCOPE_MODEL_INFO.riskThreshold && confident && weight >= 0.5) return 'elevated';
  if (top === 'Normal' && pTop >= 0.5 && pRisk < 0.1) return 'low';
  return pRisk >= 0.35 ? 'elevated' : 'low';
}

/** Run the PRIMARY classifier over one text. Returns null when the model is
 * still downloading or failed — supporting models then carry the reading. */
export async function classifyWithNeuroScope(
  text: string,
  timeoutMs = INFERENCE_TIMEOUT_MS
): Promise<NeuroScopeReading | null> {
  const clean = normalizeText(text);
  if (clean.length < 2) return null;
  const loaded = await ensureNeuroScope(isNeuroScopeReady() ? Math.min(timeoutMs, 2000) : 250);
  if (!loaded || !neuroscopePipeline || !neuroscopeTokenizer) return null;

  const run = (async () => {
    const inputs = neuroscopeTokenizer(clean.slice(0, MAX_CLASSIFY_CHARS), {
      padding: true,
      truncation: true,
      max_length: 512,
    });
    const output = await neuroscopePipeline(inputs);
    const statusTensor = output.status_logits ?? output.logits;
    const riskTensor = output.risk_logits;
    if (!statusTensor) return null;

    const statusData: number[] = Array.from(statusTensor.data ?? statusTensor.tolist?.()[0] ?? []);
    const probs = softmaxRow(statusData);
    const order = probs
      .map((p, idx) => ({ label: NEUROSCOPE_MODEL_INFO.dimensions[idx], p }))
      .sort((a, b) => b.p - a.p);
    const top = order[0];

    let riskData: number[] = [];
    if (riskTensor) riskData = Array.from(riskTensor.data ?? riskTensor.tolist?.() ?? []);
    const pRisk = riskData.length === 1 ? 1 / (1 + Math.exp(-riskData[0])) : 0;
    let band = bandFromHeads(pRisk, top.label, top.p);

    // Hard safety override, mirrored from the risk engine: explicit
    // self-harm/suicide language must never be left reading as "low"/
    // "elevated" just because the model's own confidence was weak or its
    // top predicted dimension was something other than "Suicidal" (e.g. a
    // plainly-worded "I even feel like ending everything" scored as
    // low-confidence "Depression" rather than a risk signal). The model's
    // own read is still shown for transparency, but the band it drives is
    // always at least critical when the deterministic marker scan fires.
    const overridden = hasImminentRiskLanguage(text);
    if (overridden) band = 'critical';

    // Protective/denial de-escalation — the inverse counterpart of the
    // imminent-language override above. A raw high/critical read on an
    // answer that contains NO distress or imminent language, but does
    // contain protective/denial phrasing (see PROTECTIVE_MARKERS in
    // riskEngine.ts — e.g. "not just worst-case ones"), is capped down to
    // elevated rather than shown as-is. This never runs when imminent
    // language is present (that check already returned above it) and never
    // runs when distress markers are ALSO present, so a genuinely mixed
    // answer ("I usually think it through, but lately I feel hopeless") is
    // left untouched. It only softens — it never drops a reading below
    // "elevated" — so a misfire still surfaces for human follow-up instead
    // of disappearing.
    const markers = scanRiskMarkers(text);
    let deescalated = false;
    if (
      !overridden &&
      markers.distress.length === 0 &&
      markers.protective.length > 0 &&
      (band === 'critical' || band === 'high')
    ) {
      band = 'elevated';
      deescalated = true;
    }

    const reading: NeuroScopeReading = {
      topStatus: top.label,
      pTop: Number(top.p.toFixed(4)),
      top3: order.slice(0, 3).map((r) => ({ label: r.label, p: Number(r.p.toFixed(4)) })),
      pRisk: Number(pRisk.toFixed(4)),
      riskFlag: overridden ? true : pRisk >= NEUROSCOPE_MODEL_INFO.riskThreshold,
      band,
      summary: overridden
        ? `Explicit self-harm language detected — overriding model read (was ${top.label}, ${Math.round(top.p * 100)}%) to critical.`
        : deescalated
          ? `Protective/denial language detected ("${markers.protective[0]}") alongside a ${top.label} dimension read (${Math.round(top.p * 100)}%) — capped to elevated pending review, not dismissed.`
          : top.label === 'Normal' && pRisk < 0.2
            ? `Primary classifier: Normal dimension (${Math.round(top.p * 100)}% confidence), low risk signal (${Math.round(pRisk * 100)}%).`
            : `Primary classifier: ${top.label} dimension dominant (${Math.round(top.p * 100)}%), risk probability ${Math.round(pRisk * 100)}% — ${band} band.`,
      source: 'neuroscope-distilbert',
    };
    return reading;
  })();

  return withTimeout(run, timeoutMs);
}

// ---------------------------------------------------------------------------
// Classification output normalization
// ---------------------------------------------------------------------------

interface RawLabelScore {
  label: string;
  score: number;
}

/** Flattens whatever shape the pipeline returns (single object, flat array, or
 * nested arrays for batched inputs) into a flat label/score list. */
function flattenClassificationOutput(raw: any): RawLabelScore[] {
  const out: RawLabelScore[] = [];
  const walk = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (typeof node === 'object' && typeof node.label === 'string' && typeof node.score === 'number') {
      out.push({ label: node.label, score: node.score });
    }
  };
  walk(raw);
  return out;
}

function isEmotionLabel(value: string): value is EmotionLabel {
  return (['anger', 'disgust', 'fear', 'joy', 'neutral', 'sadness', 'surprise'] as string[]).includes(value);
}

/** Offline fallback: score the emotion lexicon, then spread the remainder to
 * `neutral` so the distribution still sums to ~1 and can be compared with the
 * transformer output downstream. */
function lexiconEmotions(text: string): EmotionClassification {
  const lower = ` ${(text || '').toLowerCase()} `;
  const totals: Record<EmotionLabel, number> = {
    anger: 0,
    disgust: 0,
    fear: 0,
    joy: 0,
    neutral: 0,
    sadness: 0,
    surprise: 0,
  };
  for (const label of Object.keys(EMOTION_LEXICON) as EmotionLabel[]) {
    for (const word of EMOTION_LEXICON[label]) {
      if (lower.includes(word)) totals[label] += word.includes(' ') ? 2 : 1;
    }
  }
  const hits = (Object.keys(totals) as EmotionLabel[]).reduce((sum, l) => sum + totals[l], 0);
  const zeroHits = hits === 0;
  if (zeroHits) totals.neutral = 1;
  else totals.neutral += Math.max(1, hits * 0.35);

  const total = (Object.keys(totals) as EmotionLabel[]).reduce((sum, l) => sum + totals[l], 0) || 1;
  const all: EmotionScore[] = (Object.keys(totals) as EmotionLabel[])
    .map((label) => ({ label, score: totals[label] / total }))
    .sort((a, b) => b.score - a.score);
  const distressWeight = all
    .filter((e) => DISTRESS_EMOTIONS.includes(e.label))
    .reduce((sum, e) => sum + e.score, 0);

  return {
    top: all[0],
    all,
    distressWeight,
    distressDominant: DISTRESS_EMOTIONS.includes(all[0].label),
    source: 'lexicon',
    // zeroHits means nothing in EMOTION_LEXICON matched at all — "100%
    // neutral" here is a made-up default, not a read of the text, so flag it
    // rather than let a caller display it as a confident classification.
    defaulted: zeroHits,
  };
}

/**
 * Maps a PRIMARY NeuroScope DistilBERT reading onto the app's four-way tone
 * scale (severe/distressed/neutral/calm). This is what the "Tone" chip and
 * the adaptive engine's sentiment score now read from whenever the primary
 * model is loaded — it replaces the generic hub RoBERTa classifier as the
 * tone driver, because RoBERTa's Twitter-sentiment training gives it no
 * grounding in clinical screening language: it has no way to tell a denial
 * ("Never — I don't recognize those feelings in myself") from a heavy one,
 * where NeuroScope's own "Normal" dimension and low risk head do.
 *
 * Reuses the same dynamic `band` (low/elevated/high/critical) the risk
 * engine already derives from the model's two heads (`bandFromHeads`), so
 * the tone label and the risk band can never disagree with each other.
 */
export function sentimentFromNeuroScope(reading: NeuroScopeReading): SentimentResult {
  const normalPull = reading.topStatus === 'Normal' ? reading.pTop : 0;
  const score = Math.max(-1, Math.min(1, normalPull - reading.pRisk * 1.4));

  let label: SentimentResult['label'] = 'neutral';
  if (reading.band === 'critical' || reading.band === 'high') label = 'severe';
  else if (reading.band === 'elevated') label = 'distressed';
  else if (reading.topStatus === 'Normal' && reading.pTop >= 0.4) label = 'calm';

  const magnitude = Math.max(0, Math.min(1, Math.max(reading.pRisk, Math.abs(normalPull - 0.5) + 0.2)));

  return {
    score: Number(score.toFixed(3)),
    label,
    magnitude: Number(magnitude.toFixed(3)),
    source: 'neuroscope',
  };
}

/**
 * Confidence-weighted ensemble of the two fine-tuned transformers.
 *
 * Previously the app ran NeuroScope and RoBERTa side by side but only ever
 * used ONE of them for the tone verdict — NeuroScope when it was ready,
 * RoBERTa only as a stand-in while NeuroScope was still downloading. RoBERTa's
 * read was thrown away the moment NeuroScope became available, even though it
 * is a second, independently-trained opinion running on the exact same
 * answer. This function instead fuses both into one reading whenever both are
 * available, so the tone/risk verdict reflects two models' agreement (or
 * disagreement) rather than one model's opinion alone.
 *
 * Weighting: NeuroScope is the clinically fine-tuned model (trained on the
 * 7-way status + risk labels this app screens for), so it always keeps the
 * majority share. Its share grows further with its own confidence (`pTop`) —
 * a NeuroScope read it is very sure about should dominate a generic
 * Twitter-sentiment read even more; a NeuroScope read it is unsure about
 * leaves more room for RoBERTa to pull the fused score.
 *
 * Agreement/confidence: when the two models land on the same side of neutral,
 * the fused magnitude is boosted (two independent models corroborating each
 * other is stronger evidence than either alone). When they disagree, the
 * fused magnitude is damped instead of averaged blindly — a confident-looking
 * single-model read that the other model contradicts should present as LESS
 * certain, not get smoothed into a falsely confident middle score. Callers
 * (adaptive question selection, the tone chip) can read `confidence` to tell
 * a corroborated reading apart from a genuinely ambiguous one.
 */
export function ensembleTransformerSentiment(
  neuroscope: NeuroScopeReading,
  roberta: SentimentResult
): SentimentResult {
  const neuroscopeSentiment = sentimentFromNeuroScope(neuroscope);

  // NeuroScope's share of the vote: 0.6 base, growing toward 0.85 as the
  // model's own top-class confidence (pTop) rises. Suicidal-band readings are
  // never diluted by the generic sentiment model — safety-critical output
  // must stay attributable to the clinically fine-tuned classifier alone.
  if (neuroscope.band === 'critical' || neuroscope.topStatus === 'Suicidal') {
    return { ...neuroscopeSentiment, source: 'ensemble', confidence: 1 };
  }

  const neuroscopeWeight = Math.max(0.6, Math.min(0.85, 0.6 + 0.25 * neuroscope.pTop));
  const robertaWeight = 1 - neuroscopeWeight;

  const score = Math.max(
    -1,
    Math.min(1, neuroscopeWeight * neuroscopeSentiment.score + robertaWeight * roberta.score)
  );

  // Agreement: 1 when both models land on the same side of neutral with
  // similar strength, 0 when they point in opposite directions.
  const agreement = Math.max(0, 1 - Math.abs(neuroscopeSentiment.score - roberta.score) / 2);
  const bothMeaningful = Math.abs(neuroscopeSentiment.score) > 0.1 && Math.abs(roberta.score) > 0.1;
  const sameSide = Math.sign(neuroscopeSentiment.score || 0) === Math.sign(roberta.score || 0);
  const corroborated = bothMeaningful && sameSide;

  const blendedMagnitude = neuroscopeWeight * neuroscopeSentiment.magnitude + robertaWeight * roberta.magnitude;
  const magnitude = Math.max(
    0,
    Math.min(1, corroborated ? blendedMagnitude * (1 + 0.2 * agreement) : blendedMagnitude * (0.55 + 0.45 * agreement))
  );

  let label: SentimentResult['label'] = 'neutral';
  if (score <= -0.5) label = 'severe';
  else if (score < -0.05) label = 'distressed';
  else if (score > 0.05) label = 'calm';

  // Severity stays sticky: either model flagging severe/critical language
  // keeps the fused verdict severe, same safety rule as `mergeSentimentReadings`.
  if (neuroscopeSentiment.label === 'severe' || roberta.label === 'severe' || neuroscope.riskFlag) {
    label = 'severe';
  }

  return {
    score: Number(score.toFixed(3)),
    label,
    magnitude: Number(magnitude.toFixed(3)),
    source: 'ensemble',
    confidence: Number(agreement.toFixed(3)),
  };
}

/**
 * Calls the server's `/api/tone-analysis` route: a Groq-hosted LLM's own
 * read of this text's tone/emotion, used as the THIRD ensemble member
 * alongside the two on-device transformers above. This is what stops the
 * assessment from resting on NeuroScope DistilBERT + RoBERTa alone — a
 * general-purpose LLM catches contextual nuance (negation, sarcasm, indirect
 * distress phrasing) that two small fine-tuned classifiers can miss.
 *
 * Best-effort and bounded: aborts at `timeoutMs` (default 6s, deliberately
 * short since this runs once per free-text answer during a live assessment)
 * and NEVER throws — a timeout, offline state, or every provider failing
 * server-side (Groq, Groq #2, Gemini all down) all just resolve to `null`,
 * and callers fall back to the two-transformer ensemble unchanged.
 */
export async function fetchGroqToneReading(text: string, timeoutMs = 6000): Promise<SentimentResult | null> {
  if (typeof fetch !== 'function' || !text || text.trim().length < 2) return null;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('/api/tone-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ text }),
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.available === false) return null;

    const label: SentimentResult['label'] = ['severe', 'distressed', 'neutral', 'calm'].includes(data.label)
      ? data.label
      : 'neutral';
    const score = Math.max(-1, Math.min(1, Number(data.score)));
    const magnitude = Math.max(0, Math.min(1, Number(data.magnitude)));
    return {
      score: Number.isFinite(score) ? Number(score.toFixed(3)) : 0,
      label,
      magnitude: Number.isFinite(magnitude) ? Number(magnitude.toFixed(3)) : 0,
      source: 'groq',
    };
  } catch {
    // Aborted, offline, or malformed response — treat exactly like "no reading".
    return null;
  }
}

/**
 * Three-way confidence-weighted ensemble: NeuroScope DistilBERT + RoBERTa +
 * a Groq-hosted LLM's independent read (`fetchGroqToneReading`). Builds on
 * `ensembleTransformerSentiment()` above rather than duplicating it — the two
 * on-device transformers are fused first (same clinically-grounded weighting
 * and safety bypass), and Groq's read is folded into THAT result as a third
 * opinion, not averaged in from scratch.
 *
 * Groq is now run as the PRIMARY tone/emotion engine — its share of the vote
 * is the majority whenever it answers — but it always operates inside the
 * rules the two tuned transformers set, never outside them: NeuroScope
 * DistilBERT and RoBERTa act as the clinically-grounded governing layer
 * around Groq's read, not as a peer vote competing with it on equal footing:
 *   - The critical/suicidal-band safety bypass below fires BEFORE Groq is
 *     ever consulted, exactly as before — a safety-critical NeuroScope
 *     reading is never diluted by a generic LLM's opinion, majority weight
 *     or not.
 *   - Sticky severity still holds: any one of the three readers calling
 *     `severe` — or NeuroScope's own raw risk flag — keeps the fused label
 *     `severe`, so Groq's majority weight can escalate a reading but can
 *     never talk a corroborated `severe` transformer read back down.
 *   - Groq's own system prompt (`TONE_ANALYSIS_SYSTEM_PROMPT` in
 *     `server-app.ts`) is written to classify into the exact same
 *     severe/distressed/neutral/calm taxonomy and -1..1/0..1 scales the two
 *     transformers already use, so its vote is directly comparable, not a
 *     free-form opinion being shoehorned in.
 * Within those hard rules, Groq's weight still flexes with agreement — a
 * touch less room when the transformers already strongly agree with it
 * (little left to correct), a touch more when they disagree (Groq's
 * contextual reasoning — negation, sarcasm, indirect distress phrasing — is
 * most useful exactly there) — but it never drops below a majority once it
 * has answered.
 *
 * When `groq` is `null` (request timed out, offline, or every provider in
 * the tone pool — including Gemini — failed), this degrades to the
 * unchanged two-way NeuroScope × RoBERTa ensemble, exactly as before.
 */
export function ensembleThreeWaySentiment(
  neuroscope: NeuroScopeReading,
  roberta: SentimentResult,
  groq: SentimentResult | null
): SentimentResult {
  const twoWay = ensembleTransformerSentiment(neuroscope, roberta);

  // Safety bypass already fired inside ensembleTransformerSentiment (critical
  // band / Suicidal top-status) — never let Groq's read soften it, majority
  // weight or not.
  if (neuroscope.band === 'critical' || neuroscope.topStatus === 'Suicidal') {
    return { ...twoWay, source: 'ensemble3' };
  }

  if (!groq) return twoWay;

  const twoWayConfidence = twoWay.confidence ?? 0.5;
  // Groq is primary: majority weight (0.55-0.8) whenever it answers. Its
  // share still shrinks a little as the transformers' own agreement rises
  // (less left to correct) and grows when they disagree (more room for
  // Groq's contextual reasoning to tie-break), but the transformers' hard
  // rules above (safety bypass, sticky severity) apply regardless of weight.
  const groqWeight = Math.max(0.55, Math.min(0.8, 0.8 - 0.25 * twoWayConfidence));
  const twoWayWeight = 1 - groqWeight;

  const score = Math.max(-1, Math.min(1, twoWayWeight * twoWay.score + groqWeight * groq.score));

  const agreementWithGroq = Math.max(0, 1 - Math.abs(twoWay.score - groq.score) / 2);
  const confidence = Math.max(0, Math.min(1, twoWayConfidence * 0.6 + agreementWithGroq * 0.4));

  const bothMeaningful = Math.abs(twoWay.score) > 0.1 && Math.abs(groq.score) > 0.1;
  const sameSide = Math.sign(twoWay.score || 0) === Math.sign(groq.score || 0);
  const corroborated = bothMeaningful && sameSide;
  const blendedMagnitude = twoWayWeight * twoWay.magnitude + groqWeight * groq.magnitude;
  const magnitude = Math.max(
    0,
    Math.min(
      1,
      corroborated ? blendedMagnitude * (1 + 0.15 * agreementWithGroq) : blendedMagnitude * (0.6 + 0.4 * agreementWithGroq)
    )
  );

  let label: SentimentResult['label'] = 'neutral';
  if (score <= -0.5) label = 'severe';
  else if (score < -0.05) label = 'distressed';
  else if (score > 0.05) label = 'calm';

  // Sticky severity: any one of the three readers (NeuroScope, RoBERTa, Groq)
  // or NeuroScope's raw risk flag calling this severe keeps it severe.
  if (twoWay.label === 'severe' || groq.label === 'severe' || neuroscope.riskFlag) {
    label = 'severe';
  }

  return {
    score: Number(score.toFixed(3)),
    label,
    magnitude: Number(magnitude.toFixed(3)),
    source: 'ensemble3',
    confidence: Number(confidence.toFixed(3)),
  };
}

/** Map the RoBERTa 3-way head (negative / neutral / positive) onto the app's
 * SentimentResult contract. Supporting/fallback reader only — see
 * `sentimentFromNeuroScope` above for the primary tone reader. */
function sentimentFromProbabilities(probs: Record<string, number>): SentimentResult {
  const pNegative = probs.negative ?? 0;
  const pNeutral = probs.neutral ?? 0;
  const pPositive = probs.positive ?? 0;
  const score = Math.max(-1, Math.min(1, pPositive - pNegative));
  const magnitude = Math.max(0, Math.min(1, 1 - pNeutral));

  let label: SentimentResult['label'] = 'neutral';
  if (score <= -0.55) label = 'severe';
  else if (score <= -0.18) label = 'distressed';
  else if (score >= 0.28) label = 'calm';

  return { score: Number(score.toFixed(3)), label, magnitude: Number(magnitude.toFixed(3)), source: 'transformer' };
}

// ---------------------------------------------------------------------------
// Public inference API
// ---------------------------------------------------------------------------

/** Supporting hub RoBERTa sentiment (fallback for while NeuroScope DistilBERT
 * is still loading — see `sentimentFromNeuroScope` for the primary reader).
 * Returns null when the model is not ready. */
export async function classifySentiment(
  text: string,
  timeoutMs = INFERENCE_TIMEOUT_MS
): Promise<SentimentResult | null> {
  const clean = normalizeText(text);
  if (clean.length < 2) return null;
  const pipe = await getPipeline('sentiment', timeoutMs);
  if (!pipe) return null;
  const result = await withTimeout(
    Promise.resolve(pipe(clean.slice(0, MAX_CLASSIFY_CHARS), { topk: 4 })),
    timeoutMs
  );
  if (!result) return null;
  const rows = flattenClassificationOutput(result);
  if (!rows.length) return null;

  const probs: Record<string, number> = {};
  for (const row of rows) {
    probs[row.label.toLowerCase()] = (probs[row.label.toLowerCase()] || 0) + row.score;
  }
  // Some exports emit LABEL_0/1/2 instead of names; map by known order.
  if (!('negative' in probs) && !('positive' in probs)) {
    const ordered = rows.slice().sort((a, b) => a.label.localeCompare(b.label));
    const names = ['negative', 'neutral', 'positive'];
    ordered.slice(0, 3).forEach((row, idx) => {
      probs[names[idx]] = row.score;
    });
  }
  return sentimentFromProbabilities(probs);
}

/** Multi-class emotion distribution. Falls back to the offline lexicon when the
 * classifier is unavailable, so this never returns null. */
export async function classifyEmotions(
  text: string,
  timeoutMs = INFERENCE_TIMEOUT_MS
): Promise<EmotionClassification> {
  const clean = normalizeText(text);
  if (clean.length < 2) return lexiconEmotions(clean);
  const pipe = await getPipeline('emotion', timeoutMs);
  if (!pipe) return lexiconEmotions(clean);

  const result = await withTimeout(
    Promise.resolve(pipe(clean.slice(0, MAX_CLASSIFY_CHARS), { topk: 8 })),
    timeoutMs
  );
  if (!result) return lexiconEmotions(clean);
  const rows = flattenClassificationOutput(result).filter((r) => isEmotionLabel(r.label.toLowerCase()));
  if (!rows.length) return lexiconEmotions(clean);

  const all: EmotionScore[] = rows
    .map((r) => ({ label: r.label.toLowerCase() as EmotionLabel, score: r.score }))
    .sort((a, b) => b.score - a.score);
  const distressWeight = all
    .filter((e) => DISTRESS_EMOTIONS.includes(e.label))
    .reduce((sum, e) => sum + e.score, 0);

  return {
    top: all[0],
    all,
    distressWeight,
    distressDominant: DISTRESS_EMOTIONS.includes(all[0].label) && distressWeight >= 0.5,
    source: 'transformer',
  };
}

/** Embed one text. Returns null when the embedding model is not ready. */
export async function embedText(text: string, timeoutMs = INFERENCE_TIMEOUT_MS): Promise<Float32Array | null> {
  const vectors = await embedMany([text], timeoutMs);
  return vectors ? vectors[0] : null;
}

/** Embed a batch of texts (used for the question pool and the research corpus).
 * Large batches are split into small forward passes so a single call never holds
 * the inference queue for long. Returns null when the model is not ready. */
const EMBED_CHUNK = 16;
export async function embedMany(texts: string[], timeoutMs = BATCH_TIMEOUT_MS): Promise<Float32Array[] | null> {
  const cleans = texts.map((t) => normalizeText(t).slice(0, MAX_EMBED_CHARS));
  if (!cleans.length) return [];
  // If the model is still downloading, do not make the caller wait for it: every
  // caller of this function has an offline (lexical) fallback.
  const pipe = await getPipeline('embedding', isModelReady('embedding') ? Math.min(timeoutMs, 4000) : 300);
  if (!pipe) return null;

  const rows: Float32Array[] = [];
  try {
    for (let i = 0; i < cleans.length; i += EMBED_CHUNK) {
      const output = await withTimeout(
        Promise.resolve(pipe(cleans.slice(i, i + EMBED_CHUNK), { pooling: 'mean', normalize: true })),
        timeoutMs
      );
      if (!output) return null;
      const list: number[][] | number[] = typeof output.tolist === 'function' ? output.tolist() : output;
      if (!Array.isArray(list) || !list.length) return null;
      const part: number[][] = typeof list[0] === 'number' ? [list as number[]] : (list as number[][]);
      for (const row of part) rows.push(Float32Array.from(row));
    }
  } catch {
    return null;
  }
  return rows;
}

/** De-duplicates identical concurrent embedding requests (the answer text is
 * embedded by tone analysis, risk similarity, research retrieval and question
 * selection — all at about the same moment). */
const inFlightEmbeddings = new Map<string, Promise<Float32Array | null>>();

/** Cached embedding lookup: returns instantly for anything already embedded. */
export async function embedCached(text: string, timeoutMs = INFERENCE_TIMEOUT_MS): Promise<Float32Array | null> {
  const key = cacheKey(text);
  const cached = embeddingCache.get(key);
  if (cached) return cached;
  const active = inFlightEmbeddings.get(key);
  if (active) return active;
  const task = embedText(text, timeoutMs)
    .then((vector) => {
      if (vector) embeddingCache.set(key, vector);
      return vector;
    })
    .finally(() => {
      inFlightEmbeddings.delete(key);
    });
  inFlightEmbeddings.set(key, task);
  return task;
}

/** Fire-and-forget background embedding of a text list (question pool warm-up).
 * Individual failures are ignored; this never blocks the caller. */
export async function prewarmEmbeddings(texts: string[]): Promise<number> {
  const missing = texts.filter((t) => t && t.trim() && !embeddingCache.has(cacheKey(t)));
  if (!missing.length) return 0;
  const vectors = await embedMany(missing, BATCH_TIMEOUT_MS);
  if (!vectors) return 0;
  missing.forEach((text, idx) => {
    if (vectors[idx]) embeddingCache.set(cacheKey(text), vectors[idx]);
  });
  return vectors.filter(Boolean).length;
}

export function cosineSimilarity(a: Float32Array | number[], b: Float32Array | number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** Cosine mapped onto the engine's 0..1 relevance scale. MiniLM sentence pairs
 * sit around 0.1-0.3 when unrelated and 0.5-0.8 when genuinely related, so the
 * useful band is stretched across the full range. */
export function semanticRelevanceScore(cosine: number): number {
  return Math.max(0, Math.min(1, (cosine - 0.2) / 0.6));
}

let riskExemplarVectors: Float32Array[] | null = null;

async function ensureRiskExemplars(timeoutMs = BATCH_TIMEOUT_MS): Promise<Float32Array[] | null> {
  if (riskExemplarVectors) return riskExemplarVectors;
  const vectors = await embedMany(HIGH_RISK_EXEMPLARS, timeoutMs);
  if (!vectors) return null;
  riskExemplarVectors = vectors;
  return riskExemplarVectors;
}

/** Highest cosine similarity between the text and the high-risk exemplar bank.
 * Returns null when embeddings are unavailable so the risk engine can tell
 * "no semantic signal" apart from "semantic signal says no risk". */
export async function semanticRiskSimilarity(
  textOrVector: string | Float32Array,
  timeoutMs = INFERENCE_TIMEOUT_MS
): Promise<number | null> {
  let vector: Float32Array | null;
  if (typeof textOrVector === 'string') vector = await embedCached(textOrVector, timeoutMs);
  else vector = textOrVector;
  if (!vector) return null;

  const exemplars = await ensureRiskExemplars();
  if (!exemplars) return null;

  let best = -1;
  for (const exemplar of exemplars) {
    const cos = cosineSimilarity(vector, exemplar);
    if (cos > best) best = cos;
  }
  return best < 0 ? null : Number(best.toFixed(4));
}

/** Similarity between two texts, or null when embeddings are unavailable. */
export async function semanticRelevance(
  query: string,
  target: string,
  timeoutMs = INFERENCE_TIMEOUT_MS
): Promise<number | null> {
  const [a, b] = await Promise.all([embedCached(query, timeoutMs), embedCached(target, timeoutMs)]);
  if (!a || !b) return null;
  return semanticRelevanceScore(cosineSimilarity(a, b));
}

/**
 * Rank a set of candidate texts by semantic similarity to a query. Candidates
 * already in the embedding cache (the question pool) cost nothing. Returns
 * null when the embedding model is unavailable, so callers can fall back to
 * the TF-weighted scorer.
 */
export async function rankBySemanticSimilarity(
  query: string,
  candidates: { id: string | number; text: string }[],
  timeoutMs = BATCH_TIMEOUT_MS
): Promise<Map<string | number, number> | null> {
  const queryVector = await embedCached(query, timeoutMs);
  if (!queryVector) return null;

  const uncached = candidates.filter((c) => !embeddingCache.has(cacheKey(c.text)));
  if (uncached.length) {
    const vectors = await embedMany(
      uncached.map((c) => c.text),
      timeoutMs
    );
    if (!vectors) return null;
    uncached.forEach((c, idx) => {
      if (vectors[idx]) embeddingCache.set(cacheKey(c.text), vectors[idx]);
    });
  }

  const scores = new Map<string | number, number>();
  for (const candidate of candidates) {
    const vector = embeddingCache.get(cacheKey(candidate.text));
    if (!vector) continue;
    scores.set(candidate.id, semanticRelevanceScore(cosineSimilarity(queryVector, vector)));
  }
  return scores.size ? scores : null;
}

// ---------------------------------------------------------------------------
// Combined pass
// ---------------------------------------------------------------------------

/**
 * One semantic pass over a user answer: NeuroScope DistilBERT (primary
 * status + risk read), supporting RoBERTa sentiment, the 7-way emotion
 * distribution, and cosine similarity to the crisis-language exemplars. Runs
 * the models concurrently and memoizes the result.
 *
 * Returns null only when *no* model produced anything (offline / unsupported
 * browser), in which case the caller keeps using the lexicon engine.
 */
export async function analyzeTextSemantics(
  text: string,
  options?: { timeoutMs?: number; includeRiskSimilarity?: boolean }
): Promise<SemanticAnalysis | null> {
  const clean = normalizeText(text);
  if (clean.length < 2) return null;
  const key = cacheKey(clean);
  const includeRisk = options?.includeRiskSimilarity !== false;
  const timeoutMs = options?.timeoutMs ?? INFERENCE_TIMEOUT_MS;
  // A model that is still downloading must not stall the caller: give it a moment,
  // fall back to the lexicon for this answer, and stay warm for the next one.
  const waitFor = (model: SemanticModelKey) => (isModelReady(model) ? timeoutMs : 250);

  const cached = semanticsCache.get(key);
  if (cached) {
    // Upgrade paths for readings cached before every model was warm: fill in
    // only the missing piece instead of re-running the whole classifier bank.
    if (includeRisk && cached.riskSimilarity === null) {
      const riskSimilarity = await semanticRiskSimilarity(clean, waitFor('embedding'));
      if (riskSimilarity !== null) {
        cached.riskSimilarity = riskSimilarity;
      }
    }
    if (!cached.neuroscope && isModelReady('neuroscope')) {
      const reading = await classifyWithNeuroScope(clean, Math.min(timeoutMs, 3000));
      if (reading) {
        cached.neuroscope = reading;
        cached.degraded = false;
        // The primary model just became available for this text — upgrade the
        // tone reading to the fused ensemble when RoBERTa already produced a
        // read for the same text (folding in a cached Groq read too, if one
        // exists), otherwise NeuroScope's own reading alone.
        cached.sentiment =
          cached.sentiment.source === 'transformer'
            ? ensembleThreeWaySentiment(reading, cached.sentiment, cached.groq ?? null)
            : sentimentFromNeuroScope(reading);
        cached.ensembleAgreement = cached.sentiment.confidence ?? null;
      }
    }
    return cached;
  }

  const flightKey = `${key}|${includeRisk ? 1 : 0}`;
  const active = inFlightSemantics.get(flightKey);
  if (active) return active;

  if (engineState.status === 'unavailable') return null;

  const task = (async (): Promise<SemanticAnalysis | null> => {
    const [sentiment, emotions, riskSimilarity, neuroscope, groq] = await Promise.all([
      classifySentiment(clean, waitFor('sentiment')),
      classifyEmotions(clean, waitFor('emotion')),
      includeRisk ? semanticRiskSimilarity(clean, waitFor('embedding')) : Promise.resolve(null),
      classifyWithNeuroScope(clean, waitFor('neuroscope')),
      // Groq's independent LLM read — the third ensemble member. Bounded and
      // best-effort (see `fetchGroqToneReading`): a slow/unconfigured provider
      // resolves to null here and the ensemble below degrades to the two
      // on-device transformers, same as it always could before this existed.
      fetchGroqToneReading(clean, Math.min(waitFor('sentiment') || INFERENCE_TIMEOUT_MS, 6000)),
    ]);

    if (
      !sentiment &&
      emotions.source === 'lexicon' &&
      riskSimilarity === null &&
      neuroscope === null &&
      !groq &&
      !isSemanticReady()
    ) {
      return null;
    }

    // The PRIMARY tone reading. When all three readers (NeuroScope, RoBERTa,
    // Groq) produced a read, fuse them via `ensembleThreeWaySentiment` — the
    // whole point being that the verdict never rests on the two small
    // on-device transformers alone. When only the two transformers are
    // available, `ensembleThreeWaySentiment` degrades to the same two-way
    // fusion as before (`ensembleTransformerSentiment`). Falls back further to
    // whichever single reader is available, then the lexicon-neutral
    // placeholder (adaptiveEngine only falls into that last branch when it
    // already knows every model was unavailable).
    const bothTransformersAvailable = !!neuroscope && sentiment?.source === 'transformer';
    const resolvedSentiment: SentimentResult = bothTransformersAvailable
      ? ensembleThreeWaySentiment(neuroscope!, sentiment!, groq)
      : neuroscope
        ? sentimentFromNeuroScope(neuroscope)
        : sentiment ?? groq ?? { score: 0, label: 'neutral', magnitude: 0, source: 'lexicon' };

    const analysis: SemanticAnalysis = {
      text: clean,
      sentiment: resolvedSentiment,
      emotions,
      riskSimilarity,
      neuroscope,
      groq,
      degraded: (!sentiment && !neuroscope && !groq) || emotions.source === 'lexicon' || riskSimilarity === null,
      ensembleAgreement: bothTransformersAvailable ? (resolvedSentiment.confidence ?? null) : null,
    };
    // Only remember a reading the real models produced. A fallback made while a
    // model was still downloading must not stick to this text forever.
    if ((sentiment && emotions.source === 'transformer') || neuroscope || groq) semanticsCache.set(key, analysis);
    return analysis;
  })().finally(() => {
    inFlightSemantics.delete(flightKey);
  });

  inFlightSemantics.set(flightKey, task);
  return task;
}
