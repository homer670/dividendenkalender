// ColorSchema (name.abuchen.portfolio.ui.util.swt.ColorSchema) used by heatmaps

export type ColorSchema = 'GREEN_YELLOW_RED' | 'GREEN_WHITE_RED' | 'GREEN_GRAY_RED' | 'BLUE_GRAY_ORANGE' | 'YELLOW_WHITE_BLACK';

export const COLOR_SCHEMA_LABELS: Record<ColorSchema, string> = {
  GREEN_YELLOW_RED: 'Grün - Gelb - Rot',
  GREEN_WHITE_RED: 'Grün - Weiß - Rot',
  GREEN_GRAY_RED: 'Grün - Grau - Rot',
  BLUE_GRAY_ORANGE: 'Blau - Grau - Orange',
  YELLOW_WHITE_BLACK: 'Gelb - Weiß - Schwarz',
};

const MAX_PERFORMANCE = 0.07;

type RGB = [number, number, number];

function hex(c: RGB): string {
  return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

function parse(h: string): RGB {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

function gradient(points: { color: RGB; position: number }[], value: number): RGB {
  if (value <= 0) return points[0].color;
  if (value >= 1) return points[points.length - 1].color;
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    if (value <= current.position) {
      const previous = points[Math.max(0, i - 1)];
      const diff = current.position - previous.position;
      if (diff === 0) return current.color;
      const f = (value - previous.position) / diff;
      return [0, 1, 2].map((k) => previous.color[k] + (current.color[k] - previous.color[k]) * f) as RGB;
    }
  }
  return points[points.length - 1].color;
}

function even(colors: string[]): { color: RGB; position: number }[] {
  return colors.map((c, i) => ({ color: parse(c), position: i / (colors.length - 1) }));
}

const RED_TO_GREEN = even(['#C92E25', '#FD7F76', '#FD9A93', '#FCBBB7', '#E8E8E8', '#BBE491', '#A1D771', '#80C25E', '#397B27']);
const ORANGE_TO_BLUE = even(['#B36E3A', '#FD9C52', '#FFCEAA', '#DDDDDD', '#9ECBEC', '#3C97DA', '#2A6999']);

function normalize(performance: number): number {
  const p = Math.min(MAX_PERFORMANCE, Math.max(-MAX_PERFORMANCE, performance));
  return (p + MAX_PERFORMANCE) / (2 * MAX_PERFORMANCE);
}

function hsbToRgb(h: number, s: number, v: number): RGB {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function colorFor(schema: ColorSchema, performance: number, background: string): string {
  const p = normalize(performance);
  switch (schema) {
    case 'GREEN_YELLOW_RED':
      return hex(hsbToRgb(p * 120, 0.9, 1));
    case 'GREEN_WHITE_RED':
      return hex(gradient(even(['#FF0000', background, '#68E517']), p));
    case 'GREEN_GRAY_RED':
      return hex(gradient(RED_TO_GREEN, p));
    case 'BLUE_GRAY_ORANGE':
      return hex(gradient(ORANGE_TO_BLUE, p));
    case 'YELLOW_WHITE_BLACK': {
      const cutover = (MAX_PERFORMANCE + 0.05) / (2 * MAX_PERFORMANCE);
      return hex(
        gradient(
          [
            { color: parse(background), position: 0 },
            { color: parse('#FFFF00'), position: cutover },
            { color: [91, 91, 0], position: cutover },
            { color: [0, 0, 0], position: 1 },
          ],
          p,
        ),
      );
    }
  }
}

/** black or white text on the given background */
export function textOn(background: string): string {
  const [r, g, b] = parse(background);
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return l > 140 ? '#111111' : '#FFFFFF';
}
