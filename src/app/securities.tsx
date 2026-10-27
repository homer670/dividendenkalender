import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Card, EmptyState, Screen, Segmented } from '@/ui/components/basic';
import { SecurityList } from '@/ui/components/securityList';
import { useContextOrNull } from '@/ui/hooks';
import { radius, spacing, usePalette } from '@/ui/theme';

type Mode = 'active' | 'all' | 'retired';

export default function SecuritiesScreen() {
  const ctx = useContextOrNull();
  const p = usePalette();
  const [mode, setMode] = useState<Mode>('active');
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    if (!ctx) return [];
    const q = query.trim().toLowerCase();
    return ctx.client.securities.filter((s) => {
      if (mode === 'active' && s.isRetired) return false;
      if (mode === 'retired' && !s.isRetired) return false;
      if (!q) return true;
      return [s.name, s.isin, s.wkn, s.tickerSymbol].some((x) => x?.toLowerCase().includes(q));
    });
  }, [ctx, mode, query]);
  if (!ctx) return null;
  return (
    <Screen>
      <View style={[styles.search, { backgroundColor: p.inputBackground }]}>
        <Ionicons name="search" size={16} color={p.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Name, ISIN, WKN, Symbol"
          placeholderTextColor={p.textTertiary}
          style={{ flex: 1, color: p.text, paddingVertical: 8, fontSize: 15 }}
          autoCorrect={false}
        />
      </View>
      <Segmented
        items={[
          { key: 'active', label: 'Aktiv' },
          { key: 'all', label: 'Alle' },
          { key: 'retired', label: 'Inaktiv' },
        ]}
        selected={mode}
        onSelect={setMode}
      />
      {list.length === 0 ? (
        <Card>
          <EmptyState icon="business-outline" title="Keine Wertpapiere" />
        </Card>
      ) : (
        <SecurityList securities={list} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.s, borderRadius: radius.s, paddingHorizontal: spacing.m },
});
