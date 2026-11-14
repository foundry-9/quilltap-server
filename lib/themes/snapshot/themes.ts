/**
 * The theme snapshot's inputs: which themes, which modes, and what CSS each
 * one puts on the page after the app's own stylesheet.
 *
 * A theme's injected CSS is built the way `theme-style-injector.tsx` builds
 * it — token CSS from `themeTokensToCSS`, then the bundle's `styles.css`.
 * Font faces and icon overrides are left out: neither declares a custom
 * property on the root element.
 *
 * @module themes/snapshot/themes
 */

import path from 'node:path';
import { loadBundledThemesFromDir } from '../bundle-loader';
import { DEFAULT_THEME_TOKENS } from '../default-tokens';
import { mergeThemeTokens, themeTokensToCSS } from '../utils';
import { renderAlike } from '../color';
import type { CompiledThemeV2 } from '../engine/compile';
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

/** What the injector writes for a compiled version 2 theme, as snapshot sheets. */
export function v2Sheets(compiled: CompiledThemeV2): CascadeSheet[] {
  return [
    { origin: 'v2:tokens', css: compiled.css.tokens },
    { origin: 'v2:icons', css: compiled.css.icons },
    { origin: 'v2:custom', css: compiled.css.custom },
  ].filter((sheet) => sheet.css.trim().length > 0);
}

/** The default theme plus every bundle under `themes/bundled`, sorted by id. */
export async function loadSnapshotThemes(root: string): Promise<SnapshotTheme[]> {
  const themes: SnapshotTheme[] = [
    { id: 'default', sheets: [{ origin: 'injected:default:tokens', css: themeTokensToCSS(DEFAULT_THEME_TOKENS) }] },
  ];
  const bundles = await loadBundledThemesFromDir(path.join(root, BUNDLED_THEMES_DIR));
  for (const bundle of bundles) {
    const id = bundle.manifest.id;
    if (bundle.formatVersion === 2) {
      themes.push({ id, sheets: v2Sheets(bundle.v2.compiled) });
      continue;
    }
    // Bundled themes do not use extendsTheme; mirror the registry if one ever does.
    const tokens = bundle.manifest.extendsTheme ? mergeThemeTokens(DEFAULT_THEME_TOKENS, bundle.tokens) : bundle.tokens;
    const sheets: CascadeSheet[] = [{ origin: `injected:${id}:tokens`, css: themeTokensToCSS(tokens) }];
    if (bundle.cssOverrides) sheets.push({ origin: `bundle:${id}/styles.css`, css: bundle.cssOverrides });
    themes.push({ id, sheets });
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
  const result: CascadeResult = resolveRootVariables(
    [{ origin: 'app/globals.css (compiled)', css: appCss }, ...theme.sheets],
    rootStateFor(theme.id, mode)
  );
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
