import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/errors';
import { deleteDataset, getDatasetInfo } from '@/lib/store/datasets';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctx: RouteContext<'/api/datasets/[id]'>) {
  try {
    const { id } = await ctx.params;
    return NextResponse.json(getDatasetInfo(id));
  } catch (e) { return toErrorResponse(e); }
}

/** Permanently deletes the dataset and its saved analyses. */
export async function DELETE(_req: Request, ctx: RouteContext<'/api/datasets/[id]'>) {
  try {
    const { id } = await ctx.params;
    getDatasetInfo(id);
    deleteDataset(id);
    return new NextResponse(null, { status: 204 });
  } catch (e) { return toErrorResponse(e); }
}
