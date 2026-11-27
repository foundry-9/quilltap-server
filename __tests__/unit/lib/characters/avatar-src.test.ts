/**
 * `characterAvatarSrc` — the one derivation of a character's avatar `src`.
 */
import { characterAvatarSrc } from '@/lib/characters/avatar-src'

describe('characterAvatarSrc', () => {
  it('prefers the default image url', () => {
    expect(characterAvatarSrc({ defaultImage: { filepath: 'a/b.webp', url: '/api/files/x' }, avatarUrl: '/legacy' })).toBe(
      '/api/files/x',
    )
  })

  it('makes a bare file path root-relative and leaves a rooted one alone', () => {
    expect(characterAvatarSrc({ defaultImage: { filepath: 'a/b.webp' } })).toBe('/a/b.webp')
    expect(characterAvatarSrc({ defaultImage: { filepath: '/a/b.webp' } })).toBe('/a/b.webp')
  })

  it('falls back to avatarUrl, then null', () => {
    expect(characterAvatarSrc({ avatarUrl: '/legacy.png' })).toBe('/legacy.png')
    expect(characterAvatarSrc({})).toBeNull()
  })

  it('treats a default image with neither url nor file as no image', () => {
    expect(characterAvatarSrc({ defaultImage: { filepath: '' }, avatarUrl: '/legacy.png' })).toBe('/legacy.png')
    expect(characterAvatarSrc({ defaultImage: {}, avatarUrl: '/legacy.png' })).toBe('/legacy.png')
    expect(characterAvatarSrc({ defaultImage: { filepath: '' } })).toBeNull()
  })

  it('appends the image id only when asked', () => {
    const c = { defaultImage: { filepath: 'a.webp', url: '/f?x=1' }, defaultImageId: 'img1' }
    expect(characterAvatarSrc(c)).toBe('/f?x=1')
    expect(characterAvatarSrc(c, { cacheBust: true })).toBe('/f?x=1&v=img1')
    expect(characterAvatarSrc({ avatarUrl: '/l.png', defaultImageId: 'img1' }, { cacheBust: true })).toBe('/l.png?v=img1')
    expect(characterAvatarSrc({}, { cacheBust: true })).toBeNull()
  })
})
