/**
 * Main-thread side of the model workers.
 *
 * Two dedicated workers are used so the models genuinely run in parallel
 * instead of queueing behind each other on one WASM thread:
 *
 *   primary : NeuroScope DistilBERT — the clinical classifier every answer is
 *             scored against. It never waits behind another model.
 *   support : RoBERTa sentiment, DistilRoBERTa emotions, MiniLM embeddings.
 *
 * If a worker cannot be started (module workers unsupported, blocked by CSP, or
 * the script fails to load) the channel silently falls back to running the same
 * `SemanticCore` on the main thread, which is how the engine behaved before
 * workers were added. A worker that crashes mid-session is replaced by the
 * inline fallback and the engine is told so it can reload the lost models.
 */
import {
  SemanticCore,
  type CoreEvent,
  type CoreModelKey,
  type CoreReply,
  type CoreRequest,
} from '../workers/semanticCore.js';

export type WorkerRole = 'primary' | 'support';

export function roleOfModel(key: CoreModelKey): WorkerRole {
  return key === 'neuroscope' ? 'primary' : 'support';
}

const WORKER_START_TIMEOUT_MS = 8000;

/** Threads only matter on a cross-origin-isolated page (SharedArrayBuffer);
 * elsewhere ORT stays single-threaded regardless. */
function threadsFor(role: WorkerRole): number {
  const cores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
  const budget = Math.max(1, cores - 1);
  return role === 'primary' ? Math.min(3, budget) : 1;
}

interface Pending {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
}

class Channel {
  private worker: Worker | null = null;
  private core: SemanticCore | null = null;
  private ready: Promise<void>;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private forceInline = false;

  constructor(
    private readonly role: WorkerRole,
    private readonly onEvent: (event: CoreEvent) => void,
    private readonly onCrash: (role: WorkerRole) => void
  ) {
    this.ready = this.start();
  }

  get mode(): 'worker' | 'inline' | 'starting' {
    return this.worker ? 'worker' : this.core ? 'inline' : 'starting';
  }

  private start(): Promise<void> {
    return new Promise<void>((resolve) => {
      const goInline = (why: string) => {
        if (why) console.info(`Semantic ${this.role} worker unavailable (${why}) — running models on the main thread.`);
        this.core = new SemanticCore(this.onEvent);
        void this.core.handle({ op: 'init', numThreads: threadsFor(this.role) });
        resolve();
      };

      if (this.forceInline || typeof Worker === 'undefined') {
        goInline(this.forceInline ? '' : 'no Worker support');
        return;
      }

      let worker: Worker;
      try {
        // Vite statically detects this exact `new Worker(new URL(...))` form.
        worker = new Worker(new URL('../workers/semantic.worker.ts', import.meta.url), { type: 'module' });
      } catch (err: any) {
        goInline(String(err?.message || err));
        return;
      }

      let settled = false;
      const fail = (why: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          worker.terminate();
        } catch {
          // ignore
        }
        goInline(why);
      };
      const timer = setTimeout(() => fail('start-up timed out'), WORKER_START_TIMEOUT_MS);

      worker.onerror = (e) => fail(e?.message || 'worker error');
      worker.onmessage = (e: MessageEvent) => {
        if (settled || e.data?.type !== 'ready') return;
        settled = true;
        clearTimeout(timer);
        this.worker = worker;
        worker.onmessage = this.handleMessage;
        worker.onerror = this.handleCrash;
        worker.postMessage({ id: 0, req: { op: 'init', numThreads: threadsFor(this.role) } satisfies CoreRequest });
        resolve();
      };
    });
  }

  private handleMessage = (e: MessageEvent) => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === 'event') {
      this.onEvent(msg.event as CoreEvent);
      return;
    }
    if (msg.type !== 'result') return;
    const entry = this.pending.get(msg.id);
    if (!entry) return; // the init ack, or a request that was already rejected
    this.pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error || 'semantic worker request failed'));
  };

  /** A worker that dies mid-session loses its loaded models. Fail whatever is
   * in flight, continue on the main thread, and tell the engine to reload. */
  private handleCrash = (e?: ErrorEvent) => {
    const error = new Error(e?.message || 'semantic worker crashed');
    try {
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.forceInline = true;
    this.ready = this.start();
    this.onCrash(this.role);
  };

  async request<T>(req: CoreRequest): Promise<T> {
    await this.ready;
    if (this.core) {
      const reply: CoreReply = await this.core.handle(req);
      return reply.result as T;
    }
    const worker = this.worker;
    if (!worker) throw new Error('semantic worker is not running');
    return new Promise<T>((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, req });
    });
  }

  terminate(): void {
    const error = new Error('semantic engine reset');
    try {
      this.worker?.terminate();
    } catch {
      // ignore
    }
    this.worker = null;
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    void this.core?.handle({ op: 'dispose' }).catch(() => undefined);
    this.core = null;
  }
}

export class SemanticTransport {
  private channels: Partial<Record<WorkerRole, Channel>> = {};

  constructor(
    private readonly onEvent: (event: CoreEvent) => void,
    private readonly onCrash: (role: WorkerRole) => void
  ) {}

  private channel(role: WorkerRole): Channel {
    return (this.channels[role] ??= new Channel(role, this.onEvent, this.onCrash));
  }

  request<T>(role: WorkerRole, req: CoreRequest): Promise<T> {
    return this.channel(role).request<T>(req);
  }

  /** 'worker' when the role runs off-thread, 'inline' for the fallback. */
  modes(): Partial<Record<WorkerRole, 'worker' | 'inline' | 'starting'>> {
    const out: Partial<Record<WorkerRole, 'worker' | 'inline' | 'starting'>> = {};
    for (const role of Object.keys(this.channels) as WorkerRole[]) out[role] = this.channels[role]!.mode;
    return out;
  }

  terminate(): void {
    for (const channel of Object.values(this.channels)) channel?.terminate();
    this.channels = {};
  }
}
