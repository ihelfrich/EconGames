/**
 * Spatial backtest. The twin is calibrated to 2016 county unemployment and
 * then steered only by national releases. Its 2020 county unemployment is
 * compared with what BLS LAUS actually measured in 2020, against two naive
 * forecasts that know the same national numbers:
 *   - uniform: every county moves by the national change
 *   - proportional: every county scales by the national ratio
 * Beating them means the twin's industry mix and local labor markets carry
 * real information about where a national shock lands.
 */
import type { CountyData } from './data';

export interface BacktestResult {
  year: number;
  baseYear: number;
  counties: number;
  /** labor-force-weighted RMSE of the year's county unemployment rate, in percentage points */
  rmse: { twin: number; uniform: number; proportional: number };
  /** labor-force-weighted correlation between predicted and actual change since the base year */
  changeCorrelation: { twin: number; proportional: number };
  national: { actualBase: number; actual: number };
}

export function spatialBacktest(data: CountyData, twinRate: Float32Array, year = 2020, baseYear = 2016): BacktestResult {
  const yi = data.meta.laborYears.indexOf(year);
  const bi = data.meta.laborYears.indexOf(baseYear);
  const rows: { w: number; base: number; actual: number; twin: number }[] = [];
  let lfB = 0;
  let unB = 0;
  let lfY = 0;
  let unY = 0;
  for (let c = 0; c < data.fips.length; c++) {
    const lb = data.lf[c][bi];
    const ub = data.unemp[c][bi];
    const ly = data.lf[c][yi];
    const uy = data.unemp[c][yi];
    if (!lb || !ly || ub == null || uy == null) continue;
    rows.push({ w: ly, base: ub / lb, actual: uy / ly, twin: twinRate[c] });
    lfB += lb;
    unB += ub;
    lfY += ly;
    unY += uy;
  }
  const natB = unB / lfB;
  const natY = unY / lfY;
  const W = rows.reduce((a, r) => a + r.w, 0);
  const rmse = (f: (r: (typeof rows)[number]) => number) =>
    100 * Math.sqrt(rows.reduce((a, r) => a + r.w * (f(r) - r.actual) ** 2, 0) / W);
  const corr = (f: (r: (typeof rows)[number]) => number) => {
    const xs = rows.map((r) => f(r) - r.base);
    const ys = rows.map((r) => r.actual - r.base);
    const mx = rows.reduce((a, r, i) => a + r.w * xs[i], 0) / W;
    const my = rows.reduce((a, r, i) => a + r.w * ys[i], 0) / W;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    rows.forEach((r, i) => {
      sxy += r.w * (xs[i] - mx) * (ys[i] - my);
      sxx += r.w * (xs[i] - mx) ** 2;
      syy += r.w * (ys[i] - my) ** 2;
    });
    return sxy / Math.sqrt(sxx * syy);
  };
  return {
    year,
    baseYear,
    counties: rows.length,
    rmse: {
      twin: rmse((r) => r.twin),
      uniform: rmse((r) => r.base + (natY - natB)),
      proportional: rmse((r) => (r.base * natY) / natB),
    },
    changeCorrelation: { twin: corr((r) => r.twin), proportional: corr((r) => (r.base * natY) / natB) },
    national: { actualBase: natB, actual: natY },
  };
}
