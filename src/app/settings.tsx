import React from 'react';
import { Platform, Switch, View } from 'react-native';

import { recreateContext, refreshExchangeRates, usePortfolio } from '@/state/portfolio';
import { ThemePreference, updateSettings, useSettings } from '@/state/settings';
import { Button, ListCard, Row, Screen, Segmented, T } from '@/ui/components/basic';
import { formatDateTime, formatNumber, formatMoney } from '@/ui/format';
import { spacing } from '@/ui/theme';

function toggle(value: boolean, onChange: (v: boolean) => void) {
  return <Switch value={value} onValueChange={onChange} />;
}

export default function SettingsScreen() {
  const s = useSettings();
  const ratesAt = usePortfolio((x) => x.ratesDownloadedAt);
  const ratesLoading = usePortfolio((x) => x.ratesLoading);
  const ratesError = usePortfolio((x) => x.ratesError);
  const ecbCount = usePortfolio((x) => x.ecb.length);
  const set = (patch: Parameters<typeof updateSettings>[0], recalc = false) => {
    updateSettings(patch);
    if (recalc) recreateContext();
  };
  return (
    <Screen>
      <View style={{ gap: spacing.s }}>
        <T variant="label" secondary>
          Darstellung
        </T>
        <Segmented<ThemePreference>
          items={[
            { key: 'system', label: 'System' },
            { key: 'light', label: 'Hell' },
            { key: 'dark', label: 'Dunkel' },
          ]}
          selected={s.theme}
          onSelect={(theme) => set({ theme })}
        />
      </View>
      <View style={{ gap: spacing.s }}>
        <T variant="label" secondary>
          Zahlenformat
        </T>
        <Segmented
          items={[
            { key: 'de-DE', label: 'Deutschland (1.234,56)' },
            { key: 'de-CH', label: 'Schweiz (1’234.56)' },
          ]}
          selected={s.numberLocale}
          onSelect={(numberLocale) => set({ numberLocale }, true)}
        />
        <T variant="caption" secondary>
          Beispiel: {formatMoney({ currencyCode: 'EUR', amount: 123456789 })} · {formatNumber(0.1234 * 100, 2)}%
        </T>
      </View>
      <View style={{ gap: spacing.s }}>
        <T variant="label" secondary>
          Berechnung des Einstandswerts
        </T>
        <Segmented
          items={[
            { key: 'FIFO', label: 'FIFO' },
            { key: 'MOVING_AVERAGE', label: 'Gleitender Durchschnitt' },
          ]}
          selected={s.costMethod}
          onSelect={(costMethod) => set({ costMethod })}
        />
      </View>
      <ListCard header="Datenschutz">
        <Row title="Diskreter Modus" subtitle="Beträge werden ausgeblendet" value={toggle(s.discreet, (discreet) => set({ discreet }, true))} />
        {Platform.OS !== 'web' ? (
          <Row
            title="Datei sperren"
            subtitle="Verschlüsselte Dateien sperren, wenn die App verlassen wird"
            value={toggle(s.lockOnBackground, (lockOnBackground) => set({ lockOnBackground }))}
          />
        ) : null}
        {Platform.OS !== 'web' ? (
          <Row
            title="Face ID / Fingerabdruck"
            subtitle="Gespeichertes Passwort per Biometrie freigeben"
            value={toggle(s.useBiometrics, (useBiometrics) => set({ useBiometrics }))}
          />
        ) : null}
      </ListCard>
      <ListCard header="Wechselkurse">
        <Row
          title="Wechselkurse der EZB laden"
          subtitle="Referenzkurse der Europäischen Zentralbank"
          value={toggle(s.downloadExchangeRates, (downloadExchangeRates) => set({ downloadExchangeRates }))}
        />
        <Row
          title="Stand"
          subtitle={
            ratesError
              ? `Fehler: ${ratesError}`
              : `${ecbCount} Währungen${ratesAt ? ` · geladen ${formatDateTime(Math.floor(ratesAt / 1000) - new Date(ratesAt).getTimezoneOffset() * 60)}` : ''}`
          }
          value={
            <Button small kind="secondary" title={ratesLoading ? 'Lädt …' : 'Aktualisieren'} disabled={ratesLoading || !s.downloadExchangeRates} onPress={() => refreshExchangeRates(true)} />
          }
        />
      </ListCard>
      <View style={{ gap: spacing.xs, paddingHorizontal: 4 }}>
        <T variant="caption" secondary>
          Alle Daten bleiben auf dem Gerät. Die Berechnungen folgen den Methoden von Portfolio Performance (www.portfolio-performance.info,
          Eclipse Public License).
        </T>
      </View>
    </Screen>
  );
}
