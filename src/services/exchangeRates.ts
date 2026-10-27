// Reference rates of the European Central Bank (as used by Portfolio Performance)

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Paths } from 'expo-file-system';
import { strFromU8, unzipSync } from 'fflate';
import { Platform } from 'react-native';

import { ExchangeRateTimeSeries, parseECBHistoryCSV } from '../core/money/exchange';

const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.zip';
const META_KEY = 'pp.ecb.meta';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface RatesResult {
  series: ExchangeRateTimeSeries[];
  /** epoch millis of the download */
  downloadedAt: number | null;
  error: string | null;
}

function cacheFile(): File {
  return new File(Paths.document, 'ecb-eurofxref-hist.csv');
}

async function readCache(): Promise<{ csv: string; downloadedAt: number } | null> {
  if (Platform.OS === 'web') return null;
  try {
    const file = cacheFile();
    if (!file.exists) return null;
    const meta = await AsyncStorage.getItem(META_KEY);
    const downloadedAt = meta ? Number(JSON.parse(meta).downloadedAt) : 0;
    return { csv: await file.text(), downloadedAt };
  } catch {
    return null;
  }
}

async function writeCache(csv: string, downloadedAt: number): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const file = cacheFile();
    if (file.exists) file.delete();
    file.create();
    await file.write(csv);
    await AsyncStorage.setItem(META_KEY, JSON.stringify({ downloadedAt }));
  } catch {
    // ignore - rates are downloaded again next time
  }
}

async function download(): Promise<string> {
  const response = await fetch(ECB_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(zip);
  const name = Object.keys(entries).find((n) => n.toLowerCase().endsWith('.csv'));
  if (!name) throw new Error('Keine CSV-Datei im ZIP-Archiv der EZB');
  return strFromU8(entries[name]);
}

/** loads the cached rates and downloads new rates if the cache is older than 12 hours */
export async function loadExchangeRates(allowDownload: boolean, force = false, cacheOnly = false): Promise<RatesResult> {
  const cached = await readCache();
  if (cacheOnly) return { series: cached ? parseECBHistoryCSV(cached.csv) : [], downloadedAt: cached?.downloadedAt ?? null, error: null };
  const fresh = cached !== null && Date.now() - cached.downloadedAt < MAX_AGE_MS;
  if (allowDownload && (force || !fresh)) {
    try {
      const csv = await download();
      const now = Date.now();
      await writeCache(csv, now);
      return { series: parseECBHistoryCSV(csv), downloadedAt: now, error: null };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (cached) return { series: parseECBHistoryCSV(cached.csv), downloadedAt: cached.downloadedAt, error };
      return { series: [], downloadedAt: null, error };
    }
  }
  if (cached) return { series: parseECBHistoryCSV(cached.csv), downloadedAt: cached.downloadedAt, error: null };
  return { series: [], downloadedAt: null, error: allowDownload ? null : 'Download deaktiviert' };
}
