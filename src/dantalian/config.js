import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getSubject, searchAnime } from '../bangumi/client.js';
import { anyhow } from '../errors.js';
import { info } from '../logger.js';
import { compileRegex } from '../vendor/rust-regex.js';
import { toIoError } from '../vendor/io-error.js';
import { duplicateKeys, parseToml, stringifyToml, tomlError, valueSpan } from '../vendor/toml.js';
import { fileName, rustJoin } from './utils.js';

export const DIR_CONFIG_NAME = 'dantalian.toml';

const DEFAULT_DIR_RE = compileRegex(String.raw`^(?P<name>.+?)(?P<tags> (\[[^\s]+\])+)?$`);

/**
 * @typedef {{
 *   subject_id: number,
 *   episode_re: import('../vendor/rust-regex.js').Regex,
 *   episode_offset: number
 * }} Config
 */

/**
 * Build the serde diagnostic the Rust original emits for a bad config field,
 * e.g. ``invalid type: string "oops", expected u32 for key `subject_id` at
 * line 1 column 14``.
 *
 * @param {Record<string, unknown>} table
 * @param {string} key
 * @param {string} expected the Rust type name serde was decoding into
 * @param {'type'|'value'} invalid `type` for a wrong TOML type, `value` for out of range
 * @returns {Error}
 */
function fieldError(table, key, expected, invalid) {
  const span = valueSpan(table, key);
  const found = span.kind === 'string' ? `string ${span.display}` : `${span.kind} \`${span.display}\``;
  return tomlError(`invalid ${invalid}: ${found}, expected ${expected} for key \`${key}\``, span.line, span.column);
}

function expectInteger(table, key, expected, min, max) {
  const value = table[key];
  if (value === undefined) return undefined;
  if (valueSpan(table, key).kind !== 'integer') throw fieldError(table, key, expected, 'type');
  if (value < min || value > max) throw fieldError(table, key, expected, 'value');
  return value;
}

const KNOWN_FIELDS = new Set(['subject_id', 'episode_re', 'episode_offset']);

function readConfigFile(filepath) {
  let text;
  try {
    text = readFileSync(filepath, 'utf8');
  } catch (error) {
    throw toIoError(error);
  }

  const table = parseToml(text);

  const repeated = duplicateKeys(table).find((key) => KNOWN_FIELDS.has(key));
  if (repeated !== undefined) throw tomlError(`duplicate field \`${repeated}\``, 1, 1);

  const subjectId = expectInteger(table, 'subject_id', 'u32', 0, 0xffffffff);
  if (subjectId === undefined) throw tomlError('missing field `subject_id`', 1, 1);

  const episodeRe = table.episode_re;
  if (episodeRe !== undefined && typeof episodeRe !== 'string') {
    throw fieldError(table, 'episode_re', 'a string', 'type');
  }

  const episodeOffset = expectInteger(table, 'episode_offset', 'i32', -2147483648, 2147483647);

  return { subjectId, episodeRe, episodeOffset };
}

async function parseFromFile(filepath) {
  info('Parse config file', 2);
  const cf = readConfigFile(filepath);

  let episodeRe;
  if (cf.episodeRe !== undefined) {
    episodeRe = compileRegex(cf.episodeRe);
  } else {
    const subject = await getSubject(cf.subjectId);
    episodeRe = defaultEpRegex(`${subject.name}|${subject.name_cn}`);
  }

  return {
    subject_id: cf.subjectId,
    episode_re: episodeRe,
    episode_offset: cf.episodeOffset ?? 0,
  };
}

async function parseFromDirname(path) {
  info('Not found config file, create one', 2);

  const dirname = fileName(path);
  if (dirname === null) throw anyhow('invalid path');

  const name = capAnimeName(dirname);
  if (name === null) throw anyhow('invalid name');

  const subjects = (await searchAnime(name)).data;
  if (subjects.length === 0) throw anyhow('not found');

  return {
    subject_id: subjects[0].id,
    episode_re: defaultEpRegex(name),
    episode_offset: 0,
  };
}

/**
 * Write the config back out.
 *
 * This runs on every successful parse, including the parse-from-file path, so a
 * hand-written config is normalised in place: omitted optional keys gain their
 * defaults and the regex is rewritten from `Regex::to_string`.
 *
 * @param {Config} config
 * @param {string} filepath
 */
function save(config, filepath) {
  const content = stringifyToml([
    ['subject_id', config.subject_id],
    ['episode_re', config.episode_re.toString()],
    ['episode_offset', config.episode_offset],
  ]);
  try {
    writeFileSync(filepath, content);
  } catch (error) {
    throw toIoError(error);
  }
}

/**
 * Load `dantalian.toml` from a show directory, deriving it from the directory
 * name when absent, then write the normalised form back.
 *
 * @param {string} path the show directory
 * @returns {Promise<Config>}
 */
export async function parseConfig(path) {
  const filepath = rustJoin(path, DIR_CONFIG_NAME);
  const config = existsSync(filepath) ? await parseFromFile(filepath) : await parseFromDirname(path);
  save(config, filepath);
  return config;
}

/**
 * Strip a trailing run of `[tag]` groups from a directory name.
 *
 * @param {string} dirName
 * @returns {string|null}
 */
export function capAnimeName(dirName) {
  const name = DEFAULT_DIR_RE.captures(dirName)?.name('name');
  return name ? name.asStr : null;
}

/**
 * Build the fallback episode-matching regex from a subject's names.
 *
 * `nameQry` is interpolated without escaping, matching the Rust original. Names
 * containing regex metacharacters therefore alter the pattern's meaning rather
 * than being matched literally.
 *
 * @param {string} nameQry
 * @returns {import('../vendor/rust-regex.js').Regex}
 */
export function defaultEpRegex(nameQry) {
  return compileRegex(String.raw`^(?P<name>${nameQry}) (?P<sp>SP)?(?P<ep>[.\d]+)\.`);
}
