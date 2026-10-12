import { AppError } from '../errors';
import type { RawTable } from './index';

const DELIMITERS = [',', ';', '\t', '|'] as const;
const MAX_CELL_LENGTH = 100_000;

/** Decodes bytes as UTF-8, UTF-16 (by BOM) or Windows-1252 when the bytes are not valid UTF-8. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'UTF-16' };
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

/** Counts delimiter occurrences outside quotes on the first lines; the most consistent wins. */
export function detectDelimiter(text: string): string {
  const lines: string[] = [];
  let line = '', quoted = false;
  for (let i = 0; i < text.length && lines.length < 20; i++) {
    const c = text[i];
    if (c === '"') quoted = !quoted;
    if ((c === '\n' || c === '\r') && !quoted) { if (line) lines.push(line); line = ''; continue; }
    line += c;
  }
  if (line && lines.length < 20) lines.push(line);
  let best = ',', bestScore = -1;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((n) => n === first).length;
    const score = consistent * 1000 + first;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let n = 0, quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === d && !quoted) n++;
  }
  return n;
}

/**
 * RFC 4180 parser: quoted fields, embedded delimiters and newlines, "" escapes,
 * CRLF / LF / CR line endings. Bounded by `maxRows` and `maxColumns`.
 */
export function parseCsv(bytes: Uint8Array, limits: { maxRows: number; maxColumns: number }): RawTable {
  const { text, encoding } = decodeText(bytes);
  if (!text.trim()) throw new AppError('EMPTY_FILE', 'The file is empty.', 400);

  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let quoted = false;
  let fieldStart = 0;
  let parts: string[] = [];

  const endField = (end: number) => {
    const chunk = text.slice(fieldStart, end);
    parts.push(chunk);
    const value = parts.join('');
    parts = [];
    if (value.length > MAX_CELL_LENGTH) throw new AppError('CELL_TOO_LARGE', `A cell exceeds ${MAX_CELL_LENGTH.toLocaleString()} characters. Is this really a CSV file?`, 413);
    record.push(value);
    if (record.length > limits.maxColumns) throw new AppError('TOO_MANY_COLUMNS', `The file has more than ${limits.maxColumns} columns.`, 413);
  };
  const endRecord = () => {
    records.push(record);
    record = [];
    if (records.length > limits.maxRows + 1) {
      throw new AppError('TOO_MANY_ROWS', `The file has more than ${limits.maxRows.toLocaleString()} rows. Upload a filtered or sampled export.`, 413);
    }
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { parts.push(text.slice(fieldStart, i + 1)); i++; fieldStart = i + 1; }
        else { parts.push(text.slice(fieldStart, i)); quoted = false; fieldStart = i + 1; }
      }
      continue;
    }
    if (c === '"' && i === fieldStart) { quoted = true; fieldStart = i + 1; continue; }
    if (c === delimiter) { endField(i); fieldStart = i + 1; continue; }
    if (c === '\n' || c === '\r') {
      endField(i);
      endRecord();
      if (c === '\r' && text[i + 1] === '\n') i++;
      fieldStart = i + 1;
    }
  }
  if (quoted) throw new AppError('MALFORMED_CSV', 'The file has a quoted field that is never closed, so rows cannot be separated reliably.', 400);
  if (fieldStart < text.length || record.length) { endField(text.length); endRecord(); }

  const header = records.shift() ?? [];
  if (!header.some((h) => h.trim())) throw new AppError('NO_HEADER', 'The first row must contain column names.', 400);

  let ragged = 0;
  const rows = records
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => {
      if (r.length !== header.length) ragged++;
      return header.map((_, i) => r[i] ?? '');
    });
  const blank = records.length - rows.length;

  const notes: string[] = [];
  if (delimiter !== ',') notes.push(`Detected ${delimiter === '\t' ? 'tab' : `"${delimiter}"`} as the delimiter.`);
  if (encoding !== 'UTF-8') notes.push(`The file was decoded as ${encoding}.`);
  if (blank) notes.push(`${blank} blank row${blank > 1 ? 's were' : ' was'} skipped.`);
  if (ragged) notes.push(`${ragged} row${ragged > 1 ? 's' : ''} had a different number of fields than the header; missing fields were left empty and extra fields were ignored.`);
  return { headers: header, rows, notes };
}
