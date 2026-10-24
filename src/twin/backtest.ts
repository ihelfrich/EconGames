/**
 * Spatial backtest. The twin is calibrated to 2016 county unemployment and
 * then steered by national releases (and, when present, monthly state
 * releases). Its 2020 county unemployment is compared with what BLS LAUS
 * actually measured in 2020, against naive forecasts that know the same
 * numbers the twin was given:
 *   - uniform: every county moves by the national change
 *   - proportional: every county scales by the national ratio
 *   - state shift / state proportional: the same, with each county's own
 *     state change (what a forecaster with the state releases would do)
 *
 * With state releases steering the twin, the interesting test is inside
 * states: after removing each state's average, does the twin know which
 * counties within a state got hit harder? That is the within-state score.
 */
import type { CountyData } from './data';

export type Predictor = 'twin' | 'twinDelta' | 'uniform' | 'proportional' | 'stateShift' | 'stateProportional';

export interface BacktestResult {
  year: number;
  baseYear: number;
  counties: number;
  /** labor-force-weighted RMSE of the year's county unemployment rate, in percentage points */
  rmse: Record<Predictor, number>;
  /** labor-force-weighted correlation between predicted and actual change since the base year */
  changeCorrelation: Record<Predictor, number>;
  /** the same two scores after removing each state's labor-force-weighted mean */
  withinState: { rmse: Record<Predictor, number>; changeCorrelation: Record<Predictor, number> };
  national: { actualBase: number; actual: number };
}

interface Row {
  w: number;
  state: string;
  base: number;
  actual: number;
  pred: Record<Predictor, number>;
}

/**
 * @param twinRate the twin's county unemployment, annual average of `year`
 * @param twinBase optional: the twin's annual average of `baseYear`, for the
 *   delta score (BLS base plus the twin's own change)
 */
export function spatialBacktest(data: CountyData, twinRate: Float32Array, year = 2020, baseYear = 2016, twinBase?: Float32Array | null): BacktestResult {
  const yi = data.meta.laborYears.indexOf(year);
  const bi = data.meta.laborYears.indexOf(baseYear);
  const raw: Omit<Row, 'pred'>[] = [];
  const idx: number[] = [];
  const st = new Map<string, { lb: number; ub: number; ly: number; uy: number }>();
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
    const state = data.fips[c].slice(0, 2);
    raw.push({ w: ly, state, base: ub / lb, actual: uy / ly });
    idx.push(c);
    const s = st.get(state) ?? { lb: 0, ub: 0, ly: 0, uy: 0 };
    s.lb += lb;
    s.ub += ub;
    s.ly += ly;
    s.uy += uy;
    st.set(state, s);
    lfB += lb;
    unB += ub;
    lfY += ly;
    unY += uy;
  }
  const natB = unB / lfB;
  const natY = unY / lfY;
  const rows: Row[] = raw.map((r, i) => {
    const c = idx[i];
    const s = st.get(r.state)!;
    const sB = s.ub / s.lb;
    const sY = s.uy / s.ly;
    return {
      ...r,
      pred: {
        twin: twinRate[c],
        twinDelta: twinBase ? r.base + twinRate[c] - twinBase[c] : twinRate[c],
        uniform: r.base + (natY - natB),
        proportional: (r.base * natY) / natB,
        stateShift: r.base + (sY - sB),
        stateProportional: (r.base * sY) / sB,
      },
    };
  });
  const predictors = Object.keys(rows[0].pred) as Predictor[];
  const score = (rs: Row[], demean: boolean) => {
    // optionally remove each state's weighted mean from every series
    const means = new Map<string, { w: number; actual: number; base: number; pred: Record<string, number> }>();
    if (demean) {
      for (const r of rs) {
        const m = means.get(r.state) ?? { w: 0, actual: 0, base: 0, pred: Object.fromEntries(predictors.map((p) => [p, 0])) };
        m.w += r.w;
        m.actual += r.w * r.actual;
        m.base += r.w * r.base;
        for (const p of predictors) m.pred[p] += r.w * r.pred[p];
        means.set(r.state, m);
      }
    }
    const adj = (r: Row, v: number, key: 'actual' | 'base' | Predictor) => {
      if (!demean) return v;
      const m = means.get(r.state)!;
      const mean = key === 'actual' ? m.actual : key === 'base' ? m.base : m.pred[key];
      return v - mean / m.w;
    };
    const W = rs.reduce((a, r) => a + r.w, 0);
    const rmse = {} as Record<Predictor, number>;
    const corr = {} as Record<Predictor, number>;
    for (const p of predictors) {
      rmse[p] = 100 * Math.sqrt(rs.reduce((a, r) => a + r.w * (adj(r, r.pred[p], p) - adj(r, r.actual, 'actual')) ** 2, 0) / W);
      const xs = rs.map((r) => adj(r, r.pred[p], p) - adj(r, r.base, 'base'));
      const ys = rs.map((r) => adj(r, r.actual, 'actual') - adj(r, r.base, 'base'));
      const mx = rs.reduce((a, r, i) => a + r.w * xs[i], 0) / W;
      const my = rs.reduce((a, r, i) => a + r.w * ys[i], 0) / W;
      let sxy = 0;
      let sxx = 0;
      let syy = 0;
      rs.forEach((r, i) => {
        sxy += r.w * (xs[i] - mx) * (ys[i] - my);
        sxx += r.w * (xs[i] - mx) ** 2;
        syy += r.w * (ys[i] - my) ** 2;
      });
      // a predictor with no variation (a uniform shift) carries no information
      corr[p] = sxx > 1e-18 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
    }
    return { rmse, corr };
  };
  const all = score(rows, false);
  const within = score(rows, true);
  return {
    year,
    baseYear,
    counties: rows.length,
    rmse: all.rmse,
    changeCorrelation: all.corr,
    withinState: { rmse: within.rmse, changeCorrelation: within.corr },
    national: { actualBase: natB, actual: natY },
  };
}
