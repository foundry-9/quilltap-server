/**
 * Themes made for an earlier Quilltap, recognised only to be refused.
 *
 * Quilltap loads version 2 `.qtap-theme` bundles and nothing else. A version 1
 * bundle found among the installed themes, or a theme declared by a plugin, is
 * not registered: it is recorded here so the Appearance card can say what
 * happened and offer to uninstall it. Nothing is deleted on the operator's
 * behalf. Install refuses the same bundles with the same message before
 * anything is written.
 *
 * Client-safe: no file or registry access.
 *
 * @module themes/refused
 */

/** The one theme format this Quilltap reads. */
export const CURRENT_THEME_FORMAT_VERSION = 2;

/** Why a theme was turned away. */
export type ThemeRefusalReason = 'earlier-format' | 'plugin-theme';

/** A theme that was found but not registered. */
export interface RefusedTheme {
  id: string;
  name: string;
  version: string;
  reason: ThemeRefusalReason;
  /** Where it came from: an installed bundle (uninstallable here) or a plugin. */
  source: 'bundle' | 'plugin';
  /** For a plugin theme, the plugin that declared it. */
  pluginName?: string;
  /** The operator-facing explanation. */
  message: string;
}

/** The explanation shown wherever an earlier theme is refused. */
export function earlierThemeMessage(name: string): string {
  return `“${name}” was tailored for an earlier Quilltap, and the present establishment can no longer wear it. The Themes help page explains how such a garment may be remade.`;
}

/**
 * The formatVersion a raw theme.json declares, or undefined when it names
 * none (or names it as something other than a number).
 */
export function declaredFormatVersion(manifestJson: unknown): number | undefined {
  if (!manifestJson || typeof manifestJson !== 'object') return undefined;
  const v = (manifestJson as { formatVersion?: unknown }).formatVersion;
  return typeof v === 'number' ? v : undefined;
}

function stringField(json: unknown, key: string): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const v = (json as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * A refusal for a raw theme.json that declares a format earlier than this
 * Quilltap reads, or null when it declares the current one (or none at all —
 * that is an invalid bundle, reported by validation, not an earlier theme).
 */
export function refusalForManifest(manifestJson: unknown, fallbackId: string): RefusedTheme | null {
  const formatVersion = declaredFormatVersion(manifestJson);
  if (formatVersion === undefined || formatVersion >= CURRENT_THEME_FORMAT_VERSION) return null;
  const id = stringField(manifestJson, 'id') ?? fallbackId;
  const name = stringField(manifestJson, 'name') ?? id;
  return {
    id,
    name,
    version: stringField(manifestJson, 'version') ?? 'unknown',
    reason: 'earlier-format',
    source: 'bundle',
    message: earlierThemeMessage(name),
  };
}

/** The error install raises for an earlier theme; carries the refusal. */
export class EarlierThemeFormatError extends Error {
  constructor(readonly refusal: RefusedTheme) {
    super(refusal.message);
    this.name = 'EarlierThemeFormatError';
  }
}
