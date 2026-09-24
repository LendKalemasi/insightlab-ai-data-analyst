/**
 * Deterministic demo dataset: a seeded LCG, so every run of the app produces
 * byte-identical rows and therefore reproducible analysis results.
 */
export interface DemoRow {
  date: string; customer_id: string; segment: string; region: string;
  category: string; product: string; units: number; revenue: number;
  cost: number; profit: number; status: string; channel: string;
}

const REGIONS = ['North', 'South', 'East', 'West'];
const SEGMENTS = ['SMB', 'Enterprise', 'Consumer'];
const CHANNELS = ['Paid Search', 'Email', 'Organic', 'Social'];
const STATUSES = ['completed', 'completed', 'completed', 'completed', 'cancelled', 'refunded'];
const CATALOG: Record<string, { products: string[]; price: number }> = {
  Electronics: { products: ['Aero Laptop', 'Nova Phone', 'Pulse Buds'], price: 180 },
  Apparel: { products: ['Trail Jacket', 'Core Tee', 'Alpine Boots'], price: 55 },
  Home: { products: ['Lume Lamp', 'Drift Chair', 'Terra Mug'], price: 40 },
  Sports: { products: ['Kinetic Bike', 'Vertex Racket', 'Flux Mat'], price: 90 },
};
const CATEGORIES = Object.keys(CATALOG);

export function generateDemoRows(days = 270, seed = 42): DemoRow[] {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const rows: DemoRow[] = [];

  for (let d = 0; d < days; d++) {
    const date = new Date(Date.UTC(2025, 0, 1 + d)).toISOString().slice(0, 10);
    const orders = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < orders; i++) {
      const category = pick(CATEGORIES);
      const { products, price } = CATALOG[category];
      const units = 1 + Math.floor(rnd() * 9);
      const growth = 1 + (d / days) * 0.32;          // gentle upward trend
      const season = 1 + 0.15 * Math.sin(d / 30);     // monthly seasonality
      const revenue = round2(units * price * growth * season * (0.85 + rnd() * 0.3));
      const cost = round2(revenue * (0.52 + rnd() * 0.18));
      rows.push({
        date,
        customer_id: `C${1000 + Math.floor(rnd() * 420)}`,
        segment: pick(SEGMENTS),
        // ~3% missing regions on purpose, so data-quality handling is demonstrable
        region: rnd() < 0.03 ? '' : pick(REGIONS),
        category, product: pick(products), units,
        revenue, cost, profit: round2(revenue - cost),
        status: pick(STATUSES), channel: pick(CHANNELS),
      });
    }
  }
  return rows;
}

export const DEMO_COLUMNS = ['date', 'customer_id', 'segment', 'region', 'category',
  'product', 'units', 'revenue', 'cost', 'profit', 'status', 'channel'];

const round2 = (n: number) => Math.round(n * 100) / 100;
