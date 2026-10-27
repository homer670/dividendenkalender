// Visual frame of dashboard widgets

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Computed } from '../hooks';
import { T } from '../components/basic';
import { radius, spacing, usePalette } from '../theme';

export function WidgetCard({
  title,
  subtitle,
  children,
  onPress,
  compact,
}: {
  title?: string;
  subtitle?: string;
  children?: ReactNode;
  onPress?: () => void;
  compact?: boolean;
}) {
  const p = usePalette();
  const content = (
    <View style={[styles.card, { backgroundColor: p.card }, compact ? styles.compact : null]}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <T variant="caption" secondary numberOfLines={2} style={{ flex: 1 }}>
            {title}
          </T>
          {onPress ? <Ionicons name="chevron-forward" size={13} color={p.textTertiary} /> : null}
        </View>
      ) : null}
      {children}
      {subtitle ? (
        <T variant="small" tertiary numberOfLines={1}>
          {subtitle}
        </T>
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
      {content}
    </Pressable>
  );
}

/** IndicatorWidget: label and a KPI value */
export function KpiCard({
  title,
  value,
  color,
  subtitle,
  info,
  loading,
  onPress,
}: {
  title: string;
  value: string;
  color?: string;
  subtitle?: string;
  info?: string | null;
  loading?: boolean;
  onPress?: () => void;
}) {
  const p = usePalette();
  const [showInfo, setShowInfo] = useState(false);
  return (
    <WidgetCard title={title} subtitle={subtitle} compact onPress={onPress ?? (info ? () => setShowInfo(!showInfo) : undefined)}>
      {loading ? (
        <ActivityIndicator color={p.textTertiary} style={{ alignSelf: 'flex-start', marginVertical: 6 }} />
      ) : (
        <T variant="kpi" color={color ?? p.text} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </T>
      )}
      {showInfo && info ? (
        <T variant="small" secondary>
          {info}
        </T>
      ) : null}
    </WidgetCard>
  );
}

export function WidgetBody<V>({ state, children, height = 80 }: { state: Computed<V>; children: (v: V) => ReactNode; height?: number }) {
  const p = usePalette();
  if (state.error)
    return (
      <T variant="caption" color={p.negative}>
        {state.error.message}
      </T>
    );
  if (state.value === null)
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={p.textTertiary} />
      </View>
    );
  return <>{children(state.value)}</>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.m, padding: spacing.m + 2, gap: spacing.xs },
  compact: { minHeight: 84, justifyContent: 'space-between' },
});
