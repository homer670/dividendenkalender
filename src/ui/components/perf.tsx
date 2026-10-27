// Performance calculation table (ClientPerformanceSnapshot), used by the performance view and the dashboard

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ClientPerformanceSnapshot, PerformanceCategory } from '../../core/snapshot/clientPerformanceSnapshot';
import { money, MutableMoney } from '../../core/money/money';
import { formatDate, formatMoney } from '../format';
import { msg } from '../i18n';
import { spacing, usePalette } from '../theme';
import { Separator, T } from './basic';

export type CalculationLayout = 'FULL' | 'REDUCED' | 'RELEVANT';

interface Line {
  sign: string;
  label: string;
  amount: number;
  category: PerformanceCategory | null;
  emphasis?: boolean;
}

function sumSigned(categories: PerformanceCategory[], currency: string): number {
  const total = MutableMoney.of(currency);
  for (const c of categories) {
    if (c.sign === '+') total.add(c.valuation);
    else if (c.sign === '-') total.subtract(c.valuation);
  }
  return total.amount;
}

export function calculationLines(snapshot: ClientPerformanceSnapshot, layout: CalculationLayout): Line[] {
  const categories = snapshot.getCategories();
  const currency = snapshot.getValue('INITIAL_VALUE').currencyCode;
  const line = (c: PerformanceCategory, emphasis = false): Line => ({ sign: c.sign, label: c.label, amount: c.valuation.amount, category: c, emphasis });
  switch (layout) {
    case 'FULL':
      return categories.map((c, i) => line(c, i === 0 || i === categories.length - 1));
    case 'REDUCED': {
      const misc = sumSigned(categories.slice(3, categories.length - 2), currency);
      return [
        line(categories[0], true),
        line(categories[1]),
        line(categories[2]),
        { sign: '+', label: msg('LabelCategoryOtherMovements'), amount: misc, category: null },
        line(categories[categories.length - 2]),
        line(categories[categories.length - 1], true),
      ];
    }
    case 'RELEVANT': {
      const relevant = categories.slice(1, 7);
      return [
        { sign: '', label: msg('PerformanceRelevantTransactionsHeader', formatDate(snapshot.snapshotStart.date)), amount: NaN, category: null, emphasis: true },
        ...relevant.map((c) => line(c)),
        {
          sign: '=',
          label: msg('PerformanceRelevantTransactionsFooter', formatDate(snapshot.snapshotEnd.date)),
          amount: sumSigned(relevant, currency),
          category: null,
          emphasis: true,
        },
      ];
    }
  }
}

export function CalculationTable({
  snapshot,
  layout = 'FULL',
  expandable = true,
}: {
  snapshot: ClientPerformanceSnapshot;
  layout?: CalculationLayout;
  expandable?: boolean;
}) {
  const p = usePalette();
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const currency = snapshot.converter.termCurrency;
  const lines = calculationLines(snapshot, layout);
  return (
    <View>
      {lines.map((l, i) => {
        const canExpand = expandable && l.category !== null && l.category.positions.length > 0;
        const isOpen = !!open[i];
        return (
          <View key={i}>
            {l.emphasis && i > 0 ? <Separator inset={0} /> : null}
            <Pressable disabled={!canExpand} onPress={() => setOpen({ ...open, [i]: !isOpen })} style={styles.line}>
              <T secondary style={styles.sign} weight={l.emphasis ? '600' : '400'}>
                {l.sign}
              </T>
              <T style={{ flex: 1 }} weight={l.emphasis ? '600' : '400'} numberOfLines={2}>
                {l.label}
              </T>
              {Number.isFinite(l.amount) ? (
                <T numeric weight={l.emphasis ? '600' : '400'}>
                  {formatMoney(money(currency, l.amount), currency)}
                </T>
              ) : null}
              {canExpand ? (
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={p.textTertiary} />
              ) : expandable ? (
                <View style={{ width: 14 }} />
              ) : null}
            </Pressable>
            {isOpen && l.category ? (
              <View style={{ paddingLeft: 26, paddingBottom: spacing.s }}>
                {l.category.positions.map((pos, k) => (
                  <Pressable
                    key={k}
                    disabled={!pos.security}
                    onPress={() => pos.security && router.push({ pathname: '/security/[id]', params: { id: pos.security.uuid } })}
                    style={styles.position}
                  >
                    <T variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                      {pos.label}
                    </T>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T variant="caption" numeric>
                        {formatMoney(pos.value, currency)}
                      </T>
                      {pos.forexGain && pos.forexGain.amount !== 0 ? (
                        <T variant="small" secondary numeric>
                          davon Währung {formatMoney(pos.forexGain, currency)}
                        </T>
                      ) : null}
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingVertical: 7 },
  sign: { width: 18, textAlign: 'center' },
  position: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingVertical: 4, paddingRight: 22 },
});
