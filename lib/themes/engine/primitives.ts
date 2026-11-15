/**
 * Theme engine — editing a tokens document's primitives (Calliope Live,
 * Spec E, Stage 0.4).
 *
 * Pure functions from a tokens document to a tokens document. A rename
 * rewrites every `var(--p-<old>)` (inside a longer value too); a removal
 * writes the primitive's value into whatever referred to it — light into
 * light, dark into dark, giving a token a dark value of its own where the
 * primitive had one and the token did not (decision 3).
 *
 * @module themes/engine/primitives
 */

import { primitiveVar, tokenModes, type ThemePrimitive, type ThemeTokensDocument, type ThemeTokenValue } from './document';

/** What a primitive name must look like (the tokens document's rule). */
export const PRIMITIVE_NAME = /^[a-z][a-z0-9-]*$/;

export type PrimitiveEdit = { ok: true; document: ThemeTokensDocument } | { ok: false; reason: string };

/** Why `name` cannot be a new primitive's name in `doc`, or null. */
export function primitiveNameProblem(doc: ThemeTokensDocument, name: string): string | null {
  if (!PRIMITIVE_NAME.test(name)) return 'A primitive name is kebab-case: lowercase letters, digits and hyphens, starting with a letter';
  if (doc.primitives[name] !== undefined) return `A primitive named "${name}" already exists`;
  return null;
}

