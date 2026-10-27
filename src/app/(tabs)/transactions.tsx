import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useState } from 'react';
import { SectionList, StyleSheet, TextInput, View } from 'react-native';

import { Card, Chips, EmptyState, Separator } from '@/ui/components/basic';
import { FilterButton } from '@/ui/components/pickers';
import { collectTransactions, groupByMonth, MonthHeader, TransactionRow, TX_CATEGORIES, TxCategory, txCategory, txLabel } from '@/ui/components/transactions';
import { useClientFilter, useContextOrNull } from '@/ui/hooks';
import { radius, spacing, usePalette } from '@/ui/theme';

export default function TransactionsScreen() {
  const ctx = useContextOrNull();
  if (!ctx) return null;
  return <Transactions />;
}

function Transactions() {
  const ctx = useContextOrNull()!;
  const p = usePalette();
  const filter = useClientFilter('transactions', ctx);
  const [category, setCategory] = useState<TxCategory>('all');
  const [query, setQuery] = useState('');
  const all = useMemo(() => collectTransactions(filter.client), [filter.client]);
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = all.filter((e) => {
      if (category !== 'all' && txCategory(e.transaction) !== category) return false;
      if (!q) return true;
      const t = e.transaction;
      return (
        (t.security?.name.toLowerCase().includes(q) ?? false) ||
        (t.security?.isin?.toLowerCase().includes(q) ?? false) ||
        e.owner.name.toLowerCase().includes(q) ||
        txLabel(e).toLowerCase().includes(q) ||
        (t.note?.toLowerCase().includes(q) ?? false)
      );
    });
    return groupByMonth(list);
  }, [all, category, query]);

  return (
    <SectionList
      style={{ backgroundColor: p.background }}
      contentContainerStyle={{ padding: spacing.l, paddingBottom: spacing.xl * 2 }}
      sections={sections}
      keyExtractor={(e) => e.transaction.uuid + e.owner.uuid}
      stickySectionHeadersEnabled={false}
      initialNumToRender={30}
      ListHeaderComponent={
        <View style={{ gap: spacing.s, marginBottom: spacing.s }}>
          <View style={[styles.search, { backgroundColor: p.inputBackground }]}>
            <Ionicons name="search" size={16} color={p.textTertiary} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Suchen"
              placeholderTextColor={p.textTertiary}
              style={{ flex: 1, color: p.text, paddingVertical: 8, fontSize: 15 }}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
          </View>
          <Chips items={TX_CATEGORIES} selected={category} onSelect={setCategory} />
          <FilterButton items={filter.items} selected={filter.item} onSelect={filter.setFilter} />
        </View>
      }
      renderSectionHeader={({ section }) => <MonthHeader title={section.title} />}
      renderItem={({ item, index, section }) => (
        <View
          style={{
            backgroundColor: p.card,
            borderTopLeftRadius: index === 0 ? radius.m : 0,
            borderTopRightRadius: index === 0 ? radius.m : 0,
            borderBottomLeftRadius: index === section.data.length - 1 ? radius.m : 0,
            borderBottomRightRadius: index === section.data.length - 1 ? radius.m : 0,
            overflow: 'hidden',
          }}
        >
          {index > 0 ? <Separator /> : null}
          <TransactionRow entry={item} />
        </View>
      )}
      ListEmptyComponent={
        <Card>
          <EmptyState icon="list-outline" title="Keine Buchungen" message="Für die gewählte Auswahl gibt es keine Buchungen." />
        </Card>
      }
    />
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, borderRadius: radius.s, paddingHorizontal: spacing.m },
});
