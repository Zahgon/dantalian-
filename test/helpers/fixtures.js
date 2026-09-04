import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { decodeCharacter, decodeEpisode, decodePerson, decodeSubject, decodeSubjectBase } from '../../src/bangumi/types.js';
import { animeDataFromBgm } from '../../src/dantalian/data.js';
import { movieFromBgm } from '../../src/nfogen/nfo.js';

export function fixturePath(name) {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
}

export function golden(name) {
  return fileURLToPath(new URL(`../golden/${name}`, import.meta.url));
}

export function loadApiFixture(name) {
  return JSON.parse(readFileSync(fixturePath(`api/${name}.json`), 'utf8'));
}

export function loadAnimeFixture() {
  return animeDataFromBgm({
    subject: decodeSubject(loadApiFixture('subject_1671').body),
    persons: loadApiFixture('persons_1671').body.map(decodePerson),
    characters: loadApiFixture('characters_1671').body.map(decodeCharacter),
    episodes: loadApiFixture('episodes_1671').body.data.map(decodeEpisode),
  });
}

export function loadMovieFixture() {
  return movieFromBgm(
    decodeSubject(loadApiFixture('subject_244761').body),
    loadApiFixture('characters_244761').body.map(decodeCharacter),
  );
}

export function loadSearchFixture() {
  return loadApiFixture('search_littlewitch').body.data.map(decodeSubjectBase);
}

/**
 * Replace `globalThis.fetch` with a router over recorded API responses.
 *
 * Returns a restore function plus the ordered list of requested URLs, which the
 * end-to-end tests assert on to prove requests stay sequential and in the same
 * order the Rust client issues them.
 */
export function stubFetch(routes) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const sent = init.body === undefined ? null : new TextDecoder().decode(init.body);
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: sent });
    const key = Object.keys(routes).find((route) => url.endsWith(route));
    if (key === undefined) throw new Error(`unstubbed request: ${url}`);
    const { status, body } = loadApiFixture(routes[key]);
    const text = JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      arrayBuffer: async () => new TextEncoder().encode(text).buffer,
      text: async () => text,
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}
