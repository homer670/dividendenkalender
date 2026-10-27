import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listFiles, removeFile, StoredFile } from '@/services/fileStore';
import { closeFile, openStoredFile, pickAndOpenFile, submitPassword, unlockFile, usePortfolio } from '@/state/portfolio';
import { useSettings } from '@/state/settings';
import { Button, Card, ListCard, Loading, Notice, Row, T } from '@/ui/components/basic';
import { formatDateTime } from '@/ui/format';
import { radius, spacing, usePalette } from '@/ui/theme';

function fileDate(ms: number): string {
  const d = new Date(ms);
  const epochSeconds = Math.floor(ms / 1000) - d.getTimezoneOffset() * 60;
  return formatDateTime(epochSeconds);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function Welcome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const state = usePortfolio((s) => s);
  const [files, setFiles] = useState<StoredFile[]>([]);

  useEffect(() => {
    listFiles().then(setFiles);
  }, [state.status]);

  if (state.status === 'init' || state.status === 'loading')
    return <Loading label={state.file ? `„${state.file.name}“ wird geladen …` : undefined} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.l, paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl, gap: spacing.l }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={[styles.logo, { backgroundColor: p.accent }]}>
            <Ionicons name="pie-chart" size={34} color="#fff" />
          </View>
          <T variant="title" align="center">
            Portfolio
          </T>
          <T secondary align="center">
            Deine Portfolio-Performance-Datei auf dem Smartphone – alle Berechnungen erfolgen lokal auf dem Gerät.
          </T>
        </View>

        {state.status === 'password' && state.file ? <PasswordForm fileName={state.file.name} error={state.passwordError} /> : null}

        {state.status === 'locked' && state.file ? (
          <Card style={{ gap: spacing.m, alignItems: 'center' }}>
            <Ionicons name="lock-closed" size={32} color={p.accent} />
            <T variant="headline" align="center">
              „{state.file.name}“ ist gesperrt
            </T>
            <T secondary align="center">
              Die Datei wurde gesperrt, als die App in den Hintergrund ging.
            </T>
            <Button title="Entsperren" icon="lock-open-outline" onPress={() => unlockFile()} />
            <Button title="Andere Datei öffnen" kind="plain" onPress={() => closeFile()} />
          </Card>
        ) : null}

        {state.status === 'error' ? (
          <View style={{ gap: spacing.m }}>
            <Notice kind="error" text={`Die Datei konnte nicht geöffnet werden: ${state.error ?? 'Unbekannter Fehler'}`} />
          </View>
        ) : null}

        {state.status !== 'password' && state.status !== 'locked' ? (
          <View style={{ gap: spacing.s }}>
            <Button title="Datei öffnen" icon="folder-open-outline" onPress={() => pickAndOpenFile()} />
            <T variant="caption" secondary align="center">
              Unterstützt werden .xml- und .portfolio-Dateien (auch verschlüsselt) aus iCloud Drive, Google Drive, Dropbox, OneDrive
              oder dem lokalen Speicher.
            </T>
          </View>
        ) : null}

        {files.length > 0 && state.status !== 'password' && state.status !== 'locked' ? (
          <ListCard header="Zuletzt geöffnet">
            {files.map((f) => (
              <Row
                key={f.id}
                left={<Ionicons name="document-text-outline" size={22} color={p.accent} />}
                title={f.name}
                subtitle={`${fileDate(f.openedAt)} · ${formatSize(f.size)}`}
                onPress={() => openStoredFile(f)}
                value={
                  <Pressable
                    hitSlop={10}
                    accessibilityLabel={`${f.name} entfernen`}
                    onPress={async () => {
                      await removeFile(f.id);
                      setFiles(await listFiles());
                    }}
                  >
                    <Ionicons name="trash-outline" size={18} color={p.textTertiary} />
                  </Pressable>
                }
                chevron={false}
              />
            ))}
          </ListCard>
        ) : null}

        <Button title="Einstellungen" kind="plain" icon="settings-outline" onPress={() => router.push('/settings')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function PasswordForm({ fileName, error }: { fileName: string; error: string | null }) {
  const p = usePalette();
  const settings = useSettings();
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Platform.OS !== 'web' && settings.useBiometrics);
  const submit = () => {
    if (password.length > 0) submitPassword(password, remember);
  };
  return (
    <Card style={{ gap: spacing.m }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.s }}>
        <Ionicons name="lock-closed-outline" size={20} color={p.accent} />
        <T variant="headline" style={{ flex: 1 }} numberOfLines={2}>
          „{fileName}“ ist verschlüsselt
        </T>
      </View>
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Passwort"
        placeholderTextColor={p.textTertiary}
        secureTextEntry
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        onSubmitEditing={submit}
        returnKeyType="go"
        style={[styles.input, { backgroundColor: p.inputBackground, color: p.text }]}
        accessibilityLabel="Passwort"
      />
      {error ? <T color={p.negative}>{error}</T> : null}
      {Platform.OS !== 'web' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.m }}>
          <T style={{ flex: 1 }}>Passwort merken (mit Face ID / Fingerabdruck entsperren)</T>
          <Switch value={remember} onValueChange={setRemember} />
        </View>
      ) : null}
      <Button title="Öffnen" onPress={submit} disabled={password.length === 0} />
      <Button title="Abbrechen" kind="plain" onPress={() => closeFile()} />
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.s, paddingVertical: spacing.l },
  logo: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.s },
  input: { borderRadius: radius.s, paddingHorizontal: spacing.m, paddingVertical: spacing.m, fontSize: 16 },
});
