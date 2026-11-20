/**
 * @jest-environment node
 *
 * verifyCalliopeChat: the one ownership / type gate for Calliope routes.
 */

import { NextResponse } from 'next/server';
import { verifyCalliopeChat } from '@/app/api/v1/calliope/_shared';

function ctx(chat: unknown) {
  return { user: { id: 'u1' }, repos: { chats: { findById: jest.fn(async () => chat) } } } as any;
}

describe('verifyCalliopeChat', () => {
  it('returns the chat for the owner of a Calliope conversation about a draft', async () => {
    const chat = { id: 'c1', userId: 'u1', chatType: 'calliope', themeDraftId: 'd1' };
    const result = await verifyCalliopeChat('c1', ctx(chat));
    expect(result).toEqual({ chat });
  });

  it.each([
    ['missing chat', null],
    ['another user', { id: 'c1', userId: 'u2', chatType: 'calliope', themeDraftId: 'd1' }],
    ['another chat type', { id: 'c1', userId: 'u1', chatType: 'brahma', themeDraftId: 'd1' }],
    ['no theme draft', { id: 'c1', userId: 'u1', chatType: 'calliope', themeDraftId: null }],
  ])('404s for %s', async (_name, chat) => {
    const result = await verifyCalliopeChat('c1', ctx(chat));
    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(404);
  });
});
