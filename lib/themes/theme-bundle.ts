/**
 * Theme bundles on disk: read a bundle directory, validate it with the theme
 * engine and compile it.
 *
 * The engine is pure; this is the part that touches files. Every file the
 * manifest or a `url()` names must be in the bundle's file list, which is
 * built here by walking the directory (symbolic links are not followed or
 * listed); the files that are read are resolved through `resolveInside`.
 *
 * @module themes/theme-bundle
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { resolveInside } from '@/lib/paths/resolve-inside';
import { ICON_REGISTRY } from '@/components/ui/icons/icon-registry';
import { DEFAULT_SUBSYSTEM_DEFINITIONS } from '@/lib/foundry/subsystem-defaults';
import { THEME_CHOICES, THEME_TOKENS } from './registry';
import { HOOK_CATALOGUE } from './hooks';
import { lintThemeSelectors, removedHooksUsed } from './hooks/lint';
import {
  compileTheme,
  validateThemeDocument,
  type CompiledTheme,
  type RegistryView,
  type ThemeDocument,
  type ValidationContext,
} from './engine';

const bundleLogger = logger.child({ module: 'theme-bundle' });

/** The registry the engine validates and resolves against. */
export const THEME_REGISTRY_VIEW: RegistryView = { tokens: THEME_TOKENS, choices: THEME_CHOICES };

export class ThemeBundleError extends Error {
  constructor(
    readonly themeDir: string,
    readonly errors: string[]
  ) {
    super(`Invalid theme bundle: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`);
    this.name = 'ThemeBundleError';
  }
}

export interface LoadedThemeDocument {
  document: ThemeDocument;
  compiled: CompiledTheme;
  /**
   * What the theme may want to fix but that does not stop it loading: custom
   * CSS that targets selectors off the hook catalogue, or hooks removed since
   * its `hooksVersion`. Also logged; `quilltap themes validate` prints them.
   */
  warnings: string[];
}

/** Every regular file under `dir`, as bundle-relative paths with "/" separators. */
export async function listBundleFiles(dir: string): Promise<Set<string>> {
  const files = new Set<string>();
  const walk = async (rel: string) => {
    const entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true });
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.add(child);
    }
  };
  await walk('');
  return files;
}

/** The context the engine validates against for a bundle with these files. */
export function validationContextFor(files: ReadonlySet<string>): ValidationContext {
  return {
    registry: THEME_REGISTRY_VIEW,
    files,
    iconNames: new Set(Object.keys(ICON_REGISTRY)),
    subsystemIds: new Set(Object.keys(DEFAULT_SUBSYSTEM_DEFINITIONS)),
  };
}

async function readJson(dir: string, rel: string, label: string, errors: string[]): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(await resolveInside(dir, rel, { realpath: true }), 'utf-8'));
  } catch (error) {
    errors.push(`${label}: cannot be read as JSON (${(error as Error).message})`);
    return undefined;
  }
}

/**
 * Validate and compile the bundle in `dir`, whose theme.json has
 * already been parsed as `manifestJson`. Throws ThemeBundleError listing
 * every problem.
 */
export async function loadThemeFromDir(dir: string, manifestJson: unknown): Promise<LoadedThemeDocument> {
  const errors: string[] = [];
  const files = await listBundleFiles(dir);
  const manifest = (manifestJson ?? {}) as { tokensPath?: unknown; stylesPath?: unknown };
  const tokensPath = typeof manifest.tokensPath === 'string' ? manifest.tokensPath : 'tokens.json';
  const tokens = files.has(tokensPath) ? await readJson(dir, tokensPath, tokensPath, errors) : undefined;
  if (!files.has(tokensPath)) errors.push(`theme.json: tokensPath: file "${tokensPath}" is not in the bundle`);

  let css: string | undefined;
  if (typeof manifest.stylesPath === 'string' && files.has(manifest.stylesPath)) {
    try {
      css = await fs.readFile(await resolveInside(dir, manifest.stylesPath, { realpath: true }), 'utf-8');
    } catch (error) {
      errors.push(`${manifest.stylesPath}: cannot be read (${(error as Error).message})`);
    }
  }
  if (errors.length > 0) throw new ThemeBundleError(dir, errors);

  const result = validateThemeDocument({ manifest: manifestJson, tokens, css }, validationContextFor(files));
  if (!result.valid) {
    bundleLogger.warn('Theme bundle failed validation', { dir, errorCount: result.errors.length, errors: result.errors.slice(0, 20) });
    throw new ThemeBundleError(dir, result.errors);
  }

  // Files the manifest names are read later by the asset and font routes;
  // make sure each resolves inside the bundle now.
  const referenced = [
    result.document.manifest.previewImage,
    ...(result.document.manifest.fonts ?? []).flatMap((f) => [f.src, f.licenseFile]),
    ...Object.values(result.document.manifest.icons ?? {}),
  ].filter((p): p is string => typeof p === 'string');
  for (const p of referenced) await resolveInside(dir, p, { realpath: true });

  const warnings: string[] = [];
  const stylesPath = result.document.manifest.stylesPath ?? 'styles.css';
  const { hooksVersion } = result.document.manifest;
  if (css !== undefined && hooksVersion !== undefined && hooksVersion < HOOK_CATALOGUE.version) {
    const removed = removedHooksUsed(css, hooksVersion, HOOK_CATALOGUE);
    for (const hook of removed) {
      warnings.push(
        `${stylesPath}: .${hook.className} was removed from the hook catalogue in version ${hook.removedIn}` +
          (hook.replacedBy ? `; use .${hook.replacedBy}` : '')
      );
    }
    if (removed.length > 0) {
      bundleLogger.warn('Theme custom CSS uses hooks removed from the catalogue since the version it was written against', {
        themeId: result.document.manifest.id,
        hooksVersion,
        catalogueVersion: HOOK_CATALOGUE.version,
        removed: removed.map((hook) => ({ hook: hook.className, removedIn: hook.removedIn, replacedBy: hook.replacedBy })),
      });
    } else {
      bundleLogger.debug('Theme written against an older hook catalogue uses no removed hook', {
        themeId: result.document.manifest.id,
        hooksVersion,
        catalogueVersion: HOOK_CATALOGUE.version,
      });
    }
  }

  // The same selector lint that gates the bundled themes, reported here as
  // warnings: an installed theme that reaches past the hook catalogue still
  // loads, but its author is told which rules may break.
  if (css !== undefined && css.trim()) {
    const findings = lintThemeSelectors(css, HOOK_CATALOGUE);
    for (const finding of findings) {
      warnings.push(`${stylesPath}:${finding.line}: ${finding.selector} — ${finding.reasons.map((r) => r.message).join('; ')}`);
    }
    if (findings.length > 0) {
      bundleLogger.warn('Theme custom CSS targets selectors off the hook catalogue', {
        themeId: result.document.manifest.id,
        count: findings.length,
        findings: findings.slice(0, 20).map((f) => ({ line: f.line, selector: f.selector, reasons: f.reasons.map((r) => r.code) })),
      });
    }
  }

  const compiled = compileTheme(result.document, result.scopedCss, THEME_REGISTRY_VIEW);
  bundleLogger.debug('Loaded theme bundle', {
    themeId: result.document.manifest.id,
    version: result.document.manifest.version,
    tokens: Object.keys(result.document.tokens.tokens).length,
    primitives: Object.keys(result.document.tokens.primitives).length,
    choices: compiled.choices,
    features: compiled.features,
    customCssBytes: compiled.css.custom.length,
  });
  return { document: result.document, compiled, warnings };
}