/** Each `var()` call in `value` whose first argument is `variable`: start, end (exclusive) and where the name sits. */
function referencesTo(value: string, variable: string): Array<{ start: number; end: number; nameStart: number; nameEnd: number }> {
  const out: Array<{ start: number; end: number; nameStart: number; nameEnd: number }> = [];
  const re = /var\(\s*(--[\w-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) {
    if (m[1] !== variable) continue;
    const start = m.index;
    let depth = 0;
    let end = -1;
    for (let i = start + 3; i < value.length; i++) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')' && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    if (end === -1) continue;
    const nameEnd = m.index + m[0].length;
    out.push({ start, end, nameStart: nameEnd - variable.length, nameEnd });
  }
  return out;
}

const refersTo = (value: string, variable: string) => referencesTo(value, variable).length > 0;

function replaceReferences(value: string, variable: string, replace: (whole: { start: number; end: number; nameStart: number; nameEnd: number }) => [number, number, string]): string {
  let out = value;
  for (const ref of referencesTo(value, variable).reverse()) {
    const [from, to, text] = replace(ref);
    out = out.slice(0, from) + text + out.slice(to);
  }
  return out;
}

/** The tokens and primitives whose values (either mode) refer to primitive `name`. */
export function primitiveUsers(doc: ThemeTokensDocument, name: string): { tokens: string[]; primitives: string[] } {
  const variable = primitiveVar(name);
  const uses = (entry: { value: string; dark?: string }) => refersTo(entry.value, variable) || (entry.dark !== undefined && refersTo(entry.dark, variable));
  return {
    tokens: Object.entries(doc.tokens)
      .filter(([, e]) => uses(tokenModes(e)))
      .map(([n]) => n),
    primitives: Object.entries(doc.primitives)
      .filter(([n, p]) => n !== name && uses(p))
      .map(([n]) => n),
  };
}

/** Add primitive `name`. Refuses a name that is taken or not kebab-case. */
export function addPrimitive(doc: ThemeTokensDocument, name: string, primitive: ThemePrimitive): PrimitiveEdit {
  const problem = primitiveNameProblem(doc, name);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, document: { ...doc, primitives: { ...doc.primitives, [name]: { ...primitive } } } };
}

function withPrimitive(doc: ThemeTokensDocument, name: string, change: (p: ThemePrimitive) => ThemePrimitive): ThemeTokensDocument {
  const current = doc.primitives[name];
  if (!current) return doc;
  return { ...doc, primitives: { ...doc.primitives, [name]: change(current) } };
}

/** Set primitive `name`'s value (both modes, unless it has a dark value of its own). */
export function setPrimitiveValue(doc: ThemeTokensDocument, name: string, value: string): ThemeTokensDocument {
  return withPrimitive(doc, name, (p) => ({ ...p, value }));
}

/** Set primitive `name`'s dark value, or clear it (`undefined`) so dark is light again. */
export function setPrimitiveDark(doc: ThemeTokensDocument, name: string, dark: string | undefined): ThemeTokensDocument {
  return withPrimitive(doc, name, (p) => {
    const { dark: _old, ...rest } = p;
    return dark === undefined ? rest : { ...rest, dark };
  });
}

/** Change primitive `name`'s type; its values stay as written. */
export function setPrimitiveType(doc: ThemeTokensDocument, name: string, type: ThemePrimitive['type']): ThemeTokensDocument {
  return withPrimitive(doc, name, (p) => ({ ...p, type }));
}

function mapEntries(
  doc: ThemeTokensDocument,
  skip: string | null,
  token: (entry: ThemeTokenValue) => ThemeTokenValue,
  primitive: (p: ThemePrimitive) => ThemePrimitive,
): ThemeTokensDocument {
  return {
    ...doc,
    tokens: Object.fromEntries(Object.entries(doc.tokens).map(([n, e]) => [n, token(e)])),
    primitives: Object.fromEntries(Object.entries(doc.primitives).filter(([n]) => n !== skip).map(([n, p]) => [n, primitive(p)])),
  };
}

const entryOf = (value: string, dark: string | undefined): ThemeTokenValue => (dark === undefined ? value : { value, dark });

/**
 * Rename primitive `from` to `to`, rewriting every reference to it. Refuses
 * a name that is taken or not kebab-case. Order of primitives is kept.
 */
export function renamePrimitive(doc: ThemeTokensDocument, from: string, to: string): PrimitiveEdit {
  if (doc.primitives[from] === undefined) return { ok: false, reason: `There is no primitive named "${from}"` };
  if (from === to) return { ok: true, document: doc };
  const problem = primitiveNameProblem(doc, to);
  if (problem) return { ok: false, reason: problem };
  const oldVar = primitiveVar(from);
  const newVar = primitiveVar(to);
  const rewrite = (v: string) => replaceReferences(v, oldVar, (r) => [r.nameStart, r.nameEnd, newVar]);
  const rewritten = mapEntries(
    doc,
    null,
    (e) => {
      const { value, dark } = tokenModes(e);
      return entryOf(rewrite(value), dark === undefined ? undefined : rewrite(dark));
    },
    (p) => (p.dark === undefined ? { ...p, value: rewrite(p.value) } : { ...p, value: rewrite(p.value), dark: rewrite(p.dark) }),
  );
  const primitives = Object.fromEntries(Object.entries(rewritten.primitives).map(([n, p]) => [n === from ? to : n, p]));
  return { ok: true, document: { ...rewritten, primitives } };
}

/**
 * Remove primitive `name`, writing its value into every token and primitive
 * that referred to it (a reference with a fallback is replaced whole).
 */
export function removePrimitive(doc: ThemeTokensDocument, name: string): ThemeTokensDocument {
  const removed = doc.primitives[name];
  if (!removed) return doc;
  const variable = primitiveVar(name);
  const light = removed.value;
  const dark = removed.dark ?? removed.value;
  const substitute = (v: string, text: string) => replaceReferences(v, variable, (r) => [r.start, r.end, text]);
  const modes = (value: string, ownDark: string | undefined): { value: string; dark?: string } => {
    const nextLight = substitute(value, light);
    if (ownDark !== undefined) return { value: nextLight, dark: substitute(ownDark, dark) };
    if (removed.dark !== undefined && refersTo(value, variable)) return { value: nextLight, dark: substitute(value, dark) };
    return { value: nextLight };
  };
  return mapEntries(
    doc,
    name,
    (e) => {
      const m = modes(tokenModes(e).value, tokenModes(e).dark);
      return entryOf(m.value, m.dark);
    },
    (p) => {
      const m = modes(p.value, p.dark);
      return m.dark === undefined ? { type: p.type, value: m.value } : { type: p.type, value: m.value, dark: m.dark };
    },
  );
}
