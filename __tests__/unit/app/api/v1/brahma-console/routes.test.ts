/**
 * @jest-environment node
 *
 * Brahma Console routes — Writing Assistant (create with mode and context,
 * set-context, save-output) and attachments (upload, discard-upload, the
 * messages route's fileId check, delete with attachments).
 *
 * The context middleware is replaced by a thin wrapper (user + repos, a
 * ZodError → 400 as the real one does); action dispatch is the real one.
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
    createContextHandler: (handler: any) => wrap(async (req: any) => handler(req, (globalThis as any).__ctx)),
    createContextParamsHandler: (handler: any) =>
      wrap(async (req: any, { params }: any) => handler(req, (globalThis as any).__ctx, await params)),
  }
})

jest.mock('@/lib/brahma-console/attachments', () => ({
  collectAttachmentIds: jest.requireActual('@/lib/brahma-console/attachments').collectAttachmentIds,
  storeConsoleAttachment: jest.fn(),
  discardConsoleAttachment: jest.fn(),
  findConsoleAttachmentLink: jest.fn(),
  describeConsoleAttachments: jest.fn(async () => new Map()),
  deleteConsoleAttachmentsForChat: jest.fn(async () => ({ deleted: 2, kept: 1 })),
}))

jest.mock('@/lib/brahma-console/writing-context', () => {
  const actual = jest.requireActual('@/lib/brahma-console/writing-context')
  return { ...actual, resolveConsoleContext: jest.fn(async () => ({ conversations: [], projects: [], stores: [], general: null, characterVaults: [], missing: [] })) }
})

jest.mock('@/lib/documents/core', () => ({
  ensureDocument: jest.fn(),
  writeDocument: jest.fn(async () => ({ mtime: 1 })),
}))

jest.mock('@/lib/documents/operator-doc-actions', () => ({
  STANDALONE_ACCESS_CONTEXT: { characterIds: [] },
  resolveOperatorDocPath: jest.fn(async (_ctx: unknown, p: { filePath: string }) => ({ scope: 'document_store', relativePath: p.filePath })),
}))

jest.mock('@/lib/doc-edit/uri-producers', () => ({
  docStoreUriFor: jest.fn(async (a: { mountPointName: string; relativePath: string }) => `qtap://${a.mountPointName}/${a.relativePath}`),
}))

jest.mock('@/lib/services/brahma-console/orchestrator.service', () => ({
  handleBrahmaConsoleMessage: jest.fn(async () => new ReadableStream({ start(c) { c.close() } })),
}))

import { NextRequest } from 'next/server'
import { POST as collectionPOST } from '@/app/api/v1/brahma-console/route'
import { PATCH as itemPATCH, POST as itemPOST, DELETE as itemDELETE } from '@/app/api/v1/brahma-console/[id]/route'
import { POST as messagesPOST } from '@/app/api/v1/brahma-console/[id]/messages/route'
import {
  storeConsoleAttachment,
  discardConsoleAttachment,
  findConsoleAttachmentLink,
  deleteConsoleAttachmentsForChat,
} from '@/lib/brahma-console/attachments'
import { ensureDocument, writeDocument } from '@/lib/documents/core'
import { handleBrahmaConsoleMessage } from '@/lib/services/brahma-console/orchestrator.service'

const CHAT = '11111111-1111-4111-8111-111111111111'
const SALON = '22222222-2222-4222-8222-222222222222'
const HELP = '33333333-3333-4333-8333-333333333333'
const STORE = '44444444-4444-4444-8444-444444444444'
const FILE = '55555555-5555-4555-8555-555555555555'
const PROFILE = '66666666-6666-4666-8666-666666666666'

const chats: Record<string, any> = {}

function makeRepos() {
  return {
    chats: {
      findById: jest.fn(async (id: string) => chats[id] ?? null),
      create: jest.fn(async (data: any) => ({ id: CHAT, ...data })),
      update: jest.fn(async (id: string, data: any) => ({ ...chats[id], ...data })),
      delete: jest.fn(async () => true),
      getMessages: jest.fn(async () => [
        { type: 'message', id: 'out-1', role: 'ASSISTANT', content: '# The Piece', systemKind: 'writing-output' },
        { type: 'message', id: 'plain-1', role: 'ASSISTANT', content: 'notice', systemKind: null },
      ]),
      findByUserId: jest.fn(async () => []),
    },
    connections: {
      findById: jest.fn(async () => ({ id: PROFILE, userId: 'u1' })),
      findDefault: jest.fn(async () => ({ id: PROFILE, userId: 'u1' })),
    },
    projects: { findByIdRaw: jest.fn(async () => null) },
    docMountPoints: {
      findById: jest.fn(async (id: string) => (id === STORE ? { id: STORE, name: 'House Style', enabled: true } : null)),
    },
  }
}

let repos: ReturnType<typeof makeRepos>

function jsonReq(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  jest.clearAllMocks()
  for (const k of Object.keys(chats)) delete chats[k]
  chats[CHAT] = { id: CHAT, userId: 'u1', chatType: 'brahma', consoleMode: 'writing', consoleContext: [], participants: [] }
  chats[SALON] = { id: SALON, userId: 'u1', chatType: 'salon', participants: [] }
  chats[HELP] = { id: HELP, userId: 'u1', chatType: 'help', participants: [] }
  repos = makeRepos()
  ;(globalThis as any).__ctx = { user: { id: 'u1' }, repos }
})

describe('POST /api/v1/brahma-console (create)', () => {
  it('opens a Writing Assistant conversation with its context', async () => {
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console', 'POST', {
      mode: 'writing',
      context: [{ kind: 'chat', id: SALON }, { kind: 'store', id: STORE }, { kind: 'general' }, { kind: 'general' }],
    }))
    expect(res.status).toBe(201)
    expect(repos.chats.create).toHaveBeenCalledWith(expect.objectContaining({
      chatType: 'brahma',
      consoleMode: 'writing',
      consoleContext: [{ kind: 'chat', id: SALON }, { kind: 'store', id: STORE }, { kind: 'general' }],
    }))
  })

  it('refuses a context without the mode', async () => {
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console', 'POST', { context: [{ kind: 'general' }] }))
    expect(res.status).toBe(400)
    expect(repos.chats.create).not.toHaveBeenCalled()
  })

  it('refuses a chat ref that is not a Salon or autonomous conversation', async () => {
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console', 'POST', { mode: 'writing', context: [{ kind: 'chat', id: HELP }] }))
    expect(res.status).toBe(400)
  })

  it('refuses a ref that names nothing (or another user\'s row)', async () => {
    chats[SALON].userId = 'someone-else'
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console', 'POST', { mode: 'writing', context: [{ kind: 'chat', id: SALON }] }))
    expect(res.status).toBe(400)
    const res2 = await collectionPOST(jsonReq('/api/v1/brahma-console', 'POST', { mode: 'writing', context: [{ kind: 'project', id: STORE }] }))
    expect(res2.status).toBe(400)
  })

  it('creates an ordinary Console chat with no mode', async () => {
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console', 'POST', {}))
    expect(res.status).toBe(201)
    expect(repos.chats.create.mock.calls[0][0].consoleMode).toBeUndefined()
  })

  it('answers an unknown action with 400, never a create', async () => {
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console?action=bogus', 'POST', {}))
    expect(res.status).toBe(400)
    expect(repos.chats.create).not.toHaveBeenCalled()
  })
})

describe('upload / discard-upload', () => {
  it('stores an upload under Brahma/', async () => {
    jest.mocked(storeConsoleAttachment).mockResolvedValue({ id: FILE, filename: 'a.txt', mimeType: 'text/plain', size: 5, path: 'Brahma/a.txt', isImage: false })
    const form = new FormData()
    form.append('file', new File(['hello'], 'a.txt', { type: 'text/plain' }))
    const res = await collectionPOST(new NextRequest('http://localhost/api/v1/brahma-console?action=upload', { method: 'POST', body: form }))
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toMatchObject({ id: FILE, path: 'Brahma/a.txt' })
    expect(jest.mocked(storeConsoleAttachment).mock.calls[0][0]).toMatchObject({ filename: 'a.txt', mimeType: 'text/plain' })
  })

  it('refuses an upload with no file', async () => {
    const res = await collectionPOST(new NextRequest('http://localhost/api/v1/brahma-console?action=upload', { method: 'POST', body: new FormData() }))
    expect(res.status).toBe(400)
  })

  it('discards an upload still under Brahma/', async () => {
    jest.mocked(findConsoleAttachmentLink).mockResolvedValue({ id: FILE } as never)
    jest.mocked(discardConsoleAttachment).mockResolvedValue('deleted')
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console?action=discard-upload', 'POST', { fileId: FILE }))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ outcome: 'deleted' })
  })

  it('leaves alone an upload no longer under Brahma/', async () => {
    jest.mocked(findConsoleAttachmentLink).mockResolvedValue(null)
    const res = await collectionPOST(jsonReq('/api/v1/brahma-console?action=discard-upload', 'POST', { fileId: FILE }))
    await expect(res.json()).resolves.toEqual({ outcome: 'missing' })
    expect(discardConsoleAttachment).not.toHaveBeenCalled()
  })
})

describe('PATCH ?action=set-context', () => {
  it('replaces the context of a Writing Assistant conversation', async () => {
    const res = await itemPATCH(jsonReq(`/api/v1/brahma-console/${CHAT}?action=set-context`, 'PATCH', { context: [{ kind: 'store', id: STORE }] }), params(CHAT))
    expect(res.status).toBe(200)
    expect(repos.chats.update).toHaveBeenCalledWith(CHAT, { consoleContext: [{ kind: 'store', id: STORE }] })
  })

  it('is refused on an ordinary Console chat', async () => {
    chats[CHAT].consoleMode = null
    const res = await itemPATCH(jsonReq(`/api/v1/brahma-console/${CHAT}?action=set-context`, 'PATCH', { context: [] }), params(CHAT))
    expect(res.status).toBe(400)
    expect(repos.chats.update).not.toHaveBeenCalled()
  })
})

describe('POST ?action=save-output', () => {
  const save = (body: Record<string, unknown>) =>
    itemPOST(jsonReq(`/api/v1/brahma-console/${CHAT}?action=save-output`, 'POST', { messageId: 'out-1', mountPointId: STORE, folderPath: 'Drafts', filename: 'piece', ...body }), params(CHAT))

  it('writes the stored content (never the client\'s) to a new .md file', async () => {
    jest.mocked(ensureDocument).mockResolvedValue({ created: true, mtime: 1 })
    const res = await save({})
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ path: 'Drafts/piece.md', address: 'qtap://House Style/Drafts/piece.md' })
    expect(writeDocument).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'Drafts/piece.md' }), '# The Piece')
  })

  it('refuses a message that is not an output', async () => {
    const res = await save({ messageId: 'plain-1' })
    expect(res.status).toBe(400)
    expect(writeDocument).not.toHaveBeenCalled()
  })

  it('answers 409 when the file exists, and overwrites on request', async () => {
    jest.mocked(ensureDocument).mockResolvedValue({ created: false })
    expect((await save({})).status).toBe(409)
    expect(writeDocument).not.toHaveBeenCalled()
    expect((await save({ onConflict: 'overwrite' })).status).toBe(200)
    expect(writeDocument).toHaveBeenCalledTimes(1)
  })

  it('refuses a folder path that leaves the store', async () => {
    const res = await save({ folderPath: '../../elsewhere' })
    expect(res.status).toBe(400)
    expect(ensureDocument).not.toHaveBeenCalled()
  })
})

describe('messages route', () => {
  it('refuses a fileId that is not a Console attachment', async () => {
    jest.mocked(findConsoleAttachmentLink).mockResolvedValue(null)
    const res = await messagesPOST(jsonReq(`/api/v1/brahma-console/${CHAT}/messages`, 'POST', { content: 'look', fileIds: [FILE] }), params(CHAT))
    expect(res.status).toBe(400)
    expect(handleBrahmaConsoleMessage).not.toHaveBeenCalled()
  })

  it('takes attachments with no text', async () => {
    jest.mocked(findConsoleAttachmentLink).mockResolvedValue({ id: FILE } as never)
    const res = await messagesPOST(jsonReq(`/api/v1/brahma-console/${CHAT}/messages`, 'POST', { content: '', fileIds: [FILE] }), params(CHAT))
    expect(res.status).toBe(200)
    expect(jest.mocked(handleBrahmaConsoleMessage).mock.calls[0][3]).toEqual({ content: '', fileIds: [FILE] })
  })

  it('still refuses an empty message with no attachments', async () => {
    const res = await messagesPOST(jsonReq(`/api/v1/brahma-console/${CHAT}/messages`, 'POST', { content: '  ' }), params(CHAT))
    expect(res.status).toBe(400)
  })
})

describe('DELETE', () => {
  it('removes the attachments with the conversation and reports them', async () => {
    const res = await itemDELETE(jsonReq(`/api/v1/brahma-console/${CHAT}`, 'DELETE'), params(CHAT))
    expect(res.status).toBe(200)
    expect(deleteConsoleAttachmentsForChat).toHaveBeenCalledWith(repos, CHAT)
    expect(repos.chats.delete).toHaveBeenCalledWith(CHAT)
    await expect(res.json()).resolves.toMatchObject({ attachmentsDeleted: 2, attachmentsKept: 1 })
  })
})
