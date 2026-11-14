import {
  buildRenderItems,
  isAlwaysExpandedAnnouncement,
  isCollapsedAnnouncement,
  insertGreenRoomItems,
  renderItemMessageIds,
  type RenderItem,
} from './announcement-render-items'
import type { Message } from './types'
import type { GreenRoomState } from './hooks/useGreenRoom'

let seq = 0
function msg(partial: Partial<Message> & { role: string }): Message {
  seq += 1
  return {
    id: `m${seq}`,
    content: '',
    createdAt: new Date(seq * 1000).toISOString(),
    ...partial,
  }
}

function ann(sender: NonNullable<Message['systemSender']>, kind?: string): Message {
  return msg({ role: 'ASSISTANT', systemSender: sender, systemKind: kind ?? null })
}

/** Convenience: ids of a render-item (group → its members' ids). */
function ids(item: RenderItem): string[] {
  return renderItemMessageIds(item)
}

describe('buildRenderItems', () => {
  const none = new Set<string>()

  it('coalesces consecutive collapsed announcements into one group', () => {
    const a = ann('host', 'add')
    const b = ann('lantern', 'background')
    const c = ann('prospero', 'project-context')

    const items = buildRenderItems([a, b, c], none)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('announcement-group')
    expect(ids(items[0])).toEqual([a.id, b.id, c.id])
    expect(items[0].id).toBe(`group:${a.id}`)
  })

  it('preserves the flat messageIndex on members', () => {
    const user = msg({ role: 'USER', content: 'hi' })
    const a = ann('host', 'add')
    const b = ann('host', 'timestamp')

    const items = buildRenderItems([user, a, b], none)

    expect(items[0]).toMatchObject({ kind: 'message', messageIndex: 0 })
    const group = items[1]
    expect(group.kind).toBe('announcement-group')
    if (group.kind === 'announcement-group') {
      expect(group.members.map(m => m.messageIndex)).toEqual([1, 2])
    }
  })

  it('flushes the group on a regular user/assistant/tool row', () => {
    const a = ann('host', 'add')
    const user = msg({ role: 'USER', content: 'hello' })
    const b = ann('lantern', 'background')
    const assistant = msg({ role: 'ASSISTANT', content: 'hey', participantId: 'p1' })

    const items = buildRenderItems([a, user, b, assistant], none)

    expect(items.map(i => i.kind)).toEqual([
      'announcement-group',
      'message',
      'announcement-group',
      'message',
    ])
    expect(ids(items[0])).toEqual([a.id])
    expect(ids(items[1])).toEqual([user.id])
    expect(ids(items[2])).toEqual([b.id])
    expect(ids(items[3])).toEqual([assistant.id])
  })

  it('splits a group when one member is expanded (chips-before / message / chips-after)', () => {
    const a = ann('host', 'add')
    const b = ann('lantern', 'background')
    const c = ann('prospero', 'project-context')

    const items = buildRenderItems([a, b, c], new Set([b.id]))

    expect(items.map(i => i.kind)).toEqual([
      'announcement-group',
      'message',
      'announcement-group',
    ])
    expect(ids(items[0])).toEqual([a.id])
    expect(ids(items[1])).toEqual([b.id]) // expanded → standalone message row
    expect(ids(items[2])).toEqual([c.id])
  })

  it('renders a Suparṇā mail-delivery whisper expanded (standalone), splitting a surrounding group', () => {
    const a = ann('host', 'add')
    const mail = ann('suparna', 'mail-delivery')
    const c = ann('lantern', 'background')

    // Not in the expanded set, yet it must NOT collapse into a chip group.
    const items = buildRenderItems([a, mail, c], none)

    expect(items.map(i => i.kind)).toEqual([
      'announcement-group',
      'message',
      'announcement-group',
    ])
    expect(ids(items[0])).toEqual([a.id])
    expect(ids(items[1])).toEqual([mail.id]) // expanded by default → standalone row
    expect(ids(items[2])).toEqual([c.id])
  })

  it('renders a Pascal roll outcome expanded (standalone), splitting a surrounding group', () => {
    const a = ann('host', 'add')
    const roll = ann('pascal', 'custom-tool-result')
    const c = ann('lantern', 'background')

    const items = buildRenderItems([a, roll, c], none)

    expect(items.map(i => i.kind)).toEqual(['announcement-group', 'message', 'announcement-group'])
    expect(ids(items[1])).toEqual([roll.id])
  })

  it('renders an established fact expanded, never packed into a run of Host chips', () => {
    const a = ann('host', 'add')
    const fact = ann('host', 'established-fact')
    const c = ann('host', 'timestamp')

    const items = buildRenderItems([a, fact, c], none)

    expect(items.map(i => i.kind)).toEqual(['announcement-group', 'message', 'announcement-group'])
    expect(ids(items[1])).toEqual([fact.id])
  })

  it('emits a one-member group for a lone collapsed announcement', () => {
    const user = msg({ role: 'USER', content: 'hi' })
    const a = ann('commonplaceBook', 'memory-recap')
    const assistant = msg({ role: 'ASSISTANT', content: 'yo', participantId: 'p1' })

    const items = buildRenderItems([user, a, assistant], none)

    expect(items.map(i => i.kind)).toEqual(['message', 'announcement-group', 'message'])
    expect(ids(items[1])).toEqual([a.id])
  })

  it('treats non-system messages as message items regardless of role', () => {
    const user = msg({ role: 'USER', content: 'hi' })
    const assistant = msg({ role: 'ASSISTANT', content: 'reply', participantId: 'p1' })
    const tool = msg({ role: 'TOOL', content: '{}' })

    const items = buildRenderItems([user, assistant, tool], none)

    expect(items.every(i => i.kind === 'message')).toBe(true)
    expect(items.flatMap(ids)).toEqual([user.id, assistant.id, tool.id])
  })

  it('returns an empty array for no messages', () => {
    expect(buildRenderItems([], none)).toEqual([])
  })
})

