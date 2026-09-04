// A port of the subset of `tinytemplate` 1.2.1 that the nfo templates use:
// `{ value }` interpolation, `{{ if }} / {{ else }} / {{ endif }}` blocks and
// `{{ for x in xs }} / {{ endfor }}` loops.
//
// Behaviour verified against the crate itself:
//   * No whitespace trimming of any kind. Literal text between tags, including
//     the indentation in front of a `{{ if }}`, is emitted verbatim — which is
//     why a false branch can leave a line of trailing spaces behind.
//   * `{ name }` and `{name}`, `{{if x}}` and `{{ if x }}` are all accepted.
//   * Values are HTML-escaped by default; `{ name | unescaped }` opts out.
//   * Falsey values are `null`, `false`, `0`, `""` and `[]`.

import { anyhow } from '../errors.js';
import { F64, serdeJsonNumberToString } from '../rustfmt.js';

/**
 * The escape table `tinytemplate::format` applies to interpolated values.
 * Note that `/`, backslashes, newlines, tabs and non-ASCII characters are left
 * alone — only these five characters are touched.
 */
const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/**
 * @param {string} value
 * @returns {string}
 */
function escapeHtml(value) {
  let out = '';
  for (const ch of value) out += HTML_ESCAPES.get(ch) ?? ch;
  return out;
}

/**
 * @param {unknown} value
 * @returns {boolean} whether `{{ if }}` takes the true branch
 */
function isTruthy(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value instanceof F64) return value.value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Render a resolved value as `tinytemplate` would.
 *
 * @param {unknown} value
 * @param {string} path the source path, used in error messages
 * @returns {string}
 */
function formatValue(value, path) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' || value instanceof F64) return serdeJsonNumberToString(value);
  if (typeof value === 'string') return value;
  throw anyhow(`Expected a printable value but found array or object for path '${path}'`);
}

/**
 * @typedef {{ kind: 'text', text: string }
 *   | { kind: 'value', path: string[], source: string, escape: boolean }
 *   | { kind: 'if', path: string[], source: string, then: Node[], otherwise: Node[] }
 *   | { kind: 'for', binding: string, path: string[], source: string, body: Node[] }} Node
 */

/**
 * @param {string} source a dotted path expression
 * @returns {string[]}
 */
function splitPath(source) {
  const path = source.split('.').map((part) => part.trim());
  if (path.some((part) => part === '')) throw anyhow(`invalid path '${source}' in template`);
  return path;
}

/**
 * Parse a template into a node tree.
 *
 * @param {string} template
 * @returns {Node[]}
 */
function parse(template) {
  /** @type {Node[][]} */
  const stack = [[]];
  /** @type {Array<{ kind: 'if'|'for', node: any }>} */
  const open = [];

  let cursor = 0;
  /** @param {string} text */
  const pushText = (text) => {
    if (text !== '') stack[stack.length - 1].push({ kind: 'text', text });
  };

  while (cursor < template.length) {
    const blockStart = template.indexOf('{{', cursor);
    const valueStart = template.indexOf('{', cursor);

    if (valueStart === -1) break;

    if (blockStart !== -1 && blockStart === valueStart) {
      const end = template.indexOf('}}', blockStart);
      if (end === -1) throw anyhow('unclosed `{{` block tag in template');
      pushText(template.slice(cursor, blockStart));
      const body = template.slice(blockStart + 2, end).trim();
      cursor = end + 2;

      const ifMatch = /^if\s+(.+)$/s.exec(body);
      const forMatch = /^for\s+([^\s]+)\s+in\s+(.+)$/s.exec(body);

      if (ifMatch) {
        const node = {
          kind: 'if',
          source: ifMatch[1].trim(),
          path: splitPath(ifMatch[1].trim()),
          then: /** @type {Node[]} */ ([]),
          otherwise: /** @type {Node[]} */ ([]),
        };
        stack[stack.length - 1].push(/** @type {Node} */ (node));
        open.push({ kind: 'if', node });
        stack.push(node.then);
      } else if (body === 'else') {
        const current = open[open.length - 1];
        if (current === undefined || current.kind !== 'if') throw anyhow('`{{ else }}` outside of an `{{ if }}` block');
        stack.pop();
        stack.push(current.node.otherwise);
      } else if (body === 'endif') {
        const current = open.pop();
        if (current === undefined || current.kind !== 'if') throw anyhow('unexpected `{{ endif }}`');
        stack.pop();
      } else if (forMatch) {
        const node = {
          kind: 'for',
          binding: forMatch[1].trim(),
          source: forMatch[2].trim(),
          path: splitPath(forMatch[2].trim()),
          body: /** @type {Node[]} */ ([]),
        };
        stack[stack.length - 1].push(/** @type {Node} */ (node));
        open.push({ kind: 'for', node });
        stack.push(node.body);
      } else if (body === 'endfor') {
        const current = open.pop();
        if (current === undefined || current.kind !== 'for') throw anyhow('unexpected `{{ endfor }}`');
        stack.pop();
      } else {
        throw anyhow(`unsupported template block \`{{ ${body} }}\``);
      }
      continue;
    }

    const end = template.indexOf('}', valueStart);
    if (end === -1) throw anyhow('unclosed `{` value tag in template');
    pushText(template.slice(cursor, valueStart));
    const body = template.slice(valueStart + 1, end).trim();
    cursor = end + 1;

    const [rawPath, formatter] = body.split('|').map((part) => part.trim());
    if (formatter !== undefined && formatter !== 'unescaped') {
      throw anyhow(`unsupported template formatter \`${formatter}\``);
    }
    stack[stack.length - 1].push({
      kind: 'value',
      source: rawPath,
      path: splitPath(rawPath),
      escape: formatter === undefined,
    });
  }

  pushText(template.slice(cursor));

  if (open.length > 0) throw anyhow('unclosed template block');
  return stack[0];
}

