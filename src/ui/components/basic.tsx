// Basic themed building blocks

import Ionicons from '@expo/vector-icons/Ionicons';
import React, { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';

import { radius, spacing, usePalette, valueColor } from '../theme';

type Variant = 'title' | 'headline' | 'body' | 'caption' | 'kpi' | 'small' | 'label';

const VARIANTS: Record<Variant, TextStyle> = {
  title: { fontSize: 22, fontWeight: '700' },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 15 },
  caption: { fontSize: 13 },
  small: { fontSize: 11 },
  kpi: { fontSize: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
};

export interface TProps extends TextProps {
  variant?: Variant;
  secondary?: boolean;
  tertiary?: boolean;
  color?: string;
  /** colors the text green or red depending on the sign */
  signed?: number | null;
  align?: 'left' | 'right' | 'center';
  weight?: TextStyle['fontWeight'];
  numeric?: boolean;
}

export function T({ variant = 'body', secondary, tertiary, color, signed, align, weight, numeric, style, ...rest }: TProps) {
  const p = usePalette();
  const c =
    color ?? (signed !== undefined ? valueColor(p, signed) : tertiary ? p.textTertiary : secondary ? p.textSecondary : p.text);
  return (
    <Text
      {...rest}
      style={[
        VARIANTS[variant],
        { color: c },
        align ? { textAlign: align } : null,
        weight ? { fontWeight: weight } : null,
        numeric ? { fontVariant: ['tabular-nums'] } : null,
        style,
      ]}
    />
  );
}

export function Screen({
  children,
  refreshing,
  onRefresh,
  scroll = true,
  contentStyle,
}: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  if (!scroll) return <View style={[{ flex: 1, backgroundColor: p.background }, contentStyle]}>{children}</View>;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: p.background }}
      contentContainerStyle={[{ padding: spacing.l, paddingBottom: spacing.xl * 2, gap: spacing.m }, contentStyle]}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({
  children,
  style,
  padded = true,
  onPress,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
}) {
  const p = usePalette();
  const s: StyleProp<ViewStyle> = [
    { backgroundColor: p.card, borderRadius: radius.m, overflow: 'hidden' },
    padded ? { padding: spacing.l } : null,
    style,
  ];
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s, pressed ? { opacity: 0.7 } : null]}>
        {children}
      </Pressable>
    );
  return <View style={s}>{children}</View>;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <T variant="label" secondary style={{ flex: 1 }}>
        {title}
      </T>
      {right}
    </View>
  );
}

export function Separator({ inset = spacing.l }: { inset?: number }) {
  const p = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.separator, marginLeft: inset }} />;
}

export function Row({
  title,
  subtitle,
  value,
  valueSigned,
  detail,
  detailSigned,
  left,
  onPress,
  chevron,
  numberOfLines = 1,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  valueSigned?: number | null;
  detail?: ReactNode;
  detailSigned?: number | null;
  left?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
  numberOfLines?: number;
}) {
  const p = usePalette();
  const content = (
    <View style={styles.row}>
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <T numberOfLines={numberOfLines}>{title}</T>
        ) : (
          title
        )}
        {subtitle !== undefined && subtitle !== null ? (
          typeof subtitle === 'string' ? (
            <T variant="caption" secondary numberOfLines={1}>
              {subtitle}
            </T>
          ) : (
            subtitle
          )
        ) : null}
      </View>
      {value !== undefined || detail !== undefined ? (
        <View style={{ alignItems: 'flex-end', marginLeft: spacing.s, maxWidth: '55%' }}>
          {value !== undefined ? (
            typeof value === 'string' ? (
              <T numeric signed={valueSigned} numberOfLines={1}>
                {value}
              </T>
            ) : (
              value
            )
          ) : null}
          {detail !== undefined ? (
            typeof detail === 'string' ? (
              <T variant="caption" numeric signed={detailSigned} secondary={detailSigned === undefined} numberOfLines={1}>
                {detail}
              </T>
            ) : (
              detail
            )
          ) : null}
        </View>
      ) : null}
      {chevron || (onPress && chevron !== false) ? (
        <Ionicons name="chevron-forward" size={16} color={p.textTertiary} style={{ marginLeft: spacing.xs }} />
      ) : null}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { backgroundColor: p.cardAlt } : null)}>
      {content}
    </Pressable>
  );
}

