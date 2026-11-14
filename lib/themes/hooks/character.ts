/**
 * Theme hooks — the character page (`app/aurora/[id]/`).
 *
 * @module lib/themes/hooks/character
 */

import type { HookDef } from './types'

/**
 * The character page's field sections, by anchor — `SectionCard`'s `anchor`
 * prop, written as its `id` and as `data-section`. The prop is typed from this
 * list, so a new anchor is added here first.
 */
export const CHARACTER_SECTION_ANCHORS = [
  'facts',
  'dossier',
  'metadata',
  'physical-description',
  'scenarios',
  'vault',
  'conversations',
  'memories',
  'bulk-edits',
  'wardrobe',
  'inventory',
  'atlas',
  'photos',
  'depiction-guidelines',
  'trust',
  'talents',
  'wardrobe-permissions',
  'control',
  'connection-profile',
  'conversation-partner',
  'image-profile',
  'timestamps',
  'chat-tools',
] as const
export type CharacterSectionAnchor = (typeof CHARACTER_SECTION_ANCHORS)[number]

export const CHARACTER_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-character-page',
    surface: 'character',
    label: 'Character page',
    description: 'Also carries the older bare `character-page` class.',
    since: 1,
  },
  {
    className: 'qt-character-header',
    surface: 'character',
    label: 'Character header',
    description: 'The sticky header: back link, avatar, name and meta, actions.',
    within: ['qt-character-page'],
    since: 1,
  },
  {
    className: 'qt-character-avatar',
    surface: 'character',
    label: 'Character avatar',
    description: 'The avatar region; a menu button for changing the picture.',
    within: ['qt-character-header'],
    since: 1,
  },
  {
    className: 'qt-character-identity',
    surface: 'character',
    label: 'Character name and meta',
    description: 'Name, favourite star, title, pronouns, age, kind badges, then tags and stats.',
    within: ['qt-character-header'],
    since: 1,
  },
  {
    className: 'qt-character-tags',
    surface: 'character',
    label: 'Character tags',
    description: 'Alias and group pills.',
    within: ['qt-character-identity'],
    since: 1,
  },
  {
    className: 'qt-character-stats',
    surface: 'character',
    label: 'Character stats',
    description: 'The counts line (chats, memories, photos, …).',
    within: ['qt-character-identity'],
    since: 1,
  },
  {
    className: 'qt-character-actions',
    surface: 'character',
    label: 'Character actions',
    description: 'Start a chat, and the action menus.',
    within: ['qt-character-header'],
    since: 1,
  },
  {
    className: 'qt-character-archived-banner',
    surface: 'character',
    label: 'Archived banner',
    description: 'Shown when the character rests in the archive.',
    within: ['qt-character-page'],
    since: 1,
  },
  {
    className: 'qt-section-card',
    surface: 'character',
    label: 'Character field section',
    description: 'One card of a character-page section. Also a `qt-card`.',
    within: ['qt-character-page'],
    variants: [{ attribute: 'data-section', values: CHARACTER_SECTION_ANCHORS, description: 'Which section, by its anchor.' }],
    since: 1,
  },
  {
    className: 'qt-section-card-header',
    surface: 'character',
    label: 'Field section header',
    within: ['qt-section-card'],
    since: 1,
  },
  {
    className: 'qt-section-card-body',
    surface: 'character',
    label: 'Field section body',
    within: ['qt-section-card'],
    since: 1,
  },
]
