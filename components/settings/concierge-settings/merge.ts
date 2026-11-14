/**
 * The stored Concierge settings with every default filled in — the one place
 * the Settings page merges them (the Moderation cards and the attention strip).
 *
 * @module components/settings/concierge-settings/merge
 */

import { DEFAULT_CONCIERGE_SETTINGS, type ConciergeSettings } from '@/components/settings/chat-settings/types'

export function mergeConciergeSettings(stored: Partial<ConciergeSettings> | undefined | null): ConciergeSettings {
  return {
    ...DEFAULT_CONCIERGE_SETTINGS,
    ...stored,
    display: { ...DEFAULT_CONCIERGE_SETTINGS.display, ...stored?.display },
    preScreen: { ...DEFAULT_CONCIERGE_SETTINGS.preScreen, ...stored?.preScreen },
  }
}
