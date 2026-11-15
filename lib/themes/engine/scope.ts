/**
 * Theme engine — scope a version 2 theme's custom CSS.
 *
 * Authors write ordinary selectors with no theme id. This parses the CSS with
 * PostCSS, rejects what a theme may not do, and re-serialises the tree with
 * every style rule inside the theme's boundary (./boundary.ts:
 * `@scope ([data-theme="<id>"]) to (<any other theme>)`), its selectors
 * relative to `:scope`:
 * - `X` → `:scope X`; a leading `:root` or `html` becomes `:scope` itself;
 *   a leading `.dark` / `.light` attaches to it (`:scope.dark …`); `body`
 *   stays a descendant;
 * - consecutive rules share one `@scope` block;
 * - `@keyframes` names gain the theme id, and `animation` / `animation-name`
 *   values that use them are rewritten to match;
 * - `@media`, `@supports`, `@container` and `@layer` are kept with their
 *   contents scoped; `@font-face` (fonts are declared in the manifest),
 *   `@import`, `@charset`, `@namespace` and any other at-rule are rejected;
 * - every `url()` follows ./urls.ts;
 * - CSS that does not parse is rejected, and so is output containing `</`.
 * Comments are dropped. Each error names the line.
 *
 * Server-side only (PostCSS).
 *
 * @module themes/engine/scope
 */

import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Rule } from 'postcss';
import { themeScopePrelude } from './boundary';
import { rewriteUrls } from './urls';

export interface ScopeOptions {
  id: string;
  version: string;
  /** Bundle-relative paths of every file in the bundle. */
  files: ReadonlySet<string>;
}

export interface ScopeResult {
  /** The scoped CSS; empty when there are errors. */
  css: string;
  errors: string[];
}

const KEPT_AT_RULES = new Set(['media', 'supports', 'container', 'layer']);
const KEYFRAMES = new Set(['keyframes', '-webkit-keyframes']);

/** Split a selector list on top-level commas. */
function splitList(list: string): string[] {
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
  return out.filter(Boolean);
}

/**
 * One complex selector, relative to the theme's scope root. It is only
 * meaningful inside the `@scope` block {@link scopeThemeCss} writes.
 */
export function scopeSelector(selector: string): string {
  const prefix = ':scope';
  const s = selector.trim();
  // A leading :root or html becomes the prefix itself.
  const rootMatch = /^(?::root|html)(?![\w-])/i.exec(s);
  if (rootMatch) {
    const rest = s.slice(rootMatch[0].length);
    return `${prefix}${rest}`;
  }
  // A leading .dark / .light attaches to the prefix.
  if (/^\.(dark|light)(?![\w-])/.test(s)) return `${prefix}${s}`;
  return `${prefix} ${s}`;
}

function lineOf(node: { source?: { start?: { line: number } } }): string {
  const line = node.source?.start?.line;
  return line ? `line ${line}` : 'unknown line';
}

/** Rename keyframe identifiers inside an animation / animation-name value. */
function renameAnimations(value: string, names: Map<string, string>): string {
  return value.replace(/(^|[\s,])(-?[A-Za-z_][\w-]*)(?=$|[\s,])/g, (m, lead: string, ident: string) => {
    const renamed = names.get(ident);
    return renamed ? `${lead}${renamed}` : m;
  });
}

export function scopeThemeCss(css: string, options: ScopeOptions): ScopeResult {
  const errors: string[] = [];
  let root: postcss.Root;
  try {
    root = postcss.parse(css, { from: undefined });
  } catch (error) {
    const e = error as { line?: number; reason?: string; message: string };
    return { css: '', errors: [`custom CSS does not parse (line ${e.line ?? '?'}): ${e.reason ?? e.message}`] };
  }

  root.walkComments((c) => {
    c.remove();
  });

  // Keyframe names, renamed with the theme id.
  const keyframeNames = new Map<string, string>();
  root.walkAtRules((at) => {
    if (KEYFRAMES.has(at.name.toLowerCase())) {
      const name = at.params.trim();
      if (!/^-?[A-Za-z_][\w-]*$/.test(name)) {
        errors.push(`@keyframes name "${name}" is not a plain identifier (${lineOf(at)})`);
        return;
      }
      keyframeNames.set(name, `${options.id}-${name}`);
    }
  });

  const urlContext = { themeId: options.id, version: options.version, files: options.files };

  const visitDeclaration = (decl: Declaration) => {
    const prop = decl.prop.toLowerCase();
    if (prop === 'animation' || prop === 'animation-name') decl.value = renameAnimations(decl.value, keyframeNames);
    if (/url\(|image-set\(/i.test(decl.value)) {
      const rewritten = rewriteUrls(decl.value, urlContext);
      for (const e of rewritten.errors) errors.push(`${e} (${lineOf(decl)})`);
      decl.value = rewritten.value;
    }
  };

  /** The `@scope` blocks this pass wrote, so a following rule joins rather than opens one. */
  const scopeBlocks = new Set<AtRule>();

  /** Walk a container whose rules sit at selector top level (the root, or a kept at-rule). */
  const walkTopLevel = (container: Container) => {
    container.each((node: ChildNode) => {
      if (node.type === 'atrule') {
        const at = node as AtRule;
        const name = at.name.toLowerCase();
        if (KEYFRAMES.has(name)) {
          at.params = keyframeNames.get(at.params.trim()) ?? at.params;
          at.walkDecls(visitDeclaration);
          return;
        }
        if (KEPT_AT_RULES.has(name)) {
          if (name === 'layer' && !at.nodes) return; // `@layer a, b;`
          walkTopLevel(at);
          return;
        }
        if (name === 'font-face') errors.push(`@font-face is not allowed in custom CSS; declare fonts in theme.json (${lineOf(at)})`);
        else if (name === 'import' || name === 'charset' || name === 'namespace') errors.push(`@${name} is not allowed (${lineOf(at)})`);
        else errors.push(`@${at.name} is not allowed in theme CSS (${lineOf(at)})`);
        return;
      }
      if (node.type === 'rule') {
        const rule = node as Rule;
        rule.selector = splitList(rule.selector)
          .map((s) => scopeSelector(s))
          .join(',\n');
        // Into the theme's boundary: the open block before it, or a new one.
        const before = rule.prev();
        if (before && before.type === 'atrule' && scopeBlocks.has(before as AtRule)) {
          rule.remove();
          (before as AtRule).append(rule);
        } else {
          const block = postcss.atRule({ name: 'scope', params: themeScopePrelude(options.id) });
          scopeBlocks.add(block);
          rule.replaceWith(block);
          block.append(rule);
        }
        // Nested rules are relative to an already-scoped parent.
        rule.walkDecls(visitDeclaration);
        rule.walkAtRules((at) => {
          const name = at.name.toLowerCase();
          if (!KEPT_AT_RULES.has(name)) errors.push(`@${at.name} is not allowed inside a rule (${lineOf(at)})`);
        });
        return;
      }
      if (node.type === 'decl') {
        errors.push(`declaration "${(node as Declaration).prop}" outside a rule (${lineOf(node)})`);
      }
    });
  };

  walkTopLevel(root);

  const out = root.toString();
  if (out.includes('</')) errors.push('custom CSS may not contain "</"');
  return errors.length > 0 ? { css: '', errors } : { css: out, errors: [] };
}
