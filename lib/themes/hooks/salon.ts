/**
 * Theme hooks — the Salon (`app/salon/[id]/`, `components/chat/`).
 *
 * No speaker, character or chat id is exposed on any element: a theme styles
 * kinds of message, never particular people.
 *
 * @module lib/themes/hooks/salon
 */

import { SystemSenderEnum } from '@/lib/schemas/chat.types'
import type { HookDef, HookState } from './types'

/** Who, in kind, wrote a message row — `data-role`. */
export const SALON_ROW_ROLES = ['user', 'assistant', 'staff', 'tool'] as const
export type SalonRowRole = (typeof SALON_ROW_ROLES)[number]

/** Which Staff member posted — `data-staff`, the `systemSender` enum. */
export const SALON_STAFF_SENDERS = SystemSenderEnum.options

const BUBBLE_STATES: HookState[] = [
  { kind: 'class', className: 'qt-chat-message-whisper', label: 'A whisper' },
  { kind: 'class', className: 'qt-chat-message-whisper-overheard', label: 'A whisper you overheard' },
  { kind: 'class', className: 'qt-chat-message-silent', label: 'Written in silent mode' },
  { kind: 'class', className: 'qt-chat-message-regenerating', label: 'Being regenerated' },
  { kind: 'aria', attribute: 'aria-busy', values: ['true'], label: 'Being regenerated' },
]

