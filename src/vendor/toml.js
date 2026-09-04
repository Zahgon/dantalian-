// Minimal TOML reader plus a writer that matches `toml` 0.5.9's
// `toml::to_string` byte-for-byte for the flat, scalar-only tables that
// `dantalian.toml` uses.
//
// A full TOML implementation is deliberately out of scope: the only document
// this program ever reads or writes is
//
//   subject_id     = <integer>
//   episode_re     = "<string>"    (optional)
//   episode_offset = <integer>     (optional, may be negative)
//
// The writer's output shape was verified by round-tripping every config in
// `examples/` through the Rust binary.

import { anyhow } from '../errors.js';
import { rustFloatDisplay } from '../rustfmt.js';

/**
 * Decode a TOML basic-string escape sequence.
 *
 * @param {string} body the raw characters between the delimiting quotes
 * @param {string} where a description of the key, used in error messages
 * @returns {string}
 */
function unescapeBasicString(body, where) {
  let out = '';
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    const esc = body[i];
    switch (esc) {
      case 'b': out += '\b'; break;
      case 't': out += '\t'; break;
      case 'n': out += '\n'; break;
      case 'f': out += '\f'; break;
      case 'r': out += '\r'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case 'u': {
        const hex = body.slice(i + 1, i + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw anyhow(`invalid \\u escape in ${where}`);
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        i += 4;
        break;
      }
      case 'U': {
        const hex = body.slice(i + 1, i + 9);
        if (!/^[0-9a-fA-F]{8}$/.test(hex)) throw anyhow(`invalid \\U escape in ${where}`);
        out += String.fromCodePoint(Number.parseInt(hex, 16));
        i += 8;
        break;
      }
      default:
        throw anyhow(`invalid escape character \`\\${esc ?? ''}\` in ${where}`);
    }
  }
  return out;
}

/**
 * Build a `toml` 0.5 diagnostic, which always carries a source position.
 *
 * @param {string} message
 * @param {number} line 1-indexed
 * @param {number} column 1-indexed
 * @returns {Error}
 */
export function tomlError(message, line, column) {
  return anyhow(`${message} at line ${line} column ${column}`);
}

const SPANS = new WeakMap();

/**
 * Look up where a key's value appeared, for serde-style type errors.
 *
 * @param {Record<string, unknown>} table a table returned by {@link parseToml}
 * @param {string} key
 * @returns {{line: number, column: number, kind: string, display: string}|undefined}
 */
export function valueSpan(table, key) {
  return SPANS.get(table)?.[key];
}

const DUPLICATES = new WeakMap();

/**
 * Keys that appeared more than once, in the order the repeat was encountered.
 *
 * Repeats are reported rather than rejected here because `toml` only surfaces
 * them through serde: duplicating a key the target struct ignores is accepted,
 * so only the consumer knows which repeats are errors.
 *
 * @param {Record<string, unknown>} table a table returned by {@link parseToml}
 * @returns {string[]}
 */
export function duplicateKeys(table) {
  return DUPLICATES.get(table) ?? [];
}

const BARE_KEY = /[A-Za-z0-9_-]/;

/**
 * Scan a quoted string starting at `start`, returning its end index.
 *
 * @param {string} line
 * @param {number} start index of the opening quote
 * @param {number} lineNo 1-indexed
 * @returns {number} index just past the closing quote
 */
function scanQuoted(line, start, lineNo) {
  const quote = line[start];
  for (let i = start + 1; i < line.length; i += 1) {
    if (quote === '"' && line[i] === '\\') { i += 1; continue; }
    if (line[i] === quote) return i + 1;
  }
  throw tomlError('newline in string found', lineNo, [...line].length + 1);
}

/**
 * Parse a scalar value beginning at `start`.
 *
 * The reported column follows `toml` 0.5's tokenizer: it is the first character
 * of the value, except for floats, where the crate reports the first digit
 * after the decimal point (`1.5` at column 14 reports 16, `12.75` reports 17).
 *
 * @param {string} line
 * @param {number} start
 * @param {number} lineNo 1-indexed
 * @returns {{value: string|number|boolean, end: number, span: {line: number, column: number, kind: string, display: string}}}
 */
function scanValue(line, start, lineNo) {
  const columnOf = (index) => [...line.slice(0, index)].length + 1;
  const ch = line[start];

  if (line.startsWith('"""', start) || line.startsWith("'''", start)) {
    throw tomlError('multi-line strings are not supported', lineNo, columnOf(start));
  }
  if (ch === '"' || ch === "'") {
    const end = scanQuoted(line, start, lineNo);
    const body = line.slice(start + 1, end - 1);
    const value = ch === '"' ? unescapeBasicString(body, `line ${lineNo}`) : body;
    return { value, end, span: { line: lineNo, column: columnOf(start), kind: 'string', display: JSON.stringify(value) } };
  }

  const rest = line.slice(start);
  const bool = /^(?:true|false)/.exec(rest);
  if (bool !== null) {
    const value = bool[0] === 'true';
    return { value, end: start + bool[0].length, span: { line: lineNo, column: columnOf(start), kind: 'boolean', display: `${value}` } };
  }

  const number = /^[+-]?[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9]+)?/.exec(rest);
  if (number !== null) {
    const token = number[0];
    const end = start + token.length;
    const numeric = token.replace(/_/g, '');
    const dot = token.indexOf('.');
    if (dot === -1 && !/[eE]/.test(token)) {
      const value = Number.parseInt(numeric, 10);
      const display = Number.isSafeInteger(value) ? `${value}` : numeric;
      return { value, end, span: { line: lineNo, column: columnOf(start), kind: 'integer', display } };
    }
    const value = Number.parseFloat(numeric);
    const column = dot === -1 ? columnOf(start) : columnOf(start + dot + 1);
    return { value, end, span: { line: lineNo, column, kind: 'floating point', display: rustFloatDisplay(value) } };
  }

  throw tomlError('expected a value, found an invalid token', lineNo, columnOf(start));
}

