/**
 * @jest-environment node
 *
 * Atlas chips (atlas spec §5.7): first mention per entry, scanning spoken
 * lines and the Host's scenario rows, people's terms excluded.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})
jest.mock('@/lib/memory/cheap-llm-tasks', () => ({ stripToolArtifacts: (s: string) => s }))

import { findAtlasMentions } from '@/lib/atlas/mentions'

const origin = { scope: 'project' as const, id: 'project-1', name: 'The Quest' }
const convertible = {
  id: 'a1111111-1111-4111-8111-111111111111', name: 'Convertible', aliases: ['lander', 'car'], graphicPrompt: 'Silver.', knowledge: 'Fast.',
  imageFileId: null, metadata: {}, folder: '', archivedAt: null, createdAt: 'x', updatedAt: 'x', origin,
}

it('chips the scenario row first and gives a later alias no second chip', () => {
  const mentions = findAtlasMentions({
    messages: [
      { id: 'h1', type: 'message', role: 'ASSISTANT', systemSender: 'host', systemKind: 'scenario', content: 'They arrive in the convertible.' },
      { id: 'm1', type: 'message', role: 'USER', content: 'Where is the lander?' },
    ],
    entries: [convertible],
    people: [],
  })
  expect(mentions).toEqual([
    {
      messageId: 'h1',
      entryId: convertible.id,
      text: 'convertible',
      card: { entryId: convertible.id, name: 'Convertible', aliases: ['lander', 'car'], graphicPrompt: 'Silver.', knowledge: 'Fast.', origin, imageFileId: null },
    },
  ])
})

it('ignores other Staff rows', () => {
  const mentions = findAtlasMentions({
    messages: [{ id: 'x', type: 'message', role: 'ASSISTANT', systemSender: 'host', systemKind: 'add', content: 'The car arrives.' }],
    entries: [convertible],
    people: [],
  })
  expect(mentions).toEqual([])
})

it('leaves a person\'s name to the person', () => {
  const mentions = findAtlasMentions({
    messages: [{ id: 'm1', type: 'message', role: 'USER', content: 'Car said hello.' }],
    entries: [convertible],
    people: [{ name: 'Car', aliases: [] }],
  })
  expect(mentions).toEqual([])
})
