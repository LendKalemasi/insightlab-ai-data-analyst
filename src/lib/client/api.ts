import type { AnalysisEvent, AnalysisTurn, ApiErrorBody, AppStatus, DatasetInfo, DatasetSummary, RowsPage, TableResult } from '../types';

/** Browser-side API client. Errors carry the server's code, message and retryability. */
export class ApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number, readonly retryable: boolean) { super(message); }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    return new ApiError(body.error.code, body.error.message, res.status, body.error.retryable);
  } catch {
    return new ApiError('HTTP_ERROR', `The server responded with HTTP ${res.status}.`, res.status, res.status >= 500);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', 'Could not reach the server. Check that it is running and try again.', 0, true);
  }
  if (!res.ok) throw await toApiError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  status: () => request<AppStatus>('/api/status'),
  dataset: (id: string) => request<DatasetInfo>(`/api/datasets/${encodeURIComponent(id)}`),
  datasets: (ids: string[]) => request<{ datasets: DatasetSummary[] }>(`/api/datasets?ids=${ids.map(encodeURIComponent).join(',')}`),
  deleteDataset: (id: string) => request<void>(`/api/datasets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  loadDemo: () => request<DatasetInfo>('/api/datasets', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'demo' }) }),
  rows: (id: string, params: URLSearchParams, signal?: AbortSignal) => request<RowsPage>(`/api/datasets/${encodeURIComponent(id)}/rows?${params}`, { signal }),
  query: (id: string, sql: string) => request<TableResult & { sql: string; ms: number; warnings: string[] }>(`/api/datasets/${encodeURIComponent(id)}/query`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql }),
  }),
  turns: (id: string) => request<{ turns: AnalysisTurn[] }>(`/api/datasets/${encodeURIComponent(id)}/analyses`),
  clearTurns: (id: string) => request<void>(`/api/datasets/${encodeURIComponent(id)}/analyses`, { method: 'DELETE' }),
};

/** Uploads with progress events (fetch cannot report upload progress). */
export function uploadDataset(file: File, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<DatasetInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('file', file);
    xhr.open('POST', '/api/datasets');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.upload.onload = () => onProgress(1);
    xhr.onload = () => {
      const body = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as DatasetInfo);
      else {
        const err = (body as ApiErrorBody | null)?.error;
        reject(new ApiError(err?.code ?? 'HTTP_ERROR', err?.message ?? `The upload failed with HTTP ${xhr.status}.`, xhr.status, err?.retryable ?? xhr.status >= 500));
      }
    };
    xhr.onerror = () => reject(new ApiError('NETWORK', 'The upload was interrupted. Check your connection and try again.', 0, true));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

/** Reads the analysis stream: one JSON event per line. */
export async function streamAnalysis(id: string, question: string, onEvent: (e: AnalysisEvent) => void, signal: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/datasets/${encodeURIComponent(id)}/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }), signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError('NETWORK', 'Could not reach the server. Check that it is running and try again.', 0, true);
  }
  if (!res.ok || !res.body) throw await toApiError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line) as AnalysisEvent;
      if (event.type !== 'stage') finished = true;
      onEvent(event);
    }
  }
  if (!finished) throw new ApiError('STREAM_ENDED', 'The connection closed before the analysis finished. Please try again.', 0, true);
}

// ------------------------------------------------------------------ recent datasets (this browser only)

const RECENT_KEY = 'insightlab.recent';
export interface RecentDataset { id: string; name: string; opened_at: string }

export function readRecent(): RecentDataset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((r) => typeof r?.id === 'string') : [];
  } catch { return []; }
}

export function rememberDataset(d: { id: string; name: string }): void {
  try {
    const next = [{ id: d.id, name: d.name, opened_at: new Date().toISOString() }, ...readRecent().filter((r) => r.id !== d.id)].slice(0, 12);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* storage unavailable: recents are a convenience only */ }
}

export function forgetDataset(id: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(readRecent().filter((r) => r.id !== id))); } catch { /* ignore */ }
}
