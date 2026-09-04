import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { debug, error, indent, info, setMaxLevel, trace, warn } from '../src/logger.js';

function capture(fn) {
  const written = [];
  const stub = mock.method(process.stdout, 'write', (chunk) => {
    written.push(chunk);
    return true;
  });
  try {
    fn();
  } finally {
    stub.mock.restore();
  }
  return written.join('');
}

describe('logger', () => {
  afterEach(() => {
    setMaxLevel('info');
    delete process.env.NO_COLOR;
    delete process.env.CLICOLOR_FORCE;
  });

  it('indents two columns per level and saturates at twenty-four', () => {
    assert.equal(indent(0), '');
    assert.equal(indent(1), '  ');
    assert.equal(indent(4), '        ');
    assert.equal(indent(12), ' '.repeat(24));
    assert.equal(indent(99), ' '.repeat(24));
  });

  it('sends every level to stdout, not stderr', () => {
    setMaxLevel('trace');
    process.env.NO_COLOR = '1';
    const out = capture(() => {
      info('i');
      error('e');
      warn('w');
      debug('d');
      trace('t');
    });
    assert.equal(out, 'i\ne\nw\nd\nt\n');
  });

  it('suppresses levels below the maximum', () => {
    setMaxLevel('info');
    const out = capture(() => {
      debug('hidden');
      trace('hidden');
      info('shown');
    });
    assert.equal(out, 'shown\n');
  });

  it('drops everything at the off level', () => {
    setMaxLevel('off');
    assert.equal(
      capture(() => {
        error('gone');
        info('gone');
      }),
      '',
    );
  });

  it('applies the indent prefix only when one is given', () => {
    process.env.NO_COLOR = '1';
    const out = capture(() => {
      info('plain');
      info('nested', 2);
    });
    assert.equal(out, 'plain\n    nested\n');
  });

  it('colours errors red and warnings yellow when colour is forced', () => {
    process.env.CLICOLOR_FORCE = '1';
    setMaxLevel('trace');
    const out = capture(() => {
      error('bad');
      warn('careful');
      info('neutral');
    });
    assert.equal(out, '\u001b[31mbad\u001b[0m\n\u001b[33mcareful\u001b[0m\n' + 'neutral\n');
  });

  it('honours NO_COLOR over terminal detection', () => {
    process.env.NO_COLOR = '1';
    assert.equal(
      capture(() => {
        error('bad');
      }),
      'bad\n',
    );
  });

  it('indents the first line only, leaving the root cause flush left', () => {
    process.env.NO_COLOR = '1';
    const out = capture(() => {
      error('Failed: outer\ninner', 2);
    });
    assert.equal(out, '    Failed: outer\ninner\n');
  });
});
