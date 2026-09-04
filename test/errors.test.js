import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  anyhow,
  causeChain,
  ContextError,
  displayError,
  formatAnyhowError,
  rootCause,
  withContext,
  withContextAsync,
} from '../src/errors.js';
import { IoError, toIoError, WalkDirError } from '../src/vendor/io-error.js';

describe('context chains', () => {
  it('makes the context the message and keeps the cause reachable', () => {
    const cause = anyhow('not found');
    const wrapped = new ContextError('request get subject: 1671', cause);
    assert.equal(wrapped.message, 'request get subject: 1671');
    assert.equal(wrapped.context, 'request get subject: 1671');
    assert.equal(wrapped.cause, cause);
  });

  it('accepts a lazy context producer, matching with_context', () => {
    let built = 0;
    const wrapped = withContext(anyhow('inner'), () => {
      built += 1;
      return 'outer';
    });
    assert.equal(wrapped.message, 'outer');
    assert.equal(built, 1);
  });

  it('leaves a successful call untouched and does not build the context', () => {
    let built = 0;
    return withContextAsync(
      () => 'value',
      () => {
        built += 1;
        return 'unused';
      },
    ).then((result) => {
      assert.equal(result, 'value');
      assert.equal(built, 0);
    });
  });

  it('wraps whatever the callback throws', async () => {
    await assert.rejects(
      withContextAsync(() => {
        throw anyhow('boom');
      }, 'get_anime_data'),
      (error) => error.message === 'get_anime_data' && error.cause.message === 'boom',
    );
  });

  it('walks the chain nearest-first and reports the deepest cause', () => {
    const deep = withContext(withContext(anyhow('root'), 'middle'), 'top');
    assert.deepEqual(
      causeChain(deep).map((error) => displayError(error)),
      ['middle', 'root'],
    );
    assert.equal(displayError(rootCause(deep)), 'root');
  });

  it('treats an error with no cause as its own root', () => {
    const solo = anyhow('alone');
    assert.deepEqual(causeChain(solo), []);
    assert.equal(rootCause(solo), solo);
  });

  it('prefers a custom display() over the raw message', () => {
    const custom = Object.assign(anyhow('ignored'), { display: () => 'rendered' });
    assert.equal(displayError(custom), 'rendered');
  });

  it('renders a bare error without a Caused by block', () => {
    assert.equal(formatAnyhowError(anyhow('only')), 'Error: only');
  });

  it('indents every cause line by four spaces', () => {
    const wrapped = withContext(anyhow('inner\nsecond line'), 'outer');
    assert.equal(
      formatAnyhowError(wrapped),
      'Error: outer\n\nCaused by:\n    inner\n    second line',
    );
  });
});

describe('io errors', () => {
  it('renders a Node errno the way std::io::Error does', () => {
    const error = toIoError(Object.assign(new Error('ignored'), { code: 'ENOENT' }));
    assert.ok(error instanceof IoError);
    assert.equal(error.message, 'No such file or directory (os error 2)');
  });

  it('maps a permission failure to its own errno', () => {
    assert.equal(
      toIoError(Object.assign(new Error('x'), { code: 'EACCES' })).message,
      'Permission denied (os error 13)',
    );
  });

  it('passes through anything that is not an errno error', () => {
    const plain = anyhow('not an io error');
    assert.equal(toIoError(plain), plain);
  });

  it('names the path in a walkdir failure and keeps the io error as the cause', () => {
    const io = new IoError(Object.assign(new Error('x'), { code: 'ENOENT' }));
    const walk = new WalkDirError('/nonexistent', io);
    assert.equal(
      walk.message,
      'IO error for operation on /nonexistent: No such file or directory (os error 2)',
    );
    assert.equal(
      formatAnyhowError(walk),
      'Error: IO error for operation on /nonexistent: No such file or directory (os error 2)\n\nCaused by:\n    No such file or directory (os error 2)',
    );
  });
});
