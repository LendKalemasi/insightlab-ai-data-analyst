/** Number and value formatting shared by server-generated text and the UI. Locale is fixed so server and browser agree. */
const LOCALE = 'en-US';

export function formatNumber(n: number, maxDigits?: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  const digits = maxDigits ?? (abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : abs === 0 ? 0 : 3);
  return n.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

/** Two significant decimals for statistics like means and percentages. */
export function formatStat(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  return n.toLocaleString(LOCALE, { maximumFractionDigits: abs >= 1000 ? 0 : abs >= 1 ? 2 : 3 });
}

export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toLocaleString(LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
}

export function formatPercent(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString(LOCALE, { maximumFractionDigits: digits, minimumFractionDigits: 0 })}%`;
}

export function formatInteger(n: number): string {
  return Math.round(n).toLocaleString(LOCALE);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
