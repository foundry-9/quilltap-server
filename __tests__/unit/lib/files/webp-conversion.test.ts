import { beforeEach, describe, expect, it, jest } from '@jest/globals'

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
}

jest.mock('@/lib/logging/create-logger', () => ({
  createLogger: jest.fn(() => mockLogger),
}))

const mockToBuffer = jest.fn<() => Promise<Buffer>>()
const mockMetadata = jest.fn<() => Promise<{ width?: number; height?: number }>>()
const mockSharpInstance = {
  webp: jest.fn().mockReturnThis(),
  toBuffer: mockToBuffer,
  metadata: mockMetadata,
}
const mockSharp = jest.fn(() => mockSharpInstance)
;(mockSharp as any).default = mockSharp

jest.mock('sharp', () => mockSharp)

import { convertToWebP, needsWebPConversion } from '@/lib/files/webp-conversion'

describe('webp-conversion', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockToBuffer.mockResolvedValue(Buffer.from('converted-webp'))
    // Default: no measurable dimensions, so the existing exact-shape assertions
    // (which omit width/height) keep passing — toEqual ignores undefined props.
    mockMetadata.mockResolvedValue({})
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

  it('measures the converted output dimensions from the stored bytes', async () => {
    mockMetadata.mockResolvedValue({ width: 1024, height: 1536 })
    const original = Buffer.from('png-bytes')

    const result = await convertToWebP(original, 'image/png', 'portrait.png')

    expect(result.wasConverted).toBe(true)
    expect(result.width).toBe(1024)
    expect(result.height).toBe(1536)
    // Dimensions are read off the *output* webp buffer, not the input bytes.
    expect(mockSharp).toHaveBeenCalledWith(Buffer.from('converted-webp'))
  })

  it('measures dimensions for an already-webp passthrough', async () => {
    mockMetadata.mockResolvedValue({ width: 800, height: 600 })
    const original = Buffer.from('webp-bytes')

    const result = await convertToWebP(original, 'image/webp', 'photo.webp')

    expect(result.wasConverted).toBe(false)
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
  })

  it('leaves dimensions undefined for svg without invoking sharp', async () => {
    const result = await convertToWebP(Buffer.from('<svg />'), 'image/svg+xml', 'icon.svg')

    expect(result.width).toBeUndefined()
    expect(result.height).toBeUndefined()
    expect(mockSharp).not.toHaveBeenCalled()
  })

  it('never throws if dimension measurement fails — dims just stay undefined', async () => {
    mockMetadata.mockRejectedValueOnce(new Error('cannot decode'))
    const result = await convertToWebP(Buffer.from('png-bytes'), 'image/png', 'p.png')

    expect(result.wasConverted).toBe(true)
    expect(result.width).toBeUndefined()
    expect(result.height).toBeUndefined()
  })
})
