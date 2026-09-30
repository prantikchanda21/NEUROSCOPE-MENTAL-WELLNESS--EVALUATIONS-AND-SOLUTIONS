/**
 * Offline Phi-3 mini (in-browser, WebGPU) — main-thread manager.
 *
 * What this is for: the third voice in the tone ensemble when the cloud reader
 * (Groq) is unreachable — offline, rate-limited, or all providers down. It is
 * downloaded once by the user (header menu), cached by the browser, and then
 * runs entirely on their device. Nothing they type leaves the device for it.
 *
 * What it is NOT allowed to do (the "rules of DistilBERT and RoBERTa"):
 *  - It only ever outputs a JSON tone reading in the shared taxonomy
 *    (`toneRules.ts`); it never writes advice or free text to the user.
 *  - Its output is validated/repaired by `reconcileToneReading` before use.
 *  - It is only consulted inside `ensembleThreeWaySentiment`, at a MINORITY
 *    weight, after the safety bypass (critical band / Suicidal status /
 *    imminent-risk language) has already been decided without it, and under
 *    sticky severity (it can escalate, it can never talk a `severe` read down).
 * Those last two live in `semanticEngine.ts`, next to the rules they extend.
 */
import type { SentimentResult } from '../types.js';
import type { LlmWorkerEvent, LlmWorkerRequest } from '../workers/localLlmProtocol.js';
import { TONE_OUTPUT_SPEC, extractJsonObject, reconcileToneReading, salvageToneFields } from './toneRules.js';

/**
 * Which on-device model to use. Change ONLY this line.
 *  - 'fast'    Llama 3.2 1B (q4f16, ~1.3 GB): roughly 3x quicker than Phi-3, plainer wording.
 *  - 'quality' Phi-3 mini 3.8B (q4f16, ~2.3 GB): better wording, slower.
 * Switching means a one-time re-download (use "Remove from this device" first to free the old one).
 */
export type LocalLlmProfile = 'fast' | 'quality';
export const LOCAL_LLM_PROFILE: LocalLlmProfile = 'fast';

const PROFILES = {
  fast: {
    id: 'onnx-community/Llama-3.2-1B-Instruct-q4f16',
    bytes: 1.3e9,
    label: 'Llama 3.2 1B',
    externalData: false,
  },
  quality: {
    id: 'microsoft/Phi-3-mini-4k-instruct-onnx-web',
    bytes: 2.3e9,
    label: 'Phi-3 mini',
    externalData: true,
  },
} as const;

export const LOCAL_LLM_MODEL_ID: string = PROFILES[LOCAL_LLM_PROFILE].id;
export const LOCAL_LLM_DTYPE = 'q4f16';
export const LOCAL_LLM_APPROX_BYTES: number = PROFILES[LOCAL_LLM_PROFILE].bytes;
export const LOCAL_LLM_LABEL: string = PROFILES[LOCAL_LLM_PROFILE].label;
const LOCAL_LLM_EXTERNAL_DATA: boolean = PROFILES[LOCAL_LLM_PROFILE].externalData;
/** Budget for one tone reading. Generation is interrupted when it is exceeded. */
export const LOCAL_LLM_TIMEOUT_MS = 10000;

const STORAGE_KEY = 'neuroscope_local_llm_v1';
const RESUME_DELAY_MS = 4000; // let the NeuroScope / support workers start first

export type LocalLlmStatus =
  | 'checking' //     working out whether this device can run it
  | 'unsupported' //  no WebGPU / too little memory
  | 'idle' //         supported, not downloaded
  | 'downloading' //  first-time download in progress
  | 'loading' //      already downloaded, loading into memory
  | 'ready' //        usable
  | 'error';

export interface LocalLlmState {
  status: LocalLlmStatus;
  /** 0..1, download progress while `downloading`. */
  progress: number;
  loadedBytes: number;
  message: string;
  /** True once the model has been downloaded on this device (survives reloads). */
  installed: boolean;
}

let state: LocalLlmState = { status: 'checking', progress: 0, loadedBytes: 0, message: '', installed: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<LocalLlmState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}
export const subscribeLocalLlm = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getLocalLlmState = (): LocalLlmState => state;
export const isLocalLlmReady = (): boolean => state.status === 'ready' && !!worker;