export const SALON_HOOKS: readonly HookDef[] = [
  {
    className: 'qt-chat-message-row',
    surface: 'salon',
    label: 'Message row',
    description:
      'One message: avatar and bubble. The class alone tells user from not-user (`-user` / `-assistant` below); `data-role` tells a Staff announcement, a tool run and a character line apart. Standalone tool results are `qt-chat-message-row-tool` instead, with `data-role="tool"`.',
    variants: [
      { attribute: 'data-role', values: SALON_ROW_ROLES, description: 'Who, in kind, wrote it.' },
      { attribute: 'data-staff', values: SALON_STAFF_SENDERS, description: 'On Staff rows only: which member of staff posted it.' },
    ],
    since: 1,
  },
  {
    className: 'qt-chat-message-row-user',
    surface: 'salon',
    label: 'Message row, user side',
    description: 'Added to a row written from a user seat. Kept beside `data-role` for existing themes.',
    since: 1,
  },
  {
    className: 'qt-chat-message-row-assistant',
    surface: 'salon',
    label: 'Message row, character side',
    description: 'Added to every row not from a user seat — Staff announcements included; use `data-role` to tell them apart.',
    since: 1,
  },
  {
    className: 'qt-chat-message-row-courier',
    surface: 'salon',
    label: 'Courier row',
    description: 'A manual (copy-and-paste) turn awaiting its answer.',
    since: 1,
  },
  {
    className: 'qt-chat-established-fact-row',
    surface: 'salon',
    label: 'Established-fact row',
    description: 'A machine-delivered fact, drawn as a full-width band.',
    since: 1,
  },
  {
    className: 'qt-chat-message-row-tool',
    surface: 'salon',
    label: 'Tool result row',
    description: 'A standalone tool result (not folded into a bubble). Carries `data-role="tool"`.',
    variants: [{ attribute: 'data-role', values: ['tool'] }],
    since: 1,
  },
  {
    className: 'qt-chat-desktop-avatar',
    surface: 'salon',
    label: 'Message avatar column',
    description: "The speaker's picture, name and title beside the bubble.",
    within: ['qt-chat-message-row'],
    states: [{ kind: 'class', className: 'qt-chat-avatar-dangerous', label: 'The chat is Unmoderated' }],
    since: 1,
  },
  {
    className: 'qt-chat-avatar-carried',
    surface: 'salon',
    label: 'Carried items',
    description: 'The strip of carried-object glyphs under a message avatar.',
    within: ['qt-chat-desktop-avatar'],
    since: 1,
  },
  {
    className: 'qt-chat-message-body',
    surface: 'salon',
    label: 'Message body column',
    within: ['qt-chat-message-row'],
    since: 1,
  },
  {
    className: 'qt-chat-message-user',
    surface: 'salon',
    label: 'User bubble',
    within: ['qt-chat-message-body'],
    states: BUBBLE_STATES,
    since: 1,
  },
  {
    className: 'qt-chat-message-assistant',
    surface: 'salon',
    label: 'Character bubble',
    within: ['qt-chat-message-body'],
    states: BUBBLE_STATES,
    since: 1,
  },
  {
    className: 'qt-chat-message-streaming',
    surface: 'salon',
    label: 'Streaming bubble',
    description:
      'The bubble a reply streams into. It does not carry `qt-chat-message-assistant`, whose styling differs; style the two together by listing both.',
    within: ['qt-chat-message-body'],
    since: 1,
  },
  {
    className: 'qt-chat-whisper-label',
    surface: 'salon',
    label: 'Whisper label',
    within: ['qt-chat-message-body'],
    since: 1,
  },
  {
    className: 'qt-chat-silent-label',
    surface: 'salon',
    label: 'Silent-mode label',
    within: ['qt-chat-message-body'],
    since: 1,
  },
  {
    className: 'qt-chat-message-established-fact',
    surface: 'salon',
    label: 'Established-fact ribbon',
    description: 'On a user line posted as established fact.',
    within: ['qt-chat-message-body'],
    since: 1,
  },
  {
    className: 'qt-chat-established-fact-band',
    surface: 'salon',
    label: 'Established-fact band',
    within: ['qt-chat-established-fact-row'],
    since: 1,
  },
  {
    className: 'qt-chat-system-bar',
    surface: 'salon',
    label: 'Staff announcement bar',
    description: 'The header of an expanded Staff announcement; its row carries `data-staff`.',
    within: ['qt-chat-message-body'],
    states: [
      { kind: 'class', className: 'qt-chat-system-bar-expanded', label: 'Expanded' },
      { kind: 'aria', attribute: 'aria-expanded', values: ['true'], label: 'Expanded' },
    ],
    since: 1,
  },
  {
    className: 'qt-chat-announcement-group',
    surface: 'salon',
    label: 'Collapsed announcements',
    description: 'A run of collapsed Staff announcements packed into one row of chips.',
    since: 1,
  },
  {
    className: 'qt-chat-announcement-chip',
    surface: 'salon',
    label: 'Staff announcement chip',
    description: 'One collapsed Staff announcement.',
    variants: [{ attribute: 'data-staff', values: SALON_STAFF_SENDERS, description: 'Which member of staff posted it.' }],
    states: [
      { kind: 'class', className: 'qt-chat-announcement-chip-whisper', label: 'A whisper' },
      { kind: 'aria', attribute: 'aria-expanded', values: ['false'], label: 'Collapsed (always, for a chip)' },
    ],
    since: 1,
  },
  {
    className: 'qt-chat-message-action-bar',
    surface: 'salon',
    label: 'Message action bar',
    within: ['qt-chat-message-body'],
    states: [{ kind: 'class', className: 'qt-chat-message-action-bar-disabled', label: 'Actions unavailable' }],
    since: 1,
  },
  {
    className: 'qt-chat-message-tools',
    surface: 'salon',
    label: 'Folded tool calls',
    description: "Tool calls shown inside a character's bubble, where they fired.",
    since: 1,
  },
  {
    className: 'qt-chat-pending-tools',
    surface: 'salon',
    label: 'Pending tool calls',
    description: 'The disclosure listing tool calls in flight while a reply streams.',
    since: 1,
  },
  {
    className: 'qt-chat-tool-call',
    surface: 'salon',
    label: 'Tool call card',
    description: 'The card showing one tool call and its result, standalone or folded into a bubble.',
    variants: [{ attribute: 'data-tool', values: 'open', description: 'The tool name (`generate_image`, `wardrobe_wear`, a plugin or custom tool name, …).' }],
    since: 1,
  },
  {
    className: 'qt-chat-tool-embedded',
    surface: 'salon',
    label: 'Folded tool call',
    description: "A tool call inside a character's bubble.",
    within: ['qt-chat-message-tools'],
    since: 1,
  },
  {
    className: 'qt-chat-composer',
    surface: 'salon',
    label: 'Composer',
    since: 1,
  },
  {
    className: 'qt-chat-composer-input',
    surface: 'salon',
    label: 'Composer input',
    within: ['qt-chat-composer'],
    since: 1,
  },
  {
    className: 'qt-chat-composer-send',
    surface: 'salon',
    label: 'Send button',
    within: ['qt-chat-composer'],
    since: 1,
  },
  {
    className: 'qt-chat-toolbar',
    surface: 'salon',
    label: 'Salon toolbar',
    since: 1,
  },
  {
    className: 'qt-chat-toolbar-button',
    surface: 'salon',
    label: 'Salon toolbar button',
    within: ['qt-chat-toolbar'],
    states: [{ kind: 'class', className: 'qt-chat-toolbar-button-active', label: 'On' }],
    since: 1,
  },
  {
    className: 'qt-participant-card',
    surface: 'salon',
    label: 'Participant card',
    description: 'One seat in the participant sidebar.',
    states: [
      { kind: 'class', className: 'qt-participant-card-active', label: 'Their turn' },
      { kind: 'class', className: 'qt-participant-card-inactive', label: 'Absent' },
      { kind: 'class', className: 'qt-participant-card-silent', label: 'Silent' },
      { kind: 'class', className: 'qt-participant-card-dangerous', label: 'The chat is Unmoderated' },
    ],
    since: 1,
  },
  {
    className: 'qt-participant-turn-dot',
    surface: 'salon',
    label: 'Turn dot',
    description: 'The small mark beside the seat whose turn it is.',
    since: 1,
  },
  {
    className: 'qt-participant-card-name',
    surface: 'salon',
    label: 'Participant name',
    within: ['qt-participant-card'],
    since: 1,
  },

  // Added in Spec I (Calliope Live): the page, the message text, the composer's
  // parts, Storyteller, Courier, the green room, mentions and Document Mode.
  {
    className: 'qt-chat-layout',
    surface: 'salon',
    label: 'Salon page',
    description:
      'The whole chat view: the message column, the composer, the participant sidebar and any Document or Terminal pane beside them. Its background shows behind the messages.',
    since: 1,
  },
  {
    className: 'qt-chat-messages-list',
    surface: 'salon',
    label: 'Message list',
    description: 'The column of message rows, inside the scrolling viewport.',
    within: ['qt-chat-layout'],
    since: 1,
  },
  {
    className: 'qt-chat-message-content',
    surface: 'salon',
    label: 'Message text',
    description:
      'The rendered prose inside a bubble. The roleplay spans (dialogue, narration and the rest) sit inside it.',
    within: ['qt-chat-message-user', 'qt-chat-message-assistant'],
    since: 1,
  },
  {
    className: 'qt-chat-dialogue',
    surface: 'salon',
    label: 'Dialogue',
    description:
      'A roleplay span marking spoken words. The class name is stored in roleplay templates.',
    within: ['qt-chat-message-content'],
    since: 1,
  },
  {
    className: 'qt-chat-narration',
    surface: 'salon',
    label: 'Narration',
    description:
      'A roleplay span marking narration. The class name is stored in roleplay templates.',
    within: ['qt-chat-message-content'],
    since: 1,
  },
  {
    className: 'qt-chat-ooc',
    surface: 'salon',
    label: 'Out-of-character aside',
    description:
      'A roleplay span marking an out-of-character remark. The class name is stored in roleplay templates.',
    within: ['qt-chat-message-content'],
    since: 1,
  },
  {
    className: 'qt-chat-inner-monologue',
    surface: 'salon',
    label: 'Inner monologue',
    description:
      'A roleplay span marking unspoken thought. The class name is stored in roleplay templates.',
    within: ['qt-chat-message-content'],
    since: 1,
  },
  {
    className: 'qt-chat-composer-actions',
    surface: 'salon',
    label: 'Composer actions',
    description:
      'The cluster of buttons beside the composer input; Send and Stop sit in it.',
    within: ['qt-chat-composer'],
    since: 1,
  },
  {
    className: 'qt-chat-stop-button',
    surface: 'salon',
    label: 'Stop button',
    description: 'Takes the place of Send while a turn is being written.',
    within: ['qt-chat-composer-actions'],
    since: 1,
  },
  {
    className: 'qt-chat-attachment-chip',
    surface: 'salon',
    label: 'Attachment chip',
    description: 'A file waiting in the composer to be sent.',
    within: ['qt-chat-composer'],
    since: 1,
  },
  {
    className: 'qt-chat-attachment-image',
    surface: 'salon',
    label: 'Attached picture',
    description: 'A picture shown inside a sent message.',
    since: 1,
  },
  {
    className: 'qt-chat-thinking',
    surface: 'salon',
    label: 'Reasoning block',
    description:
      "A model's shown reasoning above its answer, opened and closed by its summary line.",
    since: 1,
  },
  {
    className: 'qt-chat-sidebar',
    surface: 'salon',
    label: 'Participant sidebar',
    description: 'The panel of participant cards beside the chat.',
    within: ['qt-chat-layout'],
    states: [
      { kind: 'class', className: 'qt-chat-sidebar-collapsed', label: 'Folded to a column of avatars' },
    ],
    since: 1,
  },
  {
    className: 'qt-courier-bubble',
    surface: 'salon',
    label: 'Courier card',
    description: 'The prompt-and-paste card of a manual (Courier) turn.',
    within: ['qt-chat-message-row-courier'],
    since: 1,
  },
  {
    className: 'qt-green-room',
    surface: 'salon',
    label: 'Green room panel',
    description: "The panel that narrates a chat's opening while the cast arrives.",
    states: [
      { kind: 'class', className: 'qt-green-room-docked', label: 'Docked above the composer' },
    ],
    since: 1,
  },
  {
    className: 'qt-storyteller-board',
    surface: 'salon',
    label: 'Storyteller board',
    description: 'The board of proposed turns in Storyteller mode.',
    since: 1,
  },
  {
    className: 'qt-storyteller-card',
    surface: 'salon',
    label: 'Storyteller card',
    description: 'One proposed turn on the board.',
    within: ['qt-storyteller-board'],
    states: [
      { kind: 'class', className: 'qt-storyteller-card-selected', label: 'Chosen to run' },
      { kind: 'class', className: 'qt-storyteller-card-quiet', label: 'Holding back this round' },
      { kind: 'class', className: 'qt-storyteller-card-dragging', label: 'Being dragged' },
    ],
    since: 1,
  },
  {
    className: 'qt-formatting-toolbar',
    surface: 'salon',
    label: 'Formatting toolbar',
    description:
      "The composer's formatting row (bold, italics, roleplay marks); Document Mode's editor uses it too.",
    since: 1,
  },
  {
    className: 'qt-formatting-button',
    surface: 'salon',
    label: 'Formatting button',
    description: 'One button in the formatting toolbar.',
    within: ['qt-formatting-toolbar'],
    states: [
      { kind: 'class', className: 'qt-formatting-button-active', label: 'The format is on at the caret' },
    ],
    since: 1,
  },
  {
    className: 'qt-typeahead-menu',
    surface: 'salon',
    label: 'Mention menu',
    description: 'The menu that opens on @ in the composer.',
    since: 1,
  },
  {
    className: 'qt-typeahead-option',
    surface: 'salon',
    label: 'Mention menu option',
    description: 'One choice in the mention menu.',
    within: ['qt-typeahead-menu'],
    states: [
      { kind: 'class', className: 'qt-typeahead-option-active', label: 'Highlighted' },
    ],
    since: 1,
  },
  {
    className: 'qt-mention-chip',
    surface: 'salon',
    label: 'Mention chip',
    description: 'A named character or Atlas thing, chipped in a message.',
    states: [
      { kind: 'class', className: 'qt-mention-chip-thing', label: 'An Atlas thing rather than a character' },
    ],
    since: 1,
  },
  {
    className: 'qt-doc-pane',
    surface: 'salon',
    label: 'Document pane',
    description: "Document Mode's pane beside the chat.",
    since: 1,
  },
  {
    className: 'qt-doc-header',
    surface: 'salon',
    label: 'Document pane header',
    description: "The pane's title row with its buttons.",
    within: ['qt-doc-pane'],
    since: 1,
  },
]
