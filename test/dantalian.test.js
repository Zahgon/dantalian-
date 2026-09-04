import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { capAnimeName, defaultEpRegex, parseConfig } from '../src/dantalian/config.js';
import { jobIsEmpty, parseJob } from '../src/dantalian/job.js';
import { fileName, isVideoFile, rustJoin, withExtension } from '../src/dantalian/utils.js';

const temporaries = [];
after(() => { for (const dir of temporaries) rmSync(dir, { recursive: true, force: true }); });

function scratch(files) {
  const dir = mkdtempSync(join(tmpdir(), 'dantalian-test-'));
  temporaries.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content ?? '');
  return dir;
}

describe('path helpers', () => {
  it('joins without normalising away a leading ./, unlike path.join', () => {
    assert.equal(rustJoin('./source', '化物語'), './source/化物語');
    assert.equal(rustJoin('source/', 'x'), 'source/x');
    assert.equal(rustJoin('', 'x'), 'x');
  });

  it('replaces only the final extension', () => {
    assert.equal(withExtension('./a/化物語 SP5.5.mp4', 'nfo'), './a/化物語 SP5.5.nfo');
    assert.equal(withExtension('./a/clip.chs.ass', 'nfo'), './a/clip.chs.nfo');
    assert.equal(withExtension('./a/noext', 'nfo'), './a/noext.nfo');
  });

  it('extracts the final component like Path::file_name', () => {
    assert.equal(fileName('./source/化物語 [2009]'), '化物語 [2009]');
    assert.equal(fileName('..'), null);
  });
});

describe('video detection', () => {
  it('accepts the extensions the Rust set contains, case-insensitively', () => {
    for (const ext of ['mkv', 'MP4', 'mp4', 'avi', 'm2ts'.slice(2), 'flv']) {
      assert.ok(isVideoFile(`a.${ext}`), `${ext} should be a video`);
    }
  });

  it('rejects subtitles, configs and extensionless files', () => {
    for (const name of ['a.ass', 'a.srt', 'dantalian.toml', 'a.nfo', 'noext']) {
      assert.ok(!isVideoFile(name), `${name} should not be a video`);
    }
  });
});

describe('directory name parsing', () => {
  it('strips bracketed release tags', () => {
    assert.equal(capAnimeName('化物語 [2009][BDRip]'), '化物語');
    assert.equal(capAnimeName('小魔女学园 [2017][TV]'), '小魔女学园');
  });

  it('keeps names that merely contain punctuation', () => {
    assert.equal(capAnimeName('ビルディバイド -#000000-'), 'ビルディバイド -#000000-');
  });
});

describe('default episode regex', () => {
  it('interpolates the query without escaping, so the alternation stays live', () => {
    const re = defaultEpRegex('リトルウィッチアカデミア|小魔女学园');
    assert.equal(re.captures('小魔女学园 10.mkv').name('ep').asStr, '10');
    assert.equal(re.captures('リトルウィッチアカデミア 03.mkv').name('ep').asStr, '03');
  });

  it('does not match a directory whose files use a different title', () => {
    assert.equal(defaultEpRegex('呪術廻戦 懐玉・玉折／渋谷事変').captures('呪術廻戦 第2期 01.mkv'), null);
  });
});

describe('job scanning', () => {
  const config = (overrides = {}) => ({
    subject_id: 1671,
    episode_re: defaultEpRegex('化物語'),
    episode_offset: 0,
    ...overrides,
  });

  it('plans a tvshow and one nfo per matching video, stripping leading zeros from the index', () => {
    const dir = scratch({ '化物語 01.mkv': '', '化物語 02.mkv': '', '化物語 SP5.5.mkv': '', 'notes.txt': '' });
    const job = parseJob(dir, config(), false);
    assert.equal(job.should_gen_tvshow, true);
    assert.deepEqual(job.episodes.map((e) => e.index).sort(), ['1', '2', '5.5']);
    assert.equal(job.episodes.find((e) => e.index === '5.5').is_sp, true);
    assert.equal(job.episodes.find((e) => e.index === '1').is_sp, false);
  });

  it('skips episodes whose nfo already exists unless forced', () => {
    const dir = scratch({ '化物語 01.mkv': '', '化物語 01.nfo': 'x', 'tvshow.nfo': 'x' });
    assert.equal(jobIsEmpty(parseJob(dir, config(), false)), true);
    const forced = parseJob(dir, config(), true);
    assert.equal(forced.should_gen_tvshow, true);
    assert.equal(forced.episodes.length, 1);
  });

  it('strips leading zeros but keeps a lone zero', () => {
    const dir = scratch({ '化物語 00.mkv': '', '化物語 007.mkv': '' });
    assert.deepEqual(parseJob(dir, config(), false).episodes.map((e) => e.index).sort(), ['0', '7']);
  });

  it('applies a numeric offset', () => {
    const dir = scratch({ '化物語 01.mkv': '', '化物語 5.5.mkv': '' });
    const job = parseJob(dir, config({ episode_offset: 24 }), false);
    assert.deepEqual(job.episodes.map((e) => e.index).sort(), ['25', '29.5']);
  });

  it('reproduces the upstream bug where an unparsable index becomes the error text', () => {
    const dir = scratch({ '化物語 5.5.5.mkv': '' });
    const job = parseJob(dir, config({ episode_offset: 24 }), false);
    assert.equal(job.episodes[0].index, 'invalid float literal');
  });

  it('writes the nfo beside the video, replacing only the last extension', () => {
    const dir = scratch({ '化物語 01.mkv': '' });
    assert.equal(parseJob(dir, config(), false).episodes[0].filename, rustJoin(dir, '化物語 01.nfo'));
  });
});

describe('config file diagnostics', () => {
  async function rejection(toml) {
    const dir = scratch({ 'dantalian.toml': toml });
    try {
      await parseConfig(dir);
    } catch (error) {
      return error.message;
    }
    return assert.fail(`expected ${JSON.stringify(toml)} to be rejected`);
  }

  it('reports the serde type error with the value position', async () => {
    assert.equal(
      await rejection('subject_id = "oops"\n'),
      'invalid type: string "oops", expected u32 for key `subject_id` at line 1 column 14',
    );
  });

  it('reports out-of-range integers as value errors', async () => {
    assert.equal(
      await rejection('subject_id = -5\n'),
      'invalid value: integer `-5`, expected u32 for key `subject_id` at line 1 column 14',
    );
  });

  it('points a float at the first digit after the decimal point', async () => {
    assert.equal(
      await rejection('subject_id = 1.5\n'),
      'invalid type: floating point `1.5`, expected u32 for key `subject_id` at line 1 column 16',
    );
  });

  it('rejects a non-string episode_re', async () => {
    assert.equal(
      await rejection('subject_id = 1\nepisode_re = 5\n'),
      'invalid type: integer `5`, expected a string for key `episode_re` at line 2 column 14',
    );
  });

  it('anchors missing and duplicate fields at line 1 column 1', async () => {
    assert.equal(await rejection('bogus = 1\n'), 'missing field `subject_id` at line 1 column 1');
    assert.equal(
      await rejection('subject_id = 1\nsubject_id = 2\n'),
      'duplicate field `subject_id` at line 1 column 1',
    );
  });

  it('renders a regex failure with the caret diagram', async () => {
    assert.equal(
      await rejection('subject_id = 1\nepisode_re = "^(?P<ep>["\n'),
      'regex parse error:\n    ^(?P<ep>[\n            ^\nerror: unclosed character class',
    );
  });
});
