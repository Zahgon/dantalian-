import { EpisodeType, episodeIsEmpty } from '../bangumi/types.js';
import { buildActors } from '../nfogen/nfo.js';
import { f64, rustFloatDisplay } from '../rustfmt.js';

/**
 * @typedef {{
 *   tvshow: import('../nfogen/nfo.js').TVShow,
 *   episodes: import('../nfogen/nfo.js').Episode[]
 * }} AnimeData
 */

/**
 * Turn a subject's bangumi payload into the view models the templates render.
 *
 * @param {import('../bangumi/client.js').BgmAnime} bgmData
 * @returns {AnimeData}
 */
export function animeDataFromBgm(bgmData) {
  const { subject, persons, characters } = bgmData;

  const actors = buildActors(characters);

  const directors = [];
  const credits = [];
  for (const person of persons) {
    if (person.relation === '导演') directors.push(person.name);
    else if (person.relation === '脚本') credits.push(person.name);
  }

  /** @type {import('../nfogen/nfo.js').TVShow} */
  const tvshow = {
    uid: subject.id,
    title: subject.name_cn,
    original_title: subject.name,
    rating_value: f64(subject.rating.score),
    rating_votes: subject.rating.total,
    has_sp: false,
    eps_count: subject.total_episodes,
    plot: subject.summary,
    poster: subject.images === null ? null : subject.images.large,
    genres: [],
    tags: [],
    premiered: subject.date ?? '*',
    status: null,
    studio: null,
    actors,
  };

  /** @type {import('../nfogen/nfo.js').Episode[]} */
  const episodes = [];
  for (const be of bgmData.episodes) {
    if (episodeIsEmpty(be)) continue;
    const isSp = be.episode_type === EpisodeType.Sp;
    tvshow.has_sp = tvshow.has_sp || isSp;
    episodes.push({
      uid: be.id,
      title: be.name_cn,
      original_title: be.name,
      show_title: tvshow.title,
      rating_value: null,
      rating_votes: null,
      ep_index: rustFloatDisplay(be.sort),
      is_sp: isSp,
      plot: be.desc,
      directors,
      credits,
      premiered: tvshow.premiered,
      status: null,
      aired: be.airdate,
      studio: null,
      actors,
    });
  }

  return { tvshow, episodes };
}

/**
 * @param {AnimeData} data
 * @param {string} index
 * @param {boolean} isSp
 * @returns {import('../nfogen/nfo.js').Episode|undefined}
 */
export function findEpisode(data, index, isSp) {
  return data.episodes.find((ep) => ep.ep_index === index && ep.is_sp === isSp);
}
