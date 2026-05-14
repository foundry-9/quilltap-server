import type { ExportEntityType } from '@/lib/export/types'

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
