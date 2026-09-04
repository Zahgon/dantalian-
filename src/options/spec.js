import { BGM_GET_EP_HELP, BGM_GET_HELP, BGM_HELP, BGM_SEARCH_HELP, ROOT_HELP } from './help.js';

const HELP_ARG = { long: 'help', short: 'h', help: true, desc: 'Print help information' };

export const HELP_SUBCOMMAND_ABOUT = 'Print this message or the help of the given subcommand(s)';

export const BGM_SEARCH = {
  name: 'search',
  bin: 'dantalian bgm search',
  about: 'search subject in bangumi',
  usage: 'dantalian bgm search [KEYWORD]...',
  help: BGM_SEARCH_HELP,
  args: [HELP_ARG],
  argOrder: ['help'],
  positionals: [{ name: '<KEYWORD>...', key: 'keyword', variadic: true, desc: 'search keywords' }],
};

export const BGM_GET = {
  name: 'get',
  bin: 'dantalian bgm get',
  about: 'try get subject info by id',
  usage: 'dantalian bgm get [OPTIONS] <ID>',
  help: BGM_GET_HELP,
  args: [
    HELP_ARG,
    { long: 'no-characters', key: 'no_characters', desc: "doesn't get characters infomation" },
    { long: 'no-persons', key: 'no_persons', desc: "doesn't get person(staff) infomation" },
  ],
  argOrder: ['no-persons', 'no-characters', 'help'],
  positionals: [
    { name: '<ID>', key: 'id', integer: true, required: true, desc: 'subject id. can get from search' },
  ],
};

export const BGM_GET_EP = {
  name: 'get-ep',
  bin: 'dantalian bgm get-ep',
  about: 'try get episode info by subject id',
  usage: 'dantalian bgm get-ep <ID>',
  help: BGM_GET_EP_HELP,
  args: [HELP_ARG],
  argOrder: ['help'],
  positionals: [{ name: '<ID>', key: 'id', integer: true, required: true, desc: 'subject id' }],
};

export const BGM = {
  name: 'bgm',
  about: 'cli tools to play with bangumi apis',
  bin: 'dantalian bgm',
  usage: 'dantalian bgm <SUBCOMMAND>',
  help: BGM_HELP,
  args: [HELP_ARG],
  argOrder: ['help'],
  positionals: [],
  subcommands: [BGM_GET, BGM_GET_EP, BGM_SEARCH],
  subcommandOrder: ['search', 'get', 'get-ep'],
  subcommandRequired: true,
};

export const ROOT = {
  name: 'dantalian',
  bin: 'dantalian',
  usage: 'dantalian [OPTIONS] [SUBCOMMAND]',
  help: ROOT_HELP,
  args: [
    {
      long: 'access-token',
      value: 'ACCESS_TOKEN',
      key: 'access_token',
      desc: 'use your personal token to access more subject. get one from https://next.bgm.tv/demo/access-token/create',
    },
    {
      long: 'force',
      value: 'FORCE',
      key: 'force',
      multiple: true,
      desc: 'paths which you want to force re-generate',
    },
    { long: 'force-all', key: 'force_all', desc: 'force re-generate all nfo files for all anime' },
    HELP_ARG,
    {
      long: 'movie-source',
      short: 'm',
      value: 'MOVIE_SOURCE',
      key: 'movie_source',
      multiple: true,
      valueHint: 'dir',
      desc: 'movies source folder. can be used multiple times to decide multi source',
    },
    {
      long: 'source',
      short: 's',
      value: 'SOURCE',
      key: 'source',
      multiple: true,
      valueHint: 'dir',
      desc: 'anime source folder. can be used multiple times to decide multi source',
    },
    { long: 'verbose', short: 'v', key: 'verbose', desc: 'show more information' },
    { long: 'version', short: 'V', version: true, desc: 'Print version information' },
  ],
  argOrder: ['help', 'version', 'verbose', 'source', 'movie-source', 'force', 'force-all', 'access-token'],
  positionals: [],
  subcommands: [BGM],
  subcommandOrder: ['bgm'],
  subcommandRequired: false,
};

export function findSubcommand(command, name) {
  return (command.subcommands ?? []).find((sub) => sub.name === name) ?? null;
}