describe('isCollapsedAnnouncement', () => {
  const none = new Set<string>()

  // The message list hands this to MessageRow as isSystemMessageCollapsed, and
  // MessageRow draws a chip when it is true, so an always-expanded kind must
  // answer false here or it still renders as a chip outside any group.
  it.each([
    ['carina', 'answer'],
    ['suparna', 'mail-delivery'],
    ['pascal', 'custom-tool-result'],
    ['host', 'established-fact'],
  ] as const)('never collapses %s/%s', (sender, kind) => {
    const m = ann(sender, kind)
    expect(isAlwaysExpandedAnnouncement(m)).toBe(true)
    expect(isCollapsedAnnouncement(m, none)).toBe(false)
  })

  it('collapses other kinds from the same senders', () => {
    expect(isCollapsedAnnouncement(ann('suparna', 'other'), none)).toBe(true)
    expect(isCollapsedAnnouncement(ann('pascal', 'inventory-change'), none)).toBe(true)
    expect(isCollapsedAnnouncement(ann('host', 'add'), none)).toBe(true)
  })

  it('does not collapse an announcement the user expanded, or a non-system message', () => {
    const a = ann('host', 'add')
    expect(isCollapsedAnnouncement(a, new Set([a.id]))).toBe(false)
    expect(isCollapsedAnnouncement(msg({ role: 'ASSISTANT', content: 'hi' }), none)).toBe(false)
  })
})

describe('insertGreenRoomItems', () => {
  function room(id: string, priorMessageIds: string[]): GreenRoomState {
    return {
      id, running: false, docked: true, expanded: false, priorMessageIds,
      title: 'The Green Room', status: '', wardrobe: [], packed: [], logs: [],
    }
  }
  const kinds = (items: RenderItem[]) => items.map(i => (i.kind === 'green-room' ? i.id : renderItemMessageIds(i).join('+')))

  it('returns the items unchanged with no docked rooms', () => {
    const items = buildRenderItems([msg({ role: 'USER' })], new Set())
    expect(insertGreenRoomItems(items, [])).toBe(items)
  })

  it('puts an opening room at the top when nothing preceded it', () => {
    const a = msg({ role: 'ASSISTANT' })
    const b = msg({ role: 'USER' })
    const out = insertGreenRoomItems(buildRenderItems([a, b], new Set()), [room('r1', [])])
    expect(kinds(out)).toEqual(['green-room:r1', a.id, b.id])
  })

  it('puts a join room after the last message that was already on the page', () => {
    const a = msg({ role: 'ASSISTANT' })
    const b = msg({ role: 'USER' })
    const c = msg({ role: 'ASSISTANT' })
    const out = insertGreenRoomItems(buildRenderItems([a, b, c], new Set()), [room('r1', [a.id, b.id, 'hidden'])])
    expect(kinds(out)).toEqual([a.id, b.id, 'green-room:r1', c.id])
  })

  it('anchors on a message packed in a chip group', () => {
    const a = msg({ role: 'ASSISTANT' })
    const h = ann('host', 'add')
    const c = msg({ role: 'ASSISTANT' })
    const out = insertGreenRoomItems(buildRenderItems([a, h, c], new Set()), [room('r1', [a.id, h.id])])
    expect(kinds(out)).toEqual([a.id, h.id, 'green-room:r1', c.id])
  })

  it('keeps several rooms in session order', () => {
    const a = msg({ role: 'ASSISTANT' })
    const b = msg({ role: 'USER' })
    const out = insertGreenRoomItems(
      buildRenderItems([a, b], new Set()),
      [room('r1', []), room('r2', [a.id]), room('r3', [a.id])],
    )
    expect(kinds(out)).toEqual(['green-room:r1', a.id, 'green-room:r2', 'green-room:r3', b.id])
  })
})
