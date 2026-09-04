import {
  getSubject,
  getSubjectCharacters,
  getSubjectEpisodes,
  getSubjectPersons,
  searchAnime,
  setAccessToken,
} from './bangumi/client.js';
import {
  displayCharacters,
  displayEpisodes,
  displayPersons,
  displaySubject,
  displaySubjectBase,
} from './bangumi/types.js';
import { dantalian, dantalianMovie } from './dantalian/index.js';
import { formatAnyhowError } from './errors.js';
import { info, setMaxLevel } from './logger.js';
import { ClapError, ClapExit, parseOpts } from './options/index.js';

async function bgmSearch(options) {
  const keyword = options.keyword.join(' ');
  const response = await searchAnime(keyword);
  info(`found ${response.data.length} result(s):\n`);
  for (const item of response.data) info(displaySubjectBase(item, 1));
}

async function bgmGet(options) {
  info(displaySubject(await getSubject(options.id)));
  if (!options.no_persons) info(displayPersons(await getSubjectPersons(options.id)));
  if (!options.no_characters) info(displayCharacters(await getSubjectCharacters(options.id)));
}

async function bgmCmd(options) {
  switch (options.type) {
    case 'search':
      return bgmSearch(options);
    case 'get':
      return bgmGet(options);
    default:
      return info(displayEpisodes(await getSubjectEpisodes(options.id)));
  }
}

export async function main(argv) {
  const opts = parseOpts(argv);
  if (opts.access_token !== null) setAccessToken(opts.access_token);
  setMaxLevel(opts.verbose ? 'trace' : 'info');
  if (opts.subcmd !== null) {
    await bgmCmd(opts.subcmd.bgm);
    return;
  }
  const force = new Set(opts.force);
  const isForce = (path) => opts.force_all || force.has(path);
  for (const source of opts.source) await dantalian(source, isForce);
  for (const movieSource of opts.movie_source) await dantalianMovie(movieSource, isForce);
}

export async function run(argv) {
  try {
    await main(argv);
    process.exitCode = 0;
  } catch (error) {
    if (error instanceof ClapExit) {
      process.stdout.write(error.output);
      process.exitCode = 0;
    } else if (error instanceof ClapError) {
      process.stderr.write(error.output);
      process.exitCode = 2;
    } else {
      process.stderr.write(`${formatAnyhowError(error)}\n`);
      process.exitCode = 1;
    }
  }
}
