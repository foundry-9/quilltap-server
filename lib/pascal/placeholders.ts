/**
 * The `{{placeholder}}` families — one classifier for every reader.
 *
 * Seven sites used to re-derive "which family is this key" from a chain of
 * `===` and `startsWith` tests: the template renderer, the effect-expression
 * resolver, the grammar's reference check, the vocabulary scanner, and three
 * Workbench audits. This module is that chain, once. Everything that reads a
 * placeholder classifies it here and then decides what its own family means.
 *
 * CLIENT-SAFE and dependency-free: the Workbench runs it in the browser, and
 * `expressions.ts` (which must stay import-light) leans on it from below the
 * schema module.
 */

/**
 * Matches one `{{key}}` occurrence; group 1 is the raw key, untrimmed. Global
 * so `matchAll` works; readers that `exec` in a loop should go through
 * {@link scanPlaceholders}, which never shares `lastIndex`.
 */
export const PLACEHOLDER_PATTERN = /\{\{([^}]+)\}\}/g;

/** A classified placeholder key. `unknown` keeps the key for diagnostics. */
export type PlaceholderRef =
  | { kind: 'value' }
  | { kind: 'roll' }
  | { kind: 'dice' }
  | { kind: 'llm' }
  | { kind: 'now' }
  | { kind: 'params'; name: string }
  | { kind: 'metadata'; key: string }
  | { kind: 'state'; path: string }
  | { kind: 'progress'; id: string; field: string }
  | { kind: 'unknown'; key: string };

const PARAMS_PREFIX = 'params.';
const METADATA_PREFIX = 'metadata.';
const STATE_PREFIX = 'state.';
const PROGRESS_PREFIX = 'progress.';

/**
 * Classify one (already trimmed) placeholder key. A family prefix with nothing
 * after it (`params.`) names nothing and is `unknown`, exactly as the effect
 * grammar has always ruled.
 */
export function classifyPlaceholder(key: string): PlaceholderRef {
  if (key === 'value') return { kind: 'value' };
  if (key === 'roll') return { kind: 'roll' };
  if (key === 'dice') return { kind: 'dice' };
  if (key === 'llm') return { kind: 'llm' };
  // `now` is epoch milliseconds at run start, one value for the whole run —
  // what lets an effect express "ten minutes from now" as {{now}} + 600000
  // without the format growing a date grammar.
  if (key === 'now') return { kind: 'now' };
  if (key.startsWith(PARAMS_PREFIX) && key.length > PARAMS_PREFIX.length) {
    return { kind: 'params', name: key.slice(PARAMS_PREFIX.length) };
  }
  if (key.startsWith(METADATA_PREFIX) && key.length > METADATA_PREFIX.length) {
    return { kind: 'metadata', key: key.slice(METADATA_PREFIX.length) };
  }
  if (key.startsWith(STATE_PREFIX) && key.length > STATE_PREFIX.length) {
    return { kind: 'state', path: key.slice(STATE_PREFIX.length) };
  }
  // `progress.<id>.<field>` — a derived field of one of the rolling
  // character's timed progressions. Unlike `metadata.`, whose remainder is
  // taken WHOLE because a metadata key is the user's own vocabulary, this
  // splits at the first dot: `<id>` is an identifier the format defines, and
  // `<field>` is drawn from a closed set the engine publishes. A key naming
  // only an id, or only a field, names nothing.
  if (key.startsWith(PROGRESS_PREFIX)) {
    const rest = key.slice(PROGRESS_PREFIX.length);
    const dot = rest.indexOf('.');
    if (dot > 0 && dot < rest.length - 1) {
      return { kind: 'progress', id: rest.slice(0, dot), field: rest.slice(dot + 1) };
    }
  }
  return { kind: 'unknown', key };
}

/** One placeholder as found in a string. */
export interface ScannedPlaceholder {
  /** The occurrence verbatim, braces included — what "renders as written" means. */
  whole: string;
  /** The trimmed key. */
  key: string;
  ref: PlaceholderRef;
}

/** Every `{{…}}` in `text`, in order, classified. */
export function scanPlaceholders(text: string): ScannedPlaceholder[] {
  const found: ScannedPlaceholder[] = [];
  const pattern = new RegExp(PLACEHOLDER_PATTERN.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const key = match[1].trim();
    found.push({ whole: match[0], key, ref: classifyPlaceholder(key) });
  }
  return found;
}