/**
 * Resolves true once the model is usable. If it is still starting (checking this device,
 * or loading from the browser cache after a page load) this WAITS instead of giving up,
 * because loading a ~1 GB model into WebGPU memory takes a while. Resolves false straight
 * away when it is not installed, unsupported, failed, or is only downloading.
 */
export function waitForLocalLlm(maxMs = 60000): Promise<boolean> {
  if (isLocalLlmReady()) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const finish = (value: boolean) => {
      clearTimeout(timer);
      listeners.delete(check);
      resolve(value);
    };
    const check = () => {
      if (isLocalLlmReady()) return finish(true);
      const { status, installed } = state;
      const stillStarting = status === 'checking' || status === 'loading' || (status === 'idle' && installed);
      if (!stillStarting) finish(false);
    };
    const timer = setTimeout(() => finish(isLocalLlmReady()), maxMs);
    listeners.add(check);
    check();
  });
}

// ---------------------------------------------------------------------------
// Persistence + capability checks
// ---------------------------------------------------------------------------

function readInstalledFlag(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return !!raw && JSON.parse(raw)?.modelId === LOCAL_LLM_MODEL_ID;
  } catch {
    return false;
  }
}
function writeInstalledFlag(installed: boolean): void {
  try {
    if (installed) localStorage.setItem(STORAGE_KEY, JSON.stringify({ modelId: LOCAL_LLM_MODEL_ID, at: Date.now() }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode etc. — the model still works this session
  }
}

async function detectSupport(): Promise<{ ok: boolean; reason?: string }> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return { ok: false, reason: 'This browser cannot run background workers.' };
  if (!window.isSecureContext) return { ok: false, reason: 'Offline AI needs a secure (https) page.' };
  const nav = navigator as any;
  if (!nav.gpu) return { ok: false, reason: 'Needs a browser with WebGPU (recent Chrome/Edge or another compatible Chromium browser).' };
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: 'No usable graphics adapter was found for WebGPU.' };
  } catch {
    return { ok: false, reason: 'WebGPU could not be started on this device.' };
  }
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory < 4) {
    return { ok: false, reason: 'This device reports less than 4 GB of memory, which is too little for the offline model.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let worker: Worker | null = null;
let initStarted = false;
let nextJobId = 1;
type JobReply = { ok: true; text: string } | { ok: false; error: string };
const pending = new Map<number, (reply: JobReply) => void>();

function failPending(error: string): void {
  for (const cb of pending.values()) cb({ ok: false, error });
  pending.clear();
}

function killWorker(): void {
  try {
    worker?.terminate();
  } catch {
    // ignore
  }
  worker = null;
  failPending('worker stopped');
  queue = Promise.resolve();
}

function handleEvent(e: MessageEvent<LlmWorkerEvent>): void {
  const msg = e.data;
  if (!msg) return;
  if (msg.type === 'progress') {
    if (state.status !== 'downloading') return;
    const total = Math.max(msg.total, LOCAL_LLM_APPROX_BYTES);
    setState({ progress: Math.min(0.99, msg.loaded / total), loadedBytes: msg.loaded });
  } else if (msg.type === 'ready') {
    writeInstalledFlag(true);
    setState({ status: 'ready', progress: 1, installed: true, message: '' });
  } else if (msg.type === 'error') {
    killWorker();
    setState({ status: 'error', message: msg.error || 'Could not load the model.' });
  } else if (msg.type === 'result') {
    const cb = pending.get(msg.id);
    if (!cb) return; // already timed out
    pending.delete(msg.id);
    cb('text' in msg ? { ok: true, text: msg.text } : { ok: false, error: msg.error });
  }
}

function startWorker(mode: 'download' | 'resume'): void {
  if (worker) return;
  try {
    worker = new Worker(new URL('../workers/localLlm.worker.ts', import.meta.url), { type: 'module' });
  } catch (err: any) {
    setState({ status: 'error', message: String(err?.message || err) });
    return;
  }
  worker.onmessage = handleEvent;
  worker.onerror = (e) => {
    killWorker();
    setState({ status: 'error', message: e?.message || 'The offline model stopped unexpectedly.' });
  };
  setState({
    status: mode === 'download' ? 'downloading' : 'loading',
    progress: 0,
    loadedBytes: 0,
    message: '',
  });
  const req: LlmWorkerRequest = { op: 'load', modelId: LOCAL_LLM_MODEL_ID, dtype: LOCAL_LLM_DTYPE, externalData: LOCAL_LLM_EXTERNAL_DATA };
  worker.postMessage(req);
}

/** Call once at app start. Detects support and, if the model was downloaded on a
 * previous visit, quietly loads it from the browser cache (no network needed). */
export function initLocalLlm(): void {
  if (initStarted) return;
  initStarted = true;
  const installed = readInstalledFlag();
  setState({ installed });
  void detectSupport().then((support) => {
    if (!support.ok) {
      setState({ status: 'unsupported', message: support.reason || '' });
      return;
    }
    setState({ status: 'idle', message: '' });
    if (installed) setTimeout(() => startWorker('resume'), RESUME_DELAY_MS);
  });
}

/** User pressed "Download". */
export async function downloadLocalLlm(): Promise<void> {
  if (state.status !== 'idle' && state.status !== 'error') return;
  try {
    const nav = navigator as any;
    if (nav.storage?.estimate) {
      const { quota = 0, usage = 0 } = await nav.storage.estimate();
      if (quota && quota - usage < LOCAL_LLM_APPROX_BYTES * 1.3) {
        setState({ status: 'error', message: 'Not enough free browser storage (about 3 GB needed).' });
        return;
      }
    }
    // Ask the browser not to evict the ~2.3 GB cache under storage pressure.
    void nav.storage?.persist?.();
  } catch {
    // estimate/persist are optional
  }
  startWorker('download');
}

/** User pressed "Remove": stop the worker and delete only this model's cached files. */
export async function removeLocalLlm(): Promise<void> {
  worker?.postMessage({ op: 'dispose' } satisfies LlmWorkerRequest);
  killWorker();
  writeInstalledFlag(false);
  try {
    if (typeof caches !== 'undefined') {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const req of await cache.keys()) {
          if (req.url.includes(LOCAL_LLM_MODEL_ID)) await cache.delete(req);
        }
      }
    }
  } catch {
    // nothing else to do; the flag is already cleared
  }
  setState({ status: 'idle', progress: 0, loadedBytes: 0, installed: false, message: '' });
}

