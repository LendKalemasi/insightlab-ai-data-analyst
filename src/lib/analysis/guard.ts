import { parseDate } from '../ingest/values';
import type { ColumnProfile, DatasetInfo } from '../types';
import type { AnalysisSpec, Filter, Measure, TimeGrain } from './spec';

/**
 * A spec may come from a language model, so nothing in it is trusted until it
 * has been checked against the real schema. The guard:
 *  - resolves column names (exact, then case-insensitive) and rejects unknown ones,
 *  - rejects operations that do not fit a column's type (e.g. summing text),
 *  - coerces filter values to the column's type and normalises dates,
 *  - clamps sizes and fills sensible defaults.
 * It returns a corrected spec plus notes describing every adjustment, or a
 * list of problems that make the spec unusable.
 */
export type GuardResult =
  | { ok: true; spec: AnalysisSpec; notes: string[]; columns: string[] }
  | { ok: false; problems: string[] };

export function guardSpec(input: AnalysisSpec, info: DatasetInfo, limits: { maxResultRows: number }): GuardResult {
  const problems: string[] = [];
  const notes: string[] = [];
  const used = new Set<string>();
  const byName = new Map(info.columns.map((c) => [c.name, c]));
  const byLower = new Map(info.columns.map((c) => [c.name.toLowerCase(), c]));

  const resolve = (name: string | null | undefined, role: string): ColumnProfile | null => {
    if (!name) { problems.push(`No column was given for ${role}.`); return null; }
    const col = byName.get(name) ?? byLower.get(name.toLowerCase()) ?? byLower.get(name.toLowerCase().replace(/\s+/g, '_'));
    if (!col) { problems.push(`Column "${name}" (${role}) does not exist in this dataset.`); return null; }
    used.add(col.name);
    return col;
  };
  const numeric = (col: ColumnProfile | null, role: string) => {
    if (col && col.type !== 'numeric') problems.push(`${role} needs a numeric column, but ${col.name} is ${col.type}.`);
    return col;
  };

  const filters = (list: Filter[]): Filter[] => list.map((f) => guardFilter(f, resolve(f.column, 'filter'), problems, notes)).filter((f): f is Filter => !!f);

  let spec: AnalysisSpec;
  switch (input.kind) {
    case 'aggregate': {
      if (input.dimensions.length > 2) problems.push('At most two grouping columns are supported.');
      if (!input.measures.length) problems.push('The analysis needs at least one measure.');
      const dimensions = input.dimensions.slice(0, 2).map((d) => {
        const col = resolve(d.column, 'grouping');
        if (!col) return d;
        let grain: TimeGrain | null = d.time_grain;
        if (col.type === 'date' && !grain) { grain = defaultGrain(col); notes.push(`Dates in ${col.name} were grouped by ${grain}.`); }
        if (col.type !== 'date' && grain) grain = null;
        if (col.type === 'numeric' && col.distinct > 50) notes.push(`${col.name} is numeric with many distinct values; grouping by it produces one group per value.`);
        return { column: col.name, time_grain: grain };
      });
      const measures = input.measures.slice(0, 4).map((m): Measure => {
        if (m.agg === 'count' && !m.column) return m;
        const col = resolve(m.column, `${m.agg}`);
        if (!col) return m;
        if ((m.agg === 'sum' || m.agg === 'avg') && col.type !== 'numeric') {
          problems.push(`Cannot ${m.agg === 'sum' ? 'sum' : 'average'} ${col.name} because it is ${col.type}, not numeric.`);
        }
        if ((m.agg === 'min' || m.agg === 'max') && !['numeric', 'date'].includes(col.type)) {
          problems.push(`Cannot take the ${m.agg} of ${col.name} because it is ${col.type}.`);
        }
        return { column: col.name, agg: m.agg };
      });
      const sort = input.sort && (input.sort.by === 'measure' ? input.sort.index < measures.length : input.sort.index < dimensions.length) && input.sort.index >= 0 ? input.sort : null;
      const limit = input.limit === null ? null : Math.max(1, Math.min(input.limit, limits.maxResultRows));
      const shareable = measures[0] && ['sum', 'count'].includes(measures[0].agg);
      if (input.include_share && !shareable) notes.push('Share of total is only shown for sums and counts.');
      spec = { ...input, dimensions, measures, sort, limit, include_share: Boolean(input.include_share && shareable && dimensions.length > 0), filters: filters(input.filters) };
      break;
    }
    case 'distribution': {
      const col = resolve(input.column, 'distribution');
      spec = { ...input, column: col?.name ?? input.column, filters: filters(input.filters) };
      break;
    }
    case 'correlation': {
      let cols = input.columns.length ? input.columns.map((c) => resolve(c, 'correlation')).filter((c): c is ColumnProfile => !!c)
        : info.columns.filter((c) => c.type === 'numeric');
      const nonNumeric = cols.filter((c) => c.type !== 'numeric');
      if (nonNumeric.length) notes.push(`Skipped non-numeric columns: ${nonNumeric.map((c) => c.name).join(', ')}.`);
      cols = cols.filter((c) => c.type === 'numeric').slice(0, 15);
      cols.forEach((c) => used.add(c.name));
      if (cols.length < 2) problems.push('Correlation needs at least two numeric columns.');
      spec = { ...input, columns: cols.map((c) => c.name), filters: filters(input.filters) };
      break;
    }
    case 'relationship': {
      const x = numeric(resolve(input.x, 'x axis'), 'The x axis');
      const y = numeric(resolve(input.y, 'y axis'), 'The y axis');
      let color = input.color_by ? resolve(input.color_by, 'colour') : null;
      if (color && color.distinct > 3) { notes.push(`${color.name} has too many values to colour points by; the three largest groups are coloured and the rest shown as "Other".`); }
      if (color && color.type === 'numeric') { notes.push(`${color.name} is numeric, so points are not coloured by it.`); color = null; }
      spec = { ...input, x: x?.name ?? input.x, y: y?.name ?? input.y, color_by: color?.name ?? null, filters: filters(input.filters) };
      break;
    }
    case 'describe': {
      const cols = input.columns.length ? input.columns.map((c) => resolve(c, 'summary')).filter((c): c is ColumnProfile => !!c) : info.columns;
      cols.forEach((c) => used.add(c.name));
      spec = { ...input, columns: cols.slice(0, 30).map((c) => c.name), filters: filters(input.filters) };
      break;
    }
    case 'outliers': {
      const col = numeric(resolve(input.column, 'outliers'), 'Outlier detection');
      spec = { ...input, column: col?.name ?? input.column, filters: filters(input.filters) };
      break;
    }
    case 'rows': {
      const cols = input.columns.map((c) => resolve(c, 'listing')).filter((c): c is ColumnProfile => !!c);
      const sortCol = input.sort ? resolve(input.sort.column, 'sort') : null;
      spec = {
        ...input,
        columns: cols.map((c) => c.name),
        sort: sortCol && input.sort ? { column: sortCol.name, direction: input.sort.direction } : null,
        limit: Math.max(1, Math.min(input.limit || 20, 100)),
        filters: filters(input.filters),
      };
      break;
    }
    case 'quality': {
      const cols = input.columns.map((c) => resolve(c, 'quality')).filter((c): c is ColumnProfile => !!c);
      spec = { ...input, columns: cols.map((c) => c.name) };
      break;
    }
  }
  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, spec, notes, columns: [...used] };
}

