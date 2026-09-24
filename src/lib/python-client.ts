import type { QueryResult } from './types';

export interface PythonExecution {
  success: boolean; stdout: string; stderr: string;
  result: QueryResult | null; execution_time_ms: number;
  warnings: string[]; skipped_reason?: string;
}

/**
 * Calls the FastAPI analysis service. When PYTHON_SERVICE_URL is unset the
 * app degrades gracefully: the generated Python is shown but is not validated
 * or executed locally when the service is unavailable, and the UI says so.
 */
export async function executePython(
  code: string, frame: { columns: string[]; rows: Record<string, unknown>[] }, timeoutMs: number,
): Promise<PythonExecution> {
  const base = process.env.PYTHON_SERVICE_URL;
  const empty: PythonExecution = {
    success: false, stdout: '', stderr: '', result: null,
    execution_time_ms: 0, warnings: [],
  };
  if (!base) return { ...empty, skipped_reason: 'PYTHON_SERVICE_URL is not configured, so the generated Python was not executed.' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs + 2000);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, dataset: frame, timeout_ms: timeoutMs }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ...empty, skipped_reason: `The analysis service responded with HTTP ${res.status}.` };
    }
    return (await res.json()) as PythonExecution;
  } catch (e) {
    return { ...empty, skipped_reason: `The analysis service is unreachable: ${e instanceof Error ? e.message : 'unknown error'}.` };
  } finally { clearTimeout(timer); }
}
