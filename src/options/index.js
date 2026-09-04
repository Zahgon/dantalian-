import { parseCommand } from './parser.js';
import { ROOT } from './spec.js';

export { ClapError, ClapExit } from './clap-error.js';

function buildBgmSubcmd(bgm) {
  const values = bgm.sub.values;
  switch (bgm.subcommand.name) {
    case 'search':
      return { type: 'search', keyword: values.keyword };
    case 'get':
      return { type: 'get', id: values.id, no_persons: values.no_persons, no_characters: values.no_characters };
    default:
      return { type: 'get-ep', id: values.id };
  }
}

export function parseOpts(argv) {
  const root = parseCommand(ROOT, argv, 0);
  const values = root.values;
  return {
    verbose: values.verbose,
    source: values.source,
    movie_source: values.movie_source,
    force: values.force,
    force_all: values.force_all,
    access_token: values.access_token,
    subcmd: root.subcommand === null ? null : { type: 'bgm', bgm: buildBgmSubcmd(root.sub) },
  };
}
