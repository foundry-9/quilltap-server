/**
 * Calliope's references — what she is told (Calliope Live, Spec J §0.3).
 *
 * The one module that turns the draft, the token registry, the hook
 * catalogue and the styled-by table into text for a model. Every rendering is
 * bounded: lists are capped and say how many more there are, long values and
 * the stylesheet are clipped and say so. Lookups (`lookupTokens`,
 * `lookupHooks`) are pure searches; the renderers join their results to the
 * draft's values in force. No call site assembles model-facing text from the
 * registry by hand.
 *
 * Pure (no I/O). Server-side in practice: the hook catalogue it reads pulls
 * the chat schemas, which reach the logger.
 *
 * @module themes/assist/render
 */

import { draftResources, matchesQuery } from '@/components/theme-editor/model';
import {
  CLIENT_REGISTRY_VIEW,
  CONTRAST_PAIRS,
  THEME_CHOICES,
  THEME_TOKENS,
  TOKEN_GROUPS,
  checkContrast,
  primitiveVar,
  resolveLiteral,
  resolveTheme,
  tokenModes,
  type ContrastFinding,
  type ContrastKind,
  type ContrastPair,
  type ResolvedTheme,
  type ThemeTokensDocument,
  type TokenDef,
  type TokenType,
} from '../engine/client';
import { tailwindAlias } from '../registry/tailwind';
import { HOOK_SURFACE_TITLES, HOOKS } from '../hooks';
import type { HookDef, HookSurface } from '../hooks/types';
import { styledBy } from './styled-by';

/** A draft as Calliope reads it. */
export interface AssistDraft {
  id: string;
  /** The theme's name (from theme.json, else the id). */
  name: string;
  manifest: Record<string, unknown> | null;
  tokens: ThemeTokensDocument;
  /** The stylesheet, or null when the draft has none. */
  css: string | null;
  /** Image files in the draft, bundle-relative. */
  images: string[];
  /** The draft's issues as the editor shows them. */
  issues: ReadonlyArray<{ severity: 'error' | 'warning'; message: string }>;
}

/** The parts of a draft's detail the assistant reads (a structural subset of `DraftDetail`). */
export interface AssistDraftSource {
  id: string;
  manifest: Record<string, unknown> | null;
  tokens: ThemeTokensDocument | null;
  styles: { text: string } | null;
  images: ReadonlyArray<{ path: string }>;
  issues: ReadonlyArray<{ severity: 'error' | 'warning'; message: string }>;
}

const EMPTY_TOKENS: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} };

/** The draft as Calliope reads it, from the detail the drafts service returns. */
export function assistDraftFrom(detail: AssistDraftSource): AssistDraft {
  const name = typeof detail.manifest?.name === 'string' ? detail.manifest.name : detail.id;
  return {
    id: detail.id,
    name,
    manifest: detail.manifest,
    tokens: detail.tokens ?? EMPTY_TOKENS,
    css: detail.styles ? detail.styles.text : null,
    images: detail.images.map((i) => i.path),
    issues: detail.issues,
  };
}

/** Caps on what one rendering may hold. */
export const RENDER_LIMITS = {
  /** Characters of a value before it is clipped. */
  value: 160,
  /** The stylesheet in the draft overview. */
  cssInOverview: 6000,
  /** The stylesheet when asked for on its own. */
  cssAlone: 60000,
  issues: 30,
  contrast: 30,
  /** Tokens the overview lists as set by the draft. */
  setTokens: 300,
  tokenMatches: 40,
  /** Hooks rendered in full; further matches are named only. */
  hookMatches: 6,
  /** Hook names listed after the full ones. */
  hookNamesOnly: 40,
} as const;

const clip = (text: string, max: number = RENDER_LIMITS.value) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const TOKENS_BY_NAME = new Map(THEME_TOKENS.map((t) => [t.name as string, t]));
const GROUP_LABEL = new Map(TOKEN_GROUPS.map((g) => [g.id, g.label]));

function sourceWord(source: string): string {
  switch (source) {
    case 'theme':
    case 'theme-dark':
      return 'set by this theme';
    case 'choice':
      return 'from a choice';
    default:
      return 'default';
  }
}