export function ListCard({ children, header }: { children: ReactNode; header?: string }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View>
      {header ? <SectionHeader title={header} /> : null}
      <Card padded={false}>
        {items.map((child, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <Separator /> : null}
            {child}
          </React.Fragment>
        ))}
      </Card>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const p = usePalette();
  return (
    <View style={[styles.center, { backgroundColor: p.background }]}>
      <ActivityIndicator color={p.accent} />
      {label ? (
        <T secondary style={{ marginTop: spacing.m }}>
          {label}
        </T>
      ) : null}
    </View>
  );
}

export function EmptyState({ icon = 'document-outline', title, message, children }: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
  children?: ReactNode;
}) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.s }}>
      <Ionicons name={icon} size={44} color={p.textTertiary} />
      <T variant="headline" align="center">
        {title}
      </T>
      {message ? (
        <T secondary align="center">
          {message}
        </T>
      ) : null}
      {children}
    </View>
  );
}

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'destructive' | 'plain';
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  small?: boolean;
}) {
  const p = usePalette();
  const bg = kind === 'primary' ? p.accent : kind === 'secondary' ? p.inputBackground : 'transparent';
  const fg = kind === 'primary' ? p.accentText : kind === 'destructive' ? p.negative : p.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        small ? styles.buttonSmall : null,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 15 : 18} color={fg} /> : null}
      <T weight="600" color={fg} variant={small ? 'caption' : 'body'}>
        {title}
      </T>
    </Pressable>
  );
}

/** horizontally scrollable chips, e.g. for reporting periods */
export function Chips<K extends string>({
  items,
  selected,
  onSelect,
  trailing,
}: {
  items: { key: K; label: string }[];
  selected: K | null;
  onSelect: (key: K) => void;
  trailing?: ReactNode;
}) {
  const p = usePalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.s, paddingVertical: 2 }}>
      {items.map((item) => {
        const active = item.key === selected;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={[styles.chip, { backgroundColor: active ? p.accent : p.card, borderColor: active ? p.accent : p.border }]}
          >
            <T variant="caption" weight="600" color={active ? p.accentText : p.text}>
              {item.label}
            </T>
          </Pressable>
        );
      })}
      {trailing}
    </ScrollView>
  );
}

export function Segmented<K extends string>({
  items,
  selected,
  onSelect,
}: {
  items: { key: K; label: string }[];
  selected: K;
  onSelect: (key: K) => void;
}) {
  const p = usePalette();
  return (
    <View style={[styles.segmented, { backgroundColor: p.inputBackground }]}>
      {items.map((item) => {
        const active = item.key === selected;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelect(item.key)}
            style={[styles.segment, active ? { backgroundColor: p.card } : null]}
          >
            <T variant="caption" weight={active ? '600' : '400'} numberOfLines={1}>
              {item.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Notice({ text, kind = 'info' }: { text: string; kind?: 'info' | 'warning' | 'error' }) {
  const p = usePalette();
  const color = kind === 'error' ? p.negative : kind === 'warning' ? p.warning : p.accent;
  return (
    <View style={[styles.notice, { borderColor: color, backgroundColor: p.card }]}>
      <Ionicons
        name={kind === 'info' ? 'information-circle-outline' : 'warning-outline'}
        size={18}
        color={color}
        style={{ marginTop: 1 }}
      />
      <T variant="caption" style={{ flex: 1 }}>
        {text}
      </T>
    </View>
  );
}

export function KeyValue({ label, value, signed }: { label: string; value: string; signed?: number | null }) {
  return (
    <View style={styles.kv}>
      <T secondary variant="caption" style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </T>
      <T numeric variant="caption" signed={signed} weight="500">
        {value}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.s,
    paddingBottom: spacing.xs + 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.l,
    paddingVertical: spacing.m - 1,
    minHeight: 48,
    gap: spacing.m,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.s,
    paddingVertical: spacing.m,
    paddingHorizontal: spacing.l,
    borderRadius: radius.m,
  },
  buttonSmall: { paddingVertical: spacing.s - 2, paddingHorizontal: spacing.m, borderRadius: radius.s },
  chip: {
    paddingHorizontal: spacing.m,
    paddingVertical: spacing.s - 1,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmented: { flexDirection: 'row', borderRadius: radius.s, padding: 2 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: radius.s - 2 },
  notice: {
    flexDirection: 'row',
    gap: spacing.s,
    padding: spacing.m,
    borderRadius: radius.s,
    borderLeftWidth: 3,
  },
  kv: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, gap: spacing.s },
});
