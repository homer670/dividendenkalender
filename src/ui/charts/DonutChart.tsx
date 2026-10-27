// Donut chart (asset allocation, taxonomy)

import React, { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { T } from '../components/basic';
import { usePalette } from '../theme';

export interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const x0 = cx + r * Math.sin(a0);
  const y0 = cy - r * Math.cos(a0);
  const x1 = cx + r * Math.sin(a1);
  const y1 = cy - r * Math.cos(a1);
  return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
}

export function DonutChart({
  slices,
  size = 200,
  centerLabel,
  centerValue,
  formatValue,
  formatShare,
  selectedKey,
  onSelect,
  outerSlices,
}: {
  slices: Slice[];
  /** optional second ring (e.g. securities within the classifications), in the same order and total as slices */
  outerSlices?: Slice[];
  size?: number;
  centerLabel?: string;
  centerValue?: string;
  formatValue: (v: number) => string;
  formatShare: (share: number) => string;
  selectedKey?: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const p = usePalette();
  const [internal, setInternal] = useState<string | null>(null);
  const sel = selectedKey !== undefined ? selectedKey : internal;
  const select = (k: string | null) => (onSelect ? onSelect(k) : setInternal(k));
  const visible = slices.filter((s) => s.value > 0);
  const total = visible.reduce((a, s) => a + s.value, 0);
  const outer = (outerSlices ?? []).filter((x) => x.value > 0);
  const outerStroke = outer.length > 0 ? size * 0.07 : 0;
  const stroke = size * 0.14;
  const r = size / 2 - outerStroke - stroke / 2 - 6;
  const rOuter = size / 2 - outerStroke / 2 - 2;
  const c = size / 2;
  const gap = visible.length > 1 ? Math.min(0.02, 2 / r) : 0;
  const selected = visible.find((s) => s.key === sel) ?? outer.find((s) => s.key === sel) ?? null;
  const outerTotal = outer.reduce((a, s) => a + s.value, 0);
  const starts = (list: Slice[], sum: number) => {
    const out: number[] = [];
    let a = 0;
    for (const s of list) {
      out.push(a);
      a += (s.value / sum) * Math.PI * 2;
    }
    return out;
  };
  const innerStart = starts(visible, total);
  const outerStart = starts(outer, outerTotal);
  return (
    <View style={{ width: size, height: size, alignSelf: 'center' }}>
      <Svg width={size} height={size}>
        {total <= 0 ? <Circle cx={c} cy={c} r={r} stroke={p.chartGrid} strokeWidth={stroke} fill="none" /> : null}
        <G>
          {visible.map((s, i) => {
            const sweep = (s.value / total) * Math.PI * 2;
            const a0 = innerStart[i] + gap / 2;
            const a1 = innerStart[i] + Math.max(gap / 2 + 0.0001, sweep - gap / 2);
            const isSel = sel === s.key;
            if (sweep >= Math.PI * 2 - 1e-6)
              return <Circle key={s.key} cx={c} cy={c} r={r} stroke={s.color} strokeWidth={stroke} fill="none" onPress={() => select(isSel ? null : s.key)} />;
            return (
              <Path
                key={s.key}
                d={arc(c, c, r, a0, a1)}
                stroke={s.color}
                strokeWidth={isSel ? stroke + 6 : stroke}
                opacity={sel === null || isSel ? 1 : 0.4}
                fill="none"
                onPress={() => select(isSel ? null : s.key)}
              />
            );
          })}
        </G>
        <G>
          {outer.map((s, i) => {
            const sweep = (s.value / outerTotal) * Math.PI * 2;
            const a0 = outerStart[i] + gap / 2;
            const a1 = outerStart[i] + Math.max(gap / 2 + 0.0001, sweep - gap / 2);
            const isSel = sel === s.key;
            if (sweep >= Math.PI * 2 - 1e-6)
              return <Circle key={s.key} cx={c} cy={c} r={rOuter} stroke={s.color} strokeWidth={outerStroke} fill="none" onPress={() => select(isSel ? null : s.key)} />;
            return (
              <Path
                key={s.key}
                d={arc(c, c, rOuter, a0, a1)}
                stroke={s.color}
                strokeWidth={outerStroke}
                opacity={sel === null || isSel ? 0.75 : 0.3}
                fill="none"
                onPress={() => select(isSel ? null : s.key)}
              />
            );
          })}
        </G>
      </Svg>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: stroke + outerStroke + 12, right: stroke + outerStroke + 12, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
      >
        {selected ? (
          <>
            <T variant="caption" secondary numberOfLines={2} align="center">
              {selected.label}
            </T>
            <T variant="headline" numeric align="center">
              {formatShare(selected.value / (outer.includes(selected) ? outerTotal : total))}
            </T>
            <T variant="caption" numeric secondary align="center">
              {formatValue(selected.value)}
            </T>
          </>
        ) : (
          <>
            {centerLabel ? (
              <T variant="caption" secondary align="center">
                {centerLabel}
              </T>
            ) : null}
            {centerValue ? (
              <T variant="headline" numeric align="center" numberOfLines={1} adjustsFontSizeToFit>
                {centerValue}
              </T>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
