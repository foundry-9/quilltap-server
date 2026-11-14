/**
 * New-account restore remaps through the id-field table (refactor 4.13 spec 2).
 *
 * - #190: a chat's and a participant's `roleplayTemplateId` follow their
 *   template; a built-in template keeps its fixed id.
 * - The §4.2 gaps: summary anchors, archive file pointers, the Console's
 *   profile and the ids inside message payloads now follow their rows.
 * - Nothing is minted for a reference to a row the backup does not carry.
 * - Referential integrity, walked off the table: every listed reference in
 *   the remapped backup names a row the backup carries, is null, or is a
 *   `keep` the backup never had.
 */

import { describe, it, expect } from '@jest/globals'
import { remapBackupData } from '@/lib/backup/restore/uuid-remap'
import { UuidRemapper } from '@/lib/backup/uuid-remapper'
import { ID_FIELDS } from '@/lib/backup/id-fields'
import { builtInRoleplayTemplateId } from '@/lib/roleplay-templates/built-in-ids'
import type { BackupData } from '@/lib/backup/types'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CHARACTER = u(1)
const CHAT = u(2)
const SEAT = u(3)
const MSG_1 = u(4)
const MSG_2 = u(5)
const TEMPLATE = u(6)
const PROFILE = u(7)
const IMAGE_PROFILE = u(8)
const FILE = u(9)
const ARCHIVE_FILE = u(10)
const MISSING_PROFILE = u(11)
const MISSING_MESSAGE = u(12)
const MOUNT = u(13)
const DOC_FILE = u(14)
const LINK = u(15)
const LINK_GROUP = u(16)
const PROJECT = u(17)
const MISSING_STORE = u(18)
const STANDARD = builtInRoleplayTemplateId('Standard')

function backup(): BackupData {
  return {
    manifest: {} as BackupData['manifest'],
    characters: [{
      id: CHARACTER, name: 'Ada', tags: [], defaultRoleplayTemplateId: TEMPLATE,
      archiveFileId: ARCHIVE_FILE, archivedAvatarFileId: FILE,
    }],
    chats: [{
      id: CHAT, title: 'Salon', tags: [],
      roleplayTemplateId: STANDARD,
      imageProfileId: MISSING_PROFILE,
      consoleConnectionProfileId: PROFILE,
      consoleContext: [
        { kind: 'chat', id: CHAT },
        { kind: 'project', id: PROJECT },
        { kind: 'store', id: MOUNT },
        { kind: 'store', id: MISSING_STORE },
        { kind: 'general' },
      ],
      summaryAnchorMessageIds: [MSG_1, MISSING_MESSAGE],
      participants: [{ id: SEAT, characterId: CHARACTER, connectionProfileId: PROFILE, imageProfileId: IMAGE_PROFILE, roleplayTemplateId: TEMPLATE }],
      messages: [
        { id: MSG_1, participantId: SEAT, attachments: [FILE] },
        {
          id: MSG_2, participantId: SEAT, swipeGroupId: `swipe-${MSG_1}`,
          carinaMeta: { answererId: CHARACTER, question: 'Why?' },
          hostEvent: { participantId: SEAT, introducedCharacterIds: [CHARACTER] },
          pascalMeta: { callerParticipantId: SEAT },
          pendingExternalAttachments: [{ fileId: FILE, filename: 'a', mimeType: 'x', sizeBytes: 1, downloadUrl: '/' }],
        },
      ],
    }],
    tags: [],
    connectionProfiles: [{ id: PROFILE, name: 'P', tags: [] }],
    imageProfiles: [{ id: IMAGE_PROFILE, name: 'I', tags: [] }],
    embeddingProfiles: [],
    memories: [],
    files: [{ id: FILE, linkedTo: [], tags: [] }, { id: ARCHIVE_FILE, linkedTo: [], tags: [] }],
    promptTemplates: [],
    roleplayTemplates: [{ id: TEMPLATE, name: 'Mine', tags: [] }],
    providerModels: [],
    projects: [{ id: PROJECT, name: 'Ashfall', tags: [] }],
    llmLogs: [],
    docMountPoints: [{ id: MOUNT, name: 'Store' }],
    docMountFiles: [{ id: DOC_FILE }],
    docMountFileLinks: [{ id: LINK, mountPointId: MOUNT, fileId: DOC_FILE, relativePath: 'a.md', linkGroupId: LINK_GROUP }],
    chatDocuments: [
      { id: u(20), chatId: CHAT, filePath: 'a.md' },
      { id: u(21), chatId: u(99), filePath: 'b.md' },
    ],
  } as unknown as BackupData
}

