import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/config';
import { toErrorResponse } from '@/lib/errors';
import { runUserSql } from '@/lib/query/execute';
import { openDataset } from '@/lib/store/datasets';

export const runtime = 'nodejs';

const Body = z.object({ sql: z.string().min(1).max(20_000) });

/** POST /api/datasets/:id/query — run a validated, read-only SELECT from the SQL editor. */
export async function POST(req: Request, ctx: RouteContext<'/api/datasets/[id]/query'>) {
  try {
    const { id } = await ctx.params;
    const { sql } = Body.parse(await req.json());
    const { db } = openDataset(id);
    return NextResponse.json(runUserSql(db, sql, config.maxResultRows));
  } catch (e) { return toErrorResponse(e); }
}
