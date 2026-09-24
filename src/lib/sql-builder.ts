import type { AnalysisPlan } from './types';

/** SQLite identifier quoting. The only place a column name enters SQL text. */
export function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_ ]*$/.test(name)) {
    throw new Error(`Unsafe identifier rejected: ${name}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

const AGG_FN: Record<string, string> = { sum: 'SUM', avg: 'AVG', count: 'COUNT' };

/**
 * Builds SQL from the typed plan object, never from raw user text. Every
 * identifier is validated against the dataset schema by the caller and quoted
 * here, so natural-language input cannot reach the query string.
 */
export function buildSql(plan: AnalysisPlan, table = 'dataset'): string | null {
  const op = plan.operation;
  const t = quoteIdent(table);
  switch (op.kind) {
    case 'trend': {
      const alias = `${op.agg}_${op.metric}`;
      return `SELECT substr(${quoteIdent(op.date_column)}, 1, 7) AS month,\n`
        + `       ROUND(${AGG_FN[op.agg]}(${quoteIdent(op.metric)}), 2) AS ${quoteIdent(alias)}\n`
        + `FROM ${t}\nGROUP BY month\nORDER BY month`;
    }
    case 'group': {
      const alias = `${op.agg}_${op.metric}`;
      return `SELECT ${quoteIdent(op.dimension)},\n`
        + `       ROUND(${AGG_FN[op.agg]}(${quoteIdent(op.metric)}), 2) AS ${quoteIdent(alias)}\n`
        + `FROM ${t}\nGROUP BY ${quoteIdent(op.dimension)}\n`
        + `ORDER BY ${quoteIdent(alias)} DESC\nLIMIT ${op.limit}`;
    }
    case 'share': {
      const d = quoteIdent(op.dimension);
      return `SELECT ${d}, COUNT(*) AS rows_count,\n`
        + `       ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM ${t}), 2) AS pct\n`
        + `FROM ${t}\nGROUP BY ${d}\nORDER BY rows_count DESC`;
    }
    default:
      return null; // correlation / quality are computed from profiles or pandas
  }
}

export function buildPython(plan: AnalysisPlan): string | null {
  const op = plan.operation;
  switch (op.kind) {
    case 'trend':
      return `df['month'] = pd.to_datetime(df['${op.date_column}'], errors='coerce').dt.to_period('M').astype(str)\n`
        + `result = (df.groupby('month', as_index=False)['${op.metric}']\n`
        + `            .${op.agg === 'avg' ? 'mean' : op.agg}()\n`
        + `            .rename(columns={'${op.metric}': '${op.agg}_${op.metric}'}))`;
    case 'group':
      return `result = (df.groupby('${op.dimension}', as_index=False)['${op.metric}']\n`
        + `            .${op.agg === 'avg' ? 'mean' : op.agg}()\n`
        + `            .rename(columns={'${op.metric}': '${op.agg}_${op.metric}'})\n`
        + `            .sort_values('${op.agg}_${op.metric}', ascending=False)\n`
        + `            .head(${op.limit}))`;
    case 'share':
      return `result = (df['${op.dimension}'].value_counts()\n`
        + `            .rename_axis('${op.dimension}').reset_index(name='rows_count'))\n`
        + `result['pct'] = (100 * result['rows_count'] / len(df)).round(2)`;
    case 'correlation':
      return `cols = ${JSON.stringify(op.columns)}\nresult = df[cols].corr(numeric_only=True).round(3).reset_index()`;
    case 'quality':
      return `result = pd.DataFrame({\n`
        + `    'column': df.columns,\n`
        + `    'nulls': df.isna().sum().values,\n`
        + `    'null_pct': (100 * df.isna().mean()).round(2).values,\n`
        + `    'unique': df.nunique().values,\n})`;
    default:
      return null;
  }
}