/**
 * Resolve a dotted path against the loop-binding scopes and the root context.
 *
 * @param {string[]} path
 * @param {string} source the original path text, used in error messages
 * @param {unknown} root
 * @param {Array<{ name: string, value: unknown }>} scopes innermost last
 * @returns {unknown}
 */
function resolve(path, source, root, scopes) {
  let current;
  let start;

  const binding = scopes.findLast((scope) => scope.name === path[0]);
  if (binding !== undefined) {
    current = binding.value;
    start = 1;
  } else {
    current = root;
    start = 0;
  }

  for (let i = start; i < path.length; i += 1) {
    if (current === null || current === undefined || typeof current !== 'object') {
      throw anyhow(`Failed to find value '${path[i]}' from path '${source}'`);
    }
    if (!(path[i] in /** @type {object} */ (current))) {
      throw anyhow(`Failed to find value '${path[i]}' from path '${source}'`);
    }
    current = /** @type {any} */ (current)[path[i]];
  }

  return current;
}

/**
 * @param {Node[]} nodes
 * @param {unknown} root
 * @param {Array<{ name: string, value: unknown }>} scopes
 * @returns {string}
 */
function renderNodes(nodes, root, scopes) {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.text;
        break;
      case 'value': {
        const rendered = formatValue(resolve(node.path, node.source, root, scopes), node.source);
        out += node.escape ? escapeHtml(rendered) : rendered;
        break;
      }
      case 'if':
        out += isTruthy(resolve(node.path, node.source, root, scopes))
          ? renderNodes(node.then, root, scopes)
          : renderNodes(node.otherwise, root, scopes);
        break;
      case 'for': {
        const items = resolve(node.path, node.source, root, scopes);
        if (!Array.isArray(items)) throw anyhow(`Expected an array for path '${node.source}'`);
        for (const item of items) {
          scopes.push({ name: node.binding, value: item });
          out += renderNodes(node.body, root, scopes);
          scopes.pop();
        }
        break;
      }
    }
  }
  return out;
}

/**
 * A registry of named templates, mirroring `tinytemplate::TinyTemplate`.
 */
export class TinyTemplate {
  constructor() {
    /** @type {Map<string, Node[]>} */
    this.templates = new Map();
  }

  /**
   * @param {string} name
   * @param {string} template
   */
  addTemplate(name, template) {
    this.templates.set(name, parse(template));
  }

  /**
   * @param {string} name
   * @param {unknown} context
   * @returns {string}
   */
  render(name, context) {
    const nodes = this.templates.get(name);
    if (nodes === undefined) throw anyhow(`Unknown template '${name}'`);
    return renderNodes(nodes, context, []);
  }
}
