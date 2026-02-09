/**
 * Dangerous Content Settings Resolver Service
 *
 * Resolves the effective dangerous content settings.
 * Currently global-only (from ChatSettings). Ready for future per-chat/project cascade.
 *
 * Follows the same resolver pattern as agent-mode-resolver.service.ts.
 */

import type { ChatSettings } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

/**
 * Resolved dangerous content settings
 */
export interface ResolvedDangerousContentSettings {
  /** The effective settings */
  settings: DangerousContentSettings
  /** Where the settings came from */
  source: 'global' | 'default'
}

/**
 * Default dangerous content settings when not configured
 */
export const DEFAULT_DANGEROUS_CONTENT_SETTINGS: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 0.7,
  scanTextChat: true,
  scanImagePrompts: true,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: true,
}

/**
 * Resolve the effective dangerous content settings
 *
 * Currently uses global ChatSettings only.
 * Future: cascade through Global -> Project -> Chat (like agent mode).
 *
 * @param globalSettings - The global chat settings (has dangerousContentSettings)
 * @returns The resolved settings
 */
export function resolveDangerousContentSettings(
  globalSettings: ChatSettings | null
): ResolvedDangerousContentSettings {
  if (globalSettings?.dangerousContentSettings) {
    return {
      settings: globalSettings.dangerousContentSettings,
      source: 'global',
    }
  }

  return {
    settings: DEFAULT_DANGEROUS_CONTENT_SETTINGS,
    source: 'default',
  }
}
