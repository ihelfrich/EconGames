/**
 * Isometric (2.5D) tile renderer for the county grid, on a plain 2D canvas.
 *
 * Every land tile is a block: its top face takes the county's color, its
 * height comes from the county (population density by default), and sides
 * are drawn only where a block stands above its neighbour. The camera can
 * pan, zoom and rotate; picking uses an offscreen buffer where each block is
 * painted in a color that encodes its county.
 */
import type { GridData } from '../data';

export interface Camera {
  /** grid coordinates at the screen centre */
  cx: number;
  cy: number;
  /** screen pixels per tile */
  zoom: number;
  /** rotation in radians */
  rot: number;
  /** vertical squash of the ground plane */
  tilt: number;
  /** screen pixels of height per unit of block height, per tile of zoom */
  zScale: number;
}

export interface Label {
  county: number;
  text: string;
  minZoom: number;
}

interface Cell {
  gx: number;
  gy: number;
  county: number;
  /** neighbour tile index in the cell list for N, E, S, W (-1 = water) */
  nb: [number, number, number, number];
}

const EDGE_NORMALS: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
const SEA_DEPTH = -0.35;

export class IsoMap {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private grid: GridData;
  private cells: Cell[] = [];
  private countyState: Int16Array;
  private countyCells: number[][];
  private order: Int32Array = new Int32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  private dpr = 1;
  private width = 0;
  private height = 0;
  private pickData: Uint8ClampedArray | null = null;
  private pickDirty = true;
  private geomDirty = true;
  heights: Float32Array;
  /** per-county fill colors as [r, g, b] 0-255 */
  colors: Uint8Array;
  selected = -1;
  hovered = -1;
  labels: Label[] = [];
  camera: Camera;
  /** counties to draw a pulse ring on (e.g. big monthly jumps) */
  pulses: { county: number; age: number }[] = [];

