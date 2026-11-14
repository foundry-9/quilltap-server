/**
 * Each turn action is its own `?action=` (the body no longer names it); the
 * name table must cover every action the schema accepts.
 */



import { TURN_ACTION_KINDS } from '@/app/api/v1/chats/[id]/actions/turn'
import { turnActionSchema } from '@/app/api/v1/chats/[id]/schemas'

describe('turn action names', () => {
  it('cover every turn action exactly once', () => {
    const schemaActions = turnActionSchema.options.map((o) => o.shape.action.value).sort()
    expect(Object.values(TURN_ACTION_KINDS).sort()).toEqual(schemaActions)
  })

  it('are all turn-prefixed', () => {
    for (const name of Object.keys(TURN_ACTION_KINDS)) expect(name.startsWith('turn-')).toBe(true)
  })
})
