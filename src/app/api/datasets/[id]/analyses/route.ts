import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/errors';
import { clearTurns, listTurns } from '@/lib/store/analyses';
import { getDatasetInfo } from '@/lib/store/datasets';

export const runtime = 'nodejs';

/** The saved analysis conversation for a dataset. */
export async function GET(_req: Request, ctx: RouteContext<'/api/datasets/[id]/analyses'>) {
  try {
    const { id } = await ctx.params;
    getDatasetInfo(id);
    return NextResponse.json({ turns: listTurns(id) });
  } catch (e) { return toErrorResponse(e); }
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/datasets/[id]/analyses'>) {
  try {
    const { id } = await ctx.params;
    getDatasetInfo(id);
    clearTurns(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) { return toErrorResponse(e); }
}
