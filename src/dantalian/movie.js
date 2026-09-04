import { existsSync } from 'node:fs';
import { getSubject, getSubjectCharacters } from '../bangumi/client.js';
import { displayError, rootCause, withContextAsync } from '../errors.js';
import { error, info } from '../logger.js';
import { Generator } from '../nfogen/generator.js';
import { MOVIE_NFO_NAME, movieFromBgm } from '../nfogen/nfo.js';
import { parseConfig } from './config.js';
import { rustJoin, writeNfo } from './utils.js';
import { walkDepth1 } from './walkdir.js';

/**
 * Generate a `movie.nfo` for every movie directory under `source`.
 *
 * Unlike the show path this emits no per-file "Generate ..." line, matching the
 * Rust original's log output.
 *
 * @param {string} source
 * @param {(path: string) => boolean} isForce
 * @returns {Promise<void>}
 */
export async function dantalianMovie(source, isForce) {
  info(`Run dantalian for ${source}`);
  const generator = new Generator();
  for (const entry of walkDepth1(source)) {
    if (!entry.isDirectory) continue;
    info(`Check ${entry.path} ...`, 1);
    try {
      await handleDir(entry.path, isForce(entry.path), generator);
      info('Completed!', 2);
    } catch (e) {
      error(`Failed: ${displayError(e)}\n${displayError(rootCause(e))}`, 2);
    }
  }
}

async function handleDir(path, force, generator) {
  const config = await parseConfig(path);
  const movieNfoPath = rustJoin(path, MOVIE_NFO_NAME);
  if (!force && existsSync(movieNfoPath)) return;

  const movieData = await withContextAsync(() => getSubject(config.subject_id), 'get_movie_info');
  const characters = await withContextAsync(
    () => getSubjectCharacters(config.subject_id),
    'get_movie_character',
  );

  writeNfo(movieNfoPath, generator.genMovieNfo(movieFromBgm(movieData, characters)));
}
