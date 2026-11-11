/**
 * The id-field table covers every UUID-typed field.
 *
 * Walks the Zod schema of every entity restore and import carry, collects each
 * field typed `z.uuid()` (or an array of them), and fails for any that is
 * neither in `ID_FIELDS` nor in `ID_FIELD_EXEMPTIONS`. A new id-bearing field
 * therefore cannot ship without someone deciding what it names and what
 * becomes of it when it does not resolve.
 */

import { describe, it, expect } from '@jest/globals'
import { z } from 'zod'
import * as S from '@/lib/schemas/types'
import * as MI from '@/lib/schemas/mount-index.types'
import { ChatDocumentSchema } from '@/lib/schemas/chat-document.types'
import { ChatInformSchema } from '@/lib/schemas/chat-inform.types'
import { ChatWardrobeHistoryRowSchema } from '@/lib/schemas/chat-wardrobe-history.types'
import { ChatAvatarTimelineRowSchema } from '@/lib/schemas/chat-avatar-timeline.types'
import { WardrobeWearStatsRowSchema } from '@/lib/schemas/wardrobe-wear.types'
import { CharacterPluginDataSchema } from '@/lib/schemas/character-plugin-data.types'
import { LogEntrySchema } from '@/lib/schemas/log-entry.types'
import { ConversationAnnotationSchema, ConversationChunkSchema } from '@/lib/schemas/scriptorium.types'
import { TfidfVocabularySchema, EmbeddingStatusSchema } from '@/lib/schemas/embedding-job.types'
import { ID_FIELDS, ID_FIELD_EXEMPTIONS, type IdEntity } from '@/lib/backup/id-fields'

const SCHEMAS: Record<IdEntity, z.ZodType> = {
  character: S.CharacterSchema,
  chat: S.ChatMetadataSchema,
  message: S.MessageEventSchema,
  tag: S.TagSchema,
  connectionProfile: S.ConnectionProfileSchema,
  imageProfile: S.ImageProfileSchema,
  embeddingProfile: S.EmbeddingProfileSchema,
  roleplayTemplate: S.RoleplayTemplateSchema,
  promptTemplate: S.PromptTemplateSchema,
  project: S.ProjectSchema,
  group: S.GroupSchema,
  memory: S.MemorySchema,
  file: S.FileEntrySchema,
  folder: S.FolderSchema,
  chatSettings: S.ChatSettingsSchema,
  llmLog: S.LLMLogSchema,
  logEntry: LogEntrySchema,
  pluginConfig: S.PluginConfigSchema,
  chatDocument: ChatDocumentSchema,
  chatInform: ChatInformSchema,
  conversationAnnotation: ConversationAnnotationSchema,
  conversationChunk: ConversationChunkSchema,
  wardrobeHistory: ChatWardrobeHistoryRowSchema,
  avatarTimeline: ChatAvatarTimelineRowSchema,
  wardrobeWear: WardrobeWearStatsRowSchema,
  characterPluginData: CharacterPluginDataSchema,
  tfidfVocabulary: TfidfVocabularySchema,
  embeddingStatus: EmbeddingStatusSchema,
  docMountPoint: MI.DocMountPointSchema,
  docMountFolder: MI.DocMountFolderSchema,
  docMountFile: MI.DocMountFileSchema,
  docMountFileLink: MI.DocMountFileLinkSchema,
  docMountChunk: MI.DocMountChunkSchema,
  docMountDocument: MI.DocMountDocumentSchema,
  docMountBlob: MI.DocMountBlobMetadataSchema,
  projectDocMountLink: MI.ProjectDocMountLinkSchema,
  groupDocMountLink: MI.GroupDocMountLinkSchema,
  groupCharacterMember: MI.GroupCharacterMemberSchema,
}

/** Paths of every UUID-typed field under `schema`, in the table's grammar. */
function uuidPaths(schema: unknown, path = '', out = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (!schema || seen.has(schema)) return out
  const def = (schema as { _zod?: { def?: Record<string, any> } })._zod?.def
  if (!def) return out
  if (schema instanceof z.ZodUUID) {
    out.add(path)
    return out
  }
  const next = new Set(seen).add(schema)
  switch (def.type) {
    case 'optional': case 'nullable': case 'default': case 'prefault':
    case 'readonly': case 'catch': case 'nonoptional':
      return uuidPaths(def.innerType, path, out, next)
    case 'pipe':
      uuidPaths(def.in, path, out, next)
      return uuidPaths(def.out, path, out, next)
    case 'lazy':
      return uuidPaths(def.getter(), path, out, next)
    case 'array':
      return uuidPaths(def.element, `${path}[]`, out, next)
    case 'record':
      uuidPaths(def.keyType, `${path}{key}`, out, next)
      return uuidPaths(def.valueType, `${path}{}`, out, next)
    case 'union':
      for (const option of def.options) uuidPaths(option, path, out, next)
      return out
    case 'intersection':
      uuidPaths(def.left, path, out, next)
      return uuidPaths(def.right, path, out, next)
    case 'object':
      for (const [key, value] of Object.entries(def.shape as Record<string, unknown>)) {
        uuidPaths(value, path ? `${path}.${key}` : key, out, next)
      }
      return out
    default:
      return out
  }
}

const ALWAYS_EXEMPT = new Set(['id', 'userId'])

describe('id-field table guard', () => {
  it.each(Object.entries(SCHEMAS))('%s: every UUID field is listed or exempt', (entity, schema) => {
    const listed = new Set([
      ...ID_FIELDS.filter((f) => f.entity === entity).map((f) => f.path),
      ...ID_FIELD_EXEMPTIONS.filter((f) => f.entity === entity).map((f) => f.path),
    ])
    const unlisted = [...uuidPaths(schema)].filter((path) => !ALWAYS_EXEMPT.has(path) && !listed.has(path))
    expect(unlisted).toEqual([])
  })

  it('has no duplicate entries and no exemption that is also listed', () => {
    const keys = ID_FIELDS.map((f) => `${f.entity}:${f.path}`)
    expect(new Set(keys).size).toBe(keys.length)
    const exempt = ID_FIELD_EXEMPTIONS.map((f) => `${f.entity}:${f.path}`)
    expect(exempt.filter((key) => keys.includes(key))).toEqual([])
  })

  it('every exemption still names a UUID field the schema has', () => {
    const stale = ID_FIELD_EXEMPTIONS.filter(
      (f) => !uuidPaths(SCHEMAS[f.entity]).has(f.path)
    ).map((f) => `${f.entity}:${f.path}`)
    expect(stale).toEqual([])
  })
})
