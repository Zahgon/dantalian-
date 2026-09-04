#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HELP_SUBCOMMAND_ABOUT, ROOT } from '../src/options/spec.js';

const BIN = ROOT.bin;

const HELP_COMMAND = {
  name: 'help',
  about: HELP_SUBCOMMAND_ABOUT,
  args: [],
  argOrder: [],
  positionals: [
    {
      name: '<SUBCOMMAND>...',
      key: 'subcommand',
      variadic: true,
      desc: 'The subcommand whose help message to display',
    },
  ],
};

function orderedArgs(command) {
  return command.argOrder.map((long) => command.args.find((arg) => arg.long === long));
}

function children(command) {
  if (!command.subcommandOrder) return [];
  const declared = command.subcommandOrder.map((name) =>
    command.subcommands.find((sub) => sub.name === name),
  );
  return [...declared, HELP_COMMAND];
}

function valueArgs(command) {
  return orderedArgs(command).filter((arg) => arg.value);
}

function flagArgs(command) {
  return orderedArgs(command).filter((arg) => !arg.value);
}

/**
 * Depth-first walk yielding `{command, binName}` pairs for every subcommand,
 * mirroring `clap_complete::generator::utils::all_subcommands`: the direct
 * children of a node are emitted before recursing into any of them.
 */
function allSubcommands(command, binName = BIN) {
  const pairs = [];
  for (const child of children(command)) {
    pairs.push({ command: child, binName: `${binName} ${child.name}` });
  }
  for (const child of children(command)) {
    pairs.push(...allSubcommands(child, `${binName} ${child.name}`));
  }
  return pairs;
}

function zshEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function zshFunctionName(binName) {
  return `_${binName.replace(/ /g, '__')}`;
}

function zshValueSuffix(arg) {
  return `:${arg.value}:${arg.valueHint === 'dir' ? '_files -/' : ' '}`;
}

function zshArgLines(command) {
  const lines = [];
  for (const arg of valueArgs(command)) {
    const star = arg.multiple ? '*' : '';
    const desc = zshEscape(arg.desc);
    const suffix = zshValueSuffix(arg);
    if (arg.short) lines.push(`'${star}-${arg.short}+[${desc}]${suffix}'`);
    lines.push(`'${star}--${arg.long}=[${desc}]${suffix}'`);
  }
  for (const arg of flagArgs(command)) {
    const desc = zshEscape(arg.desc);
    if (arg.short) lines.push(`'-${arg.short}[${desc}]'`);
    lines.push(`'--${arg.long}[${desc}]'`);
  }
  for (const positional of command.positionals ?? []) {
    const star = positional.variadic ? '*:' : '';
    lines.push(`'${star}:${positional.key} -- ${zshEscape(positional.desc)}:'`);
  }
  return lines;
}

function zshCommandBody(command, binName) {
  const lines = zshArgLines(command);
  if (children(command).length > 0) {
    lines.push(`":: :${zshFunctionName(binName)}_commands"`);
    lines.push(`"*::: :->${command.name}"`);
  }
  const args = lines.map((line) => `${line} \\\n`).join('');
  return `_arguments "\${_arguments_options[@]}" \\\n${args}&& ret=0`;
}

function zshSubcommandDetails(command, binName, nested = true) {
  const subs = children(command);
  if (subs.length === 0) return '';
  const blocks = subs
    .map((sub) => {
      const subBin = `${binName} ${sub.name}`;
      return `(${sub.name})\n${zshCommandBody(sub, subBin)}${zshSubcommandDetails(sub, subBin)}\n;;`;
    })
    .join('\n');
  return `${nested ? '\n' : ''}
    case $state in
    (${command.name})
        words=($line[1] "\${words[@]}")
        (( CURRENT += 1 ))
        curcontext="\${curcontext%:*:*}:${binName.replace(/ /g, '-')}-command-$line[1]:"
        case $line[1] in
            ${blocks}
        esac
    ;;
esac`;
}

function zshCommandsFunction(command, binName) {
  const subs = children(command);
  const entries = subs.map((sub) => `'${sub.name}:${zshEscape(sub.about)}' \\\n`).join('');
  const list = subs.length === 0 ? 'commands=()' : `commands=(\n${entries}    )`;
  const fn = `${zshFunctionName(binName)}_commands`;
  return `(( $+functions[${fn}] )) ||
${fn}() {
    local commands; ${list}
    _describe -t commands '${binName} commands' commands "$@"
}
`;
}

function generateZsh() {
  // zsh orders its `_*_commands` helpers by the tuple (name, bin_name), which is
  // why `dantalian bgm help` lands before top-level `dantalian help`.
  const pairs = allSubcommands(ROOT).sort((a, b) => {
    if (a.command.name !== b.command.name) return a.command.name < b.command.name ? -1 : 1;
    return a.binName < b.binName ? -1 : 1;
  });
  const details = pairs.map((pair) => zshCommandsFunction(pair.command, pair.binName)).join('');
  const root = zshCommandBody(ROOT, BIN) + zshSubcommandDetails(ROOT, BIN, false);
  return `#compdef dantalian

autoload -U is-at-least

_dantalian() {
    typeset -A opt_args
    typeset -a _arguments_options
    local ret=1

    if is-at-least 5.2; then
        _arguments_options=(-s -S -C)
    else
        _arguments_options=(-s -C)
    fi

    local context curcontext="$curcontext" state line
    ${root}
}

${zshCommandsFunction(ROOT, BIN)}${details}
_dantalian "$@"
`;
}

