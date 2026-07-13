import type { Message } from '../types'

const SENDER_DISPLAY_NAMES: Record<NonNullable<Message['systemSender']>, string> = {
  lantern: 'The Lantern',
  aurora: 'Aurora',
  librarian: 'The Librarian',
  concierge: 'The Concierge',
  prospero: 'Prospero',
  host: 'The Host',
  commonplaceBook: 'The Commonplace Book',
  ariel: 'Ariel',
  carina: 'Carina',
  suparna: 'Suparṇā',
}

const KIND_DISPLAY_OVERRIDES: Record<string, string> = {
  'project-context': 'project information',
  'project-and-general-context': 'project information and context',
  'general-context': 'general context',
  'connection-profile-change': 'connection change',
  'tool-run': 'tool run',
  'carina-response': 'reference answer',
  'carina-error': 'reference desk',
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
  'created-by-user': 'created by user',
  'created-by-character': 'created by character',
  'edited-by-user': 'edited by user',
  'edited-by-character': 'edited by character',
  'moved-by-user': 'moved by user',
  'moved-by-character': 'moved by character',
  'copied-by-user': 'copied by user',
  'copied-by-character': 'copied by character',
  'blob-written-by-user': 'asset added by user',
  'blob-written-by-character': 'asset added by character',
  'silent-mode-enter': 'silent mode (entering)',
  'silent-mode-exit': 'silent mode (leaving)',
  'user-character': 'user character',
  'character-image': 'character image',
  'join-scenario': 'join scenario',
  'status-change': 'status change',
  'session-opened': 'terminal opened',
  'session-closed': 'terminal closed',
  'autonomous-room-start': 'run begun',
  'autonomous-room-end': 'run ended',
  'autonomous-room-paused': 'run paused',
  'autonomous-room-halfway': 'halfway through',
  'autonomous-room-nearing-end': 'nearing the end',
  'mail-delivery': 'mail delivery',
  'turn-pass': 'nothing to add',
  nudge: 'invited to speak',
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
      if (c.startsWith('The Host inclines his head') || c.includes('declining the floor')) return 'turn-pass'
      if (c.startsWith('The Host turns to') && c.includes('invites them to take the floor')) return 'nudge'
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
      if (c.includes('relocated the')) return 'moved'
      if (c.includes('transcribed a copy')) return 'copied'
      if (c.includes('set down a new volume') || c.includes('set down a fresh, empty page')) return 'created'
      if (c.includes('affixed the illustration') || c.includes('affixed the asset')) return 'blob-written'
      if (c.includes('filed fresh alterations')) return 'edited'
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
    case 'ariel':
      if (c.includes('opened a terminal')) return 'session-opened'
      if (c.includes('closed')) return 'session-closed'
      return 'terminal'
    case 'suparna':
      return 'mail-delivery'
  }
  return 'announcement'
}

/**
 * Resolve a Staff message to its raw (un-prettified) kind: the explicit
 * `systemKind` column when present, otherwise the best-effort inference from
 * the persona-voiced content. Shared by the display-label path and the
 * importance-tier lookup so the chip's label and its dot never key off
 * different kinds.
 */
function resolveRawKind(message: Pick<Message, 'systemSender' | 'systemKind' | 'content'>): string {
  if (message.systemKind) return message.systemKind
  if (!message.systemSender) return ''
  return inferKindFromContent(message.systemSender, message.content || '')
}

export function getSystemKindDisplayLabel(message: Pick<Message, 'systemSender' | 'systemKind' | 'content'>): string {
  const raw = resolveRawKind(message)
  if (!raw) return ''
  return KIND_DISPLAY_OVERRIDES[raw] ?? raw.replace(/-/g, ' ')
}

export type AnnouncementImportance = 'high' | 'medium' | 'low'

/**
 * Single source of truth for announcement importance tiers. Keyed by
 * `systemSender`, then by raw kind (as resolved by {@link resolveRawKind}).
 * `'*'` is a per-sender fallback; a sender absent from the table, or a kind
 * with no entry and no `'*'`, falls through to {@link DEFAULT_IMPORTANCE}.
 *
 * Tiers drive the coloured dot before the sender name in the Salon: red (high),
 * amber (medium), hollow grey (low).
 */
