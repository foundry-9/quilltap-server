/**
 * Root-element custom-property cascade.
 *
 * Given stylesheets in document order and the state of `<html>`, computes the
 * value every custom property resolves to on that element: winners picked by
 * importance, cascade layer, specificity and order (unlayered beats layered),
 * then `var()` substituted recursively with fallbacks honoured. This is the
 * guard for Calliope Live's registry work (Spec A): if a refactor of the CSS
 * changes any resolved value, the snapshot changes.
 *
 * Deliberate simplifications, stated so a reader can trust the output:
 * - Only declarations on rules that match the root element count; a selector
 *   with a combinator never does (see selector-match.ts).
 * - `@scope` is read when its root selector matches the root element (a
 *   theme's descendant rules sit in one, ../engine/boundary.ts): inside it a
 *   selector with `:scope` is read with `:scope` as `:root` (same
 *   specificity), and one without is descendant-only and never matches. The
 *   scoping limit is not modelled; it never excludes the root itself. An
 *   `@scope` whose root does not match, or that has no root, is skipped.
 * - `@media`, `@container` and the other conditional group rules are
 *   skipped whole: the snapshot is of one unconditional state (colour mode in
 *   Quilltap is class-based, not `prefers-color-scheme`). `@supports` is
 *   evaluated for an evergreen browser from a short table of the conditions
 *   Tailwind writes; an unknown condition is skipped and reported.
 * - Declarations nested inside a rule's conditional at-rules (CSS nesting)
 *   belong to that rule.
 * - `@property` initial values stand in when nothing declares a registered
 *   property; syntax checking of registered properties is not modelled.
 * - A CSS-wide keyword (`initial`, `inherit`, `unset`, `revert`,
 *   `revert-layer`) is recorded as written; a `var()` that reads it gets the
 *   guaranteed-invalid value, as it does on the root element.
 *
 * Framework-free and pure: strings in, a map out.
 *
 * @module themes/snapshot/cascade
 */

import postcss, { type AtRule, type ChildNode, type Container, type Declaration, type Rule } from 'postcss';
import { compareSpecificity, matchRootSelector, splitSelectorList, type RootElementState, type Specificity } from './selector-match';
import { findVarCall, InvalidValue, normaliseValue } from './var-substitute';

export { normaliseValue, substituteVars } from './var-substitute';

export interface CascadeSheet {
  /** Where the CSS came from (for error messages). */
  origin: string;
  css: string;
}

export interface CascadeResult {
  /** Custom property → resolved value, sorted by name, whitespace normalised. */
  values: Record<string, string>;
  /** Cycles, unresolvable references and invalid values, sorted. */
  errors: string[];
  /** For each declared property, the cascade layer its winning declaration sits in (null = unlayered). */
  winningLayer: Record<string, string | null>;
  /** For each declared property, its winning value as written (before var() substitution). */
  declared: Record<string, string>;
}

interface LayerNode {
  name: string;
  children: LayerNode[];
  rank: number;
}

interface Candidate {
  value: string;
  important: boolean;
  layer: LayerNode | null; // null = unlayered
  specificity: Specificity;
  order: number;
  origin: string;
}

const CONDITIONAL_AT_RULES = new Set(['media', 'container', 'document', 'starting-style']);

/** The root selector of an `@scope` prelude (`(<root>) [to (<limit>)]`), or null when it has none. */
function scopeRootSelector(params: string): string | null {
  const p = params.trim();
  if (!p.startsWith('(')) return null;
  let depth = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '(') depth++;
    else if (p[i] === ')' && --depth === 0) return p.slice(1, i).trim() || null;
  }
  return null;
}

/** A top-level selector list inside a matching `@scope`, as it reads on the root element. */
function unscopeSelector(list: string): string | null {
  const kept = splitSelectorList(list)
    .filter((s) => s.includes(':scope'))
    .map((s) => s.replace(/:scope(?![\w-])/g, ':root'));
  return kept.length > 0 ? kept.join(', ') : null;
}

/**
 * `@supports` conditions the snapshot knows the answer to, for a current
 * evergreen browser. Tailwind's compiler writes all three: the first wraps
 * every `color-mix()` value (with a plain fallback before it), the second is
 * its `@property` fallback for old Safari and Firefox, the third gates
 * preflight's placeholder colour.
 */
const SUPPORTS_VERDICTS: Array<[RegExp, boolean]> = [
  [/^\(color:\s*color-mix\(in lab,\s*red,\s*red\)\)$/, true],
  [/^\(\(-webkit-hyphens:\s*none\)\s*and\s*\(not\s*\(margin-trim:\s*(?:inline|block)\)\)\)\s*or\s*\(\(-moz-orient:\s*inline\)\s*and\s*\(not\s*\(color:\s*rgb\(from red r g b\)\)\)\)$/, false],
  [/^\(not \(-webkit-appearance: -apple-pay-button\)\) or \(contain-intrinsic-size: 1px\)$/, true],
];

