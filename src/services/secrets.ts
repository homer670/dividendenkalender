// Stores file passwords in the secure enclave / keystore (optionally protected by biometrics)

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const key = (fileId: string) => `pp.pw.${fileId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export async function biometricsAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export async function authenticate(reason: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: reason, cancelLabel: 'Abbrechen' });
    return r.success;
  } catch {
    return false;
  }
}

export async function storePassword(fileId: string, password: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.setItemAsync(key(fileId), password);
  } catch {
    // ignore - the password is simply not remembered
  }
}

export async function loadPassword(fileId: string): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    return await SecureStore.getItemAsync(key(fileId));
  } catch {
    return null;
  }
}

export async function deletePassword(fileId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SecureStore.deleteItemAsync(key(fileId));
  } catch {
    // ignore
  }
}
