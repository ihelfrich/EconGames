/**
 * EconTwin page: wires the simulation worker to the isometric map, the
 * national charts, the county inspector, the what-if branch and the wire.
 */
import { CategoryScale, Chart, Filler, LinearScale, LineController, LineElement, PointElement, Tooltip } from 'chart.js';
import { spatialBacktest } from '../backtest';
import { loadTwinData, type TwinData } from '../data';
import type { CountyDetail, FromWorker, MonthMessage, PersonView, ShockSpec, ToWorker } from '../protocol';
import { DEFAULT_POLICY, HEALTH, STATUS } from '../world';
import { IsoMap } from './iso';
import { buildLayers, colorFor, heightsFor, INDUSTRY_COLORS, signatureIndustry, type HeightMode, type Layer, type LayerContext } from './layers';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip);
Chart.defaults.color = '#9aa3b2';
Chart.defaults.font.family = "'Space Grotesk', system-ui, sans-serif";
Chart.defaults.font.size = 10.5;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
// absolute, so the worker (which resolves relative URLs against its own script) finds the same files
const BASE = new URL(`${import.meta.env.BASE_URL}twin-data/`, location.href).href;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${(100 * v).toFixed(d)}%`);
const money = (v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : Math.round(v)}`;
const monthName = (label: string) => `${MONTHS[Number(label.slice(5, 7)) - 1]} ${label.slice(0, 4)}`;
const shortMonth = (label: string) => `${MONTHS[Number(label.slice(5, 7)) - 1].slice(0, 3)} ${label.slice(0, 4)}`;

const METRO_LABELS: Record<string, string> = {
  '06037': 'Los Angeles', '17031': 'Chicago', '48201': 'Houston', '04013': 'Phoenix', '06073': 'San Diego',
  '36047': 'Brooklyn', '36061': 'Manhattan', '48113': 'Dallas', '12086': 'Miami', '53033': 'Seattle',
  '32003': 'Las Vegas', '26163': 'Detroit', '06085': 'San Jose', '06075': 'San Francisco', '25025': 'Boston',
  '42101': 'Philadelphia', '48029': 'San Antonio', '27053': 'Minneapolis', '13121': 'Atlanta', '11001': 'Washington',
  '41051': 'Portland', '08031': 'Denver', '47157': 'Memphis', '37119': 'Charlotte', '29510': 'St. Louis',
  '39035': 'Cleveland', '22071': 'New Orleans', '15003': 'Honolulu', '02020': 'Anchorage', '48453': 'Austin',
  '12095': 'Orlando', '47037': 'Nashville', '49035': 'Salt Lake City', '24510': 'Baltimore', '18097': 'Indianapolis',
  '39049': 'Columbus', '29095': 'Kansas City', '55079': 'Milwaukee', '40109': 'Oklahoma City', '35001': 'Albuquerque',
  '12057': 'Tampa', '42003': 'Pittsburgh', '06067': 'Sacramento', '21111': 'Louisville', '16001': 'Boise', '38017': 'Fargo',
  '30111': 'Billings', '56021': 'Cheyenne', '46099': 'Sioux Falls', '31055': 'Omaha', '05119': 'Little Rock', '28049': 'Jackson',
  '01073': 'Birmingham', '45019': 'Charleston', '50007': 'Burlington', '23005': 'Portland ME', '33011': 'Manchester',
};

interface NewsItem {
  label: string;
  text: string;
  kind: 'release' | 'policy' | 'county' | 'branch' | 'resident' | 'info';
  county?: number;
}

class App {
  data!: TwinData;
  worker!: Worker;
  map!: IsoMap;
  layers!: Layer[];
  layer!: Layer;
  heightMode: HeightMode = 'density';
  months: MonthMessage[] = [];
  playing = false;
  speedMs = 350;
  waiting = false;
  lastStepAt = 0;
  selected = -1;
  detailNonce = 0;
  residentNonce = 0;
  forked = false;
  forkLabel = '';
  followed: PersonView | null = null;
  followLog: { label: string; text: string }[] = [];
  news: NewsItem[] = [];
  backtestError: Float32Array | null = null;
  scored = false;
  lastRelease = '';
  stateList: string[] = [];
  signature!: Int8Array;
  chartU!: Chart;
  chartLT!: Chart;
  chartCounty!: Chart;
  pausedAtRelease = false;

  async start() {
    this.setProgress('Loading county data…');
    this.data = await loadTwinData(async (name) => (await fetch(BASE + name)).json());
    const d = this.data.counties;
    this.signature = signatureIndustry(d);
    this.stateList = [...new Set(d.state)].sort();
    const stateIdx = Int16Array.from(d.state, (s) => this.stateList.indexOf(s));
    this.map = new IsoMap($('map') as HTMLCanvasElement, this.data.grid, stateIdx);
    this.map.heights = heightsFor(d, this.heightMode);
    this.map.labels = d.fips
      .map((f, c) => ({ f, c }))
      .filter(({ f }) => METRO_LABELS[f])
      .map(({ f, c }) => ({ county: c, text: METRO_LABELS[f], minZoom: d.pop[c] > 2.5e6 ? 3 : d.pop[c] > 1e6 ? 5 : 9 }));
    this.layers = buildLayers(d);
    this.layer = this.layers[0];
    this.map.fit();
    this.buildLayerSelect();
    this.recolor();
    this.map.render();
    this.buildCharts();
    this.bindMap();
    this.bindControls();
    this.fillSources();
    window.addEventListener('resize', () => {
      this.map.resize();
      this.map.fit();
      this.map.render();
    });
    this.boot();
  }

