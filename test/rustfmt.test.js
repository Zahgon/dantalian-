import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compareByCodePoint,
  dedupConsecutive,
  f64,
  INVALID_FLOAT_ERROR,
  padStartChars,
  PARSE_ERROR,
  parseRustF64,
  rustFloatDisplay,
  rustFloatParseErrorMessage,
  rustIntDisplay,
  serdeJsonNumberToString,
  zeroPadFloat,
} from '../src/rustfmt.js';

describe('rustFloatDisplay', () => {
  it('drops the fractional part of whole numbers', () => {
    assert.equal(rustFloatDisplay(8), '8');
    assert.equal(rustFloatDisplay(1), '1');
    assert.equal(rustFloatDisplay(0), '0');
    assert.equal(rustFloatDisplay(13), '13');
    assert.equal(rustFloatDisplay(24), '24');
    assert.equal(rustFloatDisplay(62), '62');
  });

  it('keeps genuine fractions', () => {
    assert.equal(rustFloatDisplay(5.5), '5.5');
    assert.equal(rustFloatDisplay(29.5), '29.5');
    assert.equal(rustFloatDisplay(0.1 + 0.2), '0.30000000000000004');
  });

  it('expands exponent notation the way Rust does', () => {
    assert.equal(rustFloatDisplay(1e21), '1000000000000000000000');
  });

  it('renders the non-finite spellings Rust uses', () => {
    assert.equal(rustFloatDisplay(Number.POSITIVE_INFINITY), 'inf');
    assert.equal(rustFloatDisplay(Number.NEGATIVE_INFINITY), '-inf');
    assert.equal(rustFloatDisplay(Number.NaN), 'NaN');
    assert.equal(rustFloatDisplay(-0), '-0');
  });
});

describe('serdeJsonNumberToString', () => {
  it('keeps a .0 suffix for floats, matching serde_json inside templates', () => {
    assert.equal(serdeJsonNumberToString(f64(8)), '8.0');
    assert.equal(serdeJsonNumberToString(f64(7.35)), '7.35');
    assert.equal(serdeJsonNumberToString(8.4), '8.4');
  });

  it('renders integers bare', () => {
    assert.equal(serdeJsonNumberToString(0), '0');
    assert.equal(serdeJsonNumberToString(25103), '25103');
  });
});

describe('parseRustF64', () => {
  it('accepts every literal form f64::from_str accepts', () => {
    assert.equal(parseRustF64('1'), 1);
    assert.equal(parseRustF64('1.'), 1);
    assert.equal(parseRustF64('.5'), 0.5);
    assert.equal(parseRustF64('1e3'), 1000);
    assert.equal(parseRustF64('+1.5'), 1.5);
    assert.equal(parseRustF64('inf'), Number.POSITIVE_INFINITY);
    assert.equal(parseRustF64('-INFINITY'), Number.NEGATIVE_INFINITY);
    assert.ok(Number.isNaN(parseRustF64('NaN')));
  });

  it('rejects the forms JS would otherwise coerce', () => {
    for (const input of ['', ' 1', '1 ', '1_0', '0x1', '1.2.3', 'abc']) {
      assert.equal(parseRustF64(input), PARSE_ERROR, `expected ${JSON.stringify(input)} to fail`);
    }
  });

  it('reports the Rust error text used as an episode index when offsets fail', () => {
    assert.equal(rustFloatParseErrorMessage('5.5.5'), INVALID_FLOAT_ERROR);
    assert.equal(rustFloatParseErrorMessage('5.5.5'), 'invalid float literal');
  });
});

describe('width formatting', () => {
  it('pads to a width counted in code points, not UTF-16 units', () => {
    assert.equal(padStartChars('01', 6), '    01');
    assert.equal(padStartChars('SP5.5', 6), ' SP5.5');
    assert.equal(padStartChars('SP10.5', 6), 'SP10.5');
    assert.equal(padStartChars('化物語', 5), '  化物語');
  });

  it('zero-pads the integer part only, like {:02}', () => {
    assert.equal(zeroPadFloat(1, 2), '01');
    assert.equal(zeroPadFloat(5.5, 2), '5.5');
    assert.equal(zeroPadFloat(62, 2), '62');
    assert.equal(zeroPadFloat(0, 2), '00');
  });
});

describe('Rust collection semantics', () => {
  it('orders strings by code point rather than UTF-16 code unit', () => {
    const input = ['\u{1f600}', '\ufb00', 'a'];
    assert.deepEqual([...input].sort(compareByCodePoint), ['a', '\ufb00', '\u{1f600}']);
  });

  it('removes only consecutive duplicates, like Vec::dedup', () => {
    assert.deepEqual(dedupConsecutive(['a', 'a', 'b', 'a']), ['a', 'b', 'a']);
  });
});

describe('rustIntDisplay', () => {
  it('renders integers without a fractional part', () => {
    assert.equal(rustIntDisplay(0), '0');
    assert.equal(rustIntDisplay(25103), '25103');
    assert.equal(rustIntDisplay(-7), '-7');
  });
});

describe('the f64 marker wrapper', () => {
  it('unwraps to the underlying number in arithmetic and comparisons', () => {
    assert.equal(f64(8).valueOf(), 8);
    assert.equal(f64(7.35) + 0, 7.35);
    assert.ok(f64(8.4) > 8);
  });

  it('serialises as a bare number so recorded fixtures stay readable', () => {
    assert.equal(JSON.stringify(f64(8)), '8');
    assert.equal(JSON.stringify({ score: f64(7.35) }), '{"score":7.35}');
  });

  it('still renders with a trailing .0 when a template prints it', () => {
    assert.equal(serdeJsonNumberToString(f64(8)), '8.0');
    assert.equal(rustFloatDisplay(f64(8).valueOf()), '8');
  });
});
