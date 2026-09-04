import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, mock } from 'node:test';

import { resetAccessToken } from '../src/bangumi/client.js';
import { main } from '../src/main.js';
import { setMaxLevel } from '../src/logger.js';
import { golden, stubFetch } from './helpers/fixtures.js';

const SUBJECT_ROUTES = {
  'subjects/1671/persons': 'persons_1671',
  'subjects/1671/characters': 'characters_1671',
  'episodes?subject_id=1671': 'episodes_1671',
  'subjects/1671': 'subject_1671',
};

function capture(fn) {
  const written = [];
  const stub = mock.method(process.stdout, 'write', (chunk) => {
    written.push(chunk);
    return true;
  });
  return fn().then(
    () => {
      stub.mock.restore();
      return written.join('');
    },
    (error) => {
      stub.mock.restore();
      throw error;
    },
  );
}

afterEach(() => {
  setMaxLevel('info');
  resetAccessToken();
});

describe('bgm subcommands', () => {
  it('prints search results with a blank line after the count', async () => {
    const fetches = stubFetch({ 'search/subjects': 'search_littlewitch' });
    try {
      const output = await capture(() => main(['bgm', 'search', '小魔女学园']));
      const lines = output.split('\n');
      assert.equal(lines[0], 'found 10 result(s):');
      assert.equal(lines[1], '');
      assert.equal(lines[2], '  * リトルウィッチアカデミア / 小魔女学园');
      assert.equal(lines[3], '    Subject ID: 54675');
      assert.equal(lines[5], '    URL: https://bgm.tv/subject/54675');
    } finally {
      fetches.restore();
    }
  });

  it('joins multiple search keywords with a single space', async () => {
    const fetches = stubFetch({ 'search/subjects': 'search_littlewitch' });
    try {
      await capture(() => main(['bgm', 'search', '小魔女', '学园']));
      assert.equal(fetches.calls[0].method, 'POST');
      assert.deepEqual(JSON.parse(fetches.calls[0].body), {
        keyword: '小魔女 学园',
        filter: { type: [2] },
      });
    } finally {
      fetches.restore();
    }
  });

  it('fetches subject, persons and characters by default', async () => {
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      const output = await capture(() => main(['bgm', 'get', '1671']));
      assert.match(output, /^\* 化物語 \/ 化物语\n/u);
      assert.match(output, /\* https:\/\/bgm\.tv\/subject\/1671\n/u);
      assert.match(output, /\n\* staff: /u);
      assert.match(output, /\n\* characters: /u);
      assert.deepEqual(
        fetches.calls.map((call) => call.url.replace('https://api.bgm.tv/v0/', '')),
        ['subjects/1671', 'subjects/1671/persons', 'subjects/1671/characters'],
      );
    } finally {
      fetches.restore();
    }
  });

  it('skips the person and character requests when both flags are set', async () => {
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      const output = await capture(() =>
        main(['bgm', 'get', '1671', '--no-persons', '--no-characters']),
      );
      assert.doesNotMatch(output, /staff:|characters:/u);
      assert.equal(fetches.calls.length, 1);
    } finally {
      fetches.restore();
    }
  });

  it('prints episodes for get-ep', async () => {
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      const output = await capture(() => main(['bgm', 'get-ep', '1671']));
      assert.match(output, /^ {4}01: ひたぎクラブ 其ノ壹 \/ 黑仪·蟹 其一\n/u);
      assert.equal(fetches.calls.length, 1);
    } finally {
      fetches.restore();
    }
  });

  it('sends a bearer token when --access-token is supplied', async () => {
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      await capture(() =>
        main(['--access-token', 'secret-token', 'bgm', 'get', '1671', '--no-persons', '--no-characters']),
      );
      assert.equal(fetches.calls[0].headers.authorization, 'Bearer secret-token');
    } finally {
      fetches.restore();
    }
  });

  it('raises the log level with --verbose', async () => {
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      const output = await capture(() =>
        main(['--verbose', 'bgm', 'get', '1671', '--no-persons', '--no-characters']),
      );
      assert.match(output, /url = https:\/\/api\.bgm\.tv\/v0\/subjects\/1671\n/u);
      assert.match(output, /status: 200\n/u);
    } finally {
      fetches.restore();
    }
  });
});

describe('source scanning', () => {
  let workspace = null;

  afterEach(() => {
    if (workspace !== null) rmSync(workspace, { recursive: true, force: true });
    workspace = null;
  });

  function makeShow() {
    workspace = mkdtempSync(join(tmpdir(), 'dantalian-main-'));
    const show = join(workspace, '化物語');
    mkdirSync(show);
    writeFileSync(join(show, 'dantalian.toml'), 'subject_id = 1671\n');
    writeFileSync(join(show, '化物語 01.mkv'), '');
    return show;
  }

  it('skips a directory whose nfo files already exist', async () => {
    const show = makeShow();
    writeFileSync(join(show, 'tvshow.nfo'), 'stale');
    writeFileSync(join(show, '化物語 01.nfo'), 'stale');
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      const output = await capture(() => main(['-s', workspace]));
      assert.match(output, /No file should be generate, skip\.\n/u);
      assert.equal(fetches.calls.length, 1);
      assert.equal(readFileSync(join(show, 'tvshow.nfo'), 'utf8'), 'stale');
    } finally {
      fetches.restore();
    }
  });

  it('regenerates when the directory path is listed in --force', async () => {
    const show = makeShow();
    writeFileSync(join(show, 'tvshow.nfo'), 'stale');
    writeFileSync(join(show, '化物語 01.nfo'), 'stale');
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      const output = await capture(() => main(['-s', workspace, '--force', show]));
      assert.match(output, /Completed!\n/u);
      assert.equal(readFileSync(join(show, 'tvshow.nfo'), 'utf8'), readFileSync(golden('nfo/tvshow_1671.nfo'), 'utf8'));
      assert.equal(readFileSync(join(show, '化物語 01.nfo'), 'utf8'), readFileSync(golden('nfo/episode_1671_01.nfo'), 'utf8'));
    } finally {
      fetches.restore();
    }
  });

  it('regenerates every directory with --force-all', async () => {
    const show = makeShow();
    writeFileSync(join(show, 'tvshow.nfo'), 'stale');
    writeFileSync(join(show, '化物語 01.nfo'), 'stale');
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      await capture(() => main(['-s', workspace, '--force-all']));
      assert.equal(readFileSync(join(show, 'tvshow.nfo'), 'utf8'), readFileSync(golden('nfo/tvshow_1671.nfo'), 'utf8'));
    } finally {
      fetches.restore();
    }
  });

  it('leaves other directories untouched when --force names only one', async () => {
    const show = makeShow();
    writeFileSync(join(show, 'tvshow.nfo'), 'stale');
    writeFileSync(join(show, '化物語 01.nfo'), 'stale');
    const fetches = stubFetch(SUBJECT_ROUTES);
    try {
      await capture(() => main(['-s', workspace, '--force', join(workspace, 'somewhere-else')]));
      assert.equal(readFileSync(join(show, 'tvshow.nfo'), 'utf8'), 'stale');
    } finally {
      fetches.restore();
    }
  });
});