const IMPORTANCE_TABLE: Record<NonNullable<Message['systemSender']>, Record<string, AnnouncementImportance>> = {
  // File changes are high-signal; opening/perusing is incidental.
  librarian: {
    saved: 'high',
    deleted: 'high',
    renamed: 'high',
    'folder-created': 'high',
    'folder-deleted': 'high',
    attached: 'high',
    summary: 'medium',
    opened: 'low',
    // Character-initiated changes carry an explicit `<kind>-by-user|character`
    // systemKind, so key both the bare (legacy-inferred) and suffixed forms.
    created: 'high',
    'created-by-user': 'high',
    'created-by-character': 'high',
    edited: 'high',
    'edited-by-user': 'high',
    'edited-by-character': 'high',
    moved: 'high',
    'moved-by-user': 'high',
    'moved-by-character': 'high',
    copied: 'high',
    'copied-by-user': 'high',
    'copied-by-character': 'high',
    'blob-written': 'high',
    'blob-written-by-user': 'high',
    'blob-written-by-character': 'high',
    '*': 'medium',
  },
  // Who is in the room (and their status) matters; the clock does not.
  host: {
    add: 'high',
    remove: 'high',
    'status-change': 'high',
    'user-character': 'high',
    scenario: 'medium',
    roster: 'medium',
    timestamp: 'low',
    'join-scenario': 'low',
    'silent-mode-enter': 'low',
    'silent-mode-exit': 'low',
    // Autonomous-room lifecycle: run boundaries and the near-end pacing nudge
    // are high-signal; the start banner and the halfway nudge are medium.
    'autonomous-room-start': 'medium',
    'autonomous-room-end': 'high',
    'autonomous-room-paused': 'high',
    'autonomous-room-halfway': 'medium',
    'autonomous-room-nearing-end': 'high',
    // A turn pass ("nothing to add") is incidental — quiet, hollow dot.
    'turn-pass': 'low',
    // A nudge is a deliberate operator summon — worth an amber dot, but not the
    // red reserved for structural room changes (add / remove / status).
    nudge: 'medium',
    '*': 'medium',
  },
  concierge: { danger: 'high', '*': 'high' },
  lantern: { background: 'medium', 'character-image': 'medium', image: 'medium', '*': 'medium' },
  aurora: { avatar: 'medium', 'outfit-change': 'medium', 'opening-outfit': 'medium', wardrobe: 'medium', '*': 'medium' },
  ariel: { 'session-opened': 'medium', 'session-closed': 'medium', terminal: 'medium', '*': 'medium' },
  prospero: {
    'connection-profile-change': 'medium',
    'project-context': 'low',
    'general-context': 'low',
    'project-and-general-context': 'low',
    announcement: 'low',
    '*': 'low',
    // TODO: "mentioned characters not in the chat" is a *medium* example with no
    // current systemKind. Add its kind here when a writer emits it.
  },
  commonplaceBook: {
    'memory-recap': 'low',
    'relevant-memories': 'low',
    'inter-character-memories': 'low',
    consolidated: 'low',
    '*': 'low',
  },
  // Carina reference answers render as their own full row (never a collapsed
  // chip), so this importance tier is only a defensive fallback.
  carina: { 'carina-response': 'medium', '*': 'medium' },
  // A fresh letter is a real event the recipient should act on.
  suparna: { 'mail-delivery': 'high', '*': 'high' },
}

const DEFAULT_IMPORTANCE: AnnouncementImportance = 'medium'

/**
 * Map a Staff-authored message to its importance tier for the Salon's coloured
 * announcement dots. Keys off {@link resolveRawKind} so it stays in lockstep
 * with the displayed kind label.
 */
export function getAnnouncementImportance(
  message: Pick<Message, 'systemSender' | 'systemKind' | 'content'>,
): AnnouncementImportance {
  if (!message.systemSender) return DEFAULT_IMPORTANCE
  const senderTable = IMPORTANCE_TABLE[message.systemSender]
  if (!senderTable) return DEFAULT_IMPORTANCE
  const kind = resolveRawKind(message)
  return senderTable[kind] ?? senderTable['*'] ?? DEFAULT_IMPORTANCE
}
