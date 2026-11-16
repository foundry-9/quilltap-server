/**
 * Calliope's references — build the styled-by table (Calliope Live, Spec J
 * decision 6).
 *
 * Reads the app's stylesheets with PostCSS and records, for every catalogued
 * hook, what the rules that select it set: one row per condition (the base
 * element, a variant value, a state, an interaction, a pseudo-element, dark
 * mode, an ancestor hook), and in each row every property with the custom
 * properties its value reads — or that it is set by a literal.
 *
 * A rule is attributed to a hook when the hook's class is in the rule's
 * *subject* (the last compound selector): `.qt-a:hover .qt-b` styles
 * `qt-b` (inside `qt-a`, hovered), never `qt-a`. Nested rules are resolved
 * against their parents first. Classes inside `:not()` do not count.
 *
 * Less exact than the inspector (Spec H), which reads the cascade in a
 * browser: the table cannot see Tailwind utilities written in markup beside
 * a hook class, and it does not decide which of two rules wins. It needs no
 * browser, so `npm run lint` can hold it current.
 *
 * Pure with respect to its inputs (stylesheet text in, table out); the
 * generator and the lint read the files. Server- and script-side: PostCSS.
 *
 * @module themes/assist/styled-by-build
 */

import postcss, { type ChildNode, type Container, type Rule } from 'postcss';
import { tokenizeSelector } from '../hooks/lint';
import type { HookCatalogue, HookDef } from '../hooks/types';
import type { StyledByProperty, StyledByRow, StyledByTable } from './styled-by';

/** Where the table is written (repo-relative). */
export const STYLED_BY_TABLE_PATH = 'lib/themes/assist/styled-by.generated.json';
export const STYLED_BY_REGENERATE_COMMAND = 'npm run generate:theme-styled-by';

/**
 * The stylesheets the table is read from, in order: the qt-* component layer
 * (`app/styles/qt-components/`) as Tailwind compiles it — compiled in memory
 * by `scripts/lib/qt-components-css.mjs`, so every `@apply` is already a
 * declaration — then the app's global sheet, read as written. `path` is what
 * the table records.
 */
export const STYLED_BY_SOURCES: ReadonlyArray<{ path: string; compiled?: true }> = [
  { path: 'app/styles/qt-components', compiled: true },
  { path: 'app/globals.css' },
];

/** Interaction pseudo-classes, as the inspector groups them. */
const INTERACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/:hover\b/, 'hover'],
  [/:focus(-visible|-within)?\b/, 'focus'],
  [/:active\b/, 'active'],
  [/:disabled\b/, 'disabled'],
];
const PSEUDO_ELEMENT = /::?(before|after|placeholder|marker|selection|first-line|first-letter|backdrop|file-selector-button|-webkit-[\w-]+|-moz-[\w-]+)\b/;
const VAR_REF = /var\(\s*(--[\w-]+)/g;

/** Tailwind's plumbing (`--tw-*`, `--default-*`): not a token a theme sets. */
const isTailwindInternal = (name: string) => name.startsWith('--tw-') || name.startsWith('--default-');

/**
 * The custom properties `value` reads that a theme could set: Tailwind's
 * internal variables are followed through `local` (what the same rule sets
 * them to) and otherwise dropped.
 */
function readsOf(value: string, local: ReadonlyMap<string, string>, seen: Set<string> = new Set()): string[] {
  const out: string[] = [];
  for (const m of value.matchAll(VAR_REF)) {
    const name = m[1];
    if (!isTailwindInternal(name)) out.push(name);
    else if (local.has(name) && !seen.has(name)) {
      seen.add(name);
      out.push(...readsOf(local.get(name) as string, local, seen));
    }
  }
  return out;
}

/** Index just past the bracket or paren closing the one at `start`. */
function closeOf(text: string, start: number): number {
  const open = text[start];
  const close = open === '(' ? ')' : ']';
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i + 1;
  }
  return text.length;
}

