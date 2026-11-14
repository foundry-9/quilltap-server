/**
 * Version 2 theme bundles on disk: read a bundle directory, validate it with
 * the theme engine and compile it (Calliope Live, Spec A Stage 3.4).
 *
 * The engine is pure; this is the part that touches files. Every file the
 * manifest or a `url()` names must be in the bundle's file list, which is
 * built here by walking the directory (symbolic links are not followed or
 * listed); the files that are read are resolved through `resolveInside`.
 *
 * @module themes/v2-bundle
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@/lib/logger';
import { resolveInside } from '@/lib/paths/resolve-inside';
import { ICON_REGISTRY } from '@/components/ui/icons/icon-registry';
import { DEFAULT_SUBSYSTEM_DEFINITIONS } from '@/lib/foundry/subsystem-defaults';
import { THEME_CHOICES, THEME_TOKENS } from './registry';
import {
  compileThemeV2,
  validateThemeDocument,
  type CompiledThemeV2,
  type RegistryView,
  type ThemeDocument,
  type ValidationContext,
} from './engine';

const v2Logger = logger.child({ module: 'theme-v2-bundle' });

/** The registry the engine validates and resolves against. */
export const THEME_REGISTRY_VIEW: RegistryView = { tokens: THEME_TOKENS, choices: THEME_CHOICES };

export class ThemeBundleV2Error extends Error {
  constructor(
    readonly themeDir: string,
    readonly errors: string[]
  ) {
    super(`Invalid version 2 theme bundle: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? ` (and ${errors.length - 5} more)` : ''}`);
    this.name = 'ThemeBundleV2Error';
  }
}

export interface LoadedThemeV2 {
  document: ThemeDocument;
  compiled: CompiledThemeV2;
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
 * Validate and compile the version 2 bundle in `dir`, whose theme.json has
 * already been parsed as `manifestJson`. Throws ThemeBundleV2Error listing
 * every problem.
 */
export async function loadThemeV2FromDir(dir: string, manifestJson: unknown): Promise<LoadedThemeV2> {
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
  if (errors.length > 0) throw new ThemeBundleV2Error(dir, errors);

  const result = validateThemeDocument({ manifest: manifestJson, tokens, css }, validationContextFor(files));
  if (!result.valid) {
    v2Logger.warn('Version 2 theme bundle failed validation', { dir, errorCount: result.errors.length, errors: result.errors.slice(0, 20) });
    throw new ThemeBundleV2Error(dir, result.errors);
  }

  // Files the manifest names are read later by the asset and font routes;
  // make sure each resolves inside the bundle now.
  const referenced = [
    result.document.manifest.previewImage,
    ...(result.document.manifest.fonts ?? []).flatMap((f) => [f.src, f.licenseFile]),
    ...Object.values(result.document.manifest.icons ?? {}),
  ].filter((p): p is string => typeof p === 'string');
  for (const p of referenced) await resolveInside(dir, p, { realpath: true });

  const compiled = compileThemeV2(result.document, result.scopedCss, THEME_REGISTRY_VIEW);
  v2Logger.debug('Loaded version 2 theme bundle', {
    themeId: result.document.manifest.id,
    version: result.document.manifest.version,
    tokens: Object.keys(result.document.tokens.tokens).length,
    primitives: Object.keys(result.document.tokens.primitives).length,
    choices: compiled.choices,
    features: compiled.features,
    customCssBytes: compiled.css.custom.length,
  });
  return { document: result.document, compiled };
}
