/**
 * Selector matching against the root element only.
 *
 * The theme snapshot (Calliope Live, Spec A Stage 0) asks one question of
 * every rule: does this selector match `<html>` in a given state? Only a
 * compound selector can — anything with a combinator targets a descendant or
 * a sibling, and is reported as "no match". Pseudo-elements never match the
 * element itself. Pseudo-classes that depend on interaction or descendants
 * (`:hover`, `:has()`, …) are treated as not matching: the snapshot is of the
 * element at rest.
 *
 * Framework-free and pure: no DOM, no I/O.
 *
 * @module themes/snapshot/selector-match
 */

/** What the root element carries. */
export interface RootElementState {
  /** Attribute name → value (names lower-case). */
  attributes: Record<string, string>;
  /** Class names. */
  classes: string[];
}

/** CSS specificity as (ids, classes/attributes/pseudo-classes, types/pseudo-elements). */
export type Specificity = [number, number, number];

export interface SelectorMatch {
  matches: boolean;
  specificity: Specificity;
}

const ZERO: Specificity = [0, 0, 0];

/** Pseudo-elements written with one colon for historical reasons. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);

export function compareSpecificity(a: Specificity, b: Specificity): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function maxSpecificity(list: Specificity[]): Specificity {
  return list.reduce<Specificity>((best, s) => (compareSpecificity(s, best) > 0 ? s : best), ZERO);
}

function add(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Split on top-level commas (outside brackets, parens and quotes). */
export function splitSelectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

/** True when the complex selector contains a top-level combinator. */
function hasCombinator(selector: string): boolean {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~')) return true;
  }
  return false;
}

/** Read an identifier (with escapes) starting at `i`; returns [ident, nextIndex]. */
function readIdent(s: string, i: number): [string, number] {
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      const hex = /^[0-9a-fA-F]{1,6} ?/.exec(s.slice(i + 1));
      if (hex) {
        out += String.fromCodePoint(parseInt(hex[0].trim(), 16));
        i += 1 + hex[0].length;
      } else {
        out += s[i + 1] ?? '';
        i += 2;
      }
      continue;
    }
    if (/[\w-]/.test(ch) || ch.charCodeAt(0) > 127) {
      out += ch;
      i++;
      continue;
    }
    break;
  }
  return [out, i];
}

/** Index of the bracket/paren matching the opener at `i`. */
function findClose(s: string, i: number, open: string, close: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') {
      j++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return j;
    }
  }
  throw new Error(`Unbalanced "${open}" in selector: ${s}`);
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\(.)/g, '$1');
  }
  return t;
}

function matchAttribute(body: string, root: RootElementState): boolean {
  const m = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s\]]+)\s*([iIsS])?)?\s*$/.exec(body);
  if (!m) throw new Error(`Unsupported attribute selector: [${body}]`);
  const [, rawName, op, rawValue, flag] = m;
  const name = rawName.toLowerCase();
  const actual = name === 'class' ? root.classes.join(' ') : root.attributes[name];
  if (actual === undefined) return false;
  if (!op) return true;
  const insensitive = flag === 'i' || flag === 'I';
  const want = insensitive ? unquote(rawValue).toLowerCase() : unquote(rawValue);
  const have = insensitive ? actual.toLowerCase() : actual;
  switch (op) {
    case '=':
      return have === want;
    case '~=':
      return have.split(/\s+/).includes(want);
    case '|=':
      return have === want || have.startsWith(`${want}-`);
    case '^=':
      return want !== '' && have.startsWith(want);
    case '$=':
      return want !== '' && have.endsWith(want);
    case '*=':
      return want !== '' && have.includes(want);
    default:
      return false;
  }
}

/** Match a selector list; specificity is that of the most specific matching branch. */
function matchList(list: string, root: RootElementState): { any: boolean; matched: Specificity; all: Specificity } {
  const results = splitSelectorList(list).map((s) => matchComplex(s, root));
  const matched = results.filter((r) => r.matches).map((r) => r.specificity);
  return {
    any: matched.length > 0,
    matched: maxSpecificity(matched),
    all: maxSpecificity(results.map((r) => r.specificity)),
  };
}

function matchComplex(selector: string, root: RootElementState): SelectorMatch {
  const s = selector.trim();
  if (hasCombinator(s)) return { matches: false, specificity: ZERO };
  return matchCompound(s, root);
}

function matchCompound(s: string, root: RootElementState): SelectorMatch {
  let spec: Specificity = [0, 0, 0];
  let ok = true;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '*') {
      i++;
      continue;
    }
    if (ch === '#') {
      const [, next] = readIdent(s, i + 1);
      spec = add(spec, [1, 0, 0]);
      ok = false; // the root carries no id
      i = next;
      continue;
    }
    if (ch === '.') {
      const [name, next] = readIdent(s, i + 1);
      spec = add(spec, [0, 1, 0]);
      if (!root.classes.includes(name)) ok = false;
      i = next;
      continue;
    }
    if (ch === '[') {
      const close = findClose(s, i, '[', ']');
      spec = add(spec, [0, 1, 0]);
      if (!matchAttribute(s.slice(i + 1, close), root)) ok = false;
      i = close + 1;
      continue;
    }
    if (ch === ':') {
      const element = s[i + 1] === ':';
      const [rawName, afterName] = readIdent(s, i + (element ? 2 : 1));
      const name = rawName.toLowerCase();
      let args: string | null = null;
      let next = afterName;
      if (s[afterName] === '(') {
        const close = findClose(s, afterName, '(', ')');
        args = s.slice(afterName + 1, close);
        next = close + 1;
      }
      i = next;
      if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) {
        spec = add(spec, [0, 0, 1]);
        ok = false;
        continue;
      }
      switch (name) {
        case 'root':
          spec = add(spec, [0, 1, 0]);
          break;
        case 'where': {
          const r = matchList(args ?? '', root);
          if (!r.any) ok = false;
          break;
        }
        case 'is':
        case 'matches': {
          const r = matchList(args ?? '', root);
          spec = add(spec, r.any ? r.matched : r.all);
          if (!r.any) ok = false;
          break;
        }
        case 'not': {
          const r = matchList(args ?? '', root);
          spec = add(spec, r.all);
          if (r.any) ok = false;
          break;
        }
        case 'lang': {
          spec = add(spec, [0, 1, 0]);
          const lang = (root.attributes.lang ?? '').toLowerCase();
          const want = unquote(args ?? '').toLowerCase();
          if (!(lang === want || lang.startsWith(`${want}-`))) ok = false;
          break;
        }
        default:
          // :host (no shadow root), :has(), :hover and every other state.
          spec = add(spec, [0, 1, 0]);
          ok = false;
      }
      continue;
    }
    if (/[\w-]/.test(ch) || ch === '\\') {
      const [name, next] = readIdent(s, i);
      spec = add(spec, [0, 0, 1]);
      if (name.toLowerCase() !== 'html') ok = false;
      i = next;
      continue;
    }
    throw new Error(`Unsupported selector syntax at "${s.slice(i)}" in: ${s}`);
  }
  return { matches: ok, specificity: spec };
}

/**
 * Does any selector in `list` match the root element? Returns the
 * specificity of the most specific matching selector.
 */
export function matchRootSelector(list: string, root: RootElementState): SelectorMatch {
  const r = matchList(list, root);
  return { matches: r.any, specificity: r.matched };
}
