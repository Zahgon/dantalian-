// Port of the Rust standard-library formatting primitives that the original
// `dantalian` relies on. These are the substrate for every byte-level parity
// guarantee in the rest of the port, so they live in their own module and are
// covered by table-driven tests in `test/rustfmt.test.js`.
//
// Three distinct number-to-string conversions exist in the Rust program and they
// do NOT agree with each other:
//
//   1. `format!("{}", x: f64)`  -> Rust `Display` for floats. Never prints a
//      trailing `.0`, never uses scientific notation.
//   2. TinyTemplate `{value}`   -> `serde_json::Number` Display. A value that
//      was typed `f64` in Rust round-trips through serde_json as a float and
//      therefore prints `8.0`, keeping the `.0`.
//   3. `format!("{:02}", x)`    -> zero padded to a minimum width.
//
// Conflating (1) and (2) is the single most likely source of output diffs, so
// they are deliberately separate exported functions.

/** Sentinel returned by {@link parseRustF64} when the input is not a valid Rust float literal. */
export const PARSE_ERROR = Symbol('rust:invalid-float-literal');

/**
 * Rust's error message for `"".parse::<f64>()`.
 * @type {string}
 */
export const EMPTY_FLOAT_ERROR = 'cannot parse float from empty string';

/**
 * Rust's error message for a malformed (but non-empty) float literal.
 * This exact string leaks into generated nfo files via the episode-offset bug;
 * see `src/dantalian/job.js`.
 * @type {string}
 */
export const INVALID_FLOAT_ERROR = 'invalid float literal';

/**
 * Expand a JavaScript exponential-notation number string into plain decimal
 * notation. Rust's `Display` impl for `f64` never emits an exponent, whereas
 * `String(1e21)` in JavaScript yields `"1e+21"`.
 *
 * @param {string} s a decimal string possibly containing an `e`/`E` exponent
 * @returns {string} the same value written without an exponent
 */
