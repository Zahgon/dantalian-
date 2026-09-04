import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { compileRegex } from '../src/vendor/rust-regex.js';
import { duplicateKeys, parseToml, stringifyToml } from '../src/vendor/toml.js';

describe('toml writer', () => {
  it('reproduces the byte layout of toml::to_string', () => {
    const output = stringifyToml([
      ['subject_id', 185792],
      ['episode_re', '^(?P<name>リトルウィッチアカデミア|小魔女学园) (?P<sp>SP)?(?P<ep>[.\\d]+)\\.'],
      ['episode_offset', 0],
    ]);
    assert.equal(
      output,
      'subject_id = 185792\n' +
        'episode_re = "^(?P<name>リトルウィッチアカデミア|小魔女学园) (?P<sp>SP)?(?P<ep>[.\\\\d]+)\\\\."\n' +
        'episode_offset = 0\n',
    );
  });

  it('omits absent optional fields entirely', () => {
    assert.equal(stringifyToml([['subject_id', 1], ['episode_re', null], ['episode_offset', undefined]]), 'subject_id = 1\n');
  });
});

describe('toml reader', () => {
  it('reads the config shape the tool writes', () => {
    const parsed = parseToml('subject_id = 369304\nepisode_offset = 24\n');
    assert.deepEqual({ ...parsed }, { subject_id: 369304, episode_offset: 24 });
  });

  it('returns a null-prototype object so a `__proto__` key cannot pollute', () => {
    assert.equal(Object.getPrototypeOf(parseToml('subject_id = 1\n')), null);
  });

  it('unescapes backslashes inside basic strings', () => {
    assert.equal(parseToml('episode_re = "^.*\\\\[(?P<ep>\\\\d\\\\d)\\\\].*\\\\.mp4$"\n').episode_re, '^.*\\[(?P<ep>\\d\\d)\\].*\\.mp4$');
  });

  it('reports syntax errors with serde-style line and column positions', () => {
    assert.throws(
      () => parseToml('subject_id 1671\n'),
      (error) => error.message === 'expected an equals, found an identifier at line 1 column 12',
    );
    assert.throws(
      () => parseToml('subject_id = "abc\n'),
      (error) => error.message === 'newline in string found at line 1 column 18',
    );
  });

  it('skips table sections instead of rejecting them, as serde does', () => {
    const table = parseToml('subject_id = 1671\n[extra]\nx = 1\n');
    assert.equal(table.subject_id, 1671);
    assert.equal(table.x, undefined);
  });

  it('records duplicate keys rather than throwing, leaving the choice to serde', () => {
    const table = parseToml('subject_id = 1\nsubject_id = 2\nbogus = 1\n');
    assert.equal(table.subject_id, 2);
    assert.deepEqual(duplicateKeys(table), ['subject_id']);
  });
});

describe('rust-regex translation', () => {
  it('accepts Rust named groups and preserves the original source for round-tripping', () => {
    const source = String.raw`^(?P<name>.+?)(?P<tags> (\[[^\s]+\])+)?$`;
    const re = compileRegex(source);
    assert.equal(re.toString(), source);
    assert.equal(re.captures('化物語 [2009][BDRip]').name('name').asStr, '化物語');
    assert.equal(re.captures('化物語 [2009][BDRip]').name('tags').asStr, ' [2009][BDRip]');
  });

  it('leaves a bare directory name entirely in the name group', () => {
    const re = compileRegex(String.raw`^(?P<name>.+?)(?P<tags> (\[[^\s]+\])+)?$`);
    assert.equal(re.captures('ビルディバイド -#000000-').name('name').asStr, 'ビルディバイド -#000000-');
  });

  it('treats \\d as Unicode-aware, like the regex crate', () => {
    const re = compileRegex(String.raw`^(?P<ep>[.\d]+)$`);
    assert.equal(re.captures('１２').name('ep').asStr, '１２');
    assert.equal(re.captures('5.5').name('ep').asStr, '5.5');
  });

  it('matches the episode pattern the tool generates', () => {
    const re = compileRegex(String.raw`^(?P<name>化物語) (?P<sp>SP)?(?P<ep>[.\d]+)\.`);
    const sp = re.captures('化物語 SP5.5.mp4');
    assert.equal(sp.name('sp').asStr, 'SP');
    assert.equal(sp.name('ep').asStr, '5.5');
    const normal = re.captures('化物語 01.mkv');
    assert.equal(normal.name('sp'), null);
    assert.equal(normal.name('ep').asStr, '01');
  });

  it('returns null when nothing matches', () => {
    assert.equal(compileRegex(String.raw`^(?P<ep>\d+)$`).captures('nope'), null);
  });

  it('accepts punctuation escapes that JS unicode mode would reject', () => {
    const source = String.raw`^a\%b`;
    const re = compileRegex(source);
    assert.equal(re.toString(), source);
    assert.equal(re.regexp.source, '^a%b');
    assert.notEqual(re.captures('a%b'), null);
  });
});

