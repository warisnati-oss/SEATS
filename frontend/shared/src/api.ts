// Typed fetch client over the API Gateway, the only REST API (ADR-12). The apps proxy /api to the gateway (vite.config.ts),
// so a path is used as is. Sends JSON, adds the fake-auth headers of the session, and throws ApiError
// {status, error, details} on a non-2xx answer: the gateway's {error, details} body, never swallowed.
import { getSession } from './session';

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export class ApiError extends Error {
  constructor(readonly status: number, readonly error: string, readonly details?: unknown) {
    super(error);
    this.name = 'ApiError';
  }
}

export const toApiError = (e: unknown): ApiError => (e instanceof ApiError ? e : new ApiError(0, e instanceof Error ? e.message : String(e)));

interface Answer<T> { status: number; etag: string | null; data: T }

const isErrorBody = (v: unknown): v is { error: string; details?: unknown } =>
  typeof v === 'object' && v !== null && typeof (v as { error?: unknown }).error === 'string';

async function send<T>(method: Method, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<Answer<T>> {
  const headers: Record<string, string> = { accept: 'application/json', ...extra };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const session = getSession();
  if (session) {
    // Compatibility with direct Node development; Kong always strips and replaces these.
    headers['x-user-id'] = session.userId;
    headers['x-role'] = session.role;
    if (session.token) headers.authorization = `Bearer ${session.token}`;
  }
  let res: Response;
  try {
    // no-store: the browser cache must not answer the polled read itself (the If-None-Match is ours)
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch (e) {
    throw new ApiError(0, `cannot reach the API Gateway: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  let json: unknown;
  if (text) {
    try { json = JSON.parse(text); } catch { json = undefined; }
  }
  if (!res.ok && res.status !== 304) {
    if (isErrorBody(json)) throw new ApiError(res.status, json.error, json.details);
    const hint = res.status >= 500 ? ' (no JSON answer: is the API Gateway running? `npm run dev:mono`)' : '';
    throw new ApiError(res.status, `${res.status} ${res.statusText}${hint}`, text.slice(0, 200) || undefined);
  }
  return { status: res.status, etag: res.headers.get('etag'), data: json as T };
}

export const api = {
  get: <T>(path: string): Promise<T> => send<T>('GET', path).then((a) => a.data),
  post: <T>(path: string, body?: unknown): Promise<T> => send<T>('POST', path, body).then((a) => a.data),
  put: <T>(path: string, body?: unknown): Promise<T> => send<T>('PUT', path, body).then((a) => a.data),
  delete: <T>(path: string): Promise<T> => send<T>('DELETE', path).then((a) => a.data),
};

/**
 * The polled read (ADR-09): GET `path` now and every `intervalMs`, with If-None-Match set to the last ETag; a 304
 * is ignored, a 200 with a new ETag calls onChange. Overlapping requests are skipped. Returns the stop function.
 */
export function poll<T>(path: string, intervalMs: number, onChange: (data: T) => void, onError: (error: ApiError) => void): () => void {
  let etag: string | null = null;
  let stopped = false;
  let inFlight = false;
  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const answer = await send<T>('GET', path, undefined, etag ? { 'if-none-match': etag } : {});
      if (stopped || answer.status === 304 || (etag !== null && answer.etag === etag)) return;
      etag = answer.etag;
      onChange(answer.data);
    } catch (e) {
      if (!stopped) onError(toApiError(e));
    } finally {
      inFlight = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  return () => { stopped = true; clearInterval(timer); };
}
