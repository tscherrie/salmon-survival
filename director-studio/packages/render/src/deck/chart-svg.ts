import { escapeHtml, round } from '../util/html.ts';

/**
 * Inline-SVG-Diagramme für Folien (Balken, Linie, Torte). Statisch (PDF/PNG/Bühne), daher ohne
 * Hover-Ebene. Gestaltung: dünne Marken, Balken mit 4px-Rundung am Datenende, 2px-Linien,
 * Punkte mit Flächenring, zurückhaltendes Raster, Legende ab zwei Reihen, Text nie in Reihenfarbe.
 */

export interface ChartSpec {
  type: 'bar' | 'line' | 'pie';
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
}

export interface ChartSvgOptions {
  width: number;
  height: number;
  /** Kategoriale Farben in fester Reihenfolge (nie zyklisch neu vergeben). */
  colors?: string[];
  fontFamily?: string;
  textColor?: string;
  mutedTextColor?: string;
  gridColor?: string;
  surfaceColor?: string;
  /** Basisschriftgröße in px (Standard: abhängig von der Diagrammgröße). */
  fontSize?: number;
  /** data-sid des Diagramms (für Picker/Referenzen). */
  sid?: string;
}

/** Validierte Standardpalette (helle Fläche), feste Reihenfolge. */
export const DEFAULT_CHART_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

/** „Schöne“ Achsenteilung. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    if (max === 0) return [0, 1];
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  const span = niceNum(max - min, false);
  const step = niceNum(span / Math.max(1, count - 1), true);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function niceNum(range: number, roundIt: boolean): number {
  const exponent = Math.floor(Math.log10(range || 1));
  const fraction = range / 10 ** exponent;
  let nice: number;
  if (roundIt) nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * 10 ** exponent;
}

/** Zahlen deutsch formatiert (Tausenderpunkt, Dezimalkomma). */
export function formatNumber(value: number): string {
  const abs = Math.abs(value);
  const digits = abs !== 0 && abs < 10 && !Number.isInteger(value) ? 1 : 0;
  return value.toLocaleString('de-DE', { maximumFractionDigits: Math.max(digits, Number.isInteger(value) ? 0 : 2) });
}

