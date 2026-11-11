/**
 * #165: the SillyTavern export named its download with a hand-built
 * `filename="${character.name}.json"`. A name above U+00FF is not a ByteString,
 * so building the response threw and the catch answered 500; a `"` broke the
 * header. Both formats now go through `buildContentDisposition`.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/sillytavern/character', () => ({
  exportSTCharacter: jest.fn(() => ({ spec: 'chara_card_v2' })),
  createSTCharacterPNG: jest.fn(async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])),
}))

jest.mock('@/lib/photos/resolve-character-avatar', () => ({
  readCharacterAvatarBuffer: jest.fn(async () => null),
}))

const { handleGet } = require('@/app/api/v1/characters/[id]/handlers/get')

const NAME = 'Suparṇā "the Post"'

function exportReq(format: 'json' | 'png') {
  const url = `http://localhost/api/v1/characters/char-1?action=export&format=${format}`
  return { url, nextUrl: new URL(url) }
}

describe('GET /api/v1/characters/[id]?action=export — non-Latin-1 names (#165)', () => {
  let ctx: any

  beforeEach(() => {
    const character = { id: 'char-1', name: NAME, archivedAt: null, defaultImageId: null }
    ctx = {
      user: { id: 'user-1' },
      repos: {
        characters: {
          findByIdRaw: jest.fn(async () => character),
          findById: jest.fn(async () => character),
        },
      },
    }
  })

  for (const format of ['json', 'png'] as const) {
    it(`answers 200 with an RFC 5987 filename for ${format}`, async () => {
      const res = await handleGet(exportReq(format), ctx, 'char-1')

      expect(res.status).toBe(200)
      const header = res.headers.get('Content-Disposition') as string
      expect(header.startsWith(`attachment; filename="Supar__ \\"the Post\\".${format}"`)).toBe(true)
      expect(header).toContain(`filename*=UTF-8''${encodeURIComponent('Suparṇā')}`)
    })
  }
})
