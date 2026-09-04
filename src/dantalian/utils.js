// Port of `src/dantalian/utils.rs`.

import { writeFileSync } from 'node:fs';
import { extname } from 'node:path';
import { toIoError } from '../vendor/io-error.js';

/**
 * Extensions treated as video files.
 *
 * Copied verbatim from the Rust `HashSet`, duplicates included — the original
 * lists `flv`, `gif`, `m4v`, `mpe` and `mpg` more than once, which a set
 * collapses anyway.
 */
const VIDEO_EXTS = new Set([
  'webm', 'mkv', 'flv', 'flv', 'vob', 'ogv', 'ogg', 'drc', 'gif', 'gif', 'mng',
  'avi', 'mts', 'm2t', 'ts', 'mov', 'qt', 'wmv', 'yuv', 'rm', 'rmv', 'viv',
  'asf', 'amv', 'mp4', 'm4p', 'm4v', 'mpg', 'mp2', 'mpe', 'mpe', 'mpv', 'mpg',
  'mpe', 'm2v', 'm4v', 'svi', '3gp', '3g2', 'mxf', 'roq', 'nsv', 'flv', 'f4v',
  'f4p', 'f4a', 'f4b',
]);

/**
 * Whether a path has a recognised video extension.
 *
 * Matches Rust's `Path::extension`: a file with no extension, or a dotfile such
 * as `.mkv`, yields no extension and therefore never matches.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isVideoFile(path) {
  const ext = extname(path);
  if (ext === '' || ext === '.') return false;
  return VIDEO_EXTS.has(ext.slice(1).toLowerCase());
}

/**
 * Replace a path's extension, mirroring Rust's `Path::with_extension`.
 * Only the final extension is replaced, so `化物語 SP5.5.mp4` becomes
 * `化物語 SP5.5.nfo` rather than `化物語 SP.nfo`.
 *
 * @param {string} path
 * @param {string} extension without a leading dot
 * @returns {string}
 */
export function withExtension(path, extension) {
  const ext = extname(path);
  const base = ext === '' ? path : path.slice(0, path.length - ext.length);
  return `${base}.${extension}`;
}

/**
 * Append a component to a path, mirroring Rust's `Path::join`.
 *
 * Unlike `node:path`'s `join`, this performs no normalisation. That matters
 * because every path in the program's output is derived from the user-supplied
 * `--source` argument: given `./source`, Rust logs `./source/化物語`, whereas
 * `path.join` would collapse the leading `./`.
 *
 * @param {string} base
 * @param {string} component
 * @returns {string}
 */
export function rustJoin(base, component) {
  if (component.startsWith('/')) return component;
  if (base === '') return component;
  return base.endsWith('/') ? base + component : `${base}/${component}`;
}

/**
 * The final component of a path, mirroring Rust's `Path::file_name`.
 *
 * @param {string} path
 * @returns {string|null} `null` for a path ending in `..` or with no component
 */
/**
 * Write a generated nfo file, truncating any existing one.
 *
 * @param {string} filepath
 * @param {string} content
 */
export function writeNfo(filepath, content) {
  try {
    writeFileSync(filepath, content);
  } catch (error) {
    throw toIoError(error);
  }
}

/**
 * The final component of a path, mirroring Rust's `Path::file_name`.
 *
 * @param {string} path
 * @returns {string|null} `null` for a path ending in `..` or with no component
 */
export function fileName(path) {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '.' || trimmed === '..') return null;
  const index = trimmed.lastIndexOf('/');
  const name = index === -1 ? trimmed : trimmed.slice(index + 1);
  return name === '.' || name === '..' ? null : name;
}
