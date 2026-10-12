import { unzipSync } from 'fflate';
import readXlsxFile from 'read-excel-file/node';
import { AppError } from '../errors';
import type { Cell } from './values';
import type { RawTable } from './index';

/** Upper bound on the decompressed size of an .xlsx archive (zip-bomb guard). */
const MAX_UNCOMPRESSED_BYTES = 400 * 1024 * 1024;

function assertSafeArchive(bytes: Uint8Array): void {
  let total = 0;
  try {
    // The filter sees each entry's declared size and returns false, so nothing is inflated.
    unzipSync(bytes, {
      filter(file) {
        total += file.originalSize;
        return false;
      },
    });
  } catch {
    throw new AppError('BAD_SPREADSHEET', 'The file is not a valid .xlsx workbook. Legacy .xls files must be re-saved as .xlsx or CSV.', 400);
  }
  if (total > MAX_UNCOMPRESSED_BYTES) {
    throw new AppError('TOO_LARGE', 'The workbook expands to more data than this app can load. Export the sheet you need as CSV instead.', 413);
  }
}

export async function parseExcel(bytes: Uint8Array, limits: { maxRows: number; maxColumns: number }, sheetName?: string | null): Promise<RawTable & { sheet: string; sheets: string[] }> {
  assertSafeArchive(bytes);
  let sheets: { sheet: string; data: Cell[][] }[];
  try {
    sheets = await readXlsxFile(Buffer.from(bytes)) as { sheet: string; data: Cell[][] }[];
  } catch {
    throw new AppError('BAD_SPREADSHEET', 'The workbook could not be read. It may be password-protected or corrupted.', 400);
  }
  const names = sheets.map((s) => s.sheet);
  const nonEmpty = sheets.filter((s) => s.data.some((row) => row.some((v) => v !== null && v !== undefined && String(v).trim() !== '')));
  const chosen = sheetName ? sheets.find((s) => s.sheet === sheetName) : nonEmpty[0];
  if (!chosen) {
    throw new AppError(sheetName ? 'SHEET_NOT_FOUND' : 'EMPTY_FILE', sheetName ? `The workbook has no sheet named "${sheetName}".` : 'Every sheet in the workbook is empty.', 400);
  }

  // Skip leading blank rows so a title gap above the header does not become the header.
  const data = chosen.data;
  const headerIndex = data.findIndex((row) => row.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  const header = (data[headerIndex] ?? []).map((v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)));
  if (header.length > limits.maxColumns) throw new AppError('TOO_MANY_COLUMNS', `The sheet has more than ${limits.maxColumns} columns.`, 413);

  const body = data.slice(headerIndex + 1).filter((row) => row.some((v) => v !== null && v !== undefined && String(v).trim() !== ''));
  if (body.length > limits.maxRows) throw new AppError('TOO_MANY_ROWS', `The sheet has more than ${limits.maxRows.toLocaleString()} rows. Upload a filtered or sampled export.`, 413);

  // Trailing all-empty header columns are formatting leftovers, not data.
  let width = header.length;
  while (width > 0 && !header[width - 1]?.trim() && body.every((r) => r[width - 1] === null || r[width - 1] === undefined)) width--;

  const notes: string[] = [];
  if (nonEmpty.length > 1) notes.push(`The workbook has ${nonEmpty.length} non-empty sheets; "${chosen.sheet}" was imported.`);
  return {
    headers: header.slice(0, width),
    rows: body.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? null)),
    notes,
    sheet: chosen.sheet,
    sheets: names,
  };
}
