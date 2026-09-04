import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { bestSuggestion, didYouMean } from '../src/options/clap-error.js';
import { ClapError, ClapExit, parseOpts } from '../src/options/index.js';
import { ROOT_HELP, VERSION_TEXT } from '../src/options/help.js';

function parseError(argv) {
  try {
    parseOpts(argv);
  } catch (error) {
    assert.ok(error instanceof ClapError, `expected a ClapError for ${JSON.stringify(argv)}`);
    return error;
  }
  throw new assert.AssertionError({ message: `expected ${JSON.stringify(argv)} to fail` });
}

describe('option parsing', () => {
  it('collects repeated flags and single-valued options', () => {
    assert.deepEqual(
      parseOpts(['-v', '-s', 'a', '-s', 'b', '--force', 'p', '--force-all', '--access-token', 'T']),
      {
        verbose: true,
        source: ['a', 'b'],
        movie_source: [],
        force: ['p'],
        force_all: true,
        access_token: 'T',
        subcmd: null,
      },
    );
  });

  it('defaults every option when no arguments are given', () => {
    assert.deepEqual(parseOpts([]), {
      verbose: false,
      source: [],
      movie_source: [],
      force: [],
      force_all: false,
      access_token: null,
      subcmd: null,
    });
  });

  it('builds each bgm subcommand', () => {
    assert.deepEqual(parseOpts(['bgm', 'search', 'little', 'witch']).subcmd, {
      type: 'bgm',
      bgm: { type: 'search', keyword: ['little', 'witch'] },
    });
    assert.deepEqual(parseOpts(['bgm', 'get', '1671', '--no-persons']).subcmd, {
      type: 'bgm',
      bgm: { type: 'get', id: 1671, no_persons: true, no_characters: false },
    });
    assert.deepEqual(parseOpts(['bgm', 'get-ep', '1671']).subcmd, {
      type: 'bgm',
      bgm: { type: 'get-ep', id: 1671 },
    });
  });

  it('accepts inline and attached value forms', () => {
    assert.deepEqual(parseOpts(['--source=a', '-sb', '-m', 'c']).source, ['a', 'b']);
    assert.deepEqual(parseOpts(['-vs', 'a']).verbose, true);
  });

  it('stops interpreting flags after a bare double dash', () => {
    assert.deepEqual(parseOpts(['bgm', 'search', '--', '--not-a-flag']).subcmd.bgm.keyword, [
      '--not-a-flag',
    ]);
  });

  it('exits successfully for help and version', () => {
    for (const argv of [['--help'], ['-h'], ['help']]) {
      assert.throws(
        () => parseOpts(argv),
        (error) => error instanceof ClapExit && error.code === 0 && error.output === ROOT_HELP,
      );
    }
    assert.throws(
      () => parseOpts(['--version']),
      (error) => error instanceof ClapExit && error.output === VERSION_TEXT,
    );
  });
});

describe('option errors', () => {
  it('reports missing required positionals', () => {
    assert.equal(
      parseError(['bgm', 'get']).output,
      'error: The following required arguments were not provided:\n' +
        '    <ID>\n\nUSAGE:\n    dantalian bgm get [OPTIONS] <ID>\n\nFor more information try --help\n',
    );
  });

  it('reports an unrecognized subcommand after help without suggesting one', () => {
    assert.equal(
      parseError(['help', 'badthing']).output,
      "error: The subcommand 'badthing' wasn't recognized\n\n" +
        'USAGE:\n    dantalian [OPTIONS] [SUBCOMMAND]\n\nFor more information try --help\n',
    );
  });

  it('suggests a close subcommand', () => {
    assert.equal(
      parseError(['bg']).output,
      "error: The subcommand 'bg' wasn't recognized\n\n\tDid you mean 'bgm'?\n\n" +
        "If you believe you received this message in error, try re-running with 'dantalian -- bg'\n\n" +
        'USAGE:\n    dantalian [OPTIONS] [SUBCOMMAND]\n\nFor more information try --help\n',
    );
  });

  it('keeps the value placeholder in a suggested flag usage line', () => {
    assert.equal(
      parseError(['--sourc', 'x']).output,
      "error: Found argument '--sourc' which wasn't expected, or isn't valid in this context\n\n" +
        "\tDid you mean '--source'?\n\n" +
        '\tIf you tried to supply `--sourc` as a value rather than a flag, use `-- --sourc`\n\n' +
        'USAGE:\n    dantalian --source <SOURCE>\n\nFor more information try --help\n',
    );
  });

  it('omits the placeholder when the suggested flag takes no value', () => {
    assert.match(parseError(['--verbos']).output, /USAGE:\n {4}dantalian --verbose\n/);
  });

  it('appends required positionals to a suggested subcommand usage line', () => {
    assert.match(
      parseError(['bgm', 'get', '--no-person', '1']).output,
      /USAGE:\n {4}dantalian bgm get --no-persons <ID>\n/,
    );
  });

  it('rejects unparsable and out-of-range integers', () => {
    assert.equal(
      parseError(['bgm', 'get', 'abc']).output,
      'error: Invalid value "abc" for \'<ID>\': invalid digit found in string\n\n' +
        'For more information try --help\n',
    );
    assert.match(
      parseError(['bgm', 'get', '4294967296']).output,
      /number too large to fit in target type/,
    );
  });

  it('rejects repeated single-occurrence flags and stray values', () => {
    assert.match(parseError(['-v', '-v']).output, /was provided more than once/);
    assert.match(parseError(['--force-all=1']).output, /but it wasn't expecting any more values/);
    assert.match(parseError(['--source']).output, /requires a value but none was supplied/);
  });

  it('exits with code two for every parse failure', () => {
    assert.equal(parseError(['--nope']).code, 2);
  });
});

describe('suggestion scoring', () => {
  it('keeps only candidates above the clap confidence threshold', () => {
    assert.deepEqual(didYouMean('b', ['bgm', 'help']), []);
    assert.deepEqual(didYouMean('bg', ['bgm', 'help']), ['bgm']);
  });

  it('returns the strongest candidate, or nothing when none is close', () => {
    assert.equal(bestSuggestion('sourc', ['source', 'movie-source']), 'source');
    assert.equal(bestSuggestion('zzzzzz', ['source', 'help']), null);
  });
});
