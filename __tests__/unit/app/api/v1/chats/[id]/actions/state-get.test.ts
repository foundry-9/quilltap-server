/**
 * Tests for chat get-state's resilience to project-store degradation.
 *
 * Project state is a secondary enrichment merged into chat state. After the
 * project-store cutover, `repos.projects.findById` can throw
 * `ProjectStoreUnavailableError` when a project's store is unavailable — that
 * must NOT take down the chat's own state read.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handleGetState } from '@/app/api/v1/chats/[id]/actions/state';
import { ProjectStoreUnavailableError } from '@/lib/projects/project-store/schema';

function makeCtx(opts: {
  chat: Record<string, unknown> | null;
  projectFindById: () => Promise<unknown>;
}) {
  return {
    user: { id: 'user-1' },
    repos: {
      chats: { findById: jest.fn(async () => opts.chat) },
      projects: { findById: jest.fn(opts.projectFindById) },
    },
  } as never;
}

describe('handleGetState — project-store resilience', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns chat state even when the project store is unavailable', async () => {
    const ctx = makeCtx({
      chat: { id: 'chat-1', projectId: 'proj-1', state: { hp: 10 } },
      projectFindById: async () => {
        throw new ProjectStoreUnavailableError('proj-1', null, 'properties.json missing');
      },
    });

    const res = await handleGetState('chat-1', ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.chatState).toEqual({ hp: 10 });
    expect(body.state).toEqual({ hp: 10 }); // no project state merged in
    expect(body.projectState).toBeUndefined();
  });

  it('merges project state when the store is healthy', async () => {
    const ctx = makeCtx({
      chat: { id: 'chat-1', projectId: 'proj-1', state: { hp: 10 } },
      projectFindById: async () => ({ id: 'proj-1', state: { gold: 5, hp: 1 } }),
    });

    const res = await handleGetState('chat-1', ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toEqual({ gold: 5, hp: 10 }); // chat overrides project
    expect(body.projectState).toEqual({ gold: 5, hp: 1 });
  });

  it('returns 404 when the chat itself is missing', async () => {
    const ctx = makeCtx({ chat: null, projectFindById: async () => null });
    const res = await handleGetState('chat-1', ctx);
    expect(res.status).toBe(404);
  });
});
