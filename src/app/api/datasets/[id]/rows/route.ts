import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardSpec } from '@/lib/analysis/guard';
import { Filter } from '@/lib/analysis/spec';
import { AppError, toErrorResponse } from '@/lib/errors';
import { browseRows } from '@/lib/query/execute';
import { openDataset } from '@/lib/store/datasets';

export const runtime = 'nodejs';

const Query = z.object({
  offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  sort: z.string().max(80).nullable().default(null),
  dir: z.enum(['asc', 'desc']).default('asc'),
  q: z.string().max(200).nullable().default(null),
  filters: z.string().max(4000).nullable().default(null),
});

/** GET /api/datasets/:id/rows — paged, sorted, searchable, filterable rows for the data browser. */
export async function GET(req: Request, ctx: RouteContext<'/api/datasets/[id]/rows'>) {
  try {
    const { id } = await ctx.params;
    const sp = new URL(req.url).searchParams;
    const p = Query.parse({
      offset: sp.get('offset') ?? undefined,
      limit: sp.get('limit') ?? undefined,
      sort: sp.get('sort'),
      dir: sp.get('dir') ?? undefined,
      q: sp.get('q')?.trim() || null,
      filters: sp.get('filters'),
    });
    const { info, db } = openDataset(id);
    let filters: Filter[] = [];
    if (p.filters) {
      let raw: unknown;
      try { raw = JSON.parse(p.filters); } catch { throw new AppError('BAD_REQUEST', 'filters must be a JSON array.', 400); }
      const parsed = z.array(Filter).max(10).parse(raw);
      // The analysis guard gives browser filters the same column checks and type coercion.
      const guarded = guardSpec({ kind: 'rows', columns: [], filters: parsed, sort: null, limit: 1 }, info, { maxResultRows: 1 });
      if (!guarded.ok) throw new AppError('BAD_FILTER', guarded.problems.join(' '), 400);
      filters = guarded.spec.kind === 'rows' ? guarded.spec.filters : [];
    }
    return NextResponse.json(browseRows(db, info, { offset: p.offset, limit: p.limit, sort: p.sort, direction: p.dir, search: p.q, filters }));
  } catch (e) { return toErrorResponse(e); }
}