describe('rust regex diagnostics', () => {
  const MISSING = 'repetition operator missing expression';
  const DECIMAL = 'repetition quantifier expects a valid decimal';
  const UNCLOSED = 'unclosed counted repetition';
  const LOOKAROUND = 'look-around, including look-ahead and look-behind, is not supported';

  const cases = [
    ['*abc', [[0, 1]], MISSING],
    ['^(*a)', [[2, 1]], MISSING],
    ['^a|*b', [[3, 1]], MISSING],
    ['^a{b', [[3, 1]], DECIMAL],
    ['^a{,2}', [[3, 1]], DECIMAL],
    ['^a{', [[2, 1]], UNCLOSED],
    ['^a{2,', [[2, 3]], UNCLOSED],
    ['^a{2,1}', [[2, 5]], 'invalid repetition count range, the start must be <= the end'],
    ['^a{4294967296}', [[3, 10]], 'decimal literal invalid'],
    ['^((a', [[2, 1]], 'unclosed group'],
    ['^a)b', [[2, 1]], 'unopened group'],
    ['^(?P<ep>[', [[8, 1]], 'unclosed character class'],
    ['^[z-a]', [[2, 3]], 'invalid character class range, the start must be <= the end'],
    ['^(?=a)b', [[1, 3]], LOOKAROUND],
    ['^(?<=a)b', [[1, 4]], LOOKAROUND],
    ['^(a)\\1', [[4, 2]], 'backreferences are not supported'],
    ['^\\q', [[1, 2]], 'unrecognized escape sequence'],
    ['^(?P<1x>a)', [[5, 1]], 'invalid capture group character'],
    ['^(?P<abc>x)(?P<abc>y)', [[5, 3], [15, 3]], 'duplicate capture group name'],
  ];

  for (const [pattern, spans, message] of cases) {
    it(`reports ${JSON.stringify(pattern)} exactly as regex-syntax does`, () => {
      let carets = '';
      for (const [start, length] of spans) carets = carets.padEnd(start, ' ') + '^'.repeat(length);
      const expected = `regex parse error:\n    ${pattern}\n    ${carets}\nerror: ${message}`;
      assert.throws(() => compileRegex(pattern), (error) => error.message === expected);
    });
  }

  it('accepts quantified anchors, which Rust allows but JS rejects natively', () => {
    for (const pattern of ['^*abc', '$*abc', '^{2}abc', '\\b*abc', '\\A*abc']) {
      assert.notEqual(compileRegex(pattern).captures('abc'), undefined, pattern);
    }
    assert.notEqual(compileRegex('^*abc').captures('abc'), null);
  });

  it('leaves non-capturing groups and inline flags intact', () => {
    assert.notEqual(compileRegex('^(?:ab)+c').captures('ababc'), null);
    assert.notEqual(compileRegex('(?i)^abc').captures('ABC'), null);
  });

  it('accepts the largest u32 repetition count regex-syntax parses', () => {
    assert.equal(compileRegex('^a{4294967295}').toString(), '^a{4294967295}');
  });
});
