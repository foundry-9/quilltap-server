/**
 * Calliope's proposals — the change set (Calliope Live, Spec J decision 7).
 *
 * A proposal is a title, a reason and a list of named operations on a
 * draft's tokens document and stylesheet — never a document. Operations are
 * applied in order with the engine's and the editor's own pure edits
 * (`components/theme-editor/model.ts`, `lib/themes/engine/primitives.ts`), so
 * a kept proposal changes the draft exactly as the same edits made by hand
 * would. This module is the one place a change set is applied
 * (`applyChangeSet`) and described (`describeChangeSet`); judging it needs
 * the server (`./judge.ts`).
 *
 * Browser-safe: the editor applies a kept proposal and tries one in the
 * preview through it.
 *
 * @module themes/assist/change-set
 */

import { z } from 'zod';
import { resetToken, setChoice, setTokenValue } from '@/components/theme-editor/model';
import {
  PRIMITIVE_TYPES,
  THEME_CHOICES,
  THEME_TOKENS,
  addPrimitive,
  primitiveVar,
  removePrimitive,
  renamePrimitive,
  setPrimitiveDark,
  setPrimitiveType,
  setPrimitiveValue,
  tokenModes,
  type ThemeTokensDocument,
} from '../engine/client';

const TokenName = z.string().regex(/^--[a-z0-9-]+$/).describe('A registry token, e.g. "--theme-primary"');
const PrimitiveName = z.string().regex(/^[a-z][a-z0-9-]*$/).describe('A primitive name in kebab-case, without the --p- prefix');
const Value = z.string().min(1).max(2000);

export const ChangeOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('set-token'),
    token: TokenName,
    value: Value.optional().describe('The value for light mode; dark follows it unless the token has, or is given, a dark value of its own'),
    dark: Value.optional().describe('A dark-mode value apart from light'),
  }),
  z.strictObject({
    op: z.literal('reset-token'),
    token: TokenName.describe('Drop the theme\'s value in both modes, so the default is in force'),
  }),
  z.strictObject({
    op: z.literal('add-primitive'),
    name: PrimitiveName,
    type: z.enum(PRIMITIVE_TYPES),
    value: Value,
    dark: Value.optional(),
  }),
  z.strictObject({
    op: z.literal('set-primitive'),
    name: PrimitiveName,
    type: z.enum(PRIMITIVE_TYPES).optional(),
    value: Value.optional(),
    dark: Value.nullable().optional().describe('A dark value apart from light; null to let dark follow light again'),
  }),
  z.strictObject({ op: z.literal('rename-primitive'), from: PrimitiveName, to: PrimitiveName }),
  z.strictObject({
    op: z.literal('remove-primitive'),
    name: PrimitiveName.describe('Its value is written into everything that referred to it'),
  }),
  z.strictObject({ op: z.literal('set-choice'), choice: z.string().min(1), option: z.string().min(1) }),
  z.strictObject({
    op: z.literal('replace-css'),
    find: z.string().min(1).max(20000).describe('A stretch of the stylesheet exactly as it is written, found exactly once'),
    replace: z.string().max(20000).describe('What it becomes (may be empty to delete it)'),
  }),
  z.strictObject({
    op: z.literal('set-css'),
    css: z.string().max(100000).describe('The whole stylesheet; an empty string empties it'),
  }),
]);
export type ChangeOperation = z.infer<typeof ChangeOperationSchema>;

export const ChangeSetSchema = z.strictObject({
  title: z.string().trim().min(1).max(120).describe('A short name for the proposal'),
  reason: z.string().trim().min(1).max(1500).describe('One paragraph: what it does and why'),
  operations: z.array(ChangeOperationSchema).min(1).max(200),
});
export type ChangeSet = z.infer<typeof ChangeSetSchema>;

/** A draft's editable parts: its tokens document and its stylesheet (null when the draft has none). */
export interface ChangeTarget {
  tokens: ThemeTokensDocument;
  css: string | null;
}

export type ChangeApplication =
  | { ok: true; tokens: ThemeTokensDocument; css: string | null; tokensChanged: boolean; cssChanged: boolean }
  | { ok: false; index: number; operation: ChangeOperation; reason: string };

const TOKENS_BY_NAME = new Map(THEME_TOKENS.map((t) => [t.name as string, t]));

/** Occurrences of `needle` in `haystack` (non-overlapping). */
function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count++;
  return count;
}

