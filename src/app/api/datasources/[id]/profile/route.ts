import { NextResponse } from 'next/server';
import { get } from '@/lib/datasource/registry';
import { AppError, toErrorResponse } from '@/lib/errors';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ds = get(id);
    if (!ds) throw new AppError('NOT_FOUND', 'That dataset session has expired. Load the demo set or upload the file again.', 404, false);
    return NextResponse.json({ profiles: ds.profile(), quality_warnings: ds.qualityWarnings(), schema: ds.schema() });
  } catch (e) { return toErrorResponse(e); }
}
