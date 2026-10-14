/**
 * Bug 165 — `addScenario` returned a transient id.
 *
 * A vault-backed character re-keys each scenario from its file path when the
 * vault is read back, so the id `addToSubArray` mints never survives the write.
 * `POST /api/v1/characters/[id]/scenarios` handed that dead id to its caller,
 * and the Scenario Builder's picker could never select the scenario it had
 * just filed. `addScenario` now re-reads and returns the projected entry.
 *
 * Driven against the prototype method with `this` stubbed: its only
 * collaborators are `findById` and the generic add helper.
 */

import { CharactersRepository } from '@/lib/database/repositories/characters.repository'
import type { CharacterScenario } from '@/lib/schemas/character.types'

const scenario = (id: string, title: string, content = 'Body.'): CharacterScenario =>
  ({ id, title, content, createdAt: 't', updatedAt: 't' }) as CharacterScenario

function makeRepo(opts: {
  before: CharacterScenario[]
  after: CharacterScenario[]
  added: CharacterScenario | null
}) {
  const findById = jest
    .fn()
    .mockResolvedValueOnce({ id: 'char-1', scenarios: opts.before })
    .mockResolvedValueOnce({ id: 'char-1', scenarios: opts.after })
  const addToSubArray = jest.fn().mockResolvedValue(opts.added)
  return { findById, addToSubArray }
}

const addScenario = CharactersRepository.prototype.addScenario

describe('CharactersRepository.addScenario — returns the id a later read will see (bug 165)', () => {
  it('returns the vault-projected scenario rather than the transient one', async () => {
    const fake = makeRepo({
      before: [scenario('old-1', 'Morning')],
      after: [scenario('old-1', 'Morning'), scenario('projected-9', 'Dusk')],
      added: scenario('transient-1', 'Dusk'),
    })
    const result = await addScenario.call(fake as never, 'char-1', { title: 'Dusk', content: 'Body.' })
    expect(result?.id).toBe('projected-9')
  })

  it('prefers the title match when more than one id is new', async () => {
    const fake = makeRepo({
      before: [],
      after: [scenario('p-a', 'Other'), scenario('p-b', 'Dusk')],
      added: scenario('transient-1', 'Dusk'),
    })
    const result = await addScenario.call(fake as never, 'char-1', { title: 'Dusk', content: 'Body.' })
    expect(result?.id).toBe('p-b')
  })

  it('keeps the minted id when the read-back does not re-key it (DB-backed character)', async () => {
    const fake = makeRepo({
      before: [],
      after: [scenario('transient-1', 'Dusk')],
      added: scenario('transient-1', 'Dusk'),
    })
    const result = await addScenario.call(fake as never, 'char-1', { title: 'Dusk', content: 'Body.' })
    expect(result?.id).toBe('transient-1')
  })

  it('falls back to the minted item when the read-back shows nothing new', async () => {
    const fake = makeRepo({ before: [], after: [], added: scenario('transient-1', 'Dusk') })
    const result = await addScenario.call(fake as never, 'char-1', { title: 'Dusk', content: 'Body.' })
    expect(result?.id).toBe('transient-1')
  })

  it('returns null when the add itself fails', async () => {
    const fake = makeRepo({ before: [], after: [], added: null })
    const result = await addScenario.call(fake as never, 'char-1', { title: 'Dusk', content: 'Body.' })
    expect(result).toBeNull()
    expect(fake.findById).toHaveBeenCalledTimes(1)
  })
})
