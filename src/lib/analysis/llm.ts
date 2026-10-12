import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import { config } from '../config';
import { AppError } from '../errors';

/**
 * Thin wrapper around the Anthropic Messages API for structured (JSON-schema)
 * responses. The API key never leaves the server; errors are mapped to
 * user-facing messages that never include the key or raw provider payloads.
 */

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!config.llm.apiKey) throw new AppError('AI_NOT_CONFIGURED', 'No ANTHROPIC_API_KEY is configured on the server.', 503);
  client ??= new Anthropic({
    apiKey: config.llm.apiKey,
    authToken: null,
    baseURL: config.llm.baseURL,
    timeout: config.llmTimeoutMs,
    maxRetries: 2, // the SDK retries 408/409/429/5xx and connection errors with backoff
  });
  return client;
}

/** Models that accept server-side refusal fallbacks (Claude API only). */
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export interface StructuredCall<T extends z.ZodType> {
  schema: T;
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  signal?: AbortSignal;
}

export interface StructuredResult<T> { data: T; model: string; inputTokens: number; outputTokens: number; cachedTokens: number }

export async function callStructured<T extends z.ZodType>(call: StructuredCall<T>): Promise<StructuredResult<z.infer<T>>> {
  const model = config.llm.model!;
  const useFallbacks = FALLBACK_MODELS.has(model) && new URL(config.llm.baseURL).hostname === 'api.anthropic.com';
  let lastProblem = '';
  // One retry if the model's JSON fails schema validation; API-level retries are handled by the SDK.
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages = attempt === 0 ? call.messages : [
      ...call.messages,
      { role: 'user' as const, content: `Your previous reply did not match the required schema (${lastProblem}). Reply again with a valid object.` },
    ];
    let response;
    try {
      response = await getClient().beta.messages.parse({
        model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages,
        output_config: { format: betaZodOutputFormat(call.schema), effort: call.effort },
        ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      }, { signal: call.signal });
    } catch (e) {
      if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIUserAbortError) throw toAppError(e);
      if (e instanceof Anthropic.AnthropicError && /parse structured output/i.test(e.message)) {
        lastProblem = 'invalid fields';
        continue;
      }
      throw toAppError(e);
    }
    if (response.stop_reason === 'refusal') {
      throw new AppError('AI_REFUSED', 'The AI model declined to answer this request.', 422);
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AppError('AI_TRUNCATED', 'The AI response was cut off before it finished. Try a narrower question.', 502, true);
    }
    if (response.parsed_output === null || response.parsed_output === undefined) {
      lastProblem = 'no JSON object was returned';
      continue;
    }
    const usage = response.usage;
    return {
      data: response.parsed_output as z.infer<T>,
      model: response.model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cachedTokens: usage.cache_read_input_tokens ?? 0,
    };
  }
  throw new AppError('AI_INVALID_OUTPUT', 'The AI model returned a response in an unexpected format twice. Please try again.', 502, true);
}

/** Maps SDK errors to stable codes and actionable messages. Most specific first. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AppError('CANCELLED', 'The request was cancelled.', 499);
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError('AI_TIMEOUT', `The AI service did not respond within ${Math.round(config.llmTimeoutMs / 1000)} seconds. Please try again.`, 504, true);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new AppError('AI_UNREACHABLE', 'The server could not reach the AI service. Check the network connection and try again.', 502, true);
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new AppError('AI_AUTH', 'The AI service rejected the API key. Check ANTHROPIC_API_KEY in the server configuration.', 502);
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new AppError('AI_PERMISSION', 'The API key is not permitted to use this model. Check LLM_MODEL and your Anthropic account.', 502);
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new AppError('AI_MODEL', `The model "${config.llm.model}" is not available. Check LLM_MODEL.`, 502);
  }
  if (e instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(e.headers?.get?.('retry-after'));
    return new AppError('AI_RATE_LIMITED', `The AI service is rate-limiting requests.${Number.isFinite(retryAfter) && retryAfter > 0 ? ` Try again in about ${Math.ceil(retryAfter)} seconds.` : ' Wait a moment and try again.'}`, 429, true);
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new AppError('AI_BAD_REQUEST', 'The AI service rejected the request. This is usually a configuration problem (model name or unsupported option).', 502);
  }
  if (e instanceof Anthropic.APIError && (e.status === 529 || (e.status ?? 0) >= 500)) {
    return new AppError('AI_UNAVAILABLE', 'The AI service is temporarily unavailable or overloaded. Please try again shortly.', 503, true);
  }
  if (e instanceof Anthropic.APIError) {
    return new AppError('AI_ERROR', `The AI service returned an error (HTTP ${e.status ?? 'unknown'}).`, 502, true);
  }
  return new AppError('AI_ERROR', 'The AI request failed unexpectedly.', 502, true);
}
