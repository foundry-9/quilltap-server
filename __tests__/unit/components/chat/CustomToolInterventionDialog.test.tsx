/**
 * Tests for CustomToolInterventionDialog — Pascal holds a roll for the operator.
 *
 * The dialog never computes a run: every edit is a pin sent to
 * `?action=intervention-preview` (debounced) and the server's recompute is what
 * shows. These cover the contract the operator relies on: nothing when nothing
 * is held, only eligible fields rendered, a preview on edit, the oldest hold
 * first with a count of the rest, a reopen after remount, and the two ways of
 * answering without dealing (as rolled; set the table aside, behind a confirm).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import CustomToolInterventionDialog from '@/components/chat/CustomToolInterventionDialog'
import type { InterventionHoldView, InterventionPreview, InterventionRunView } from '@/lib/pascal/intervention/view'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Fixtures — shaped like InterventionHoldView (lib/pascal/intervention/view.ts)
// ---------------------------------------------------------------------------

function runView(overrides: Partial<InterventionRunView> = {}): InterventionRunView {
  return {
    params: { bonus: 0 },
    rollForm: 'range',
    raw: 0.7,
    diceBreakdown: '',
    value: 70,
    outcomeIndex: 0,
    state: 'success',
    message: 'The house pays out.',
    title: 'Wager',
    visibility: 'public',
    announcer: 'pascal',
    effects: [],
    ...overrides,
  }
}

function previewOf(run: InterventionRunView): InterventionPreview {
  return { run, staleAnswer: false, clampedParams: [], warnings: [] }
}

const ALL_FIELDS: InterventionHoldView['eligible']['fields'] = [
  'roll', 'value', 'outcome', 'message', 'state', 'title', 'visibility', 'announcer',
]

function holdView(id: string, overrides: Partial<InterventionHoldView> = {}): InterventionHoldView {
  return {
    id,
    tool: 'wager',
    title: `Wager ${id}`,
    characterName: 'Ada',
    entrance: 'llm',
    createdAt: 1_000,
    eligible: { fields: ALL_FIELDS, params: [], effects: [] },
    hasCharacter: true,
    definition: {
      parameters: {},
      outcomes: [
        { when: { gte: 50 }, state: 'success', message: 'The house pays out.' },
        { when: true, state: 'failure', message: 'The house keeps it.' },
      ],
      effects: [],
      revealOdds: true,
      hasLlm: false,
    },
    baseline: previewOf(runView({ title: `Wager ${id}` })),
    consults: [],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Fetch routing
// ---------------------------------------------------------------------------

let holds: InterventionHoldView[] = []
let previewReply: InterventionPreview
let calls: Array<{ url: string; method: string; body?: unknown }> = []

function reply(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
}

function routeFetch() {
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      calls.push({ url, method, body })
      if (url.includes('action=interventions')) return reply({ holds })
      if (url.includes('action=intervention-preview')) return reply({ preview: previewReply })
      if (url.includes('action=intervention-resolve')) {
        holds = holds.filter((h) => h.id !== body?.id)
        return reply({ resolved: body?.decision?.kind })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'nope' }) } as Response)
    })
}

const callsTo = (action: string) => calls.filter((c) => c.url.includes(`action=${action}`))

beforeEach(() => {
  holds = []
  calls = []
  previewReply = previewOf(runView({ message: 'PREVIEWED MESSAGE' }))
  routeFetch()
})

afterEach(() => {
  jest.restoreAllMocks()
})

function renderDialog() {
  return renderWithQuery(<CustomToolInterventionDialog chatId="chat-1" />)
}

// ---------------------------------------------------------------------------

describe('CustomToolInterventionDialog — what is shown', () => {
  it('renders nothing when nothing is held', async () => {
    const view = renderDialog()
    await waitFor(() => expect(callsTo('interventions')).toHaveLength(1))
    expect(screen.queryByTestId('custom-tool-intervention')).toBeNull()
    expect(view.container.textContent).toBe('')
  })

  it('asks for this chat\'s holds', async () => {
    renderDialog()
    await waitFor(() => expect(callsTo('interventions')).toHaveLength(1))
    expect(callsTo('interventions')[0].url).toContain('/api/v1/chats/chat-1/custom-tools?action=interventions')
  })

  it('shows the held run with its dealt preview', async () => {
    holds = [holdView('a')]
    renderDialog()
    expect(await screen.findByText('Pascal holds: Wager a')).toBeTruthy()
    expect(screen.getByTestId('intervention-preview').textContent).toContain('The house pays out.')
    expect(screen.getByText(/called by Ada/)).toBeTruthy()
  })

  it('renders only the eligible fields', async () => {
    holds = [holdView('a', { eligible: { fields: ['outcome', 'message'], params: [], effects: [] } })]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')

    expect(screen.getByText('The outcome')).toBeTruthy()
    expect(screen.getByText('The message')).toBeTruthy()
    // Hidden by the author: not rendered at all, and no params or effects either.
    expect(screen.queryByText('The roll')).toBeNull()
    expect(screen.queryByText('The value')).toBeNull()
    expect(screen.queryByText('The verdict')).toBeNull()
    expect(screen.queryByText('Parameters')).toBeNull()
    expect(screen.queryByText('Consequences')).toBeNull()
    expect(screen.queryByText('Presentation')).toBeNull()
  })

  it('shows the roll section when the roll is eligible', async () => {
    holds = [holdView('a')]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')
    expect(screen.getByText('The roll')).toBeTruthy()
  })
})

describe('CustomToolInterventionDialog — editing', () => {
  it('asks the server to recompute after the debounce and shows its message', async () => {
    holds = [holdView('a')]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')

    // Pin the second outcome row.
    const row = screen.getByText(/→ failure/).closest('button') as HTMLButtonElement
    fireEvent.click(row)

    // Debounced: not sent in the same tick.
    expect(callsTo('intervention-preview')).toHaveLength(0)

    await waitFor(() => expect(callsTo('intervention-preview')).toHaveLength(1), { timeout: 3000 })
    expect(callsTo('intervention-preview')[0]).toMatchObject({
      method: 'POST',
      body: { id: 'a', overrides: { outcomeIndex: 1 } },
    })
    await waitFor(() =>
      expect(screen.getByTestId('intervention-preview').textContent).toContain('PREVIEWED MESSAGE'),
    )
    expect(screen.getByText(/1 change pinned/)).toBeTruthy()
  })

  it('collapses a burst of edits into one request', async () => {
    holds = [holdView('a')]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')

    const message = screen.getByLabelText('Message')
    fireEvent.change(message, { target: { value: 'Fi' } })
    fireEvent.change(message, { target: { value: 'Fix' } })
    fireEvent.change(message, { target: { value: 'Fixed.' } })

    await waitFor(() => expect(callsTo('intervention-preview')).toHaveLength(1), { timeout: 3000 })
    expect(callsTo('intervention-preview')[0].body).toEqual({ id: 'a', overrides: { message: 'Fixed.' } })
  })

  it('"Deal it" sends the pins as a deal decision', async () => {
    holds = [holdView('a')]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Fixed.' } })
    await waitFor(() => expect(callsTo('intervention-preview')).toHaveLength(1), { timeout: 3000 })
    await waitFor(() => expect((screen.getByText('Deal it') as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByText('Deal it'))

    await waitFor(() => expect(callsTo('intervention-resolve')).toHaveLength(1))
    expect(callsTo('intervention-resolve')[0].body).toEqual({
      id: 'a',
      decision: { kind: 'deal', overrides: { message: 'Fixed.' } },
    })
  })
})

describe('CustomToolInterventionDialog — several holds, and reopening', () => {
  it('shows the oldest and says how many more wait', async () => {
    holds = [holdView('first'), holdView('second'), holdView('third')]
    renderDialog()
    expect(await screen.findByText('Pascal holds: Wager first')).toBeTruthy()
    expect(screen.queryByText('Pascal holds: Wager second')).toBeNull()
    expect(screen.getByText(/2 more waiting/)).toBeTruthy()
  })

  it('says "1 more waiting" for a single follower', async () => {
    holds = [holdView('first'), holdView('second')]
    renderDialog()
    await screen.findByText('Pascal holds: Wager first')
    expect(screen.getByText(/1 more waiting/)).toBeTruthy()
  })

  it('moves on to the next hold once the first is answered', async () => {
    holds = [holdView('first'), holdView('second')]
    renderDialog()
    await screen.findByText('Pascal holds: Wager first')

    fireEvent.click(screen.getByText('As rolled'))
    expect(await screen.findByText('Pascal holds: Wager second')).toBeTruthy()
    expect(screen.queryByText(/more waiting/)).toBeNull()
  })

  it('reopens after a remount, re-reading the holds', async () => {
    holds = [holdView('a')]
    const first = renderDialog()
    await screen.findByText('Pascal holds: Wager a')
    first.unmount()
    expect(screen.queryByText('Pascal holds: Wager a')).toBeNull()

    renderDialog()
    expect(await screen.findByText('Pascal holds: Wager a')).toBeTruthy()
    expect(callsTo('interventions').length).toBeGreaterThanOrEqual(2)
  })
})

describe('CustomToolInterventionDialog — answering without dealing', () => {
  it('"As rolled" posts an as-rolled decision', async () => {
    holds = [holdView('a')]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')

    fireEvent.click(screen.getByText('As rolled'))
    await waitFor(() => expect(callsTo('intervention-resolve')).toHaveLength(1))
    expect(callsTo('intervention-resolve')[0]).toMatchObject({
      method: 'POST',
      body: { id: 'a', decision: { kind: 'as-rolled' } },
    })
    await waitFor(() => expect(screen.queryByTestId('custom-tool-intervention')).toBeNull())
  })

  it('"Set the table aside" asks first, and only then vetoes', async () => {
    holds = [holdView('a')]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')

    fireEvent.click(screen.getByText('Set the table aside'))
    expect(screen.getByText(/Sweep the cards away/)).toBeTruthy()
    expect(callsTo('intervention-resolve')).toHaveLength(0)

    fireEvent.click(screen.getByText('Set it aside'))
    await waitFor(() => expect(callsTo('intervention-resolve')).toHaveLength(1))
    expect(callsTo('intervention-resolve')[0].body).toEqual({ id: 'a', decision: { kind: 'veto' } })
    await waitFor(() => expect(screen.queryByTestId('custom-tool-intervention')).toBeNull())
  })

  it('"Keep the table" backs out of the veto without posting', async () => {
    holds = [holdView('a')]
    renderDialog()
    await screen.findByTestId('custom-tool-intervention')

    fireEvent.click(screen.getByText('Set the table aside'))
    fireEvent.click(screen.getByText('Keep the table'))
    expect(screen.getByText('As rolled')).toBeTruthy()
    expect(callsTo('intervention-resolve')).toHaveLength(0)
  })
})
