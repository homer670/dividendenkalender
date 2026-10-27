import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';

import { money } from '@/core/money/money';
import { today } from '@/core/util/dates';
import { Card, EmptyState, Screen, Segmented, Separator, T } from '@/ui/components/basic';
import { Pending, Swatch } from '@/ui/components/common';
import { FilterButton } from '@/ui/components/pickers';
import { DonutChart } from '@/ui/charts/DonutChart';
import { buildTaxonomyModel, isSecurityNode, TaxonomyNode } from '@/ui/calc/taxonomy';
import { formatMoney, formatPercent } from '@/ui/format';
import { useClientFilter, useComputed, useContextOrNull } from '@/ui/hooks';
import { spacing, usePalette } from '@/ui/theme';

type Mode = 'definition' | 'rebalancing';

export default function TaxonomyScreen() {
  const ctx = useContextOrNull();
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!ctx) return null;
  const taxonomy = ctx.client.taxonomies.find((t) => t.id === id);
  if (!taxonomy)
    return (
      <Screen>
        <EmptyState title="Klassifizierung nicht gefunden" />
      </Screen>
    );
  return <TaxonomyDetail id={taxonomy.id} />;
}

function TaxonomyDetail({ id }: { id: string }) {
  const ctx = useContextOrNull()!;
  const taxonomy = ctx.client.taxonomies.find((t) => t.id === id)!;
  const filter = useClientFilter('taxonomy', ctx);
  const [mode, setMode] = useState<Mode>('definition');
  const state = useComputed(() => buildTaxonomyModel(filter.client, ctx.converter, taxonomy, today()), [ctx, filter.client, taxonomy]);
  const term = ctx.termCurrency;
  return (
    <>
      <Stack.Screen options={{ title: taxonomy.name }} />
      <Screen>
        <FilterButton items={filter.items} selected={filter.item} onSelect={filter.setFilter} />
        <Segmented
          items={[
            { key: 'definition', label: 'Struktur' },
            { key: 'rebalancing', label: 'Rebalancing' },
          ]}
          selected={mode}
          onSelect={setMode}
        />
        <Pending state={state}>
          {(model) => {
            const top = model.classificationRoot.children.filter((c) => c.classification);
            const slices = [...top, ...(model.unassigned.actual !== 0 ? [model.unassigned] : [])].map((n) => ({
              key: n.key,
              label: n.name,
              value: Math.max(0, n.actual),
              color: n.color,
            }));
            return (
              <>
                <Card>
                  <DonutChart
                    slices={slices}
                    centerLabel={taxonomy.name}
                    centerValue={formatMoney(money(term, model.total), term)}
                    formatValue={(v) => formatMoney(money(term, v))}
                    formatShare={(s) => formatPercent(s)}
                  />
                </Card>
                <Card padded={false}>
                  {model.classificationRoot.children.map((n, i) => (
                    <View key={n.key}>
                      {i > 0 ? <Separator inset={0} /> : null}
                      <NodeRow node={n} depth={0} total={model.total} mode={mode} currency={term} />
                    </View>
                  ))}
                  {model.unassigned.children.length > 0 && model.unassigned.actual !== 0 ? (
                    <View>
                      <Separator inset={0} />
                      <NodeRow node={model.unassigned} depth={0} total={model.total} mode="definition" currency={term} />
                    </View>
                  ) : null}
                </Card>
              </>
            );
          }}
        </Pending>
      </Screen>
    </>
  );
}

function NodeRow({ node, depth, total, mode, currency }: { node: TaxonomyNode; depth: number; total: number; mode: Mode; currency: string }) {
  const p = usePalette();
  const [open, setOpen] = useState(depth < 1 && node.children.some((c) => c.classification));
  const isLeaf = node.assignment !== null;
  const hasChildren = node.children.length > 0;
  const share = total !== 0 ? node.actual / total : 0;
  const parentActual = node.parent?.actual ?? 0;
  const delta = node.target !== null ? node.actual - node.target : null;
  if (isLeaf && node.actual === 0 && mode === 'rebalancing') return null;
  return (
    <View>
      <Pressable
        disabled={!hasChildren && !isLeaf}
        onPress={() => {
          if (isLeaf) {
            if (node.vehicle && isSecurityNode(node)) router.push({ pathname: '/security/[id]', params: { id: node.vehicle.uuid } });
            else if (node.vehicle) router.push({ pathname: '/account/[id]', params: { id: node.vehicle.uuid } });
          } else setOpen(!open);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s, paddingVertical: 10, paddingRight: spacing.l, paddingLeft: spacing.l + depth * 14 }}
      >
        {isLeaf ? (
          <Ionicons name="document-outline" size={14} color={p.textTertiary} />
        ) : (
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={hasChildren ? p.textSecondary : 'transparent'} />
        )}
        {!isLeaf ? <Swatch color={node.color} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <T numberOfLines={1} weight={isLeaf ? '400' : '600'} variant={isLeaf ? 'caption' : 'body'}>
            {node.name}
          </T>
          <T variant="small" secondary numberOfLines={1}>
            {mode === 'definition' || isLeaf
              ? `${formatPercent(share)} vom Gesamtwert${node.weight !== 10000 ? ` · Gewicht ${formatPercent(node.weight / 10000)}` : ''}`
              : `Soll ${formatPercent(node.weight / 10000)} · Ist ${formatPercent(parentActual ? node.actual / parentActual : 0)}`}
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <T numeric variant={isLeaf ? 'caption' : 'body'}>
            {formatMoney(money(currency, node.actual), currency)}
          </T>
          {mode === 'rebalancing' && !isLeaf && delta !== null ? (
            <T variant="small" numeric signed={-delta}>
              {delta > 0 ? 'Überhang ' : 'Fehlbetrag '}
              {formatMoney(money(currency, Math.abs(delta)), currency)}
            </T>
          ) : null}
        </View>
      </Pressable>
      {open
        ? node.children.map((c) => <NodeRow key={c.key} node={c} depth={depth + 1} total={total} mode={mode} currency={currency} />)
        : null}
    </View>
  );
}
