/**
 * Tests for lib/services/dangerous-content/resolver.service.ts
 *
 * `resolveConciergeSettings` turns the global `conciergeSettings` and one
 * chat's Concierge state into the effective policy (Concierge overhaul
 * phase 4, §4).
 */

import {
  DEFAULT_AUTO_SWITCH_AFTER_REFUSALS,
  DEFAULT_CONCIERGE_SETTINGS,
  readConciergeSettings,
  resolveConciergeSettings,
  type ResolvedConciergePolicy,
} from '@/lib/services/dangerous-content/resolver.service'
import type { ChatSettings } from '@/lib/schemas/types'
import type { ConciergeSettings } from '@/lib/schemas/settings.types'

const TEXT_ID = '11111111-1111-4111-8111-111111111111'
const IMAGE_ID = '22222222-2222-4222-8222-222222222222'
const VISION_ID = '33333333-3333-4333-8333-333333333333'
const PROMPT_ID = '44444444-4444-4444-8444-444444444444'

function concierge(overrides: Partial<ConciergeSettings> = {}): ConciergeSettings {
  return {
    ...DEFAULT_CONCIERGE_SETTINGS,
    uncensoredTextProfileId: TEXT_ID,
    uncensoredImageProfileId: IMAGE_ID,
    uncensoredVisionProfileId: VISION_ID,
    imagePromptProfileId: PROMPT_ID,
    autoSwitchAfterRefusals: 3,
    ...overrides,
    display: { ...DEFAULT_CONCIERGE_SETTINGS.display, ...(overrides.display ?? {}) },
    preScreen: {
      ...DEFAULT_CONCIERGE_SETTINGS.preScreen,
      enabled: true,
      threshold: 0.55,
      scanTextChat: true,
      scanImagePrompts: false,
      scanImageGeneration: true,
      customClassificationPrompt: 'Be strict about gore.',
      summaryClassification: true,
      ...(overrides.preScreen ?? {}),
    },
  }
}

function global(settings: ConciergeSettings | undefined): Pick<ChatSettings, 'conciergeSettings'> {
  return { conciergeSettings: settings } as Pick<ChatSettings, 'conciergeSettings'>
}

const moderated = { conciergeMode: 'moderated' as const, chatType: 'salon' }
const unmoderated = { conciergeMode: 'unmoderated' as const, chatType: 'salon' }
const locked = { conciergeMode: 'locked' as const, chatType: 'salon' }

function expectNothingAllowed(policy: ResolvedConciergePolicy): void {
  expect(policy.onDuty).toBe(false)
  expect(policy.failoverAllowed).toBe(false)
  expect(policy.routeDirect).toBe(false)
  expect(policy.preScreen.enabled).toBe(false)
  expect(policy.preScreen.scanTextChat).toBe(false)
  expect(policy.preScreen.scanImagePrompts).toBe(false)
  expect(policy.preScreen.scanImageGeneration).toBe(false)
  expect(policy.summaryClassification).toBe(false)
  expect(policy.autoSwitchAfterRefusals).toBe(0)
  expect(policy.desk).toEqual({
    textProfileId: null,
    imageProfileId: null,
    visionProfileId: null,
    imagePromptProfileId: null,
  })
  expect(policy.display.showWarningBadges).toBe(false)
}

describe('DEFAULT_CONCIERGE_SETTINGS', () => {
  it('is on duty with the pre-screen and summary classifier off', () => {
    expect(DEFAULT_CONCIERGE_SETTINGS.enabled).toBe(true)
    expect(DEFAULT_CONCIERGE_SETTINGS.preScreen.enabled).toBe(false)
    expect(DEFAULT_CONCIERGE_SETTINGS.preScreen.summaryClassification).toBe(false)
    expect(DEFAULT_CONCIERGE_SETTINGS.preScreen.threshold).toBe(0.7)
  })

  it('switches after the default number of refusals and starts chats Moderated', () => {
    expect(DEFAULT_CONCIERGE_SETTINGS.autoSwitchAfterRefusals).toBe(DEFAULT_AUTO_SWITCH_AFTER_REFUSALS)
    expect(DEFAULT_AUTO_SWITCH_AFTER_REFUSALS).toBe(2)
    expect(DEFAULT_CONCIERGE_SETTINGS.newChatsStartAs).toBe('moderated')
  })

  it('shows content with warning badges', () => {
    expect(DEFAULT_CONCIERGE_SETTINGS.display).toEqual({ mode: 'SHOW', showWarningBadges: true })
  })
})