function bashFunctionName(binName) {
  return binName.replace(/ /g, '__').replace(/-/g, '__');
}

function bashOpts(command) {
  const ordered = orderedArgs(command);
  const words = [
    ...ordered.filter((arg) => arg.short).map((arg) => `-${arg.short}`),
    ...ordered.map((arg) => `--${arg.long}`),
    ...(command.positionals ?? []).map((positional) => positional.name),
    ...children(command).map((sub) => sub.name),
  ];
  return words.join(' ');
}

function bashBlock(command, binName) {
  const depth = binName.split(' ').length;
  const prevCases = valueArgs(command)
    .flatMap((arg) => (arg.short ? [`--${arg.long}`, `-${arg.short}`] : [`--${arg.long}`]))
    .map(
      (flag) => `                ${flag})
                    COMPREPLY=($(compgen -f "\${cur}"))
                    return 0
                    ;;
`,
    )
    .join('');
  return `        ${bashFunctionName(binName)})
            opts="${bashOpts(command)}"
            if [[ \${cur} == -* || \${COMP_CWORD} -eq ${depth} ]] ; then
                COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
                return 0
            fi
            case "\${prev}" in
${prevCases}                *)
                    COMPREPLY=()
                    ;;
            esac
            COMPREPLY=( $(compgen -W "\${opts}" -- "\${cur}") )
            return 0
            ;;
`;
}

function generateBash() {
  const pairs = allSubcommands(ROOT);
  const names = [...new Set(pairs.map((pair) => pair.command.name))].sort();
  const nameCases = names
    .map(
      (name) => `            ${name})
                cmd+="__${name.replace(/-/g, '__')}"
                ;;
`,
    )
    .join('');
  // bash keys its dispatch table on the flattened bin name, so unlike zsh it
  // orders the blocks by bin name alone.
  const blocks = [{ command: ROOT, binName: BIN }, ...pairs]
    .sort((a, b) => (a.binName < b.binName ? -1 : a.binName > b.binName ? 1 : 0))
    .map((pair) => bashBlock(pair.command, pair.binName))
    .join('');
  return `_dantalian() {
    local i cur prev opts cmds
    COMPREPLY=()
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
    cmd=""
    opts=""

    for i in \${COMP_WORDS[@]}
    do
        case "\${i}" in
            "$1")
                cmd="dantalian"
                ;;
${nameCases}            *)
                ;;
        esac
    done

    case "\${cmd}" in
${blocks}    esac
}

complete -F _dantalian -o bashdefault -o default dantalian
`;
}

function fishEscape(text) {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function fishCondition(chain, command) {
  const clauses =
    chain.length === 0 ? ['__fish_use_subcommand'] : chain.map((name) => `__fish_seen_subcommand_from ${name}`);
  for (const sub of children(command)) {
    if (chain.length > 0) clauses.push(`not __fish_seen_subcommand_from ${sub.name}`);
  }
  return clauses.join('; and ');
}

function fishLines(command, chain = []) {
  const condition = fishCondition(chain, command);
  const lines = [];
  const prefix = `complete -c ${BIN} -n "${condition}"`;
  for (const arg of valueArgs(command)) {
    const short = arg.short ? ` -s ${arg.short}` : '';
    const hint = arg.valueHint === 'dir' ? ' -r -f -a "(__fish_complete_directories)"' : ' -r';
    lines.push(`${prefix}${short} -l ${arg.long} -d '${fishEscape(arg.desc)}'${hint}`);
  }
  for (const arg of flagArgs(command)) {
    const short = arg.short ? ` -s ${arg.short}` : '';
    lines.push(`${prefix}${short} -l ${arg.long} -d '${fishEscape(arg.desc)}'`);
  }
  for (const sub of children(command)) {
    lines.push(`${prefix} -f -a "${sub.name}" -d '${fishEscape(sub.about)}'`);
  }
  for (const sub of children(command)) {
    lines.push(...fishLines(sub, [...chain, sub.name]));
  }
  return lines;
}

function generateFish() {
  return `${fishLines(ROOT).join('\n')}\n`;
}

export const COMPLETIONS = {
  _dantalian: generateZsh,
  'dantalian.bash': generateBash,
  'dantalian.fish': generateFish,
};

export function writeCompletions(outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const [name, generate] of Object.entries(COMPLETIONS)) {
    writeFileSync(`${outDir}/${name}`, generate());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const outDir = process.argv[2] ?? process.env.SHELL_COMPLETIONS_DIR;
  if (outDir) writeCompletions(outDir);
}
