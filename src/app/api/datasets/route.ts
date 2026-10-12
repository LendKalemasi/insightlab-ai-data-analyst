import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config, logConfigOnce } from '@/lib/config';
import { demoTable } from '@/lib/demo-data';
import { AppError, toErrorResponse } from '@/lib/errors';
import { finish, ingestFile } from '@/lib/ingest';
import { createDataset, findDatasets } from '@/lib/store/datasets';

export const runtime = 'nodejs';
export const maxDuration = 120;

const DemoBody = z.object({ kind: z.literal('demo') });

/** POST /api/datasets — import an uploaded CSV/Excel file (multipart) or the demo dataset (JSON). */
export async function POST(req: Request) {
  logConfigOnce();
  try {
    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      DemoBody.parse(await req.json());
      const table = finish(demoTable(), 'demo', null);
      const info = createDataset(table, { name: 'Demo · E-commerce orders', fileName: null, fileBytes: null });
      return NextResponse.json(info, { status: 201 });
    }
    if (!contentType.includes('multipart/form-data')) {
      throw new AppError('BAD_REQUEST', 'Send a file as multipart/form-data, or {"kind":"demo"} as JSON.', 415);
    }
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > config.maxUploadBytes + 64 * 1024) throw tooLarge(declared);

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) throw new AppError('NO_FILE', 'No file was included in the upload.', 400);
    if (file.size > config.maxUploadBytes) throw tooLarge(file.size);
    const sheetField = form.get('sheet');
    const sheet = typeof sheetField === 'string' && sheetField ? sheetField : null;

    // Bytes are parsed in memory and stored only as the dataset's SQLite table. File contents are never logged.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const table = await ingestFile(bytes, file.name, { maxRows: config.maxRows, maxColumns: config.maxColumns }, sheet);
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Untitled dataset';
    const info = createDataset(table, { name, fileName: file.name.slice(0, 200), fileBytes: file.size });
    return NextResponse.json(info, { status: 201 });
  } catch (e) {
    return toErrorResponse(e);
  }
}

/** GET /api/datasets?ids=a,b — summaries for datasets this browser already knows about. There is no "list all". */
export async function GET(req: Request) {
  try {
    const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 50);
    return NextResponse.json({ datasets: findDatasets(ids) });
  } catch (e) {
    return toErrorResponse(e);
  }
}

function tooLarge(bytes: number) {
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  return new AppError('TOO_LARGE', `The file is ${mb(bytes)}; the limit is ${mb(config.maxUploadBytes)}. Upload a filtered or sampled export.`, 413);
}
