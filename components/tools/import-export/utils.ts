import type { ExportEntityType } from '@/lib/export/types'
import type { ImportPreviewUI } from './types'

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
    promptTemplates: 'prompt-templates',
    projects: 'projects',
    groups: 'groups',
    documentStores: 'document-stores',
    files: 'files',
    providerModels: 'provider-models',
    pluginConfigs: 'plugin-configs',
    instanceSettings: 'instance-settings',
  }
  return mapping[key] || (key as ExportEntityType)
}

/**
 * Whether an import preview says the file carries memories. The preview
 * reports them as `entities.memories: { count }` beside the entity lists.
 */
export function previewHasMemories(preview: ImportPreviewUI | null): boolean {
  const memories = preview?.entities?.memories as { count?: number } | undefined
  return (memories?.count ?? 0) > 0
}
