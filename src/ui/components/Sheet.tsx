// Bottom sheet with a list of options

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, usePalette } from '../theme';
import { Separator, T } from './basic';

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.wrap}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: p.overlay }]} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: p.card, paddingBottom: insets.bottom + spacing.m }]}>
          <View style={[styles.grabber, { backgroundColor: p.separator }]} />
          {title ? (
            <View style={styles.header}>
              <T variant="headline" style={{ flex: 1 }}>
                {title}
              </T>
              <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Schliessen">
                <Ionicons name="close-circle" size={26} color={p.textTertiary} />
              </Pressable>
            </View>
          ) : null}
          <ScrollView style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export interface SheetOption<K> {
  key: K;
  label: string;
  subtitle?: string;
  section?: string;
}

export function OptionSheet<K extends string | number>({
  visible,
  onClose,
  title,
  options,
  selected,
  onSelect,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  options: SheetOption<K>[];
  selected: K | null;
  onSelect: (key: K) => void;
  footer?: ReactNode;
}) {
  const p = usePalette();
  const headers = options.map((o, i) => (o.section !== undefined && o.section !== options[i - 1]?.section ? o.section : null));
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {options.map((o, i) => {
        const header = headers[i];
        return (
          <View key={String(o.key)}>
            {header ? (
              <T variant="label" secondary style={{ paddingHorizontal: spacing.l, paddingTop: spacing.m, paddingBottom: 4 }}>
                {header}
              </T>
            ) : i > 0 ? (
              <Separator />
            ) : null}
            <Pressable
              onPress={() => {
                onSelect(o.key);
                onClose();
              }}
              style={({ pressed }) => [styles.option, pressed ? { backgroundColor: p.cardAlt } : null]}
            >
              <View style={{ flex: 1 }}>
                <T>{o.label}</T>
                {o.subtitle ? (
                  <T variant="caption" secondary>
                    {o.subtitle}
                  </T>
                ) : null}
              </View>
              {o.key === selected ? <Ionicons name="checkmark" size={20} color={p.accent} /> : null}
            </Pressable>
          </View>
        );
      })}
      {footer}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.l, borderTopRightRadius: radius.l, paddingTop: spacing.s },
  grabber: { alignSelf: 'center', width: 36, height: 5, borderRadius: 3, marginBottom: spacing.s },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.l, paddingBottom: spacing.s },
  option: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.l, paddingVertical: spacing.m, minHeight: 48 },
});
