// Heatmap table (HeatmapModel of the dashboard)

import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { T } from '../components/basic';
import { usePalette } from '../theme';
import { textOn } from './colorSchema';

export interface HeatmapRow {
  label: string;
  cells: (number | null)[];
}

export function Heatmap({
  columns,
  rows,
  format,
  cellColor,
  cellWidth = 46,
  labelWidth = 40,
}: {
  columns: string[];
  rows: HeatmapRow[];
  format: (v: number) => string;
  /** background color of a cell or null (no coloring) */
  cellColor?: (v: number) => string | null;
  cellWidth?: number;
  labelWidth?: number;
}) {
  const p = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        <View style={styles.row}>
          <View style={{ width: labelWidth }} />
          {columns.map((c, i) => (
            <View key={i} style={[styles.cell, { width: cellWidth, borderColor: 'transparent' }]}>
              <T variant="small" secondary weight="600" numberOfLines={1}>
                {c}
              </T>
            </View>
          ))}
        </View>
        {rows.map((r, ri) => (
          <View key={ri} style={styles.row}>
            <View style={[styles.label, { width: labelWidth }]}>
              <T variant="small" weight="600" numberOfLines={1}>
                {r.label}
              </T>
            </View>
            {r.cells.map((c, ci) => {
              const bg = c !== null && cellColor ? cellColor(c) : null;
              return (
                <View key={ci} style={[styles.cell, { width: cellWidth, backgroundColor: bg ?? 'transparent', borderColor: p.card }]}>
                  {c !== null ? (
                    <T variant="small" numeric numberOfLines={1} adjustsFontSizeToFit color={bg ? textOn(bg) : p.text}>
                      {format(c)}
                    </T>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  label: { justifyContent: 'center', paddingRight: 4, height: 26 },
  cell: { height: 26, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 4, paddingHorizontal: 2 },
});
