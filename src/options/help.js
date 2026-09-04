import { PKG_AUTHORS, PKG_DESCRIPTION, PKG_NAME, VERSION } from '../version.js';

export const VERSION_TEXT = `${PKG_NAME} ${VERSION}\n`;

export const ROOT_HELP = `${PKG_NAME} ${VERSION}
${PKG_AUTHORS}
${PKG_DESCRIPTION}

USAGE:
    dantalian [OPTIONS] [SUBCOMMAND]

OPTIONS:
        --access-token <ACCESS_TOKEN>
            use your personal token to access more subject. get one from
            https://next.bgm.tv/demo/access-token/create

        --force <FORCE>
            paths which you want to force re-generate

        --force-all
            force re-generate all nfo files for all anime

    -h, --help
            Print help information

    -m, --movie-source <MOVIE_SOURCE>
            movies source folder. can be used multiple times to decide multi source

    -s, --source <SOURCE>
            anime source folder. can be used multiple times to decide multi source

    -v, --verbose
            show more information

    -V, --version
            Print version information

SUBCOMMANDS:
    bgm     cli tools to play with bangumi apis
    help    Print this message or the help of the given subcommand(s)
`;

export const BGM_HELP = `dantalian-bgm 
cli tools to play with bangumi apis

USAGE:
    dantalian bgm <SUBCOMMAND>

OPTIONS:
    -h, --help    Print help information

SUBCOMMANDS:
    get       try get subject info by id
    get-ep    try get episode info by subject id
    help      Print this message or the help of the given subcommand(s)
    search    search subject in bangumi
`;

export const BGM_SEARCH_HELP = `dantalian-bgm-search 
search subject in bangumi

USAGE:
    dantalian bgm search [KEYWORD]...

ARGS:
    <KEYWORD>...    search keywords

OPTIONS:
    -h, --help    Print help information
`;

export const BGM_GET_HELP = `dantalian-bgm-get 
try get subject info by id

USAGE:
    dantalian bgm get [OPTIONS] <ID>

ARGS:
    <ID>    subject id. can get from search

OPTIONS:
    -h, --help             Print help information
        --no-characters    doesn't get characters infomation
        --no-persons       doesn't get person(staff) infomation
`;

export const BGM_GET_EP_HELP = `dantalian-bgm-get-ep 
try get episode info by subject id

USAGE:
    dantalian bgm get-ep <ID>

ARGS:
    <ID>    subject id

OPTIONS:
    -h, --help    Print help information
`;
