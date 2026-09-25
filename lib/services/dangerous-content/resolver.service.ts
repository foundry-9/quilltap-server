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
import { isModerationExemptChatType } from '@/lib/schemas/chat.types'
import { getConciergeState, type ConciergeState } from './chat-override'

/**
 * Resolved dangerous content settings
 */
export interface ResolvedDangerousContentSettings {
  /** The effective settings */
  settings: DangerousContentSettings
  /** Where the settings came from */
  source: 'global' | 'default' | 'chat-locked' | 'chat-unmoderated' | 'chat-type-exempt'
}

/**
 * Stated moderation refusals on a Moderated chat before the Concierge switches
 * it to Unmoderated, when the setting is absent. Mirrors the schema default.
 */
export const DEFAULT_AUTO_SWITCH_AFTER_REFUSALS = 2

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
  autoSwitchAfterRefusals: DEFAULT_AUTO_SWITCH_AFTER_REFUSALS,
}

/**
 * Settings forced on a Locked chat, and on the chat types the Concierge has no
 * standing on (Help Chat, Brahma Console). Everything the Concierge would
 * normally do is disabled — no scans, no reroute, no auto-switch — while still
 * returning a concrete `DangerousContentSettings` so callers don't have to
 * special-case the shape. Deliberately carries no uncensored profile IDs: a
 * Locked chat rides the ordinary providers only.
 */
export const LOCKED_DANGEROUS_CONTENT_SETTINGS: DangerousContentSettings = {
  mode: 'OFF',
  threshold: 1.0,
  scanTextChat: false,
  scanImagePrompts: false,
  scanImageGeneration: false,
  displayMode: 'SHOW',
  showWarningBadges: false,
  autoSwitchAfterRefusals: 0,
}

/**
 * Resolve the effective dangerous content settings.
 *
 * When `chat` is supplied, its Concierge state shapes the result, so callers
 * that gate behaviour on `settings.mode` pick the state up for free:
 *
 *   - exempt chat type (help, brahma) → {@link LOCKED_DANGEROUS_CONTENT_SETTINGS}
 *   - Locked      → {@link LOCKED_DANGEROUS_CONTENT_SETTINGS}
 *   - Unmoderated → the *global* settings (so the configured uncensored
 *     profile IDs ride through) with `mode: 'AUTO_ROUTE'` forced and every
 *     scan off — the verdict is already in, so there is nothing to classify.
 *     Forcing AUTO_ROUTE even under a global `OFF` is deliberate: asking for
 *     the uncensored desk on one chat should not first require flipping a
 *     global switch.
 *   - Moderated   → the global settings (or the defaults).
 *
 * @param globalSettings - The global chat settings (has dangerousContentSettings)
 * @param chat - Optional chat whose Concierge state applies
 */
export function resolveDangerousContentSettings(
  globalSettings: ChatSettings | null,
  chat?: { conciergeMode?: ConciergeState | null; chatType?: string | null } | null
): ResolvedDangerousContentSettings {
  // Help Chats and the Brahma Console are never moderated — the Concierge has
  // no standing on those surfaces at all, regardless of the global setting.
  if (chat && isModerationExemptChatType(chat.chatType)) {
    return {
      settings: LOCKED_DANGEROUS_CONTENT_SETTINGS,
      source: 'chat-type-exempt',
    }
  }

  const state = chat ? getConciergeState(chat) : 'moderated'

  if (state === 'locked') {
    return {
      settings: LOCKED_DANGEROUS_CONTENT_SETTINGS,
      source: 'chat-locked',
    }
  }

  if (state === 'unmoderated') {
    const global = globalSettings?.dangerousContentSettings ?? DEFAULT_DANGEROUS_CONTENT_SETTINGS
    return {
      settings: {
        ...global,                    // carries uncensoredImageProfileId / uncensoredTextProfileId
        mode: 'AUTO_ROUTE',           // the verdict is already in
        threshold: 1.0,               // nothing left to classify
        scanTextChat: false,
        scanImagePrompts: false,
        scanImageGeneration: false,
        showWarningBadges: false,
      },
      source: 'chat-unmoderated',
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
