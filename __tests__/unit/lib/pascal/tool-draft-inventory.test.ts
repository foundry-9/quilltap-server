/**
 * The Workbench draft model and the Inventory (inventory-tools-and-pascal
 * §5.8): `inventory` / `inventoryCount` chips, gate chips, the inventory
 * effect kind and the `$inventory` roll all round-trip, and the draft check
 * says what the loader would.
 */

import {
  definitionFromDraft,
  draftFromDefinition,
  newDraftEffect,
  validateDraft,
  type ToolDraft,
} from '@/lib/pascal/tool-draft'
import { QtapCustomToolSchema } from '@/lib/pascal/custom-tool.types'

const TOOL = {
  name: 'strike',
  description: 'Strike.',
  parameters: { weapon: { type: 'string', default: 'Excalibur' } },
  availableWhen: { inventory: { lantern: { eq: 'equipped' } }, inventoryCount: { ring: { gte: 1 } } },
  roll: { $inventory: 'sword.metadata.damage', fallback: '1d4' },
  effects: [
    { inventory: { action: 'equip', items: ['{{params.weapon}}'] } },
    { when: { outcome: { eq: 'failure' } }, inventory: { action: 'pick_up', items: ['magic bow'], equip: false } },
  ],
  outcomes: [
    { when: { inventory: { '{{params.weapon}}': { eq: 'equipped' } }, inventoryCount: { ring: { gte: 2 } } }, message: 'hit', state: 'success' },
    { when: true, message: 'miss', state: 'failure' },
  ],
}

function load(doc: unknown): ToolDraft {
  const draft = draftFromDefinition(doc)
  if (!draft) throw new Error('fixture failed to load')
  return draft
}

describe('round trip', () => {
  it('serialises back to the same definition', () => {
    const draft = load(TOOL)
    expect(draft.rollForm).toBe('inventory')
    expect(draft.effects.map((e) => e.kind)).toEqual(['inventory', 'inventory'])
    const out = definitionFromDraft(draft)
    expect(out.roll).toEqual(TOOL.roll)
    expect(out.availableWhen).toEqual(TOOL.availableWhen)
    expect(out.effects).toEqual(TOOL.effects)
    expect((out.outcomes as Array<{ when: unknown }>)[0].when).toEqual(TOOL.outcomes[0].when)
    expect(QtapCustomToolSchema.safeParse(out).success).toBe(true)
    expect(validateDraft(draft).filter((i) => i.severity === 'error')).toEqual([])
  })

  it('a fresh inventory effect emits only the active half', () => {
    const draft = load({ name: 'x', description: 'x', outcomes: [{ when: true, message: '-', state: 'info' }] })
    const effect = { ...newDraftEffect('inventory'), inventory: { action: 'pick_up' as const, items: ['bow', ''], equip: true } }
    draft.effects = [effect]
    expect(definitionFromDraft(draft).effects).toEqual([{ inventory: { action: 'pick_up', items: ['bow'] } }])
  })
})

describe('validation', () => {
  it('a state chip needs one of the four states, and only = or ≠', () => {
    const draft = load(TOOL)
    const chip = draft.outcomes[0].conditions.find((c) => c.subject.kind === 'inventory')!
    chip.operand = { kind: 'string', text: 'worn' }
    expect(validateDraft(draft).map((i) => i.message)).toContain('pick a state: equipped, carried, reachable or absent')
    chip.comparator = 'gt'
    expect(validateDraft(draft).map((i) => i.message)).toContain('an inventory state can only be tested with = or ≠')
  })

  it('a gate key may not carry a placeholder', () => {
    const draft = load(TOOL)
    draft.gateConditions[0].key = '{{params.weapon}}'
    expect(validateDraft(draft).map((i) => i.message)).toContain(
      'a gate is answered before any parameter exists — name the object literally'
    )
  })

  it('an inventory effect states the per-action rule and names undeclared parameters', () => {
    const draft = load(TOOL)
    draft.effects[0].inventory = { action: 'equip', items: ['{{params.ghost}}'], equip: true }
    expect(validateDraft(draft).map((i) => i.message)).toContain('{{params.ghost}} names no declared parameter')
    draft.effects[0].inventory = { action: 'equip', items: [''], equip: true }
    expect(validateDraft(draft).map((i) => i.message)).toContain('equip needs at least one object')
  })

  it('a $inventory roll needs an object path and dice to fall back on', () => {
    const draft = load(TOOL)
    draft.rollInventory = { path: 'sword.title', fallback: 'four' }
    const messages = validateDraft(draft).map((i) => i.message)
    expect(messages).toContain('name "<object>.metadata.<key>", e.g. "sword.metadata.damage"')
    expect(messages).toContain('the fallback must be dice notation like "1d4"')
  })
})
