/**
 * Concierge Policy Resolver
 *
 * Turns the global `conciergeSettings` and one chat's Concierge state into the
 * effective policy for that chat. Callers ask the policy the question they
 * mean — "may a refusal be rerouted?" (`failoverAllowed`), "does this chat go
 * straight to the uncensored desk?" (`routeDirect`), "may the classifier
 * pre-screen this?" (`preScreen.*`) — rather than reading a mode.
 *
 * Replaces `resolveDangerousContentSettings` and the retired
 * OFF / DETECT_ONLY / AUTO_ROUTE mode (Concierge overhaul phase 4).
 *
 * Pure — safe in the forked job child and on the client.
 */

import type {
  ConciergeSettings,
  ConciergeDisplaySettings,
  ConciergePreScreenSettings,
  ConciergeNewChatState,
} from '@/lib/schemas/settings.types'
import { isModerationExemptChatType } from '@/lib/schemas/chat.types'
import { getConciergeState, type ConciergeState } from './chat-override'

/**
 * Stated moderation refusals on a Moderated chat before the Concierge switches
 * it to Unmoderated, when the setting is absent. Mirrors the schema default.
 */
export const DEFAULT_AUTO_SWITCH_AFTER_REFUSALS = 2

/** Global Concierge settings when none are stored. Mirrors the schema defaults. */
export const DEFAULT_CONCIERGE_SETTINGS: ConciergeSettings = {
  enabled: true,
  uncensoredTextProfileId: null,
  uncensoredImageProfileId: null,
  uncensoredVisionProfileId: null,
  imagePromptProfileId: null,
  autoSwitchAfterRefusals: DEFAULT_AUTO_SWITCH_AFTER_REFUSALS,
  newChatsStartAs: 'moderated',
  display: {
    mode: 'SHOW',
    showWarningBadges: true,
  },
  preScreen: {
    enabled: false,
    threshold: 0.7,
    scanTextChat: true,
    scanImagePrompts: true,
    scanImageGeneration: false,
    customClassificationPrompt: null,
    summaryClassification: false,
  },
}

/** The effective pre-screen for one chat. Every flag is off unless the classifier may run. */
export interface ResolvedPreScreen {
  enabled: boolean
  threshold: number
  scanTextChat: boolean
  scanImagePrompts: boolean
  scanImageGeneration: boolean
  customClassificationPrompt: string | null
}

/** The uncensored desk as this chat may use it. All null when the chat may not reach it. */
export interface ResolvedConciergeDesk {
  textProfileId: string | null
  imageProfileId: string | null
  visionProfileId: string | null
  imagePromptProfileId: string | null
}

export type ConciergePolicySource =
  | 'global'
  | 'default'
  | 'chat-locked'
  | 'chat-unmoderated'
  | 'chat-type-exempt'
  | 'off-duty'

/**
 * The Concierge's effective policy for one chat (or, with no chat, for the
 * global Moderated default).
 */
export interface ResolvedConciergePolicy {
  /** The Concierge is on duty (global switch on) and the chat type is not exempt. */
  onDuty: boolean
  /** The chat's Concierge state; 'moderated' when no chat was supplied. */
  state: ConciergeState
  /**
   * A refusal on content grounds may be retried on the uncensored desk.
   * On duty and not Locked. (An Unmoderated chat already routes direct; the
   * failover stays open as its safety net for any call that still reached an
   * ordinary provider — a continue turn, a cheap-LLM task on a profile that
   * was not swapped.)
   */
  failoverAllowed: boolean
  /** The chat goes straight to the uncensored desk, with candid prompts. On duty and Unmoderated. */
  routeDirect: boolean
  /** The classifier pre-screen. On duty, Moderated, and pre-screen enabled. */
  preScreen: ResolvedPreScreen
  /** The background summary classifier and its sweep. On duty, Moderated, and opted in. */
  summaryClassification: boolean
  /** Stated refusals before the Concierge switches the chat. 0 unless on duty and Moderated. */
  autoSwitchAfterRefusals: number
  /** Who stands at the uncensored desk for this chat. */
  desk: ResolvedConciergeDesk
  /** How flagged content looks. */
  display: ConciergeDisplaySettings
  /** The state new chats start in (from the global settings). */
  newChatsStartAs: ConciergeNewChatState
  /** Where the policy came from. */
  source: ConciergePolicySource
}

/** Anything carrying the global settings — the server row, or the client's settings payload. */
export type ConciergeSettingsCarrier = { conciergeSettings?: ConciergeSettings | null }

const NO_PRE_SCREEN: ResolvedPreScreen = {
  enabled: false,
  threshold: 1.0,
  scanTextChat: false,
  scanImagePrompts: false,
  scanImageGeneration: false,
  customClassificationPrompt: null,
}

const NO_DESK: ResolvedConciergeDesk = {
  textProfileId: null,
  imageProfileId: null,
  visionProfileId: null,
  imagePromptProfileId: null,
}

