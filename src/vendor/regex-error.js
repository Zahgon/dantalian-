import { anyhow } from '../errors.js';

const INDENT = '    ';

/**
 * Build a `regex-syntax` style parse error.
 *
 * The rendering is load-bearing: it reaches the user verbatim through
 * dantalian's per-directory `Failed:` log line, so it reproduces the caret
 * diagram the Rust `regex` crate emits.
 *
 * @param {string} pattern the original Rust pattern source
 * @param {Array<{start: number, length: number}>} spans offsets in code points, ascending
 * @param {string} message the `error:` line, without its prefix
 * @returns {Error}
 */
export function regexParseError(pattern, spans, message) {
  let carets = '';
  for (const span of spans) {
    carets = carets.padEnd(span.start, ' ') + '^'.repeat(span.length);
  }
  return anyhow(`regex parse error:\n${INDENT}${pattern}\n${INDENT}${carets}\nerror: ${message}`);
}

const ESCAPE_LETTERS = new Set('aftnrv0AzbBdDsSwWpPxuU');
const NAME_CHAR = /[0-9A-Za-z_]/;
const LOOKAROUND = 'look-around, including look-ahead and look-behind, is not supported';
const MISSING_EXPRESSION = 'repetition operator missing expression';
const UNCLOSED_REPETITION = 'unclosed counted repetition';
const INVALID_DECIMAL = 'repetition quantifier expects a valid decimal';
/** Repetition counts are parsed as `u32` by `regex-syntax`. */
const MAX_REPETITION = 4294967295;

/**
 * Read a repetition bound, returning `null` when no digits are present.
 *
 * @param {string} pattern
 * @param {string[]} chars
 * @param {number} cursor
 * @returns {{value: number, end: number}|null}
 */
function readRepetitionCount(pattern, chars, cursor) {
  let end = cursor;
  while (end < chars.length && chars[end] >= '0' && chars[end] <= '9') end += 1;
  if (end === cursor) return null;
  const value = Number(chars.slice(cursor, end).join(''));
  if (value > MAX_REPETITION) {
    throw regexParseError(pattern, [{ start: cursor, length: end - cursor }], 'decimal literal invalid');
  }
  return { value, end };
}

/**
 * Validate a `{n}`, `{n,}` or `{n,m}` counted repetition starting at `start`.
 *
 * Rust treats every `{` that follows an expression as a repetition, so a brace
 * is never an implicit literal the way it can be in other engines.
 *
 * @param {string} pattern
 * @param {string[]} chars
 * @param {number} start index of the `{`
 * @throws {Error} a {@link regexParseError}
 */
function validateRepetition(pattern, chars, start) {
  const unclosed = { start, length: chars.length - start };
  let cursor = start + 1;
  if (cursor >= chars.length) throw regexParseError(pattern, [unclosed], UNCLOSED_REPETITION);

  const min = readRepetitionCount(pattern, chars, cursor);
  if (min === null) throw regexParseError(pattern, [{ start: cursor, length: 1 }], INVALID_DECIMAL);
  cursor = min.end;

  let max = min;
  if (chars[cursor] === ',') {
    cursor += 1;
    if (cursor >= chars.length) throw regexParseError(pattern, [unclosed], UNCLOSED_REPETITION);
    if (chars[cursor] === '}') {
      max = null;
    } else {
      max = readRepetitionCount(pattern, chars, cursor);
      if (max === null) throw regexParseError(pattern, [{ start: cursor, length: 1 }], INVALID_DECIMAL);
      cursor = max.end;
    }
  }

  if (cursor >= chars.length) throw regexParseError(pattern, [unclosed], UNCLOSED_REPETITION);
  if (chars[cursor] !== '}') throw regexParseError(pattern, [{ start: cursor, length: 1 }], INVALID_DECIMAL);
  if (max !== null && max.value < min.value) {
    throw regexParseError(
      pattern,
      [{ start, length: cursor + 1 - start }],
      'invalid repetition count range, the start must be <= the end',
    );
  }
}

export function isRecognizedEscape(ch) {
  if (ESCAPE_LETTERS.has(ch)) return true;
  const code = ch.codePointAt(0);
  return code < 128 && !/[0-9A-Za-z]/.test(ch) && code > 32;
}