/** One token's value in one mode: as written, its literal when that differs, where it comes from. */
function modeValue(resolved: ResolvedTheme, name: string, mode: 'light' | 'dark'): string {
  const entry = resolved[mode][name];
  if (!entry) return 'unset';
  const literal = resolveLiteral(resolved[mode], name);
  const shown = literal && literal !== entry.value ? `${clip(entry.value)} (= ${clip(literal)})` : clip(entry.value);
  return `${shown} [${sourceWord(entry.source)}]`;
}

/** The registry token a custom property stands for (a Tailwind name read as its semantic token). */
function registryNameOf(variable: string): string | undefined {
  if (TOKENS_BY_NAME.has(variable)) return variable;
  const alias = tailwindAlias(variable);
  return alias && TOKENS_BY_NAME.has(alias) ? alias : undefined;
}

function tokenLine(resolved: ResolvedTheme, token: TokenDef): string {
  const light = modeValue(resolved, token.name, 'light');
  const dark = modeValue(resolved, token.name, 'dark');
  const values = light === dark ? `both modes: ${light}` : `light: ${light}; dark: ${dark}`;
  const options = token.options ? ` options: ${token.options.join(' | ')};` : '';
  return `${token.name} — ${token.label} (${token.type}, ${token.tier}, group ${token.group});${options} ${values}`;
}

// ============================================================================
// The draft

/**
 * The draft as Calliope reads it: what it sets, its primitives and choices,
 * its fonts and images by name, its issues and failing contrast pairs, and
 * its stylesheet. `part: 'css'` returns only the stylesheet, with a larger cap.
 */
export function renderDraft(draft: AssistDraft, options: { part?: 'all' | 'css' } = {}): string {
  if (options.part === 'css') return renderStylesheet(draft.css, RENDER_LIMITS.cssAlone);
  const resolved = resolveTheme(draft.tokens, CLIENT_REGISTRY_VIEW);
  const out: string[] = [`# Draft "${draft.name}" (id ${draft.id})`];
  const description = typeof draft.manifest?.description === 'string' ? draft.manifest.description : '';
  if (description) out.push(`Description: ${clip(description, 400)}`);

  const choices = THEME_CHOICES.map((c) => `${c.name} = ${resolved.choices[c.name]}${draft.tokens.choices[c.name] ? '' : ' (default)'} (options: ${c.options.join(', ')})`);
  out.push('', '## Choices', ...choices);

  const primitives = Object.entries(draft.tokens.primitives).sort(([a], [b]) => a.localeCompare(b));
  out.push('', `## Primitives (${primitives.length})`);
  if (primitives.length === 0) out.push('None.');
  for (const [name, p] of primitives) out.push(`${name} (${primitiveVar(name)}, ${p.type}): ${clip(p.value)}${p.dark !== undefined ? `; dark: ${clip(p.dark)}` : ''}`);

  const set = Object.keys(draft.tokens.tokens).sort();
  out.push('', `## Tokens this theme sets (${set.length}; every other token is at its default)`);
  if (set.length === 0) out.push('None: the draft is the house default.');
  for (const name of set.slice(0, RENDER_LIMITS.setTokens)) {
    const def = TOKENS_BY_NAME.get(name);
    const { value, dark } = tokenModes(draft.tokens.tokens[name]);
    out.push(`${name}${def ? ` — ${def.label}` : ' (not a registry token)'}: ${clip(value)}${dark !== undefined ? `; dark: ${clip(dark)}` : ''}`);
  }
  if (set.length > RENDER_LIMITS.setTokens) out.push(`…and ${set.length - RENDER_LIMITS.setTokens} more; look them up by name.`);

  const resources = draftResources(draft.manifest, draft.images.map((path) => ({ path, url: null })));
  out.push('', '## Fonts and images in the draft (usable by name; you cannot add or change them)');
  out.push(resources.fonts.length > 0 ? `Fonts: ${resources.fonts.map((f) => `"${f.family}" (weights ${f.weights.join(', ')}; ${f.styles.join(', ')})`).join('; ')}` : 'Fonts: none of its own (system fonts only).');
  out.push(resources.images.length > 0 ? `Images: ${resources.images.map((i) => i.path).join(', ')}` : 'Images: none.');

  const errors = draft.issues.filter((i) => i.severity === 'error');
  const warnings = draft.issues.filter((i) => i.severity === 'warning' && !i.message.startsWith('contrast ('));
  out.push('', `## Issues (${errors.length} errors, ${warnings.length} other warnings)`);
  const listed = [...errors.map((i) => `error: ${i.message}`), ...warnings.map((i) => `warning: ${i.message}`)];
  if (listed.length === 0) out.push('None.');
  out.push(...listed.slice(0, RENDER_LIMITS.issues).map((l) => clip(l, 300)));
  if (listed.length > RENDER_LIMITS.issues) out.push(`…and ${listed.length - RENDER_LIMITS.issues} more.`);

  const failing = checkContrast(resolved).filter((f) => f.status === 'fail');
  out.push('', `## Contrast pairs that fail (${failing.length})`);
  if (failing.length === 0) out.push('None.');
  for (const f of failing.slice(0, RENDER_LIMITS.contrast)) {
    out.push(`${f.mode}: ${f.pair.foreground} (${f.foreground}) on ${f.pair.background} (${f.background}) is ${f.ratio}:1; ${f.pair.kind} needs ${f.threshold}:1`);
  }
  if (failing.length > RENDER_LIMITS.contrast) out.push(`…and ${failing.length - RENDER_LIMITS.contrast} more.`);

  out.push('', renderStylesheet(draft.css, RENDER_LIMITS.cssInOverview));
  return out.join('\n');
}

