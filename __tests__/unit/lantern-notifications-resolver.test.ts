/**
 * Unit tests for isLanternImageAlertEnabled — the chat/project/global
 * fallback resolver for the "Announce Lantern Images to Characters" setting.
 */

import { describe, it, expect } from '@jest/globals'
import { isLanternImageAlertEnabled } from '@/lib/services/lantern-notifications/resolver'

type ChatPart = { alertCharactersOfLanternImages?: boolean | null }
type ProjectPart = { defaultAlertCharactersOfLanternImages?: boolean | null }

describe('isLanternImageAlertEnabled', () => {
  const cases: Array<[ChatPart | null, ProjectPart | null, boolean, string]> = [
    [null, null, false, 'both null → global default false'],
    [{ alertCharactersOfLanternImages: null }, { defaultAlertCharactersOfLanternImages: null }, false, 'both explicitly null → false'],
    [{ alertCharactersOfLanternImages: undefined }, { defaultAlertCharactersOfLanternImages: undefined }, false, 'both undefined → false'],
    [{ alertCharactersOfLanternImages: true }, null, true, 'chat=true, no project → true'],
    [{ alertCharactersOfLanternImages: false }, null, false, 'chat=false, no project → false'],
    [null, { defaultAlertCharactersOfLanternImages: true }, true, 'no chat, project=true → true'],
    [null, { defaultAlertCharactersOfLanternImages: false }, false, 'no chat, project=false → false'],
    [{ alertCharactersOfLanternImages: null }, { defaultAlertCharactersOfLanternImages: true }, true, 'chat null → inherit project=true'],
    [{ alertCharactersOfLanternImages: null }, { defaultAlertCharactersOfLanternImages: false }, false, 'chat null → inherit project=false'],
    [{ alertCharactersOfLanternImages: true }, { defaultAlertCharactersOfLanternImages: false }, true, 'chat=true wins over project=false'],
    [{ alertCharactersOfLanternImages: false }, { defaultAlertCharactersOfLanternImages: true }, false, 'chat=false wins over project=true'],
  ]

  for (const [chat, project, expected, label] of cases) {
    it(label, () => {
      expect(isLanternImageAlertEnabled(chat as never, project as never)).toBe(expected)
    })
  }
})