/** One complex selector's compound selectors, split at top-level combinators. */
export function compoundsOf(selector: string): string[] {
  const out: string[] = [];
  let current = '';
  const s = selector.trim();
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      current += s.slice(i, i + 2);
      i++;
    } else if (ch === '(' || ch === '[') {
      const end = closeOf(s, i);
      current += s.slice(i, end);
      i = end - 1;
    } else if (/\s/.test(ch) || ch === '>' || ch === '+' || ch === '~') {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/** `compound` without its `:not(...)` arguments, whose classes say what the element is not. */
function withoutNegations(compound: string): string {
  let out = '';
  for (let i = 0; i < compound.length; i++) {
    if (compound.startsWith(':not(', i)) {
      i = closeOf(compound, i + 4) - 1;
      continue;
    }
    out += compound[i];
  }
  return out;
}

/** Split a selector list on top-level commas. */
function splitList(list: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (ch === '\\') i++;
    else if (ch === '(' || ch === '[') i = closeOf(list, i) - 1;
    else if (ch === ',') {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

/** Every selector a rule stands for once nesting is resolved (`&` is the parent; no `&` means a descendant). */
function resolvedSelectors(rule: Rule): string[] {
  let parent: Container | undefined = rule.parent as Container | undefined;
  while (parent && parent.type !== 'rule' && parent.type !== 'root') parent = parent.parent as Container | undefined;
  const own = splitList(rule.selector);
  if (!parent || parent.type !== 'rule') return own;
  const outer = resolvedSelectors(parent as Rule);
  const out: string[] = [];
  for (const p of outer) {
    for (const sel of own) out.push(sel.includes('&') ? sel.replace(/&/g, p) : `${p} ${sel}`);
  }
  return out;
}

function insideKeyframes(node: ChildNode): boolean {
  let n: Container | undefined = node.parent as Container | undefined;
  while (n) {
    if (n.type === 'atrule' && /keyframes$/i.test((n as unknown as { name: string }).name)) return true;
    n = n.parent as Container | undefined;
  }
  return false;
}

/** The condition one selector puts on hook `hook`, as the row's `when` label ('' for the base element). */
export function conditionFor(hook: HookDef, selector: string, hookClasses: ReadonlySet<string>): string {
  const compounds = compoundsOf(selector);
  const subject = compounds[compounds.length - 1] ?? '';
  const ancestors = compounds.slice(0, -1);
  const tokens = tokenizeSelector(withoutNegations(subject));
  const parts: string[] = [];

  for (const variant of hook.variants ?? []) {
    for (const attr of tokens.attributes) {
      if (attr.name !== variant.attribute) continue;
      parts.push(attr.value === null ? `[${attr.name}]` : `[${attr.name}="${attr.value}"]`);
    }
  }
  for (const state of hook.states ?? []) {
    if (state.kind === 'class') {
      if (tokens.classes.includes(state.className)) parts.push(`state: ${state.label}`);
    } else {
      for (const attr of tokens.attributes) {
        if (attr.name !== state.attribute) continue;
        parts.push(`state: ${state.label}${attr.value === null ? '' : ` (${attr.name}="${attr.value}")`}`);
      }
    }
  }
  const bare = withoutNegations(subject);
  for (const [re, label] of INTERACTIONS) if (re.test(bare)) parts.push(`:${label}`);
  const pseudo = PSEUDO_ELEMENT.exec(bare);
  if (pseudo) parts.push(`::${pseudo[1]}`);

  const ancestorTokens = ancestors.map((c) => tokenizeSelector(withoutNegations(c)));
  const dark =
    tokens.classes.includes('dark') ||
    ancestorTokens.some((t) => t.classes.includes('dark') || t.attributes.some((a) => a.name === 'data-color-mode' && a.value === 'dark'));
  if (dark) parts.push('dark mode');
  const inside = ancestorTokens.flatMap((t) => t.classes.filter((c) => hookClasses.has(c) && c !== hook.className));
  if (inside.length > 0) parts.push(`inside .${[...new Set(inside)].join(' .')}`);
  return parts.join(', ');
}

interface RowAccumulator {
  props: Map<string, { vars: Set<string>; literal: boolean }>;
}

/**
 * The styled-by table for `catalogue` over `sources` (each a stylesheet's
 * text, with its repo-relative path for the record).
 */
export function buildStyledByTable(sources: ReadonlyArray<{ path: string; css: string }>, catalogue: HookCatalogue): StyledByTable {
  const hookClasses = new Set(catalogue.hooks.map((h) => h.className));
  const byClass = new Map(catalogue.hooks.map((h) => [h.className as string, h]));
  const rows = new Map<string, Map<string, RowAccumulator>>();

  for (const source of sources) {
    const root = postcss.parse(source.css, { from: source.path });
    root.walkRules((rule) => {
      if (insideKeyframes(rule)) return;
      const decls = (rule.nodes ?? []).filter((n): n is import('postcss').Declaration => n.type === 'decl');
      if (decls.length === 0) return;
      // Tailwind's own variables set in this rule (`--tw-shadow: … var(--qt-x) …`), so a
      // property that reads one is credited with the tokens behind it.
      const local = new Map<string, string>();
      for (const decl of decls) if (isTailwindInternal(decl.prop)) local.set(decl.prop, decl.value);
      for (const selector of resolvedSelectors(rule)) {
        const compounds = compoundsOf(selector);
        const subject = compounds[compounds.length - 1] ?? '';
        const subjectClasses = new Set(tokenizeSelector(withoutNegations(subject)).classes);
        for (const cls of subjectClasses) {
          const hook = byClass.get(cls);
          if (!hook) continue;
          const when = conditionFor(hook, selector, hookClasses);
          const hookRows = rows.get(cls) ?? new Map<string, RowAccumulator>();
          rows.set(cls, hookRows);
          const row = hookRows.get(when) ?? { props: new Map() };
          hookRows.set(when, row);
          for (const decl of decls) {
            if (isTailwindInternal(decl.prop)) continue;
            const property = decl.prop.startsWith('--') ? decl.prop : decl.prop.toLowerCase();
            const entry = row.props.get(property) ?? { vars: new Set<string>(), literal: false };
            const vars = readsOf(decl.value, local);
            for (const v of vars) entry.vars.add(v);
            if (vars.length === 0) entry.literal = true;
            row.props.set(property, entry);
          }
        }
      }
    });
  }

  const hooks: Record<string, StyledByRow[]> = {};
  for (const hook of catalogue.hooks) {
    const hookRows = rows.get(hook.className);
    if (!hookRows) continue;
    hooks[hook.className] = [...hookRows.entries()]
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .map(([when, row]) => ({
        when,
        properties: [...row.props.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([property, e]): StyledByProperty => {
            const out: StyledByProperty = { property, vars: [...e.vars].sort() };
            if (e.literal) out.literal = true;
            return out;
          }),
      }));
  }
  return { catalogueVersion: catalogue.version, sources: [...sources.map((s) => s.path)], hooks };
}

/** The table as the committed file holds it. */
export function renderStyledByTable(table: StyledByTable): string {
  const hooks = Object.entries(table.hooks).map(
    ([cls, rows]) => `  ${JSON.stringify(cls)}: [\n${rows.map((r) => `   ${JSON.stringify(r)}`).join(',\n')}\n  ]`,
  );
  return [
    '{',
    ` "catalogueVersion": ${table.catalogueVersion},`,
    ` "sources": ${JSON.stringify(table.sources)},`,
    ' "hooks": {',
    hooks.join(',\n'),
    ' }',
    '}',
    '',
  ].join('\n');
}
