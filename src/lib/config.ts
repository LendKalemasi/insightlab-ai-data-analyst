import 'server-only';
import path from 'node:path';
import type { AppStatus, PlannerKind } from './types';

/**
 * Server configuration, read once from the environment and validated.
 * Invalid numeric values fall back to safe defaults and are reported in
 * `configWarnings` (logged at startup) instead of crashing the server.
 */
export const configWarnings: string[] = [];

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= min && value <= max) return value;
  configWarnings.push(`${name}=${raw} is outside ${min}–${max}; using ${fallback}.`);
  return fallback;
}

const DEFAULT_MODEL = 'claude-opus-5-5';

export const config = {
  maxUploadBytes: envInt('MAX_UPLOAD_BYTES', 25 * 1024 * 1024, 1024, 200 * 1024 * 1024),
  maxRows: envInt('MAX_ROWS', 250_000, 100, 2_000_000),
  maxColumns: envInt('MAX_COLUMNS', 250, 1, 1000),
  maxResultRows: envInt('MAX_QUERY_ROWS', 1000, 10, 5000),
  queryTimeoutMs: envInt('QUERY_TIMEOUT_MS', 10_000, 100, 60_000),
  pythonTimeoutMs: envInt('PYTHON_TIMEOUT_MS', 15_000, 100, 60_000),
  llmTimeoutMs: envInt('LLM_TIMEOUT_MS', 60_000, 5_000, 300_000),
  retentionHours: envInt('DATASET_RETENTION_HOURS', 24, 1, 24 * 30),
  maxDatasets: envInt('MAX_DATASETS', 50, 1, 1000),
  // Runtime state, not code: keep it out of build file tracing.
  dataDir: path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), '.data')),
  pythonServiceUrl: process.env.PYTHON_SERVICE_URL?.trim() || null,
  llm: resolveLlm(),
};

function resolveLlm(): { provider: PlannerKind; model: string | null; apiKey: string | null; baseURL: string; message: string | null } {
  const requested = (process.env.LLM_PROVIDER ?? '').trim().toLowerCase();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const model = process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  // Deliberately not ANTHROPIC_BASE_URL: tooling sometimes sets it for its own proxy.
  const baseURL = process.env.LLM_BASE_URL?.trim() || 'https://api.anthropic.com';

  if (requested && !['anthropic', 'local', 'rules'].includes(requested)) {
    configWarnings.push(`LLM_PROVIDER=${requested} is not recognised; expected "anthropic" or "local".`);
  }
  if (requested === 'local' || requested === 'rules') {
    return { provider: 'rules', model: null, apiKey: null, baseURL,
      message: 'AI is turned off (LLM_PROVIDER=local). Questions are answered by the built-in rule-based planner.' };
  }
  if (!apiKey) {
    return { provider: 'rules', model: null, apiKey: null, baseURL,
      message: requested === 'anthropic'
        ? 'LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Using the built-in rule-based planner until a key is added.'
        : 'No ANTHROPIC_API_KEY is configured. Questions are answered by the built-in rule-based planner, which understands a limited set of phrasings.' };
  }
  return { provider: 'anthropic', model, apiKey, baseURL, message: null };
}

export function appStatus(): AppStatus {
  return {
    ai: {
      provider: config.llm.provider,
      model: config.llm.model,
      configured: config.llm.provider === 'anthropic',
      message: config.llm.message,
    },
    crosscheck: { configured: Boolean(config.pythonServiceUrl) },
    limits: { max_upload_bytes: config.maxUploadBytes, max_rows: config.maxRows, retention_hours: config.retentionHours },
  };
}

let logged = false;
/** Logs configuration problems once per process. Never logs secret values. */
export function logConfigOnce(): void {
  if (logged) return;
  logged = true;
  for (const warning of configWarnings) console.warn(`[insightlab] config: ${warning}`);
  console.info(`[insightlab] planner=${config.llm.provider}${config.llm.model ? ` model=${config.llm.model}` : ''} data_dir=${config.dataDir}`);
}
