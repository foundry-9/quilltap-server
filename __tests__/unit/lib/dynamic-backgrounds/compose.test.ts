/**
 * @jest-environment node
 *
 * composeCollage (lib/dynamic-backgrounds/compose.ts), with real sharp on tiny
 * generated pictures (spec §4.3).
 */

jest.mock('@/lib/file-storage/manager', () => ({
  fileStorageManager: { downloadFile: jest.fn() },
}))


import sharp from 'sharp'
import { composeCollage } from '@/lib/dynamic-backgrounds/compose'
import { CANVAS, planCollage } from '@/lib/dynamic-backgrounds/layout'
import { seededRandom } from '@/lib/dynamic-backgrounds/seed'
import type { CollageSource } from '@/lib/dynamic-backgrounds/pools'

const COLOURS = [
  { r: 200, g: 30, b: 30 },
  { r: 30, g: 200, b: 30 },
  { r: 30, g: 30, b: 200 },
  { r: 200, g: 200, b: 30 },
]

async function png(colour: { r: number; g: number; b: number }, width = 48, height = 27): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: colour } }).png().toBuffer()
}

function source(id: string, width = 48, height = 27): CollageSource {
  return { fileId: id, sha256: id.padStart(64, '0'), width, height, file: { id } as never }
}

async function setup(count: number) {
  const sources = Array.from({ length: count }, (_, i) => source(`f${i}`))
  const bytes = new Map<string, Buffer>()
  for (let i = 0; i < count; i++) bytes.set(`f${i}`, await png(COLOURS[i % COLOURS.length]))
  const canvas = CANVAS.landscape
  const plan = planCollage({
    mode: 'rows',
    canvas,
    sources: sources.map((s) => ({ key: s.fileId, aspect: s.width / s.height })),
    random: seededRandom('compose-test'),
  })
  return { sources, bytes, canvas, plan }
}

describe('composeCollage', () => {
  it('writes a WebP the size of the canvas', async () => {
    const { sources, bytes, canvas, plan } = await setup(4)
    const out = await composeCollage(plan, canvas, sources, {
      readBytes: async (file) => bytes.get((file as { id: string }).id)!,
    })
    expect(out).not.toBeNull()
    const meta = await sharp(out!).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(canvas.width)
    expect(meta.height).toBe(canvas.height)
  }, 20000)

  it('substitutes a readable picture for an unreadable one', async () => {
    const { sources, bytes, canvas, plan } = await setup(4)
    const readBytes = jest.fn(async (file: { id: string }) => {
      if (file.id === 'f0') throw new Error('gone')
      if (file.id === 'f1') return Buffer.from('not an image')
      return bytes.get(file.id)!
    })
    const out = await composeCollage(plan, canvas, sources, { readBytes: readBytes as never })
    // Only two readable pictures remain: below the floor of three.
    expect(out).toBeNull()

    const five = await setup(5)
    const read5 = jest.fn(async (file: { id: string }) => {
      if (file.id === 'f0') throw new Error('gone')
      return five.bytes.get(file.id)!
    })
    const ok = await composeCollage(five.plan, five.canvas, five.sources, { readBytes: read5 as never })
    expect(ok).not.toBeNull()
    expect((await sharp(ok!).metadata()).width).toBe(five.canvas.width)
    // Each picture is read once per collage, however many tiles it fills.
    const reads = read5.mock.calls.map((c) => c[0].id)
    expect(new Set(reads).size).toBe(reads.length)
  }, 20000)
})
