// Rendering of filesystem errors in Rust's format.
//
// Node reports `ENOENT: no such file or directory, scandir '/x'`, whereas Rust's
// `io::Error` Display is `No such file or directory (os error 2)` — the C
// `strerror` text plus the raw errno. Since these strings are printed by the CLI
// on the failure path, they are translated rather than passed through.

/** @type {Record<string, { code: number, message: string }>} */
const ERRNO = {
  EPERM: { code: 1, message: 'Operation not permitted' },
  ENOENT: { code: 2, message: 'No such file or directory' },
  EINTR: { code: 4, message: 'Interrupted system call' },
  EIO: { code: 5, message: 'Input/output error' },
  EBADF: { code: 9, message: 'Bad file descriptor' },
  EAGAIN: { code: 35, message: 'Resource temporarily unavailable' },
  EACCES: { code: 13, message: 'Permission denied' },
  EEXIST: { code: 17, message: 'File exists' },
  ENOTDIR: { code: 20, message: 'Not a directory' },
  EISDIR: { code: 21, message: 'Is a directory' },
  EINVAL: { code: 22, message: 'Invalid argument' },
  EMFILE: { code: 24, message: 'Too many open files' },
  ENOSPC: { code: 28, message: 'No space left on device' },
  EROFS: { code: 30, message: 'Read-only file system' },
  ENAMETOOLONG: { code: 63, message: 'File name too long' },
  ENOTEMPTY: { code: 66, message: 'Directory not empty' },
  ELOOP: { code: 62, message: 'Too many levels of symbolic links' },
};

/**
 * An error carrying Rust's `io::Error` Display text.
 */
export class IoError extends Error {
  /**
   * @param {NodeJS.ErrnoException} cause
   */
  constructor(cause) {
    const entry = cause.code === undefined ? undefined : ERRNO[cause.code];
    super(
      entry === undefined
        ? (cause.message ?? String(cause))
        : `${entry.message} (os error ${entry.code})`,
    );
    this.name = 'IoError';
    this.code = cause.code;
  }
}

/**
 * `walkdir::Error` Display: `IO error for operation on {path}: {io error}`.
 */
export class WalkDirError extends Error {
  /**
   * @param {string} path
   * @param {NodeJS.ErrnoException} cause
   */
  constructor(path, cause) {
    const io = new IoError(cause);
    super(`IO error for operation on ${path}: ${io.message}`, { cause: io });
    this.name = 'WalkDirError';
  }
}

/**
 * Wrap a Node filesystem error so it prints like Rust's.
 *
 * @param {unknown} error
 * @returns {Error}
 */
export function toIoError(error) {
  return error instanceof Error && 'code' in error
    ? new IoError(/** @type {NodeJS.ErrnoException} */ (error))
    : /** @type {Error} */ (error);
}
