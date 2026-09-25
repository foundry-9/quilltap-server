/**
 * maybeSwitchAfterClassification — the classifier's dangerous verdict moves a
 * chat to Unmoderated, decided in the parent against the chat as it stands
 * now, never against the snapshot the classifier job read.
 */

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))
jest.mock('@/lib/services/dangerous-content/manual-flip', () => ({
  applyConciergeFlip: jest.fn(async () => ({ newState: 'unmoderated', changed: true })),
}))

import { getRepositories } from '@/lib/repositories/factory'
import { applyConciergeFlip } from '@/lib/services/dangerous-content/manual-flip'
import { maybeSwitchAfterClassification } from '@/lib/services/dangerous-content/classifier-switch'

const verdict = { score: 0.9, threshold: 0.7, categories: [{ category: 'sexual', score: 0.9 }] }
let row: Record<string, unknown> | null

beforeEach(() => {
  jest.clearAllMocks()
  row = { id: 'chat-1', conciergeMode: 'moderated' }
  jest.mocked(getRepositories).mockReturnValue({ chats: { findById: jest.fn(async () => row) } } as never)
})

describe('maybeSwitchAfterClassification', () => {
  it('moves a chat that is still Moderated, with the verdict for the announcement', async () => {
    await expect(maybeSwitchAfterClassification('chat-1', verdict)).resolves.toEqual({ switched: true })
    expect(applyConciergeFlip).toHaveBeenCalledWith('chat-1', 'unmoderated', row, {
      by: 'concierge',
      reason: 'classifier',
      classification: verdict,
    })
  })

  it.each(['locked', 'unmoderated'])('leaves a chat the operator made %s while the classifier was thinking', async (mode) => {
    row = { id: 'chat-1', conciergeMode: mode }
    await expect(maybeSwitchAfterClassification('chat-1', verdict)).resolves.toEqual({ switched: false })
    expect(applyConciergeFlip).not.toHaveBeenCalled()
  })

  it('does nothing for a missing chat', async () => {
    row = null
    await expect(maybeSwitchAfterClassification('chat-1', verdict)).resolves.toEqual({ switched: false })
  })

  it('refuses to run in the job child', async () => {
    process.env.QUILLTAP_JOB_CHILD = '1'
    try {
      await expect(maybeSwitchAfterClassification('chat-1', verdict)).resolves.toEqual({ switched: false })
    } finally {
      delete process.env.QUILLTAP_JOB_CHILD
    }
    expect(applyConciergeFlip).not.toHaveBeenCalled()
  })
})
