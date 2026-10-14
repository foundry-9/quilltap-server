/**
 * The Aurora progressions editor.
 *
 * Two things matter here beyond "it renders". The first is the SAVE PAYLOAD:
 * `PUT /api/v1/characters/[id]` replaces the whole `metadata` object, so a
 * card that forgot to spread the user's other keys back in would quietly eat
 * their fact sheet — the single most expensive bug this feature could ship.
 * The second is the tombstone rule: an archived character's PUT is refused
 * server-side, so the card must not offer edits it cannot make.
 */

import { describe, it, expect, beforeEach } from '@jest/globals'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { ProgressionsSection } from '@/components/characters/progressions/ProgressionsSection'
import { idFromName } from '@/components/characters/progressions/useCharacterProgressions'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const CHARACTER_ID = '11111111-1111-1111-1111-111111111111'

/**
 * A span that finished long ago, so the live line reads `complete` on any
 * clock a test run happens to have. A fixture straddling "now" would flip
 * between pending, active and complete depending on the hour the suite ran.
 */
const CANNON = {
  name: 'Cannon recharge',
  startTime: '2020-01-01T14:00:00Z',
  endTime: '2020-01-01T14:10:00Z',
  timeIncrement: 'minute',
  percentageReport: true,
  reportFrequency: 'turn',
  onComplete: 'keep',
}

/** The character the GET returns, with whatever metadata the test wants. */
function character(metadata: unknown, archivedAt: string | null = null) {
  return { id: CHARACTER_ID, name: 'Iris Volney', archivedAt, metadata }
}

const fetchMock = global.fetch as jest.Mock

/**
 * Stub the character GET and record whatever PUT the card sends.
 *
 * `apiFetch` reads `ok`, `status` and `json()`, so that is the whole surface a
 * stub owes it. The GET answers `{ character }` — the envelope the real route
 * uses — because a stub that returned the bare row would let a hook forgetting
 * to unwrap it pass here and fail in the app.
 */
function stubCharacter(metadata: unknown, archivedAt: string | null = null) {
  const puts: Array<Record<string, unknown>> = []
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      puts.push(JSON.parse(String(init.body)) as Record<string, unknown>)
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ character: character(metadata, archivedAt) }),
    })
  })
  return puts
}

