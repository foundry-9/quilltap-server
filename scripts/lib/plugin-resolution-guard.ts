/**
 * Plugin resolution guard (#145).
 *
 * A plugin's typecheck can pass on the wrong copy of a dependency: when the
 * plugin's own `node_modules/<pkg>` lacks a subpath, TypeScript walks up and
 * resolves it from the repository root's copy instead. That is how a removed
 * `@openrouter/sdk/lib/chat-compat` compiled against the root's older SDK and
 * surfaced only as a confusing cross-copy TS2345.
 *
 * This module reads `tsc --explainFiles` output and flags every file that
 * belongs to a package the plugin lists in its own `dependencies` but was
 * resolved from outside the plugin's own `node_modules`. Pure: no I/O.
 */

import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface ResolutionViolation {
  /** The package the plugin depends on. */
  packageName: string;
  /** The file tsc resolved, as tsc printed it. */
  resolvedPath: string;
  /** Where that package should have resolved from. */
  expectedRoot: string;
}

/**
 * The package a resolved file belongs to: the segment(s) after the *last*
 * `node_modules/` in its path (two segments for a scoped package).
 */
export function packageNameFromPath(filePath: string): string | null {
  const normalized = filePath.split(sep).join('/');
  const marker = 'node_modules/';
  const idx = normalized.lastIndexOf(marker);
  if (idx === -1) return null;
  const parts = normalized.slice(idx + marker.length).split('/');
  if (parts[0]?.startsWith('@')) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] || null;
}

/**
 * Classify `tsc --explainFiles` output for one plugin. File lines are the
 * unindented ones; the indented "Imported via …" lines that follow are skipped.
 * Paths are relative to `pluginDir` (tsc prints them relative to its cwd).
 */
export function findForeignResolutions(
  explainOutput: string,
  pluginDir: string,
  dependencies: Iterable<string>,
): ResolutionViolation[] {
  const deps = new Set(dependencies);
  const ownModules = resolve(pluginDir, 'node_modules');
  const violations: ResolutionViolation[] = [];
  const seen = new Set<string>();

  for (const rawLine of explainOutput.split('\n')) {
    if (!rawLine || /^\s/.test(rawLine)) continue;
    const line = rawLine.trim();
    const packageName = packageNameFromPath(line);
    if (!packageName || !deps.has(packageName)) continue;

    const absolute = isAbsolute(line) ? line : resolve(pluginDir, line);
    const rel = relative(ownModules, absolute);
    const insideOwn = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
    if (insideOwn) continue;

    if (seen.has(line)) continue;
    seen.add(line);
    violations.push({ packageName, resolvedPath: line, expectedRoot: resolve(ownModules, packageName) });
  }

  return violations;
}

/** One human-readable message naming the plugin, the package and both paths. */
export function formatResolutionViolations(pluginName: string, violations: ResolutionViolation[]): string {
  const SHOWN = 5;
  const lines = violations.slice(0, SHOWN).map(
    (v) => `  ${v.packageName}: resolved ${v.resolvedPath} from outside the plugin, not ${v.expectedRoot}`,
  );
  if (violations.length > SHOWN) {
    lines.push(`  … and ${violations.length - SHOWN} more`);
  }
  return [
    `${pluginName} typechecked against a dependency copy outside its own node_modules`,
    '(a subpath missing from the plugin\'s copy was found in the repository root instead):',
    ...lines,
  ].join('\n');
}
