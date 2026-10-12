/**
 * Column names become SQL identifiers, Python string literals and prompt
 * content, so they are normalised once at import time: letters (any script),
 * digits, underscores and single spaces only, starting with a letter or `_`,
 * at most 64 characters, and unique ignoring case (SQLite identifiers are
 * case-insensitive, so "Sales" and "sales" would otherwise collide).
 */
export const SAFE_IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_ ]{0,63}$/u;

export function sanitizeHeader(raw: string, index: number): string {
  let name = raw.normalize('NFKC').trim()
    .replace(/[^\p{L}\p{N}_ ]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/ +/g, ' ')
    .replace(/^[_ ]+|[_ ]+$/g, '');
  if (!name) return `column_${index + 1}`;
  if (!/^[\p{L}_]/u.test(name)) name = `col_${name}`;
  // SQLite resolves these to the implicit row id rather than a column.
  if (['rowid', '_rowid_', 'oid'].includes(name.toLowerCase())) name = `${name}_col`;
  return name.slice(0, 64).trim();
}

export interface HeaderResult { names: string[]; notes: string[] }

export function normalizeHeaders(raw: string[]): HeaderResult {
  const used = new Set<string>();
  const renamed: string[] = [];
  const names = raw.map((header, i) => {
    const original = String(header ?? '').trim();
    const base = sanitizeHeader(original, i);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 60)}_${n}`;
    used.add(name.toLowerCase());
    if (name !== original) renamed.push(original ? `"${original}" → ${name}` : `(blank) → ${name}`);
    return name;
  });
  const notes = renamed.length
    ? [`${renamed.length} column name${renamed.length > 1 ? 's were' : ' was'} adjusted to be query-safe: ${renamed.slice(0, 8).join(', ')}${renamed.length > 8 ? ', …' : ''}.`]
    : [];
  return { names, notes };
}
