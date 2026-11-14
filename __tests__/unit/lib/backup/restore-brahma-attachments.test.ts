/**
 * New-account restore: a Brahma Console message's attachments are mount-file
 * link ids (under Brahma/ in Quilltap General), and follow their link through
 * the id-field table's `message.attachments[]` entry like any other id the
 * backup carries. One the backup does not carry is kept (the transcript then
 * shows the attachment as missing).
 */

import { describe, it, expect } from '@jest/globals'
import { remapBackupData } from '@/lib/backup/restore/uuid-remap'
import { UuidRemapper } from '@/lib/backup/uuid-remapper'
import type { BackupData } from '@/lib/backup/types'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CHAT = u(1)
const MSG = u(2)
const GENERAL = u(3)
const DOC_FILE = u(4)
const LINK = u(5)
const NOT_IN_BACKUP = u(6)

function backup(): BackupData {
  return {
    manifest: {} as BackupData['manifest'],
    characters: [],
    chats: [{
      id: CHAT, title: 'Console', tags: [], chatType: 'brahma', consoleMode: 'writing',
      participants: [],
      messages: [{ id: MSG, role: 'USER', attachments: [LINK, NOT_IN_BACKUP] }],
    }],
    tags: [],
    connectionProfiles: [],
    imageProfiles: [],
    embeddingProfiles: [],
    memories: [],
    files: [],
    promptTemplates: [],
    roleplayTemplates: [],
    providerModels: [],
    projects: [],
    llmLogs: [],
    docMountPoints: [{ id: GENERAL, name: 'Quilltap General' }],
    docMountFiles: [{ id: DOC_FILE }],
    docMountFileLinks: [{ id: LINK, mountPointId: GENERAL, fileId: DOC_FILE, relativePath: 'Brahma/photo.webp' }],
  } as unknown as BackupData
}

describe('restore: Brahma Console attachments', () => {
  it('remaps a link id the backup carries and keeps one it does not', () => {
    const remapper = new UuidRemapper()
    const result = remapBackupData(backup(), 'target-user', remapper)
    const map = remapper.getMapping()
    const message = (result.chats[0] as unknown as { messages: Array<{ attachments: string[] }> }).messages[0]
    expect(result.docMountFileLinks?.[0].id).toBe(map[LINK])
    expect(message.attachments).toEqual([map[LINK], NOT_IN_BACKUP])
  })
})
