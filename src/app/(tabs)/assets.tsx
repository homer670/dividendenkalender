import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { today } from '@/core/util/dates';
import { useSettings, updateSettings, settingsStore } from '@/state/settings';
import { Card, ListCard, Row, Screen, Separator, T } from '@/ui/components/basic';
import { Kpi, Pending, Swatch } from '@/ui/components/common';
import { FilterButton } from '@/ui/components/pickers';
import { OptionSheet } from '@/ui/components/Sheet';
import { DonutChart } from '@/ui/charts/DonutChart';
import { allTimeRecords, buildStatement } from '@/ui/calc/statement';
import { formatDate, formatMoney, formatPercent, formatQuote, formatShares } from '@/ui/format';
import { RatesNotice } from '@/ui/components/RatesNotice';
import { useClientFilter, useComputed, useContextOrNull } from '@/ui/hooks';
import { spacing, usePalette } from '@/ui/theme';

export default function AssetsScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  return <Assets />;
}

function Assets() {
  const ctx = useContextOrNull()!;
  const p = usePalette();
  const settings = useSettings();
  const filter = useClientFilter('assets', ctx);
  const taxonomyId = settings.filters['assets.taxonomy'] ?? ctx.client.taxonomies[0]?.id ?? '';
  const taxonomy = ctx.client.taxonomies.find((t) => t.id === taxonomyId) ?? null;
  const [taxonomyOpen, setTaxonomyOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const state = useComputed(() => {
    const date = today();
    const records = ctx.cached(`allTime:${filter.item.id}:${date}`, () => allTimeRecords(filter.client, ctx.converter, date));
    return buildStatement(filter.client, ctx.converter, taxonomy, date, settings.costMethod, records);
  }, [ctx, filter.client, taxonomy, settings.costMethod]);

  const term = ctx.termCurrency;
  return (
    <>
      <Screen>
        <RatesNotice />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m }}>
          <Pressable onPress={() => setTaxonomyOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
            <Ionicons name="layers-outline" size={15} color={p.accent} />
            <T variant="caption" color={p.accent} numberOfLines={1}>
              {taxonomy ? taxonomy.name : 'Keine Klassifizierung'}
            </T>
          </Pressable>
          <FilterButton items={filter.items} selected={filter.item} onSelect={filter.setFilter} />
        </View>
        <Pending state={state}>
          {(st) => (
            <>
              <Card style={{ gap: spacing.m }}>
                <DonutChart
                  slices={st.categories.map((c) => ({ key: c.id, label: c.name, value: Math.max(0, c.valuation.amount), color: c.color }))}
                  centerLabel={`Stand ${formatDate(st.date)}`}
                  centerValue={formatMoney(st.total, term)}
                  formatValue={(v) => formatMoney({ currencyCode: term, amount: v })}
                  formatShare={(s) => formatPercent(s)}
                  selectedKey={selected}
                  onSelect={setSelected}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.s }}>
                  <Kpi label="Gesamtvermögen" value={formatMoney(st.total)} />
                  <Kpi label="Kursgewinn (nicht realisiert)" value={formatMoney(st.gain)} signed={st.gain.amount} />
                  <Kpi label="Einstandswert" value={formatMoney(st.purchaseValue)} />
                  <Kpi label="Veränderung zum Vortag" value={formatMoney(st.dayChangeAmount)} signed={st.dayChangeAmount.amount} />
                </View>
              </Card>
              {st.categories.map((c) => {
                const open = expanded[c.id] ?? true;
                return (
                  <View key={c.id}>
                    <Pressable
                      onPress={() => setExpanded({ ...expanded, [c.id]: !open })}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingHorizontal: 4, paddingVertical: spacing.s }}
                    >
                      <Swatch color={c.color} />
                      <T variant="headline" style={{ flex: 1 }} numberOfLines={1}>
                        {c.name}
                      </T>
                      <View style={{ alignItems: 'flex-end' }}>
                        <T numeric weight="600">
                          {formatMoney(c.valuation, term)}
                        </T>
                        <T variant="caption" secondary numeric>
                          {formatPercent(c.share)}
                        </T>
                      </View>
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={p.textTertiary} />
                    </Pressable>
                    {open ? (
                      <ListCard>
                        {c.positions.map((pos) => (
                          <Row
                            key={pos.key}
                            title={pos.name}
                            subtitle={
                              pos.security
                                ? `${formatShares(pos.shares)} × ${formatQuote(pos.price, pos.currency, term)}`
                                : pos.currency !== term
                                  ? formatQuote(pos.price, pos.currency)
                                  : 'Konto'
                            }
                            value={formatMoney(pos.marketValue, term)}
                            detail={
                              pos.gain && pos.gainPercent !== null
                                ? `${formatMoney(pos.gain, term)} · ${formatPercent(pos.gainPercent)}`
                                : formatPercent(pos.share)
                            }
                            detailSigned={pos.gain ? pos.gain.amount : undefined}
                            onPress={() =>
                              pos.security
                                ? router.push({ pathname: '/security/[id]', params: { id: pos.security.uuid } })
                                : router.push({ pathname: '/account/[id]', params: { id: pos.vehicle.uuid } })
                            }
                          />
                        ))}
                      </ListCard>
                    ) : (
                      <Separator inset={0} />
                    )}
                  </View>
                );
              })}
            </>
          )}
        </Pending>
      </Screen>
      <OptionSheet
        visible={taxonomyOpen}
        onClose={() => setTaxonomyOpen(false)}
        title="Klassifizierung"
        options={[
          ...ctx.client.taxonomies.map((t) => ({ key: t.id, label: t.name })),
          { key: '$none$', label: 'Keine Klassifizierung' },
        ]}
        selected={taxonomy ? taxonomy.id : '$none$'}
        onSelect={(id) => updateSettings({ filters: { ...settingsStore.get().filters, 'assets.taxonomy': id } })}
      />
    </>
  );
}
