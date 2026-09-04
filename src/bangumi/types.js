// Port of `src/bangumi/types.rs`.
//
// The decoders reproduce serde's strictness: unknown JSON fields are ignored,
// a missing required field is an error, `Option<T>` fields become `null` when
// absent or JSON null, `#[serde(default)]` vectors become `[]`, and the
// `Deserialize_repr` / `rename_all` enums reject unknown values.
//
// The `display*` functions reproduce the `Display` impls. Their `ind` argument
// is what the Rust code obtains from `indent_display(f)`: a `{:>N}` format spec
// makes the impl prefix every line with `indent(N)`, while a plain `{}` yields
// no prefix at all.

import { anyhow } from '../errors.js';
import { indent } from '../logger.js';
import { compareByCodePoint, dedupConsecutive, padStartChars, zeroPadFloat } from '../rustfmt.js';

const BGM_WEB = 'https://bgm.tv';

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, unknown>}
 */
function expectObject(value, field) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw anyhow(`invalid type: expected a map for \`${field}\``);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * A required field: absent or JSON-null is an error, matching a non-`Option`
 * serde field.
 *
 * @template T
 * @param {Record<string, unknown>} object
 * @param {string} key
 * @param {(value: unknown, field: string) => T} decode
 * @param {string} owner
 * @returns {T}
 */
function required(object, key, decode, owner) {
  const value = object[key];
  if (value === undefined || value === null) throw anyhow(`missing field \`${key}\` in ${owner}`);
  return decode(value, `${owner}.${key}`);
}

/**
 * @template T
 * @param {Record<string, unknown>} object
 * @param {string} key
 * @param {(value: unknown, field: string) => T} decode
 * @param {string} owner
 * @returns {T|null}
 */
function optional(object, key, decode, owner) {
  const value = object[key];
  if (value === undefined || value === null) return null;
  return decode(value, `${owner}.${key}`);
}

/**
 * A `#[serde(default)]` sequence.
 *
 * @template T
 * @param {Record<string, unknown>} object
 * @param {string} key
 * @param {(value: unknown, field: string) => T} decode
 * @param {string} owner
 * @returns {T[]}
 */
function defaultedArray(object, key, decode, owner) {
  const value = object[key];
  if (value === undefined || value === null) return [];
  return decodeArray(value, decode, `${owner}.${key}`);
}

/**
 * @template T
 * @param {unknown} value
 * @param {(value: unknown, field: string) => T} decode
 * @param {string} field
 * @returns {T[]}
 */
