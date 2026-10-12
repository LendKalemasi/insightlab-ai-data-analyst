/** Small, dependency-free statistics helpers. All functions ignore nothing: callers pass finite numbers only. */

export function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : NaN;
}

/** Sample standard deviation (n − 1), the convention spreadsheets and pandas use. */
export function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Linear-interpolated quantile on a pre-sorted array (pandas' default "linear" method). */
export function quantileSorted(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function sortNumbers(xs: number[]): number[] {
  return Array.from(Float64Array.from(xs).sort());
}

function niceStep(range: number, target: number): number {
  const rough = range / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const f = rough / power;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * power;
}

/**
 * Histogram with "nice" round bin edges. Bin count follows Freedman–Diaconis,
 * clamped to 6–30 so charts stay readable. Bins are [start, end) except the
 * last, which includes its end.
 */
export function histogram(sorted: number[], maxBins = 30): { start: number; end: number; count: number }[] {
  if (!sorted.length) return [];
  const min = sorted[0], max = sorted[sorted.length - 1];
  if (min === max) return [{ start: min, end: max, count: sorted.length }];
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const binWidth = (2 * iqr) / Math.cbrt(sorted.length);
  const fd = binWidth > 0 ? Math.ceil((max - min) / binWidth) : 0;
  const target = Math.min(maxBins, Math.max(6, fd || Math.ceil(Math.log2(sorted.length) + 1)));
  const step = niceStep(max - min, target);
  const start = Math.floor(min / step) * step;
  const bins: { start: number; end: number; count: number }[] = [];
  for (let edge = start; edge <= max && bins.length < maxBins * 2; edge += step) {
    bins.push({ start: round(edge), end: round(edge + step), count: 0 });
  }
  for (const x of sorted) {
    let i = Math.floor((x - start) / step);
    if (i >= bins.length) i = bins.length - 1;
    bins[Math.max(0, i)].count++;
  }
  return bins;
}

const round = (n: number) => Number(n.toPrecision(12));

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sx += dx * dx; sy += dy * dy;
  }
  return sx && sy ? sxy / Math.sqrt(sx * sy) : null;
}

/** Average ranks (ties share the mean rank), as used by Spearman's rho. */
export function ranks(xs: number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = rank;
    i = j + 1;
  }
  return out;
}

export function spearman(xs: number[], ys: number[]): number | null {
  return pearson(ranks(xs), ranks(ys));
}

export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } | null {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Plain-language strength for |r|, following common rule-of-thumb bands. */
export function correlationStrength(r: number): string {
  const a = Math.abs(r);
  const strength = a >= 0.8 ? 'very strong' : a >= 0.6 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'negligible';
  return a < 0.2 ? strength : `${strength} ${r > 0 ? 'positive' : 'negative'}`;
}
