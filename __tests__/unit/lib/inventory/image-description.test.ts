/**
 * @jest-environment node
 *
 * The carrying phrase: an object whose `imageDescription` is null, empty or
 * whitespace is not depicted, and a phrase with nothing depicted is null.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

import { renderCarryingPhrase } from '@/lib/inventory/image-description'
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types'

function item(name: string, imageDescription: string | null | undefined, kind: 'item' | 'kit' = 'item'): ResolvedInventoryItem {
  return { id: name, name, title: null, kind, imageDescription } as unknown as ResolvedInventoryItem
}

describe('renderCarryingPhrase', () => {
  it('leaves out null, empty and whitespace-only descriptions', () => {
    expect(renderCarryingPhrase([
      item('a', null),
      item('b', undefined),
      item('c', ''),
      item('d', '   \n\t '),
    ])).toBeNull()
  })

  it('depicts only the objects with a drawing description', () => {
    expect(renderCarryingPhrase([
      item('ring', '  a brass signet ring. '),
      item('pebble', '  '),
      item('sword', 'a longsword with a jewelled pommel'),
    ])).toBe('carrying a brass signet ring, a longsword with a jewelled pommel')
  })

  it('never depicts a kit', () => {
    expect(renderCarryingPhrase([item('kit', 'a burglar\'s kit', 'kit')])).toBeNull()
  })
})
