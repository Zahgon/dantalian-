import { VERSION_TEXT } from './help.js';
import {
  ClapExit,
  ClapError,
  bestSuggestion,
  didYouMean,
  invalidSubcommand,
  unrecognizedSubcommand,
  duplicateArgument,
  invalidValue,
  missingRequiredArguments,
  missingValue,
  unexpectedArgument,
  unexpectedValue,
} from './clap-error.js';
import { findSubcommand } from './spec.js';

const U32_MAX = 4294967295;

function signature(arg) {
  return arg.value === undefined ? `--${arg.long}` : `--${arg.long} <${arg.value}>`;
}

function parseU32(text, positionalName) {
  if (text === '') throw invalidValue(text, positionalName, 'cannot parse integer from empty string');
  if (!/^\+?[0-9]+$/.test(text)) throw invalidValue(text, positionalName, 'invalid digit found in string');
  const parsed = Number(text);
  if (parsed > U32_MAX) throw invalidValue(text, positionalName, 'number too large to fit in target type');
  return parsed;
}

function store(values, arg, value, usage) {
  if (arg.multiple === true) {
    values[arg.key].push(value);
    return;
  }
  if (values[arg.key] !== null && values[arg.key] !== false) throw duplicateArgument(signature(arg), usage);
  values[arg.key] = value;
}

function emptyValues(command) {
  const values = {};
  for (const arg of command.args) {
    if (arg.key === undefined) continue;
    values[arg.key] = arg.multiple === true ? [] : arg.value === undefined ? false : null;
  }
  for (const positional of command.positionals) {
    values[positional.key] = positional.variadic === true ? [] : null;
  }
  return values;
}

function suggestionUsage(command, arg) {
  const required = command.positionals
    .filter((positional) => positional.required === true)
    .map((positional) => positional.name);
  return [command.bin, signature(arg), ...required].join(' ');
}

function unknownLong(command, name) {
  const suggestion = bestSuggestion(
    name,
    command.args.map((arg) => arg.long),
  );
  if (suggestion === null) return unexpectedArgument(`--${name}`, command.usage, null);
  const arg = command.args.find((candidate) => candidate.long === suggestion);
  return unexpectedArgument(`--${name}`, suggestionUsage(command, arg), `--${suggestion}`);
}

function takeHelpSubcommand(command, argv, index) {
  let target = command;
  for (let i = index; i < argv.length; i += 1) {
    const next = findSubcommand(target, argv[i]);
    if (next === null) {
      throw unrecognizedSubcommand(argv[i], command.usage);
    }
    target = next;
  }
  throw new ClapExit(target.help);
}

function assignPositional(command, values, slots, token) {
  const positional = command.positionals[slots.filled];
  if (positional === undefined) throw unexpectedArgument(token, command.usage, null);
  if (positional.variadic === true) {
    values[positional.key].push(token);
    return;
  }
  values[positional.key] = positional.integer === true ? parseU32(token, positional.name) : token;
  slots.filled += 1;
}

function readValue(arg, inline, argv, cursor) {
  if (inline !== null) return inline;
  cursor.index += 1;
  if (cursor.index >= argv.length) throw missingValue(signature(arg));
  return argv[cursor.index];
}

function handleLong(command, values, token, argv, cursor) {
  const separator = token.indexOf('=');
  const name = separator === -1 ? token.slice(2) : token.slice(2, separator);
  const inline = separator === -1 ? null : token.slice(separator + 1);
  const arg = command.args.find((candidate) => candidate.long === name);
  if (arg === undefined) throw unknownLong(command, name);
  if (arg.value === undefined) {
    if (inline !== null) throw unexpectedValue(inline, `--${name}`, command.usage);
    if (arg.help === true) throw new ClapExit(command.help);
    if (arg.version === true) throw new ClapExit(VERSION_TEXT);
    store(values, arg, true, command.usage);
    return;
  }
  store(values, arg, readValue(arg, inline, argv, cursor), command.usage);
}

function handleShortCluster(command, values, token, argv, cursor) {
  for (let position = 1; position < token.length; position += 1) {
    const letter = token[position];
    const arg = command.args.find((candidate) => candidate.short === letter);
    if (arg === undefined) throw unexpectedArgument(`-${letter}`, command.usage, null);
    if (arg.help === true) throw new ClapExit(command.help);
    if (arg.version === true) throw new ClapExit(VERSION_TEXT);
    if (arg.value === undefined) {
      store(values, arg, true, command.usage);
      continue;
    }
    const rest = token.slice(position + 1);
    store(values, arg, readValue(arg, rest === '' ? null : rest, argv, cursor), command.usage);
    return;
  }
}

export function parseCommand(command, argv, start) {
  const values = emptyValues(command);
  const slots = { filled: 0 };
  const cursor = { index: start };
  let literal = false;
  for (; cursor.index < argv.length; cursor.index += 1) {
    const token = argv[cursor.index];
    if (!literal && token === '--') {
      literal = true;
    } else if (!literal && token.startsWith('--')) {
      handleLong(command, values, token, argv, cursor);
    } else if (!literal && token.startsWith('-') && token.length > 1) {
      handleShortCluster(command, values, token, argv, cursor);
    } else if (command.subcommands !== undefined) {
      if (token === 'help') takeHelpSubcommand(command, argv, cursor.index + 1);
      const sub = findSubcommand(command, token);
      if (sub === null) {
        const candidates = didYouMean(token, [...command.subcommands.map((entry) => entry.name), 'help']);
        if (candidates.length > 0) {
          throw invalidSubcommand(token, candidates, command.bin, command.usage);
        }
        throw unexpectedArgument(token, command.usage, null);
      }
      return { values, subcommand: sub, sub: parseCommand(sub, argv, cursor.index + 1) };
    } else {
      assignPositional(command, values, slots, token);
    }
  }
  const missing = command.positionals
    .filter((positional) => positional.required === true && values[positional.key] === null)
    .map((positional) => positional.name);
  if (missing.length > 0) throw missingRequiredArguments(missing, command.usage);
  if (command.subcommandRequired === true) throw new ClapError(command.help);
  return { values, subcommand: null, sub: null };
}