// ---------------------------------------------------------------------------
// Tone reading
// ---------------------------------------------------------------------------

const LOCAL_TONE_INTRO = `You are a precise tone-and-emotion classifier embedded in a mental-health check-in app. You are an OFFLINE secondary reader: this app's own fine-tuned NeuroScope DistilBERT model and a RoBERTa sentiment model make the governing decision and your reading is combined with theirs, so you must classify into the EXACT SAME taxonomy and score scales those models use. You output ONLY the JSON object described below — you never give advice, never address the person, and never explain. Given one short piece of user-written text, read its emotional tone the way a careful clinician would: pay attention to negation ("not fine" vs "fine"), hedging, sarcasm, intensity words, and passive/indirect distress language, not just surface-level keywords.\n\n`;
const LOCAL_SYSTEM_PROMPT = LOCAL_TONE_INTRO + TONE_OUTPUT_SPEC;

// The model can only run one generation at a time.
let queue: Promise<void> = Promise.resolve();

function generate(system: string, user: string, maxNewTokens: number, timeoutMs: number, keepPartial = false): Promise<string | null> {
  return new Promise<string | null>((resolveOuter) => {
    queue = queue.then(
      () =>
        new Promise<void>((workerDone) => {
          if (!worker || state.status !== 'ready') {
            resolveOuter(null);
            workerDone();
            return;
          }
          const id = nextJobId++;
          let settled = false;
          const timer = setTimeout(() => {
            if (settled) return;
            worker?.postMessage({ op: 'interrupt' } satisfies LlmWorkerRequest);
            if (keepPartial) {
              // Let the worker hand back what it has so far; give up if it does not.
              setTimeout(() => {
                if (settled) return;
                settled = true;
                resolveOuter(null);
              }, 3000);
              return;
            }
            settled = true;
            resolveOuter(null);
          }, timeoutMs);
          // The queue only advances once the worker has really finished (or died),
          // so a timed-out job can never overlap the next one.
          pending.set(id, (reply) => {
            clearTimeout(timer);
            if (!settled) {
              settled = true;
              resolveOuter(reply.ok ? reply.text : null);
            }
            workerDone();
          });
          worker.postMessage({ op: 'generate', id, system, user, maxNewTokens } satisfies LlmWorkerRequest);
        })
    );
  });
}

