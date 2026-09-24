/**
 * Tests for the project DELETE dispatcher
 * (`DELETE /api/v1/projects/[id]` and its `?action=` verbs).
 *
 * The thing worth pinning down here is the fall-through: with no action the
 * handler deletes the whole project, so an *unknown* action — a typo, or one of
 * the `clear-mount-point` verbs the route header used to advertise but never
 * implemented — must be a 400 and must never reach the delete.
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

jest.mock('@/app/api/v1/projects/[id]/actions', () => ({
  handleDeleteProject: jest.fn(),
  handleRemoveCharacter: jest.fn(),
  handleRemoveChat: jest.fn(),
  handleRemoveFile: jest.fn(),
  handleResetState: jest.fn(),
}));

import { NextRequest, NextResponse } from 'next/server';
import { handleDelete } from '@/app/api/v1/projects/[id]/handlers/delete';
import {
  handleDeleteProject,
  handleRemoveCharacter,
  handleResetState,
} from '@/app/api/v1/projects/[id]/actions';

const deleteProject = handleDeleteProject as jest.MockedFunction<typeof handleDeleteProject>;
const removeCharacter = handleRemoveCharacter as jest.MockedFunction<typeof handleRemoveCharacter>;
const resetState = handleResetState as jest.MockedFunction<typeof handleResetState>;

const CTX = { user: { id: 'user-1' }, repos: {} } as never;
const PROJECT_ID = 'project-1';

function request(query = '') {
  return new NextRequest(`http://localhost/api/v1/projects/${PROJECT_ID}${query}`, { method: 'DELETE' });
}

beforeEach(() => {
  jest.clearAllMocks();
  deleteProject.mockResolvedValue(NextResponse.json({ success: true }));
  removeCharacter.mockResolvedValue(NextResponse.json({ removed: true }));
  resetState.mockResolvedValue(NextResponse.json({ reset: true }));
});

describe('DELETE /api/v1/projects/[id]', () => {
  it('deletes the project when no action is given', async () => {
    const res = await handleDelete(request(), CTX, PROJECT_ID);

    expect(deleteProject).toHaveBeenCalledWith(PROJECT_ID, CTX);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  it('routes a known action to its handler and not to the delete', async () => {
    const req = request('?action=remove-character');
    await handleDelete(req, CTX, PROJECT_ID);

    expect(removeCharacter).toHaveBeenCalledWith(req, PROJECT_ID, CTX);
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('refuses an unknown action with 400 instead of deleting the project', async () => {
    const res = await handleDelete(request('?action=clear-mount-point'), CTX, PROJECT_ID);

    expect(res.status).toBe(400);
    expect(deleteProject).not.toHaveBeenCalled();
    expect(removeCharacter).not.toHaveBeenCalled();
    expect(resetState).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBe('Unknown action: clear-mount-point');
    expect(body.availableActions).toEqual(['remove-character', 'remove-chat', 'remove-file', 'reset-state']);
  });

  it('treats a bare ?action= as unknown rather than as a plain delete', async () => {
    const res = await handleDelete(request('?action='), CTX, PROJECT_ID);

    expect(res.status).toBe(400);
    expect(deleteProject).not.toHaveBeenCalled();
  });
});
