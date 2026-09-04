// The slice of `walkdir` this program uses: a single directory level, in the
// order the OS returns entries (`WalkDir::new(p).min_depth(1).max_depth(1)`).
//
// Entries are deliberately not sorted. The Rust original iterates in raw readdir
// order and the generated log lines follow that order, so sorting here would
// change observable output. `readdirSync` cannot be used: libuv runs `alphasort`
// over its results, whereas `opendirSync`/`readSync` stream entries in the order
// the OS returns them, matching Rust's `read_dir`.

import { opendirSync } from 'node:fs';
import { WalkDirError } from '../vendor/io-error.js';
import { rustJoin } from './utils.js';

/**
 * @typedef {{ path: string, name: string, isDirectory: boolean, isFile: boolean }} DirEntry
 */

/**
 * List the immediate children of `dir`.
 *
 * @param {string} dir
 * @returns {DirEntry[]}
 * @throws {WalkDirError} when the directory cannot be read, matching the error
 *   `walkdir` produces for the root entry
 */
export function walkDepth1(dir) {
  const entries = [];
  try {
    const handle = opendirSync(dir);
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        entries.push({
          path: rustJoin(dir, entry.name),
          name: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile(),
        });
      }
    } finally {
      handle.closeSync();
    }
  } catch (error) {
    throw new WalkDirError(dir, /** @type {NodeJS.ErrnoException} */ (error));
  }

  return entries;
}
