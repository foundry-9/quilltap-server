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
import { isConciergeOffDuty } from './chat-override'

/**
 * Resolved dangerous content settings
 */
export interface ResolvedDangerousContentSettings {
  /** The effective settings */
  settings: DangerousContentSettings
  /** Where the settings came from */
  source: 'global' | 'default' | 'chat-off-duty'
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
 * Settings forced when the operator has flipped a chat Off-duty. Everything
 * the Concierge would normally do is disabled, while still returning a
 * concrete `DangerousContentSettings` so callers don't have to special-case
 * the shape.
 */
export const OFF_DUTY_DANGEROUS_CONTENT_SETTINGS: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 1.0,
  scanTextChat: false,
  scanImagePrompts: false,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: false,
}

/**
 * Resolve the effective dangerous content settings.
 *
 * When `chat` is supplied and the operator has flipped that chat Off-duty,
 * the returned settings collapse to `mode: 'OFF'` with every scan disabled
 * regardless of the global setting. That keeps the override decision in one
 * place: callers that already gate behavior on `dangerSettings.mode !== 'OFF'`
 * pick up the override for free.
 *
 * Otherwise, currently uses global ChatSettings only.
 * Future: cascade through Global -> Project -> Chat (like agent mode).
 *
 * @param globalSettings - The global chat settings (has dangerousContentSettings)
 * @param chat - Optional chat for per-chat override consideration
 */
export function resolveDangerousContentSettings(
  globalSettings: ChatSettings | null,
  chat?: { conciergeOverride?: 'OFF' | null } | null
): ResolvedDangerousContentSettings {
  if (chat && isConciergeOffDuty(chat)) {
    return {
      settings: OFF_DUTY_DANGEROUS_CONTENT_SETTINGS,
      source: 'chat-off-duty',
    }
  }

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
