// Port of `src/bangumi/client.rs`.
//
// Wire-level details that must match the Rust client exactly:
//   * `BASE_URL` keeps its trailing slash so that `new URL(path, BASE_URL)`
//     resolves against `/v0/` rather than `/`.
//   * No `Content-Type` header is ever set, not even for the search POST — the
//     Rust code passes a raw byte body and never touches the header. Handing
//     `fetch` a `Uint8Array` preserves that; a string body would make undici
//     add `text/plain;charset=UTF-8`.
//   * A fresh client is constructed per request, so no connection state or
//     cookies are shared between calls.
//
// One unavoidable divergence: reqwest sends an empty body with GET requests
// (`body()?.unwrap_or_default()`), whereas `fetch` rejects any body on GET. The
// body is therefore omitted for GETs, which the API cannot distinguish from an
// empty one.

import { withContext, withContextAsync } from '../errors.js';
import { debug, trace } from '../logger.js';
import { VERSION } from '../version.js';
import {
  SubjectType,
  decodeBgmError,
  decodeCharacter,
  decodeEpisode,
  decodePerson,
  decodeSubject,
  decodeSubjectBase,
} from './types.js';

const BASE_URL = 'https://api.bgm.tv/v0/';

const USER_AGENT = `Dantalian/${VERSION} (https://github.com/nanozuki/dantalian)`;

/** @type {string|null} */
let accessToken = null;

/**
 * Store the personal access token used for subsequent requests.
 *
 * The Rust original uses `OnceCell::set(...).unwrap()`, which panics if called
 * twice; the CLI only ever calls it once, before any request is made.
 *
 * @param {string} token
 */
export function setAccessToken(token) {
  if (accessToken !== null) throw new Error('access token was already set');
  accessToken = token;
}

/** Clear the stored token so tests can run in isolation. */
export function resetAccessToken() {
  accessToken = null;
}

/**
 * Perform a request against the bangumi API and decode the response.
 *
 * @template T
 * @param {string} path relative to `BASE_URL`
 * @param {(value: unknown) => T} decode
 * @param {Uint8Array} [body] present only for the search POST
 * @returns {Promise<T>}
 */
async function send(path, decode, body) {
  const url = new URL(path, BASE_URL).toString();
  debug(`url = ${url}`);

  /** @type {Record<string, string>} */
  const headers = { 'user-agent': USER_AGENT };
  if (accessToken !== null) headers.authorization = `Bearer ${accessToken}`;

  const response = await fetch(
    url,
    body === undefined ? { method: 'GET', headers } : { method: 'POST', headers, body },
  );

  debug(`status: ${response.status}`);

  const text = new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()));

  if (!response.ok) {
    /** @type {unknown} */
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw withContext(error, `deserialize error: ${text}`);
    }
    throw decodeBgmError(payload);
  }

  try {
    return decode(JSON.parse(text));
  } catch (error) {
    throw withContext(error, `get body: ${text}`);
  }
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {unknown[]}
 */
function expectArray(value, what) {
  if (!Array.isArray(value)) throw new Error(`invalid type: expected a sequence of ${what}`);
  return value;
}

/**
 * @typedef {{ data: import('./types.js').SubjectBase[] }} SearchResponse
 */

/**
 * `POST /v0/search/subjects`, filtered to anime.
 *
 * @param {string} keyword
 * @returns {Promise<SearchResponse>}
 */
export async function searchAnime(keyword) {
  trace(`request url ${new URL('search/subjects', BASE_URL)}`);

  const payload = JSON.stringify({ keyword, filter: { type: [SubjectType.Anime] } });
  const result = await withContextAsync(
    () =>
      send(
        'search/subjects',
        (value) => ({
          data: expectArray(/** @type {any} */ (value).data, 'subjects').map((item) => decodeSubjectBase(item)),
        }),
        new TextEncoder().encode(payload),
      ),
    'request search anime',
  );

  // The Rust original logs `{:?}`, Rust's struct debug format. Reproducing that
  // byte-for-byte would require carrying type names and field order through
  // every decoder for the sake of a single `--verbose` line, so JSON is used.
  debug(`obj: ${JSON.stringify(result)}`);
  return result;
}

/**
 * @param {number} id
 * @returns {Promise<import('./types.js').Subject>}
 */
export function getSubject(id) {
  return withContextAsync(() => send(`subjects/${id}`, decodeSubject), `request get subject: ${id}`);
}

/**
 * @param {number} id
 * @returns {Promise<import('./types.js').Person[]>}
 */
export function getSubjectPersons(id) {
  return withContextAsync(
    () => send(`subjects/${id}/persons`, (value) => expectArray(value, 'persons').map((item) => decodePerson(item))),
    `request get subject persons: ${id}`,
  );
}

/**
 * @param {number} id
 * @returns {Promise<import('./types.js').Character[]>}
 */
export function getSubjectCharacters(id) {
  return withContextAsync(
    () =>
      send(`subjects/${id}/characters`, (value) =>
        expectArray(value, 'characters').map((item) => decodeCharacter(item)),
      ),
    `request get subject characters: ${id}`,
  );
}

/**
 * @param {number} id
 * @returns {Promise<import('./types.js').Episode[]>}
 */
export function getSubjectEpisodes(id) {
  return withContextAsync(
    () =>
      send(`episodes?subject_id=${id}`, (value) =>
        expectArray(/** @type {any} */ (value).data, 'episodes').map((item) => decodeEpisode(item)),
      ),
    `get subject episode ${id}`,
  );
}

/**
 * @typedef {{
 *   subject: import('./types.js').Subject,
 *   episodes: import('./types.js').Episode[],
 *   persons: import('./types.js').Person[],
 *   characters: import('./types.js').Character[]
 * }} BgmAnime
 */

/**
 * Fetch everything needed to generate a show's nfo files.
 *
 * The four calls are deliberately sequential: parallelising them would reorder
 * both the debug log lines and the requests reaching the API.
 *
 * @param {number} id
 * @returns {Promise<BgmAnime>}
 */
export async function getAnimeData(id) {
  const subject = await getSubject(id);
  const persons = await getSubjectPersons(id);
  const characters = await getSubjectCharacters(id);
  const episodes = await getSubjectEpisodes(id);
  return { subject, episodes, persons, characters };
}
