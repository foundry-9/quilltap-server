/**
 * Turn control: the registry behind the composer's Stop and raised hand.
 */

import {
  runWithTurnControl,
  currentTurnStopSignal,
  isCurrentTurnStopped,
  takeRaisedHand,
  hasActiveTurn,
  setHandRaised,
  stopActiveTurns,
  waitForEarlierTurns,
} from '@/lib/chat/turn-control'

jest.mock('@/lib/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

/** A latch the test opens to let a registered stream finish. */
function latch(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => {}
  const promise = new Promise<void>((resolve) => { open = resolve })
  return { promise, open }
}

describe('turn control', () => {
  it('has no handle outside a registered stream', () => {
    expect(currentTurnStopSignal()).toBeUndefined()
    expect(isCurrentTurnStopped()).toBe(false)
    expect(takeRaisedHand()).toBe(false)
  })

  it('registers a stream for its lifetime only', async () => {
    const gate = latch()
    const run = runWithTurnControl('chat-a', async () => {
      expect(hasActiveTurn('chat-a')).toBe(true)
      expect(currentTurnStopSignal()?.aborted).toBe(false)
      await gate.promise
      return 'done'
    })
    gate.open()
    await expect(run).resolves.toBe('done')
    expect(hasActiveTurn('chat-a')).toBe(false)
  })

  it('unregisters a stream that throws', async () => {
    await expect(runWithTurnControl('chat-b', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(hasActiveTurn('chat-b')).toBe(false)
  })

  it('hands a raised hand to the first turn that asks, and only once', async () => {
    const gate = latch()
    const answers: boolean[] = []
    const run = runWithTurnControl('chat-c', async () => {
      await gate.promise
      answers.push(takeRaisedHand(), takeRaisedHand())
    })
    expect(setHandRaised('chat-c', true)).toBe(1)
    gate.open()
    await run
    expect(answers).toEqual([true, false])
  })

  it('lowers a hand before anyone is asked', async () => {
    const gate = latch()
    let asked: boolean | undefined
    const run = runWithTurnControl('chat-d', async () => {
      await gate.promise
      asked = takeRaisedHand()
    })
    setHandRaised('chat-d', true)
    setHandRaised('chat-d', false)
    gate.open()
    await run
    expect(asked).toBe(false)
  })

  it('reports no stream to raise a hand on when nothing is running', () => {
    expect(setHandRaised('chat-idle', true)).toBe(0)
  })

  it('stops the running stream, waits for it to settle, and clears its hand', async () => {
    const seen: { aborted?: boolean; stopped?: boolean; hand?: boolean } = {}
    const run = runWithTurnControl('chat-e', async () => {
      const signal = currentTurnStopSignal()!
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
      seen.aborted = signal.aborted
      seen.stopped = isCurrentTurnStopped()
      seen.hand = takeRaisedHand()
    })
    setHandRaised('chat-e', true)

    const result = await stopActiveTurns('chat-e')

    expect(result).toEqual({ stopped: 1, settled: true })
    expect(seen).toEqual({ aborted: true, stopped: true, hand: false })
    await run
  })

  it('never touches a fresh stream opened after the stop', async () => {
    const first = latch()
    const firstRun = runWithTurnControl('chat-f', async () => { await first.promise })
    const stopping = stopActiveTurns('chat-f', { settleTimeoutMs: 1000 })

    let secondStopped: boolean | undefined
    await runWithTurnControl('chat-f', async () => { secondStopped = isCurrentTurnStopped() })
    first.open()

    await expect(stopping).resolves.toEqual({ stopped: 1, settled: true })
    await firstRun
    expect(secondStopped).toBe(false)
  })

  it('gives up waiting on a stream that will not settle', async () => {
    const stuck = latch()
    const run = runWithTurnControl('chat-g', async () => { await stuck.promise })
    await expect(stopActiveTurns('chat-g', { settleTimeoutMs: 20 })).resolves.toEqual({ stopped: 1, settled: false })
    stuck.open()
    await run
  })

  it('is a no-op stop when nothing is running', async () => {
    await expect(stopActiveTurns('chat-none')).resolves.toEqual({ stopped: 0, settled: true })
  })
  describe('waitForEarlierTurns (bug 258)', () => {
    it('returns at once when no earlier stream is open', async () => {
      await expect(runWithTurnControl('chat-w1', () => waitForEarlierTurns('chat-w1'))).resolves.toBe(0)
    })

    it('waits for a stream opened earlier to finish before going on', async () => {
      const gate = latch()
      const order: string[] = []
      const chain = runWithTurnControl('chat-w2', async () => {
        await gate.promise
        order.push('chain done')
      })
      const whisper = runWithTurnControl('chat-w2', async () => {
        const waited = await waitForEarlierTurns('chat-w2')
        order.push('whisper runs')
        return waited
      })
      await Promise.resolve()
      expect(order).toEqual([])
      gate.open()
      await expect(whisper).resolves.toBe(1)
      await chain
      expect(order).toEqual(['chain done', 'whisper runs'])
    })

    it('never waits on a stream opened after it, so two waiters cannot deadlock', async () => {
      const gate = latch()
      const order: string[] = []
      const chain = runWithTurnControl('chat-w3', async () => {
        await gate.promise
        order.push('chain')
      })
      const first = runWithTurnControl('chat-w3', async () => {
        await waitForEarlierTurns('chat-w3')
        order.push('first whisper')
      })
      const second = runWithTurnControl('chat-w3', async () => {
        const waited = await waitForEarlierTurns('chat-w3')
        order.push('second whisper')
        return waited
      })
      gate.open()
      await expect(second).resolves.toBe(2)
      await Promise.all([chain, first])
      expect(order).toEqual(['chain', 'first whisper', 'second whisper'])
    })

    it('ignores streams in other chats', async () => {
      const gate = latch()
      const other = runWithTurnControl('chat-w4-other', () => gate.promise)
      await expect(runWithTurnControl('chat-w4', () => waitForEarlierTurns('chat-w4'))).resolves.toBe(0)
      gate.open()
      await other
    })
  })
})