function nearest(name: string, candidates: Iterable<string>): string | undefined {
  // A cheap nearest match by shared prefix and suffix, enough for a hint; validation has the full distance.
  let best: string | undefined;
  let bestScore = 0;
  for (const c of candidates) {
    let p = 0;
    while (p < name.length && p < c.length && name[p] === c[p]) p++;
    let s = 0;
    while (s < name.length - p && s < c.length - p && name[name.length - 1 - s] === c[c.length - 1 - s]) s++;
    const score = p + s;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best !== undefined && bestScore >= Math.max(6, Math.floor(name.length * 0.6)) ? best : undefined;
}

/** Why `op` cannot be applied to `target`, or the target after it. */
function applyOne(target: ChangeTarget, op: ChangeOperation): ChangeTarget | string {
  const { tokens, css } = target;
  switch (op.op) {
    case 'set-token': {
      if (!TOKENS_BY_NAME.has(op.token)) {
        const near = nearest(op.token, TOKENS_BY_NAME.keys());
        return `${op.token} is not a registry token${near ? ` (did you mean ${near}?)` : ''}`;
      }
      if (op.value === undefined && op.dark === undefined) return `set-token ${op.token} gives neither a value nor a dark value`;
      let next = tokens;
      if (op.value !== undefined) next = setTokenValue(next, op.token, 'light', op.value);
      if (op.dark !== undefined) next = setTokenValue(next, op.token, 'dark', op.dark);
      return { tokens: next, css };
    }
    case 'reset-token':
      if (!TOKENS_BY_NAME.has(op.token)) return `${op.token} is not a registry token`;
      if (tokens.tokens[op.token] === undefined) return `${op.token} is not set by the draft, so there is nothing to reset`;
      return { tokens: resetToken(tokens, op.token), css };
    case 'add-primitive': {
      const added = addPrimitive(tokens, op.name, op.dark === undefined ? { type: op.type, value: op.value } : { type: op.type, value: op.value, dark: op.dark });
      return added.ok ? { tokens: added.document, css } : added.reason;
    }
    case 'set-primitive': {
      if (tokens.primitives[op.name] === undefined) return `There is no primitive named "${op.name}" (${primitiveVar(op.name)})`;
      if (op.type === undefined && op.value === undefined && op.dark === undefined) return `set-primitive ${op.name} changes nothing`;
      let next = tokens;
      if (op.type !== undefined) next = setPrimitiveType(next, op.name, op.type);
      if (op.value !== undefined) next = setPrimitiveValue(next, op.name, op.value);
      if (op.dark !== undefined) next = setPrimitiveDark(next, op.name, op.dark ?? undefined);
      return { tokens: next, css };
    }
    case 'rename-primitive': {
      const renamed = renamePrimitive(tokens, op.from, op.to);
      return renamed.ok ? { tokens: renamed.document, css } : renamed.reason;
    }
    case 'remove-primitive':
      if (tokens.primitives[op.name] === undefined) return `There is no primitive named "${op.name}"`;
      return { tokens: removePrimitive(tokens, op.name), css };
    case 'set-choice': {
      const choice = THEME_CHOICES.find((c) => c.name === op.choice);
      if (!choice) return `"${op.choice}" is not a choice (choices: ${THEME_CHOICES.map((c) => c.name).join(', ')})`;
      if (!choice.options.includes(op.option)) return `"${op.option}" is not an option of ${op.choice} (${choice.options.join(', ')})`;
      return { tokens: setChoice(tokens, op.choice, op.option), css };
    }
    case 'replace-css': {
      if (css === null) return 'The draft has no stylesheet yet; use set-css to write one';
      const count = occurrences(css, op.find);
      if (count === 0) return 'The stretch to replace is not in the stylesheet (it must match exactly, spaces and line breaks included)';
      if (count > 1) return `The stretch to replace is in the stylesheet ${count} times; include more around it so it is found once`;
      const at = css.indexOf(op.find);
      return { tokens, css: css.slice(0, at) + op.replace + css.slice(at + op.find.length) };
    }
    case 'set-css':
      return { tokens, css: op.css };
  }
}

/**
 * The draft's tokens and stylesheet after `changeSet`, or the first operation
 * that cannot be applied and why. Validity of the values is not judged here
 * (`judgeChangeSet` does that); only whether each operation can be carried out.
 */
export function applyChangeSet(target: ChangeTarget, changeSet: Pick<ChangeSet, 'operations'>): ChangeApplication {
  let current: ChangeTarget = target;
  for (const [index, operation] of changeSet.operations.entries()) {
    const next = applyOne(current, operation);
    if (typeof next === 'string') return { ok: false, index, operation, reason: next };
    current = next;
  }
  return {
    ok: true,
    tokens: current.tokens,
    css: current.css,
    tokensChanged: JSON.stringify(current.tokens) !== JSON.stringify(target.tokens),
    cssChanged: current.css !== target.css,
  };
}

// ---------------------------------------------------------------------------
// Description, for the author's card

/** One operation as the author reads it. */
export interface ChangeLine {
  /** What is changed, in words ("Primary (--theme-primary)"). */
  subject: string;
  /** What happens to it ("set", "reset to the default", …). */
  action: string;
  before?: string;
  after?: string;
}

const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const linesIn = (text: string) => (text === '' ? 0 : text.replace(/\n$/, '').split('\n').length);

function tokenState(tokens: ThemeTokensDocument, name: string): string {
  const own = tokens.tokens[name];
  const def = TOKENS_BY_NAME.get(name);
  if (own === undefined) {
    if (!def) return 'unset';
    return def.defaultDark !== undefined ? `default: ${def.default}; dark ${def.defaultDark}` : `default: ${def.default}`;
  }
  const { value, dark } = tokenModes(own);
  return dark === undefined ? value : `${value}; dark ${dark}`;
}

function primitiveState(tokens: ThemeTokensDocument, name: string): string | undefined {
  const p = tokens.primitives[name];
  if (!p) return undefined;
  return p.dark === undefined ? `${p.type} ${p.value}` : `${p.type} ${p.value}; dark ${p.dark}`;
}

/**
 * Each operation as a plain line with the value before and after it, read
 * against the draft as each earlier operation leaves it. Stops (without a
 * line) at an operation that cannot be applied.
 */
export function describeChangeSet(target: ChangeTarget, changeSet: Pick<ChangeSet, 'operations'>): ChangeLine[] {
  const lines: ChangeLine[] = [];
  let current = target;
  for (const op of changeSet.operations) {
    const next = applyOne(current, op);
    if (typeof next === 'string') break;
    switch (op.op) {
      case 'set-token':
      case 'reset-token': {
        const def = TOKENS_BY_NAME.get(op.token);
        lines.push({
          subject: def ? `${def.label} (${op.token})` : op.token,
          action: op.op === 'reset-token' ? 'reset to the default' : op.value === undefined ? 'set for dark mode' : 'set',
          before: tokenState(current.tokens, op.token),
          after: tokenState(next.tokens, op.token),
        });
        break;
      }
      case 'add-primitive':
        lines.push({ subject: `Primitive ${op.name} (${primitiveVar(op.name)})`, action: 'added', after: primitiveState(next.tokens, op.name) });
        break;
      case 'set-primitive':
        lines.push({ subject: `Primitive ${op.name}`, action: 'changed', before: primitiveState(current.tokens, op.name), after: primitiveState(next.tokens, op.name) });
        break;
      case 'rename-primitive':
        lines.push({ subject: `Primitive ${op.from}`, action: 'renamed', before: primitiveVar(op.from), after: primitiveVar(op.to) });
        break;
      case 'remove-primitive':
        lines.push({ subject: `Primitive ${op.name}`, action: 'removed (its value written into what used it)', before: primitiveState(current.tokens, op.name) });
        break;
      case 'set-choice': {
        const def = THEME_CHOICES.find((c) => c.name === op.choice);
        lines.push({
          subject: def ? def.label : op.choice,
          action: 'chosen',
          before: current.tokens.choices[op.choice] ?? def?.default,
          after: next.tokens.choices[op.choice] ?? def?.default,
        });
        break;
      }
      case 'replace-css':
        lines.push({ subject: 'Stylesheet', action: op.replace === '' ? 'a passage removed' : 'a passage replaced', before: clip(op.find), after: op.replace === '' ? undefined : clip(op.replace) });
        break;
      case 'set-css':
        lines.push({
          subject: 'Stylesheet',
          action: current.css === null ? 'written' : 'rewritten whole',
          before: current.css === null ? undefined : `${linesIn(current.css)} lines`,
          after: `${linesIn(op.css)} lines`,
        });
        break;
    }
    current = next;
  }
  return lines;
}

/** One line of a change line as text ("Primary (--theme-primary): set — #333 → #224"). */
export function changeLineText(line: ChangeLine): string {
  const values = line.before !== undefined && line.after !== undefined ? ` — ${line.before} → ${line.after}` : line.after !== undefined ? ` — ${line.after}` : line.before !== undefined ? ` — was ${line.before}` : '';
  return `${line.subject}: ${line.action}${values}`;
}
