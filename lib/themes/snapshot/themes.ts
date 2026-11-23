/**
 * The theme snapshot's inputs: which themes, which modes, and what CSS each
 * one puts on the page after the app's own stylesheet.
 *
 * A theme's injected CSS is what the engine compiled for it, in injector
 * order (`theme-style-injector.tsx`); font faces are left out, since they
 * declare no custom property on the root element. The default theme injects
 * nothing: the app's generated defaults are its values.
 *
 * @module themes/snapshot/themes
 */

import path from 'node:path';
import { loadBundledThemesFromDir } from '../bundle-loader';
import { renderAlike } from '../color';
import type { CompiledTheme } from '../engine/compile';
import { THEME_CHOICES } from '../registry/choices';
import { THEME_FEATURE_ATTRIBUTES } from '@/components/providers/theme/theme-utils';
import { resolveRootVariables, type CascadeResult, type CascadeSheet } from './cascade';
import type { RootElementState } from './selector-match';

export const SNAPSHOT_MODES = ['light', 'dark'] as const;
export type SnapshotMode = (typeof SNAPSHOT_MODES)[number];

/** Repo-relative directory of the bundled themes. */
export const BUNDLED_THEMES_DIR = 'themes/bundled';

/** Repo-relative directory the fixtures live in. */
export const SNAPSHOT_FIXTURES_DIR = '__tests__/unit/lib/themes/fixtures/snapshots';

/** Custom properties left out of the snapshot: Tailwind's per-element internals. */
const EXCLUDED_PREFIXES = ['--tw-'];

/** Repo-relative path of the app's Tailwind token map (`@theme inline`). */
export const THEME_TOKENS_CSS = 'app/styles/theme-tokens.css';

/**
 * Names the app's `@theme` blocks declare. Every other variable whose winning
 * declaration sits in Tailwind's `theme` layer is one of Tailwind's own
 * defaults (`--color-red-500`, `--spacing`, …), emitted because some class
 * uses it; those are used to resolve references but left out of the output,
 * so adding a utility class somewhere does not churn the fixtures.
 */
export function appThemeNames(themeTokensCss: string): Set<string> {
  const names = new Set<string>();
  for (const block of themeTokensCss.matchAll(/@theme[^{]*\{([\s\S]*?)\}/g)) {
    for (const m of block[1].matchAll(/(--[\w-]+)\s*:/g)) names.add(m[1]);
  }
  return names;
}

export interface SnapshotTheme {
  id: string;
  /** CSS injected after the app stylesheet, in injector order. */
  sheets: CascadeSheet[];
  /** Extra attributes on <html> (the theme's choices and features). */
  rootAttributes?: Record<string, string>;
}

export interface ThemeSnapshot {
  theme: string;
  mode: SnapshotMode;
  variables: Record<string, string>;
  errors: string[];
}

/** The state `<html>` is in for a theme and mode (see app/layout.tsx and applyThemeToDom). */
export function rootStateFor(themeId: string, mode: SnapshotMode): RootElementState {
  return {
    attributes: {
      lang: 'en',
      'data-scroll-behavior': 'smooth',
      'data-theme': themeId,
      'data-color-mode': mode,
    },
    classes: [mode],
  };
}

/**
 * The attributes `applyThemeToDom` puts on <html> for a compiled theme: each feature it switches on, and each choice set to a non-default
 * option.
 */
export function themeRootAttributes(compiled: CompiledTheme): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const [feature, attribute] of Object.entries(THEME_FEATURE_ATTRIBUTES) as Array<[keyof CompiledTheme['features'], string]>) {
    if (compiled.features[feature]) attributes[attribute] = '';
  }
  for (const choice of THEME_CHOICES) {
    const option = compiled.choices[choice.name];
    if (option && option !== choice.default) attributes[`data-qt-${choice.name}`] = option;
  }
  return attributes;
}

/** What the injector writes for a compiled theme, as snapshot sheets. */
export function themeSheets(compiled: CompiledTheme): CascadeSheet[] {
  return [
    { origin: 'theme:tokens', css: compiled.css.tokens },
    { origin: 'theme:icons', css: compiled.css.icons },
    { origin: 'theme:custom', css: compiled.css.custom },
  ].filter((sheet) => sheet.css.trim().length > 0);
}

/** The default theme plus every bundle under `themes/bundled`, sorted by id. */
export async function loadSnapshotThemes(root: string): Promise<SnapshotTheme[]> {
  const themes: SnapshotTheme[] = [{ id: 'default', sheets: [] }];
  const { loaded } = await loadBundledThemesFromDir(path.join(root, BUNDLED_THEMES_DIR));
  for (const bundle of loaded) {
    themes.push({ id: bundle.manifest.id, sheets: themeSheets(bundle.compiled), rootAttributes: themeRootAttributes(bundle.compiled) });
  }
  return themes.sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.id.localeCompare(b.id)));
}

/** Resolve one theme in one mode on top of the compiled app CSS. */
export function snapshotTheme(
  appCss: string,
  theme: SnapshotTheme,
  mode: SnapshotMode,
  appThemeVariables: Set<string>
): ThemeSnapshot {
  const root = rootStateFor(theme.id, mode);
  Object.assign(root.attributes, theme.rootAttributes ?? {});
  const result: CascadeResult = resolveRootVariables([{ origin: 'app/globals.css (compiled)', css: appCss }, ...theme.sheets], root);
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.values)) {
    if (EXCLUDED_PREFIXES.some((p) => name.startsWith(p))) continue;
    if (result.winningLayer[name] === 'theme' && !appThemeVariables.has(name)) continue;
    variables[name] = value;
  }
  return { theme: theme.id, mode, variables, errors: result.errors };
}

export function snapshotFileName(themeId: string, mode: SnapshotMode): string {
  return `${themeId}.${mode}.json`;
}

/** Stable JSON for a fixture file. */
export function serialiseSnapshot(snapshot: ThemeSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

export interface SnapshotComparison {
  /** Names in both whose values do not render alike: `name: expected -> actual`. */
  changed: string[];
  /** Names only in the actual snapshot. */
  added: string[];
  /** Names only in the expected snapshot. */
  removed: string[];
}

/**
 * Compare a recorded snapshot with a fresh one. A value counts as unchanged
 * when it renders alike (`renderAlike`: the same text with the same colours,
 * to 8-bit RGBA) — so re-expressing a literal colour as a formula that yields
 * the same colour is not a change, which is what lets Spec A Stage 2 derive
 * component tokens from semantic ones under this guard.
 */
export function compareSnapshots(expected: Record<string, string>, actual: Record<string, string>): SnapshotComparison {
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [name, value] of Object.entries(expected)) {
    if (!(name in actual)) removed.push(name);
    else if (!renderAlike(value, actual[name])) changed.push(`${name}: ${value} -> ${actual[name]}`);
  }
  const added = Object.keys(actual).filter((name) => !(name in expected));
  return { changed, added, removed };
}

/**
 * The recorded variables plus the names `actual` adds, keeping every recorded
 * string as it was. Used by `theme-snapshot.ts --add`.
 */
export function mergeAddedVariables(expected: Record<string, string>, actual: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = { ...expected };
  for (const [name, value] of Object.entries(actual)) if (!(name in merged)) merged[name] = value;
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
