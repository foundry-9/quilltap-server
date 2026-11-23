/**
 * Calliope in the Atelier (Calliope Live, Spec J Stage 3): her proposal card's
 * three actions and what they do to the preview and the edit path, a stale
 * proposal, the issue hand-off, and the pure hand-off texts.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import React from 'react'
import { DraftEditor } from '@/components/theme-editor/DraftEditor'
import { ProposalCard } from '@/components/theme-editor/calliope/ProposalCard'
import { contrastHandOffText, issueHandOffText } from '@/components/theme-editor/calliope/hand-off'
import type { ProposalView } from '@/components/theme-editor/calliope/api'
import type { DraftDetail } from '@/lib/themes/drafts/service'
import { applyChangeSet } from '@/lib/themes/assist/change-set'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

const setPreview = jest.fn()

jest.mock('@/components/chat/MessageContent', () => ({
  __esModule: true,
  default: ({ content }: { content: string }) => <div>{content}</div>,
}))

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

jest.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({
    availableThemes: [{ id: 'default', name: 'Professional Neutral', source: 'default' }],
    resolvedColorMode: 'light',
    setPreview,
    refreshThemes: jest.fn(async () => {}),
    setTheme: jest.fn(async () => {}),
  }),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

const EMPTY_TOKENS = { primitives: {}, tokens: {}, choices: {} }

function detail(over: Partial<DraftDetail> = {}): DraftDetail {
  return {
    id: 'my-theme',
    manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0' },
    tokens: EMPTY_TOKENS,
    revision: 'rev-1',
    uri: 'qtap://Quilltap General/Themes/my-theme',
    compiled: { fontFaces: '', icons: '', custom: '' },
    subsystems: {},
    issues: [],
    images: [],
    manifestRevision: 'mrev-1',
    files: [],
    totals: { files: 2, bytes: 1000, limits: { files: 200, bytes: 26214400, fileBytes: 5242880 } },
    mountPointId: 'mp-general',
    updatedAt: '2026-11-14T12:00:00.000Z',
    version: '0.1.0',
    ...over,
  }
}

const OPERATIONS = [{ op: 'set-token' as const, token: '--theme-primary', value: '#123456' }]

function proposal(over: Partial<ProposalView> = {}): ProposalView {
  return {
    id: 'p1',
    createdAt: '2026-11-16T12:00:00.000Z',
    title: 'Ink blue',
    reason: 'A deeper primary for the buttons.',
    state: 'offered',
    draftChanged: false,
    review: {
      lines: [{ subject: 'Primary (--theme-primary)', action: 'set', before: 'the default', after: '#123456' }],
      warnings: [],
      removed: [],
      contrastWorse: [],
      contrastFixed: [],
      tokensChanged: true,
      cssChanged: false,
    },
    staleReason: null,
    operations: OPERATIONS,
    ...over,
  }
}

function card(over: Partial<React.ComponentProps<typeof ProposalCard>> = {}) {
  const props = {
    proposal: proposal(),
    trying: false,
    busy: false,
    onTry: jest.fn(),
    onStopTrying: jest.fn(),
    onKeep: jest.fn(),
    onDiscard: jest.fn(),
    onAskAgain: jest.fn(),
    ...over,
  }
  render(<ProposalCard {...props} />)
  return props
}

describe('ProposalCard', () => {
  it('shows the proposal in words and offers Try, Keep and Discard', () => {
    const props = card()
    expect(screen.getByRole('heading', { name: 'Ink blue' })).toBeInTheDocument()
    expect(screen.getByText('A deeper primary for the buttons.')).toBeInTheDocument()
    expect(screen.getByText('Primary (--theme-primary): set — the default → #123456')).toBeInTheDocument()
    const actions = screen.getByRole('group', { name: 'Decide on Ink blue' })
    fireEvent.click(within(actions).getByRole('button', { name: 'Try' }))
    fireEvent.click(within(actions).getByRole('button', { name: 'Keep' }))
    fireEvent.click(within(actions).getByRole('button', { name: 'Discard' }))
    expect(props.onTry).toHaveBeenCalledTimes(1)
    expect(props.onKeep).toHaveBeenCalledTimes(1)
    expect(props.onDiscard).toHaveBeenCalledTimes(1)
  })

  it('offers to stop trying while the preview wears it', () => {
    const props = card({ trying: true })
    expect(screen.getByText('Trying')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop trying' }))
    expect(props.onStopTrying).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: 'Try' })).toBeNull()
  })

  it('holds its actions while one is under way', () => {
    card({ busy: true })
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled()
  })

  it('names what it breaks and what it mends', () => {
    card({
      proposal: proposal({
        review: {
          ...proposal().review!,
          contrastWorse: [
            {
              foreground: '--theme-foreground',
              background: '--theme-background',
              mode: 'dark',
              threshold: 4.5,
              before: { ratio: 7.1 },
              after: { ratio: 3.2 },
            } as never,
          ],
          contrastFixed: [{} as never],
          warnings: [{ severity: 'warning', message: 'A hook rule overrides it' } as never],
        },
      }),
    })
    expect(screen.getByText(/--theme-foreground on --theme-background \(dark\): 7.1:1 → 3.2:1, needs 4.5:1/)).toBeInTheDocument()
    expect(screen.getByText('A hook rule overrides it')).toBeInTheDocument()
    expect(screen.getByText(/Mends 1 contrast pair/)).toBeInTheDocument()
  })

  it('says a stale proposal no longer applies and offers to ask her again', () => {
    const props = card({ proposal: proposal({ state: 'stale', review: null, staleReason: 'the stylesheet no longer has that rule' }) })
    expect(screen.getByText('No longer applies')).toBeInTheDocument()
    expect(screen.getByText(/the stylesheet no longer has that rule/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Ask her again' }))
    expect(props.onAskAgain).toHaveBeenCalledTimes(1)
  })

  it('shows a decided proposal without its actions', () => {
    card({ proposal: proposal({ state: 'kept' }) })
    expect(screen.getByText('Kept')).toBeInTheDocument()
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByText('A deeper primary for the buttons.')).toBeNull()
  })
})

describe('hand-off texts', () => {
  it('turns an issue into the start of a request', () => {
    expect(issueHandOffText({ severity: 'error', message: 'tokens.json: --theme-primary is not a colour' })).toBe(
      'The draft has this error:\ntokens.json: --theme-primary is not a colour\n\nPlease propose a fix.',
    )
  })

  it('states a failing contrast pair with its ratio and threshold', () => {
    const text = contrastHandOffText({
      pair: { foreground: '--theme-muted-foreground', background: '--theme-background', kind: 'text' },
      mode: 'dark',
      status: 'fail',
      ratio: 3.1,
      threshold: 4.5,
    } as never)
    expect(text).toMatch(/^In dark mode, --theme-muted-foreground on --theme-background is 3.1:1; text needs 4.5:1\./)
  })
})

describe('Calliope in the draft editor', () => {
  const tried = applyChangeSet({ tokens: EMPTY_TOKENS, css: null }, { operations: OPERATIONS })
  let messages: { messages: unknown[]; proposals: ProposalView[]; draftMissing: boolean }
  let calls: Array<{ url: string; method: string; body?: string }>

  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  beforeEach(() => {
    setPreview.mockClear()
    messages = {
      messages: [
        { id: 'u1', type: 'message', role: 'USER', content: 'Something inkier', createdAt: '2026-11-16T11:59:00.000Z' },
        { id: 'p1', type: 'message', role: 'TOOL', content: JSON.stringify({ toolName: 'theme_propose', success: true }), createdAt: '2026-11-16T12:00:00.000Z' },
        { id: 'p2', type: 'message', role: 'TOOL', content: JSON.stringify({ toolName: 'theme_propose', success: true }), createdAt: '2026-11-16T12:01:00.000Z' },
      ],
      proposals: [
        proposal(),
        proposal({ id: 'p2', title: 'Old idea', state: 'stale', review: null, staleReason: 'the draft has changed' }),
      ],
      draftMissing: false,
    }
    calls = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = init?.method ?? 'GET'
      calls.push({ url: String(input), method, body: typeof init?.body === 'string' ? init.body : undefined })
      const ok = (payload: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => payload }) as Response
      const action = url.searchParams.get('action')
      if (url.pathname === '/api/v1/calliope' && method === 'GET') {
        return ok({
          chats: [
            {
              id: 'c1',
              title: 'Inkier',
              themeDraftId: 'my-theme',
              createdAt: '2026-11-16T11:00:00.000Z',
              updatedAt: '2026-11-16T12:00:00.000Z',
              lastMessageAt: '2026-11-16T12:00:00.000Z',
              messageCount: 3,
              consoleConnectionProfileId: null,
              attachmentCount: 0,
            },
          ],
        })
      }
      if (url.pathname === '/api/v1/calliope/c1/messages') return ok(messages)
      if (url.pathname === '/api/v1/calliope/c1' && action === 'try') {
        return ok({ proposalId: 'p1', tokens: tried.ok ? tried.tokens : EMPTY_TOKENS, custom: '.qt-card { outline: 1px solid red; }' })
      }
      if (url.pathname === '/api/v1/calliope/c1' && action === 'keep') {
        messages = { ...messages, proposals: [proposal({ state: 'kept' }), messages.proposals[1]] }
        return ok({ proposalId: 'p1', operations: OPERATIONS, draftChanged: false })
      }
      if (url.pathname === '/api/v1/calliope/c1' && action === 'discard') {
        messages = { ...messages, proposals: [proposal({ state: 'discarded' }), messages.proposals[1]] }
        return ok({ ok: true })
      }
      if (url.pathname === '/api/v1/connection-profiles') return ok({ profiles: [] })
      return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ error: 'not mocked' }) } as Response
    }) as unknown as typeof fetch
  })

  const lastPreviewCss = () => {
    const calls = setPreview.mock.calls.filter((c) => c[0] !== null)
    return (calls[calls.length - 1]?.[0] as { css: string } | undefined)?.css ?? ''
  }

  async function openPanel() {
    renderWithQuery(<DraftEditor detail={detail()} mode="light" onModeChange={() => {}} onBack={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Calliope' }))
    return screen.findByRole('group', { name: 'Decide on Ink blue' })
  }

  it('opens on her latest conversation, with a card for each proposal', async () => {
    await openPanel()
    expect(screen.getByRole('button', { name: 'Calliope' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('heading', { name: 'Old idea' })).toBeInTheDocument()
    expect(screen.getByText('Something inkier')).toBeInTheDocument()
  })

  it('tries a proposal in the preview without touching the draft, and stops trying', async () => {
    const actions = await openPanel()
    expect(lastPreviewCss()).not.toContain('#123456')
    fireEvent.click(within(actions).getByRole('button', { name: 'Try' }))
    await waitFor(() => expect(lastPreviewCss()).toContain('#123456'))
    expect(lastPreviewCss()).toContain('.qt-card { outline: 1px solid red; }')
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()

    fireEvent.click(await screen.findByRole('button', { name: 'Stop trying' }))
    await waitFor(() => expect(lastPreviewCss()).not.toContain('#123456'))
    expect(lastPreviewCss()).not.toContain('outline: 1px solid red')
  })

  it('keeps a proposal through the edit path, as one undo step', async () => {
    const actions = await openPanel()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
    fireEvent.click(within(actions).getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled())
    await waitFor(() => expect(lastPreviewCss()).toContain('#123456'))
    expect(await screen.findByText('Kept')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(lastPreviewCss()).not.toContain('#123456'))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('discards a proposal without touching the draft', async () => {
    const actions = await openPanel()
    fireEvent.click(within(actions).getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('Discarded')).toBeInTheDocument()
    const discard = calls.find((c) => c.url.includes('action=discard'))
    expect(JSON.parse(discard?.body ?? '{}')).toEqual({ proposalId: 'p1' })
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  it('asks her again about a stale proposal, in the composer', async () => {
    await openPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Ask her again' }))
    const composer = screen.getByPlaceholderText('Describe the look you are after…') as HTMLTextAreaElement
    await waitFor(() => expect(composer.value).toMatch(/^Your proposal "Old idea" no longer applies/))
  })

  it('hands a validation issue to her, opening the panel with the request begun', async () => {
    renderWithQuery(
      <DraftEditor
        detail={detail({ issues: [{ severity: 'error', message: 'tokens.json: --theme-primary is not a colour', file: 'tokens.json' }] })}
        mode="light"
        onModeChange={() => {}}
        onBack={() => {}}
      />,
    )
    expect(screen.queryByPlaceholderText('Describe the look you are after…')).toBeNull()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Ask Calliope' }))
    })
    const composer = (await screen.findByPlaceholderText('Describe the look you are after…')) as HTMLTextAreaElement
    await waitFor(() => expect(composer.value).toBe(issueHandOffText({ severity: 'error', message: 'tokens.json: --theme-primary is not a colour' })))
  })
})