export function defaultGrain(col: ColumnProfile): TimeGrain {
  const months = col.date?.months ?? 12;
  if (months <= 2) return 'day';
  if (months <= 36) return 'month';
  if (months <= 96) return 'quarter';
  return 'year';
}

function guardFilter(f: Filter, col: ColumnProfile | null, problems: string[], notes: string[]): Filter | null {
  if (!col) return null;
  const needsValue = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with'].includes(f.op);
  const needsList = ['in', 'not_in', 'between'].includes(f.op);
  let value = f.value;
  let values = f.values;
  let op = f.op;

  const coerce = (v: string | number | boolean): string | number | null => {
    if (col.type === 'numeric') {
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[,$€£\s]/g, ''));
      return Number.isFinite(n) ? n : null;
    }
    if (col.type === 'date') {
      const s = String(v).trim();
      if (/^\d{4}(-\d{2})?$/.test(s)) return s; // partial dates are handled below
      return parseDate(s, 'mdy') ?? s;
    }
    return String(v);
  };

  if (needsValue) {
    if (value === null || value === undefined || value === '') { problems.push(`The filter on ${col.name} has no value.`); return null; }
    const c = coerce(value);
    if (c === null) { problems.push(`"${value}" is not a valid value for numeric column ${col.name}.`); return null; }
    value = c;
    if (['gt', 'gte', 'lt', 'lte'].includes(op) && !['numeric', 'date'].includes(col.type)) {
      problems.push(`Cannot compare ${col.name} with > or < because it is ${col.type}.`);
    }
    // "2024" or "2024-03" on a date column means the whole year or month.
    if (col.type === 'date' && typeof value === 'string' && /^\d{4}(-\d{2})?$/.test(value)) {
      if (op === 'eq') { op = 'starts_with'; notes.push(`Interpreted ${col.name} = ${value} as the whole ${value.length === 4 ? 'year' : 'month'}.`); }
      else if (op === 'lte' || op === 'gt') { value = value.length === 4 ? `${value}-12-31` : endOfMonth(value); }
      else if (op === 'gte' || op === 'lt') { value = value.length === 4 ? `${value}-01-01` : `${value}-01`; }
    }
  } else if (needsList) {
    const list = (values ?? []).map(coerce).filter((v): v is string | number => v !== null);
    if (!list.length || (op === 'between' && list.length !== 2)) { problems.push(`The filter on ${col.name} needs ${op === 'between' ? 'exactly two values' : 'at least one value'}.`); return null; }
    values = list.slice(0, 200);
    value = null;
  } else {
    value = null; values = null;
  }
  return { column: col.name, op, value, values: needsList ? values : null };
}

function endOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
