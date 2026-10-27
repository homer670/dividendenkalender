import Ionicons from '@expo/vector-icons/Ionicons';
import { Href, router } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { closeFile, pickAndOpenFile, usePortfolio } from '@/state/portfolio';
import { Button, ListCard, Notice, Row, Screen, T } from '@/ui/components/basic';
import { useContextOrNull } from '@/ui/hooks';
import { spacing, usePalette } from '@/ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

export default function MoreScreen() {
  const ctx = useContextOrNull();
  const p = usePalette();
  const file = usePortfolio((s) => s.file);
  const warnings = usePortfolio((s) => s.warnings);
  const ratesError = usePortfolio((s) => s.ratesError);
  const ecb = usePortfolio((s) => s.ecb.length);
  if (!ctx) return null;
  const client = ctx.client;
  const icon = (name: IconName) => <Ionicons name={name} size={22} color={p.accent} />;
  const item = (title: string, name: IconName, href: Href, subtitle?: string) => (
    <Row key={title} left={icon(name)} title={title} subtitle={subtitle} onPress={() => router.push(href)} />
  );
  const needsRates = client.securities.some((s) => s.currencyCode && s.currencyCode !== client.baseCurrency) ||
    client.accounts.some((a) => a.currencyCode !== client.baseCurrency);
  return (
    <Screen>
      <View style={{ gap: 2, paddingHorizontal: 4 }}>
        <T variant="headline" numberOfLines={1}>
          {file?.name ?? 'Portfolio'}
        </T>
        <T variant="caption" secondary>
          Basiswährung {client.baseCurrency} · Version {client.version}
          {client.fileFormat.encrypted ? ' · verschlüsselt' : ''}
        </T>
      </View>
      {needsRates && ecb === 0 ? (
        <Notice
          kind="warning"
          text={`Es sind keine Wechselkurse der EZB verfügbar${ratesError ? ` (${ratesError})` : ''}. Fremdwährungen werden zum Kurs 1 umgerechnet.`}
        />
      ) : null}
      {warnings.length > 0 ? <Notice kind="warning" text={warnings.slice(0, 5).join('\n')} /> : null}
      <ListCard header="Auswertungen">
        {item('Erträge', 'cash-outline', '/earnings', 'Dividenden, Zinsen, Steuern, Gebühren')}
        {item('Dividendenkalender', 'calendar-outline', '/calendar', 'Zahlungen und angekündigte Dividenden')}
        {item('Trades', 'swap-horizontal-outline', '/trades', 'Abgeschlossene und offene Trades')}
      </ListCard>
      <ListCard header="Stammdaten">
        {item('Wertpapiere', 'business-outline', '/securities', `${client.getActiveSecurities().length} aktiv`)}
        {client.watchlists.map((w, i) =>
          item(w.name, 'eye-outline', { pathname: '/watchlist/[index]', params: { index: String(i) } }, `${w.securities.length} Wertpapiere`),
        )}
        {item('Konten', 'wallet-outline', '/accounts', `${client.getActiveAccounts().length} aktiv`)}
        {item('Depots', 'briefcase-outline', '/portfolios', `${client.getActivePortfolios().length} aktiv`)}
        {client.plans.length > 0 ? item('Sparpläne', 'repeat-outline', '/plans', `${client.plans.length} Sparpläne`) : null}
      </ListCard>
      {client.taxonomies.length > 0 ? (
        <ListCard header="Klassifizierungen">
          {client.taxonomies.map((t) => item(t.name, 'git-network-outline', { pathname: '/taxonomy/[id]', params: { id: t.id } }))}
        </ListCard>
      ) : null}
      <ListCard header="App">
        {item('Einstellungen', 'settings-outline', '/settings')}
      </ListCard>
      <View style={{ gap: spacing.s }}>
        <Button title="Datei aktualisieren / andere Datei öffnen" kind="secondary" icon="folder-open-outline" onPress={() => pickAndOpenFile()} />
        <Button title="Datei schliessen" kind="plain" icon="close-circle-outline" onPress={() => closeFile()} />
      </View>
    </Screen>
  );
}
