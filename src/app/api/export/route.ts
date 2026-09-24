import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toErrorResponse } from '@/lib/errors';

export const runtime = 'nodejs';
const Body = z.object({
  file_name: z.string().min(1).max(80).regex(/^[\w.-]+$/),
  format: z.enum(['csv', 'json']),
  columns: z.array(z.string()).max(200),
  rows: z.array(z.record(z.unknown())).max(5000),
});

/** Serialises a result the client already holds. No dataset is read here. */
export async function POST(req: Request) {
  try {
    const { file_name, format, columns, rows } = Body.parse(await req.json());
    const body = format === 'json'
      ? JSON.stringify(rows, null, 2)
      : [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n');
    return new NextResponse(body, {
      headers: {
        'content-type': format === 'json' ? 'application/json' : 'text/csv',
        'content-disposition': `attachment; filename="${file_name}.${format}"`,
      },
    });
  } catch (e) { return toErrorResponse(e); }
}

const csvCell = (v: unknown) => {
  const raw = v === null || v === undefined ? '' : String(v);
  const s = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
