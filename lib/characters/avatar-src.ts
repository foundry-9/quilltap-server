/**
 * The `src` for a character's avatar image: the default image's URL (or its
 * file path, made root-relative), else the legacy `avatarUrl`, else null for
 * the initial-letter fallback.
 *
 * @module lib/characters/avatar-src
 */

export interface CharacterAvatarFields {
  defaultImage?: { filepath?: string | null; url?: string | null } | null
  avatarUrl?: string | null
  defaultImageId?: string | null
}

export function characterAvatarSrc(
  character: CharacterAvatarFields,
  options?: {
    /**
     * Append `v=<defaultImageId>` so a newly chosen avatar is not served from
     * the browser's cache under the old URL.
     */
    cacheBust?: boolean
  },
): string | null {
  let src: string | null
  const image = character.defaultImage
  if (image?.url) {
    src = image.url
  } else if (image?.filepath) {
    src = image.filepath.startsWith('/') ? image.filepath : `/${image.filepath}`
  } else {
    // No default image, or one that names neither a URL nor a file.
    src = character.avatarUrl || null
  }
  if (options?.cacheBust && src && character.defaultImageId) {
    src = `${src}${src.includes('?') ? '&' : '?'}v=${character.defaultImageId}`
  }
  return src
}
