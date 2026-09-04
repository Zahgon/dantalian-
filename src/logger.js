// Port of `src/logger.rs`.
//
// Two behaviours here are unusual and deliberate:
//
//   * Every level — including `error!` and `warn!` — is written to STDOUT via
//     `println!`. Only the final `anyhow` error from `main` reaches stderr.
//   * The indentation prefix is sliced out of a fixed 24-space string, so an
//     indent level above 12 silently saturates rather than growing.

/** @typedef {'off'|'error'|'warn'|'info'|'debug'|'trace'} LevelFilter */

/** @type {Record<LevelFilter, number>} */
const LEVEL_ORDER = { off: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

const INDENTS = ' '.repeat(24);
const INDENTS_WIDTH = 2;

/** @type {LevelFilter} */
let maxLevel = 'info';

/**
 * @param {LevelFilter} level
 */
export function setMaxLevel(level) {
  maxLevel = level;
}

/**
 * @param {LevelFilter} level
 * @returns {boolean}
 */
function enabled(level) {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[maxLevel];
}

/**
 * The leading whitespace for indent level `i`, saturating at 24 columns.
 *
 * @param {number} i
 * @returns {string}
 */
export function indent(i) {
  return INDENTS.slice(0, Math.min(i * INDENTS_WIDTH, INDENTS.length));
}

/**
 * Whether ANSI colour should be emitted, following the `colored` crate's rules:
 * `CLICOLOR_FORCE` (non-zero) forces colour on, `NO_COLOR` forces it off, and
 * otherwise colour is used only when stdout is a terminal.
 *
 * @returns {boolean}
 */
function colorEnabled() {
  const force = process.env.CLICOLOR_FORCE;
  if (force !== undefined && force !== '0') return true;
  if (process.env.NO_COLOR !== undefined) return false;
  return process.stdout.isTTY === true;
}

/**
 * @param {string} text
 * @param {string} code the ANSI SGR parameter
 * @returns {string}
 */
function colorize(text, code) {
  return colorEnabled() ? `\u001b[${code}m${text}\u001b[0m` : text;
}

/**
 * @param {LevelFilter} level
 * @param {string} message
 */
function emit(level, message) {
  if (!enabled(level)) return;
  process.stdout.write(`${message}\n`);
}

/**
 * Build a log line, optionally prefixed by an indent level.
 *
 * @param {number|null} ind
 * @param {string} message
 * @returns {string}
 */
function withIndent(ind, message) {
  return ind === null ? message : `${indent(ind)}${message}`;
}

/**
 * @param {string} message
 * @param {number|null} [ind]
 */
export function info(message, ind = null) {
  emit('info', withIndent(ind, message));
}

/**
 * Errors are red, but still go to stdout — matching the original.
 *
 * @param {string} message
 * @param {number|null} [ind]
 */
export function error(message, ind = null) {
  emit('error', withIndent(ind, colorize(message, '31')));
}

/**
 * @param {string} message
 * @param {number|null} [ind]
 */
export function warn(message, ind = null) {
  emit('warn', withIndent(ind, colorize(message, '33')));
}

/**
 * @param {string} message
 * @param {number|null} [ind]
 */
export function debug(message, ind = null) {
  emit('debug', withIndent(ind, message));
}

/**
 * @param {string} message
 * @param {number|null} [ind]
 */
export function trace(message, ind = null) {
  emit('trace', withIndent(ind, message));
}