  constructor(canvas: HTMLCanvasElement, grid: GridData, countyState: Int16Array) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.grid = grid;
    this.countyState = countyState;
    const nc = countyState.length;
    this.heights = new Float32Array(nc).fill(0.3);
    this.colors = new Uint8Array(nc * 3).fill(128);
    this.countyCells = Array.from({ length: nc }, () => []);
    const idx = new Int32Array(grid.w * grid.h).fill(-1);
    for (let gy = 0; gy < grid.h; gy++)
      for (let gx = 0; gx < grid.w; gx++) {
        const c = grid.cells[gy * grid.w + gx];
        if (c < 0) continue;
        idx[gy * grid.w + gx] = this.cells.length;
        this.countyCells[c].push(this.cells.length);
        this.cells.push({ gx, gy, county: c, nb: [-1, -1, -1, -1] });
      }
    for (const cell of this.cells) {
      const at = (x: number, y: number) => (x < 0 || y < 0 || x >= grid.w || y >= grid.h ? -1 : idx[y * grid.w + x]);
      cell.nb = [at(cell.gx, cell.gy - 1), at(cell.gx + 1, cell.gy), at(cell.gx, cell.gy + 1), at(cell.gx - 1, cell.gy)];
    }
    this.camera = { cx: grid.w / 2, cy: grid.h / 2 + 4, zoom: 5, rot: -0.35, tilt: 0.62, zScale: 0.9 };
    this.resize();
  }

  /** Fit the whole map in the canvas. */
  fit(): void {
    const { w, h } = this.grid;
    const c = Math.cos(this.camera.rot);
    const s = Math.sin(this.camera.rot);
    const ext = (sx: number, sy: number) => [Math.abs(sx * c - sy * s), Math.abs(sx * s + sy * c)];
    const [ax, ay] = ext(w / 2, h / 2);
    const [bx, by] = ext(w / 2, -h / 2);
    const halfW = Math.max(ax, bx);
    const halfH = Math.max(ay, by) * this.camera.tilt + 3;
    this.camera.zoom = Math.min((this.width * 0.5) / halfW, (this.height * 0.47) / halfH);
    this.camera.cx = w / 2;
    this.camera.cy = h / 2;
    this.invalidate();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.invalidate();
  }

  invalidate(): void {
    this.geomDirty = true;
    this.pickDirty = true;
  }

  private project(): void {
    const { w, h } = this.grid;
    const cam = this.camera;
    const nv = (w + 1) * (h + 1);
    if (this.vx.length !== nv) {
      this.vx = new Float32Array(nv);
      this.vy = new Float32Array(nv);
    }
    const c = Math.cos(cam.rot);
    const s = Math.sin(cam.rot);
    const W2 = this.width / 2;
    const H2 = this.height / 2;
    for (let y = 0; y <= h; y++)
      for (let x = 0; x <= w; x++) {
        const dx = x - cam.cx;
        const dy = y - cam.cy;
        const k = y * (w + 1) + x;
        this.vx[k] = W2 + (dx * c - dy * s) * cam.zoom;
        this.vy[k] = H2 + (dx * s + dy * c) * cam.zoom * cam.tilt;
      }
    // painter's order: far (small screen depth) first
    const depth = new Float32Array(this.cells.length);
    this.cells.forEach((cell, i) => {
      depth[i] = (cell.gx + 0.5 - cam.cx) * s + (cell.gy + 0.5 - cam.cy) * c;
    });
    const order = Int32Array.from(this.cells.keys());
    order.sort((a, b) => depth[a] - depth[b]);
    this.order = order;
    this.geomDirty = false;
  }

  /** screen position of the top centre of a county's tallest tile */
  anchor(county: number): [number, number] | null {
    const list = this.countyCells[county];
    if (!list?.length) return null;
    if (this.geomDirty) this.project();
    let sx = 0;
    let sy = 0;
    for (const i of list) {
      const { gx, gy } = this.cells[i];
      const k = gy * (this.grid.w + 1) + gx;
      sx += (this.vx[k] + this.vx[k + this.grid.w + 2]) / 2;
      sy += (this.vy[k] + this.vy[k + this.grid.w + 2]) / 2;
    }
    const z = this.heights[county] * this.camera.zoom * this.camera.zScale;
    return [sx / list.length, sy / list.length - z];
  }

  render(): void {
    if (this.geomDirty) this.project();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const bg = ctx.createRadialGradient(this.width * 0.5, this.height * 0.4, 50, this.width * 0.5, this.height * 0.5, Math.max(this.width, this.height));
    bg.addColorStop(0, '#16233b');
    bg.addColorStop(1, '#070b14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawBlocks(ctx, false);
    this.drawOverlay(ctx);
  }

  private drawBlocks(ctx: CanvasRenderingContext2D, pick: boolean): void {
    const { w } = this.grid;
    const W1 = w + 1;
    const cam = this.camera;
    const zpx = cam.zoom * cam.zScale;
    const cr = Math.cos(cam.rot);
    const sr = Math.sin(cam.rot);
    // which edges face the viewer, and their light
    const faces: number[] = [];
    const shade: number[] = [];
    EDGE_NORMALS.forEach(([nx, ny], e) => {
      const rx = nx * cr - ny * sr;
      const ry = nx * sr + ny * cr;
      if (ry > 1e-6) {
        faces.push(e);
        shade.push(0.48 + 0.3 * Math.max(0, -rx * 0.7 + ry * 0.3));
      }
    });
    const colors = this.colors;
    const heights = this.heights;
    const vx = this.vx;
    const vy = this.vy;
    const pad = 40;
    for (let oi = 0; oi < this.order.length; oi++) {
      const cell = this.cells[this.order[oi]];
      const c = cell.county;
      const k = cell.gy * W1 + cell.gx;
      // corners: 0 NW, 1 NE, 2 SE, 3 SW
      const xs = [vx[k], vx[k + 1], vx[k + W1 + 1], vx[k + W1]];
      const ys = [vy[k], vy[k + 1], vy[k + W1 + 1], vy[k + W1]];
      const z = heights[c] * zpx;
      if (Math.max(xs[0], xs[1], xs[2], xs[3]) < -pad || Math.min(xs[0], xs[1], xs[2], xs[3]) > this.width + pad) continue;
      if (Math.max(ys[0], ys[1], ys[2], ys[3]) < -pad || Math.min(ys[0], ys[1], ys[2], ys[3]) - z > this.height + pad) continue;
      const r = colors[c * 3];
      const g = colors[c * 3 + 1];
      const b = colors[c * 3 + 2];
      for (let f = 0; f < faces.length; f++) {
        const e = faces[f];
        const nb = cell.nb[e];
        const zn = (nb < 0 ? SEA_DEPTH : heights[this.cells[nb].county]) * zpx;
        if (zn >= z - 0.05) continue;
        const a = e;
        const bb = (e + 1) % 4;
        ctx.fillStyle = pick ? pickColor(c) : rgb(r * shade[f], g * shade[f], b * shade[f]);
        ctx.beginPath();
        ctx.moveTo(xs[a], ys[a] - z);
        ctx.lineTo(xs[bb], ys[bb] - z);
        ctx.lineTo(xs[bb], ys[bb] - zn);
        ctx.lineTo(xs[a], ys[a] - zn);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = pick ? pickColor(c) : rgb(r, g, b);
      ctx.beginPath();
      ctx.moveTo(xs[0], ys[0] - z);
      ctx.lineTo(xs[1], ys[1] - z);
      ctx.lineTo(xs[2], ys[2] - z);
      ctx.lineTo(xs[3], ys[3] - z);
      ctx.closePath();
      ctx.fill();
      if (!pick && cam.zoom > 3) {
        // a hairline on the top face keeps tiles legible when zoomed in
        ctx.strokeStyle = 'rgba(0,0,0,0.12)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
    if (pick) return;
    // state borders and coastlines on top faces
    ctx.beginPath();
    for (const cell of this.cells) {
      const c = cell.county;
      const z = heights[c] * zpx;
      const k = cell.gy * W1 + cell.gx;
      const xs = [vx[k], vx[k + 1], vx[k + W1 + 1], vx[k + W1]];
      const ys = [vy[k], vy[k + 1], vy[k + W1 + 1], vy[k + W1]];
      for (let e = 0; e < 4; e++) {
        const nb = cell.nb[e];
        if (nb >= 0 && this.countyState[this.cells[nb].county] === this.countyState[c]) continue;
        if (nb >= 0 && e > 1) continue; // shared border: draw once
        ctx.moveTo(xs[e], ys[e] - z);
        ctx.lineTo(xs[(e + 1) % 4], ys[(e + 1) % 4] - z);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  private outline(ctx: CanvasRenderingContext2D, county: number, style: string, width: number): void {
    const list = this.countyCells[county];
    if (!list?.length) return;
    const W1 = this.grid.w + 1;
    const zpx = this.camera.zoom * this.camera.zScale;
    const z = this.heights[county] * zpx;
    ctx.beginPath();
    for (const i of list) {
      const cell = this.cells[i];
      const k = cell.gy * W1 + cell.gx;
      const xs = [this.vx[k], this.vx[k + 1], this.vx[k + W1 + 1], this.vx[k + W1]];
      const ys = [this.vy[k], this.vy[k + 1], this.vy[k + W1 + 1], this.vy[k + W1]];
      for (let e = 0; e < 4; e++) {
        const nb = cell.nb[e];
        if (nb >= 0 && this.cells[nb].county === county) continue;
        ctx.moveTo(xs[e], ys[e] - z);
        ctx.lineTo(xs[(e + 1) % 4], ys[(e + 1) % 4] - z);
      }
    }
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  private drawOverlay(ctx: CanvasRenderingContext2D): void {
    for (const p of this.pulses) {
      const a = this.anchor(p.county);
      if (!a) continue;
      const t = p.age / 12;
      ctx.beginPath();
      ctx.ellipse(a[0], a[1], 6 + 30 * t, (6 + 30 * t) * this.camera.tilt, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,204,0,${0.9 * (1 - t)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (this.hovered >= 0 && this.hovered !== this.selected) this.outline(ctx, this.hovered, 'rgba(255,255,255,0.9)', 1.5);
    if (this.selected >= 0) {
      this.outline(ctx, this.selected, '#000', 4);
      this.outline(ctx, this.selected, '#ffcc00', 2);
    }
    ctx.font = '600 11px "Space Grotesk", system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const l of this.labels) {
      if (this.camera.zoom < l.minZoom) continue;
      const a = this.anchor(l.county);
      if (!a || a[0] < 0 || a[0] > this.width || a[1] < 0 || a[1] > this.height) continue;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(5,8,15,0.85)';
      ctx.strokeText(l.text, a[0], a[1] - 6);
      ctx.fillStyle = '#f5f1e8';
      ctx.fillText(l.text, a[0], a[1] - 6);
    }
  }

  /** County under a client-space point, or -1. */
  pick(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((clientX - rect.left) * this.dpr);
    const y = Math.floor((clientY - rect.top) * this.dpr);
    if (this.pickDirty || !this.pickData) this.renderPick();
    const W = this.canvas.width;
    if (x < 0 || y < 0 || x >= W || y >= this.canvas.height) return -1;
    const d = this.pickData!;
    const o = (y * W + x) * 4;
    const id = d[o] * 65536 + d[o + 1] * 256 + d[o + 2] - 1;
    return id >= 0 && id < this.countyState.length && d[o + 3] === 255 ? id : -1;
  }

  private renderPick(): void {
    if (this.geomDirty) this.project();
    const off = document.createElement('canvas');
    off.width = this.canvas.width;
    off.height = this.canvas.height;
    const ctx = off.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    this.drawBlocks(ctx, true);
    this.pickData = ctx.getImageData(0, 0, off.width, off.height).data;
    this.pickDirty = false;
  }

  // ------------------------------------------------------------ interaction

  pan(dxPx: number, dyPx: number): void {
    const cam = this.camera;
    const c = Math.cos(cam.rot);
    const s = Math.sin(cam.rot);
    const rx = -dxPx / cam.zoom;
    const ry = -dyPx / (cam.zoom * cam.tilt);
    cam.cx += rx * c + ry * s;
    cam.cy += -rx * s + ry * c;
    this.invalidate();
  }

  zoomAt(factor: number, clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left - this.width / 2;
    const py = clientY - rect.top - this.height / 2;
    const cam = this.camera;
    const nz = Math.min(80, Math.max(1.5, cam.zoom * factor));
    const f = nz / cam.zoom;
    // keep the point under the cursor fixed
    this.pan(-(px * (f - 1)) / f, -(py * (f - 1)) / f);
    cam.zoom = nz;
    this.invalidate();
  }

  rotate(delta: number): void {
    this.camera.rot += delta;
    this.invalidate();
  }

  /** Centre and zoom on a county. */
  focus(county: number, zoom = 22): void {
    const list = this.countyCells[county];
    if (!list?.length) return;
    let x = 0;
    let y = 0;
    for (const i of list) {
      x += this.cells[i].gx + 0.5;
      y += this.cells[i].gy + 0.5;
    }
    this.camera.cx = x / list.length;
    this.camera.cy = y / list.length;
    this.camera.zoom = Math.max(this.camera.zoom, zoom);
    this.invalidate();
  }
}

function pickColor(c: number): string {
  const id = c + 1;
  return `rgb(${(id >> 16) & 255},${(id >> 8) & 255},${id & 255})`;
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
