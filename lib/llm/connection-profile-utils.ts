/**
 * Connection Profile Utilities
 *
 * Helper functions for working with connection profiles,
 * including attachment support information.
 *
 * Image support is resolved from the profile's own `supportsImageUpload`
 * flag; non-image MIME types (PDF, text) still consult the per-provider
 * capability map, since those vary little within a provider.
 */

import { ConnectionProfile } from '@/lib/schemas/types'
import {
  getSupportedMimeTypes,
  supportsMimeType,
} from './attachment-support'

/**
 * Effective supported MIME types for a profile.
 * Images come from the per-profile flag; non-image types come from the
 * provider capability map.
 */
function getProfileSupportedMimeTypes(profile: ConnectionProfile): string[] {
  const providerTypes = getSupportedMimeTypes(profile.provider, profile.baseUrl ?? undefined)
  const nonImageTypes = providerTypes.filter((t) => !t.startsWith('image/'))
  const imageTypes = profile.supportsImageUpload
    ? ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    : []
  return [...imageTypes, ...nonImageTypes]
}

/**
 * Human-readable description of attachment support for a profile, accounting
 * for the per-profile image-upload flag in addition to provider capabilities.
 */
export function getProfileAttachmentSupportDescription(profile: ConnectionProfile): string {
  const types = getProfileSupportedMimeTypes(profile)
  if (types.length === 0) return 'No file attachments supported'

  const parts: string[] = []
  const images = types.filter((t) => t.startsWith('image/'))
  if (images.length > 0) {
    const formats = images.map((t) => t.replace('image/', '').toUpperCase())
    parts.push(`Images (${formats.join(', ')})`)
  }
  if (types.includes('application/pdf')) parts.push('PDF documents')
  const text = types.filter((t) => t.startsWith('text/'))
  if (text.length > 0) {
    const formats = text.map((t) => {
      const f = t.replace('text/', '')
      return f === 'plain' ? 'TXT' : f.toUpperCase()
    })
    parts.push(`Text files (${formats.join(', ')})`)
  }
  return parts.join(', ')
}

/**
 * Extended connection profile with attachment support information
 */
export interface ConnectionProfileWithAttachmentSupport extends ConnectionProfile {
  /**
   * MIME types supported for file attachments (empty array if none)
   */
  supportedMimeTypes: string[]

  /**
   * Whether this profile supports any file attachments
   */
  supportsFileAttachments: boolean

  /**
   * Categorized file type support
   */
  supportedFileTypes: {
    images: string[]
    documents: string[]
    text: string[]
    all: string[]
  }

  /**
   * Human-readable description of attachment support
   */
  attachmentSupportDescription: string
}

/**
 * Enrich a connection profile with attachment support information
 *
 * @param profile The connection profile
 * @returns Connection profile with attachment support metadata
 */
export function enrichConnectionProfileWithAttachmentSupport(
  profile: ConnectionProfile
): ConnectionProfileWithAttachmentSupport {
  const supportedMimeTypes = getProfileSupportedMimeTypes(profile)
  const supportedFileTypes = {
    images: supportedMimeTypes.filter((t) => t.startsWith('image/')),
    documents: supportedMimeTypes.filter((t) => t === 'application/pdf'),
    text: supportedMimeTypes.filter((t) => t.startsWith('text/')),
    all: supportedMimeTypes,
  }
  return {
    ...profile,
    supportedMimeTypes,
    supportsFileAttachments: supportedMimeTypes.length > 0,
    supportedFileTypes,
    attachmentSupportDescription: getProfileAttachmentSupportDescription(profile),
  }
}

/**
 * Enrich multiple connection profiles with attachment support information
 *
 * @param profiles Array of connection profiles
 * @returns Array of enriched connection profiles
 */
export function enrichConnectionProfiles(
  profiles: ConnectionProfile[]
): ConnectionProfileWithAttachmentSupport[] {
  return profiles.map(enrichConnectionProfileWithAttachmentSupport)
}

/**
 * Check if a connection profile supports a specific MIME type
 *
 * @param profile The connection profile
 * @param mimeType The MIME type to check
 * @returns true if the profile supports this MIME type
 */
export function profileSupportsMimeType(
  profile: ConnectionProfile,
  mimeType: string
): boolean {
  if (mimeType.startsWith('image/')) {
    return profile.supportsImageUpload === true
  }
  return supportsMimeType(profile.provider, mimeType, profile.baseUrl ?? undefined)
}

/**
 * Filter connection profiles that support file attachments
 *
 * @param profiles Array of connection profiles
 * @returns Array of profiles that support file attachments
 */
export function filterProfilesWithAttachmentSupport(
  profiles: ConnectionProfile[]
): ConnectionProfile[] {
  return profiles.filter(profile => getProfileSupportedMimeTypes(profile).length > 0)
}

/**
 * Filter connection profiles that support a specific MIME type
 *
 * @param profiles Array of connection profiles
 * @param mimeType The MIME type to filter by
 * @returns Array of profiles that support this MIME type
 */
export function filterProfilesBySupportedMimeType(
  profiles: ConnectionProfile[],
  mimeType: string
): ConnectionProfile[] {
  return profiles.filter(profile => profileSupportsMimeType(profile, mimeType))
}

/**
 * Get the best connection profile for a file based on MIME type
 * Prioritizes profiles marked as default, then by creation date
 *
 * @param profiles Array of connection profiles
 * @param mimeType The MIME type of the file
 * @returns Best matching profile or null if none support the file type
 */
export function getBestProfileForFile(
  profiles: ConnectionProfile[],
  mimeType: string
): ConnectionProfile | null {
  const supportingProfiles = filterProfilesBySupportedMimeType(profiles, mimeType)

  if (supportingProfiles.length === 0) {
    return null
  }

  // Prioritize default profile
  const defaultProfile = supportingProfiles.find(p => p.isDefault)
  if (defaultProfile) {
    return defaultProfile
  }

  // Return most recently created profile
  return supportingProfiles.sort((a, b) => {
    const dateA = new Date(a.createdAt).getTime()
    const dateB = new Date(b.createdAt).getTime()
    return dateB - dateA
  })[0]
}

/**
 * Group connection profiles by their attachment support capabilities
 *
 * @param profiles Array of connection profiles
 * @returns Object with profiles grouped by support type
 */
export function groupProfilesByAttachmentSupport(profiles: ConnectionProfile[]): {
  supportsImages: ConnectionProfile[]
  supportsDocuments: ConnectionProfile[]
  supportsText: ConnectionProfile[]
  supportsAny: ConnectionProfile[]
  supportsNone: ConnectionProfile[]
} {
  const supportsImages: ConnectionProfile[] = []
  const supportsDocuments: ConnectionProfile[] = []
  const supportsText: ConnectionProfile[] = []
  const supportsAny: ConnectionProfile[] = []
  const supportsNone: ConnectionProfile[] = []

  for (const profile of profiles) {
    const supportedMimeTypes = getProfileSupportedMimeTypes(profile)

    if (supportedMimeTypes.length === 0) {
      supportsNone.push(profile)
    } else {
      supportsAny.push(profile)

      if (supportedMimeTypes.some((t) => t.startsWith('image/'))) {
        supportsImages.push(profile)
      }
      if (supportedMimeTypes.some((t) => t === 'application/pdf')) {
        supportsDocuments.push(profile)
      }
      if (supportedMimeTypes.some((t) => t.startsWith('text/'))) {
        supportsText.push(profile)
      }
    }
  }

  return {
    supportsImages,
    supportsDocuments,
    supportsText,
    supportsAny,
    supportsNone,
  }
}
