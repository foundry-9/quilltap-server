/**
 * @jest-environment node
 *
 * Calliope item route: GET, rename, set-model, keep / try / discard, delete.
 * Keep and discard only RECORD the decision (recordProposalDecision); the
 * route never writes the theme draft.
 */

jest.mock('@/lib/api/middleware', () => {
  const actions = jest.requireActual('@/lib/api/middleware/actions')
  const { NextResponse } = jest.requireActual('next/server')
  const wrap = (fn: (...a: any[]) => Promise<any>) => async (...a: any[]) => {
    try {
      return await fn(...a)
    } catch (error: any) {
      if (error?.name === 'ZodError') return NextResponse.json({ error: 'Validation error' }, { status: 400 })
      throw error
    }
  }
  return {
    ...actions,
    createContextParamsHandler: (handler: any) =>
      wrap(async (req: any, { params }: any) => handler(req, (globalThis as any).__ctx, await params)),
  }
})

jest.mock('@/lib/console-engine/attachments', () => ({
  deleteConsoleAttachmentsForChat: jest.fn(async () => ({ deleted: 2, kept: 1 })),
}))

jest.mock('@/lib/services/calliope/persona', () => ({ CALLIOPE_ATTACHMENT_FOLDER: 'Calliope' }))

jest.mock('@/lib/calliope/proposals', () => ({
  readStoredProposal: jest.fn(),
  recordProposalDecision: jest.fn(async () => true),
  viewProposal: jest.fn(),
}))

jest.mock('@/lib/themes/assist', () => ({ previewProposal: jest.fn() }))

jest.mock('@/lib/themes/drafts', () => {
  class ThemeDraftNotFoundError extends Error {}
  return { readDraft: jest.fn(), ThemeDraftNotFoundError }
})

import { NextRequest } from 'next/server'
import { GET, PATCH, POST, DELETE } from '@/app/api/v1/calliope/[id]/route'
import { deleteConsoleAttachmentsForChat } from '@/lib/console-engine/attachments'
import { readStoredProposal, recordProposalDecision, viewProposal } from '@/lib/calliope/proposals'
import { previewProposal } from '@/lib/themes/assist'
import { readDraft, ThemeDraftNotFoundError } from '@/lib/themes/drafts'

const CHAT = '11111111-1111-4111-8111-111111111111'
const PROFILE = '66666666-6666-4666-8666-666666666666'

const readStored = readStoredProposal as jest.Mock
const record = recordProposalDecision as jest.Mock
const view = viewProposal as jest.Mock
const preview = previewProposal as jest.Mock
const draftRead = readDraft as jest.Mock

let chats: Record<string, any>
let repos: any
const messages = [{ id: 'p1', type: 'message', role: 'TOOL' }, { id: 'm1', type: 'message', role: 'USER' }]

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const params = (id = CHAT) => ({ params: Promise.resolve({ id }) })
const base = `/api/v1/calliope/${CHAT}`

beforeEach(() => {
  jest.clearAllMocks()
  chats = { [CHAT]: { id: CHAT, userId: 'u1', chatType: 'calliope', themeDraftId: 'd1', title: 'T' } }
  repos = {
    chats: {
      findById: jest.fn(async (id: string) => chats[id] ?? null),
      getMessages: jest.fn(async () => messages),
      update: jest.fn(async (_id: string, data: any) => ({ ...chats[CHAT], ...data })),
      updateMessage: jest.fn(),
      delete: jest.fn(async () => true),
    },
    connections: { findById: jest.fn(async () => ({ id: PROFILE, userId: 'u1' })) },
  }
  ;(globalThis as any).__ctx = { user: { id: 'u1' }, repos }
  readStored.mockImplementation((e: any) =>
    e.id === 'p1' ? { id: 'p1', changeSet: { operations: [] }, decision: null } : null)
  draftRead.mockResolvedValue({ revision: 'r1', styles: { revision: 's1' } })
  view.mockReturnValue({ state: 'offered', operations: [{ op: 'x' }], review: { r: 1 }, draftChanged: false, staleReason: null })
})

