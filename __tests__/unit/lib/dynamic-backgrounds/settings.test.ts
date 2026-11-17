/**
 * @jest-environment node
 *
 * The dynamic-backgrounds settings: schema defaults and bounds, and the one
 * server-side reader (lib/dynamic-backgrounds/settings.ts).
 */

import {
  ChatSettingsSchema,
  DynamicBackgroundsSettingsSchema,
  DYNAMIC_BACKGROUND_REFRESH_DEFAULT,
  DYNAMIC_BACKGROUND_REFRESH_MAX,
  DYNAMIC_BACKGROUND_REFRESH_MIN,
} from '@/lib/schemas/settings.types'
import { resolveDynamicBackgroundSettings } from '@/lib/dynamic-backgrounds/settings'
import { defaultChatSettings } from '@/lib/database/repositories/chat-settings.repository'

describe('DynamicBackgroundsSettingsSchema', () => {
  it('defaults to off, uncensored kept out, three minutes', () => {
    expect(DynamicBackgroundsSettingsSchema.parse({})).toEqual({
      enabled: false,
      allowUncensored: false,
      refreshMinutes: DYNAMIC_BACKGROUND_REFRESH_DEFAULT,
    })
    expect(DYNAMIC_BACKGROUND_REFRESH_DEFAULT).toBe(3)
  })

  it('holds the interval to whole minutes inside the bounds', () => {
    expect(DynamicBackgroundsSettingsSchema.safeParse({ refreshMinutes: DYNAMIC_BACKGROUND_REFRESH_MIN - 1 }).success).toBe(false)
    expect(DynamicBackgroundsSettingsSchema.safeParse({ refreshMinutes: DYNAMIC_BACKGROUND_REFRESH_MAX + 1 }).success).toBe(false)
    expect(DynamicBackgroundsSettingsSchema.safeParse({ refreshMinutes: 2.5 }).success).toBe(false)
    expect(DynamicBackgroundsSettingsSchema.safeParse({ refreshMinutes: DYNAMIC_BACKGROUND_REFRESH_MAX }).success).toBe(true)
  })

  it('is filled in on a chat-settings row that lacks it', () => {
    const shape = ChatSettingsSchema.shape.dynamicBackgrounds
    expect(shape.parse(undefined)).toEqual({ enabled: false, allowUncensored: false, refreshMinutes: 3 })
  })

  it('agrees with the repository default for a fresh user', () => {
    expect(defaultChatSettings('u').dynamicBackgrounds).toEqual(DynamicBackgroundsSettingsSchema.parse({}))
  })
})

describe('resolveDynamicBackgroundSettings', () => {
  const repos = (row: unknown) => ({ chatSettings: { findByUserId: jest.fn(async () => row) } }) as never

  it('reads the row by user id', async () => {
    const r = repos({ dynamicBackgrounds: { enabled: true, allowUncensored: true, refreshMinutes: 7 } })
    await expect(resolveDynamicBackgroundSettings(r, 'user-9')).resolves.toEqual({ enabled: true, allowUncensored: true, refreshMinutes: 7 })
    expect((r as { chatSettings: { findByUserId: jest.Mock } }).chatSettings.findByUserId).toHaveBeenCalledWith('user-9')
  })

  it('falls back to the defaults for no row or a malformed field', async () => {
    await expect(resolveDynamicBackgroundSettings(repos(null), 'u')).resolves.toEqual({ enabled: false, allowUncensored: false, refreshMinutes: 3 })
    await expect(
      resolveDynamicBackgroundSettings(repos({ dynamicBackgrounds: { enabled: true, refreshMinutes: 0 } }), 'u'),
    ).resolves.toEqual({ enabled: false, allowUncensored: false, refreshMinutes: 3 })
  })
})