export function chartToSvg(chart: ChartSpec, opts: ChartSvgOptions): string {
  const W = Math.max(40, opts.width);
  const H = Math.max(40, opts.height);
  const colors = opts.colors?.length ? opts.colors : DEFAULT_CHART_COLORS;
  const fs = opts.fontSize ?? Math.max(12, Math.round(Math.min(W, H) * 0.045));
  const text = opts.textColor ?? '#0b0b0b';
  const muted = opts.mutedTextColor ?? '#52514e';
  const grid = opts.gridColor ?? '#e4e2dd';
  const surface = opts.surfaceColor ?? '#ffffff';
  const font = opts.fontFamily ?? 'system-ui, sans-serif';
  const sidAttr = opts.sid ? ` data-sid="${escapeHtml(opts.sid)}"` : '';
  const head = `<svg xmlns="http://www.w3.org/2000/svg" class="chart chart-${chart.type}"${sidAttr} width="${round(W)}" height="${round(H)}" viewBox="0 0 ${round(W)} ${round(H)}" role="img" aria-label="${escapeHtml(chartTitle(chart))}" font-family="${escapeHtml(font)}" font-size="${fs}">`;
  const parts: string[] = [head];
  const series = chart.series.slice(0, colors.length);
  const color = (i: number) => colors[i] ?? colors[colors.length - 1]!;

  // Legende (ab zwei Reihen bzw. immer bei Torten)
  const legendItems = chart.type === 'pie' ? chart.labels : series.map((s) => s.name);
  const showLegend = chart.type === 'pie' ? chart.labels.length > 0 : series.length >= 2;
  let top = fs * 0.5;
  if (showLegend && chart.type !== 'pie') {
    let x = 0;
    const y = fs * 0.9;
    legendItems.forEach((name, i) => {
      parts.push(`<rect x="${round(x)}" y="${round(y - fs * 0.62)}" width="${round(fs * 0.75)}" height="${round(fs * 0.75)}" rx="${round(fs * 0.15)}" fill="${escapeHtml(color(i))}"/>`);
      parts.push(`<text x="${round(x + fs * 1.05)}" y="${round(y)}" fill="${escapeHtml(muted)}">${escapeHtml(name)}</text>`);
      x += fs * 1.6 + estimateTextWidth(name, fs);
    });
    top = fs * 2.2;
  }

  if (chart.type === 'pie') {
    parts.push(renderPie(chart, { W, H, fs, colors, text, muted, surface }));
    parts.push('</svg>');
    return parts.join('');
  }

  const all = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  const minV = Math.min(0, ...all);
  const maxV = Math.max(0, ...all);
  const ticks = niceTicks(minV, maxV, 5);
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const tickLabelWidth = Math.max(...ticks.map((t) => estimateTextWidth(formatNumber(t), fs * 0.85)));
  const left = tickLabelWidth + fs * 0.8;
  const right = chart.type === 'line' ? fs * 2.5 : fs * 0.5;
  const bottom = fs * 2;
  const plotW = Math.max(10, W - left - right);
  const plotH = Math.max(10, H - top - bottom);
  const yOf = (v: number) => top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;

  // Raster + Y-Achse
  for (const t of ticks) {
    const y = round(yOf(t));
    parts.push(`<line x1="${round(left)}" x2="${round(left + plotW)}" y1="${y}" y2="${y}" stroke="${escapeHtml(t === 0 ? muted : grid)}" stroke-width="1"/>`);
    parts.push(`<text x="${round(left - fs * 0.5)}" y="${round(y + fs * 0.3)}" text-anchor="end" font-size="${round(fs * 0.85)}" fill="${escapeHtml(muted)}">${escapeHtml(formatNumber(t))}</text>`);
  }
  const n = Math.max(1, chart.labels.length);
  const band = plotW / n;
  chart.labels.forEach((label, i) => {
    const x = left + band * (i + 0.5);
    parts.push(`<text x="${round(x)}" y="${round(top + plotH + fs * 1.3)}" text-anchor="middle" font-size="${round(fs * 0.85)}" fill="${escapeHtml(muted)}">${escapeHtml(truncate(label, Math.max(4, Math.floor(band / (fs * 0.5)))))}</text>`);
  });

  if (chart.type === 'bar') {
    const groups = Math.max(1, series.length);
    const gap = 2;
    const barW = Math.max(2, Math.min(Math.max(24, H * 0.06), (band * 0.7 - gap * (groups - 1)) / groups));
    const groupW = barW * groups + gap * (groups - 1);
    const zeroY = yOf(0);
    const labelBars = n * groups <= 8;
    const radius = Math.min(4 * Math.max(1, fs / 16), barW / 2);
    series.forEach((s, si) => {
      s.values.slice(0, n).forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = left + band * (i + 0.5) - groupW / 2 + si * (barW + gap);
        const y = yOf(v);
        const h = Math.abs(zeroY - y);
        parts.push(`<path d="${barPath(x, Math.min(y, zeroY), barW, h, radius, v >= 0)}" fill="${escapeHtml(color(si))}"><title>${escapeHtml(`${s.name} · ${chart.labels[i] ?? ''}: ${formatNumber(v)}`)}</title></path>`);
        if (labelBars) {
          const ly = v >= 0 ? y - fs * 0.35 : y + fs * 1.05;
          parts.push(`<text x="${round(x + barW / 2)}" y="${round(ly)}" text-anchor="middle" font-size="${round(fs * 0.8)}" fill="${escapeHtml(text)}">${escapeHtml(formatNumber(v))}</text>`);
        }
      });
    });
  } else {
    const strokeW = Math.max(2, fs / 8);
    const r = Math.max(4, fs / 4);
    series.forEach((s, si) => {
      const pts = s.values.slice(0, n).map((v, i) => [left + band * (i + 0.5), yOf(v)] as const).filter(([, y]) => Number.isFinite(y));
      if (!pts.length) return;
      parts.push(`<polyline fill="none" stroke="${escapeHtml(color(si))}" stroke-width="${round(strokeW)}" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([x, y]) => `${round(x)},${round(y)}`).join(' ')}"/>`);
      const [lx, ly] = pts[pts.length - 1]!;
      parts.push(`<circle cx="${round(lx)}" cy="${round(ly)}" r="${round(r)}" fill="${escapeHtml(color(si))}" stroke="${escapeHtml(surface)}" stroke-width="2"/>`);
      const last = s.values[pts.length - 1];
      if (last !== undefined) {
        parts.push(`<text x="${round(lx + r + fs * 0.3)}" y="${round(ly + fs * 0.3)}" font-size="${round(fs * 0.8)}" fill="${escapeHtml(text)}">${escapeHtml(formatNumber(last))}</text>`);
      }
    });
  }
  parts.push('</svg>');
  return parts.join('');
}

