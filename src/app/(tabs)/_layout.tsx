import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/tabs';
import React from 'react';
import { ColorValue } from 'react-native';

import { usePalette } from '@/ui/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function icon(name: IconName) {
  // eslint-disable-next-line react/display-name
  return ({ color, size }: { color: ColorValue; size: number }) => <Ionicons name={name} color={color as string} size={size} />;
}

export default function TabsLayout() {
  const p = usePalette();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: p.accent,
        tabBarInactiveTintColor: p.textTertiary,
        tabBarStyle: { backgroundColor: p.card, borderTopColor: p.separator },
        headerStyle: { backgroundColor: p.card },
        headerTintColor: p.text,
        sceneStyle: { backgroundColor: p.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Dashboard', tabBarIcon: icon('grid-outline') }} />
      <Tabs.Screen name="assets" options={{ title: 'Vermögen', headerTitle: 'Vermögensaufstellung', tabBarIcon: icon('pie-chart-outline') }} />
      <Tabs.Screen name="performance" options={{ title: 'Performance', tabBarIcon: icon('trending-up-outline') }} />
      <Tabs.Screen name="transactions" options={{ title: 'Buchungen', tabBarIcon: icon('list-outline') }} />
      <Tabs.Screen name="more" options={{ title: 'Mehr', tabBarIcon: icon('ellipsis-horizontal-circle-outline') }} />
    </Tabs>
  );
}