/**
 * Reject the Rust patterns whose failure text the port must reproduce.
 *
 * Runs before translation to JS syntax so offsets still refer to the source the
 * user wrote. Only the errors reachable from a hand-written `episode_re` are
 * detected; anything subtler is left to the JS engine.
 *
 * @param {string} pattern
 * @throws {Error} a {@link regexParseError}
 */
export function validatePattern(pattern) {
  const chars = [...pattern];
  /** @type {number[]} */
  const groups = [];
  /** @type {Map<string, {start: number, length: number}>} */
  const names = new Map();
  let classStart = -1;
  // Whether a repeatable expression precedes the cursor. Anchors count, which
  // is why Rust accepts `^*`.
  let atom = false;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];

    if (ch === '\\') {
      const next = chars[i + 1];
      if (next === undefined) {
        throw regexParseError(pattern, [{ start: i, length: 1 }], 'incomplete escape sequence, reached end of pattern prematurely');
      }
      if (next >= '1' && next <= '9') {
        throw regexParseError(pattern, [{ start: i, length: 2 }], 'backreferences are not supported');
      }
      if (!isRecognizedEscape(next)) {
        throw regexParseError(pattern, [{ start: i, length: 2 }], 'unrecognized escape sequence');
      }
      i += 1;
      atom = true;
      continue;
    }

    if (classStart !== -1) {
      if (ch === ']' && i > classStart + 1 && !(chars[classStart + 1] === '^' && i === classStart + 2)) {
        classStart = -1;
        atom = true;
      } else if (chars[i + 1] === '-' && chars[i + 2] !== undefined && chars[i + 2] !== ']') {
        const end = chars[i + 2];
        if (end !== '\\' && ch.codePointAt(0) > end.codePointAt(0)) {
          throw regexParseError(pattern, [{ start: i, length: 3 }], 'invalid character class range, the start must be <= the end');
        }
        i += 2;
      }
      continue;
    }

    if (ch === '[') {
      classStart = i;
      continue;
    }

    if (ch === '*' || ch === '+' || ch === '?' || ch === '{') {
      if (!atom) throw regexParseError(pattern, [{ start: i, length: 1 }], MISSING_EXPRESSION);
      if (ch === '{') validateRepetition(pattern, chars, i);
      continue;
    }

    if (ch === ')') {
      if (groups.length === 0) {
        throw regexParseError(pattern, [{ start: i, length: 1 }], 'unopened group');
      }
      groups.pop();
      atom = true;
      continue;
    }

    if (ch === '|') {
      atom = false;
      continue;
    }

    if (ch !== '(') {
      atom = true;
      continue;
    }

    groups.push(i);
    atom = false;
    if (chars[i + 1] !== '?') continue;

    const marker = chars[i + 2];
    if (marker === '=' || marker === '!') {
      throw regexParseError(pattern, [{ start: i, length: 3 }], LOOKAROUND);
    }
    if (marker === '<' && (chars[i + 3] === '=' || chars[i + 3] === '!')) {
      throw regexParseError(pattern, [{ start: i, length: 4 }], LOOKAROUND);
    }

    const nameStart = marker === '<' ? i + 3 : marker === 'P' && chars[i + 3] === '<' ? i + 4 : -1;
    if (nameStart === -1) {
      // Step over the `?` so it is not mistaken for a quantifier next pass.
      i += 1;
      continue;
    }

    let cursor = nameStart;
    while (cursor < chars.length && chars[cursor] !== '>') {
      if (!NAME_CHAR.test(chars[cursor]) || (cursor === nameStart && /[0-9]/.test(chars[cursor]))) {
        throw regexParseError(pattern, [{ start: cursor, length: 1 }], 'invalid capture group character');
      }
      cursor += 1;
    }

    const span = { start: nameStart, length: cursor - nameStart };
    const name = chars.slice(nameStart, cursor).join('');
    const previous = names.get(name);
    if (previous !== undefined) {
      throw regexParseError(pattern, [previous, span], 'duplicate capture group name');
    }
    names.set(name, span);
    i = cursor;
  }

  if (classStart !== -1) {
    throw regexParseError(pattern, [{ start: classStart, length: 1 }], 'unclosed character class');
  }
  if (groups.length > 0) {
    throw regexParseError(pattern, [{ start: groups[groups.length - 1], length: 1 }], 'unclosed group');
  }
}