function decodeArray(value, decode, field) {
  if (!Array.isArray(value)) throw anyhow(`invalid type: expected a sequence for \`${field}\``);
  return value.map((item, index) => decode(item, `${field}[${index}]`));
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function decodeString(value, field) {
  if (typeof value !== 'string') throw anyhow(`invalid type: expected a string for \`${field}\``);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function decodeU32(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw anyhow(`invalid type: expected a u32 for \`${field}\``);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function decodeF64(value, field) {
  if (typeof value !== 'number') throw anyhow(`invalid type: expected a f64 for \`${field}\``);
  return value;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean}
 */
function decodeBool(value, field) {
  if (typeof value !== 'boolean') throw anyhow(`invalid type: expected a bool for \`${field}\``);
  return value;
}

/**
 * Build a decoder for a `Deserialize_repr` enum over `u32` discriminants.
 *
 * @template {Record<string, number>} T
 * @param {T} variants
 * @param {string} name
 * @returns {(value: unknown, field: string) => T[keyof T]}
 */
function reprEnumDecoder(variants, name) {
  const allowed = new Set(Object.values(variants));
  return (value, field) => {
    const discriminant = decodeU32(value, field);
    if (!allowed.has(discriminant)) {
      throw anyhow(`invalid value: integer \`${discriminant}\`, expected variant of ${name}`);
    }
    return /** @type {T[keyof T]} */ (discriminant);
  };
}

/** `SubjectType`, a `#[repr(u32)]` enum. */
export const SubjectType = Object.freeze({
  Book: 1,
  Anime: 2,
  Music: 3,
  Game: 4,
  Real: 6,
});

const decodeSubjectType = reprEnumDecoder(SubjectType, 'SubjectType');

/** `PersonType`, a `#[repr(u32)]` enum. */
export const PersonType = Object.freeze({
  Person: 1,
  Company: 2,
  Group: 3,
});

const decodePersonType = reprEnumDecoder(PersonType, 'PersonType');

/** `EpisodeType`, a `#[repr(u32)]` enum. */
export const EpisodeType = Object.freeze({
  Honpen: 0,
  Sp: 1,
  OP: 2,
  ED: 3,
  CM: 4,
  MAD: 5,
  Other: 6,
});

const decodeEpisodeType = reprEnumDecoder(EpisodeType, 'EpisodeType');

/** @type {Record<number, string>} */
const EPISODE_TYPE_DISPLAY = {
  [EpisodeType.Honpen]: '',
  [EpisodeType.Sp]: 'SP',
  [EpisodeType.OP]: 'OP',
  [EpisodeType.ED]: 'ED',
  [EpisodeType.CM]: 'CM',
  [EpisodeType.MAD]: 'MAD',
  [EpisodeType.Other]: 'Other',
};

/**
 * @param {number} episodeType
 * @returns {string}
 */
export function displayEpisodeType(episodeType) {
  return EPISODE_TYPE_DISPLAY[episodeType] ?? '';
}

/** `PersonCareer`, a `#[serde(rename_all = "lowercase")]` enum. */
const PERSON_CAREERS = new Set([
  'producer',
  'mangaka',
  'artist',
  'seiyu',
  'writer',
  'illustrator',
  'actor',
]);

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string}
 */
function decodePersonCareer(value, field) {
  const career = decodeString(value, field);
  if (!PERSON_CAREERS.has(career)) {
    throw anyhow(`unknown variant \`${career}\`, expected one of ${[...PERSON_CAREERS].map((c) => `\`${c}\``).join(', ')}`);
  }
  return career;
}

/**
 * @typedef {{ large: string, common: string, medium: string, small: string, grid: string }} SubjectImage
 * @typedef {{ large: string, medium: string, small: string, grid: string }} CharacterImage
 * @typedef {{ rank: number, total: number, score: number, count: Record<string, number> }} SubjectRating
 * @typedef {{ wish: number, collect: number, doing: number, on_hold: number, dropped: number }} SubjectCollection
 * @typedef {{ name: string, count: number }} Tag
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {SubjectImage}
 */
function decodeSubjectImage(value, field) {
  const o = expectObject(value, field);
  return {
    large: required(o, 'large', decodeString, field),
    common: required(o, 'common', decodeString, field),
    medium: required(o, 'medium', decodeString, field),
    small: required(o, 'small', decodeString, field),
    grid: required(o, 'grid', decodeString, field),
  };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {CharacterImage}
 */
function decodeCharacterImage(value, field) {
  const o = expectObject(value, field);
  return {
    large: required(o, 'large', decodeString, field),
    medium: required(o, 'medium', decodeString, field),
    small: required(o, 'small', decodeString, field),
    grid: required(o, 'grid', decodeString, field),
  };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Record<string, number>}
 */
function decodeSubjectRatingCount(value, field) {
  const o = expectObject(value, field);
  /** @type {Record<string, number>} */
  const count = {};
  for (let i = 1; i <= 10; i += 1) {
    count[String(i)] = required(o, String(i), decodeU32, field);
  }
  return count;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {SubjectRating}
 */
function decodeSubjectRating(value, field) {
  const o = expectObject(value, field);
  return {
    rank: required(o, 'rank', decodeU32, field),
    total: required(o, 'total', decodeU32, field),
    score: required(o, 'score', decodeF64, field),
    count: required(o, 'count', decodeSubjectRatingCount, field),
  };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {SubjectCollection}
 */
function decodeSubjectCollection(value, field) {
  const o = expectObject(value, field);
  return {
    wish: required(o, 'wish', decodeU32, field),
    collect: required(o, 'collect', decodeU32, field),
    doing: required(o, 'doing', decodeU32, field),
    on_hold: required(o, 'on_hold', decodeU32, field),
    dropped: required(o, 'dropped', decodeU32, field),
  };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Tag}
 */
function decodeTag(value, field) {
  const o = expectObject(value, field);
  return {
    name: required(o, 'name', decodeString, field),
    count: required(o, 'count', decodeU32, field),
  };
}

/**
 * @typedef {{
 *   id: number, subject_type: number|null, name: string, name_cn: string,
 *   summary: string, date: string|null, rating: SubjectRating,
 *   images: SubjectImage, tags: Tag[]
 * }} SubjectBase
 */

/**
 * @param {unknown} value
 * @param {string} [field]
 * @returns {SubjectBase}
 */
export function decodeSubjectBase(value, field = 'SubjectBase') {
  const o = expectObject(value, field);
  return {
    id: required(o, 'id', decodeU32, field),
    subject_type: optional(o, 'type', decodeSubjectType, field),
    name: required(o, 'name', decodeString, field),
    name_cn: required(o, 'name_cn', decodeString, field),
    summary: required(o, 'summary', decodeString, field),
    date: optional(o, 'date', decodeString, field),
    rating: required(o, 'rating', decodeSubjectRating, field),
    images: required(o, 'images', decodeSubjectImage, field),
    tags: defaultedArray(o, 'tags', decodeTag, field),
  };
}

/**
 * @typedef {{
 *   id: number, subject_type: number, name: string, name_cn: string,
 *   summary: string, nsfw: boolean, date: string|null, platform: string,
 *   images: SubjectImage|null, eps: number|null, total_episodes: number|null,
 *   rating: SubjectRating, collection: SubjectCollection, tags: Tag[]
 * }} Subject
 */

/**
 * @param {unknown} value
 * @param {string} [field]
 * @returns {Subject}
 */
export function decodeSubject(value, field = 'Subject') {
  const o = expectObject(value, field);
  return {
    id: required(o, 'id', decodeU32, field),
    subject_type: required(o, 'type', decodeSubjectType, field),
    name: required(o, 'name', decodeString, field),
    name_cn: required(o, 'name_cn', decodeString, field),
    summary: required(o, 'summary', decodeString, field),
    nsfw: required(o, 'nsfw', decodeBool, field),
    date: optional(o, 'date', decodeString, field),
    platform: required(o, 'platform', decodeString, field),
    images: optional(o, 'images', decodeSubjectImage, field),
    eps: optional(o, 'eps', decodeU32, field),
    total_episodes: optional(o, 'total_episodes', decodeU32, field),
    rating: required(o, 'rating', decodeSubjectRating, field),
    collection: required(o, 'collection', decodeSubjectCollection, field),
    tags: defaultedArray(o, 'tags', decodeTag, field),
  };
}

/**
 * @typedef {{
 *   id: number, name: string, actor_type: number, career: string[],
 *   short_summary: string, locked: boolean, images: CharacterImage|null
 * }} Actor
 * @typedef {{
 *   id: number, name: string, character_type: number,
 *   images: CharacterImage|null, relation: string, actors: Actor[]
 * }} Character
 * @typedef {{
 *   id: number, images: CharacterImage|null, person_type: number,
 *   career: string[], name: string, relation: string
 * }} Person
 */

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Actor}
 */
function decodeActor(value, field) {
  const o = expectObject(value, field);
  return {
    id: required(o, 'id', decodeU32, field),
    name: required(o, 'name', decodeString, field),
    actor_type: required(o, 'type', decodePersonType, field),
    career: defaultedArray(o, 'career', decodePersonCareer, field),
    short_summary: required(o, 'short_summary', decodeString, field),
    locked: required(o, 'locked', decodeBool, field),
    images: optional(o, 'images', decodeCharacterImage, field),
  };
}

/**
 * @param {unknown} value
 * @param {string} [field]
 * @returns {Character}
 */
export function decodeCharacter(value, field = 'Character') {
  const o = expectObject(value, field);
  return {
    id: required(o, 'id', decodeU32, field),
    name: required(o, 'name', decodeString, field),
    character_type: required(o, 'type', decodeU32, field),
    images: optional(o, 'images', decodeCharacterImage, field),
    relation: required(o, 'relation', decodeString, field),
    actors: defaultedArray(o, 'actors', decodeActor, field),
  };
}

/**
 * Note that unlike `Actor.career`, `Person.career` has no `#[serde(default)]`
 * in the original and is therefore required.
 *
 * @param {unknown} value
 * @param {string} [field]
 * @returns {Person}
 */
export function decodePerson(value, field = 'Person') {
  const o = expectObject(value, field);
  return {
    id: required(o, 'id', decodeU32, field),
    images: optional(o, 'images', decodeCharacterImage, field),
    person_type: required(o, 'type', decodePersonType, field),
    career: required(o, 'career', (v, f) => decodeArray(v, decodePersonCareer, f), field),
    name: required(o, 'name', decodeString, field),
    relation: required(o, 'relation', decodeString, field),
  };
}

/**
 * @typedef {{
 *   id: number, episode_type: number, ep: number|null, sort: number,
 *   name: string, name_cn: string, duration: string, airdate: string,
 *   comment: number, desc: string, duration_seconds: number|null
 * }} Episode
 */

/**
 * @param {unknown} value
 * @param {string} [field]
 * @returns {Episode}
 */
export function decodeEpisode(value, field = 'Episode') {
  const o = expectObject(value, field);
  return {
    id: required(o, 'id', decodeU32, field),
    episode_type: required(o, 'type', decodeEpisodeType, field),
    ep: optional(o, 'ep', decodeF64, field),
    sort: required(o, 'sort', decodeF64, field),
    name: required(o, 'name', decodeString, field),
    name_cn: required(o, 'name_cn', decodeString, field),
    duration: required(o, 'duration', decodeString, field),
    airdate: required(o, 'airdate', decodeString, field),
    comment: required(o, 'comment', decodeU32, field),
    desc: required(o, 'desc', decodeString, field),
    duration_seconds: optional(o, 'duration_seconds', decodeU32, field),
  };
}

/**
 * `Episode::is_empty` — an episode with neither name is skipped entirely.
 *
 * @param {Episode} episode
 * @returns {boolean}
 */
export function episodeIsEmpty(episode) {
  return episode.name === '' && episode.name_cn === '';
}

/**
 * The API's error envelope. Carries a `display()` method so `formatAnyhowError`
 * renders it exactly as Rust's `Display for BgmError` does.
 */
export class BgmError extends Error {
  /**
   * @param {string} title
   * @param {string} description
   * @param {string|Record<string, string>} details
   */
  constructor(title, description, details) {
    super(`[${title}] ${description}`);
    this.name = 'BgmError';
    this.title = title;
    this.description = description;
    this.details = details;
  }

  /**
   * Reproduces `"[{title}] {description}\n* {details:?}"`, where `details` is
   * printed with Rust's `Debug` impl for the untagged
   * `enum BgmErrorDetail { Str(String), Map(HashMap<String, String>) }`.
   *
   * @returns {string}
   */
  display() {
    return `[${this.title}] ${this.description}\n* ${this.#debugDetails()}`;
  }

  /**
   * @returns {string}
   */
  #debugDetails() {
    if (typeof this.details === 'string') return `Str(${JSON.stringify(this.details)})`;
    const entries = Object.entries(this.details)
      .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
      .join(', ');
    return `Map({${entries}})`;
  }
}

/**
 * @param {unknown} value
 * @returns {BgmError}
 */
export function decodeBgmError(value) {
  const o = expectObject(value, 'BgmError');
  const details = o['details'];
  /** @type {string|Record<string, string>} */
  let decodedDetails;
  if (typeof details === 'string') {
    decodedDetails = details;
  } else {
    const map = expectObject(details, 'BgmError.details');
    /** @type {Record<string, string>} */
    const out = {};
    for (const [key, item] of Object.entries(map)) {
      out[key] = decodeString(item, `BgmError.details.${key}`);
    }
    decodedDetails = out;
  }
  return new BgmError(
    required(o, 'title', decodeString, 'BgmError'),
    required(o, 'description', decodeString, 'BgmError'),
    decodedDetails,
  );
}

/**
 * @param {number} id
 * @returns {string}
 */
export function subjectUrl(id) {
  return `${BGM_WEB}/subject/${id}`;
}

/**
 * `Display for SubjectBase`.
 *
 * @param {SubjectBase} subject
 * @param {number|null} ind indent level from the format spec, or `null` for `{}`
 * @returns {string}
 */
export function displaySubjectBase(subject, ind = null) {
  const p = ind === null ? '' : indent(ind);
  return [
    `${p}* ${subject.name} / ${subject.name_cn}`,
    `${p}  Subject ID: ${subject.id}`,
    `${p}  Air Date: ${subject.date ?? '*'}`,
    `${p}  URL: ${subjectUrl(subject.id)}`,
  ].join('\n');
}

/**
 * `Display for Subject`.
 *
 * @param {Subject} subject
 * @param {number|null} ind
 * @returns {string}
 */
export function displaySubject(subject, ind = null) {
  const p = ind === null ? '' : indent(ind);
  return [
    `${p}* ${subject.name} / ${subject.name_cn}`,
    `${p}* ${subjectUrl(subject.id)}`,
    `${p}  Air Date: ${subject.date ?? '*'}`,
    `${p}* ${subject.summary}`,
  ].join('\n');
}

/**
 * `Display for Persons` — names sorted by code point, de-duplicated, `/`-joined.
 *
 * @param {Person[]} persons
 * @param {number|null} ind
 * @returns {string}
 */
export function displayPersons(persons, ind = null) {
  const p = ind === null ? '' : indent(ind);
  const names = dedupConsecutive(persons.map((person) => person.name).sort(compareByCodePoint));
  return `${p}* staff: ${names.join('/')}`;
}

/**
 * `Display for Characters`.
 *
 * @param {Character[]} characters
 * @param {number|null} ind
 * @returns {string}
 */
export function displayCharacters(characters, ind = null) {
  const p = ind === null ? '' : indent(ind);
  const names = dedupConsecutive(characters.map((character) => character.name).sort(compareByCodePoint));
  return `${p}* characters: ${names.join('/')}`;
}

/**
 * `Display for Episode`.
 *
 * The index is built as `format!("{:>3}{:02}", episode_type, sort)`. The `{:>3}`
 * is a no-op: `Display for EpisodeType` writes through `write!` rather than
 * `f.pad`, so Rust never applies the width to it. Only the `{:02}` zero-padding
 * of the sort number and the outer `{:>6}` alignment have any effect, giving
 * e.g. `"    01"` or `" SP5.5"`.
 *
 * @param {Episode} episode
 * @param {number|null} ind
 * @returns {string}
 */
export function displayEpisode(episode, ind = null) {
  const p = ind === null ? '' : indent(ind);
  const idx = displayEpisodeType(episode.episode_type) + zeroPadFloat(episode.sort, 2);
  return `${p}${padStartChars(idx, 6)}: ${episode.name} / ${episode.name_cn}`;
}

/**
 * `Display for EpisodeResponse` — each episode rendered at the outer width and
 * joined by newlines.
 *
 * @param {Episode[]} episodes
 * @param {number|null} ind
 * @returns {string}
 */
export function displayEpisodes(episodes, ind = null) {
  return episodes.map((episode) => displayEpisode(episode, ind)).join('\n');
}
