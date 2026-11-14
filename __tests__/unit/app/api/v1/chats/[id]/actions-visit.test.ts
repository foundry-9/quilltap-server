/**
 * The chat's opening housekeeping is `POST ?action=visit`; the default GET
 * no longer writes.
 */

const mockReembed = jest.fn(async () => undefined)
const mockReconcile = jest.fn(async () => undefined)
const mockSurfaceMail = jest.fn(async () => undefined)

jest.mock('@/lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/scriptorium/cold-chunk-reembed', () => ({ maybeEnqueueColdChunkReembed: (...a: unknown[]) => mockReembed(...(a as [])) }))
jest.mock('@/lib/terminal/reconcile', () => ({ reconcileTerminalSessionsForChat: (...a: unknown[]) => mockReconcile(...(a as [])) }))
jest.mock('@/lib/post-office/surface-operator-mail', () => ({ surfaceOperatorMailForChat: (...a: unknown[]) => mockSurfaceMail(...(a as [])) }))

import { handleVisit } from '@/app/api/v1/chats/[id]/actions/visit'

describe('POST /api/v1/chats/[id]?action=visit', () => {
  it('re-warms chunks, reconciles terminals and surfaces operator mail', async () => {
    const participants = [{ id: 'p1' }]
    const res: any = await handleVisit('chat-1', { participants } as any, { user: { id: 'u1' } } as any)
    expect(res.status).toBe(200)
    expect(mockReembed).toHaveBeenCalledWith('u1', 'chat-1')
    expect(mockReconcile).toHaveBeenCalledWith('chat-1')
    expect(mockSurfaceMail).toHaveBeenCalledWith('chat-1', participants)
  })

  it('a failed re-warm does not fail the visit', async () => {
    mockReembed.mockRejectedValueOnce(new Error('down') as never)
    const res: any = await handleVisit('chat-1', { participants: [] } as any, { user: { id: 'u1' } } as any)
    expect(res.status).toBe(200)
  })
})
