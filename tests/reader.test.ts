import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadClientFile } from '../src/core/io/fileLoader';
import { dumpModel } from '../src/core/testing/modelDump';

const dir = process.env.FIXTURE_DIR ?? join(__dirname, 'fixtures');
const files = readdirSync(dir).filter((f) => existsSync(join(dir, f + '.model.json')));

describe('file reader matches Portfolio Performance', () => {
  for (const f of files) {
    it(f, async () => {
      const data = new Uint8Array(readFileSync(join(dir, f)));
      const { client } = await loadClientFile(data, 'geheim');
      const expected = JSON.parse(readFileSync(join(dir, f + '.model.json'), 'utf-8')).model;
      const actual = JSON.parse(JSON.stringify(dumpModel(client)));
      expect(actual).toEqual(expected);
    });
  }
});
