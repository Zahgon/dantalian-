import { readFileSync } from 'node:fs';

/**
 * The package version, read from `package.json` the way `env!("CARGO_PKG_VERSION")`
 * reads it from `Cargo.toml`. It appears in `--version`, in the CLI help header
 * and in the HTTP `User-Agent`, so a single source of truth matters.
 *
 * @type {string}
 */
export const VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;

/** @type {string} */
export const PKG_NAME = 'dantalian';

/** @type {string} */
export const PKG_AUTHORS = 'Nanozuki Crows <nanozuki.crows@gmail.com>';

/** @type {string} */
export const PKG_DESCRIPTION = 'A nfo file generator for your anime. Source from https://bangumi.tv/.';