describe('readConciergeSettings', () => {
  it('returns the defaults when there is no settings row', () => {
    expect(readConciergeSettings(null)).toEqual(DEFAULT_CONCIERGE_SETTINGS)
    expect(readConciergeSettings(undefined)).toEqual(DEFAULT_CONCIERGE_SETTINGS)
  })

  it('returns the defaults when conciergeSettings is missing', () => {
    expect(readConciergeSettings(global(undefined))).toEqual(DEFAULT_CONCIERGE_SETTINGS)
  })

  it('fills gaps in nested objects from the defaults', () => {
    const partial = {
      enabled: false,
      preScreen: { enabled: true },
      display: { mode: 'BLUR' },
    } as unknown as ConciergeSettings
    const read = readConciergeSettings(global(partial))
    expect(read.enabled).toBe(false)
    expect(read.preScreen.enabled).toBe(true)
    expect(read.preScreen.threshold).toBe(0.7)
    expect(read.preScreen.scanTextChat).toBe(true)
    expect(read.display.mode).toBe('BLUR')
    expect(read.display.showWarningBadges).toBe(true)
    expect(read.autoSwitchAfterRefusals).toBe(2)
  })
})

describe('resolveConciergeSettings', () => {
  describe('enabled: false (off duty)', () => {
    it('allows nothing anywhere, with or without a chat', () => {
      const settings = global(concierge({ enabled: false }))
      for (const chat of [undefined, moderated, unmoderated, locked]) {
        const policy = resolveConciergeSettings(settings, chat)
        expectNothingAllowed(policy)
        expect(policy.source).toBe('off-duty')
      }
    })

    it('still reports the state and newChatsStartAs', () => {
      const policy = resolveConciergeSettings(
        global(concierge({ enabled: false, newChatsStartAs: 'unmoderated' })),
        unmoderated,
      )
      expect(policy.state).toBe('unmoderated')
      expect(policy.newChatsStartAs).toBe('unmoderated')
    })
  })

  describe('Locked', () => {
    it('allows no failover, no pre-screen, no auto-switch, and empties the desk', () => {
      const policy = resolveConciergeSettings(global(concierge()), locked)
      expect(policy.onDuty).toBe(true)
      expect(policy.state).toBe('locked')
      expect(policy.failoverAllowed).toBe(false)
      expect(policy.routeDirect).toBe(false)
      expect(policy.preScreen.enabled).toBe(false)
      expect(policy.summaryClassification).toBe(false)
      expect(policy.autoSwitchAfterRefusals).toBe(0)
      expect(policy.desk).toEqual({
        textProfileId: null,
        imageProfileId: null,
        visionProfileId: null,
        imagePromptProfileId: null,
      })
      expect(policy.source).toBe('chat-locked')
    })

    it('keeps the global display settings', () => {
      const policy = resolveConciergeSettings(
        global(concierge({ display: { mode: 'COLLAPSE', showWarningBadges: true } })),
        locked,
      )
      expect(policy.display).toEqual({ mode: 'COLLAPSE', showWarningBadges: true })
    })
  })

  describe('Unmoderated', () => {
    it('routes direct, keeps failover as a safety net, and never pre-screens or auto-switches', () => {
      const policy = resolveConciergeSettings(global(concierge()), unmoderated)
      expect(policy.onDuty).toBe(true)
      expect(policy.state).toBe('unmoderated')
      expect(policy.routeDirect).toBe(true)
      expect(policy.failoverAllowed).toBe(true)
      expect(policy.preScreen.enabled).toBe(false)
      expect(policy.preScreen.scanTextChat).toBe(false)
      expect(policy.summaryClassification).toBe(false)
      expect(policy.autoSwitchAfterRefusals).toBe(0)
      expect(policy.source).toBe('chat-unmoderated')
    })

    it('stands the configured desk behind the chat', () => {
      const policy = resolveConciergeSettings(global(concierge()), unmoderated)
      expect(policy.desk).toEqual({
        textProfileId: TEXT_ID,
        imageProfileId: IMAGE_ID,
        visionProfileId: VISION_ID,
        imagePromptProfileId: PROMPT_ID,
      })
    })

    it('hides warning badges', () => {
      const policy = resolveConciergeSettings(global(concierge()), unmoderated)
      expect(policy.display.showWarningBadges).toBe(false)
    })
  })

  describe('Moderated', () => {
    it('uses the global values', () => {
      const policy = resolveConciergeSettings(global(concierge()), moderated)
      expect(policy.onDuty).toBe(true)
      expect(policy.state).toBe('moderated')
      expect(policy.failoverAllowed).toBe(true)
      expect(policy.routeDirect).toBe(false)
      expect(policy.preScreen).toEqual({
        enabled: true,
        threshold: 0.55,
        scanTextChat: true,
        scanImagePrompts: false,
        scanImageGeneration: true,
        customClassificationPrompt: 'Be strict about gore.',
      })
      expect(policy.summaryClassification).toBe(true)
      expect(policy.autoSwitchAfterRefusals).toBe(3)
      expect(policy.desk.textProfileId).toBe(TEXT_ID)
      expect(policy.display).toEqual({ mode: 'SHOW', showWarningBadges: true })
      expect(policy.source).toBe('global')
    })

    it('treats a missing chat as the global Moderated default', () => {
      const policy = resolveConciergeSettings(global(concierge()))
      expect(policy.state).toBe('moderated')
      expect(policy.failoverAllowed).toBe(true)
      expect(policy.preScreen.enabled).toBe(true)
    })

    it('treats a chat with no conciergeMode as Moderated', () => {
      const policy = resolveConciergeSettings(global(concierge()), { chatType: 'salon' })
      expect(policy.state).toBe('moderated')
      expect(policy.failoverAllowed).toBe(true)
    })

    it('does not pre-screen unless the pre-screen is enabled, but keeps threshold and prompt', () => {
      const policy = resolveConciergeSettings(
        global(concierge({ preScreen: { enabled: false } as ConciergeSettings['preScreen'] })),
        moderated,
      )
      expect(policy.preScreen.enabled).toBe(false)
      expect(policy.preScreen.scanTextChat).toBe(false)
      expect(policy.preScreen.scanImagePrompts).toBe(false)
      expect(policy.preScreen.scanImageGeneration).toBe(false)
      // The summary classifier still reads these
      expect(policy.preScreen.threshold).toBe(0.55)
      expect(policy.preScreen.customClassificationPrompt).toBe('Be strict about gore.')
      // Summary classification is its own opt-in
      expect(policy.summaryClassification).toBe(true)
      expect(policy.failoverAllowed).toBe(true)
    })

    it('reads summaryClassification off the global opt-in', () => {
      const policy = resolveConciergeSettings(
        global(concierge({ preScreen: { summaryClassification: false } as ConciergeSettings['preScreen'] })),
        moderated,
      )
      expect(policy.summaryClassification).toBe(false)
      expect(policy.preScreen.enabled).toBe(true)
    })

    it('honours autoSwitchAfterRefusals: 0 (never)', () => {
      const policy = resolveConciergeSettings(global(concierge({ autoSwitchAfterRefusals: 0 })), moderated)
      expect(policy.autoSwitchAfterRefusals).toBe(0)
    })
  })

  describe('exempt chat types', () => {
    it.each(['help', 'brahma'])('%s chats get nothing, whatever the settings and state', (chatType) => {
      for (const conciergeMode of ['moderated', 'unmoderated', 'locked'] as const) {
        const policy = resolveConciergeSettings(global(concierge()), { conciergeMode, chatType })
        expectNothingAllowed(policy)
        expect(policy.source).toBe('chat-type-exempt')
      }
    })
  })

  describe('missing conciergeSettings', () => {
    it('resolves the defaults with source "default"', () => {
      for (const settings of [null, undefined, global(undefined)]) {
        const policy = resolveConciergeSettings(settings, moderated)
        expect(policy.source).toBe('default')
        expect(policy.onDuty).toBe(true)
        expect(policy.failoverAllowed).toBe(true)
        expect(policy.routeDirect).toBe(false)
        expect(policy.preScreen.enabled).toBe(false)
        expect(policy.preScreen.threshold).toBe(0.7)
        expect(policy.summaryClassification).toBe(false)
        expect(policy.autoSwitchAfterRefusals).toBe(DEFAULT_AUTO_SWITCH_AFTER_REFUSALS)
        expect(policy.desk).toEqual({
          textProfileId: null,
          imageProfileId: null,
          visionProfileId: null,
          imagePromptProfileId: null,
        })
        expect(policy.newChatsStartAs).toBe('moderated')
      }
    })
  })
})
