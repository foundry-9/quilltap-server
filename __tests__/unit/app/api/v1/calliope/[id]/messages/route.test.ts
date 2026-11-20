/**
 * @jest-environment node
 *
 * Calliope messages route: POST streams SSE (attachments validated), GET loads
 * messages with proposals judged against the draft.
 */

jest.mock('@/lib/api/middleware', () => {
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
    createContextParamsHandler: (handler: any) =>
      wrap(async (req: any, { params }: any) => handler(req, (globalThis as any).__ctx, await params)),
  }
})

jest.mock('@/lib/console-engine/attachments', () => ({
  collectAttachmentIds: jest.fn(() => ['a1']),
  describeConsoleAttachments: jest.fn(async () => new Map()),
  findConsoleAttachmentLink: jest.fn(),
}))

jest.mock('@/lib/services/calliope/persona', () => ({
  CALLIOPE_ATTACHMENT_FOLDER: 'Calliope',
  handleCalliopeMessage: jest.fn(async () => new ReadableStream({ start(c) { c.close() } })),
}))

jest.mock('@/lib/calliope/proposals', () => ({
  storedProposals: jest.fn(() => [{ id: 'p1' }]),
  viewProposal: jest.fn((s: any) => ({ id: s.id, state: 'offered' })),
}))

jest.mock('@/lib/themes/drafts', () => {
  class ThemeDraftNotFoundError extends Error {}
  return { readDraft: jest.fn(), ThemeDraftNotFoundError }
})

import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/v1/calliope/[id]/messages/route'
import { findConsoleAttachmentLink, describeConsoleAttachments } from '@/lib/console-engine/attachments'
import { handleCalliopeMessage } from '@/lib/services/calliope/persona'
import { readDraft, ThemeDraftNotFoundError } from '@/lib/themes/drafts'

const CHAT = '11111111-1111-4111-8111-111111111111'
const FILE = '55555555-5555-4555-8555-555555555555'
const url = `http://localhost/api/v1/calliope/${CHAT}/messages`
const params = { params: Promise.resolve({ id: CHAT }) }

let repos: any
let chat: any
let msgs: any[]

const post = (body: unknown) =>
  new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
const get = () => new NextRequest(url, { method: 'GET' })

beforeEach(() => {
  jest.clearAllMocks()
  chat = { id: CHAT, userId: 'u1', chatType: 'calliope', themeDraftId: 'd1' }
  msgs = [
    { id: 'm1', type: 'message', role: 'USER', content: 'hi', attachments: ['a1', 'a2'] },
    { id: 'm2', type: 'message', role: 'ASSISTANT', content: 'yo' },
  ]
  repos = { chats: { findById: jest.fn(async () => chat), getMessages: jest.fn(async () => msgs) } }
  ;(globalThis as any).__ctx = { user: { id: 'u1' }, repos }
  ;(readDraft as jest.Mock).mockResolvedValue({ revision: 'r' })
  ;(findConsoleAttachmentLink as jest.Mock).mockResolvedValue({ id: 'link' })
  ;(describeConsoleAttachments as jest.Mock).mockResolvedValue(new Map([['a1', { id: 'a1', filename: 'f.png' }]]))
})

describe('POST', () => {
  it('streams SSE headers and passes the content on', async () => {
    const res = await POST(post({ content: 'hello' }), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(handleCalliopeMessage).toHaveBeenCalledWith(repos, CHAT, 'u1', { content: 'hello', fileIds: [] })
  })

  it('dedupes fileIds and checks each is a Calliope attachment', async () => {
    await POST(post({ content: '', fileIds: [FILE, FILE] }), params)
    expect(findConsoleAttachmentLink).toHaveBeenCalledTimes(1)
    expect(handleCalliopeMessage).toHaveBeenCalledWith(repos, CHAT, 'u1', { content: '', fileIds: [FILE] })
  })

  it('400s when an attachment is not Calliope\'s', async () => {
    ;(findConsoleAttachmentLink as jest.Mock).mockResolvedValue(null)
    const res = await POST(post({ content: 'x', fileIds: [FILE] }), params)
    expect(res.status).toBe(400)
    expect(handleCalliopeMessage).not.toHaveBeenCalled()
  })

  it('400s on empty content with no files, bad ids, or extra fields', async () => {
    expect((await POST(post({ content: '   ' }), params)).status).toBe(400)
    expect((await POST(post({ content: 'x', fileIds: ['nope'] }), params)).status).toBe(400)
    expect((await POST(post({ content: 'x', extra: 1 }), params)).status).toBe(400)
    expect(handleCalliopeMessage).not.toHaveBeenCalled()
  })

  it('404s for a non-Calliope chat', async () => {
    chat.chatType = 'salon'
    expect((await POST(post({ content: 'x' }), params)).status).toBe(404)
  })
})

describe('GET', () => {
  it('returns messages with resolved attachments and proposals', async () => {
    const res = await GET(get(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draftMissing).toBe(false)
    expect(body.proposals).toEqual([{ id: 'p1', state: 'offered' }])
    expect(body.messages[0].attachments[0]).toEqual({ id: 'a1', filename: 'f.png' })
    expect(body.messages[0].attachments[1]).toMatchObject({ id: 'a2', missing: true, filename: 'Missing file' })
    expect(body.messages[1].attachments).toBeUndefined()
  })

  it('reports draftMissing with no proposals when the draft is gone', async () => {
    ;(readDraft as jest.Mock).mockRejectedValue(new ThemeDraftNotFoundError('gone'))
    const body = await (await GET(get(), params)).json()
    expect(body).toMatchObject({ draftMissing: true, proposals: [] })
    expect(body.messages).toHaveLength(2)
  })

  it('rethrows other draft errors', async () => {
    ;(readDraft as jest.Mock).mockRejectedValue(new Error('disk'))
    await expect(GET(get(), params)).rejects.toThrow('disk')
  })

  it('404s for another user\'s conversation', async () => {
    chat.userId = 'other'
    expect((await GET(get(), params)).status).toBe(404)
  })
})
