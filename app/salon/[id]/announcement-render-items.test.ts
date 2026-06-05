import { buildRenderItems, type RenderItem } from './announcement-render-items'
import type { Message } from './types'

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
  return item.kind === 'message' ? [item.message.id] : item.members.map(m => m.message.id)
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
