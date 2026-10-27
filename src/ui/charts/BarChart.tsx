// Category bar chart (e.g. earnings per month/year) with tap tooltip

import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { G, Line, Rect, Text as SvgText } from 'react-native-svg';

import { T } from '../components/basic';
import { usePalette } from '../theme';
import { Legend } from './LineChart';
import { CHART_FONT, niceTicks } from './scale';

export interface BarSeries {
  label: string;
  color: string;
  values: number[];
}

const AXIS_W = 48;
const PAD_TOP = 8;
const PAD_BOTTOM = 22;

export function BarChart({
  labels,
  series,
  height = 200,
  formatValue,
  formatAxis,
  minBarWidth = 10,
  stacked = false,
}: {
  labels: string[];
  series: BarSeries[];
  height?: number;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  minBarWidth?: number;
  stacked?: boolean;
}) {
  const p = usePalette();
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const n = labels.length;
  let min = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      for (const s of series) {
        const v = s.values[i] ?? 0;
        if (v > 0) pos += v;
        else neg += v;
      }
      max = Math.max(max, pos);
      min = Math.min(min, neg);
    } else
      for (const s of series) {
        const v = s.values[i] ?? 0;
        max = Math.max(max, v);
        min = Math.min(min, v);
      }
  }
  const ticks = niceTicks(min, max === min ? min + 1 : max, 4);
  const plotH = height - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + (1 - (v - ticks.min) / (ticks.max - ticks.min || 1)) * plotH;
  const groups = stacked ? 1 : Math.max(1, series.length);
  const slot = Math.max(minBarWidth * groups + 4, n > 0 ? (width - AXIS_W) / n : 0);
  const plotW = slot * n;
  const bw = Math.max(2, (slot * 0.72) / groups);
  const labelEvery = Math.max(1, Math.ceil(28 / slot));

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 ? (
        <View style={{ flexDirection: 'row' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ width: width - AXIS_W }}>
            <View>
              <Svg width={plotW} height={height}>
                {ticks.ticks.map((t) => (
                  <Line
                    key={t}
                    x1={0}
                    x2={plotW}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={t === 0 ? p.chartAxis : p.chartGrid}
                    strokeWidth={StyleSheet.hairlineWidth * 2}
                  />
                ))}
                {labels.map((label, i) => {
                  let pos = 0;
                  let neg = 0;
                  return (
                    <G key={i} opacity={selected === null || selected === i ? 1 : 0.45}>
                      {series.map((s, si) => {
                        const v = s.values[i] ?? 0;
                        if (v === 0) return null;
                        let top: number;
                        let bottom: number;
                        let xx: number;
                        if (stacked) {
                          const from = v > 0 ? pos : neg;
                          const to = from + v;
                          if (v > 0) pos = to;
                          else neg = to;
                          top = y(Math.max(from, to));
                          bottom = y(Math.min(from, to));
                          xx = i * slot + (slot - bw) / 2;
                        } else {
                          top = y(Math.max(0, v));
                          bottom = y(Math.min(0, v));
                          xx = i * slot + (slot - bw * groups) / 2 + si * bw;
                        }
                        return (
                          <Rect
                            key={si}
                            x={xx}
                            y={top}
                            width={bw - (groups > 1 ? 1 : 0)}
                            height={Math.max(1, bottom - top - (stacked ? 1 : 0))}
                            fill={s.color}
                            rx={bw > 6 ? 2 : 0}
                          />
                        );
                      })}
                      {i % labelEvery === 0 ? (
                        <SvgText x={i * slot + slot / 2} y={height - 6} fontSize={10} fontFamily={CHART_FONT} fill={p.chartAxis} textAnchor="middle">
                          {label}
                        </SvgText>
                      ) : null}
                    </G>
                  );
                })}
              </Svg>
              <View style={[StyleSheet.absoluteFill, { flexDirection: 'row' }]}>
                {labels.map((_, i) => (
                  <Pressable key={i} style={{ width: slot, height }} onPress={() => setSelected(selected === i ? null : i)} />
                ))}
              </View>
            </View>
          </ScrollView>
          <Svg width={AXIS_W} height={height}>
            {ticks.ticks.map((t) => (
              <SvgText key={t} x={AXIS_W - 2} y={y(t) + 4} fontSize={10} fontFamily={CHART_FONT} fill={p.chartAxis} textAnchor="end">
                {(formatAxis ?? formatValue)(t)}
              </SvgText>
            ))}
          </Svg>
        </View>
      ) : (
        <View style={{ height }} />
      )}
      {selected !== null && selected < n ? (
        <View style={[styles.tooltip, { backgroundColor: p.cardAlt }]}>
          <T variant="caption" weight="600">
            {labels[selected]}
          </T>
          {series.map((s, si) => (
            <View key={si} style={styles.row}>
              <View style={[styles.swatch, { backgroundColor: s.color }]} />
              <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                {s.label}
              </T>
              <T variant="caption" numeric weight="600">
                {formatValue(s.values[selected] ?? 0)}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {series.length > 1 ? <Legend items={series.map((s) => ({ label: s.label, color: s.color }))} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tooltip: { marginTop: 6, padding: 8, borderRadius: 6, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
});
