import { NextResponse } from 'next/server';
import type { ApiError } from './types';

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly retryable = false,
    readonly details: Record<string, unknown> = {},
  ) { super(message); }
}

/**
 * Single exit point for API errors. Never serialises stack traces or the
 * original dataset contents to the client.
 */
export function toErrorResponse(e: unknown): NextResponse<ApiError> {
  if (e instanceof AppError) {
    return NextResponse.json(
      { error: { code: e.code, message: e.message, details: e.details, retryable: e.retryable } },
      { status: e.status },
    );
  }
  console.error('[insightlab] unhandled error:', e instanceof Error ? e.message : 'unknown');
  return NextResponse.json(
    { error: { code: 'INTERNAL', message: 'Something went wrong while processing the request. Please retry.', details: {}, retryable: true } },
    { status: 500 },
  );
}
