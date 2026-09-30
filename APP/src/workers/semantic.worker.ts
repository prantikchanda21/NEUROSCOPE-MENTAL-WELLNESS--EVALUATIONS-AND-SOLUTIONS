/**
 * Web Worker entry point. Hosts one `SemanticCore` and speaks a tiny
 * request/response protocol with `semanticTransport.ts`:
 *
 *   main → worker : { id, req }
 *   worker → main : { type: 'ready' }                       (once, after start-up)
 *                   { type: 'result', id, ok, result|error } (one per request)
 *                   { type: 'event', event }                 (download progress)
 */
import { SemanticCore, type CoreRequest } from './semanticCore.js';

interface WorkerScope {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent) => void) | null;
}

const scope = self as unknown as WorkerScope;
const core = new SemanticCore((event) => scope.postMessage({ type: 'event', event }));

scope.onmessage = async (event: MessageEvent<{ id: number; req: CoreRequest }>) => {
  const { id, req } = event.data;
  try {
    const reply = await core.handle(req);
    scope.postMessage({ type: 'result', id, ok: true, result: reply.result }, reply.transfer ?? []);
  } catch (err: any) {
    scope.postMessage({ type: 'result', id, ok: false, error: String(err?.message || err) });
  }
};

scope.postMessage({ type: 'ready' });
