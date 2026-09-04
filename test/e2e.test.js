import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it, mock } from 'node:test';

import { dantalian, dantalianMovie } from '../src/dantalian/index.js';
import * as logger from '../src/logger.js';
import { golden, stubFetch } from './helpers/fixtures.js';

const ANIME_ROUTES = {
  'search/subjects': 'search_bakemonogatari',
  'subjects/1671/persons': 'persons_1671',
  'subjects/1671/characters': 'characters_1671',
  'episodes?subject_id=1671': 'episodes_1671',
  'subjects/1671': 'subject_1671',
};
const MOVIE_ROUTES = {
  'subjects/244761/characters': 'characters_244761',
  'subjects/244761': 'subject_244761',
};

const temporaries = [];
after(() => { for (const dir of temporaries) rmSync(dir, { recursive: true, force: true }); });

function scratchSource(dirName, files) {
  const root = mkdtempSync(join(tmpdir(), 'dantalian-e2e-'));
  temporaries.push(root);
  const dir = join(root, dirName);
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content ?? '');
  return { root, dir };
}

async function captureRun(run) {
  const lines = [];
  const write = mock.method(process.stdout, 'write', (chunk) => { lines.push(String(chunk)); return true; });
  try {
    await run();
  } finally {
    write.mock.restore();
  }
  return lines.join('');
}

describe('end-to-end anime run against recorded API responses', () => {
  it('writes tvshow.nfo, per-episode nfo and a normalised config, all byte-identical to Rust', async () => {
    const { root, dir } = scratchSource('化物語 [2009][BDRip]', {
      '化物語 01.mkv': '',
      '化物語 SP5.5.mkv': '',
      '化物語 01.chs.ass': '',
    });
    const { calls, restore } = stubFetch(ANIME_ROUTES);
    logger.setMaxLevel('info');
    const output = await captureRun(() => dantalian(root, () => false));
    restore();

    assert.equal(readFileSync(join(dir, 'tvshow.nfo'), 'utf8'), readFileSync(golden('nfo/tvshow_1671.nfo'), 'utf8'));
    assert.equal(readFileSync(join(dir, '化物語 01.nfo'), 'utf8'), readFileSync(golden('nfo/episode_1671_01.nfo'), 'utf8'));
    assert.equal(readFileSync(join(dir, '化物語 SP5.5.nfo'), 'utf8'), readFileSync(golden('nfo/episode_1671_sp5.5.nfo'), 'utf8'));
    assert.equal(readFileSync(join(dir, 'dantalian.toml'), 'utf8'), readFileSync(golden('nfo/config_1671.toml'), 'utf8'));

    assert.match(output, /Not found config file, create one/);
    assert.match(output, /Fetch anime data for: \[1671\] 化物語 \/ 化物语/);
    assert.match(output, /Completed!/);
  });

  it('requests subject, persons, characters and episodes sequentially in the Rust order', async () => {
    const { root } = scratchSource('化物語 [2009][BDRip]', { '化物語 01.mkv': '' });
    writeFileSync(join(root, '化物語 [2009][BDRip]', 'dantalian.toml'), 'subject_id = 1671\nepisode_re = "^(?P<name>化物語) (?P<sp>SP)?(?P<ep>[.\\\\d]+)\\\\."\nepisode_offset = 0\n');
    const { calls, restore } = stubFetch(ANIME_ROUTES);
    logger.setMaxLevel('info');
    await captureRun(() => dantalian(root, () => false));
    restore();

    assert.deepEqual(calls.map((c) => c.url), [
      'https://api.bgm.tv/v0/subjects/1671',
      'https://api.bgm.tv/v0/subjects/1671/persons',
      'https://api.bgm.tv/v0/subjects/1671/characters',
      'https://api.bgm.tv/v0/episodes?subject_id=1671',
    ]);
    assert.ok(calls.every((c) => c.method === 'GET'));
    assert.ok(calls.every((c) => c.headers['user-agent'] === 'Dantalian/0.4.6 (https://github.com/nanozuki/dantalian)'));
    assert.ok(calls.every((c) => !('content-type' in c.headers)));
  });

  it('skips a directory whose outputs already exist', async () => {
    const { root, dir } = scratchSource('化物語 [2009][BDRip]', {
      '化物語 01.mkv': '',
      '化物語 01.nfo': 'existing',
      'tvshow.nfo': 'existing',
      'dantalian.toml': 'subject_id = 1671\nepisode_re = "^(?P<name>化物語) (?P<sp>SP)?(?P<ep>[.\\\\d]+)\\\\."\nepisode_offset = 0\n',
    });
    const { calls, restore } = stubFetch(ANIME_ROUTES);
    logger.setMaxLevel('info');
    const output = await captureRun(() => dantalian(root, () => false));
    restore();

    assert.match(output, /No file should be generate, skip\./);
    assert.equal(calls.length, 0);
    assert.equal(readFileSync(join(dir, 'tvshow.nfo'), 'utf8'), 'existing');
  });

  it('regenerates everything when the path is forced', async () => {
    const { root, dir } = scratchSource('化物語 [2009][BDRip]', {
      '化物語 01.mkv': '',
      '化物語 01.nfo': 'existing',
      'tvshow.nfo': 'existing',
      'dantalian.toml': 'subject_id = 1671\nepisode_re = "^(?P<name>化物語) (?P<sp>SP)?(?P<ep>[.\\\\d]+)\\\\."\nepisode_offset = 0\n',
    });
    const { restore } = stubFetch(ANIME_ROUTES);
    logger.setMaxLevel('info');
    await captureRun(() => dantalian(root, () => true));
    restore();

    assert.equal(readFileSync(join(dir, 'tvshow.nfo'), 'utf8'), readFileSync(golden('nfo/tvshow_1671.nfo'), 'utf8'));
    assert.equal(readFileSync(join(dir, '化物語 01.nfo'), 'utf8'), readFileSync(golden('nfo/episode_1671_01.nfo'), 'utf8'));
  });

  it('reports a per-directory failure without aborting the run', async () => {
    const { root } = scratchSource('unknown title 9x8y7z', { 'a.mkv': '' });
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ data: [] })).buffer,
    });
    logger.setMaxLevel('info');
    const output = await captureRun(() => dantalian(root, () => false));
    globalThis.fetch = original;

    assert.match(output, /Failed: not found/);
    assert.ok(!output.includes('Completed!'));
  });
});

describe('end-to-end movie run', () => {
  it('writes movie.nfo byte-identically and emits no per-file log line', async () => {
    const { root, dir } = scratchSource('劇場版 SHIROBAKO', {
      '劇場版 SHIROBAKO.mkv': '',
      'dantalian.toml': 'subject_id = 244761\n',
    });
    const { calls, restore } = stubFetch(MOVIE_ROUTES);
    logger.setMaxLevel('info');
    const output = await captureRun(() => dantalianMovie(root, () => false));
    restore();

    assert.equal(readFileSync(join(dir, 'movie.nfo'), 'utf8'), readFileSync(golden('nfo/movie_244761.nfo'), 'utf8'));
    assert.ok(!output.includes('Generate '));
    assert.match(output, /Completed!/);
    assert.deepEqual(calls.map((c) => c.url), [
      'https://api.bgm.tv/v0/subjects/244761',
      'https://api.bgm.tv/v0/subjects/244761',
      'https://api.bgm.tv/v0/subjects/244761/characters',
    ]);
  });
});
