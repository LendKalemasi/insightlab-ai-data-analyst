import { NextResponse } from 'next/server';
import { get } from '@/lib/datasource/registry';
import { AppError, toErrorResponse } from '@/lib/errors';
import { parseSampleLimit } from '@/lib/limits';

export const runtime = 'nodejs';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ds = get(id);
    if (!ds) throw new AppError('NOT_FOUND', 'That dataset session has expired.', 404);
    const limit = parseSampleLimit(new URL(req.url).searchParams.get('limit'));
    return NextResponse.json(ds.sample(limit));
  } catch (e) { return toErrorResponse(e); }
}
