// Shared screen pieces

import React from 'react';
import { View } from 'react-native';

import { Loading, Notice, T } from './basic';
import { Computed } from '../hooks';
import { spacing } from '../theme';

export function Pending<T>({ state, children, label }: { state: Computed<T>; children: (value: T) => React.ReactNode; label?: string }) {
  if (state.error) return <Notice kind="error" text={`Fehler bei der Berechnung: ${state.error.message}`} />;
  if (state.value === null) return <View style={{ height: 200 }}><Loading label={label} /></View>;
  return <>{children(state.value)}</>;
}

export function Swatch({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: color }} />;
}

export function Kpi({ label, value, signed, sub }: { label: string; value: string; signed?: number | null; sub?: string }) {
  return (
    <View style={{ gap: 2, flex: 1, minWidth: 140, paddingVertical: spacing.xs }}>
      <T variant="caption" secondary numberOfLines={1}>
        {label}
      </T>
      <T variant="headline" numeric signed={signed} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </T>
      {sub ? (
        <T variant="small" secondary numberOfLines={1}>
          {sub}
        </T>
      ) : null}
    </View>
  );
}
