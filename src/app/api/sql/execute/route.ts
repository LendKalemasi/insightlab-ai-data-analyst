import { NextResponse } from 'next/server';
import { ExecuteSqlRequest } from '@/lib/types';
import { get } from '@/lib/datasource/registry';
import { AppError, toErrorResponse } from '@/lib/errors';
import { MAX_QUERY_ROWS } from '@/lib/limits';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = ExecuteSqlRequest.parse(await req.json());
    const ds = get(body.data_source_id);
    if (!ds) throw new AppError('NOT_FOUND', 'That dataset session has expired.', 404);
    return NextResponse.json(ds.executeReadOnlyQuery(body.sql, Math.min(body.max_rows, MAX_QUERY_ROWS), body.timeout_ms));
  } catch (e) { return toErrorResponse(e); }
}