/**
 * Parse the subset of TOML that `dantalian.toml` uses into a plain object.
 *
 * Table headers are accepted and their contents ignored, matching serde's
 * treatment of unknown fields in the Rust original: a config carrying a stray
 * `[section]` deserializes there, so it must not fail here either.
 *
 * @param {string} text the file contents
 * @returns {Record<string, string|number|boolean>}
 * @throws {Error} a `toml` 0.5-shaped diagnostic on malformed syntax
 */
export function parseToml(text) {
  /** @type {Record<string, string|number|boolean>} */
  const table = Object.create(null);
  /** @type {Record<string, {line: number, column: number, kind: string, display: string}>} */
  const spans = Object.create(null);
  SPANS.set(table, spans);
  /** @type {string[]} */
  const duplicates = [];
  DUPLICATES.set(table, duplicates);

  const lines = text.split('\n');
  let insideTable = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, '');
    const lineNo = index + 1;
    const columnOf = (at) => [...line.slice(0, at)].length + 1;

    let cursor = 0;
    while (cursor < line.length && (line[cursor] === ' ' || line[cursor] === '\t')) cursor += 1;
    if (cursor >= line.length || line[cursor] === '#') continue;

    if (line[cursor] === '[') {
      if (!line.trimEnd().endsWith(']')) throw tomlError('expected a right bracket', lineNo, columnOf(line.trimEnd().length));
      insideTable = true;
      continue;
    }

    const keyStart = cursor;
    let key;
    if (line[cursor] === '"' || line[cursor] === "'") {
      const end = scanQuoted(line, cursor, lineNo);
      key = line.slice(cursor + 1, end - 1);
      cursor = end;
    } else {
      while (cursor < line.length && BARE_KEY.test(line[cursor])) cursor += 1;
      key = line.slice(keyStart, cursor);
      if (key === '') throw tomlError('expected a table key, found an invalid character', lineNo, columnOf(keyStart));
    }

    while (cursor < line.length && (line[cursor] === ' ' || line[cursor] === '\t')) cursor += 1;
    if (line[cursor] !== '=') {
      const found = cursor >= line.length ? 'a newline' : 'an identifier';
      throw tomlError(`expected an equals, found ${found}`, lineNo, columnOf(cursor));
    }
    cursor += 1;
    while (cursor < line.length && (line[cursor] === ' ' || line[cursor] === '\t')) cursor += 1;
    if (cursor >= line.length) throw tomlError('expected a value, found a newline', lineNo, columnOf(cursor));

    const { value, end, span } = scanValue(line, cursor, lineNo);

    let tail = end;
    while (tail < line.length && (line[tail] === ' ' || line[tail] === '\t')) tail += 1;
    if (tail < line.length && line[tail] !== '#') {
      throw tomlError('expected a newline, found an identifier', lineNo, columnOf(tail));
    }

    if (insideTable) continue;
    if (key in table) duplicates.push(key);
    table[key] = value;
    spans[key] = span;
  }

  return table;
}

/**
 * Escape a string the way `toml` 0.5 writes a basic string.
 *
 * Only backslash, double quote and control characters are escaped; all
 * non-ASCII characters are emitted raw.
 *
 * @param {string} value
 * @returns {string} the escaped body, without the surrounding quotes
 */
function escapeBasicString(value) {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '\\': out += '\\\\'; break;
      case '"': out += '\\"'; break;
      case '\b': out += '\\b'; break;
      case '\t': out += '\\t'; break;
      case '\n': out += '\\n'; break;
      case '\f': out += '\\f'; break;
      case '\r': out += '\\r'; break;
      default: {
        const code = ch.codePointAt(0) ?? 0;
        out += code < 0x20 || code === 0x7f
          ? `\\u${code.toString(16).padStart(4, '0')}`
          : ch;
      }
    }
  }
  return out;
}

/**
 * Serialize a flat table exactly as `toml::to_string` does.
 *
 * Key order follows the insertion order of `entries`, matching serde's use of
 * struct field declaration order. Entries whose value is `null` or `undefined`
 * are omitted entirely, matching `Option::None`.
 *
 * @param {Array<[string, string|number|boolean|null|undefined]>} entries
 * @returns {string} the document, terminated by a single newline (empty string
 *   when every entry was omitted)
 */
export function stringifyToml(entries) {
  const lines = [];
  for (const [key, value] of entries) {
    if (value === null || value === undefined) continue;
    lines.push(typeof value === 'string'
      ? `${key} = "${escapeBasicString(value)}"`
      : `${key} = ${value}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