describe('GET', () => {
  it('returns conversation details', async () => {
    const res = await GET(jsonReq(base, 'GET'), params())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.chat).toMatchObject({ id: CHAT, themeDraftId: 'd1', messageCount: 2, consoleConnectionProfileId: null })
  })

  it('404s for a non-Calliope chat', async () => {
    chats[CHAT].chatType = 'brahma'
    expect((await GET(jsonReq(base, 'GET'), params())).status).toBe(404)
  })
})

describe('PATCH', () => {
  it('renames and marks manually renamed', async () => {
    const res = await PATCH(jsonReq(base, 'PATCH', { title: '  New  ' }), params())
    expect(res.status).toBe(200)
    expect(repos.chats.update).toHaveBeenCalledWith(CHAT, { title: 'New', isManuallyRenamed: true })
  })

  it('400s on an empty title and on unknown fields', async () => {
    expect((await PATCH(jsonReq(base, 'PATCH', { title: '   ' }), params())).status).toBe(400)
    expect((await PATCH(jsonReq(base, 'PATCH', { title: 'a', extra: 1 }), params())).status).toBe(400)
    expect(repos.chats.update).not.toHaveBeenCalled()
  })

  it('500s when the update returns nothing', async () => {
    repos.chats.update.mockResolvedValue(null)
    expect((await PATCH(jsonReq(base, 'PATCH', { title: 'a' }), params())).status).toBe(500)
  })

  it('set-model switches the profile', async () => {
    const res = await PATCH(jsonReq(`${base}?action=set-model`, 'PATCH', { connectionProfileId: PROFILE }), params())
    expect(res.status).toBe(200)
    expect(repos.chats.update).toHaveBeenCalledWith(CHAT, { consoleConnectionProfileId: PROFILE })
  })

  it('set-model 400s on a non-UUID, an unknown profile, or another user\'s profile', async () => {
    expect((await PATCH(jsonReq(`${base}?action=set-model`, 'PATCH', { connectionProfileId: 'x' }), params())).status).toBe(400)
    repos.connections.findById.mockResolvedValue(null)
    expect((await PATCH(jsonReq(`${base}?action=set-model`, 'PATCH', { connectionProfileId: PROFILE }), params())).status).toBe(400)
    repos.connections.findById.mockResolvedValue({ id: PROFILE, userId: 'other' })
    expect((await PATCH(jsonReq(`${base}?action=set-model`, 'PATCH', { connectionProfileId: PROFILE }), params())).status).toBe(400)
    expect(repos.chats.update).not.toHaveBeenCalled()
  })

  it('unknown action 400s and does not rename', async () => {
    const res = await PATCH(jsonReq(`${base}?action=bogus`, 'PATCH', { title: 'a' }), params())
    expect(res.status).toBe(400)
    expect(repos.chats.update).not.toHaveBeenCalled()
  })
})

