import { NextResponse } from 'next/server';
import { z } from 'zod';
import { parseCsv } from '@/lib/csv';
import { SqliteDataSource } from '@/lib/datasource/sqlite';
import { newId, register } from '@/lib/datasource/registry';
import { DEMO_COLUMNS, generateDemoRows } from '@/lib/demo-data';
import { AppError, toErrorResponse } from '@/lib/errors';
import { MAX_UPLOAD_BYTES } from '@/lib/limits';

export const runtime = 'nodejs';
const Body = z.object({ kind: z.literal('demo') });

/** POST /api/datasources — create a session from the demo set or an uploaded CSV. */
export async function POST(req: Request) {
  try {
    const contentType = req.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      Body.parse(await req.json());
      const rows = generateDemoRows();
      const ds = register(new SqliteDataSource(newId(), 'demo_ecommerce', 'demo', DEMO_COLUMNS, rows as unknown as Record<string, unknown>[]));
      return NextResponse.json(summary(ds));
    }

    const contentLength = Number(req.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 64 * 1024) {
      throw new AppError('TOO_LARGE', 'The upload exceeds the configured size limit.', 413);
    }
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('NO_FILE', 'No file was included in the upload.', 400);
    if (!/\.csv$/i.test(file.name)) throw new AppError('BAD_TYPE', 'Only .csv files are accepted.', 415);
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError('TOO_LARGE', `The file is ${(file.size / 1e6).toFixed(1)} MB, over the ${(MAX_UPLOAD_BYTES / 1e6).toFixed(0)} MB limit. Upload a sampled export.`, 413);
    }
    // Uploaded bytes are parsed in memory and never written to disk or logged.
    const parsed = parseCsv(await file.text());
    const ds = register(new SqliteDataSource(newId(), file.name, 'csv', parsed.columns, parsed.rows));
    return NextResponse.json({
      ...summary(ds),
      delimiter: parsed.delimiter,
      renamed_columns: parsed.renamed_columns,
    });
  } catch (e) {
    return toErrorResponse(e);
  }
}

function summary(ds: { id: string; name: string; type: string; schema: () => unknown; qualityWarnings: () => string[] }) {
  return { id: ds.id, name: ds.name, type: ds.type, schema: ds.schema(), quality_warnings: ds.qualityWarnings() };
}
