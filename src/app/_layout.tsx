import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { initialize, lockFile, usePortfolio } from '@/state/portfolio';
import { settingsStore } from '@/state/settings';
import { usePalette } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const p = usePalette();
  const status = usePortfolio((s) => s.status);
  const ready = status === 'ready';

  useEffect(() => {
    initialize().finally(() => SplashScreen.hideAsync().catch(() => undefined));
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' && settingsStore.get().lockOnBackground) lockFile();
    });
    return () => sub.remove();
  }, []);

  const base = p.dark ? DarkTheme : DefaultTheme;
  const theme = {
    ...base,
    colors: { ...base.colors, primary: p.accent, background: p.background, card: p.card, text: p.text, border: p.separator },
  };

  return (
    <SafeAreaProvider>
      <ThemeProvider value={theme}>
        <StatusBar style={p.dark ? 'light' : 'dark'} />
        <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal', contentStyle: { backgroundColor: p.background } }}>
          <Stack.Protected guard={!ready}>
            <Stack.Screen name="welcome" options={{ headerShown: false }} />
          </Stack.Protected>
          <Stack.Protected guard={ready}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Übersicht' }} />
            <Stack.Screen name="security/[id]" options={{ title: 'Wertpapier' }} />
            <Stack.Screen name="account/[id]" options={{ title: 'Konto' }} />
            <Stack.Screen name="portfolio/[id]" options={{ title: 'Depot' }} />
            <Stack.Screen name="taxonomy/[id]" options={{ title: 'Klassifizierung' }} />
            <Stack.Screen name="watchlist/[index]" options={{ title: 'Watchlist' }} />
            <Stack.Screen name="securities" options={{ title: 'Wertpapiere' }} />
            <Stack.Screen name="accounts" options={{ title: 'Konten' }} />
            <Stack.Screen name="portfolios" options={{ title: 'Depots' }} />
            <Stack.Screen name="earnings" options={{ title: 'Erträge' }} />
            <Stack.Screen name="calendar" options={{ title: 'Dividendenkalender' }} />
            <Stack.Screen name="trades" options={{ title: 'Trades' }} />
            <Stack.Screen name="plans" options={{ title: 'Sparpläne' }} />
            <Stack.Screen name="dashboard-edit" options={{ title: 'Dashboard bearbeiten', presentation: 'modal' }} />
            <Stack.Screen name="widget-edit" options={{ title: 'Widget', presentation: 'modal' }} />
          </Stack.Protected>
          <Stack.Screen name="settings" options={{ title: 'Einstellungen' }} />
        </Stack>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