  boot() {
    this.worker?.terminate();
    this.months = [];
    this.news = [];
    this.followLog = [];
    this.followed = null;
    this.backtestError = null;
    this.scored = false;
    this.forked = false;
    this.pausedAtRelease = false;
    this.renderNews();
    $('scoreBody').innerHTML = 'Waiting for December 2020…';
    $('followCard').classList.add('hidden');
    this.showFork(false);
    for (const ch of [this.chartU, this.chartLT]) {
      ch.data.labels = [];
      ch.data.datasets.forEach((ds) => (ds.data = []));
      ch.update('none');
    }
    this.worker = new Worker(new URL('../worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorker(ev.data);
    this.send({ type: 'init', base: BASE, options: { scale: 1000, minPerCounty: 80, seed: 20160101 } });
  }

  send(msg: ToWorker) {
    this.worker.postMessage(msg);
  }

  setProgress(text: string) {
    $('progress').textContent = text;
  }

  // ------------------------------------------------------------ worker

  onWorker(msg: FromWorker) {
    switch (msg.type) {
      case 'progress':
        this.setProgress(msg.message);
        break;
      case 'ready': {
        this.lastRelease = msg.lastRelease;
        this.setProgress(`${msg.n.toLocaleString()} synthetic people in ${msg.nc.toLocaleString()} counties, calibrated to BLS county unemployment for 2016. Releases through ${monthName(msg.lastRelease)}.`);
        const go = $('introGo') as HTMLButtonElement;
        go.disabled = false;
        go.textContent = '▶ Start the replay';
        for (const id of ['play', 'stepBtn', 'restart', 'forkBtn']) ($(id) as HTMLButtonElement).disabled = false;
        this.pushNews({ label: msg.startLabel, text: `${msg.n.toLocaleString()} synthetic residents placed in ${msg.nc.toLocaleString()} counties. Labor markets spun up to match each county's 2016 unemployment.`, kind: 'info' });
        break;
      }
      case 'month':
        this.onMonth(msg);
        break;
      case 'county':
        if (msg.nonce === this.detailNonce) this.renderCounty(msg);
        break;
      case 'residents':
        if (msg.nonce === this.residentNonce) this.renderResidents(msg.people);
        break;
      case 'error':
        console.error(msg.message);
        this.setProgress(`Something went wrong: ${msg.message.split('\n')[0]}`);
        this.pause();
        break;
    }
  }

  onMonth(m: MonthMessage) {
    const prev = this.months[this.months.length - 1];
    this.months.push(m);
    this.waiting = false;
    $('date').textContent = monthName(m.label);
    const mode = $('mode');
    mode.className = `mode ${m.mode === 'forecast' || (m.mode === 'branch' && !m.observed) ? 'forecast' : ''}`;
    mode.innerHTML =
      m.mode === 'spinup'
        ? '<b>Calibrated</b> · ready to replay'
        : m.observed
          ? `<b>Replay</b> · steered by BLS data${this.forked ? ' · branch active' : ''}`
          : `<b>Forecast</b> · ${m.label < this.lastRelease ? 'no release this month' : 'past the last release'}${this.forked ? ' · branch active' : ''}`;

    if (prev) this.generateNews(prev, m);
    this.updateKpis(m);
    this.updateCharts(m);
    this.pulses(prev, m);
    this.recolor();
    this.map.render();
    if (this.selected >= 0) this.requestCounty(false);
    if (this.followed && m.followed) this.trackFollowed(m);
    if (!this.scored && m.label === '2020-12') this.score();

    if (m.label === this.lastRelease && this.playing && !this.pausedAtRelease) {
      this.pausedAtRelease = true;
      this.pause();
      this.pushNews({ label: m.label, text: `That is the latest BLS release. From here the twin forecasts: the inferred demand and labor force hold at their last values. Press play to keep going, or fork to test a scenario.`, kind: 'info' });
    }
    if (this.playing) this.scheduleStep();
  }

  scheduleStep() {
    if (this.waiting) return;
    const wait = Math.max(0, this.speedMs - (performance.now() - this.lastStepAt));
    window.setTimeout(() => {
      if (!this.playing || this.waiting) return;
      this.stepOnce();
    }, wait);
  }

  stepOnce() {
    this.waiting = true;
    this.lastStepAt = performance.now();
    this.send({ type: 'step' });
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    $('play').textContent = '⏸ Pause';
    if (!this.waiting) this.stepOnce();
  }

  pause() {
    this.playing = false;
    $('play').textContent = '▶ Play';
  }

  // ------------------------------------------------------------ national panel

  updateKpis(m: MonthMessage) {
    $('kU').textContent = pct(m.national.unemploymentRate);
    $('kUreal').textContent = m.observed?.unrate != null ? `BLS ${pct(m.observed.unrate)}` : 'no release (forecast)';
    $('kA').textContent = (100 * m.demand).toFixed(1);
    $('kLT').textContent = pct(m.national.longTermShare, 0);
    $('kLTreal').textContent = m.observed?.longTermShare != null ? `BLS ${pct(m.observed.longTermShare, 0)}` : '—';
    if (m.branch) {
      $('forkInfo').innerHTML = `Branch from ${shortMonth(this.forkLabel)}: unemployment <b style="color:var(--branch)">${pct(m.branch.national.unemploymentRate)}</b> vs ${pct(m.national.unemploymentRate)}`;
    }
  }

  buildCharts() {
    const grid = { color: 'rgba(255,255,255,0.05)' };
    const common = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false as const,
      interaction: { mode: 'index' as const, intersect: false },
      plugins: { tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) => `${c.dataset.label}: ${c.parsed.y == null ? '—' : c.parsed.y.toFixed(1)}%` } } },
      scales: {
        x: { grid, ticks: { maxTicksLimit: 6, autoSkip: true, maxRotation: 0 } },
        y: { grid, ticks: { callback: (v: string | number) => `${v}%` } },
      },
      elements: { point: { radius: 0 }, line: { borderWidth: 2, tension: 0.25 } },
    };
    this.chartU = new Chart($('chartU') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'BLS', data: [], borderColor: '#ffcc00', borderWidth: 3 },
          { label: 'Twin', data: [], borderColor: '#4ecdc4', borderDash: [5, 3] },
          { label: 'Your timeline', data: [], borderColor: '#ff6b6b', hidden: true },
        ],
      },
      options: common,
    });
    this.chartLT = new Chart($('chartLT') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'BLS', data: [], borderColor: '#ffcc00', borderWidth: 2.5 },
          { label: 'Twin', data: [], borderColor: '#4ecdc4', borderDash: [5, 3] },
          { label: 'Your timeline', data: [], borderColor: '#ff6b6b', hidden: true },
        ],
      },
      options: common,
    });
    this.chartCounty = new Chart($('chartCounty') as HTMLCanvasElement, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'County', data: [], borderColor: '#4ecdc4' },
          { label: 'Nation', data: [], borderColor: '#6b7487', borderWidth: 1.5 },
          { label: 'Your timeline', data: [], borderColor: '#ff6b6b', hidden: true },
        ],
      },
      options: common,
    });
  }

  updateCharts(m: MonthMessage) {
    const lab = shortMonth(m.label);
    const f = (v: number | null | undefined) => (v == null ? null : +(100 * v).toFixed(2));
    const push = (ch: Chart, vals: (number | null)[]) => {
      (ch.data.labels as string[]).push(lab);
      vals.forEach((v, i) => (ch.data.datasets[i].data as (number | null)[]).push(v));
      ch.data.datasets[2].hidden = !this.forked;
      ch.update('none');
    };
    push(this.chartU, [f(m.observed?.unrate), f(m.national.unemploymentRate), f(m.branch?.national.unemploymentRate)]);
    push(this.chartLT, [f(m.observed?.longTermShare), f(m.national.longTermShare), f(m.branch?.national.longTermShare)]);
  }

  // ------------------------------------------------------------ map

  layerContext(): LayerContext {
    const m = this.months[this.months.length - 1];
    return {
      data: this.data.counties,
      countyU: m?.countyU ?? null,
      startU: this.months[0]?.countyU ?? null,
      branchDiff: this.forked ? this.branchDiff() : null,
      backtestError: this.backtestError,
    };
  }

  /**
   * Branch minus reality, averaged over the last 3 months and shrunk toward
   * zero for counties with few synthetic workers, so the map shows effects
   * rather than the luck of a handful of agents.
   */
  branchDiff(): Float32Array {
    const d = this.data.counties;
    const recent = this.months.slice(-3).filter((m) => m.branch);
    const out = new Float32Array(d.fips.length);
    for (let c = 0; c < out.length; c++) {
      let s = 0;
      for (const m of recent) s += m.branch!.countyU[c] - m.countyU[c];
      const workers = Math.max(80, d.pop[c] / 1000) * 0.5;
      out[c] = (s / Math.max(1, recent.length)) * (workers / (workers + 60));
    }
    return out;
  }

  recolor() {
    const ctx = this.layerContext();
    if (this.layer.id === 'branch' && ctx.branchDiff) {
      // scale the diverging legend to the size of the effect
      const biggest = ctx.branchDiff.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
      const steps = [0.005, 0.01, 0.02, 0.04, 0.06, 0.1, 0.15];
      const m = steps.find((x) => x >= biggest) ?? 0.2;
      if (this.layer.scale.domain[4] !== m) {
        this.layer.scale.domain = [-m, -m / 4, 0, m / 4, m];
        this.renderLegend();
      }
    }
    const nc = this.data.counties.fips.length;
    const colors = this.map.colors;
    for (let c = 0; c < nc; c++) {
      const [r, g, b] = colorFor(this.layer.scale, this.layer.value(c, ctx));
      colors[c * 3] = r;
      colors[c * 3 + 1] = g;
      colors[c * 3 + 2] = b;
    }
  }

  buildLayerSelect() {
    const sel = $('layer') as HTMLSelectElement;
    const ctx = this.layerContext();
    sel.innerHTML = '';
    const groups = [...new Set(this.layers.map((l) => l.group))];
    for (const g of groups) {
      const og = document.createElement('optgroup');
      og.label = g;
      for (const l of this.layers.filter((x) => x.group === g)) {
        if (l.available && !l.available(ctx)) continue;
        const o = document.createElement('option');
        o.value = l.id;
        o.textContent = l.label;
        og.appendChild(o);
      }
      if (og.children.length) sel.appendChild(og);
    }
    sel.value = this.layer.id;
    this.renderLegend();
  }

  setLayer(id: string) {
    this.layer = this.layers.find((l) => l.id === id) ?? this.layers[0];
    this.buildLayerSelect();
    this.recolor();
    this.map.render();
  }

  renderLegend() {
    const s = this.layer.scale;
    const el = $('legend');
    if (s.kind === 'categorical') {
      el.innerHTML = `<div class="cats">${(s.categories ?? [])
        .slice(0, s.colors.length - 1)
        .map((c, i) => `<span style="--c:${INDUSTRY_COLORS[i]}">${c}</span>`)
        .join('')}</div>`;
    } else {
      const stops = s.domain.map((d, i) => `${s.colors[i]} ${((d - s.domain[0]) / (s.domain[s.domain.length - 1] - s.domain[0])) * 100}%`);
      const mid = s.domain.length > 2 ? s.domain[Math.floor(s.domain.length / 2)] : null;
      el.innerHTML = `<div class="bar" style="background:linear-gradient(90deg, ${stops.join(',')})"></div>
        <div class="ticks"><span>${this.layer.format(s.domain[0])}</span>${mid != null ? `<span>${this.layer.format(mid)}</span>` : ''}<span>${this.layer.format(s.domain[s.domain.length - 1])}</span></div>`;
    }
    $('layerNote').textContent = this.layer.note;
  }

  /**
   * A county's month-on-month move that is unlikely to be sampling noise:
   * beyond 3 standard errors of the change given its synthetic labor force.
   */
  significantMove(c: number, prevU: number, u: number): boolean {
    const d = this.data.counties;
    const lfAgents = Math.max(40, (d.lf[c][3] ?? d.pop[c] / 2) / 1000);
    const p = Math.max(0.02, (prevU + u) / 2);
    return Math.abs(u - prevU) > 3 * Math.sqrt((2 * p * (1 - p)) / lfAgents);
  }

  pulses(prev: MonthMessage | undefined, m: MonthMessage) {
    this.map.pulses = this.map.pulses.map((p) => ({ ...p, age: p.age + 1 })).filter((p) => p.age < 12);
    if (!prev) return;
    const d = this.data.counties;
    const jumps: [number, number][] = [];
    for (let c = 0; c < d.fips.length; c++) {
      if ((d.lf[c][3] ?? 0) < 60000) continue;
      const dj = m.countyU[c] - prev.countyU[c];
      if (Math.abs(dj) > 0.03 && this.significantMove(c, prev.countyU[c], m.countyU[c])) jumps.push([c, dj]);
    }
    jumps.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    for (const [c] of jumps.slice(0, 4)) this.map.pulses.push({ county: c, age: 0 });
  }

  bindMap() {
    const canvas = $('map') as HTMLCanvasElement;
    const tip = $('tooltip');
    let drag: { x: number; y: number; moved: boolean } | null = null;
    let raf = 0;
    const redraw = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        this.map.render();
      });
    };
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          canvas.classList.add('dragging');
          this.map.pan(dx, dy);
          drag.x = e.clientX;
          drag.y = e.clientY;
          tip.style.display = 'none';
          redraw();
          return;
        }
      }
      const c = this.map.pick(e.clientX, e.clientY);
      if (c !== this.map.hovered) {
        this.map.hovered = c;
        redraw();
      }
      if (c < 0) {
        tip.style.display = 'none';
        return;
      }
      const d = this.data.counties;
      const v = this.layer.value(c, this.layerContext());
      const rect = canvas.getBoundingClientRect();
      tip.style.display = 'block';
      tip.style.left = `${e.clientX - rect.left}px`;
      tip.style.top = `${e.clientY - rect.top}px`;
      tip.innerHTML = `<b>${d.name[c]}, ${d.state[c]}</b><br>${this.layer.label}: <span class="v">${v == null ? 'n/a' : this.layer.format(v)}</span><br><span style="color:var(--ink-3)">${d.pop[c].toLocaleString()} people · click to inspect</span>`;
    });
    canvas.addEventListener('pointerup', (e) => {
      canvas.classList.remove('dragging');
      if (drag && !drag.moved) {
        const c = this.map.pick(e.clientX, e.clientY);
        this.select(c);
      }
      drag = null;
    });
    canvas.addEventListener('pointerleave', () => {
      tip.style.display = 'none';
      this.map.hovered = -1;
      redraw();
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.map.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
        redraw();
      },
      { passive: false },
    );
    const tools: Record<string, () => void> = {
      rotL: () => this.map.rotate(-Math.PI / 12),
      rotR: () => this.map.rotate(Math.PI / 12),
      zoomIn: () => this.map.zoomAt(1.4, rect().x + rect().width / 2, rect().y + rect().height / 2),
      zoomOut: () => this.map.zoomAt(1 / 1.4, rect().x + rect().width / 2, rect().y + rect().height / 2),
      fit: () => this.map.fit(),
    };
    const rect = () => canvas.getBoundingClientRect();
    for (const [id, fn] of Object.entries(tools))
      $(id).addEventListener('click', () => {
        fn();
        this.map.render();
      });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (this.playing) this.pause();
        else this.play();
      } else if (e.key === 'q' || e.key === 'Q') tools.rotL();
      else if (e.key === 'e' || e.key === 'E') tools.rotR();
      else if (e.key === 'f' || e.key === 'F') tools.fit();
      else if (e.key === 'Escape') this.select(-1);
      else return;
      this.map.render();
    });
  }

  // ------------------------------------------------------------ controls

  bindControls() {
    $('introGo').addEventListener('click', () => {
      $('intro').classList.add('hidden');
      this.play();
    });
    $('play').addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    $('stepBtn').addEventListener('click', () => {
      this.pause();
      if (!this.waiting) this.stepOnce();
    });
    $('restart').addEventListener('click', () => {
      this.pause();
      this.select(-1);
      for (const id of ['play', 'stepBtn', 'restart', 'forkBtn']) ($(id) as HTMLButtonElement).disabled = true;
      this.boot();
    });
    $('speed').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.speedMs = Number(b.dataset.ms);
      $('speed').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('layer').addEventListener('change', (e) => this.setLayer((e.target as HTMLSelectElement).value));
    $('heightMode').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.heightMode = b.dataset.h as HeightMode;
      $('heightMode').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      this.map.heights = heightsFor(this.data.counties, this.heightMode);
      this.map.invalidate();
      this.map.render();
    });
    $('news').addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest('li');
      if (li?.dataset.county) this.select(Number(li.dataset.county), true);
    });

    // what-if
    const sectorPick = $('sectorPick') as HTMLSelectElement;
    sectorPick.innerHTML = this.data.counties.meta.sectors.map((s, i) => `<option value="${i}">${s.label}</option>`).join('');
    sectorPick.value = String(this.data.counties.meta.sectors.findIndex((s) => s.id === 'leisure'));
    const statePick = $('statePick') as HTMLSelectElement;
    statePick.innerHTML = this.stateList.map((s) => `<option>${s}</option>`).join('');
    statePick.value = 'MI';
    $('forkBtn').addEventListener('click', () => this.fork());
    $('unforkBtn').addEventListener('click', () => this.unfork());
    for (const id of ['sDemand', 'sSector', 'sState', 'sectorPick', 'statePick', 'policyPick']) {
      $(id).addEventListener('input', () => this.updateShocks());
    }
    $('cClose').addEventListener('click', () => this.select(-1));
    $('cShuffle').addEventListener('click', () => this.requestResidents());
    $('unfollow').addEventListener('click', () => {
      this.followed = null;
      this.send({ type: 'follow', person: null });
      $('followCard').classList.add('hidden');
    });
  }

  shockSpec(): ShockSpec {
    const ns = this.data.counties.meta.sectors.length;
    const sector = new Array(ns).fill(1);
    sector[Number(($('sectorPick') as HTMLSelectElement).value)] = 1 + Number(($('sSector') as HTMLInputElement).value) / 100;
    const states: Record<string, number> = {};
    states[($('statePick') as HTMLSelectElement).value] = 1 + Number(($('sState') as HTMLInputElement).value) / 100;
    const pol = ($('policyPick') as HTMLSelectElement).value;
    return {
      demand: 1 + Number(($('sDemand') as HTMLInputElement).value) / 100,
      sector,
      states,
      policy: pol === 'none' ? DEFAULT_POLICY : pol === 'generous' ? { uiMonths: 18, uiSearchPenalty: 0.4, matchBoost: 1 } : null,
      matchBoost: pol === 'jobsearch' ? 1.25 : 1,
    };
  }

  updateShocks() {
    const fmt = (id: string) => {
      const v = Number(($(id) as HTMLInputElement).value);
      return `${v > 0 ? '+' : ''}${v}%`;
    };
    $('oDemand').textContent = fmt('sDemand');
    $('oSector').textContent = fmt('sSector');
    $('oState').textContent = fmt('sState');
    if (this.forked) this.send({ type: 'setShocks', shocks: this.shockSpec() });
  }

  fork() {
    const m = this.months[this.months.length - 1];
    if (!m) return;
    this.forked = true;
    this.forkLabel = m.label;
    this.send({ type: 'fork', shocks: this.shockSpec() });
    this.showFork(true);
    $('forkInfo').textContent = `Branched in ${shortMonth(m.label)}. Press play: your timeline runs alongside reality.`;
    this.pushNews({ label: m.label, text: 'You forked the timeline. The branch inherits every data-inferred shock from here on, plus yours.', kind: 'branch' });
    this.buildLayerSelect();
    this.setLayer('branch');
  }

  unfork() {
    this.forked = false;
    this.send({ type: 'unfork' });
    this.showFork(false);
    const last = this.months[this.months.length - 1];
    if (last) last.branch = null;
    if (this.layer.id === 'branch') this.setLayer('unemp');
    else this.buildLayerSelect();
  }

  showFork(on: boolean) {
    $('forkIdle').classList.toggle('hidden', on);
    $('forkLive').classList.toggle('hidden', !on);
    $('keyBranch').classList.toggle('hidden', !on);
    $('cKeyBranch').classList.toggle('hidden', !on);
  }

  // ------------------------------------------------------------ county inspector

  select(c: number, focus = false) {
    this.selected = c;
    this.map.selected = c;
    if (c < 0) {
      $('countyCard').classList.add('hidden');
      this.map.render();
      return;
    }
    if (focus) this.map.focus(c, 14);
    this.map.render();
    const d = this.data.counties;
    $('countyCard').classList.remove('hidden');
    $('cName').textContent = `${d.name[c]}, ${d.state[c]}`;
    const sig = this.signature[c];
    $('cSub').textContent = `${d.pop[c].toLocaleString()} people${sig >= 0 ? ` · signature industry: ${d.meta.sectors[sig].label}` : ''}${d.lifeExp[c] ? ` · life expectancy ${d.lifeExp[c]!.toFixed(1)}` : ''}`;
    const u = (k: number) => (d.lf[c][k] && d.unemp[c][k] != null ? d.unemp[c][k]! / d.lf[c][k]! : null);
    $('cU20').textContent = pct(u(4));
    $('cU16').textContent = `2016: ${pct(u(3))}`;
    this.requestCounty(true);
    this.requestResidents();
    $('countyCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  requestCounty(resetChart: boolean) {
    this.detailNonce++;
    this.send({ type: 'county', county: this.selected, nonce: this.detailNonce });
    const c = this.selected;
    const ch = this.chartCounty;
    if (resetChart || (ch.data.labels as string[]).length !== this.months.length) {
      ch.data.labels = this.months.map((m) => shortMonth(m.label));
      ch.data.datasets[0].data = this.months.map((m) => +(100 * m.countyU[c]).toFixed(2));
      ch.data.datasets[1].data = this.months.map((m) => +(100 * m.national.unemploymentRate).toFixed(2));
      ch.data.datasets[2].data = this.months.map((m) => (m.branch ? +(100 * m.branch.countyU[c]).toFixed(2) : null));
      ch.data.datasets[2].hidden = !this.forked;
      ch.update('none');
    }
  }

  renderCounty(det: CountyDetail) {
    const d = this.data.counties;
    const c = det.county;
    const m = this.months[this.months.length - 1];
    const meta = d.meta;
    const uNow = m.branch ? m.branch.countyU[c] : m.countyU[c];
    $('cU').textContent = pct(uNow);
    $('cUstart').textContent = `start ${pct(this.months[0].countyU[c])}`;
    const emp = det.sector.reduce((a, b) => a + b, 0);
    const pay = det.avgWageBySector.reduce((a, w, k) => a + w * det.sector[k], 0) / (emp || 1);
    $('cPay').textContent = money(pay);
    $('cPaySub').textContent = `${det.agents} agents × ${Math.round(det.weight)}`;

    // pyramid
    const cv = $('pyramid') as HTMLCanvasElement;
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = cv.clientWidth * dpr;
    cv.height = cv.clientHeight * dpr;
    const g = cv.getContext('2d')!;
    g.scale(dpr, dpr);
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    const max = Math.max(...det.pyramid.flat(), 1);
    const rows = det.pyramid.length;
    const rh = H / rows;
    g.font = '9px Space Grotesk, sans-serif';
    g.textAlign = 'center';
    for (let r = 0; r < rows; r++) {
      const y = H - (r + 1) * rh;
      const [male, female] = det.pyramid[r];
      const mw = (male / max) * (W / 2 - 22);
      const fw = (female / max) * (W / 2 - 22);
      g.fillStyle = '#5fa8c9';
      g.fillRect(W / 2 - 14 - mw, y + 1, mw, rh - 2);
      g.fillStyle = '#e9a35b';
      g.fillRect(W / 2 + 14, y + 1, fw, rh - 2);
      if (r % 2 === 0) {
        g.fillStyle = '#7d8697';
        g.fillText(r === 17 ? '85+' : String(r * 5), W / 2, y + rh - 1);
      }
    }
    g.textAlign = 'left';
    g.fillStyle = '#5fa8c9';
    g.fillText('men', 2, 10);
    g.textAlign = 'right';
    g.fillStyle = '#e9a35b';
    g.fillText('women', W - 2, 10);

    const bars = (el: HTMLElement, items: { label: string; v: number; text: string; color?: string }[]) => {
      const mx = Math.max(...items.map((i) => i.v), 1e-9);
      el.innerHTML = items
        .map((i) => `<div class="b"><span>${i.label}</span><i style="width:${(100 * i.v) / mx}%;--c:${i.color ?? '#4ecdc4'}"></i><em>${i.text}</em></div>`)
        .join('');
    };
    const sectors = meta.sectors
      .map((s, k) => ({ label: s.label, v: det.sector[k], text: det.sector[k] > 0 ? money(det.avgWageBySector[k]) : '—', color: INDUSTRY_COLORS[k] }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v);
    bars($('cSectors'), sectors);
    const pop = det.race.reduce((a, b) => a + b, 0) || 1;
    const adults25 = det.edu.reduce((a, b) => a + b, 0) || 1;
    const voters = det.vote.reduce((a, b) => a + b, 0) || 1;
    const people = [
      ...meta.races.map((r, k) => ({ label: r, v: det.race[k] / pop, text: pct(det.race[k] / pop, 0), color: '#a29bfe' })),
      ...meta.eduLevels.map((e, k) => ({ label: e, v: det.edu[k] / adults25, text: pct(det.edu[k] / adults25, 0), color: '#74b9ff' })),
      { label: 'Voted D (adults)', v: det.vote[1] / voters, text: pct(det.vote[1] / voters, 0), color: '#5b8bd0' },
      { label: 'Voted R (adults)', v: det.vote[2] / voters, text: pct(det.vote[2] / voters, 0), color: '#d0605e' },
      { label: 'Obese (adults)', v: det.health[0], text: pct(det.health[0], 0), color: '#fab1a0' },
      { label: 'Uninsured', v: det.health[3], text: pct(det.health[3], 0), color: '#fab1a0' },
    ];
    bars($('cPeople'), people);
  }

  requestResidents() {
    if (this.selected < 0) return;
    this.residentNonce++;
    this.send({ type: 'residents', county: this.selected, count: 5, nonce: this.residentNonce });
  }

  describe(p: PersonView) {
    const meta = this.data.counties.meta;
    const sex = p.sex ? 'woman' : 'man';
    const face = p.sex ? (p.age >= 65 ? '👵' : '👩') : p.age >= 65 ? '👴' : '👨';
    const race = meta.races[p.race].replace(' (non-Hispanic)', '').replace('Other / multiracial', 'multiracial or other');
    const edu = p.edu < 4 ? meta.eduLevels[p.edu].replace('Less than high school', 'no diploma').replace("Bachelor's+", 'college grad').toLowerCase() : '';
    const sector = p.sector >= 0 ? meta.sectors[p.sector].label : '';
    let what: string;
    if (p.status === STATUS.EMPLOYED) what = `Works in ${sector} · ${money(p.wage)}/yr · ${p.tenure >= 12 ? `${Math.floor(p.tenure / 12)} yr in job` : `${p.tenure} mo in job`}`;
    else if (p.status === STATUS.UNEMPLOYED) what = `Looking for work, ${p.dur} mo${sector ? ` (last job: ${sector})` : ''}`;
    else if (p.status === STATUS.NILF) what = p.age >= 62 ? 'Retired' : p.age < 25 ? 'In school / not working' : 'Not in the labor force';
    else what = 'Child';
    const tags = [p.health & HEALTH.UNINSURED ? 'uninsured' : '', p.health & HEALTH.SMOKER ? 'smokes' : ''].filter(Boolean).join(', ');
    return { face, who: `${p.age}, ${race} ${sex}${edu ? `, ${edu}` : ''}`, what: `${what}${tags ? ` · ${tags}` : ''}` };
  }

  renderResidents(people: PersonView[]) {
    $('cResidents').innerHTML = people
      .map((p) => {
        const d = this.describe(p);
        return `<div class="resident"><div class="face">${d.face}</div><div><div class="who">${d.who}</div><div class="what">${d.what}</div></div><button class="btn" data-follow="${p.id}">Follow</button></div>`;
      })
      .join('');
    $('cResidents')
      .querySelectorAll<HTMLButtonElement>('button[data-follow]')
      .forEach((b) =>
        b.addEventListener('click', () => {
          const p = people.find((x) => x.id === Number(b.dataset.follow))!;
          this.follow(p);
        }),
      );
  }

  follow(p: PersonView) {
    this.followed = p;
    this.followLog = [];
    const d = this.data.counties;
    const label = this.months[this.months.length - 1]?.label ?? '';
    this.send({ type: 'follow', person: p.id });
    $('followCard').classList.remove('hidden');
    const desc = this.describe(p);
    $('followWho').innerHTML = `${desc.face} ${desc.who}, ${d.name[p.county]}, ${d.state[p.county]}`;
    this.logLife(label, desc.what);
    $('followCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  logLife(label: string, text: string) {
    this.followLog.unshift({ label, text });
    $('life').innerHTML = this.followLog.map((l) => `<li><time>${shortMonth(l.label)}</time>${l.text}</li>`).join('');
  }

  trackFollowed(m: MonthMessage) {
    const p = m.followed!;
    const o = this.followed!;
    const meta = this.data.counties.meta;
    let text = '';
    if (o.status !== p.status) {
      if (p.status === STATUS.UNEMPLOYED && o.status === STATUS.EMPLOYED) text = `Lost their job in ${meta.sectors[o.sector]?.label ?? 'their sector'}`;
      else if (p.status === STATUS.UNEMPLOYED) text = 'Started looking for work';
      else if (p.status === STATUS.EMPLOYED) text = `Hired in ${meta.sectors[p.sector].label} at ${money(p.wage)}/yr${o.status === STATUS.UNEMPLOYED ? ` after ${o.dur + 1} months of searching` : ''}`;
      else if (p.status === STATUS.NILF) text = p.age >= 62 ? 'Retired' : o.status === STATUS.UNEMPLOYED ? `Gave up searching after ${o.dur + 1} months` : 'Left the labor force';
      else if (p.status === STATUS.CHILD) text = 'Passed away. A newborn takes their place in the county.';
    } else if (p.age !== o.age && p.status !== STATUS.CHILD) text = `Turned ${p.age}`;
    if (text) {
      this.logLife(m.label, text);
      if (o.status === STATUS.EMPLOYED && p.status === STATUS.UNEMPLOYED) this.pushNews({ label: m.label, text: `The resident you follow just lost their job.`, kind: 'resident', county: p.county });
    }
    this.followed = p;
  }

  // ------------------------------------------------------------ backtest

  annual(year: string, pick: (m: MonthMessage) => Float32Array) {
    const ms = this.months.filter((m) => m.label.startsWith(year));
    if (ms.length < 12) return null;
    const out = new Float32Array(this.data.counties.fips.length);
    for (const m of ms) {
      const u = pick(m);
      for (let c = 0; c < out.length; c++) out[c] += u[c] / ms.length;
    }
    return out;
  }

  score() {
    const d = this.data.counties;
    const t16 = this.annual('2016', (m) => m.countyU);
    const t20 = this.annual('2020', (m) => m.countyU);
    if (!t16 || !t20) return;
    this.scored = true;
    const delta = new Float32Array(t20.length);
    const err = new Float32Array(t20.length);
    for (let c = 0; c < delta.length; c++) {
      const b16 = d.lf[c][3] && d.unemp[c][3] != null ? d.unemp[c][3]! / d.lf[c][3]! : t16[c];
      delta[c] = b16 + (t20[c] - t16[c]);
      err[c] = d.lf[c][4] && d.unemp[c][4] != null ? t20[c] - d.unemp[c][4]! / d.lf[c][4]! : NaN;
    }
    this.backtestError = err;
    const lvl = spatialBacktest(d, t20);
    const dlt = spatialBacktest(d, delta);
    const rows = [
      { name: 'Twin (its own 2020 level)', rmse: lvl.rmse.twin, corr: lvl.changeCorrelation.twin },
      { name: 'Twin (BLS 2016 + twin change)', rmse: dlt.rmse.twin, corr: dlt.changeCorrelation.twin },
      { name: 'Naive: uniform national shift', rmse: lvl.rmse.uniform, corr: NaN },
      { name: 'Naive: proportional scaling', rmse: lvl.rmse.proportional, corr: lvl.changeCorrelation.proportional },
    ];
    const best = Math.min(...rows.map((r) => r.rmse));
    // urban gradient by county size
    const classes = [
      [0, 5e4, 'under 50k'],
      [5e4, 2.5e5, '50k to 250k'],
      [2.5e5, 1e6, '250k to 1M'],
      [1e6, 1e9, 'over 1M'],
    ] as const;
    const grad = classes.map(([lo, hi, name]) => {
      let w = 0;
      let a = 0;
      let t = 0;
      for (let c = 0; c < d.fips.length; c++) {
        if (d.pop[c] < lo || d.pop[c] >= hi || !d.lf[c][4] || !d.lf[c][3] || d.unemp[c][4] == null || d.unemp[c][3] == null) continue;
        const lf = d.lf[c][4]!;
        w += lf;
        a += lf * (d.unemp[c][4]! / lf - d.unemp[c][3]! / d.lf[c][3]!);
        t += lf * (t20[c] - t16[c]);
      }
      return { name, actual: a / w, twin: t / w };
    });
    $('scoreBody').innerHTML = `
      <table class="score">
        <tr><th>Forecast of 2020 county unemployment</th><th>RMSE</th><th>Δ corr.</th></tr>
        ${rows.map((r) => `<tr class="${r.rmse === best ? 'best' : ''}"><td>${r.name}</td><td>${r.rmse.toFixed(2)} pts</td><td>${Number.isNaN(r.corr) ? '—' : r.corr.toFixed(2)}</td></tr>`).join('')}
      </table>
      <div class="section-label">Rise in unemployment, 2016 → 2020, by county size</div>
      <table class="score">
        <tr><th>Counties</th><th>BLS</th><th>Twin</th></tr>
        ${grad.map((g) => `<tr><td>${g.name}</td><td>+${(100 * g.actual).toFixed(1)}</td><td>+${(100 * g.twin).toFixed(1)}</td></tr>`).join('')}
      </table>
      <p class="muted" style="margin-top:8px">Labor-force weighted, ${lvl.counties.toLocaleString()} counties. The twin gets part of the urban gradient from industry mix alone, but it does not beat the naive shift. That is a finding in itself. In the BLS data, the county's state explains about half of the variation in the 2016→2020 change and population density about a third, while industry mix explains about 3%. The pandemic landed by place and policy more than by industry. The next step is to feed the twin monthly state releases. Map layer "Backtest error, 2020" shows where it misses.</p>`;
    this.buildLayerSelect();
    this.pushNews({ label: '2020-12', text: `Scoreboard unlocked: twin RMSE ${dlt.rmse.twin.toFixed(2)} pts vs ${lvl.rmse.uniform.toFixed(2)} for a uniform shift across ${lvl.counties.toLocaleString()} counties.`, kind: 'info' });
  }

  // ------------------------------------------------------------ the wire

  generateNews(prev: MonthMessage, m: MonthMessage) {
    const d = this.data.counties;
    if (m.policyNote) this.pushNews({ label: m.label, text: m.policyNote, kind: 'policy' });
    const o = m.observed?.unrate;
    const po = prev.observed?.unrate;
    if (o != null && po != null && (Math.abs(o - po) >= 0.004 || m.label.endsWith('-01'))) {
      const dir = o > po ? 'rises' : o < po ? 'falls' : 'holds';
      this.pushNews({ label: m.label, text: `BLS: unemployment ${dir} to ${pct(o)}. The twin infers labor demand at ${(100 * m.demand).toFixed(1)} (Jan 2016 = 100).`, kind: 'release' });
    }
    const dA = m.demand / prev.demand - 1;
    if (Math.abs(dA) >= 0.04) {
      this.pushNews({ label: m.label, text: `Hidden shock detected: to reproduce this release, labor demand had to ${dA < 0 ? 'fall' : 'rise'} ${Math.abs(100 * dA).toFixed(0)}% in a single month.`, kind: 'release' });
    }
    const moves: { c: number; dj: number }[] = [];
    for (let c = 0; c < d.fips.length; c++) {
      if ((d.lf[c][3] ?? 0) < 120000) continue;
      const dj = m.countyU[c] - prev.countyU[c];
      if (Math.abs(dj) >= 0.025 && this.significantMove(c, prev.countyU[c], m.countyU[c])) moves.push({ c, dj });
    }
    moves.sort((a, b) => Math.abs(b.dj) - Math.abs(a.dj));
    for (const { c, dj } of moves.slice(0, 2)) {
      const sig = this.signature[c];
      const tail = sig >= 0 ? ` Signature industry: ${d.meta.sectors[sig].label.toLowerCase()}.` : '';
      this.pushNews({
        label: m.label,
        text: dj > 0 ? `${d.name[c]}, ${d.state[c]}: unemployment jumps to ${pct(m.countyU[c])} (+${(100 * dj).toFixed(1)} pts).${tail}` : `${d.name[c]}, ${d.state[c]} rebounds: unemployment down to ${pct(m.countyU[c])} (${(100 * dj).toFixed(1)} pts).`,
        kind: 'county',
        county: c,
      });
    }
    if (m.branch && prev.branch && m.label.endsWith('-06')) {
      const diff = m.branch.national.unemploymentRate - m.national.unemploymentRate;
      this.pushNews({ label: m.label, text: `Your timeline: unemployment ${pct(m.branch.national.unemploymentRate)}, ${Math.abs(100 * diff).toFixed(1)} pts ${diff >= 0 ? 'above' : 'below'} reality.`, kind: 'branch' });
    }
  }

  pushNews(n: NewsItem) {
    this.news.unshift(n);
    if (this.news.length > 60) this.news.length = 60;
    this.renderNews();
  }

  renderNews() {
    $('news').innerHTML = this.news
      .slice(0, 5)
      .map((n) => `<li class="${n.kind}"${n.county != null ? ` data-county="${n.county}"` : ''}><time>${shortMonth(n.label)}</time>${n.text}</li>`)
      .join('');
    $('newsCount').textContent = this.news.length ? `${this.news.length} items` : '';
  }

  fillSources() {
    const d = this.data;
    const items = [
      `Synthetic population: one person per ~1,000 residents (at least 80 per county, so small places keep a working labor market), drawn to match each county's age, sex, race, education, jobs by sector, pay by sector, health and votes. Labor force and unemployment are matched exactly to BLS LAUS 2016.`,
      `Engine: monthly search-and-matching labor market. Mechanisms: demography, labor demand & separations, search & matching, participation. See docs/TWIN.md to add your own.`,
      `Assimilation: each month the twin re-runs the month until its national unemployment rate and labor force match the release (usually 2 to 3 tries). Sector payroll releases set the demand mix. Payroll series in this build: ${[...new Set(Object.values(d.releases.sectorSeries))].join(', ')}.`,
      ...d.counties.meta.attribution,
      `Releases: ${d.releases.sources.join('; ')}, ${d.releases.months[0]} to ${d.releases.months[d.releases.months.length - 1]}. Data built ${d.counties.meta.built}.`,
    ];
    $('sources').innerHTML = items.map((i) => `<li>${i}</li>`).join('');
  }
}

const app = new App();
// handy from the browser console: econTwin.select(...), econTwin.months, ...
(window as unknown as { econTwin: App }).econTwin = app;
app.start().catch((e) => {
  console.error(e);
  $('progress').textContent = `Could not start: ${e}`;
});
