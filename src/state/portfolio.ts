// State of the opened Portfolio Performance file

import { detectFileKind, loadClientFile, PasswordRequiredError, WrongPasswordError } from '../core/io/fileLoader';
import { Client } from '../core/model';
import { ExchangeRateTimeSeries } from '../core/money/exchange';
import { loadExchangeRates } from '../services/exchangeRates';
import { getLastFileId, importFile, listFiles, pickFile, readFile, setLastFileId, StoredFile, touchFile } from '../services/fileStore';
import { authenticate, biometricsAvailable, deletePassword, loadPassword, storePassword } from '../services/secrets';
import { CalcContext } from './calc';
import { createStore } from './createStore';
import { loadSettings, settingsStore } from './settings';

export type PortfolioStatus = 'init' | 'empty' | 'loading' | 'password' | 'locked' | 'ready' | 'error';

export interface PortfolioState {
  status: PortfolioStatus;
  file: StoredFile | null;
  client: Client | null;
  context: CalcContext | null;
  encrypted: boolean;
  warnings: string[];
  error: string | null;
  passwordError: string | null;
  ecb: ExchangeRateTimeSeries[];
  ratesLoading: boolean;
  ratesDownloadedAt: number | null;
  ratesError: string | null;
  /** incremented whenever the calculation context changes */
  revision: number;
}

export const portfolioStore = createStore<PortfolioState>({
  status: 'init',
  file: null,
  client: null,
  context: null,
  encrypted: false,
  warnings: [],
  error: null,
  passwordError: null,
  ecb: [],
  ratesLoading: false,
  ratesDownloadedAt: null,
  ratesError: null,
  revision: 0,
});

export function usePortfolio<R>(selector: (s: PortfolioState) => R): R {
  return portfolioStore.use(selector);
}

/** the calculation context; only valid while status === 'ready' */
export function useCalc(): CalcContext | null {
  return portfolioStore.use((s) => s.context);
}

let pendingBytes: Uint8Array | null = null;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function setClient(client: Client, file: StoredFile, encrypted: boolean, warnings: string[]): void {
  const s = portfolioStore.get();
  portfolioStore.set({
    status: 'ready',
    client,
    file,
    encrypted,
    warnings,
    error: null,
    passwordError: null,
    context: new CalcContext(client, s.ecb),
    revision: s.revision + 1,
  });
}

async function decode(file: StoredFile, bytes: Uint8Array, password: string | null): Promise<boolean> {
  try {
    const result = await loadClientFile(bytes, password);
    const encrypted = detectFileKind(bytes) === 'encrypted';
    pendingBytes = null;
    setClient(
      result.client,
      file,
      encrypted,
      result.warnings.map((w) => w.message),
    );
    await setLastFileId(file.id);
    await touchFile(file.id);
    return true;
  } catch (e) {
    if (e instanceof PasswordRequiredError || e instanceof WrongPasswordError) {
      pendingBytes = bytes;
      portfolioStore.set({
        status: 'password',
        file,
        client: null,
        context: null,
        encrypted: true,
        passwordError: e instanceof WrongPasswordError ? 'Das Passwort ist falsch.' : null,
      });
      return false;
    }
    pendingBytes = null;
    portfolioStore.set({ status: 'error', file, client: null, context: null, error: errorMessage(e) });
    return false;
  }
}

/** opens a stored file; uses the stored password (after biometric authentication) for encrypted files */
export async function openStoredFile(file: StoredFile, options: { allowBiometrics?: boolean } = {}): Promise<void> {
  portfolioStore.set({ status: 'loading', file, error: null, passwordError: null });
  const bytes = await readFile(file);
  if (!bytes) {
    portfolioStore.set({ status: 'error', error: 'Die Datei wurde nicht gefunden. Bitte erneut importieren.' });
    return;
  }
  if (detectFileKind(bytes) === 'encrypted') {
    pendingBytes = bytes;
    const settings = settingsStore.get();
    const stored = await loadPassword(file.id);
    if (stored && settings.useBiometrics && options.allowBiometrics !== false && (await biometricsAvailable())) {
      if (await authenticate(`„${file.name}“ entsperren`)) {
        portfolioStore.set({ status: 'loading' });
        if (await decode(file, bytes, stored)) return;
        await deletePassword(file.id);
        return;
      }
    }
    portfolioStore.set({ status: 'password', file, client: null, context: null, encrypted: true, passwordError: null });
    return;
  }
  await decode(file, bytes, null);
}

export async function submitPassword(password: string, remember: boolean): Promise<void> {
  const { file } = portfolioStore.get();
  if (!file || !pendingBytes) return;
  portfolioStore.set({ status: 'loading', passwordError: null });
  const ok = await decode(file, pendingBytes, password);
  if (ok && remember) await storePassword(file.id, password);
}

export async function pickAndOpenFile(): Promise<void> {
  let picked: { name: string; bytes: Uint8Array } | null;
  try {
    picked = await pickFile();
  } catch (e) {
    portfolioStore.set({ status: 'error', error: errorMessage(e) });
    return;
  }
  if (!picked) return;
  portfolioStore.set({ status: 'loading', error: null });
  const file = await importFile(picked.name, picked.bytes);
  // a replaced file might have a new password
  await deletePassword(file.id);
  await decode(file, picked.bytes, null);
}

/** removes the decrypted data from memory (file is locked when the app is in the background) */
export function lockFile(): void {
  const s = portfolioStore.get();
  if (s.status !== 'ready' || !s.encrypted || !s.file) return;
  pendingBytes = null;
  portfolioStore.set({ status: 'locked', client: null, context: null, revision: s.revision + 1 });
}

export async function unlockFile(): Promise<void> {
  const { file } = portfolioStore.get();
  if (file) await openStoredFile(file);
}

export async function closeFile(): Promise<void> {
  pendingBytes = null;
  await setLastFileId(null);
  const s = portfolioStore.get();
  portfolioStore.set({ status: 'empty', file: null, client: null, context: null, warnings: [], error: null, revision: s.revision + 1 });
}

export async function refreshExchangeRates(force = false, cacheOnly = false): Promise<void> {
  if (portfolioStore.get().ratesLoading) return;
  portfolioStore.set({ ratesLoading: true });
  const result = await loadExchangeRates(settingsStore.get().downloadExchangeRates, force, cacheOnly);
  const s = portfolioStore.get();
  const changed = result.series.length > 0 && result.downloadedAt !== s.ratesDownloadedAt;
  portfolioStore.set({
    ecb: result.series.length > 0 ? result.series : s.ecb,
    ratesLoading: false,
    ratesDownloadedAt: result.downloadedAt ?? s.ratesDownloadedAt,
    ratesError: result.error,
  });
  if (changed) recreateContext();
}

/** rebuilds the calculation context (e.g. after new exchange rates or changed settings) */
export function recreateContext(): void {
  const s = portfolioStore.get();
  if (s.status !== 'ready' || !s.client) return;
  portfolioStore.set({ context: new CalcContext(s.client, s.ecb), revision: s.revision + 1 });
}

export async function initialize(): Promise<void> {
  await loadSettings();
  // cached rates first (fast), then download new rates in the background
  await refreshExchangeRates(false, true);
  const lastId = await getLastFileId();
  const files = await listFiles();
  const last = files.find((f) => f.id === lastId);
  if (last) await openStoredFile(last);
  else portfolioStore.set({ status: 'empty' });
  await refreshExchangeRates();
}
