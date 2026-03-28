/**
 * Tests for lib/services/dangerous-content/resolver.service.ts
 */

import {
  DEFAULT_DANGEROUS_CONTENT_SETTINGS,
  resolveDangerousContentSettings,
} from '@/lib/services/dangerous-content/resolver.service'
import type { ChatSettings } from '@/lib/schemas/types'
import type { DangerousContentSettings } from '@/lib/schemas/settings.types'

describe('DEFAULT_DANGEROUS_CONTENT_SETTINGS', () => {
  it('has mode OFF', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.mode).toBe('OFF')
  })

  it('has threshold 0.7', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.threshold).toBe(0.7)
  })

  it('has scanTextChat true', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.scanTextChat).toBe(true)
  })

  it('has scanImagePrompts true', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.scanImagePrompts).toBe(true)
  })

  it('has scanImageGeneration false', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.scanImageGeneration).toBe(false)
  })

  it('has displayMode SHOW', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.displayMode).toBe('SHOW')
  })

  it('has showWarningBadges true', () => {
    expect(DEFAULT_DANGEROUS_CONTENT_SETTINGS.showWarningBadges).toBe(true)
  })
})

describe('resolveDangerousContentSettings', () => {
  describe('null globalSettings', () => {
    it('returns defaults when globalSettings is null', () => {
      const result = resolveDangerousContentSettings(null)
      expect(result.settings).toEqual(DEFAULT_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('default')
    })
  })

  describe('missing dangerousContentSettings', () => {
    it('returns defaults when globalSettings has no dangerousContentSettings', () => {
      const globalSettings: ChatSettings = {
        id: 'test',
        tokenDisplay: 'minimal',
        contextCompression: false,
        memoryCascade: false,
        showTimestamps: false,
        agentMode: false,
      }
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(DEFAULT_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('default')
    })

    it('returns defaults when globalSettings is empty object (cast)', () => {
      const globalSettings = {} as ChatSettings
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(DEFAULT_DANGEROUS_CONTENT_SETTINGS)
      expect(result.source).toBe('default')
    })
  })

  describe('global settings present', () => {
    it('returns global settings when present, source is "global"', () => {
      const customSettings: DangerousContentSettings = {
        mode: 'BLOCK',
        threshold: 0.5,
        scanTextChat: false,
        scanImagePrompts: false,
        scanImageGeneration: true,
        displayMode: 'HIDE',
        showWarningBadges: false,
      }
      const globalSettings: ChatSettings = {
        id: 'test',
        tokenDisplay: 'minimal',
        contextCompression: false,
        memoryCascade: false,
        showTimestamps: false,
        agentMode: false,
        dangerousContentSettings: customSettings,
      }
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })

    it('returns global settings with different values', () => {
      const customSettings: DangerousContentSettings = {
        mode: 'WARN',
        threshold: 0.9,
        scanTextChat: true,
        scanImagePrompts: false,
        scanImageGeneration: true,
        displayMode: 'BLUR',
        showWarningBadges: false,
      }
      const globalSettings: ChatSettings = {
        id: 'test',
        tokenDisplay: 'full',
        contextCompression: true,
        memoryCascade: true,
        showTimestamps: true,
        agentMode: true,
        dangerousContentSettings: customSettings,
      }
      const result = resolveDangerousContentSettings(globalSettings)
      expect(result.settings).toEqual(customSettings)
      expect(result.source).toBe('global')
    })
  })

  describe('return structure', () => {
    it('always returns object with settings and source properties', () => {
      const result = resolveDangerousContentSettings(null)
      expect(result).toHaveProperty('settings')
      expect(result).toHaveProperty('source')
      expect(Object.keys(result).length).toBe(2)
    })
  })
})
