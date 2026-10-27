// Reporting period and client filter selection

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ReportingPeriod } from '../../core/snapshot/reportingPeriod';
import { today, year } from '../../core/util/dates';
import { ClientFilterItem } from '../../state/clientFilters';
import { formatDate } from '../format';
import { spacing, usePalette } from '../theme';
import { Chips, T } from './basic';
import { OptionSheet, SheetOption } from './Sheet';

function presetCodes(): { code: string; section: string }[] {
  const y = year(today());
  const out: { code: string; section: string }[] = [];
  for (const c of ['W', 'M', 'Q', 'X']) out.push({ code: c, section: 'Aktuell' });
  for (const c of ['P', 'E', 'A', 'B', 'C', 'Z']) out.push({ code: c, section: 'Vorperiode' });
  for (const c of ['D7', 'D30', 'D90', 'T20', 'L0Y6', 'L1Y0', 'L2Y0', 'L3Y0', 'L5Y0', 'L10Y0', 'L20Y0'])
    out.push({ code: c, section: 'Letzte' });
  for (let i = 0; i < 10; i++) out.push({ code: `Y${y - i}`, section: 'Kalenderjahr' });
  return out;
}

export function PeriodChips({
  periods,
  selected,
  onSelect,
}: {
  periods: ReportingPeriod[];
  selected: ReportingPeriod;
  onSelect: (p: ReportingPeriod) => void;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const items = periods.map((x) => ({ key: x.getCode(), label: x.toString() }));
  const options: SheetOption<string>[] = [
    ...periods.map((x) => ({ key: x.getCode(), label: x.toString(), section: 'Aus der Datei' })),
    ...presetCodes()
      .filter((c) => !periods.some((x) => x.getCode() === c.code))
      .map((c) => {
        const period = ReportingPeriod.from(c.code);
        const iv = period.toInterval(today());
        return { key: c.code, label: period.toString(), subtitle: `${formatDate(iv.start + 1)} – ${formatDate(iv.end)}`, section: c.section };
      }),
  ];
  const lookup = (code: string) => periods.find((x) => x.getCode() === code) ?? ReportingPeriod.from(code);
  return (
    <View>
      <Chips
        items={items}
        selected={selected.getCode()}
        onSelect={(code) => onSelect(lookup(code))}
        trailing={
          <Pressable
            onPress={() => setOpen(true)}
            style={[styles.more, { borderColor: p.border, backgroundColor: p.card }]}
            accessibilityLabel="Weitere Zeiträume"
          >
            <Ionicons name="calendar-outline" size={15} color={p.accent} />
          </Pressable>
        }
      />
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Berichtszeitraum"
        options={options}
        selected={selected.getCode()}
        onSelect={(code) => onSelect(lookup(code))}
      />
    </View>
  );
}

export function FilterButton({
  items,
  selected,
  onSelect,
}: {
  items: ClientFilterItem[];
  selected: ClientFilterItem;
  onSelect: (id: string) => void;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  if (items.length <= 1) return null;
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={styles.filter} accessibilityLabel="Filter">
        <Ionicons name={selected.id === '' ? 'funnel-outline' : 'funnel'} size={15} color={p.accent} />
        <T variant="caption" color={p.accent} numberOfLines={1} style={{ flexShrink: 1 }}>
          {selected.label}
        </T>
      </Pressable>
      <OptionSheet
        visible={open}
        onClose={() => setOpen(false)}
        title="Filter"
        options={items.map((i) => ({ key: i.id, label: i.label, section: i.custom ? 'Eigene Filter' : 'Standard' }))}
        selected={selected.id}
        onSelect={onSelect}
      />
    </>
  );
}

const styles = StyleSheet.create({
  more: {
    paddingHorizontal: spacing.m,
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filter: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, maxWidth: 260 },
});
