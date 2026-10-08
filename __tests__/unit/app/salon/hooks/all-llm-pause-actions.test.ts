/**
 * Regression test for bug 139 — the All-LLM pause dialog's Continue button
 * only closed the dialog. The room stayed paused and no turn was requested,
 * so the dialog's primary action did nothing at all.
 */

import { continueAllLLMRoom } from '@/app/salon/[id]/hooks/all-llm-pause-actions'

describe('continueAllLLMRoom (bug 139)', () => {
  it('closes the dialog, lifts the pause, then asks for the next turn — in that order', async () => {
    const calls: string[] = []
    let resolvePause: () => void = () => {}
    const closeModal = jest.fn(() => { calls.push('close') })
    const setPauseState = jest.fn((paused: boolean) => {
      calls.push(`pause:${paused}`)
      return new Promise<void>((resolve) => { resolvePause = resolve })
    })
    const handleContinue = jest.fn(async () => { calls.push('continue') })

    const done = continueAllLLMRoom({ closeModal, setPauseState, handleContinue })

    // The turn must not be requested until the un-pause has been persisted.
    await Promise.resolve()
    expect(calls).toEqual(['close', 'pause:false'])
    expect(handleContinue).not.toHaveBeenCalled()

    resolvePause()
    await done

    expect(calls).toEqual(['close', 'pause:false', 'continue'])
    expect(setPauseState).toHaveBeenCalledWith(false)
    expect(handleContinue).toHaveBeenCalledTimes(1)
  })
})
