/**
 * Tests for the group DELETE dispatcher
 * (`DELETE /api/v1/groups/[id]` and its `?action=` verbs).
 *
 * With no action the handler deletes the whole group, so an unknown action —
 * including the `unlinkStore` verb the route header used to advertise but that
 * lives under `/groups/[id]/mount-points` — must be a 400, never a deletion.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return { logger };
});

jest.mock('@/app/api/v1/groups/[id]/actions', () => ({
  handleDeleteGroup: jest.fn(),
  handleRemoveMember: jest.fn(),
  handleResetState: jest.fn(),
}));

import { NextRequest, NextResponse } from 'next/server';
import { handleDelete } from '@/app/api/v1/groups/[id]/handlers/delete';
import { handleDeleteGroup, handleRemoveMember, handleResetState } from '@/app/api/v1/groups/[id]/actions';

const deleteGroup = handleDeleteGroup as jest.MockedFunction<typeof handleDeleteGroup>;
const removeMember = handleRemoveMember as jest.MockedFunction<typeof handleRemoveMember>;
const resetState = handleResetState as jest.MockedFunction<typeof handleResetState>;

const CTX = { user: { id: 'user-1' }, repos: {} } as never;
const GROUP_ID = 'group-1';

function request(query = '') {
  return new NextRequest(`http://localhost/api/v1/groups/${GROUP_ID}${query}`, { method: 'DELETE' });
}

beforeEach(() => {
  jest.clearAllMocks();
  deleteGroup.mockResolvedValue(NextResponse.json({ success: true }));
  removeMember.mockResolvedValue(NextResponse.json({ removed: true }));
  resetState.mockResolvedValue(NextResponse.json({ reset: true }));
});

describe('DELETE /api/v1/groups/[id]', () => {
  it('deletes the group when no action is given', async () => {
    await handleDelete(request(), CTX, GROUP_ID);

    expect(deleteGroup).toHaveBeenCalledWith(GROUP_ID, CTX);
  });

  it('routes removeMember to its handler and not to the delete', async () => {
    const req = request('?action=removeMember');
    await handleDelete(req, CTX, GROUP_ID);

    expect(removeMember).toHaveBeenCalledWith(req, GROUP_ID, CTX);
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it('routes reset-state to its handler', async () => {
    await handleDelete(request('?action=reset-state'), CTX, GROUP_ID);

    expect(resetState).toHaveBeenCalledWith(GROUP_ID, CTX);
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it('refuses an unknown action with 400 instead of deleting the group', async () => {
    const res = await handleDelete(request('?action=unlinkStore'), CTX, GROUP_ID);

    expect(res.status).toBe(400);
    expect(deleteGroup).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBe('Unknown action: unlinkStore');
    expect(body.availableActions).toEqual(['removeMember', 'reset-state']);
  });
});
