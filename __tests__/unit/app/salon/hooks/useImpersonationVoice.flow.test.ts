/**
 * In Their Own Words — when the dialog spends a model call.
 *
 * Under `ask` the dialog opens on the draft alone and nothing is sent to a
 * model until the operator presses Restate. Under `always` the restatement
 * starts as the dialog opens. In both, a picker change only drops a stale
 * proposal; it never re-runs on its own.
 */

import { renderHook, act, waitFor } from '@testing-library/react'
import { useImpersonationVoice } from '@/app/salon/[id]/hooks/useImpersonationVoice'
import type { ImpersonationVoiceMode } from '@/lib/schemas/settings.types'

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
}))

const SEAT = 'seat-evangeline'
const DRAFT = 'I tell him I will take the job.'

function previewCalls(spy: jest.SpyInstance): unknown[][] {
  return spy.mock.calls.filter(([url]) => String(url).includes('action=impersonation-voice-preview'))
}

function setup() {
  const sendMessage = jest.fn()
  const focusComposer = jest.fn()
  const fetchSpy = jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ proposedMarkdown: 'Very well. I shall take it.', profileName: 'P', modelName: 'M' }),
      } as Response),
    )
  // A spy on an already-mocked global fetch can carry the previous test's calls.
  fetchSpy.mockClear()
  const hook = renderHook(() => useImpersonationVoice({ chatId: 'chat-1', sendMessage, focusComposer }))
  return { ...hook, sendMessage, fetchSpy }
}

function intercept(
  result: ReturnType<typeof setup>['result'],
  mode: ImpersonationVoiceMode,
): boolean {
  const e = { preventDefault: jest.fn() } as unknown as React.FormEvent
  let taken = false
  act(() => {
    taken = result.current.intercept(e, {
      text: DRAFT,
      seat: { id: SEAT, type: 'CHARACTER', controlledBy: 'llm' },
      seatTarget: { participantId: SEAT, characterName: 'Evangeline' },
      mode,
      impersonatingParticipantIds: [SEAT],
      attachedFiles: [],
      pendingToolResults: [],
      sendArgs: { setInput: jest.fn(), setPendingToolResults: jest.fn(), clearDraft: jest.fn() },
    })
  })
  return taken
}

describe('useImpersonationVoice — model calls', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('off: does not take the submit over', () => {
    const { result, fetchSpy } = setup()
    expect(intercept(result, 'off')).toBe(false)
    expect(result.current.isOpen).toBe(false)
    expect(previewCalls(fetchSpy)).toHaveLength(0)
  })

  it('ask: opens on the draft and calls no model', () => {
    const { result, fetchSpy } = setup()
    expect(intercept(result, 'ask')).toBe(true)
    expect(result.current.isOpen).toBe(true)
    expect(result.current.stage).toBe('draft')
    expect(result.current.seed).toBe(DRAFT)
    expect(previewCalls(fetchSpy)).toHaveLength(0)
  })

  it('ask: Send as written posts the draft without ever calling a model', () => {
    const { result, fetchSpy, sendMessage } = setup()
    intercept(result, 'ask')
    act(() => result.current.sendAsWritten())
    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage.mock.calls[0][1]).toBe(DRAFT)
    expect(result.current.isOpen).toBe(false)
    expect(previewCalls(fetchSpy)).toHaveLength(0)
  })

  it('ask: Restate is what calls the model', async () => {
    const { result, fetchSpy } = setup()
    intercept(result, 'ask')
    act(() => result.current.restate())
    await waitFor(() => expect(result.current.stage).toBe('review'))
    expect(previewCalls(fetchSpy)).toHaveLength(1)
    expect(result.current.proposal).toBe('Very well. I shall take it.')
  })

  it('always: starts the restatement as the dialog opens', async () => {
    const { result, fetchSpy } = setup()
    intercept(result, 'always')
    await waitFor(() => expect(result.current.stage).toBe('review'))
    expect(previewCalls(fetchSpy)).toHaveLength(1)
  })

  it('a picker change drops the proposal and does not re-run', async () => {
    const { result, fetchSpy } = setup()
    intercept(result, 'always')
    await waitFor(() => expect(result.current.stage).toBe('review'))

    act(() => result.current.changeProfile('profile-2'))
    expect(result.current.stage).toBe('draft')
    expect(result.current.proposal).toBe('')
    expect(result.current.profileOverride).toBe('profile-2')

    act(() => result.current.changeSystemPrompt('prompt-2'))
    expect(result.current.stage).toBe('draft')
    expect(previewCalls(fetchSpy)).toHaveLength(1)

    act(() => result.current.restate())
    await waitFor(() => expect(result.current.stage).toBe('review'))
    const calls = previewCalls(fetchSpy)
    expect(calls).toHaveLength(2)
    const body = JSON.parse(String((calls[1][1] as RequestInit).body))
    expect(body.connectionProfileId).toBe('profile-2')
    expect(body.systemPromptId).toBe('prompt-2')
  })
})
