// Translation layer from Rust `regex` crate patterns to JavaScript `RegExp`.
//
// Two differences matter for this program:
//
//   1. Named capture groups. Rust accepts both `(?P<name>...)` (the classic
//      Python-style syntax, and the only form the crate supported before 1.9)
//      and `(?<name>...)`. JavaScript only understands the latter.
//
//   2. Unicode-aware shorthand classes. In Rust, `\d` is `\p{Nd}` and matches
//      e.g. the full-width digit `１`; in JavaScript `\d` is always `[0-9]`.
//      The same applies to `\w` and `\s`. Each shorthand is therefore rewritten
//      to the equivalent Unicode property class and the pattern is compiled
//      with the `u` flag.
//
// Whatever the pattern is rewritten to, `Regex#toString()` returns the
// *original* source text. `Config::save` writes `episode_re` back to
// `dantalian.toml` on every run via Rust's `Regex::to_string()`, which likewise
// returns the pattern as it was written, so preserving the source keeps those
// files byte-identical.
//
// JavaScript's regex engine is a superset in some respects (it has lookaround
// and backreferences, which Rust rejects at compile time). Patterns using those
// constructs would fail under Rust and succeed here; that only ever makes this
// port more permissive, never less.

import { anyhow } from '../errors.js';
import { regexParseError, validatePattern } from './regex-error.js';

/** Rust's `\d` — Unicode decimal numbers. */
const CLASS_D = '\\p{Nd}';
/** Rust's `\s` — Unicode whitespace. */
const CLASS_S = '\\p{White_Space}';
/** Rust's `\w` — Unicode word characters. */
const CLASS_W = '\\p{Alphabetic}\\p{M}\\p{Nd}\\p{Pc}\\p{Join_Control}';

/**
 * The only characters JavaScript's `u` mode allows a backslash in front of.
 * Escaping anything else is a syntax error there, whereas Rust permits an
 * escape before any ASCII punctuation.
 */
const ESCAPABLE = new Set([...'^$\\.*+?()[]{}|/-']);

/**
 * @param {string} ch a single character
 * @returns {boolean} whether `ch` is ASCII punctuation, i.e. safe to emit
 *   literally once its redundant backslash is dropped
 */
