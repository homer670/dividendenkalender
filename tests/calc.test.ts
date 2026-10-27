import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { loadClientFile } from '../src/core/io/fileLoader';
import { compareDeep, dumpCalc } from '../src/core/testing/calcDump';
import '../src/core/snapshot/clientPerformanceSnapshot';
import {
  CurrencyConverterImpl,
  ExchangeRateProviderFactory,
  FixedExchangeRateProvider,
  parseECBHistoryCSV,
  SecurityBasedExchangeRateProvider,
  StaticExchangeRateProvider,
} from '../src/core/money/exchange';
import { parseDate, setToday } from '../src/core/util/dates';

const dir = process.env.FIXTURE_DIR ?? join(__dirname, 'fixtures');
const files = readdirSync(dir).filter((f) => f.endsWith('.calc.json') || f.endsWith('.calc.json.gz'));

describe('calculations match Portfolio Performance', () => {
  for (const f of files) {
    it(f, async () => {
      const raw = readFileSync(join(dir, f));
      const expected = JSON.parse((f.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf-8'));
      setToday(parseDate(expected.today));
      const data = new Uint8Array(readFileSync(join(dir, f.replace(/\.calc\.json(\.gz)?$/, ''))));
      const { client } = await loadClientFile(data, 'geheim');
      const rates = parseECBHistoryCSV(readFileSync(join(dir, f.replace(/client-(\d+).*/, 'rates-$1.csv')), 'utf-8'));
      const factory = new ExchangeRateProviderFactory(client, [
        new StaticExchangeRateProvider('TEST', rates),
        new FixedExchangeRateProvider(),
        new SecurityBasedExchangeRateProvider(),
      ]);
      const converter = new CurrencyConverterImpl(factory, client.baseCurrency);
      const actual = JSON.parse(JSON.stringify(dumpCalc(client, converter)));
      delete expected.today;
      const diffs = compareDeep(expected, actual);
      expect(diffs).toEqual([]);
    });
  }
});