function renderStylesheet(css: string | null, cap: number): string {
  if (css === null) return '## Stylesheet\nThe draft has no stylesheet. A proposal may write one with set-css.';
  if (css.trim() === '') return '## Stylesheet\nThe draft has a stylesheet, and it is empty.';
  const lines = css.split('\n').length;
  if (css.length <= cap) return `## Stylesheet (${lines} lines)\n\`\`\`css\n${css}\n\`\`\``;
  return `## Stylesheet (${lines} lines; the first ${cap} of ${css.length} characters — read the stylesheet on its own for all of it)\n\`\`\`css\n${css.slice(0, cap)}\n\`\`\``;
}

// ============================================================================
// Tokens

export interface TokenQuery {
  /** Words matched against a token's label, name and description. */
  query?: string;
  /** Exact registry names. */
  names?: readonly string[];
  /** A group id or a word in its label. */
  group?: string;
  type?: TokenType;
  /** Only tokens the draft sets. */
  setOnly?: boolean;
}

/** Registry tokens answering `query`. Internal tokens are found only by name. */
export function lookupTokens(query: TokenQuery, tokens: ThemeTokensDocument): TokenDef[] {
  const names = new Set(query.names ?? []);
  const group = query.group?.trim().toLowerCase();
  const words = (query.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = !!(group || query.type || words.length > 0 || query.setOnly);
  return THEME_TOKENS.filter((t) => {
    if (names.has(t.name)) return true;
    if (!filtered) return false;
    if (t.visibility === 'internal') return false;
    if (group && t.group !== group && !(GROUP_LABEL.get(t.group) ?? '').toLowerCase().includes(group)) return false;
    if (query.type && t.type !== query.type) return false;
    if (query.setOnly && tokens.tokens[t.name] === undefined) return false;
    return words.every((w) => matchesQuery(t, w));
  });
}

/** Tokens with the draft's value in force in each mode. */
export function renderTokenLookup(draft: AssistDraft, found: readonly TokenDef[]): string {
  if (found.length === 0) return 'No registry token matches. Try fewer or other words, a group, or a type.';
  const resolved = resolveTheme(draft.tokens, CLIENT_REGISTRY_VIEW);
  const shown = found.slice(0, RENDER_LIMITS.tokenMatches);
  const out = [`${found.length} token${found.length === 1 ? '' : 's'}${found.length > shown.length ? `; the first ${shown.length}` : ''}:`];
  for (const t of shown) {
    out.push(tokenLine(resolved, t));
    if (t.description) out.push(`  ${clip(t.description, 240)}`);
  }
  if (found.length > shown.length) out.push(`…and ${found.length - shown.length} more; narrow the search.`);
  return out.join('\n');
}

// ============================================================================
// Hooks

export interface HookQuery {
  /** Words matched against a hook's label, class and description. */
  query?: string;
  /** Exact classes (`qt-chat-message`). */
  classes?: readonly string[];
  surface?: HookSurface;
}

/** Catalogue hooks answering `query`. */
export function lookupHooks(query: HookQuery): HookDef[] {
  const classes = new Set((query.classes ?? []).map((c) => c.replace(/^\./, '')));
  const words = (query.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return HOOKS.filter((h) => {
    if (classes.has(h.className)) return true;
    if (words.length === 0 && !query.surface) return false;
    if (query.surface && h.surface !== query.surface) return false;
    const text = `${h.label} ${h.className} ${h.description ?? ''} ${HOOK_SURFACE_TITLES[h.surface]}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

function hookVariantsText(hook: HookDef): string[] {
  const out: string[] = [];
  for (const v of hook.variants ?? []) out.push(`variant ${v.attribute}: ${v.values === 'open' ? '(any value)' : v.values.join(', ')}${v.description ? ` — ${v.description}` : ''}`);
  for (const s of hook.states ?? []) out.push(s.kind === 'class' ? `state "${s.label}": class .${s.className}` : `state "${s.label}": [${s.attribute}] = ${s.values.join(' | ')}`);
  return out;
}

/** What one property of a hook reads, with the draft's values: `background ← --qt-x-bg: #fff [default]`. */
function propertyText(resolved: ResolvedTheme, property: { property: string; vars: readonly string[]; literal?: true }): string {
  const parts = property.vars.map((v) => {
    const name = registryNameOf(v);
    if (!name) return `${v} (the app's own, not a theme token)`;
    const label = name === v ? v : `${v} → ${name}`;
    const light = modeValue(resolved, name, 'light');
    const dark = modeValue(resolved, name, 'dark');
    return light === dark ? `${label}: ${light}` : `${label}: light ${light}; dark ${dark}`;
  });
  if (property.literal) parts.push(property.vars.length > 0 ? 'or a fixed value in the app' : 'a fixed value in the app (only custom CSS changes it)');
  return `${property.property} ← ${parts.join('; ')}`;
}

/** Hooks with their variants, states and styled-by rows joined to the draft's values. */
export function renderHookLookup(draft: AssistDraft, found: readonly HookDef[]): string {
  if (found.length === 0) return 'No catalogued hook matches. Try fewer or other words, or a surface.';
  const resolved = resolveTheme(draft.tokens, CLIENT_REGISTRY_VIEW);
  const full = found.slice(0, RENDER_LIMITS.hookMatches);
  const out = [`${found.length} hook${found.length === 1 ? '' : 's'}${found.length > full.length ? `; the first ${full.length} in full` : ''}:`];
  for (const hook of full) {
    out.push('', `## .${hook.className} — ${hook.label} (${HOOK_SURFACE_TITLES[hook.surface]})`);
    if (hook.description) out.push(clip(hook.description, 300));
    if (hook.within?.length) out.push(`inside: ${hook.within.map((c) => `.${c}`).join(', ')}`);
    out.push(...hookVariantsText(hook));
    const rows = styledBy(hook.className);
    if (rows.length === 0) {
      out.push('Styled by: no app stylesheet rule selects it (its look comes from utility classes in the markup or from what it contains); custom CSS is the way to change it.');
      continue;
    }
    for (const row of rows) {
      out.push(`Styled by${row.when ? ` (${row.when})` : ''}:`);
      for (const p of row.properties) out.push(`  ${propertyText(resolved, p)}`);
    }
  }
  const rest = found.slice(full.length, full.length + RENDER_LIMITS.hookNamesOnly);
  if (rest.length > 0) out.push('', `Also matching (look up by class for detail): ${rest.map((h) => `.${h.className} (${h.label})`).join(', ')}`);
  const beyond = found.length - full.length - rest.length;
  if (beyond > 0) out.push(`…and ${beyond} more; narrow the search.`);
  return out.join('\n');
}

// ============================================================================
// Contrast

/**
 * What to measure: a registry pair by its id (`theme-foreground/theme-background`),
 * or two colours — each a token or custom property (`--theme-primary`, a
 * Tailwind `--color-*` name) or a colour literal (`#1a1a2e`, `oklch(…)`).
 */
export interface ContrastQuery {
  pair?: string;
  foreground?: string;
  background?: string;
  /** `text` needs 4.5:1, `non-text` 3:1. A registry pair carries its own. */
  kind?: ContrastKind;
}

export type ContrastCheck =
  | { ok: true; pair: ContrastPair; registered: boolean; findings: ContrastFinding[] }
  | { ok: false; reason: string };

const PAIRS_BY_ID = new Map(CONTRAST_PAIRS.map((p) => [p.id, p]));
const CHECK_FOREGROUND = '--calliope-check-foreground' as const;
const CHECK_BACKGROUND = '--calliope-check-background' as const;

/**
 * A side of the pair as the check names it: a custom property stands for
 * itself (a Tailwind name for its semantic token); a literal is placed in
 * both modes under a name of its own.
 */
function sideOf(value: string, literalName: `--${string}`, resolved: ResolvedTheme): `--${string}` {
  const trimmed = value.trim();
  if (trimmed.startsWith('--')) return (registryNameOf(trimmed) ?? trimmed) as `--${string}`;
  for (const mode of ['light', 'dark'] as const) resolved[mode][literalName] = { value: trimmed, source: 'theme' };
  return literalName;
}

/** Measure one pair against the draft in light and dark, as the engine's check does. */
export function checkDraftContrast(draft: AssistDraft, query: ContrastQuery): ContrastCheck {
  const resolved = resolveTheme(draft.tokens, CLIENT_REGISTRY_VIEW);
  if (query.pair) {
    const pair = PAIRS_BY_ID.get(query.pair.trim().replace(/^--/, ''));
    if (!pair) return { ok: false, reason: `No registry contrast pair is called "${clip(query.pair, 80)}". Name the two colours instead.` };
    return { ok: true, pair, registered: true, findings: checkContrast(resolved, [pair]) };
  }
  if (!query.foreground || !query.background) return { ok: false, reason: 'Name a registry pair, or both a foreground and a background.' };
  const foreground = sideOf(query.foreground, CHECK_FOREGROUND, resolved);
  const background = sideOf(query.background, CHECK_BACKGROUND, resolved);
  const registeredPair = CONTRAST_PAIRS.find((p) => p.foreground === foreground && p.background === background);
  const kind = query.kind ?? registeredPair?.kind ?? 'text';
  const pair: ContrastPair = { id: 'calliope-check', foreground, background, kind };
  return { ok: true, pair, registered: !!registeredPair, findings: checkContrast(resolved, [pair]) };
}

function contrastSideText(name: string, query: string | undefined): string {
  return name === CHECK_FOREGROUND || name === CHECK_BACKGROUND ? clip(query ?? '', 80) : name;
}

/** A contrast check in words: each mode's ratio against the threshold. */
export function renderContrastCheck(query: ContrastQuery, check: ContrastCheck): string {
  if (!check.ok) return check.reason;
  const fg = contrastSideText(check.pair.foreground, query.foreground);
  const bg = contrastSideText(check.pair.background, query.background);
  const out = [
    `${fg} on ${bg} (${check.pair.kind}, needs ${check.findings[0]?.threshold ?? ''}:1)${check.registered ? ' — a registry pair the editor checks' : ''}:`,
  ];
  for (const f of check.findings) {
    const values = f.foreground && f.background ? ` (${clip(f.foreground, 60)} on ${clip(f.background, 60)})` : '';
    if (f.status === 'unchecked') out.push(`${f.mode}: not checked — ${f.reason}${values}`);
    else out.push(`${f.mode}: ${f.ratio}:1, ${f.status === 'pass' ? 'passes' : 'FAILS'}${values}`);
  }
  return out.join('\n');
}