describe('POST', () => {
  it('without an action is 400', async () => {
    expect((await POST(jsonReq(base, 'POST', { proposalId: 'p1' }), params())).status).toBe(400)
  })

  it('unknown action is 400 and records nothing', async () => {
    expect((await POST(jsonReq(`${base}?action=bogus`, 'POST', { proposalId: 'p1' }), params())).status).toBe(400)
    expect(record).not.toHaveBeenCalled()
  })

  it('404s for a chat that is not Calliope\'s', async () => {
    chats[CHAT].chatType = 'salon'
    expect((await POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'p1' }), params())).status).toBe(404)
  })

  describe('keep', () => {
    it('records the decision and returns operations without writing the draft', async () => {
      const res = await POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'p1' }), params())
      expect(res.status).toBe(200)
      expect(record).toHaveBeenCalledWith(repos, CHAT, messages[0], 'kept')
      const body = await res.json()
      expect(body).toMatchObject({ proposalId: 'p1', operations: [{ op: 'x' }], review: { r: 1 }, draftChanged: false, revision: 'r1', stylesRevision: 's1' })
      // The only write is the decision record.
      expect(repos.chats.update).not.toHaveBeenCalled()
      expect(repos.chats.updateMessage).not.toHaveBeenCalled()
    })

    it('stylesRevision is null when the draft has no stylesheet', async () => {
      draftRead.mockResolvedValue({ revision: 'r1' })
      const body = await (await POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'p1' }), params())).json()
      expect(body.stylesRevision).toBeNull()
    })

    it('400s without a proposalId', async () => {
      expect((await POST(jsonReq(`${base}?action=keep`, 'POST', {}), params())).status).toBe(400)
    })

    it('404s for an unknown proposal', async () => {
      expect((await POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'm1' }), params())).status).toBe(404)
      expect(record).not.toHaveBeenCalled()
    })

    it('409s for an already decided proposal', async () => {
      readStored.mockReturnValue({ id: 'p1', changeSet: {}, decision: 'discarded' })
      expect((await POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'p1' }), params())).status).toBe(409)
      expect(record).not.toHaveBeenCalled()
    })

    it('404s when the draft is gone', async () => {
      draftRead.mockRejectedValue(new ThemeDraftNotFoundError('gone'))
      expect((await POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'p1' }), params())).status).toBe(404)
      expect(record).not.toHaveBeenCalled()
    })

    it('rethrows other draft read errors', async () => {
      draftRead.mockRejectedValue(new Error('disk'))
      await expect(POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'p1' }), params())).rejects.toThrow('disk')
    })

    it('409s a stale proposal and leaves it offered', async () => {
      view.mockReturnValue({ state: 'stale', staleReason: 'token gone' })
      const res = await POST(jsonReq(`${base}?action=keep`, 'POST', { proposalId: 'p1' }), params())
      expect(res.status).toBe(409)
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('discard', () => {
    it('records a discard', async () => {
      const res = await POST(jsonReq(`${base}?action=discard`, 'POST', { proposalId: 'p1' }), params())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ proposalId: 'p1', state: 'discarded' })
      expect(record).toHaveBeenCalledWith(repos, CHAT, messages[0], 'discarded')
      expect(readDraft).not.toHaveBeenCalled()
    })

    it('404s unknown and 409s decided proposals', async () => {
      expect((await POST(jsonReq(`${base}?action=discard`, 'POST', { proposalId: 'zzz' }), params())).status).toBe(404)
      readStored.mockReturnValue({ id: 'p1', changeSet: {}, decision: 'kept' })
      expect((await POST(jsonReq(`${base}?action=discard`, 'POST', { proposalId: 'p1' }), params())).status).toBe(409)
      expect(record).not.toHaveBeenCalled()
    })
  })

  describe('try', () => {
    it('returns the preview and records nothing', async () => {
      readStored.mockReturnValue({ id: 'p1', changeSet: { cs: 1 }, decision: 'kept' })
      preview.mockReturnValue({ ok: true, tokens: { a: 1 }, custom: 'css' })
      const res = await POST(jsonReq(`${base}?action=try`, 'POST', { proposalId: 'p1' }), params())
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ proposalId: 'p1', tokens: { a: 1 }, custom: 'css' })
      expect(preview).toHaveBeenCalledWith({ revision: 'r1', styles: { revision: 's1' } }, { cs: 1 })
      expect(record).not.toHaveBeenCalled()
    })

    it('409s when the proposal no longer applies', async () => {
      preview.mockReturnValue({ ok: false, reason: 'stale' })
      expect((await POST(jsonReq(`${base}?action=try`, 'POST', { proposalId: 'p1' }), params())).status).toBe(409)
    })

    it('404s for an unknown proposal or missing draft', async () => {
      expect((await POST(jsonReq(`${base}?action=try`, 'POST', { proposalId: 'm1' }), params())).status).toBe(404)
      draftRead.mockRejectedValue(new ThemeDraftNotFoundError('gone'))
      expect((await POST(jsonReq(`${base}?action=try`, 'POST', { proposalId: 'p1' }), params())).status).toBe(404)
    })
  })
})

describe('DELETE', () => {
  it('deletes the conversation with its attachments', async () => {
    const res = await DELETE(jsonReq(base, 'DELETE'), params())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: true, attachmentsDeleted: 2, attachmentsKept: 1 })
    expect(deleteConsoleAttachmentsForChat).toHaveBeenCalledWith('Calliope', repos, CHAT)
    expect(repos.chats.delete).toHaveBeenCalledWith(CHAT)
  })

  it('500s when delete fails and 404s for a foreign chat', async () => {
    repos.chats.delete.mockResolvedValue(false)
    expect((await DELETE(jsonReq(base, 'DELETE'), params())).status).toBe(500)
    chats[CHAT].userId = 'other'
    expect((await DELETE(jsonReq(base, 'DELETE'), params())).status).toBe(404)
  })
})