describe('restore remaps through the id-field table', () => {
  const remapper = new UuidRemapper()
  const result = remapBackupData(backup(), 'target-user', remapper)
  const map = remapper.getMapping()
  const chat = result.chats[0] as unknown as Record<string, any>

  it('#190: roleplay template pointers follow the template; a built-in keeps its fixed id', () => {
    expect(result.roleplayTemplates[0].id).toBe(map[TEMPLATE])
    expect(chat.participants[0].roleplayTemplateId).toBe(map[TEMPLATE])
    expect((result.characters[0] as unknown as Record<string, unknown>).defaultRoleplayTemplateId).toBe(map[TEMPLATE])
    expect(chat.roleplayTemplateId).toBe(STANDARD)
  })

  it('remaps the ids §4.2 found left behind', () => {
    const character = result.characters[0] as unknown as Record<string, unknown>
    expect(character.archiveFileId).toBe(map[ARCHIVE_FILE])
    expect(character.archivedAvatarFileId).toBe(map[FILE])
    expect(chat.consoleConnectionProfileId).toBe(map[PROFILE])
    expect(chat.summaryAnchorMessageIds).toEqual([map[MSG_1]])
    const [, second] = chat.messages
    expect(second.carinaMeta.answererId).toBe(map[CHARACTER])
    expect(second.hostEvent).toEqual({ participantId: map[SEAT], introducedCharacterIds: [map[CHARACTER]] })
    expect(second.pascalMeta.callerParticipantId).toBe(map[SEAT])
    expect(second.pendingExternalAttachments[0].fileId).toBe(map[FILE])
    // Decision §8.2: `swipe-<id>` follows its message.
    expect(second.swipeGroupId).toBe(`swipe-${map[MSG_1]}`)
  })

  it('remaps a Writing Assistant context by kind and drops a missing target', () => {
    expect(chat.consoleContext).toEqual([
      { kind: 'chat', id: map[CHAT] },
      { kind: 'project', id: map[PROJECT] },
      { kind: 'store', id: map[MOUNT] },
      { kind: 'general' },
    ])
    expect(map[MISSING_STORE]).toBeUndefined()
  })

  it('mints nothing for a reference the backup does not carry', () => {
    // Decision §8.2: an image profile that is not here is cleared.
    expect(chat.imageProfileId).toBeNull()
    expect(map[MISSING_PROFILE]).toBeUndefined()
    expect(map[MISSING_MESSAGE]).toBeUndefined()
  })

  it('drops a sidecar whose chat is not in the backup', () => {
    expect(result.chatDocuments).toHaveLength(1)
    expect(result.chatDocuments?.[0].chatId).toBe(map[CHAT])
  })

  it('reissues a hard-link group key so the copy does not join the source group', () => {
    const link = result.docMountFileLinks?.[0]
    expect(link?.linkGroupId).toBeDefined()
    expect(link?.linkGroupId).not.toBe(LINK_GROUP)
  })

  it('leaves every listed reference resolved, null, or a kept id the backup never had', () => {
    const issued = new Set(Object.values(map))
    const sourceIds = new Set(Object.keys(map))
    const violations: string[] = []
    const visit = (entity: string, row: unknown, field: (typeof ID_FIELDS)[number]) => {
      const values: unknown[] = []
      const walk = (node: unknown, segments: string[]) => {
        if (node === null || node === undefined || typeof node !== 'object') return
        const [head, ...rest] = segments
        const isArray = head.endsWith('[]')
        const value = (node as Record<string, unknown>)[isArray ? head.slice(0, -2) : head]
        if (rest.length === 0) {
          if (isArray && Array.isArray(value)) values.push(...value)
          else values.push(value)
          return
        }
        if (isArray && Array.isArray(value)) value.forEach((element) => walk(element, rest))
        else walk(value, rest)
      }
      walk(row, field.path.split('.'))
      for (const value of values) {
        if (value === null || value === undefined || typeof value !== 'string') continue
        const id = field.encoding === 'swipe-prefix' && value.startsWith('swipe-') ? value.slice(6) : value
        if (issued.has(id) || id === STANDARD) continue
        // A source id surviving means a reference the remap should have followed.
        if (sourceIds.has(id)) violations.push(`${entity}.${field.path} = ${id}`)
        else if (field.onMissing !== 'keep') violations.push(`${entity}.${field.path} unresolved ${id}`)
      }
    }
    const collections: Array<[string, unknown[]]> = [
      ['character', result.characters], ['chat', result.chats],
      ['message', result.chats.flatMap((c) => c.messages)],
      ['roleplayTemplate', result.roleplayTemplates], ['connectionProfile', result.connectionProfiles],
      ['chatDocument', result.chatDocuments ?? []], ['docMountFileLink', result.docMountFileLinks ?? []],
    ]
    for (const [entity, rows] of collections) {
      for (const field of ID_FIELDS.filter((f) => f.entity === entity && !f.bespoke?.restore)) {
        for (const row of rows) visit(entity, row, field)
      }
    }
    expect(violations).toEqual([])
  })
})