/**
 * Read the stored global Concierge settings, filling any gap (a row written
 * before a field existed) from {@link DEFAULT_CONCIERGE_SETTINGS}.
 */
export function readConciergeSettings(
  globalSettings: ConciergeSettingsCarrier | null | undefined,
): ConciergeSettings {
  const stored = globalSettings?.conciergeSettings
  if (!stored) return DEFAULT_CONCIERGE_SETTINGS
  return {
    ...DEFAULT_CONCIERGE_SETTINGS,
    ...stored,
    display: { ...DEFAULT_CONCIERGE_SETTINGS.display, ...(stored.display ?? {}) },
    preScreen: { ...DEFAULT_CONCIERGE_SETTINGS.preScreen, ...(stored.preScreen ?? {}) },
  }
}

function deskFrom(settings: ConciergeSettings): ResolvedConciergeDesk {
  return {
    textProfileId: settings.uncensoredTextProfileId ?? null,
    imageProfileId: settings.uncensoredImageProfileId ?? null,
    visionProfileId: settings.uncensoredVisionProfileId ?? null,
    imagePromptProfileId: settings.imagePromptProfileId ?? null,
  }
}

function preScreenFrom(preScreen: ConciergePreScreenSettings): ResolvedPreScreen {
  if (!preScreen.enabled) {
    // The summary classifier still reads the threshold and prompt.
    return {
      ...NO_PRE_SCREEN,
      threshold: preScreen.threshold,
      customClassificationPrompt: preScreen.customClassificationPrompt ?? null,
    }
  }
  return {
    enabled: true,
    threshold: preScreen.threshold,
    scanTextChat: preScreen.scanTextChat,
    scanImagePrompts: preScreen.scanImagePrompts,
    scanImageGeneration: preScreen.scanImageGeneration,
    customClassificationPrompt: preScreen.customClassificationPrompt ?? null,
  }
}

/**
 * Resolve the Concierge's effective policy.
 *
 *   - exempt chat type (help, brahma) → nothing: the Concierge has no standing
 *   - global `enabled: false`         → nothing: he is off duty
 *   - Locked      → no failover, no pre-screen, no auto-switch, no desk
 *   - Unmoderated → `routeDirect`, failover as a safety net, no pre-screen,
 *                   no auto-switch, no warning badges
 *   - Moderated   → failover, auto-switch, and the pre-screen if opted in
 *
 * @param globalSettings - The global chat settings (carries `conciergeSettings`)
 * @param chat - Optional chat whose Concierge state applies
 */
export function resolveConciergeSettings(
  globalSettings: ConciergeSettingsCarrier | null | undefined,
  chat?: (Parameters<typeof getConciergeState>[0] & { chatType?: string | null }) | null,
): ResolvedConciergePolicy {
  const settings = readConciergeSettings(globalSettings)
  const state: ConciergeState = chat ? getConciergeState(chat) : 'moderated'

  const inert = (source: ConciergePolicySource): ResolvedConciergePolicy => ({
    onDuty: false,
    state,
    failoverAllowed: false,
    routeDirect: false,
    preScreen: NO_PRE_SCREEN,
    summaryClassification: false,
    autoSwitchAfterRefusals: 0,
    desk: NO_DESK,
    display: { mode: 'SHOW', showWarningBadges: false },
    newChatsStartAs: settings.newChatsStartAs,
    source,
  })

  // Help Chats and the Brahma Console are never moderated — the Concierge has
  // no standing on those surfaces at all, regardless of the global setting.
  if (chat && isModerationExemptChatType(chat.chatType)) {
    return inert('chat-type-exempt')
  }

  if (!settings.enabled) {
    return inert('off-duty')
  }

  if (state === 'locked') {
    return { ...inert('chat-locked'), onDuty: true, display: settings.display }
  }

  if (state === 'unmoderated') {
    return {
      onDuty: true,
      state,
      failoverAllowed: true,
      routeDirect: true,
      preScreen: NO_PRE_SCREEN,          // the verdict is already in
      summaryClassification: false,
      autoSwitchAfterRefusals: 0,
      desk: deskFrom(settings),
      display: { ...settings.display, showWarningBadges: false },
      newChatsStartAs: settings.newChatsStartAs,
      source: 'chat-unmoderated',
    }
  }

  return {
    onDuty: true,
    state,
    failoverAllowed: true,
    routeDirect: false,
    preScreen: preScreenFrom(settings.preScreen),
    summaryClassification: settings.preScreen.summaryClassification,
    autoSwitchAfterRefusals: settings.autoSwitchAfterRefusals ?? DEFAULT_AUTO_SWITCH_AFTER_REFUSALS,
    desk: deskFrom(settings),
    display: settings.display,
    newChatsStartAs: settings.newChatsStartAs,
    source: globalSettings?.conciergeSettings ? 'global' : 'default',
  }
}
