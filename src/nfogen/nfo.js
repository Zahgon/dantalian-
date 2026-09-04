// The nfo template literals and the view models fed to them.
//
// The three template strings below are byte-for-byte copies of the Rust
// constants in `src/nfogen/nfo.rs`. Their whitespace is load-bearing: because
// `tinytemplate` performs no trimming, the placement of newlines relative to
// `{{ if }}` / `{{ for }}` tags is what produces the exact generated XML. Do not
// reformat them.

import { F64, f64 } from '../rustfmt.js';

export const TVSHOW_NFO_NAME = 'tvshow.nfo';
export const MOVIE_NFO_NAME = 'movie.nfo';

export const TVSHOW_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tvshow>
    <title>{title}</title>
    <originaltitle>{original_title}</originaltitle>
    <ratings>
        <rating name="bangumi" max="10" default="true">
            <value>{rating_value}</value>
            <votes>{rating_votes}</votes>
        </rating>
    </ratings>
    <season>{{ if has_sp }}2{{ else }}1{{ endif }}</season>
    {{ if eps_count }}<episode>{eps_count}</episode>{{ endif }}
    <plot>{plot}</plot>
    {{ if poster }}<thumb aspect="poster" preview="{poster}">{poster}</thumb>{{ endif }}
    <uniqueid type="bangumi" default="true">{uid}</uniqueid>{{ for g in genres }}
    <genre>{g}</genre>{{ endfor }}{{ for t in tags }}
    <tag>{t}</tag>{{ endfor }}
    <premiered>{premiered}</premiered>{{ if status }}
    <status>{status}</status>{{ endif }}{{ if studio }}
    <studio>{studio}</studio>{{ endif }}{{ for a in actors }}
    <actor>
        <name>{a.name}</name>
        <role>{a.role}</role>
        <order>{a.order}</order>
        <thumb>{a.thumb}</thumb>
    </actor>{{ endfor }}
</tvshow>
`;

export const EPISODE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
    <title>{title}</title>
    <originaltitle>{original_title}</originaltitle>
    <showtitle>{show_title}</showtitle>{{ if rating_value }}
    <ratings>
        <rating name="bangumi" max="10" default="true">
            <value>{rating_value}</value>
            {{ if rating_votes }}<votes>{rating_votes}</votes>{{ endif }}
        </rating>
    </ratings>{{ endif }}
    <season>{{ if is_sp }}0{{ else }}1{{ endif }}</season>
    <episode>{ep_index}</episode>
    <plot>{plot}</plot>
    <uniqueid type="bangumi" default="true">{uid}</uniqueid>{{ for c in credits }}
    <credits>{c}</credits>{{ endfor }}{{ for d in directors }}
    <director>{d}</director>{{ endfor }}
    <premiered>{premiered}</premiered>{{ if status }}
    <status>{status}</status>
    {{ endif }}<aired>{aired}</aired>{{ if studio }}
    <studio>{studio}</studio>{{ endif }}{{ for a in actors }}
    <actor>
        <name>{a.name}</name>
        <role>{a.role}</role>
        <order>{a.order}</order>
        <thumb>{a.thumb}</thumb>
    </actor>{{ endfor }}
</episodedetails>
`;

export const MOVIE_TEMPLATE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<movie>
    <title>{title}</title>
    <originaltitle>{original_title}</originaltitle>
    <ratings>
        <rating name="bangumi" max="10" default="true">
            <value>{rating_value}</value>
            <votes>{rating_votes}</votes>
        </rating>
    </ratings>
    <plot>{plot}</plot>
    {{ if poster }}<thumb aspect="poster" preview="{poster}">{poster}</thumb>{{ endif }}
    <uniqueid type="bangumi" default="true">{uid}</uniqueid>{{ for g in genres }}
    <genre>{g}</genre>{{ endfor }}{{ for t in tags }}
    <tag>{t}</tag>{{ endfor }}
    <premiered>{premiered}</premiered>{{ if status }}
    <status>{status}</status>{{ endif }}{{ if studio }}
    <studio>{studio}</studio>{{ endif }}{{ for a in actors }}
    <actor>
        <name>{a.name}</name>
        <role>{a.role}</role>
        <order>{a.order}</order>
        <thumb>{a.thumb}</thumb>
    </actor>{{ endfor }}
</movie>
`;

/**
 * @typedef {{ name: string, role: string, order: number, thumb: string }} Actor
 * @typedef {{
 *   uid: number, title: string, original_title: string,
 *   rating_value: F64, rating_votes: number,
 *   has_sp: boolean, eps_count: number|null, plot: string, poster: string|null,
 *   genres: string[], tags: string[], premiered: string,
 *   status: string|null, studio: string|null, actors: Actor[]
 * }} TVShow
 * @typedef {{
 *   uid: number, title: string, original_title: string, show_title: string,
 *   rating_value: F64|null, rating_votes: number|null,
 *   ep_index: string, is_sp: boolean, plot: string,
 *   directors: string[], credits: string[], premiered: string,
 *   status: string|null, aired: string|null, studio: string|null, actors: Actor[]
 * }} Episode
 * @typedef {{
 *   uid: number, title: string, original_title: string,
 *   rating_value: F64, rating_votes: number, plot: string, poster: string|null,
 *   genres: string[], tags: string[], premiered: string,
 *   status: string|null, studio: string|null, actors: Actor[]
 * }} Movie
 */

/**
 * Flatten a subject's characters into nfo actor entries.
 *
 * The `name`/`role` assignment looks inverted and is: the original deliberately
 * puts the *character* name in `<name>` and the *voice actor* name in `<role>`,
 * which is what Jellyfin and Kodi expect for anime. `order` is the running index
 * across all emitted entries, not per character.
 *
 * @param {import('../bangumi/types.js').Character[]} characters
 * @returns {Actor[]}
 */
export function buildActors(characters) {
  /** @type {Actor[]} */
  const actors = [];
  for (const character of characters) {
    const thumb = character.images === null ? '' : character.images.large;
    if (character.actors.length === 0) {
      actors.push({ name: character.name, role: 'N/A', order: actors.length, thumb });
    } else {
      for (const actor of character.actors) {
        actors.push({ name: character.name, role: actor.name, order: actors.length, thumb });
      }
    }
  }
  return actors;
}

/**
 * Build the movie view model from a bangumi subject.
 *
 * Actors are computed and then discarded: the Rust original carries a
 * `// TODO: Set real date.` comment and passes an empty vector to the struct, so
 * a generated `movie.nfo` never contains an `<actor>` element. That behaviour is
 * reproduced here rather than fixed, to keep output identical.
 *
 * @param {import('../bangumi/types.js').Subject} subject
 * @param {import('../bangumi/types.js').Character[]} characters
 * @returns {Movie}
 */
export function movieFromBgm(subject, characters) {
  buildActors(characters);
  return {
    uid: subject.id,
    title: subject.name_cn,
    original_title: subject.name,
    rating_value: f64(subject.rating.score),
    rating_votes: subject.rating.total,
    plot: subject.summary,
    poster: subject.images === null ? null : subject.images.large,
    genres: [],
    tags: [],
    premiered: subject.date ?? '*',
    status: null,
    studio: null,
    actors: [],
  };
}
