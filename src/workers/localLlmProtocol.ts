/** Messages between `utils/localLlm.ts` (main thread) and `localLlm.worker.ts`. */

export type LlmWorkerRequest =
  | { op: 'load'; modelId: string; dtype: string; externalData?: boolean }
  | { op: 'generate'; id: number; system: string; user: string; maxNewTokens: number }
  | { op: 'interrupt' }
  | { op: 'dispose' };

export type LlmWorkerEvent =
  | { type: 'progress'; loaded: number; total: number; file: string }
  | { type: 'ready' }
  | { type: 'result'; id: number; ok: true; text: string }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'error'; error: string };
