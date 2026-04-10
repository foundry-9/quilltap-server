import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
}

jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: jest.fn(() => mockLogger),
}))

const mockToBuffer = jest.fn<() => Promise<Buffer>>()
const mockSharpInstance = {
  webp: jest.fn().mockReturnThis(),
  toBuffer: mockToBuffer,
}
const mockSharp = jest.fn(() => mockSharpInstance)
;(mockSharp as any).default = mockSharp

jest.mock('sharp', () => mockSharp)

import { convertToWebP, needsWebPConversion } from '@/lib/files/webp-conversion'

describe('webp-conversion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockToBuffer.mockResolvedValue(Buffer.from('converted-webp'))
  })

  it('identifies raster image formats that should be converted', () => {
    expect(needsWebPConversion('image/png')).toBe(true)
    expect(needsWebPConversion('image/jpeg')).toBe(true)
    expect(needsWebPConversion('image/webp')).toBe(false)
    expect(needsWebPConversion('image/svg+xml')).toBe(false)
    expect(needsWebPConversion('text/plain')).toBe(false)
  })

  it('passes through svg images without converting them', async () => {
    const original = Buffer.from('<svg />')

    const result = await convertToWebP(original, 'image/svg+xml', 'icon.svg')

    expect(result).toEqual({
      buffer: original,
      mimeType: 'image/svg+xml',
      filename: 'icon.svg',
      wasConverted: false,
    })
    expect(mockSharp).not.toHaveBeenCalled()
  })

  it('converts raster images to webp and updates the filename extension', async () => {
    const original = Buffer.from('png-bytes')

    const result = await convertToWebP(original, 'image/png', 'portrait.png')

    expect(mockSharp).toHaveBeenCalledWith(original)
    expect(mockSharpInstance.webp).toHaveBeenCalledWith({ quality: 90 })
    expect(result).toEqual({
      buffer: Buffer.from('converted-webp'),
      mimeType: 'image/webp',
      filename: 'portrait.webp',
      wasConverted: true,
    })
  })

  it('keeps the original file when sharp conversion fails', async () => {
    mockToBuffer.mockRejectedValueOnce(new Error('sharp exploded'))
    const original = Buffer.from('jpeg-bytes')

    const result = await convertToWebP(original, 'image/jpeg', 'portrait.jpg')

    expect(result).toEqual({
      buffer: original,
      mimeType: 'image/jpeg',
      filename: 'portrait.jpg',
      wasConverted: false,
    })
  })
})
