import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { ApiErrorBody } from './types';

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) { super(message); }
}

export function errorBody(e: unknown): { status: number; body: ApiErrorBody } {
  if (e instanceof AppError) {
    return { status: e.status, body: { error: { code: e.code, message: e.message, retryable: e.retryable, details: e.details } } };
  }
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    return { status: 400, body: { error: { code: 'BAD_REQUEST', message: `The request was invalid${where}: ${first?.message ?? 'unknown problem'}.`, retryable: false } } };
  }
  if (e instanceof SyntaxError) {
    return { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'The request body is not valid JSON.', retryable: false } } };
  }
  // Log the message only — never stack traces with dataset values to clients.
  console.error('[insightlab] unhandled error:', e instanceof Error ? e.message : 'unknown');
  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Something went wrong while processing the request. Please try again.', retryable: true } } };
}

/** Single exit point for API errors. Never serialises stack traces or dataset contents. */
export function toErrorResponse(e: unknown): NextResponse<ApiErrorBody> {
  const { status, body } = errorBody(e);
  return NextResponse.json(body, { status });
}
