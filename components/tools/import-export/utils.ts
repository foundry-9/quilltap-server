import type { ExportEntityType } from '@/lib/export/types'

/**
 * Format date string to localized display format
 */
export function formatDate(dateString: string): string {
  try {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateString
  }
}

/**
 * Map camelCase entity keys from API to kebab-case ExportEntityType
 */
export function toExportEntityType(key: string): ExportEntityType {
  const mapping: Record<string, ExportEntityType> = {
    characters: 'characters',
    chats: 'chats',
    tags: 'tags',
    connectionProfiles: 'connection-profiles',
    imageProfiles: 'image-profiles',
    embeddingProfiles: 'embedding-profiles',
    roleplayTemplates: 'roleplay-templates',
  }
  return mapping[key] || (key as ExportEntityType)
}
