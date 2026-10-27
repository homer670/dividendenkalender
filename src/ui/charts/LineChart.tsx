// Time series chart (lines, areas and bars) with touch scrubbing

import React, { useMemo, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, StyleSheet, View } from 'react-native';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { LocalDate, toYMD } from '../../core/util/dates';
import { formatDate, monthName } from '../format';
import { T } from '../components/basic';
import { usePalette } from '../theme';
import { CHART_FONT, downsampleIndices, niceTicks } from './scale';
import { COLOR_TEXT } from '../../state/dataSeries';

export interface TimeSeries {
  key: string;
  label: string;
  color: string;
  dates: LocalDate[];
  values: number[];
  area?: boolean;
  bar?: boolean;
  dashed?: boolean;
  /** color for negative bars */
  colorNegative?: string;
}

const PAD_LEFT = 4;
const PAD_RIGHT = 52;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;

function dateLabel(d: LocalDate, span: number): string {
  const { year, month } = toYMD(d);
  if (span > 3 * 365) return String(year);
  if (span > 80) return `${monthName(month, true)} ${String(year).slice(2)}`;
  return formatDate(d).substring(0, 6);
}

export function LineChart({
  series,
  height = 200,
  formatValue,
  formatAxis,
  includeZero = false,
  showLegend = true,
}: {
  series: TimeSeries[];
  height?: number;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  includeZero?: boolean;
  showLegend?: boolean;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const [cursor, setCursor] = useState<LocalDate | null>(null);
  const resolve = (c: string) => (c === COLOR_TEXT ? p.series : c);

  const layout = useMemo(() => {
    let minDate = Infinity;
    let maxDate = -Infinity;
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      if (s.dates.length === 0) continue;
      minDate = Math.min(minDate, s.dates[0]);
      maxDate = Math.max(maxDate, s.dates[s.dates.length - 1]);
      for (const v of s.values) {
        if (!Number.isFinite(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(minDate)) return null;
    if (includeZero || series.some((s) => s.bar)) {
      min = Math.min(min, 0);
      max = Math.max(max, 0);
    }
    if (!Number.isFinite(min)) {
      min = 0;
      max = 1;
    }
    const ticks = niceTicks(min, max, 4);
    return { minDate, maxDate, ...ticks };
  }, [series, includeZero]);

  const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const plotH = height - PAD_TOP - PAD_BOTTOM;

  if (!layout) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <T secondary variant="caption">
          Keine Daten
        </T>
      </View>
    );
  }
  const span = Math.max(1, layout.maxDate - layout.minDate);
  const x = (d: LocalDate) => PAD_LEFT + ((d - layout.minDate) / span) * plotW;
  const y = (v: number) => PAD_TOP + (1 - (v - layout.min) / (layout.max - layout.min || 1)) * plotH;

  const onTouch = (e: GestureResponderEvent) => {
    const lx = e.nativeEvent.locationX;
    const d = Math.round(layout.minDate + ((lx - PAD_LEFT) / plotW) * span);
    setCursor(Math.max(layout.minDate, Math.min(layout.maxDate, d)));
  };

  const xTickCount = width < 300 ? 3 : 4;
  const xTicks: LocalDate[] = [];
  for (let i = 0; i <= xTickCount; i++) xTicks.push(Math.round(layout.minDate + (span * i) / xTickCount));

  const barSeries = series.filter((s) => s.bar);
  const valueAt = (s: TimeSeries, d: LocalDate): { date: LocalDate; value: number } | null => {
    // binary search last date <= d
    let lo = 0;
    let hi = s.dates.length - 1;
    if (hi < 0 || s.dates[0] > d) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s.dates[mid] <= d) lo = mid;
      else hi = mid - 1;
    }
    return { date: s.dates[lo], value: s.values[lo] };
  };

  return (
    <View>
      <View
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{ height }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onTouch}
        onResponderMove={onTouch}
        onResponderRelease={() => setCursor(null)}
        onResponderTerminate={() => setCursor(null)}
      >
        {width > 0 ? (
          <Svg width={width} height={height}>
            {layout.ticks.map((t) => (
              <G key={`t${t}`}>
                <Line
                  x1={PAD_LEFT}
                  x2={PAD_LEFT + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  stroke={t === 0 && layout.min < 0 ? p.chartAxis : p.chartGrid}
                  strokeWidth={StyleSheet.hairlineWidth * 2}
                />
                <SvgText x={width - 2} y={y(t) + 4} fontSize={10} fontFamily={CHART_FONT} fill={p.chartAxis} textAnchor="end">
                  {(formatAxis ?? formatValue)(t)}
                </SvgText>
              </G>
            ))}
            {xTicks.map((d, i) => (
              <SvgText
                key={`x${i}`}
                x={x(d)}
                y={height - 6}
                fontSize={10} fontFamily={CHART_FONT}
                fill={p.chartAxis}
                textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
              >
                {dateLabel(d, span)}
              </SvgText>
            ))}
            {barSeries.map((s, si) => {
              const n = s.dates.length;
              const bw = Math.max(1, Math.min(24, (plotW / Math.max(1, n)) * 0.7) / barSeries.length);
              const y0 = y(0);
              return (
                <G key={s.key}>
                  {s.dates.map((d, i) => {
                    const v = s.values[i];
                    if (!v || !Number.isFinite(v)) return null;
                    const yy = y(v);
                    return (
                      <Rect
                        key={i}
                        x={x(d) - (bw * barSeries.length) / 2 + si * bw}
                        y={Math.min(yy, y0)}
                        width={bw}
                        height={Math.max(1, Math.abs(y0 - yy))}
                        fill={resolve(v < 0 && s.colorNegative ? s.colorNegative : s.color)}
                        rx={bw > 6 ? 2 : 0}
                      />
                    );
                  })}
                </G>
              );
            })}
            {series
              .filter((s) => !s.bar && s.dates.length > 0)
              .map((s) => {
                const idx = downsampleIndices(s.dates.length, s.values, Math.max(60, Math.round(plotW * 1.5)));
                let d = '';
                let first = true;
                for (const i of idx) {
                  const v = s.values[i];
                  if (!Number.isFinite(v)) continue;
                  d += `${first ? 'M' : 'L'}${x(s.dates[i]).toFixed(1)},${y(v).toFixed(1)}`;
                  first = false;
                }
                if (first) return null;
                const color = resolve(s.color);
                const lastI = idx[idx.length - 1];
                const firstI = idx[0];
                const base = y(Math.max(layout.min, Math.min(layout.max, 0)));
                return (
                  <G key={s.key}>
                    {s.area ? (
                      <Path
                        d={`${d}L${x(s.dates[lastI]).toFixed(1)},${base}L${x(s.dates[firstI]).toFixed(1)},${base}Z`}
                        fill={color}
                        opacity={0.15}
                      />
                    ) : null}
                    <Path
                      d={d}
                      stroke={color}
                      strokeWidth={2}
                      fill="none"
                      strokeLinejoin="round"
                      strokeDasharray={s.dashed ? '5,4' : undefined}
                    />
                  </G>
                );
              })}
            {cursor !== null ? (
              <Line x1={x(cursor)} x2={x(cursor)} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke={p.textSecondary} strokeWidth={1} />
            ) : null}
          </Svg>
        ) : null}
        {cursor !== null && width > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.tooltip,
              {
                backgroundColor: p.card,
                borderColor: p.border,
                left: x(cursor) > width / 2 ? 4 : undefined,
                right: x(cursor) > width / 2 ? undefined : PAD_RIGHT,
              },
            ]}
          >
            <T variant="small" secondary>
              {formatDate(cursor)}
            </T>
            {series.map((s) => {
              const v = valueAt(s, cursor);
              if (!v) return null;
              return (
                <View key={s.key} style={styles.tooltipRow}>
                  <View style={[styles.swatch, { backgroundColor: resolve(s.color) }]} />
                  <T variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {s.label}
                  </T>
                  <T variant="small" numeric weight="600">
                    {formatValue(v.value)}
                  </T>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
      {showLegend && series.length > 1 ? <Legend items={series.map((s) => ({ label: s.label, color: resolve(s.color) }))} /> : null}
    </View>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <View style={styles.legend}>
      {items.map((i, k) => (
        <View key={k} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: i.color }]} />
          <T variant="small" secondary numberOfLines={1}>
            {i.label}
          </T>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tooltip: {
    position: 'absolute',
    top: 4,
    maxWidth: 230,
    padding: 6,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
  },
  tooltipRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
});
