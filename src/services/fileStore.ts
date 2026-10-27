// Local storage of the opened Portfolio Performance files

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  /** epoch millis of the import */
  importedAt: number;
  /** epoch millis of the last opening */
  openedAt: number;
}

const RECENTS_KEY = 'pp.files.v1';
const LAST_KEY = 'pp.files.last';

/** web has no file system: keep the bytes in memory for the session */
const memory = new Map<string, Uint8Array>();

function directory(): Directory {
  const dir = new Directory(Paths.document, 'portfolios');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function fileFor(id: string): File {
  return new File(directory(), `${id}.portfolio`);
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export async function listFiles(): Promise<StoredFile[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENTS_KEY);
    const list = raw ? (JSON.parse(raw) as StoredFile[]) : [];
    return list.sort((a, b) => b.openedAt - a.openedAt);
  } catch {
    return [];
  }
}

async function saveList(list: StoredFile[]): Promise<void> {
  await AsyncStorage.setItem(RECENTS_KEY, JSON.stringify(list));
}

export async function getLastFileId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export async function setLastFileId(id: string | null): Promise<void> {
  if (id === null) await AsyncStorage.removeItem(LAST_KEY);
  else await AsyncStorage.setItem(LAST_KEY, id);
}

/** lets the user pick a file (local storage, iCloud Drive, Google Drive, Dropbox, ...) */
export async function pickFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];
  let bytes: Uint8Array;
  if (Platform.OS === 'web') {
    const blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    bytes = await new File(asset.uri).bytes();
  }
  return { name: asset.name ?? 'Portfolio', bytes };
}

/** stores the bytes (replacing an existing file with the same name) */
export async function importFile(name: string, bytes: Uint8Array): Promise<StoredFile> {
  const list = await listFiles();
  const existing = list.find((f) => f.name === name);
  const now = Date.now();
  const entry: StoredFile = existing
    ? { ...existing, size: bytes.length, importedAt: now, openedAt: now }
    : { id: newId(), name, size: bytes.length, importedAt: now, openedAt: now };
  if (Platform.OS === 'web') {
    memory.set(entry.id, bytes);
  } else {
    const file = fileFor(entry.id);
    if (file.exists) file.delete();
    file.create();
    await file.write(bytes);
  }
  await saveList([entry, ...list.filter((f) => f.id !== entry.id)]);
  return entry;
}

export async function readFile(entry: StoredFile): Promise<Uint8Array | null> {
  if (Platform.OS === 'web') return memory.get(entry.id) ?? null;
  const file = fileFor(entry.id);
  if (!file.exists) return null;
  return file.bytes();
}

export async function touchFile(id: string): Promise<void> {
  const list = await listFiles();
  const e = list.find((f) => f.id === id);
  if (!e) return;
  e.openedAt = Date.now();
  await saveList(list);
}

export async function removeFile(id: string): Promise<void> {
  const list = await listFiles();
  await saveList(list.filter((f) => f.id !== id));
  if (Platform.OS === 'web') memory.delete(id);
  else {
    const file = fileFor(id);
    if (file.exists) file.delete();
  }
  if ((await getLastFileId()) === id) await setLastFileId(null);
}