function isAsciiPunctuation(ch) {
  return /^[!-/:-@[-`{-~]$/.test(ch);
}

/**
 * Whether a quantifier starts at `index`, which decides if a preceding anchor
 * needs wrapping. A `{` only quantifies when it opens a well-formed `{n}`,
 * `{n,}` or `{n,m}` repetition; anywhere else Rust reads it as a literal brace.
 *
 * @param {string} source
 * @param {number} index
 * @returns {boolean}
 */
function quantifierAt(source, index) {
  const ch = source[index];
  if (ch === '*' || ch === '+' || ch === '?') return true;
  return ch === '{' && /^\{[0-9]+(,[0-9]*)?\}/.test(source.slice(index));
}

/**
 * Emit an anchor, wrapping it in a non-capturing group when a quantifier
 * follows.
 *
 * Rust happily compiles `^*` — repeating a zero-width assertion is legal and
 * simply matches the empty string — but JavaScript rejects it with "Nothing to
 * repeat". `(?:^)*` is accepted and means the same thing. The group is
 * non-capturing, so group numbering is untouched.
 *
 * @param {string} anchor the translated anchor, e.g. `^` or `\b`
 * @param {string} source the Rust pattern
 * @param {number} next index of the character following the anchor
 * @returns {string}
 */
function emitAnchor(anchor, source, next) {
  return quantifierAt(source, next) ? `(?:${anchor})` : anchor;
}

/**
 * Rewrite a Rust pattern into JavaScript syntax.
 *
 * @param {string} source the Rust pattern
 * @returns {{ pattern: string, flags: string }}
 */
function translate(source) {
  let flags = 'u';
  let i = 0;

  // Leading inline flag groups, e.g. `(?i)` or `(?is)`. Rust allows these
  // anywhere, but only a leading group can be mapped onto JavaScript's
  // whole-pattern flags, so that is all this handles.
  while (true) {
    const match = /^\(\?([imsxU]+)\)/.exec(source.slice(i));
    if (!match) break;
    for (const flag of match[1]) {
      if (flag === 'i' && !flags.includes('i')) flags += 'i';
      else if (flag === 'm' && !flags.includes('m')) flags += 'm';
      else if (flag === 's' && !flags.includes('s')) flags += 's';
      else if (flag === 'x') throw anyhow('unsupported regex flag `x` (verbose mode)');
      else if (flag === 'U') throw anyhow('unsupported regex flag `U` (swap greed)');
    }
    i += match[0].length;
  }

  let out = '';
  let inClass = false;

  for (; i < source.length; i += 1) {
    const ch = source[i];

    if (ch === '\\') {
      const next = source[i + 1];
      if (next === undefined) throw anyhow('regex pattern ends with a trailing backslash');
      i += 1;

      switch (next) {
        case 'd': out += inClass ? CLASS_D : `[${CLASS_D}]`; break;
        case 'D': out += inClass ? `\\P{Nd}` : `[^${CLASS_D}]`; break;
        case 's': out += inClass ? CLASS_S : `[${CLASS_S}]`; break;
        case 'S': out += inClass ? `\\P{White_Space}` : `[^${CLASS_S}]`; break;
        case 'w': out += inClass ? CLASS_W : `[${CLASS_W}]`; break;
        case 'W':
          if (inClass) throw anyhow('`\\W` inside a character class is not supported');
          out += `[^${CLASS_W}]`;
          break;
        // Rust's `\A` / `\z` anchor the whole haystack. Without the `m` flag,
        // `^` and `$` do exactly that in JavaScript too.
        case 'A': out += emitAnchor('^', source, i + 1); break;
        case 'z': out += emitAnchor('$', source, i + 1); break;
        // Inside a character class `\b` is a backspace, not a word boundary.
        case 'b':
        case 'B':
          out += inClass ? `\\${next}` : emitAnchor(`\\${next}`, source, i + 1);
          break;

        default:
          // Rust lets any ASCII punctuation be escaped, but JavaScript's `u`
          // mode only accepts escapes for characters that are actually
          // syntactic. Emit those bare; everything else keeps its backslash.
          out += ESCAPABLE.has(next) || !isAsciiPunctuation(next) ? `\\${next}` : next;
      }
      continue;
    }

    if (inClass) {
      if (ch === ']') inClass = false;
      out += ch;
      continue;
    }

    if (ch === '[') {
      inClass = true;
      out += ch;
      // `[]]` and `[^]]` treat a leading `]` as a literal in Rust; JavaScript
      // `u` mode does not, so escape it.
      let j = i + 1;
      if (source[j] === '^') { out += '^'; j += 1; }
      if (source[j] === ']') { out += '\\]'; j += 1; }
      i = j - 1;
      continue;
    }

    if (ch === '(' && source.startsWith('(?P<', i)) {
      out += '(?<';
      i += 3;
      continue;
    }

    if (ch === '(' && source.startsWith('(?P=', i)) {
      throw anyhow('named backreferences are not supported');
    }

    out += ch === '^' || ch === '$' ? emitAnchor(ch, source, i + 1) : ch;
  }

  if (inClass) throw anyhow('unterminated character class in regex pattern');

  return { pattern: out, flags };
}

/**
 * A compiled regular expression with Rust `regex` semantics.
 *
 * Only the handful of operations the program actually performs are exposed:
 * `captures` (Rust's `Regex::captures`) and `toString` (`Display`).
 */
export class Regex {
  /**
   * @param {string} source the original Rust pattern
   */
  constructor(source) {
    const { pattern, flags } = translate(source);
    /** @type {string} */
    this.source = source;
    /** @type {RegExp} */
    this.regexp = new RegExp(pattern, flags);
  }

  /**
   * Find the leftmost match, mirroring `Regex::captures`.
   *
   * @param {string} text
   * @returns {Captures|null} `null` when the pattern does not match
   */
  captures(text) {
    const match = this.regexp.exec(text);
    return match === null ? null : new Captures(match);
  }

  /**
   * Rust's `Display for Regex` returns the pattern as originally written.
   *
   * @returns {string}
   */
  toString() {
    return this.source;
  }
}

/**
 * The result of a successful match, mirroring `regex::Captures`.
 */
export class Captures {
  /**
   * @param {RegExpExecArray} match
   */
  constructor(match) {
    /** @type {RegExpExecArray} */
    this.match = match;
  }

  /**
   * Look up a named group, mirroring `Captures::name`.
   *
   * A group that exists in the pattern but did not participate in the match
   * returns `null`, exactly like Rust's `Option::None`.
   *
   * @param {string} name
   * @returns {{ asStr: string }|null}
   */
  name(name) {
    const groups = this.match.groups;
    if (groups === undefined) return null;
    const value = groups[name];
    return value === undefined ? null : { asStr: value };
  }
}

/**
 * Compile a Rust regex pattern.
 *
 * @param {string} source
 * @returns {Regex}
 * @throws when the pattern is invalid or uses an unsupported construct
 */
export function compileRegex(source) {
  validatePattern(source);
  try {
    return new Regex(source);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw regexParseError(source, [{ start: 0, length: [...source].length }], error.message);
    }
    throw error;
  }
}
