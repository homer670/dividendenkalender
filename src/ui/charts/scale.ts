// helpers for chart scales

export function niceStep(range: number, ticks: number): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1;
  const raw = range / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

export function niceTicks(min: number, max: number, ticks = 4): { min: number; max: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    const d = min === 0 ? 1 : Math.abs(min) * 0.1;
    min -= d;
    max += d;
  }
  const step = niceStep(max - min, ticks);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { min: lo, max: hi, ticks: out };
}

/** keeps at most maxPoints indices (always first and last), keeping local extrema of each bucket */
export function downsampleIndices(length: number, values: number[], maxPoints: number): number[] {
  if (length <= maxPoints) return Array.from({ length }, (_, i) => i);
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const size = length / buckets;
  const out: number[] = [0];
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(length, Math.floor((b + 1) * size));
    let minI = from;
    let maxI = from;
    for (let i = from; i < to; i++) {
      if (values[i] < values[minI]) minI = i;
      if (values[i] > values[maxI]) maxI = i;
    }
    if (minI < maxI) out.push(minI, maxI);
    else if (maxI < minI) out.push(maxI, minI);
    else out.push(minI);
  }
  out.push(length - 1);
  return [...new Set(out)].sort((a, b) => a - b);
}

/** fixed categorical order (used when the data has no colors of its own) */
export const CATEGORICAL_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const CATEGORICAL_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];

/** font of the chart labels (SVG text defaults to a serif font on the web) */
export const CHART_FONT: string | undefined =
  typeof document !== 'undefined' ? 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' : undefined;
