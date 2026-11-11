/**
 * `PUT /api/v1/chats/[id]` `{ chat }`: `contextSummary` is not writable here
 * (it skipped the summary's anchor and turn bookkeeping), and a title sent
 * alone is a manual rename.
 */

import { updateChatSchema, withManualRenameFlag } from '@/app/api/v1/chats/[id]/schemas'

describe('updateChatSchema', () => {
  it('does not carry a contextSummary through', () => {
    expect(updateChatSchema.parse({ contextSummary: 'forged', isPaused: true })).toEqual({ isPaused: true })
  })
})

describe('withManualRenameFlag', () => {
  it('pins a title sent on its own', () => {
    expect(withManualRenameFlag({ title: 'The Long Goodbye' })).toEqual({ title: 'The Long Goodbye', isManuallyRenamed: true })
  })

  it('keeps an explicit choice — the rename dialog may hand titles back to the automatic retitle', () => {
    expect(withManualRenameFlag({ title: 'x', isManuallyRenamed: false })).toEqual({ title: 'x', isManuallyRenamed: false })
  })

  it('leaves a patch with no title alone', () => {
    expect(withManualRenameFlag({ isPaused: true } as { title?: string; isManuallyRenamed?: boolean })).toEqual({ isPaused: true })
  })
})
