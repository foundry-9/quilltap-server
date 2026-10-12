/**
 * The in-chat scenario picker (Salon sidebar → Chat → Scenario).
 *
 * The subtle part is the seeding rule. The control never copies the chat's
 * current scene into state; it DERIVES the picker position from it, so the
 * position keeps settling as the four option tiers arrive over the network —
 * and stops the moment the user makes a choice of their own. A seeded-into-
 * state version either shows "Custom…" forever (tiers arrived too late) or
 * stomps a choice the user already made (tiers arrived too early).
 *
 * A chat that recorded where its scene came from (`?action=scenario-source`)
 * is seeded from that source instead — the body match is only the fallback
 * for a chat with no source. The provenance line and "Reload from source"
 * hang off the same answer.
 *
 * Also pinned: "Show archived" belongs to the query key, so the plain and
 * archived answers cache separately instead of one overwriting the other.
 */

import React from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '@/__tests__/helpers/renderWithQuery'
import { ChatScenarioControl } from '@/components/chat/ChatScenarioControl'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { ScenarioSourceInfo } from '@/components/chat/ChatScenarioControl'

// react-markdown is ESM-only; the scenario browser renders previews through it.
jest.mock('react-markdown', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

const GENERAL = [
  { path: 'general/masquerade.md', filename: 'masquerade.md', name: 'A Masquerade', isDefault: false, body: 'Masks are worn.' },
]
const PROJECT = [
  { path: 'project/atrium.md', filename: 'atrium.md', name: 'The Atrium', isDefault: false, body: 'Glass overhead.' },
]
const CHARACTER = [{ id: 'sc-1', title: 'Her Study', content: 'Books to the ceiling.' }]
const GROUP = [
  {
    groupId: 'g-1',
    groupName: 'The Company',
    scenarios: [{ path: 'group/parlour.md', filename: 'parlour.md', name: 'The Parlour', isDefault: false, body: 'A low fire.' }],
  },
]

/** A chat that recorded no source — the body match decides. */
const NO_SOURCE: ScenarioSourceInfo = {
  source: null,
  owner: null,
  scenarioName: null,
  scenarioId: null,
  exists: false,
  changed: false,
  notes: null,
}

/** A chat whose scene was taken from the project's Atrium. */
function atriumSource(overrides: Partial<ScenarioSourceInfo> = {}): ScenarioSourceInfo {
  return {
    source: { mountPointId: 'mp-proj', path: 'project/atrium.md', bodySha256: 'abc' },
    owner: { scope: 'project', id: 'proj-1', name: 'Glasshouse' },
    scenarioName: 'The Atrium',
    scenarioId: null,
    exists: true,
    changed: false,
    notes: null,
    ...overrides,
  }
}

const isScenarioSource = (url: string) => url.includes('action=scenario-source')
/** The save endpoint — not to be confused with the `scenario-source` read. */
const isScenarioSave = (url: string) => url.endsWith('?action=scenario')

/**
 * Route each tier's endpoint to its payload; anything else is an empty tier.
 * The chat's recorded source answers `?action=scenario-source`.
 */
function stubTiers(source: ScenarioSourceInfo = NO_SOURCE) {
  const seen: string[] = []
  ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => {
    seen.push(url)
    const body = (() => {
      if (isScenarioSource(url)) return source
      if (isScenarioSave(url)) return { message: 'Scenario updated' }
      if (url.startsWith('/api/v1/scenarios')) return { scenarios: GENERAL }
      if (url.includes('/projects/')) return { scenarios: PROJECT }
      if (url.includes('/groups/scenarios')) return { groupScenarios: GROUP }
      if (url.includes('/scenarios') && url.includes('/characters/')) return { scenarios: CHARACTER }
      return {}
    })()
    return { ok: true, status: 200, json: async () => body }
  })
  return seen
}

/** The one POST to `?action=scenario`, parsed. */
function savedPayload(): Record<string, unknown> {
  const call = (global.fetch as jest.Mock).mock.calls.find(
    ([url, init]) => typeof url === 'string' && isScenarioSave(url) && init?.method === 'POST'
  )
  expect(call).toBeDefined()
  expect(call[0]).toBe('/api/v1/chats/chat-1?action=scenario')
  return JSON.parse(call[1].body)
}

function renderControl(props: Partial<React.ComponentProps<typeof ChatScenarioControl>> = {}) {
  return renderWithQuery(
    <ChatScenarioControl
      chatId="chat-1"
      projectId="proj-1"
      scenarioText={null}
      llmCharacterIds={['char-1']}
      singleLlmCharacterId="char-1"
      enabled
      {...props}
    />
  )
}

