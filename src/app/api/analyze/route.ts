import { NextResponse } from 'next/server';
import { AskRequest } from '@/lib/types';
import { get } from '@/lib/datasource/registry';
import { runAnalysis } from '@/lib/agent/orchestrator';
import { AppError, toErrorResponse } from '@/lib/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { data_source_id, question, history } = AskRequest.parse(await req.json());
    const ds = get(data_source_id);
    if (!ds) throw new AppError('NOT_FOUND', 'That dataset session has expired. Load the dataset again to continue.', 404);
    return NextResponse.json(await runAnalysis(ds, question, history));
  } catch (e) { return toErrorResponse(e); }
}
