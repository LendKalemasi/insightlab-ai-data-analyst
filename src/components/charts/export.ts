/**
 * Chart export. Recharts draws SVG whose colours come from CSS variables, which
 * do not survive outside the page, so every element's computed fill, stroke and
 * font are inlined before serialising. PNG is rendered at 2× for sharpness.
 */
const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline'];

function inlineStyles(source: Element, target: Element) {
  const cs = getComputedStyle(source);
  for (const prop of STYLE_PROPS) {
    const value = cs.getPropertyValue(prop);
    if (value && value !== 'normal') target.setAttribute(prop, value);
  }
  const s = source.children, t = target.children;
  for (let i = 0; i < s.length; i++) if (t[i]) inlineStyles(s[i], t[i]);
}

function buildSvg(container: HTMLElement, title: string, legend: { label: string; color: string }[]): { svg: string; width: number; height: number } | null {
  const chart = container.querySelector('svg.recharts-surface');
  if (!(chart instanceof SVGSVGElement)) return null;
  const { width, height } = chart.getBoundingClientRect();
  const clone = chart.cloneNode(true) as SVGSVGElement;
  inlineStyles(chart, clone);
  const bodyStyle = getComputedStyle(document.body);
  const background = bodyStyle.backgroundColor;
  const ink = bodyStyle.color;
  const font = bodyStyle.fontFamily.replace(/"/g, "'");
  const header = 36 + (legend.length > 1 ? 22 : 0);
  const pad = 16;
  const total = { width: Math.round(width + pad * 2), height: Math.round(height + header + pad) };
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
  let x = pad;
  const legendSvg = legend.length > 1 ? legend.map((l) => {
    const item = `<rect x="${x}" y="42" width="10" height="10" rx="2" fill="${l.color}"/><text x="${x + 15}" y="51" font-size="11" fill="${ink}" font-family="${font}">${esc(l.label)}</text>`;
    x += 30 + l.label.length * 6.2;
    return item;
  }).join('') : '';
  clone.setAttribute('x', String(pad));
  clone.setAttribute('y', String(header));
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${total.width}" height="${total.height}" viewBox="0 0 ${total.width} ${total.height}">`
    + `<rect width="100%" height="100%" fill="${background}"/>`
    + `<text x="${pad}" y="26" font-size="14" font-weight="600" fill="${ink}" font-family="${font}">${esc(title)}</text>`
    + legendSvg + new XMLSerializer().serializeToString(clone) + '</svg>';
  return { svg, ...total };
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const safeFileName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60).toLowerCase() || 'chart';

export async function exportChart(container: HTMLElement, title: string, legend: { label: string; color: string }[], format: 'svg' | 'png'): Promise<boolean> {
  const built = buildSvg(container, title, legend);
  if (!built) return false;
  const name = safeFileName(title);
  if (format === 'svg') {
    download(new Blob([built.svg], { type: 'image/svg+xml' }), `${name}.svg`);
    return true;
  }
  const img = new Image();
  const url = URL.createObjectURL(new Blob([built.svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('render failed')); img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = built.width * 2;
    canvas.height = built.height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    download(blob, `${name}.png`);
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadText(content: string, fileName: string, type: string) {
  download(new Blob([content], { type }), fileName);
}

/** CSV with formula-injection protection for spreadsheet apps. */
export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n');
}
