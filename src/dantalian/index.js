import { getAnimeData } from '../bangumi/client.js';
import { anyhow, displayError, rootCause, withContextAsync } from '../errors.js';
import { error, info } from '../logger.js';
import { Generator } from '../nfogen/generator.js';
import { TVSHOW_NFO_NAME } from '../nfogen/nfo.js';
import { parseConfig } from './config.js';
import { animeDataFromBgm, findEpisode } from './data.js';
import { jobIsEmpty, parseJob } from './job.js';
import { rustJoin, writeNfo } from './utils.js';
import { walkDepth1 } from './walkdir.js';

export { dantalianMovie } from './movie.js';

/**
 * Generate tvshow and episode nfo files for every show directory under `source`.
 *
 * A failure inside one directory is reported and skipped; only a failure to walk
 * `source` itself aborts the run.
 *
 * @param {string} source
 * @param {(path: string) => boolean} isForce receives the full walked path, not
 *   the directory's own name
 * @returns {Promise<void>}
 */
export async function dantalian(source, isForce) {
  info(`Run dantalian for ${source}`);
  for (const entry of walkDepth1(source)) {
    if (!entry.isDirectory) continue;
    info(`Check ${entry.path} ...`, 1);
    try {
      await handleDir(entry.path, isForce(entry.path));
      info('Completed!', 2);
    } catch (e) {
      error(`Failed: ${displayError(e)}\n${displayError(rootCause(e))}`, 2);
    }
  }
}

async function handleDir(path, force) {
  const config = await parseConfig(path);
  const job = parseJob(path, config, force);
  if (jobIsEmpty(job)) {
    info('No file should be generate, skip.', 3);
    return;
  }

  const bgmData = await withContextAsync(() => getAnimeData(job.subject_id), 'get_anime_data');
  info(
    `Fetch anime data for: [${bgmData.subject.id}] ${bgmData.subject.name} / ${bgmData.subject.name_cn}`,
    3,
  );

  const animeData = animeDataFromBgm(bgmData);
  const generator = new Generator();

  if (job.should_gen_tvshow) {
    info(`Generate ${TVSHOW_NFO_NAME} ...`, 4);
    writeNfo(rustJoin(path, TVSHOW_NFO_NAME), generator.genTvshowNfo(animeData.tvshow));
  }

  for (const episode of job.episodes) {
    info(`Generate ${episode.filename} ...`, 4);
    const data = findEpisode(animeData, episode.index, episode.is_sp);
    if (data === undefined) {
      throw anyhow(`Can't find ep ${episode.index}, is_sp ${episode.is_sp}`);
    }
    writeNfo(episode.filename, generator.genEpisodeNfo(data));
  }
}