function renderSection() {
  return renderWithQuery(
    <ProgressionsSection characterId={CHARACTER_ID} characterName="Iris Volney" />
  )
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('idFromName', () => {
  it('coerces a display name into a legal identifier', () => {
    expect(idFromName('Cannon recharge')).toBe('cannon-recharge')
    expect(idFromName('  Pregnancy!  ')).toBe('pregnancy')
  })

  it('guarantees a leading letter, which the pattern demands', () => {
    expect(idFromName('9 lives')).toBe('p-9-lives')
    expect(idFromName('!!!')).toBe('progression')
    expect(idFromName('')).toBe('progression')
  })

  it('stays within the 64-character ceiling', () => {
    expect(idFromName('x'.repeat(200)).length).toBeLessThanOrEqual(64)
  })
})

describe('ProgressionsSection — the list', () => {
  it('lists an entry with its id, its state and the line the character reads', async () => {
    stubCharacter({ faction: 'Ordo Aurum', progressions: { cannon: CANNON } })
    renderSection()

    expect(await screen.findByText('Cannon recharge')).toBeInTheDocument()
    expect(screen.getByText('cannon')).toBeInTheDocument()
    // The cannon finished in 2020; on any clock a test run has, it is complete.
    expect(screen.getByText('complete')).toBeInTheDocument()
    expect(screen.getByText(/Cannon recharge: complete;/)).toBeInTheDocument()
  })

  it('offers the empty state to a character carrying nothing', async () => {
    stubCharacter({ faction: 'Ordo Aurum' })
    renderSection()
    expect(await screen.findByText(/Nothing in progress/)).toBeInTheDocument()
  })

  it('says so when an entry in the vault could not be read', async () => {
    stubCharacter({
      progressions: { cannon: CANNON, broken: { ...CANNON, endTime: '2019-01-01T00:00:00Z' } },
    })
    renderSection()
    expect(await screen.findByText(/could not be read/)).toBeInTheDocument()
    expect(screen.getByText('Cannon recharge')).toBeInTheDocument()
  })

  /**
   * Bug 127. The id list was built by joining the ids with a literal
   * `</code>, <code>` inside a JSX expression — a string, which React escapes,
   * so the sentence telling a user their vault is damaged handed them raw
   * markup. One id hid it completely: the join has nothing to join, and the
   * surrounding tags are real JSX. So both cases are pinned, and the
   * single-id one is what keeps the fix from being a copy change.
   */
  it('names a single unreadable entry without leaking markup', async () => {
    stubCharacter({ progressions: { cannon: CANNON, broken: { ...CANNON, endTime: '2019-01-01T00:00:00Z' } } })
    renderSection()

    const line = await screen.findByText(/could not be read/)
    expect(line.textContent).toContain('being skipped: broken. Editing the file')
    expect(line.textContent).not.toContain('</code>')
  })

  it('names several unreadable entries as separate code elements, not escaped markup', async () => {
    stubCharacter({
      progressions: {
        cannon: CANNON,
        broken: { ...CANNON, endTime: '2019-01-01T00:00:00Z' },
        other: { ...CANNON, endTime: '2018-01-01T00:00:00Z' },
      },
    })
    renderSection()

    const line = await screen.findByText(/could not be read/)
    // The escaped output is exactly a string containing this literal.
    expect(line.textContent).not.toContain('</code>')
    expect(line.textContent).toContain('being skipped: broken, other.')

    const ids = Array.from(line.querySelectorAll('code')).map((el) => el.textContent)
    expect(ids).toEqual(expect.arrayContaining(['broken', 'other']))
  })
})

describe('ProgressionsSection — archived characters are tombstones', () => {
  it('refuses to add, edit or delete', async () => {
    stubCharacter({ progressions: { cannon: CANNON } }, '2026-09-01T00:00:00Z')
    renderSection()

    expect(await screen.findByText(/is archived, so this card is read-only/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add Progression' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Edit progression/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Delete progression/ })).toBeDisabled()
  })
})

describe('ProgressionsSection — the save payload', () => {
  it('spreads every other metadata key back in, untouched', async () => {
    const puts = stubCharacter({
      faction: 'Ordo Aurum',
      hasAnsibleAccess: true,
      clearanceLevel: 3,
      progressions: { cannon: CANNON },
    })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Delete progression/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].metadata).toEqual({
      faction: 'Ordo Aurum',
      hasAnsibleAccess: true,
      clearanceLevel: 3,
    })
  })

  it('drops the reserved key entirely when the last progression goes', async () => {
    const puts = stubCharacter({ faction: 'Ordo Aurum', progressions: { cannon: CANNON } })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Delete progression/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    expect(puts[0].metadata).not.toHaveProperty('progressions')
  })

  it('keeps the character’s other progressions when one is removed', async () => {
    const puts = stubCharacter({
      progressions: { cannon: CANNON, fuse: { ...CANNON, name: 'Fuse' } },
    })
    renderSection()

    const deletes = await screen.findAllByRole('button', { name: /Delete progression/ })
    fireEvent.click(deletes[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    const written = (puts[0].metadata as Record<string, unknown>).progressions as Record<string, unknown>
    expect(Object.keys(written)).toEqual(['fuse'])
  })
})

describe('ProgressionsSection — the editor modal', () => {
  it('opens on Add and coerces an id from the name', async () => {
    stubCharacter({ progressions: {} })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Progression' }))
    fireEvent.change(screen.getByPlaceholderText('Cannon recharge'), {
      target: { value: 'Cannon recharge' },
    })
    expect(screen.getByPlaceholderText('cannon')).toHaveValue('cannon-recharge')
  })

  it('fixes the id on an existing entry — a tool file addresses it', async () => {
    stubCharacter({ progressions: { cannon: CANNON } })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Edit progression/ }))
    expect(screen.getByPlaceholderText('cannon')).toBeDisabled()
    expect(screen.getByPlaceholderText('cannon')).toHaveValue('cannon')
  })

  it('saves an edit with updatedAt stamped, so the next turn reports it', async () => {
    const puts = stubCharacter({ progressions: { cannon: CANNON } })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Edit progression/ }))
    fireEvent.change(screen.getByPlaceholderText('Cannon recharge'), {
      target: { value: 'Main gun recharge' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    const written = (puts[0].metadata as Record<string, unknown>).progressions as Record<
      string,
      Record<string, unknown>
    >
    expect(written.cannon.name).toBe('Main gun recharge')
    expect(typeof written.cannon.updatedAt).toBe('string')
  })

  it('refuses a create whose id collides with one already carried', async () => {
    stubCharacter({ progressions: { cannon: CANNON } })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Progression' }))
    fireEvent.change(screen.getByPlaceholderText('Cannon recharge'), { target: { value: 'cannon' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add progression' }))

    expect(await screen.findByText(/already carries a progression/)).toBeInTheDocument()
  })

  it('refuses a span that ends before it begins, and does not PUT', async () => {
    const puts = stubCharacter({ progressions: {} })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Progression' }))
    fireEvent.change(screen.getByPlaceholderText('Cannon recharge'), { target: { value: 'Fuse' } })
    const [begins, ends] = screen.getAllByDisplayValue(/^\d{4}-\d{2}-\d{2}T/)
    fireEvent.change(begins, { target: { value: '2026-09-08T14:00' } })
    fireEvent.change(ends, { target: { value: '2026-09-08T13:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add progression' }))

    expect(await screen.findByText(/strictly after startTime/)).toBeInTheDocument()
    expect(puts).toHaveLength(0)
  })

  it('shows the live preview line the character would read', async () => {
    stubCharacter({ progressions: { cannon: CANNON } })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Edit progression/ }))
    expect(screen.getByText(/As Cannon recharge would read it now/)).toBeInTheDocument()
  })

  it('offers every documented placeholder in the legend', async () => {
    stubCharacter({ progressions: { cannon: CANNON } })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Edit progression/ }))
    for (const token of ['{{elapsedWhole}}', '{{percent}}', '{{quantity}}', '{{increment}}']) {
      expect(screen.getByText(token)).toBeInTheDocument()
    }
  })

  it('writes the cadence back in the schema’s own grammar', async () => {
    const puts = stubCharacter({ progressions: { cannon: CANNON } })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: /Edit progression/ }))
    fireEvent.click(screen.getByRole('radio', { name: /at most once every/ }))
    fireEvent.change(screen.getByLabelText('Cadence count'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Cadence unit'), { target: { value: 'd' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(puts).toHaveLength(1))
    const written = (puts[0].metadata as Record<string, unknown>).progressions as Record<
      string,
      Record<string, unknown>
    >
    expect(written.cannon.reportFrequency).toBe('2d')
  })
})
