/**
 * The character's own Physical Appearance section for `humanoid: false`:
 * the no-body reminder rides with the description, and still goes out when
 * no description text has been written yet. A humanoid (or unflagged)
 * character's section is unchanged.
 */

import { buildIdentityStack } from '@/lib/chat/context/system-prompt-builder'
import type { Character } from '@/lib/schemas/types'

const REMINDER = 'You have no humanoid body'

function character(physicalDescription: Record<string, unknown> | null): Character {
  return {
    id: 'char-1',
    name: 'Orrery',
    systemPrompts: [],
    scenarios: [],
    physicalDescription,
  } as unknown as Character
}

describe('Physical Appearance for a non-humanoid character', () => {
  it('appends the reminder to the description', () => {
    const out = buildIdentityStack({
      character: character({ id: 'pd', name: 'default', humanoid: false, shortPrompt: 'seven brass spheres' }),
    } as never)
    expect(out).toContain('seven brass spheres')
    expect(out).toContain(REMINDER)
  })

  it('still sends the reminder when no description text exists yet', () => {
    const out = buildIdentityStack({
      character: character({ id: 'pd', name: 'default', humanoid: false }),
    } as never)
    expect(out).toContain('## Physical Appearance')
    expect(out).toContain(REMINDER)
  })

  it('leaves a humanoid character without the reminder, and without a section when empty', () => {
    const withText = buildIdentityStack({
      character: character({ id: 'pd', name: 'default', shortPrompt: 'a tall woman' }),
    } as never)
    expect(withText).toContain('a tall woman')
    expect(withText).not.toContain(REMINDER)
    const empty = buildIdentityStack({ character: character({ id: 'pd', name: 'default' }) } as never)
    expect(empty).not.toContain('## Physical Appearance')
  })
})
