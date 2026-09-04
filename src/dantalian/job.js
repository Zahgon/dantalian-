import { existsSync } from 'node:fs';
import { PARSE_ERROR, parseRustF64, rustFloatDisplay, rustFloatParseErrorMessage } from '../rustfmt.js';
import { TVSHOW_NFO_NAME } from '../nfogen/nfo.js';
import { isVideoFile, rustJoin, withExtension } from './utils.js';
import { walkDepth1 } from './walkdir.js';

/**
 * @typedef {{ index: string, is_sp: boolean, filename: string }} EpisodeJob
 * @typedef {{ subject_id: number, should_gen_tvshow: boolean, episodes: EpisodeJob[] }} Job
 */

/**
 * Decide which nfo files a show directory still needs.
 *
 * @param {string} dir
 * @param {import('./config.js').Config} config
 * @param {boolean} force regenerate even when the nfo file already exists
 * @returns {Job}
 */
export function parseJob(dir, config, force) {
  const shouldGenTvshow = force || !existsSync(rustJoin(dir, TVSHOW_NFO_NAME));

  const episodes = [];
  for (const entry of walkDepth1(dir)) {
    if (!entry.isFile) continue;
    const episode = checkEpisode(entry, config, force);
    if (episode !== null) episodes.push(episode);
  }

  return { subject_id: config.subject_id, should_gen_tvshow: shouldGenTvshow, episodes };
}

/**
 * @param {import('./walkdir.js').DirEntry} entry
 * @param {import('./config.js').Config} config
 * @param {boolean} force
 * @returns {EpisodeJob|null} `null` when the file needs no nfo
 */
function checkEpisode(entry, config, force) {
  if (!isVideoFile(entry.path)) return null;

  const nfoFilePath = withExtension(entry.path, 'nfo');
  if (!force && existsSync(nfoFilePath)) return null;

  const caps = config.episode_re.captures(entry.name);
  const matchedEp = caps?.name('ep');
  if (!matchedEp) return null;

  const stripped = matchedEp.asStr.replace(/^0+/, '');
  const epStr = stripped === '' ? '0' : stripped;
  const matchedSp = caps.name('sp');

  return {
    index: applyOffset(epStr, config.episode_offset),
    is_sp: matchedSp !== null && matchedSp.asStr !== '',
    filename: nfoFilePath,
  };
}

/**
 * Shift a captured episode number by the configured offset.
 *
 * When the capture does not parse as a float the Rust original formats the
 * parse error and uses that text as the episode index, producing an nfo
 * containing `<episode>invalid float literal</episode>`. The behaviour is
 * preserved here so both implementations generate identical files.
 *
 * @param {string} epStr
 * @param {number} offset
 * @returns {string}
 */
function applyOffset(epStr, offset) {
  if (offset === 0) return epStr;
  const parsed = parseRustF64(epStr);
  return parsed === PARSE_ERROR ? rustFloatParseErrorMessage(epStr) : rustFloatDisplay(parsed + offset);
}

/**
 * @param {Job} job
 * @returns {boolean}
 */
export function jobIsEmpty(job) {
  return !job.should_gen_tvshow && job.episodes.length === 0;
}