/** True or false for a known condition; undefined when the snapshot cannot say. */
function supportsVerdict(params: string): boolean | undefined {
  const condition = normaliseValue(params);
  for (const [pattern, verdict] of SUPPORTS_VERDICTS) {
    if (pattern.test(condition)) return verdict;
  }
  return undefined;
}
const CSS_WIDE_KEYWORDS = new Set(['initial', 'inherit', 'unset', 'revert', 'revert-layer']);

/** Resolve `&` against the parent selector list (CSS nesting). */
function nestSelector(child: string, parent: string | null): string {
  if (parent === null) return child;
  return splitSelectorList(child)
    .map((c) => (c.includes('&') ? c.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${c}`))
    .join(', ');
}

export function resolveRootVariables(sheets: CascadeSheet[], root: RootElementState): CascadeResult {
  const layerRoot: LayerNode = { name: '', children: [], rank: 0 };
  const candidates = new Map<string, Candidate[]>();
  const registered = new Map<string, string>();
  const errors = new Set<string>();
  let order = 0;
  let anonymous = 0;

  const childLayer = (parent: LayerNode, name: string): LayerNode => {
    let node = parent.children.find((c) => c.name === name);
    if (!node) {
      node = { name, children: [], rank: 0 };
      parent.children.push(node);
    }
    return node;
  };
  const layerPath = (parent: LayerNode, dotted: string): LayerNode =>
    dotted.split('.').reduce((node, part) => childLayer(node, part.trim()), parent);

  /** The rule a nested declaration belongs to: its full selector and whether it matches the root. */
  interface RuleContext {
    selector: string;
    match: { matches: boolean; specificity: Specificity };
  }

  /** `inScope`: inside an `@scope` whose root is the root element. */
  const walk = (container: Container, layer: LayerNode, context: RuleContext | null, origin: string, inScope = false) => {
    container.each((node: ChildNode) => {
      if (node.type === 'decl') {
        const decl = node as Declaration;
        if (!context?.match.matches || !decl.prop.startsWith('--')) return;
        const list = candidates.get(decl.prop) ?? [];
        list.push({
          value: decl.value,
          important: decl.important === true,
          layer: layer === layerRoot ? null : layer,
          specificity: context.match.specificity,
          order: order++,
          origin,
        });
        candidates.set(decl.prop, list);
        return;
      }
      if (node.type === 'atrule') {
        const at = node as AtRule;
        const name = at.name.toLowerCase();
        if (name === 'layer') {
          if (!at.nodes) {
            for (const n of at.params.split(',')) layerPath(layer, n.trim());
            return;
          }
          const target = at.params.trim() ? layerPath(layer, at.params.trim()) : childLayer(layer, `\0anon${anonymous++}`);
          walk(at, target, context, origin, inScope);
          return;
        }
        if (name === 'property') {
          let initial: string | undefined;
          at.walkDecls('initial-value', (d) => {
            initial = d.value;
          });
          if (initial !== undefined) registered.set(at.params.trim(), initial);
          return;
        }
        if (name === 'supports') {
          const verdict = supportsVerdict(at.params);
          if (verdict === undefined) {
            errors.add(`${origin}: unknown @supports condition, skipped: ${normaliseValue(at.params)}`);
            return;
          }
          if (verdict) walk(at, layer, context, origin, inScope);
          return;
        }
        if (name === 'scope') {
          const scopeRoot = scopeRootSelector(at.params);
          if (context !== null || scopeRoot === null) return;
          let rootMatches = false;
          try {
            rootMatches = matchRootSelector(scopeRoot, root).matches;
          } catch (error) {
            errors.add(`${origin}: ${(error as Error).message}`);
          }
          if (rootMatches) walk(at, layer, null, origin, true);
          return;
        }
        if (CONDITIONAL_AT_RULES.has(name)) return;
        // @font-face, @keyframes, @page, @import, @charset and the like declare
        // nothing on the root element.
        return;
      }
      if (node.type === 'rule') {
        const rule = node as Rule;
        const own = inScope && context === null ? unscopeSelector(rule.selector) : rule.selector;
        if (own === null) return; // descendant-only inside @scope
        const selector = nestSelector(own, context?.selector ?? null);
        let match: RuleContext['match'];
        try {
          match = matchRootSelector(selector, root);
        } catch (error) {
          errors.add(`${origin}: ${(error as Error).message}`);
          match = { matches: false, specificity: [0, 0, 0] };
        }
        walk(rule, layer, { selector, match }, origin, inScope);
      }
    });
  };

  for (const sheet of sheets) {
    walk(postcss.parse(sheet.css, { from: undefined }), layerRoot, null, sheet.origin);
  }

  // Post-order ranks: sublayers in order, then the layer's own declarations.
  let rank = 0;
  const assign = (node: LayerNode) => {
    for (const c of node.children) assign(c);
    node.rank = rank++;
  };
  assign(layerRoot);
  const layerRank = (c: Candidate) => (c.layer ? c.layer.rank : layerRoot.rank);

  const beats = (a: Candidate, b: Candidate): boolean => {
    if (a.important !== b.important) return a.important;
    const la = layerRank(a);
    const lb = layerRank(b);
    if (la !== lb) return a.important ? la < lb : la > lb;
    const s = compareSpecificity(a.specificity, b.specificity);
    if (s !== 0) return s > 0;
    return a.order > b.order;
  };

  const declared = new Map<string, Candidate>();
  for (const [prop, list] of candidates) {
    declared.set(prop, list.reduce((best, c) => (beats(c, best) ? c : best)));
  }

  const raw = (name: string): string | undefined => declared.get(name)?.value ?? registered.get(name);

  const resolved = new Map<string, string | InvalidValue>();
  const stack: string[] = [];

  const resolveName = (name: string): string => {
    const done = resolved.get(name);
    if (done instanceof InvalidValue) throw done;
    if (done !== undefined) return done;
    const cycleAt = stack.indexOf(name);
    if (cycleAt >= 0) {
      const cycle = [...stack.slice(cycleAt), name];
      errors.add(`cycle: ${cycle.join(' -> ')}`);
      const invalid = new InvalidValue(`cycle at ${name}`);
      for (const n of cycle) resolved.set(n, invalid);
      throw invalid;
    }
    const value = raw(name);
    if (value === undefined) throw new InvalidValue(`undefined ${name}`);
    stack.push(name);
    try {
      if (CSS_WIDE_KEYWORDS.has(value.trim().toLowerCase())) {
        throw new InvalidValue(`${name} is ${value.trim()}`);
      }
      const out = substitute(value, name);
      resolved.set(name, out);
      return out;
    } catch (error) {
      if (error instanceof InvalidValue) {
        if (!resolved.has(name)) resolved.set(name, error);
        throw error;
      }
      throw error;
    } finally {
      stack.pop();
    }
  };

  const replaceVar = (ref: string, fallback: string | null, owner: string): string => {
    if (raw(ref) !== undefined) {
      try {
        return resolveName(ref);
      } catch (error) {
        if (!(error instanceof InvalidValue) || fallback === null) throw error;
        return substitute(fallback, owner);
      }
    }
    if (fallback !== null) return substitute(fallback, owner);
    errors.add(`unresolvable: ${owner} references ${ref}, which nothing declares, with no fallback`);
    throw new InvalidValue(`undefined ${ref}`);
  };

  const substitute = (value: string, owner: string): string => {
    let out = '';
    let i = 0;
    while (i < value.length) {
      const call = findVarCall(value, i);
      if (!call) {
        out += value.slice(i);
        break;
      }
      out += value.slice(i, call.start) + replaceVar(call.name, call.fallback, owner);
      i = call.end;
    }
    return out;
  };

  const layerName = (node: LayerNode | null): string | null => {
    if (!node) return null;
    const path: string[] = [];
    const find = (n: LayerNode, trail: string[]): boolean => {
      if (n === node) {
        path.push(...trail);
        return true;
      }
      return n.children.some((c) => find(c, [...trail, c.name]));
    };
    find(layerRoot, []);
    return path.join('.');
  };

  const names = new Set<string>([...declared.keys(), ...registered.keys()]);
  const values: Record<string, string> = {};
  const winningLayer: Record<string, string | null> = {};
  for (const name of [...names].sort()) {
    const winner = declared.get(name);
    if (winner) winningLayer[name] = layerName(winner.layer);
    const rawValue = raw(name) ?? '';
    if (CSS_WIDE_KEYWORDS.has(rawValue.trim().toLowerCase())) {
      // Recorded as written; a var() that reads it gets the guaranteed-invalid value.
      values[name] = rawValue.trim().toLowerCase();
      continue;
    }
    try {
      values[name] = normaliseValue(resolveName(name));
    } catch (error) {
      if (!(error instanceof InvalidValue)) throw error;
      // Invalid at computed-value time: the property is guaranteed-invalid.
      errors.add(`invalid: ${name} (${error.message})`);
    }
  }

  const declaredValues: Record<string, string> = {};
  for (const [name, c] of declared) declaredValues[name] = c.value;
  return { values, errors: [...errors].sort(), winningLayer, declared: declaredValues };
}
