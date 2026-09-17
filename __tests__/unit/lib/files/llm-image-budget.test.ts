/**
 * Bug 151 — what an image costs on the wire to an LLM.
 *
 * These run against **real sharp**, not a double. The defect was entirely
 * about byte sizes: two avatars, each under the provider's per-image ceiling
 * and so resized by nobody, summed to 4.52 MB of base64. A mocked encoder
 * returns whatever buffer the test hands it, which is precisely the thing
 * that cannot reproduce this — so the assertions here are on measured output.
 */

import sharp from 'sharp'
import {
  LANTERN_IMAGE_BASE64_BUDGET,
  LLM_TRANSPORT_MAX_EDGE,
  LLM_TRANSPORT_TARGET_BASE64,
  shrinkImageForLlmTransport,
} from '@/lib/files/llm-image-budget'

jest.mock('@/lib/plugins/provider-registry', () => ({
  getAttachmentSupport: jest.fn(() => undefined),
}))

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const base64Size = (b: Buffer) => Math.ceil((b.length * 4) / 3)

/**
 * A portrait the size a `gpt-image-2.5` avatar really is, built from noise so
 * it does not compress to nothing the way flat colour would — the stored
 * avatars that triggered the bug were 1024x1536 and ~1.7 MB.
 */
async function makePortrait(width = 1024, height = 1536): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 70 },
    },
  })
    .webp({ quality: 90 })
    .toBuffer()
}

describe('the gap this closes', () => {
  it('the provider ceiling alone leaves a 1.7 MB avatar untouched', async () => {
    // The unfixed path in one assertion: `resizeImageForProvider` is the only
    // thing that looked at a Lantern image's size, it fires only above the
    // provider's per-image limit, and an avatar is comfortably below it. So
    // the bytes went out at full resolution — twice, on the reported turn.
    const { resizeImageForProvider } = jest.requireActual(
      '@/lib/files/image-processing',
    ) as typeof import('@/lib/files/image-processing')

    const original = await makePortrait()
    const result = await resizeImageForProvider({
      provider: 'NANOGPT',
      buffer: original,
      mimeType: 'image/webp',
    })

    expect(result.wasResized).toBe(false)
    expect(base64Size(result.buffer)).toBeGreaterThan(LLM_TRANSPORT_TARGET_BASE64)
  })
})

describe('shrinkImageForLlmTransport', () => {
  it('caps the long edge at 1024 for a portrait avatar', async () => {
    const original = await makePortrait(1024, 1536)

    const result = await shrinkImageForLlmTransport({
      buffer: original,
      mimeType: 'image/webp',
      provider: 'NANOGPT',
    })

    expect(result.wasShrunk).toBe(true)
    expect(Math.max(result.width!, result.height!)).toBe(LLM_TRANSPORT_MAX_EDGE)
    // Aspect ratio preserved: 1024x1536 -> 683x1024.
    expect(result.width).toBe(683)
    expect(result.height).toBe(1024)
  })

  it('caps a landscape story background at 1024 horizontal', async () => {
    const original = await makePortrait(1536, 1024)

    const result = await shrinkImageForLlmTransport({
      buffer: original,
      mimeType: 'image/webp',
      provider: 'NANOGPT',
    })

    expect(result.wasShrunk).toBe(true)
    expect(result.width).toBe(LLM_TRANSPORT_MAX_EDGE)
    expect(result.height).toBe(683)
  })

  it('brings the payload under the 500K base64 ceiling', async () => {
    const original = await makePortrait()
    // The precondition the bug depended on: the stored image is far over the
    // ceiling, yet still under the 4 MB per-image provider limit, so nothing
    // in the old path touched it.
    expect(base64Size(original)).toBeGreaterThan(LLM_TRANSPORT_TARGET_BASE64)
    expect(base64Size(original)).toBeLessThan(4 * 1024 * 1024)

    const result = await shrinkImageForLlmTransport({
      buffer: original,
      mimeType: 'image/webp',
      provider: 'NANOGPT',
    })

    expect(base64Size(result.buffer)).toBeLessThanOrEqual(LLM_TRANSPORT_TARGET_BASE64)
  })

  it('keeps two shrunk avatars inside the per-turn budget that bug 151 blew', async () => {
    // The reported turn, reproduced: two unseen avatars on one request.
    const a = await shrinkImageForLlmTransport({
      buffer: await makePortrait(),
      mimeType: 'image/webp',
      provider: 'NANOGPT',
    })
    const b = await shrinkImageForLlmTransport({
      buffer: await makePortrait(),
      mimeType: 'image/webp',
      provider: 'NANOGPT',
    })

    const onTheWire = base64Size(a.buffer) + base64Size(b.buffer)
    expect(onTheWire).toBeLessThanOrEqual(LANTERN_IMAGE_BASE64_BUDGET)
    // 4.52 MB was what NanoGPT answered with 413.
    expect(onTheWire).toBeLessThan(4.52 * 1024 * 1024)
  })

  it('leaves an image that is already small alone', async () => {
    const small = await sharp({
      create: { width: 320, height: 240, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .webp({ quality: 80 })
      .toBuffer()

    const result = await shrinkImageForLlmTransport({
      buffer: small,
      mimeType: 'image/webp',
      provider: 'NANOGPT',
    })

    expect(result.wasShrunk).toBe(false)
    expect(result.buffer).toBe(small)
  })

  it('passes through a format sharp cannot resize', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>')

    const result = await shrinkImageForLlmTransport({
      buffer: svg,
      mimeType: 'image/svg+xml',
      provider: 'NANOGPT',
    })

    expect(result.wasShrunk).toBe(false)
    expect(result.buffer).toBe(svg)
  })

  it('returns the input unchanged rather than throwing on undecodable bytes', async () => {
    const junk = Buffer.from('not an image at all')

    const result = await shrinkImageForLlmTransport({
      buffer: junk,
      mimeType: 'image/png',
      provider: 'NANOGPT',
    })

    expect(result.wasShrunk).toBe(false)
    expect(result.buffer).toBe(junk)
  })

  it('takes a provider ceiling lower than the transport target as its goal', async () => {
    const { getAttachmentSupport } = jest.requireMock('@/lib/plugins/provider-registry') as {
      getAttachmentSupport: jest.Mock
    }
    const original = await makePortrait()

    const atDefaultCeiling = await shrinkImageForLlmTransport({
      buffer: original,
      mimeType: 'image/webp',
      provider: 'NANOGPT',
    })

    // A ceiling below what the ladder's bottom rung can reach for this
    // (deliberately incompressible) image drives the ladder all the way down
    // rather than stopping at the first rung that clears 500K.
    getAttachmentSupport.mockReturnValue({ maxBase64Size: 8 * 1024 })
    const atTinyCeiling = await shrinkImageForLlmTransport({
      buffer: original,
      mimeType: 'image/webp',
      provider: 'TINY',
    })
    getAttachmentSupport.mockReturnValue(undefined)

    expect(atTinyCeiling.buffer.length).toBeLessThan(atDefaultCeiling.buffer.length)

    // And it still returns the image. An unreachable ceiling is not a reason
    // to send nothing: `resizeImageForProvider` in `lib/chat-files-v2.ts` runs
    // straight after this as the hard backstop, shrinking dimensions further,
    // and that layering is why this module never has to refuse.
    expect(atTinyCeiling.wasShrunk).toBe(true)
    expect(atTinyCeiling.buffer.length).toBeGreaterThan(0)
  })
})
