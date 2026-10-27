// Common widgets: Heading, Description, VerticalSpacer, CollapsibleSection, Website

import Ionicons from '@expo/vector-icons/Ionicons';
import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { Pressable, View } from 'react-native';

import { T } from '../components/basic';
import { spacing, usePalette } from '../theme';
import { cfg } from './env';
import { WidgetCard } from './frame';
import { WidgetProps } from './special';

export function HeadingWidget({ widget }: WidgetProps) {
  return (
    <View style={{ paddingHorizontal: 4, paddingTop: spacing.m, paddingBottom: 2 }}>
      <T variant="headline">{widget.label}</T>
    </View>
  );
}

export function DescriptionWidget({ widget }: WidgetProps) {
  return (
    <WidgetCard>
      <T variant="caption" secondary>
        {widget.label}
      </T>
    </WidgetCard>
  );
}

export function VerticalSpacerWidget({ widget }: WidgetProps) {
  const h = Number.parseInt(cfg(widget, 'HEIGHT') ?? '', 10);
  return <View style={{ height: Number.isFinite(h) && h >= 5 ? h : 20 }} />;
}

export function CollapsibleSectionWidget({ widget, collapsed, onToggle }: WidgetProps & { collapsed: boolean; onToggle: () => void }) {
  const p = usePalette();
  return (
    <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: spacing.m, paddingHorizontal: 4 }}>
      <Ionicons name={collapsed ? 'caret-forward' : 'caret-down'} size={14} color={p.accent} />
      <T variant="headline" color={p.accent} style={{ flex: 1 }}>
        {widget.label}
      </T>
    </Pressable>
  );
}

export function WebsiteWidget({ widget }: WidgetProps) {
  const p = usePalette();
  const url = cfg(widget, 'URL');
  return (
    <WidgetCard title={widget.label} onPress={url ? () => WebBrowser.openBrowserAsync(url).catch(() => undefined) : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="globe-outline" size={16} color={p.accent} />
        <T variant="caption" color={p.accent} numberOfLines={1} style={{ flex: 1 }}>
          {url ?? 'Keine URL konfiguriert'}
        </T>
      </View>
    </WidgetCard>
  );
}