function deExponentiate(s) {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (m === null) return s;

  const [, signRaw, intPart, fracPartRaw, expRaw] = m;
  const sign = signRaw === '-' ? '-' : '';
  const frac = fracPartRaw ?? '';
  const exp = Number(expRaw);
  const digits = intPart + frac;
  // Position of the decimal point measured from the left of `digits`.
  const point = intPart.length + exp;

  if (point <= 0) {
    return `${sign}0.${'0'.repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return sign + digits + '0'.repeat(point - digits.length);
  }
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * `format!("{}", x)` for `f64`.
 *
 * Rust prints the shortest string that round-trips, with no trailing `.0` for
 * integral values and no scientific notation at any magnitude.
 *
 * Verified against the Rust binary:
 *   1.0 -> "1", 8.0 -> "8", 5.5 -> "5.5", 0.0 -> "0", -0.0 -> "-0",
 *   29.5 -> "29.5", 1e21 -> "1000000000000000000000",
 *   0.1 + 0.2 -> "0.30000000000000004", Infinity -> "inf", NaN -> "NaN".
 *
 * @param {number} x
 * @returns {string}
 */
export function rustFloatDisplay(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Number.POSITIVE_INFINITY) return 'inf';
  if (x === Number.NEGATIVE_INFINITY) return '-inf';
  if (Object.is(x, -0)) return '-0';
  if (x === 0) return '0';

  // `String()` already gives the shortest round-tripping representation; the
  // only difference from Rust is the exponent form for very large/small values.
  return deExponentiate(String(x));
}

/**
 * `format!("{}", x)` for Rust integer types (`u32`, `i32`).
 * @param {number} x
 * @returns {string}
 */
export function rustIntDisplay(x) {
  return String(Math.trunc(x));
}

/**
 * `serde_json::Number` Display, i.e. how TinyTemplate renders `{value}` for a
 * numeric field.
 *
 * A Rust `f64` always serializes as a JSON float, so an integral value keeps its
 * `.0` suffix (`8.0` -> `"8.0"`). A Rust integer serializes as a JSON integer
 * (`8` -> `"8"`). JavaScript cannot tell the two apart from the value alone, so
 * callers must tag float-typed fields with {@link f64}.
 *
 * @param {number|F64} x
 * @returns {string}
 */
export function serdeJsonNumberToString(x) {
  if (x instanceof F64) return serdeJsonFloatToString(x.value);
  if (Number.isInteger(x)) return String(x);
  return serdeJsonFloatToString(x);
}

/**
 * Render a value that Rust typed as `f64` the way `serde_json` does.
 * @param {number} v
 * @returns {string}
 */
function serdeJsonFloatToString(v) {
  if (!Number.isFinite(v)) {
    // serde_json serializes non-finite floats as `null`; unreachable for this
    // program's data but kept for completeness.
    return 'null';
  }
  if (Number.isInteger(v) && Object.is(v, -0) === false) {
    return `${deExponentiate(String(v))}.0`;
  }
  if (Object.is(v, -0)) return '-0.0';
  return deExponentiate(String(v));
}

/**
 * Marker wrapper declaring that a numeric value originated from a Rust `f64`
 * field and must therefore keep its `.0` suffix when rendered by a template.
 */
export class F64 {
  /** @param {number} value */
  constructor(value) {
    /** @type {number} */
    this.value = value;
  }

  /** @returns {number} */
  valueOf() {
    return this.value;
  }

  /** @returns {number} JSON representation, so `JSON.stringify` still works. */
  toJSON() {
    return this.value;
  }
}

/**
 * Convenience constructor for {@link F64}.
 * @param {number} value
 * @returns {F64}
 */
export function f64(value) {
  return new F64(value);
}

/**
 * `format!("{:>width$}", s)` — right-align by padding spaces on the left.
 * Rust counts `char`s (Unicode scalar values), not UTF-16 code units.
 *
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
export function padStartChars(s, width) {
  const len = [...s].length;
  return len >= width ? s : ' '.repeat(width - len) + s;
}

/**
 * `format!("{:0width$}", n)` for a float — zero-pad on the left to a minimum
 * total width. Rust places the zeros after any sign, but every call site in
 * this program passes non-negative values.
 *
 * @param {number} n
 * @param {number} width
 * @returns {string}
 */
export function zeroPadFloat(n, width) {
  const s = rustFloatDisplay(n);
  if (s.startsWith('-')) {
    const body = s.slice(1);
    const len = body.length + 1;
    return len >= width ? s : `-${'0'.repeat(width - len)}${body}`;
  }
  return s.length >= width ? s : '0'.repeat(width - s.length) + s;
}

/**
 * Strict equivalent of Rust's `f64::from_str`.
 *
 * Accepts: `inf`, `infinity`, `NaN` (any case, optional sign), decimal literals
 * with an optional sign, an optional fractional part (`1.`, `.5` are both
 * valid) and an optional exponent.
 * Rejects: empty strings, surrounding whitespace, underscores, hex literals and
 * anything with a trailing garbage suffix.
 *
 * @param {string} s
 * @returns {number|typeof PARSE_ERROR}
 */
export function parseRustF64(s) {
  if (s.length === 0) return PARSE_ERROR;

  const lower = s.toLowerCase();
  const signed = /^[+-]/.test(lower) ? lower.slice(1) : lower;
  const negative = lower.startsWith('-');

  if (signed === 'inf' || signed === 'infinity') {
    return negative ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  if (signed === 'nan') return Number.NaN;

  // Mantissa must contain at least one digit; `1.`, `.5` and `1.5` are all
  // accepted by Rust, `.` and `1.2.3` are not.
  if (!/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(signed)) return PARSE_ERROR;

  const value = Number(lower);
  return Number.isNaN(value) ? PARSE_ERROR : value;
}

/**
 * The message Rust's `ParseFloatError` produces for the given input. Used by the
 * faithfully-reproduced episode-index bug in `src/dantalian/job.js`.
 *
 * @param {string} s the input that failed to parse
 * @returns {string}
 */
export function rustFloatParseErrorMessage(s) {
  return s.length === 0 ? EMPTY_FLOAT_ERROR : INVALID_FLOAT_ERROR;
}

/**
 * Compare two strings the way Rust's `str: Ord` does — by Unicode scalar value
 * (equivalently, UTF-8 byte order).
 *
 * JavaScript's default `Array.prototype.sort` comparator uses UTF-16 code-unit
 * order, which disagrees for astral-plane characters (emoji, CJK Ext-B).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareByCodePoint(a, b) {
  const as = [...a];
  const bs = [...b];
  const shared = Math.min(as.length, bs.length);
  for (let i = 0; i < shared; i += 1) {
    const diff = as[i].codePointAt(0) - bs[i].codePointAt(0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (as.length === bs.length) return 0;
  return as.length < bs.length ? -1 : 1;
}

/**
 * Rust's `Vec::dedup` — removes only *consecutive* duplicates. Applied after a
 * sort this is equivalent to a full de-duplication.
 *
 * @template T
 * @param {T[]} items
 * @returns {T[]}
 */
export function dedupConsecutive(items) {
  return items.filter((item, index) => index === 0 || item !== items[index - 1]);
}
