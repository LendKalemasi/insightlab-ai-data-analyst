import { AppError } from './errors';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export const MAX_UPLOAD_BYTES = envInt('MAX_UPLOAD_BYTES', 5_242_880, 1, 50 * 1024 * 1024);
export const MAX_QUERY_ROWS = envInt('MAX_QUERY_ROWS', 1000, 1, 5000);
export const QUERY_TIMEOUT_MS = envInt('QUERY_TIMEOUT_MS', 10_000, 100, 30_000);
export const PYTHON_TIMEOUT_MS = envInt('PYTHON_TIMEOUT_MS', 15_000, 100, 30_000);
export const LLM_TIMEOUT_MS = envInt('LLM_TIMEOUT_MS', 20_000, 1_000, 60_000);

export function parseSampleLimit(raw: string | null): number {
  if (raw === null) return 20;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new AppError('BAD_LIMIT', 'The sample limit must be an integer from 1 to 200.', 400);
  }
  return value;
}