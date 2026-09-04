// Port of the `anyhow` error model used throughout the Rust original.
//
// `anyhow::Context::context()` wraps an error with an extra message while
// preserving the underlying cause chain. The top-level `fn main() -> Result<()>`
// then prints the chain with Rust's `Debug` impl for `anyhow::Error`, which has
// a very specific shape reproduced by `formatAnyhowError` below.

/**
 * An error carrying an `anyhow`-style context message plus the error it wraps.
 */
export class ContextError extends Error {
  /**
   * @param {string} context the context message (becomes the error message)
   * @param {unknown} cause the wrapped error
   */
  constructor(context, cause) {
    super(context, { cause });
    this.name = 'ContextError';
    /** @type {string} */
    this.context = context;
  }
}

/**
 * Attach a context message to an error, mirroring `anyhow`'s
 * `.context("...")` / `.with_context(|| ...)`.
 *
 * @param {unknown} error the error to wrap
 * @param {string|(() => string)} context eager string or lazy producer; the lazy
 *   form matches `with_context` and avoids building expensive messages on the
 *   success path
 * @returns {ContextError}
 */
export function withContext(error, context) {
  const message = typeof context === 'function' ? context() : context;
  return new ContextError(message, error);
}

/**
 * Run `fn`, attaching `context` to anything it throws.
 *
 * @template T
 * @param {() => Promise<T>|T} fn
 * @param {string|(() => string)} context
 * @returns {Promise<T>}
 */
export async function withContextAsync(fn, context) {
  try {
    return await fn();
  } catch (error) {
    throw withContext(error, context);
  }
}

/**
 * Create a plain error, mirroring `anyhow!("...")` / `bail!("...")`.
 *
 * @param {string} message
 * @returns {Error}
 */
export function anyhow(message) {
  const error = new Error(message);
  error.name = 'Error';
  return error;
}

/**
 * Render an error the way its Rust counterpart's `Display` impl would.
 *
 * Custom error types in this port expose a `display()` method (see
 * `src/bangumi/types.js`); everything else falls back to `message`.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function displayError(error) {
  if (error === null || error === undefined) return String(error);
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && typeof (/** @type {any} */ (error).display) === 'function') {
    return /** @type {any} */ (error).display();
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Walk the `.cause` chain and return every link, nearest first.
 *
 * @param {unknown} error
 * @returns {unknown[]} the causes below `error`, excluding `error` itself
 */
export function causeChain(error) {
  /** @type {unknown[]} */
  const chain = [];
  let current = error;
  const seen = new Set();
  while (current !== null && current !== undefined && typeof current === 'object') {
    if (seen.has(current)) break;
    seen.add(current);
    const next = /** @type {any} */ (current).cause;
    if (next === null || next === undefined) break;
    chain.push(next);
    current = next;
  }
  return chain;
}

/**
 * `anyhow::Error::root_cause()` — the deepest error in the chain.
 *
 * @param {unknown} error
 * @returns {unknown} the root cause, or `error` when there is no cause
 */
export function rootCause(error) {
  const chain = causeChain(error);
  return chain.length === 0 ? error : chain[chain.length - 1];
}

/**
 * Reproduce Rust's `Debug` formatting of `anyhow::Error`, which is what gets
 * printed to stderr when `main` returns `Err`.
 *
 * Shape (verified against the release binary):
 *
 * ```text
 * Error: request get subject: 999999999
 *
 * Caused by:
 *     [Not Found] resource can't be found in the database or has been removed
 *     * Map({"path": "/v0/subjects/999999999", "method": "GET"})
 * ```
 *
 * Every line of every cause is indented by four spaces. With no causes only the
 * `Error: ...` line is emitted.
 *
 * @param {unknown} error
 * @returns {string} the message, without a trailing newline
 */
export function formatAnyhowError(error) {
  const lines = [`Error: ${displayError(error)}`];
  const causes = causeChain(error);
  if (causes.length > 0) {
    lines.push('', 'Caused by:');
    for (const cause of causes) {
      for (const line of displayError(cause).split('\n')) {
        lines.push(`    ${line}`);
      }
    }
  }
  return lines.join('\n');
}
