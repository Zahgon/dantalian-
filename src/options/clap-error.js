const SUGGESTION_THRESHOLD = 0.8;
const WINKLER_SCALING = 0.1;

export class ClapExit extends Error {
  constructor(output) {
    super('clap exit');
    this.name = 'ClapExit';
    this.output = output;
    this.code = 0;
  }
}

export class ClapError extends Error {
  constructor(output) {
    super('clap error');
    this.name = 'ClapError';
    this.output = output;
    this.code = 2;
  }
}

function jaro(left, right) {
  const a = [...left];
  const b = [...right];
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length === 1 && b.length === 1) return a[0] === b[0] ? 1 : 0;
  const searchRange = Math.max(Math.floor(Math.max(a.length, b.length) / 2) - 1, 0);
  const consumed = new Array(b.length).fill(false);
  let matches = 0;
  let transpositions = 0;
  let lastMatchIndex = 0;
  for (let i = 0; i < a.length; i += 1) {
    const minBound = i > searchRange ? i - searchRange : 0;
    const maxBound = Math.min(b.length - 1, i + searchRange);
    if (minBound > maxBound) continue;
    for (let j = minBound; j <= maxBound; j += 1) {
      if (a[i] !== b[j] || consumed[j]) continue;
      consumed[j] = true;
      matches += 1;
      if (j < lastMatchIndex) transpositions += 1;
      lastMatchIndex = j;
      break;
    }
  }
  if (matches === 0) return 0;
  return (matches / a.length + matches / b.length + (matches - transpositions) / matches) / 3;
}

function jaroWinkler(left, right) {
  const distance = jaro(left, right);
  const a = [...left];
  const b = [...right];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  return Math.min(1, distance + WINKLER_SCALING * prefix * (1 - distance));
}

export function didYouMean(input, candidates) {
  return [...candidates]
    .map((candidate) => ({ candidate, confidence: jaroWinkler(input, candidate) }))
    .filter((entry) => entry.confidence > SUGGESTION_THRESHOLD)
    .sort((first, second) => first.confidence - second.confidence)
    .map((entry) => entry.candidate);
}

export function bestSuggestion(input, candidates) {
  const ranked = didYouMean(input, candidates);
  return ranked.length === 0 ? null : ranked[ranked.length - 1];
}

function tryHelp(usage) {
  const usageBlock = usage === null ? '' : `\nUSAGE:\n    ${usage}\n`;
  return `${usageBlock}\nFor more information try --help\n`;
}

export function unexpectedArgument(arg, usage, suggestion) {
  const lines = [`error: Found argument '${arg}' which wasn't expected, or isn't valid in this context\n`];
  if (suggestion !== null) lines.push(`\n\tDid you mean '${suggestion}'?\n`);
  if (arg.startsWith('-')) {
    lines.push(`\n\tIf you tried to supply \`${arg}\` as a value rather than a flag, use \`-- ${arg}\`\n`);
  }
  lines.push(tryHelp(usage));
  return new ClapError(lines.join(''));
}

export function missingRequiredArguments(names, usage) {
  const listed = names.map((name) => `    ${name}\n`).join('');
  return new ClapError(`error: The following required arguments were not provided:\n${listed}${tryHelp(usage)}`);
}

export function missingValue(argSignature) {
  return new ClapError(
    `error: The argument '${argSignature}' requires a value but none was supplied\n${tryHelp(null)}`,
  );
}

export function duplicateArgument(argSignature, usage) {
  return new ClapError(
    `error: The argument '${argSignature}' was provided more than once, but cannot be used multiple times\n${tryHelp(usage)}`,
  );
}

export function unexpectedValue(value, argName, usage) {
  return new ClapError(
    `error: The value '${value}' was provided to '${argName}' but it wasn't expecting any more values\n\n${usage}\n${tryHelp(null)}`,
  );
}

export function invalidSubcommand(arg, candidates, binName, usage) {
  const quoted = candidates.map((candidate) => `'${candidate}'`).join(' or ');
  return new ClapError(
    `error: The subcommand '${arg}' wasn't recognized\n\n\tDid you mean ${quoted}?\n\n` +
      `If you believe you received this message in error, try re-running with '${binName} -- ${arg}'\n` +
      tryHelp(usage),
  );
}

export function unrecognizedSubcommand(arg, usage) {
  return new ClapError(`error: The subcommand '${arg}' wasn't recognized\n${tryHelp(usage)}`);
}

export function invalidValue(value, argName, reason) {
  return new ClapError(`error: Invalid value "${value}" for '${argName}': ${reason}\n${tryHelp(null)}`);
}
