import { randomUUID } from 'crypto'
import { UuidRemapper, createUuidRemapper } from '@/lib/backup/uuid-remapper'

jest.mock('crypto', () => ({
  randomUUID: jest.fn(),
}))

jest.mock('@/lib/logger', () => ({
  logger: {
    child: jest.fn(() => ({
      debug: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      child: jest.fn(),
    })),
  },
}))

const randomUUIDMock = randomUUID as jest.MockedFunction<typeof randomUUID>

describe('UuidRemapper', () => {
  beforeEach(() => {
    randomUUIDMock.mockReset()
  })

  it('creates deterministic mappings per input value', () => {
    randomUUIDMock.mockReturnValueOnce('mapped-1').mockReturnValueOnce('mapped-2')

    const remapper = new UuidRemapper()

    expect(remapper.remap('old-1')).toBe('mapped-1')
    expect(remapper.remap('old-1')).toBe('mapped-1')
    expect(remapper.remap('old-2')).toBe('mapped-2')
    expect(remapper.getSize()).toBe(2)
  })

  it('remaps arrays and gracefully handles invalid inputs', () => {
    randomUUIDMock.mockReturnValueOnce('mapped-a').mockReturnValueOnce('mapped-b')
    const remapper = new UuidRemapper()

    expect(remapper.remapArray(['a', 'b'])).toEqual(['mapped-a', 'mapped-b'])
    expect(remapper.remapArray('not-an-array' as any)).toEqual([])
  })

  it('remaps selected string fields in shallow copies', () => {
    randomUUIDMock.mockReturnValueOnce('new-id').mockReturnValueOnce('new-image')
    const remapper = new UuidRemapper()

    const original = { id: 'old', defaultImageId: 'old-img', name: 'Original' }
    const remapped = remapper.remapFields(original, ['id', 'defaultImageId'])

    expect(remapped).toEqual({ id: 'new-id', defaultImageId: 'new-image', name: 'Original' })
    expect(original).toEqual({ id: 'old', defaultImageId: 'old-img', name: 'Original' })
  })

  it('remaps array fields without touching unrelated properties', () => {
    randomUUIDMock.mockReturnValueOnce('tag-1').mockReturnValueOnce('tag-2')
    const remapper = new UuidRemapper()

    const data = { tags: ['t1', 't2'], other: ['keep'] }
    const remapped = remapper.remapArrayFields(data, ['tags'])

    expect(remapped.tags).toEqual(['tag-1', 'tag-2'])
    expect(remapped.other).toEqual(['keep'])
  })

  it('exposes and clears internal mapping state', () => {
    randomUUIDMock.mockReturnValueOnce('mapped-id')
    const remapper = new UuidRemapper()

    remapper.remap('old-id')
    expect(remapper.getMapping()).toEqual({ 'old-id': 'mapped-id' })

    remapper.clear()

    expect(remapper.getSize()).toBe(0)
    expect(remapper.getMapping()).toEqual({})
  })

  it('creates a new remapper instance via helper', () => {
    const instance = createUuidRemapper()
    expect(instance).toBeInstanceOf(UuidRemapper)
  })
})
