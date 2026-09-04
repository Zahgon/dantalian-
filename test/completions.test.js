import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { COMPLETIONS, writeCompletions } from '../scripts/gen-completions.js';
import { golden } from './helpers/fixtures.js';

const outDir = mkdtempSync(join(tmpdir(), 'dantalian-completions-'));
writeCompletions(outDir);

after(() => rmSync(outDir, { recursive: true, force: true }));

for (const name of Object.keys(COMPLETIONS)) {
  test(`${name} matches the clap_complete golden byte for byte`, () => {
    assert.equal(readFileSync(join(outDir, name), 'utf8'), readFileSync(golden(`completions/${name}`), 'utf8'));
  });
}
