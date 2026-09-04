complete -c dantalian -n "__fish_use_subcommand" -s s -l source -d 'anime source folder. can be used multiple times to decide multi source' -r -f -a "(__fish_complete_directories)"
complete -c dantalian -n "__fish_use_subcommand" -s m -l movie-source -d 'movies source folder. can be used multiple times to decide multi source' -r -f -a "(__fish_complete_directories)"
complete -c dantalian -n "__fish_use_subcommand" -l force -d 'paths which you want to force re-generate' -r
complete -c dantalian -n "__fish_use_subcommand" -l access-token -d 'use your personal token to access more subject. get one from https://next.bgm.tv/demo/access-token/create' -r
complete -c dantalian -n "__fish_use_subcommand" -s h -l help -d 'Print help information'
complete -c dantalian -n "__fish_use_subcommand" -s V -l version -d 'Print version information'
complete -c dantalian -n "__fish_use_subcommand" -s v -l verbose -d 'show more information'
complete -c dantalian -n "__fish_use_subcommand" -l force-all -d 'force re-generate all nfo files for all anime'
complete -c dantalian -n "__fish_use_subcommand" -f -a "bgm" -d 'cli tools to play with bangumi apis'
complete -c dantalian -n "__fish_use_subcommand" -f -a "help" -d 'Print this message or the help of the given subcommand(s)'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and not __fish_seen_subcommand_from search; and not __fish_seen_subcommand_from get; and not __fish_seen_subcommand_from get-ep; and not __fish_seen_subcommand_from help" -s h -l help -d 'Print help information'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and not __fish_seen_subcommand_from search; and not __fish_seen_subcommand_from get; and not __fish_seen_subcommand_from get-ep; and not __fish_seen_subcommand_from help" -f -a "search" -d 'search subject in bangumi'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and not __fish_seen_subcommand_from search; and not __fish_seen_subcommand_from get; and not __fish_seen_subcommand_from get-ep; and not __fish_seen_subcommand_from help" -f -a "get" -d 'try get subject info by id'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and not __fish_seen_subcommand_from search; and not __fish_seen_subcommand_from get; and not __fish_seen_subcommand_from get-ep; and not __fish_seen_subcommand_from help" -f -a "get-ep" -d 'try get episode info by subject id'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and not __fish_seen_subcommand_from search; and not __fish_seen_subcommand_from get; and not __fish_seen_subcommand_from get-ep; and not __fish_seen_subcommand_from help" -f -a "help" -d 'Print this message or the help of the given subcommand(s)'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and __fish_seen_subcommand_from search" -s h -l help -d 'Print help information'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and __fish_seen_subcommand_from get" -l no-persons -d 'doesn\'t get person(staff) infomation'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and __fish_seen_subcommand_from get" -l no-characters -d 'doesn\'t get characters infomation'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and __fish_seen_subcommand_from get" -s h -l help -d 'Print help information'
complete -c dantalian -n "__fish_seen_subcommand_from bgm; and __fish_seen_subcommand_from get-ep" -s h -l help -d 'Print help information'