function chartTitle(chart: ChartSpec): string {
  const kind = chart.type === 'bar' ? 'Balkendiagramm' : chart.type === 'line' ? 'Liniendiagramm' : 'Tortendiagramm';
  return `${kind}: ${chart.series.map((s) => s.name).join(', ')}`;
}

/** Balken mit gerundetem Datenende und gerader Basis. */
function barPath(x: number, y: number, w: number, h: number, r: number, up: boolean): string {
  const rr = Math.min(r, h);
  if (h <= 0) return `M${round(x)},${round(y)}h${round(w)}`;
  if (up) {
    return `M${round(x)},${round(y + h)}V${round(y + rr)}Q${round(x)},${round(y)} ${round(x + rr)},${round(y)}H${round(x + w - rr)}Q${round(x + w)},${round(y)} ${round(x + w)},${round(y + rr)}V${round(y + h)}Z`;
  }
  return `M${round(x)},${round(y)}V${round(y + h - rr)}Q${round(x)},${round(y + h)} ${round(x + rr)},${round(y + h)}H${round(x + w - rr)}Q${round(x + w)},${round(y + h)} ${round(x + w)},${round(y + h - rr)}V${round(y)}Z`;
}

function renderPie(chart: ChartSpec, o: { W: number; H: number; fs: number; colors: string[]; text: string; muted: string; surface: string }): string {
  const values = (chart.series[0]?.values ?? []).slice(0, o.colors.length).map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  const legendW = Math.min(o.W * 0.42, Math.max(...chart.labels.map((l) => estimateTextWidth(l, o.fs))) + o.fs * 4.5);
  const size = Math.min(o.W - legendW, o.H) * 0.92;
  const cx = (o.W - legendW) / 2;
  const cy = o.H / 2;
  const r = size / 2;
  const parts: string[] = [];
  if (total <= 0) {
    parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="none" stroke="${escapeHtml(o.muted)}" stroke-width="1"/>`);
  } else {
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      if (v <= 0) return;
      const a = (v / total) * Math.PI * 2;
      const color = o.colors[i]!;
      if (a >= Math.PI * 2 - 1e-9) {
        parts.push(`<circle cx="${round(cx)}" cy="${round(cy)}" r="${round(r)}" fill="${escapeHtml(color)}"/>`);
      } else {
        const x1 = cx + r * Math.cos(angle);
        const y1 = cy + r * Math.sin(angle);
        const x2 = cx + r * Math.cos(angle + a);
        const y2 = cy + r * Math.sin(angle + a);
        const large = a > Math.PI ? 1 : 0;
        parts.push(`<path d="M${round(cx)},${round(cy)}L${round(x1)},${round(y1)}A${round(r)},${round(r)} 0 ${large} 1 ${round(x2)},${round(y2)}Z" fill="${escapeHtml(color)}" stroke="${escapeHtml(o.surface)}" stroke-width="2" stroke-linejoin="round"><title>${escapeHtml(`${chart.labels[i] ?? ''}: ${formatNumber(v)}`)}</title></path>`);
      }
      angle += a;
    });
  }
  // Legende mit Anteilen
  const lx = o.W - legendW + o.fs;
  const lineH = o.fs * 1.6;
  let ly = cy - ((values.length - 1) * lineH) / 2;
  values.forEach((v, i) => {
    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
    parts.push(`<rect x="${round(lx)}" y="${round(ly - o.fs * 0.62)}" width="${round(o.fs * 0.75)}" height="${round(o.fs * 0.75)}" rx="${round(o.fs * 0.15)}" fill="${escapeHtml(o.colors[i]!)}"/>`);
    parts.push(`<text x="${round(lx + o.fs * 1.1)}" y="${round(ly)}" fill="${escapeHtml(o.text)}">${escapeHtml(chart.labels[i] ?? '')} <tspan fill="${escapeHtml(o.muted)}">${pct} %</tspan></text>`);
    ly += lineH;
  });
  return parts.join('');
}

/** Grobe Textbreite (Durchschnittsbreite ~0,55 em). */
export function estimateTextWidth(value: string, fontSize: number): number {
  return value.length * fontSize * 0.55;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, Math.max(1, max - 1))}…` : value;
}
