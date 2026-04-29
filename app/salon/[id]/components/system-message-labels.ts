import type { Message } from '../types'

const SENDER_DISPLAY_NAMES: Record<NonNullable<Message['systemSender']>, string> = {
  lantern: 'The Lantern',
  aurora: 'Aurora',
  librarian: 'The Librarian',
  concierge: 'The Concierge',
  prospero: 'Prospero',
  host: 'The Host',
  commonplaceBook: 'The Commonplace Book',
}

const KIND_DISPLAY_OVERRIDES: Record<string, string> = {
  'project-context': 'project information',
  'connection-profile-change': 'connection change',
  'tool-run': 'tool run',
  'memory-recap': 'memory recap',
  'relevant-memories': 'relevant memories',
  'inter-character-memories': 'inter-character memories',
  'opening-outfit': 'opening outfit',
  'outfit-change': 'outfit change',
  'opened-by-user': 'opened by user',
  'opened-by-character': 'opened by character',
  'deleted-by-user': 'deleted by user',
  'deleted-by-character': 'deleted by character',
  'folder-created-by-user': 'folder created by user',
  'folder-created-by-character': 'folder created by character',
  'folder-deleted-by-user': 'folder deleted by user',
  'folder-deleted-by-character': 'folder deleted by character',
  'silent-mode-enter': 'silent mode (entering)',
  'silent-mode-exit': 'silent mode (leaving)',
  'user-character': 'user character',
  'character-image': 'character image',
  'join-scenario': 'join scenario',
  'status-change': 'status change',
  timestamp: 'time',
}

export function getSystemSenderDisplayName(sender: Message['systemSender']): string {
  if (!sender) return ''
  return SENDER_DISPLAY_NAMES[sender] ?? sender
}

/**
 * Best-effort kind inference for Staff messages persisted before the
 * `systemKind` column landed (or any future writer that forgets to set it).
 * Patterns track the persona-voiced phrasing each writer uses so display
 * labels stay sensible even on legacy rows. Falls back to a generic
 * per-sender label when nothing matches.
 */
function inferKindFromContent(sender: NonNullable<Message['systemSender']>, content: string): string {
  const c = content
  switch (sender) {
    case 'host':
      if (c.startsWith('The Host welcomes')) return 'add'
      if (c.startsWith('The Host bids')) return 'remove'
      if (c.startsWith('The Host notes that') && c.includes(' is now ')) return 'status-change'
      if (c.startsWith('The Host sets the scene')) return 'scenario'
      if (c.startsWith('The Host outlines the company')) return 'roster'
      if (c.startsWith('The Host marks the time')) return 'timestamp'
      if (c.startsWith('The Host introduces')) return 'user-character'
      if (c.startsWith('The Host whispers a private note')) {
        if (c.includes('SILENT mode')) return 'silent-mode-enter'
        if (c.includes('silence is lifted')) return 'silent-mode-exit'
        if (c.includes('recounting how they came')) return 'join-scenario'
      }
      return 'announcement'
    case 'lantern':
      if (c.includes('projected a new backdrop')) return 'background'
      if (c.includes('acting upon the instructions of')) return 'character-image'
      return 'image'
    case 'aurora':
      if (c.includes('refreshed the portrait')) return 'avatar'
      if (c.includes('marks an alteration')) return 'outfit-change'
      if (c.includes('pronounces upon their attire')) return 'opening-outfit'
      return 'wardrobe'
    case 'concierge':
      return 'danger'
    case 'prospero':
      if (c.startsWith('Prospero notes that')) return 'connection-profile-change'
      if (c.startsWith('Prospero opens his ledger')) return 'project-context'
      return 'announcement'
    case 'librarian':
      if (c.includes('rechristened')) return 'renamed'
      if (c.includes('filed the following alterations')) return 'saved'
      if (c.includes('removed "') || c.includes('struck from the catalogue')) return 'deleted'
      if (c.includes('set aside a fresh shelf')) return 'folder-created'
      if (c.includes('dismantled the empty shelf')) return 'folder-deleted'
      if (c.includes('upon the table for your perusal')) return 'attached'
      if (c.includes('deposits a précis')) return 'summary'
      if (c.includes('laid out a fresh, blank page') || c.includes('has set out')) return 'opened'
      return 'announcement'
    case 'commonplaceBook':
      if (c.includes('lays open at your bookmark')) return 'memory-recap'
      if (c.includes('turns to the entries')) return 'relevant-memories'
      if (c.includes('opens to the pages where you have noted those present')) return 'inter-character-memories'
      return 'consolidated'
  }
}

export function getSystemKindDisplayLabel(message: Pick<Message, 'systemSender' | 'systemKind' | 'content'>): string {
  const explicit = message.systemKind
  if (explicit) {
    return KIND_DISPLAY_OVERRIDES[explicit] ?? explicit.replace(/-/g, ' ')
  }
  if (!message.systemSender) return ''
  const inferred = inferKindFromContent(message.systemSender, message.content || '')
  return KIND_DISPLAY_OVERRIDES[inferred] ?? inferred.replace(/-/g, ' ')
}
