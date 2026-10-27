import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Dashboard } from '@/core/model';
import { ReportingPeriod } from '@/core/snapshot/reportingPeriod';
import { cloneDashboard, deleteMobileDashboard, moveMobileDashboard, saveMobileDashboard, useMobileDashboards } from '@/state/dashboards';
import { Button, Card, EmptyState, Screen, SectionHeader, Separator, T } from '@/ui/components/basic';
import { OptionSheet } from '@/ui/components/Sheet';
import { useContextOrNull } from '@/ui/hooks';
import { radius, spacing, usePalette } from '@/ui/theme';
import { newWidget, WIDGET_GROUPS, WIDGET_LIST, widgetSpec } from '@/ui/widgets/registry';

export default function DashboardEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ctx = useContextOrNull();
  const { mobile } = useMobileDashboards();
  const dashboard = mobile.find((d) => d.id === id);
  if (!ctx || !dashboard)
    return (
      <Screen>
        <EmptyState title="Dashboard nicht gefunden" />
      </Screen>
    );
  return <Editor dashboard={dashboard} />;
}

function Editor({ dashboard }: { dashboard: Dashboard }) {
  const ctx = useContextOrNull()!;
  const p = usePalette();
  const [name, setName] = useState(dashboard.name);
  const [addTo, setAddTo] = useState<number | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);

  const save = (mutate: (d: Dashboard) => void) => {
    const d = cloneDashboard(dashboard, dashboard.name);
    d.id = dashboard.id;
    mutate(d);
    saveMobileDashboard(d);
  };

  const move = (ci: number, wi: number, delta: number) =>
    save((d) => {
      const col = d.columns[ci];
      const [w] = col.widgets.splice(wi, 1);
      let target = wi + delta;
      if (target < 0 && ci > 0) d.columns[ci - 1].widgets.push(w);
      else if (target > col.widgets.length && ci < d.columns.length - 1) d.columns[ci + 1].widgets.unshift(w);
      else {
        target = Math.max(0, Math.min(col.widgets.length, target));
        col.widgets.splice(target, 0, w);
      }
    });

  const confirmDelete = () => {
    const doDelete = () => {
      deleteMobileDashboard(dashboard.id);
      router.back();
    };
    if (Platform.OS === 'web') doDelete();
    else
      Alert.alert('Dashboard löschen', `„${dashboard.name}“ wirklich löschen?`, [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Löschen', style: 'destructive', onPress: doDelete },
      ]);
  };

  const periods = ctx.reportingPeriods();
  const code = dashboard.configuration.REPORTING_PERIOD;
  const current = code ? ReportingPeriod.tryFrom(code) : null;

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Dashboard bearbeiten',
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={10} style={{ paddingHorizontal: spacing.s }}>
              <T weight="600" color={p.accent}>
                Fertig
              </T>
            </Pressable>
          ),
        }}
      />
      <Screen>
        <Card style={{ gap: spacing.s }}>
          <T variant="caption" secondary>
            Name
          </T>
          <TextInput
            value={name}
            onChangeText={setName}
            onEndEditing={() => name.trim() && save((d) => (d.name = name.trim()))}
            onBlur={() => name.trim() && save((d) => (d.name = name.trim()))}
            style={[styles.input, { backgroundColor: p.inputBackground, color: p.text }]}
          />
          <Pressable onPress={() => setPeriodOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
            <T style={{ flex: 1 }}>Standard-Berichtszeitraum</T>
            <T color={p.accent}>{current ? current.toString() : periods[0].toString()}</T>
          </Pressable>
          <View style={{ flexDirection: 'row', gap: spacing.s }}>
            <Button small kind="secondary" icon="arrow-up" title="Nach vorne" onPress={() => moveMobileDashboard(dashboard.id, -1)} />
            <Button small kind="secondary" icon="arrow-down" title="Nach hinten" onPress={() => moveMobileDashboard(dashboard.id, 1)} />
          </View>
        </Card>

        {dashboard.columns.map((column, ci) => (
          <View key={ci}>
            <SectionHeader
              title={dashboard.columns.length > 1 ? `Spalte ${ci + 1}` : 'Widgets'}
              right={
                column.widgets.length === 0 && dashboard.columns.length > 1 ? (
                  <Pressable onPress={() => save((d) => d.columns.splice(ci, 1))} hitSlop={8}>
                    <T variant="caption" color={p.negative}>
                      Spalte entfernen
                    </T>
                  </Pressable>
                ) : undefined
              }
            />
            <Card padded={false}>
              {column.widgets.map((w, wi) => {
                const spec = widgetSpec(w.type);
                return (
                  <View key={wi}>
                    {wi > 0 ? <Separator /> : null}
                    <View style={styles.row}>
                      <Pressable
                        style={{ flex: 1 }}
                        onPress={() => router.push({ pathname: '/widget-edit', params: { dashboard: dashboard.id, column: String(ci), index: String(wi) } })}
                      >
                        <T numberOfLines={1}>{w.label || spec?.label || w.type}</T>
                        <T variant="small" secondary numberOfLines={1}>
                          {spec ? `${spec.group} · ${spec.label}` : `${w.type} (nicht unterstützt)`}
                        </T>
                      </Pressable>
                      <Pressable onPress={() => move(ci, wi, -1)} hitSlop={6} accessibilityLabel="Nach oben">
                        <Ionicons name="chevron-up" size={20} color={p.textSecondary} />
                      </Pressable>
                      <Pressable onPress={() => move(ci, wi, 1)} hitSlop={6} accessibilityLabel="Nach unten">
                        <Ionicons name="chevron-down" size={20} color={p.textSecondary} />
                      </Pressable>
                      <Pressable onPress={() => save((d) => d.columns[ci].widgets.splice(wi, 1))} hitSlop={6} accessibilityLabel="Entfernen">
                        <Ionicons name="trash-outline" size={19} color={p.negative} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
              {column.widgets.length > 0 ? <Separator inset={0} /> : null}
              <Pressable onPress={() => setAddTo(ci)} style={[styles.row, { justifyContent: 'center' }]}>
                <Ionicons name="add-circle-outline" size={20} color={p.accent} />
                <T color={p.accent} weight="600">
                  Widget hinzufügen
                </T>
              </Pressable>
            </Card>
          </View>
        ))}
        <View style={{ gap: spacing.s }}>
          <Button title="Spalte hinzufügen" kind="secondary" icon="add" onPress={() => save((d) => d.columns.push({ weight: 1, widgets: [] }))} />
          <Button title="Dashboard löschen" kind="destructive" icon="trash-outline" onPress={confirmDelete} />
        </View>
      </Screen>
      <OptionSheet
        visible={addTo !== null}
        onClose={() => setAddTo(null)}
        title="Widget hinzufügen"
        options={WIDGET_GROUPS.flatMap((g) => WIDGET_LIST.filter((w) => w.group === g).map((w) => ({ key: w.type, label: w.label, section: g })))}
        selected={null}
        onSelect={(type) => {
          const ci = addTo ?? 0;
          save((d) => {
            if (d.columns.length === 0) d.columns.push({ weight: 1, widgets: [] });
            d.columns[Math.min(ci, d.columns.length - 1)].widgets.push(newWidget(type));
          });
        }}
      />
      <OptionSheet
        visible={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title="Standard-Berichtszeitraum"
        options={periods.map((x) => ({ key: x.getCode(), label: x.toString() }))}
        selected={current ? current.getCode() : null}
        onSelect={(c) => save((d) => (d.configuration.REPORTING_PERIOD = c))}
      />
    </>
  );
}

const styles = StyleSheet.create({
  input: { borderRadius: radius.s, paddingHorizontal: spacing.m, paddingVertical: spacing.s + 2, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.m, paddingHorizontal: spacing.l, paddingVertical: spacing.m, minHeight: 52 },
});
