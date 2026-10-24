/** Map layers: what colors the tiles, and how tall they stand. */
import type { CountyData } from '../data';

export type Rgb = [number, number, number];

export interface LayerContext {
  data: CountyData;
  /** live twin unemployment by county */
  countyU: Float32Array | null;
  /** unemployment at the start of the run */
  startU: Float32Array | null;
  /** branch minus data-steered unemployment (smoothed), if forked */
  branchDiff: Float32Array | null;
  /** twin 2020 annual average minus BLS 2020, if available */
  backtestError: Float32Array | null;
  /** per county: its state's solved demand dial this month (1 = moves with the nation), if state data steers the twin */
  stateDemand: Float32Array | null;
  /** per county: its state's twin unemployment rate this month */
  stateU: Float32Array | null;
}

export interface Layer {
  id: string;
  label: string;
  group: 'Live twin' | 'People' | 'Economy' | 'Health & politics';
  /** null = no data for this county */
  value(c: number, ctx: LayerContext): number | null;
  /** maps value to color */
  scale: Scale;
  format(v: number): string;
  note: string;
  /** only offered when this returns true */
  available?(ctx: LayerContext): boolean;
}

export interface Scale {
  kind: 'sequential' | 'diverging' | 'categorical';
  domain: number[];
  colors: string[];
  /** category labels for categorical scales */
  categories?: string[];
}

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function colorFor(scale: Scale, v: number | null): Rgb {
  if (v == null || !Number.isFinite(v)) return [70, 76, 88];
  if (scale.kind === 'categorical') return hex(scale.colors[Math.max(0, Math.min(scale.colors.length - 1, Math.round(v)))]);
  const d = scale.domain;
  const cs = scale.colors.map(hex);
  if (v <= d[0]) return cs[0];
  if (v >= d[d.length - 1]) return cs[cs.length - 1];
  for (let i = 0; i < d.length - 1; i++) {
    if (v <= d[i + 1]) {
      const t = (v - d[i]) / (d[i + 1] - d[i]);
      const a = cs[i];
      const b = cs[i + 1];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return cs[cs.length - 1];
}

const UNEMP: Scale = {
  kind: 'sequential',
  domain: [0.02, 0.035, 0.05, 0.07, 0.1, 0.15, 0.22],
  colors: ['#1d4e89', '#2a9d8f', '#8ab17d', '#e9c46a', '#f4a261', '#e76f51', '#9b2226'],
};
const CHANGE: Scale = {
  kind: 'diverging',
  domain: [-0.03, -0.01, 0, 0.02, 0.05, 0.1, 0.18],
  colors: ['#2b83ba', '#5fa8c9', '#46505e', '#e9a35b', '#e76f51', '#c0392b', '#7f1d1d'],
};
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const pts = (v: number) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)} pts`;

export const INDUSTRY_COLORS = ['#8d6e63', '#ff9f43', '#5f6caf', '#48c9b0', '#a29bfe', '#00b894', '#74b9ff', '#fd79a8', '#ffd32a', '#b2bec3', '#e17055'];

function medianAge(bins: number[]): number {
  let acc = 0;
  for (let b = 0; b < bins.length; b++) {
    if (acc + bins[b] >= 0.5) return b * 5 + ((0.5 - acc) / (bins[b] || 1)) * 5;
    acc += bins[b];
  }
  return 85;
}

/** Sector with the highest location quotient (local share / national share). */
export function signatureIndustry(data: CountyData): Int8Array {
  const ns = data.meta.sectors.length - 1; // government is imputed, skip it
  const nat = new Array(ns).fill(0);
  data.jobs.forEach((j) => j.slice(0, ns).forEach((v, k) => (nat[k] += v)));
  const natTot = nat.reduce((a, b) => a + b, 0);
  return Int8Array.from(data.jobs, (j) => {
    const tot = j.slice(0, ns).reduce((a, b) => a + b, 0);
    if (tot < 50) return -1;
    let best = -1;
    let bestLq = 0;
    for (let k = 0; k < ns; k++) {
      const lq = j[k] / tot / (nat[k] / natTot);
      // ignore tiny sectors, they make noisy quotients
      if (j[k] / tot > 0.04 && lq > bestLq) {
        bestLq = lq;
        best = k;
      }
    }
    return best;
  });
}

export function buildLayers(data: CountyData): Layer[] {
  const sig = signatureIndustry(data);
  const sectorLabels = data.meta.sectors.map((s) => s.label);
  return [
    {
      id: 'unemp',
      label: 'Unemployment (twin, live)',
      group: 'Live twin',
      value: (c, x) => x.countyU?.[c] ?? null,
      scale: UNEMP,
      format: pct,
      note: "The twin's unemployment rate in each county this month.",
    },
    {
      id: 'change',
      label: 'Change since Jan 2016',
      group: 'Live twin',
      value: (c, x) => (x.countyU && x.startU ? x.countyU[c] - x.startU[c] : null),
      scale: CHANGE,
      format: pts,
      note: 'Where the national shock landed: twin unemployment now minus at the start.',
    },
    {
      id: 'branch',
      label: 'Your timeline vs. reality',
      group: 'Live twin',
      value: (c, x) => x.branchDiff?.[c] ?? null,
      scale: { kind: 'diverging', domain: [-0.04, -0.01, 0, 0.01, 0.04], colors: ['#2b83ba', '#5fa8c9', '#46505e', '#e76f51', '#9b2226'] },
      format: pts,
      note: 'Unemployment in your forked timeline minus the data-steered twin, last 3 months. Small counties are shrunk toward zero because a few agents make them noisy.',
      available: (x) => !!x.branchDiff,
    },
    {
      id: 'statedial',
      label: 'Hidden state demand',
      group: 'Live twin',
      value: (c, x) => (x.stateDemand ? x.stateDemand[c] - 1 : null),
      scale: { kind: 'diverging', domain: [-0.3, -0.1, 0, 0.1, 0.3], colors: ['#9b2226', '#e76f51', '#46505e', '#5fa8c9', '#2b83ba'] },
      format: (v) => `${v >= 0 ? '+' : ''}${Math.round(100 * v)}%`,
      note: "The demand dial the twin had to set for each state so its unemployment matches that state's BLS release, relative to the nation. Red: the data says demand there fell further than the national shock alone explains.",
      available: (x) => !!x.stateDemand,
    },
    {
      id: 'withinstate',
      label: 'County vs. its state',
      group: 'Live twin',
      value: (c, x) => {
        if (!x.countyU || !x.stateU) return null;
        // shrink small counties toward their state: a few dozen agents make them noisy
        const workers = Math.max(80, data.pop[c] / 1000) * 0.5;
        return (x.countyU[c] - x.stateU[c]) * (workers / (workers + 60));
      },
      scale: { kind: 'diverging', domain: [-0.04, -0.01, 0, 0.01, 0.04], colors: ['#2b83ba', '#5fa8c9', '#46505e', '#e76f51', '#9b2226'] },
      format: pts,
      note: "Twin unemployment in each county minus its state's, with small counties shrunk toward zero. States are pinned to BLS; the pattern inside each state is the model's own answer.",
      available: (x) => !!x.stateU,
    },
    {
      id: 'backtest',
      label: 'Backtest error, 2020',
      group: 'Live twin',
      value: (c, x) => x.backtestError?.[c] ?? null,
      scale: { kind: 'diverging', domain: [-0.06, -0.02, 0, 0.02, 0.06], colors: ['#2b83ba', '#5fa8c9', '#46505e', '#e76f51', '#9b2226'] },
      format: pts,
      note: "Twin's 2020 forecast (BLS 2016 plus the twin's change) minus what BLS measured. Red: twin too high; blue: too low.",
      available: (x) => !!x.backtestError,
    },
    {
      id: 'industry',
      label: 'Signature industry',
      group: 'Economy',
      value: (c) => (sig[c] < 0 ? null : sig[c]),
      scale: { kind: 'categorical', domain: [], colors: INDUSTRY_COLORS, categories: sectorLabels },
      format: (v) => sectorLabels[v] ?? '',
      note: 'The sector most over-represented locally relative to the nation (Census CBP, 2019).',
    },
    {
      id: 'income',
      label: 'Income per person',
      group: 'Economy',
      value: (c) => data.income[c],
      scale: { kind: 'sequential', domain: [30000, 40000, 50000, 65000, 90000], colors: ['#3b1f4a', '#6a3d7c', '#b5651d', '#e9c46a', '#fff3b0'] },
      format: (v) => `$${Math.round(v / 1000)}k`,
      note: 'Average personal income (BEA).',
    },
    {
      id: 'poverty',
      label: 'Poverty rate',
      group: 'Economy',
      value: (c) => (data.poverty[c] == null ? null : data.poverty[c]! / 100),
      scale: { kind: 'sequential', domain: [0.05, 0.1, 0.15, 0.22, 0.32], colors: ['#1d4e89', '#2a9d8f', '#e9c46a', '#e76f51', '#9b2226'] },
      format: pct,
      note: 'Share of people below the poverty line (Census SAIPE via USDA ERS).',
    },
    {
      id: 'college',
      label: "Bachelor's degree or more",
      group: 'People',
      value: (c) => data.edu[c][3],
      scale: { kind: 'sequential', domain: [0.1, 0.18, 0.28, 0.4, 0.6], colors: ['#2d1e2f', '#5c3c92', '#3f88c5', '#4ecdc4', '#e8f9a2'] },
      format: pct,
      note: 'Adults 25+ (USDA ERS, ACS).',
    },
    {
      id: 'age',
      label: 'Median age',
      group: 'People',
      value: (c) => medianAge(data.age[c]),
      scale: { kind: 'sequential', domain: [30, 36, 41, 46, 55], colors: ['#00b894', '#55efc4', '#ffeaa7', '#fab1a0', '#d63031'] },
      format: (v) => `${v.toFixed(1)} yrs`,
      note: 'Census population estimates, 2019.',
    },
    {
      id: 'diversity',
      label: 'Not non-Hispanic white',
      group: 'People',
      value: (c) => 1 - data.race[c][0],
      scale: { kind: 'sequential', domain: [0.03, 0.15, 0.3, 0.5, 0.8], colors: ['#3d3d5c', '#5f6caf', '#48c9b0', '#ffd32a', '#ff9f43'] },
      format: pct,
      note: 'Share of residents who are Black, Asian, Hispanic, or another group (Census, 2019).',
    },
    {
      id: 'vote',
      label: '2024 presidential margin',
      group: 'Health & politics',
      value: (c) => {
        const v = data.vote2024[c] ?? data.vote2020[c];
        return v && v[2] > 0 ? (v[1] - v[0]) / v[2] : null;
      },
      scale: { kind: 'diverging', domain: [-0.6, -0.2, 0, 0.2, 0.6], colors: ['#1f4e9c', '#5b8bd0', '#7d6a8c', '#d0605e', '#a3121e'] },
      format: (v) => (v < 0 ? `D+${Math.round(-100 * v)}` : `R+${Math.round(100 * v)}`),
      note: 'County returns (2020 where 2024 is not reported at county level).',
    },
    {
      id: 'obesity',
      label: 'Adult obesity',
      group: 'Health & politics',
      value: (c) => data.health[c][0],
      scale: { kind: 'sequential', domain: [0.22, 0.28, 0.32, 0.36, 0.42], colors: ['#00b894', '#81ecec', '#ffeaa7', '#fab1a0', '#d63031'] },
      format: pct,
      note: 'County Health Rankings.',
    },
    {
      id: 'life',
      label: 'Life expectancy',
      group: 'Health & politics',
      value: (c) => data.lifeExp[c],
      scale: { kind: 'sequential', domain: [72, 76, 78.5, 81, 85], colors: ['#9b2226', '#e76f51', '#e9c46a', '#2a9d8f', '#1d4e89'] },
      format: (v) => `${v.toFixed(1)} yrs`,
      note: 'IHME county life expectancy.',
    },
  ];
}

export type HeightMode = 'density' | 'population' | 'flat';

export function heightsFor(data: CountyData, mode: HeightMode): Float32Array {
  return Float32Array.from(data.pop, (p, c) => {
    if (mode === 'flat') return 0.15;
    if (mode === 'population') return 0.2 + Math.max(0, Math.log10(p) - 3) * 0.9;
    const area = data.landArea[c] || 1000;
    const dens = p / area;
    return 0.2 + Math.max(0, Math.log10(dens) + 0.3) * 0.75 + (dens > 1500 ? Math.min(4, (dens - 1500) / 3000) : 0);
  });
}
