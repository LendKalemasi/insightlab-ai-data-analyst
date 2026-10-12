import { z } from 'zod';
import { runAnalysis } from '@/lib/analysis/orchestrator';
import { AppError, errorBody, toErrorResponse } from '@/lib/errors';
import { getDatasetInfo } from '@/lib/store/datasets';
import type { AnalysisEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

const Body = z.object({ question: z.string().trim().min(2, 'Ask a question of at least two characters').max(1000) });

/** One analysis at a time per dataset, so double submits cannot interleave the conversation. */
const running = new Set<string>();

/**
 * POST /api/datasets/:id/analyze — streams newline-delimited JSON events:
 * real stage changes as they happen, then the finished turn or an error.
 * Closing the request cancels in-flight AI calls.
 */
export async function POST(req: Request, ctx: RouteContext<'/api/datasets/[id]/analyze'>) {
  let id: string;
  let question: string;
  try {
    id = (await ctx.params).id;
    ({ question } = Body.parse(await req.json()));
    getDatasetInfo(id);
    if (running.has(id)) throw new AppError('BUSY', 'An analysis is already running for this dataset. Wait for it to finish or cancel it.', 409, true);
  } catch (e) {
    return toErrorResponse(e);
  }
  running.add(id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalysisEvent) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* the client went away */ }
      };
      try {
        const turn = await runAnalysis(id, question, send, req.signal);
        send({ type: 'turn', turn });
      } catch (e) {
        const { body } = errorBody(e);
        send({ type: 'error', error: { code: body.error.code, message: body.error.message, retryable: body.error.retryable } });
      } finally {
        running.delete(id);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
  });
}