describe('ChatScenarioControl', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockReset()
  })

  describe('seeding from the chat\'s current scene', () => {
    it('opens on Custom with the text ready to edit when the scene matches no preset', async () => {
      stubTiers()
      renderControl({ scenarioText: 'A scene nobody wrote down.' })

      const box = await screen.findByLabelText('Custom scenario text')
      expect(box).toHaveValue('A scene nobody wrote down.')
    })

    it('opens on Custom with an empty box when the chat has no scene at all', async () => {
      stubTiers()
      renderControl({ scenarioText: null })

      expect(await screen.findByLabelText('Custom scenario text')).toHaveValue('')
    })

    it('preselects the preset once its tier arrives, rather than staying on Custom', async () => {
      stubTiers()
      renderControl({ scenarioText: 'Masks are worn.' })

      // Derived, not seeded: the match can only be made after the fetch lands.
      await waitFor(() => {
        expect(screen.queryByLabelText('Custom scenario text')).not.toBeInTheDocument()
      })
      expect(await screen.findByText('Masks are worn.')).toBeInTheDocument()
    })

    it('matches a preset whose body differs only by surrounding whitespace', async () => {
      stubTiers()
      renderControl({ scenarioText: '  Masks are worn.\n' })

      await waitFor(() => {
        expect(screen.queryByLabelText('Custom scenario text')).not.toBeInTheDocument()
      })
    })

    it('reads a preset with notes layered beneath it as Custom, not as the preset', async () => {
      stubTiers()
      const withNotes = 'Masks are worn.\n\nAnd one guest is not who they claim.'
      renderControl({ scenarioText: withNotes })

      expect(await screen.findByLabelText('Custom scenario text')).toHaveValue(withNotes)
    })
  })

  describe('seeding from the recorded source', () => {
    it('prefers the source over the body match, preselecting a project preset whose body no longer matches', async () => {
      stubTiers(atriumSource({ notes: 'And the glass is cracked.' }))
      // The stored text matches nothing — the shelf copy has moved on, or
      // notes were layered beneath. The source still names the Atrium.
      renderControl({ scenarioText: 'Glass overhead, once.\n\nAnd the glass is cracked.' })

      const select = (await screen.findByLabelText('Scenario')) as HTMLSelectElement
      await waitFor(() => expect(select.value).toBe('project:project/atrium.md'))
      expect(screen.queryByLabelText('Custom scenario text')).not.toBeInTheDocument()
      // The notes beneath the scene come from the source answer, not the text.
      expect(screen.getByLabelText('Notes beneath the scene')).toHaveValue('And the glass is cracked.')
    })

    it('falls back to the body match when the chat recorded no source', async () => {
      stubTiers(NO_SOURCE)
      renderControl({ scenarioText: 'Glass overhead.' })

      const select = (await screen.findByLabelText('Scenario')) as HTMLSelectElement
      await waitFor(() => expect(select.value).toBe('project:project/atrium.md'))
      expect(screen.queryByText(/^From:/)).not.toBeInTheDocument()
    })

    it('shows a source outside the hierarchy under "Elsewhere", labelled Owner › Name', async () => {
      stubTiers(
        atriumSource({
          source: { mountPointId: 'mp-far', path: 'Scenarios/attic.md', bodySha256: 'x' },
          owner: { scope: 'project', id: 'proj-other', name: 'Farhouse' },
          scenarioName: 'The Attic',
        })
      )
      renderControl({ scenarioText: 'Dust and trunks.' })

      const select = (await screen.findByLabelText('Scenario')) as HTMLSelectElement
      await waitFor(() => expect(select.value).toBe('store:mp-far:Scenarios/attic.md'))
      const elsewhere = select.querySelector('optgroup[label="Elsewhere"]')
      expect(elsewhere?.textContent).toBe('Farhouse › The Attic')
    })
  })

  describe('provenance', () => {
    it('names where the scene came from, with no reload offered while the shelf copy is unchanged', async () => {
      stubTiers(atriumSource())
      renderControl({ scenarioText: 'Glass overhead.' })

      expect(await screen.findByText('Glasshouse')).toBeInTheDocument()
      expect(screen.getByText(/^From:/)).toHaveTextContent('From: Glasshouse › The Atrium')
      expect(screen.queryByRole('button', { name: 'Reload from source' })).not.toBeInTheDocument()
    })

    it('says so when the shelf copy is gone', async () => {
      stubTiers(atriumSource({ exists: false }))
      renderControl({ scenarioText: 'Glass overhead.' })

      expect(await screen.findByText(/the shelf copy is gone/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Reload from source' })).not.toBeInTheDocument()
    })

    it('offers Reload when the shelf copy changed, and reload posts the ref with the same notes', async () => {
      stubTiers(atriumSource({ changed: true, notes: 'Keep the cracked pane.' }))
      const onChatUpdated = jest.fn()
      renderControl({ scenarioText: 'Glass overhead, once.\n\nKeep the cracked pane.', onChatUpdated })

      expect(await screen.findByText(/the shelf copy has been revised/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Reload from source' }))

      await waitFor(() => expect(onChatUpdated).toHaveBeenCalled())
      expect(savedPayload()).toEqual({
        scenarioRef: { mountPointId: 'mp-proj', path: 'project/atrium.md' },
        scenario: 'Keep the cracked pane.',
      })
    })
  })

  describe('the archived toggle', () => {
    it('re-fetches every tier with includeArchived so the two answers cache apart', async () => {
      const seen = stubTiers()
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      expect(seen.some(u => u.includes('includeArchived'))).toBe(false)

      await userEvent.click(screen.getByLabelText('Show archived'))

      await waitFor(() => {
        expect(seen.filter(u => u.includes('includeArchived=true')).length).toBeGreaterThan(0)
      })
    })
  })

  describe('saving', () => {
    it('posts the custom text to the scenario action and drops the draft afterwards', async () => {
      stubTiers()
      const onChatUpdated = jest.fn()
      renderControl({ onChatUpdated })

      const box = await screen.findByLabelText('Custom scenario text')
      await userEvent.type(box, 'Rain on the conservatory glass.')
      await userEvent.click(screen.getByRole('button', { name: 'Change scenario' }))

      await waitFor(() => expect(onChatUpdated).toHaveBeenCalled())

      expect(savedPayload()).toEqual({ scenario: 'Rain on the conservatory glass.' })
      expect(showSuccessToast).toHaveBeenCalled()
    })

    it('posts the preset pointer with the notes beneath it as `scenario`', async () => {
      stubTiers()
      const onChatUpdated = jest.fn()
      renderControl({ onChatUpdated })

      await screen.findByLabelText('Custom scenario text')
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'A Masquerade' })).toBeInTheDocument()
      )
      await userEvent.selectOptions(screen.getByLabelText('Scenario'), 'general:general/masquerade.md')
      await userEvent.type(screen.getByLabelText('Notes beneath the scene'), 'One guest lies.')
      await userEvent.click(screen.getByRole('button', { name: 'Change scenario' }))

      await waitFor(() => expect(onChatUpdated).toHaveBeenCalled())
      expect(savedPayload()).toEqual({
        generalScenarioPath: 'general/masquerade.md',
        scenario: 'One guest lies.',
      })
    })

    it('surfaces the server\'s own error text instead of a bare status code', async () => {
      ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (isScenarioSave(url)) {
          return { ok: false, status: 409, statusText: 'Conflict', json: async () => ({ error: 'That scene is archived' }) }
        }
        return { ok: true, status: 200, json: async () => ({}) }
      })
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      await userEvent.click(screen.getByRole('button', { name: 'Change scenario' }))

      await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('That scene is archived'))
    })

    it('re-enables the button after a failed save rather than staying stuck', async () => {
      ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => {
        if (isScenarioSave(url)) throw new Error('network down')
        return { ok: true, status: 200, json: async () => ({}) }
      })
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      const button = screen.getByRole('button', { name: 'Change scenario' })
      await userEvent.click(button)

      await waitFor(() => expect(showErrorToast).toHaveBeenCalledWith('network down'))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Change scenario' })).toBeEnabled())
    })
  })

  describe('the dropdown', () => {
    it('is rendered even when no tier has anything to offer, so Browse is always reachable', async () => {
      ;(global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => (isScenarioSource(url) ? NO_SOURCE : { scenarios: [], groupScenarios: [] }),
      }))
      renderControl()

      await screen.findByLabelText('Custom scenario text')
      const select = screen.getByLabelText('Scenario')
      expect(Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'))).toEqual([
        '__custom__',
        '__browse__',
      ])
    })

    it('appears once any tier has options', async () => {
      stubTiers()
      renderControl()

      expect(await screen.findByLabelText('Scenario')).toBeInTheDocument()
    })
  })

  it('fetches nothing until the section has been opened once', async () => {
    stubTiers()
    renderControl({ enabled: false })

    await screen.findByLabelText('Custom scenario text')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
