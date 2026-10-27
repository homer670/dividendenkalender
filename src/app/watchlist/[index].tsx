import { Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { Card, EmptyState, Screen } from '@/ui/components/basic';
import { SecurityList } from '@/ui/components/securityList';
import { useContextOrNull } from '@/ui/hooks';

export default function WatchlistScreen() {
  const ctx = useContextOrNull();
  const { index } = useLocalSearchParams<{ index: string }>();
  if (!ctx) return null;
  const watchlist = ctx.client.watchlists[Number(index)];
  return (
    <>
      <Stack.Screen options={{ title: watchlist?.name ?? 'Watchlist' }} />
      <Screen>
        {!watchlist || watchlist.securities.length === 0 ? (
          <Card>
            <EmptyState icon="eye-outline" title="Keine Wertpapiere" />
          </Card>
        ) : (
          <SecurityList securities={watchlist.securities} />
        )}
      </Screen>
    </>
  );
}