/**
 * One tone reading from the on-device Phi-3 mini, in the shared taxonomy.
 * Never throws; resolves to null when the model is not ready, times out, or
 * returns something that cannot be repaired into a valid reading — in which
 * case the ensemble simply stays on NeuroScope + RoBERTa.
 */
export async function readToneLocally(text: string, timeoutMs = LOCAL_LLM_TIMEOUT_MS): Promise<SentimentResult | null> {
  if (!isLocalLlmReady()) return null;
  const clipped = text.trim().slice(0, 700);
  if (clipped.length < 2) return null;
  try {
    const raw = await generate(
      LOCAL_SYSTEM_PROMPT,
      `Text to classify:\n"""${clipped}"""\nKeep "rationale" under 8 words.`,
      96,
      timeoutMs
    );
    if (raw == null) return null;
    const core = reconcileToneReading(extractJsonObject(raw) ?? salvageToneFields(raw));
    if (!core) return null;
    return { score: core.score, label: core.label, magnitude: core.magnitude, source: 'local-llm' };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offline chat reply ("Chat with AI About This Feeling")
// ---------------------------------------------------------------------------

/** A chat reply is ~150 tokens, so it gets a much longer budget than a tone reading. */
export const LOCAL_LLM_CHAT_TIMEOUT_MS = 45000;

export interface LocalChatContext {
  questionText?: string;
  userAnswer?: string;
  solutionTitle?: string;
  emotionalStateLabel?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  wellnessProfileContext?: string;
}

const LOCAL_CHAT_SYSTEM = `You are a warm, grounded wellbeing companion inside a mental-health check-in app. You are NOT a therapist and never diagnose. Reply to the person's latest message directly and specifically: refer to what they actually said, in their own words where natural. Write 2 to 4 short sentences (under 90 words) of plain conversational text: no lists, no markdown, no headings, no emojis. Include exactly one small, concrete thing they could try in the next few minutes. Never give medication or dosage advice. Never claim to replace a professional. If they mention hurting themselves or not wanting to be alive, tell them kindly to contact local emergency services or a crisis line right now and to reach out to someone they trust.`;

const clip = (t: string | undefined, n: number) => (t || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Trim to the last complete sentence when generation stopped mid-sentence. */
function tidyChatReply(raw: string): string | null {
  let t = raw.replace(/^(assistant|ai|companion)\s*:\s*/i, '').replace(/[*_#`>]+/g, '').trim();
  if (!/[.!?]["')\]]?$/.test(t)) {
    const cut = Math.max(t.lastIndexOf('. '), t.lastIndexOf('! '), t.lastIndexOf('? '));
    if (cut > 40) t = t.slice(0, cut + 1);
  }
  return t.length >= 40 ? t : null;
}

/**
 * One conversational reply from the on-device model. Resolves to null when the model
 * is not ready, times out or returns something unusable, so the caller can fall back
 * to the built-in template engine. Callers must keep crisis-level text away from this.
 */
export async function generateLocalChatReply(
  query: string,
  ctx: LocalChatContext = {},
  timeoutMs = LOCAL_LLM_CHAT_TIMEOUT_MS
): Promise<string | null> {
  if (!isLocalLlmReady()) return null;
  const q = clip(query, 500);
  if (q.length < 2) return null;
  const turns = (ctx.history ?? [])
    .slice(-4)
    .map((m) => `${m.role === 'user' ? 'Person' : 'You'}: ${clip(m.content, 300)}`)
    .join('\n');
  const user = [
    ctx.questionText ? `Check-in question: ${clip(ctx.questionText, 200)}` : '',
    ctx.userAnswer ? `What they answered: ${clip(ctx.userAnswer, 400)}` : '',
    ctx.emotionalStateLabel ? `Reading of their state: ${clip(ctx.emotionalStateLabel, 80)}` : '',
    ctx.solutionTitle ? `Suggestion they were shown: ${clip(ctx.solutionTitle, 120)}` : '',
    ctx.wellnessProfileContext ? ctx.wellnessProfileContext : '',
    turns ? `Recent conversation:\n${turns}` : '',
    `Person's latest message: ${q}`,
    'Your reply:',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const raw = await generate(LOCAL_CHAT_SYSTEM, user, 170, timeoutMs);
    return raw ? tidyChatReply(raw) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Offline solution card ("empathy / nervous system / perspective / steps")
// ---------------------------------------------------------------------------

/** A full solution is ~250 tokens. Partial output is kept when this runs out. */
export const LOCAL_LLM_SOLUTION_TIMEOUT_MS = 40000;

export interface LocalSolutionInput {
  questionText: string;
  userAnswer: string;
  toneLabel?: string;
  dominantEmotion?: string;
  wellnessProfileContext?: string;
}

export interface LocalSolutionDraft {
  immediateSolutionTitle?: string;
  conversationalEmpathy?: string;
  detailedAnalysis?: string;
  perspectiveShift?: string;
  immediateActionRightNow?: string;
  immediateSolutionSteps?: string[];
  practicalStepToday?: string;
  affirmation?: string;
}

const SOLUTION_SYSTEM = `You are a warm, grounded wellbeing companion inside a mental-health check-in app. You are not a therapist and never diagnose. Read the person's own words carefully and answer them specifically, quoting a few of their words where natural. If their words suggest low mood, loss of interest, exhaustion or hopelessness, say so gently and never call it "fine". No medication or dosage advice. Plain text only.
Reply with EXACTLY these labelled lines, one per line, nothing else:
TITLE: <max 7 words>
EMPATHY: <2 short sentences that reflect what they said>
BODY: <2 short sentences on what may be happening in the body and nervous system, in plain words>
PERSPECTIVE: <2 short sentences offering a kinder way to look at it>
NOW: <1 sentence, one tiny thing to do in the next 10 minutes>
STEP1: <max 16 words>
STEP2: <max 16 words>
STEP3: <max 16 words>
TODAY: <1 sentence for later today>
AFFIRMATION: <max 14 words>`;

const LABELS = ['TITLE', 'EMPATHY', 'BODY', 'PERSPECTIVE', 'NOW', 'STEP1', 'STEP2', 'STEP3', 'TODAY', 'AFFIRMATION'] as const;

/** Reads `LABEL: text` lines. Works on truncated output: every complete line still counts. */
function parseSolutionLines(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = raw.replace(/\*\*/g, '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*[-*\d.)\s]*([A-Z0-9]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const key = m[1].toUpperCase();
    if ((LABELS as readonly string[]).includes(key) && !out[key]) out[key] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const okText = (t: string | undefined, min: number, max: number): string | undefined =>
  t && t.length >= min && t.length <= max && !/[<>{}]/.test(t) ? t : undefined;

/**
 * On-device draft of the solution card text. Every field is validated on its own;
 * anything missing or unusable is simply left out so the caller keeps its template text
 * for that field. Resolves to null when nothing usable came back.
 * Callers must keep crisis-level text away from this.
 */
export async function generateLocalSolution(
  input: LocalSolutionInput,
  timeoutMs = LOCAL_LLM_SOLUTION_TIMEOUT_MS
): Promise<LocalSolutionDraft | null> {
  if (!isLocalLlmReady()) return null;
  const answer = clip(input.userAnswer, 500);
  if (answer.length < 2) return null;
  const user = [
    `Check-in question: ${clip(input.questionText, 200)}`,
    `Their answer: "${answer}"`,
    input.toneLabel ? `Overall tone reading: ${input.toneLabel}` : '',
    input.dominantEmotion ? `Strongest emotion detected: ${input.dominantEmotion}` : '',
    input.wellnessProfileContext ? input.wellnessProfileContext : '',
    'Now write the labelled lines.',
  ]
    .filter(Boolean)
    .join('\n');
  try {
    const raw = await generate(SOLUTION_SYSTEM, user, 280, timeoutMs, true);
    if (!raw) return null;
    const f = parseSolutionLines(raw);
    const steps = [f.STEP1, f.STEP2, f.STEP3].map((t) => okText(t, 8, 160)).filter((t): t is string => !!t);
    const draft: LocalSolutionDraft = {
      immediateSolutionTitle: okText(f.TITLE, 6, 70),
      conversationalEmpathy: okText(f.EMPATHY, 40, 500),
      detailedAnalysis: okText(f.BODY, 40, 500),
      perspectiveShift: okText(f.PERSPECTIVE, 40, 500),
      immediateActionRightNow: okText(f.NOW, 12, 220),
      immediateSolutionSteps: steps.length >= 2 ? steps : undefined,
      practicalStepToday: okText(f.TODAY, 12, 220),
      affirmation: okText(f.AFFIRMATION, 8, 140),
    };
    return Object.values(draft).some((v) => v !== undefined) ? draft : null;
  } catch {
    return null;
  }
}
