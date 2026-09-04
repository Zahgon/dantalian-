import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { golden } from './helpers/fixtures.js';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/dantalian.js', import.meta.url));

async function cli(args) {
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], { encoding: 'utf8' });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    return { stdout: error.stdout ?? '', stderr: error.stderr ?? '', code: error.code };
  }
}

const goldenText = (name) => readFileSync(golden(`help/${name}.txt`), 'utf8');

describe('help and version output', () => {
  const cases = [
    [['--help'], 'root'],
    [['-h'], 'root'],
    [['help'], 'help_sub'],
    [['bgm', '--help'], 'bgm'],
    [['help', 'bgm'], 'bgm'],
    [['bgm', 'get', '--help'], 'bgm_get'],
    [['bgm', 'help', 'get'], 'bgm_get'],
    [['bgm', 'get-ep', '--help'], 'bgm_get_ep'],
    [['bgm', 'search', '--help'], 'bgm_search'],
    [['--version'], 'version'],
    [['-V'], 'version'],
  ];

  for (const [args, name] of cases) {
    it(`\`dantalian ${args.join(' ')}\` matches the Rust golden text exactly`, async () => {
      const { stdout, stderr, code } = await cli(args);
      assert.equal(stdout, goldenText(name));
      assert.equal(stderr, '');
      assert.equal(code, 0);
    });
  }
});

describe('argument errors', () => {
  it('rejects a second positional value for a single-value option, exiting 2', async () => {
    const { stdout, stderr, code } = await cli(['-s', 'a', 'b']);
    assert.equal(stderr, goldenText('err_arity'));
    assert.equal(stdout, '');
    assert.equal(code, 2);
  });

  it('reports a missing value without a usage block', async () => {
    const { stderr, code } = await cli(['--source']);
    assert.equal(stderr, "error: The argument '--source <SOURCE>' requires a value but none was supplied\n\nFor more information try --help\n");
    assert.equal(code, 2);
  });

  it('rejects a repeated flag', async () => {
    const { stderr, code } = await cli(['-v', '-v']);
    assert.match(stderr, /was provided more than once, but cannot be used multiple times/);
    assert.equal(code, 2);
  });

  it('rejects a value attached to a boolean flag', async () => {
    const { stderr, code } = await cli(['--force-all=1']);
    assert.match(stderr, /The value '1' was provided to '--force-all' but it wasn't expecting any more values/);
    assert.equal(code, 2);
  });

  it('validates that an id parses as a u32', async () => {
    assert.match((await cli(['bgm', 'get', 'abc'])).stderr, /Invalid value "abc" for '<ID>': invalid digit found in string/);
    assert.match((await cli(['bgm', 'get', '99999999999'])).stderr, /number too large to fit in target type/);
  });

  it('suggests a near-miss subcommand', async () => {
    const { stderr, code } = await cli(['bg']);
    assert.match(stderr, /The subcommand 'bg' wasn't recognized/);
    assert.match(stderr, /Did you mean 'bgm'\?/);
    assert.equal(code, 2);
  });

  it('prints the bgm help to stderr when its subcommand is missing', async () => {
    const { stdout, stderr, code } = await cli(['bgm']);
    assert.equal(stderr, goldenText('bgm'));
    assert.equal(stdout, '');
    assert.equal(code, 2);
  });
});

describe('no-op invocation', () => {
  it('does nothing and exits 0 when given no sources', async () => {
    const { stdout, stderr, code } = await cli([]);
    assert.equal(stdout, goldenText('bare'));
    assert.equal(stdout, '');
    assert.equal(stderr, '');
    assert.equal(code, 0);
  });
});

describe('runtime failures', () => {
  it('prints an anyhow-style cause chain and exits 1 for a missing source directory', async () => {
    const { stdout, stderr, code } = await cli(['-s', '/nonexistent-dantalian-path']);
    assert.equal(stdout, 'Run dantalian for /nonexistent-dantalian-path\n');
    assert.equal(
      stderr,
      'Error: IO error for operation on /nonexistent-dantalian-path: No such file or directory (os error 2)\n\n' +
        'Caused by:\n    No such file or directory (os error 2)\n',
    );
    assert.equal(code, 1);
  });
});
