import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BgmError,
  decodeBgmError,
  decodeEpisode,
  decodePerson,
  displayCharacters,
  displayEpisode,
  displayEpisodes,
  displayPersons,
  displaySubject,
  displaySubjectBase,
  EpisodeType,
  subjectUrl,
} from '../src/bangumi/types.js';
import { loadApiFixture, loadSearchFixture } from './helpers/fixtures.js';

const EPISODE_BASE = {
  id: 1,
  type: 0,
  sort: 1,
  name: 'name',
  name_cn: 'cn',
  duration: '',
  airdate: '',
  comment: 0,
  desc: '',
};

describe('episode decoding', () => {
  it('test_deserialize_episode_integer_ep', () => {
    const episode = decodeEpisode(
      JSON.parse(`{
            "id": 12345,
            "type": 0,
            "ep": 6,
            "sort": 6.0,
            "name": "Episode 6",
            "name_cn": "第6话",
            "duration": "24m",
            "airdate": "2024-07-01",
            "comment": 10,
            "desc": "Description"
        }`),
    );
    assert.equal(episode.ep, 6);
  });

  it('test_deserialize_episode_fractional_ep', () => {
    const episode = decodeEpisode(
      JSON.parse(`{
            "id": 12345,
            "type": 0,
            "ep": 6.5,
            "sort": 6.5,
            "name": "Episode 6.5",
            "name_cn": "第6.5话",
            "duration": "24m",
            "airdate": "2024-07-01",
            "comment": 10,
            "desc": "Description"
        }`),
    );
    assert.equal(episode.ep, 6.5);
  });

  it('treats an absent optional field as null rather than failing', () => {
    assert.equal(decodeEpisode(EPISODE_BASE).duration_seconds, null);
  });

  it('ignores unknown fields the way serde does', () => {
    assert.equal(decodeEpisode({ ...EPISODE_BASE, brand_new_field: 'x' }).id, 1);
  });

  it('rejects a missing required field', () => {
    const { name, ...withoutName } = EPISODE_BASE;
    assert.throws(() => decodeEpisode(withoutName), /name/);
  });

  it('rejects an unknown episode type discriminant', () => {
    assert.throws(() => decodeEpisode({ ...EPISODE_BASE, type: 99 }));
  });
});

describe('episode display', () => {
  const display = (overrides) => displayEpisode(decodeEpisode({ ...EPISODE_BASE, ...overrides }), 2);

  it('right-aligns a regular episode index in six columns', () => {
    assert.equal(display({ sort: 1, name: 'ひたぎクラブ', name_cn: '黑仪·蟹' }), '        01: ひたぎクラブ / 黑仪·蟹');
  });

  it('prefixes special episodes with SP and keeps the fractional sort', () => {
    assert.equal(display({ type: 1, sort: 5.5, name: 'SP1', name_cn: '总集篇' }), '     SP5.5: SP1 / 总集篇');
  });

  it('does not pad the type marker, so a long index overflows the width', () => {
    assert.equal(display({ type: 1, sort: 10.5, name: 'a', name_cn: 'b' }), '    SP10.5: a / b');
  });

  it('joins multiple episodes with newlines', () => {
    const episodes = [decodeEpisode(EPISODE_BASE), decodeEpisode({ ...EPISODE_BASE, sort: 2 })];
    assert.equal(displayEpisodes(episodes, 2).split('\n').length, 2);
  });
});

describe('subject display', () => {
  it('formats a search result the way `bgm search` prints it', () => {
    const first = loadSearchFixture()[0];
    assert.equal(
      displaySubjectBase(first, 1),
      `  * ${first.name} / ${first.name_cn}\n    Subject ID: ${first.id}\n    Air Date: ${first.date}\n    URL: ${subjectUrl(first.id)}`,
    );
  });

  it('substitutes an asterisk for a missing air date', () => {
    const subject = { ...loadSearchFixture()[0], date: null };
    assert.match(displaySubjectBase(subject, 1), /Air Date: \*/);
  });

  it('formats a full subject the way `bgm get` prints it', () => {
    const lines = displaySubject({ id: 1671, name: '化物語', name_cn: '化物语', summary: 's', date: '2009-07-03' }).split('\n');
    assert.deepEqual(lines, ['* 化物語 / 化物语', '* https://bgm.tv/subject/1671', '  Air Date: 2009-07-03', '* s']);
  });
});

describe('person decoding', () => {
  const person = { id: 1, type: 1, career: ['seiyu'], name: '斎藤千和', relation: '主角' };

  it('accepts every career the API documents', () => {
    assert.deepEqual(decodePerson({ ...person, career: ['producer', 'mangaka', 'artist'] }).career, [
      'producer',
      'mangaka',
      'artist',
    ]);
  });

  it('rejects an unknown career the way serde does', () => {
    assert.throws(() => decodePerson({ ...person, career: ['wizard'] }), {
      message:
        'unknown variant `wizard`, expected one of `producer`, `mangaka`, `artist`, `seiyu`, `writer`, `illustrator`, `actor`',
    });
  });

  it('requires the career field, unlike Actor', () => {
    assert.throws(() => decodePerson({ id: 1, type: 1, name: 'x', relation: 'y' }));
  });
});

describe('staff and character display', () => {
  it('sorts by code point, removes duplicates and joins with slashes', () => {
    const persons = [{ name: 'b' }, { name: 'a' }, { name: 'b' }];
    assert.equal(displayPersons(persons), '* staff: a/b');
  });

  it('labels character lists distinctly', () => {
    assert.equal(displayCharacters([{ name: 'z' }, { name: 'a' }]), '* characters: a/z');
  });
});

describe('BgmError', () => {
  it('renders the title, description and debug-formatted details', () => {
    const error = decodeBgmError(loadApiFixture('error_404').body);
    assert.ok(error instanceof BgmError);
    assert.equal(
      error.display(),
      '[Not Found] resource can\'t be found in the database or has been removed\n* Map({"path": "/v0/subjects/999999999", "method": "GET"})',
    );
  });
});

describe('EpisodeType', () => {
  it('maps every discriminant the API can return', () => {
    assert.deepEqual(
      [EpisodeType.Honpen, EpisodeType.Sp, EpisodeType.OP, EpisodeType.ED, EpisodeType.CM, EpisodeType.MAD, EpisodeType.Other],
      [0, 1, 2, 3, 4, 5, 6],
    );
  });
});
