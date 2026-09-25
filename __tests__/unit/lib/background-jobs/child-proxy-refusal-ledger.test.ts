/**
 * The refusal ledger in the forked job child.
 *
 * A child cannot read back its own buffered write, and two jobs for the same
 * chat can race, so the child must only *buffer* the increment and never run
 * the auto-switch check. The parent's commit hook (`chatsWithRecordedRefusals`
 * → `maybeAutoSwitchAfterRefusal`, covered in job-dispatcher-apply.test.ts)
 * then finds the chat in the committed batch. This test drives the child half
 * through the real proxy and hands its batch to the parent's pure selector.
 */

jest.mock('@/lib/database/repositories', () => ({
  getRepositories: jest.fn(),
}));

jest.mock('@/lib/logger', () => {
  const mock = {
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
    child: jest.fn(),
  };
  mock.child.mockReturnValue(mock);
  return { logger: mock };
});

jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(),
  }),
}));

jest.mock('@/lib/services/concierge-notifications/writer', () => ({
  postConciergeManualAnnouncement: jest.fn(async () => null),
}));

// In the child runtime `@/lib/repositories/factory` returns the child proxy.
jest.mock('@/lib/repositories/factory', () => ({
  getRepositories: () =>
    require('@/lib/background-jobs/child/child-repositories-proxy').getChildRepositoriesProxy(),
}));

jest.mock('@/lib/background-jobs/host/processor-host', () => ({
  sendToChild: jest.fn(() => true),
  notifyChild: jest.fn(),
}));

import { getRepositories as mockedRealRepositories } from '@/lib/database/repositories';
import {
  runWithJobScope,
  flushPendingWrites,
  __resetProxyCacheForTesting,
} from '@/lib/background-jobs/child/child-repositories-proxy';
import { classifyWriteTarget } from '@/lib/background-jobs/host/write-partition';
import { chatsWithDangerVerdicts, chatsWithRecordedRefusals } from '@/lib/background-jobs/host/job-dispatcher';
import { recordModerationRefusal } from '@/lib/services/dangerous-content/refusal-ledger';

const mockedRepoSource = mockedRealRepositories as jest.MockedFunction<typeof mockedRealRepositories>;

beforeEach(() => {
  jest.clearAllMocks();
  __resetProxyCacheForTesting();
  process.env.QUILLTAP_JOB_CHILD = '1';
});

afterAll(() => {
  delete process.env.QUILLTAP_JOB_CHILD;
});

describe('child proxy — the refusal ledger', () => {
  it('buffers the increment, decides nothing, and leaves the chat for the parent hook', async () => {
    const repos = {
      chats: {
        incrementModerationRefusalCount: jest.fn().mockResolvedValue(99),
        findById: jest.fn(),
        update: jest.fn(),
      },
      chatSettings: { findByUserId: jest.fn() },
    };
    mockedRepoSource.mockReturnValue(repos as never);

    const writes = await runWithJobScope('job-ledger', async () => {
      const result = await recordModerationRefusal({
        chatId: 'chat-7',
        kind: 'image',
        purpose: 'lantern',
        refusedProfileId: 'p-1',
        refusedProfileName: 'House Painter',
        provider: 'GOOGLE',
        modelName: 'gemini-2.5-flash-image',
        evidence: 'typed-error',
        rerouted: true,
      });
      expect(result).toEqual({ count: null, switched: false });
      return flushPendingWrites();
    });

    // Buffered, never run on the readonly child connection; no switch check read anything.
    expect(repos.chats.incrementModerationRefusalCount).not.toHaveBeenCalled();
    expect(repos.chats.findById).not.toHaveBeenCalled();
    expect(repos.chats.update).not.toHaveBeenCalled();
    expect(repos.chatSettings.findByUserId).not.toHaveBeenCalled();

    expect(writes).toHaveLength(1);
    expect(writes[0].method).toBe('chats.incrementModerationRefusalCount');
    expect(classifyWriteTarget(writes[0].method)).toBe('main');

    // The parent's commit hook finds exactly this chat, and who refused.
    expect([...chatsWithRecordedRefusals(writes)]).toEqual([
      ['chat-7', { provider: 'GOOGLE', modelName: 'gemini-2.5-flash-image' }],
    ]);
  });

  it("buffers the classifier's verdict as telemetry and leaves the switch to the parent hook", async () => {
    const repos = { chats: { setDangerClassification: jest.fn(), findById: jest.fn(), setConciergeMode: jest.fn() } };
    mockedRepoSource.mockReturnValue(repos as never);
    const verdict = { score: 0.9, threshold: 0.7, categories: [{ category: 'sexual', score: 0.9 }], providerName: 'OPENAI' };
    const telemetry = (dangerous: boolean) => ({
      isDangerousChat: dangerous, dangerScore: dangerous ? 0.9 : 0.1, dangerCategories: [],
      dangerClassifiedAt: 't', dangerClassifiedAtMessageCount: 3,
    });

    const writes = await runWithJobScope('job-classify', async () => {
      const chats = (require('@/lib/repositories/factory').getRepositories() as {
        chats: { setDangerClassification: (...args: unknown[]) => unknown };
      }).chats;
      await chats.setDangerClassification('chat-8', telemetry(true), verdict);
      await chats.setDangerClassification('chat-9', telemetry(false), null);
      return flushPendingWrites();
    });

    expect(repos.chats.setDangerClassification).not.toHaveBeenCalled();
    expect(repos.chats.setConciergeMode).not.toHaveBeenCalled();
    expect(writes.map((w) => w.method)).toEqual(['chats.setDangerClassification', 'chats.setDangerClassification']);
    // Only the dangerous verdict reaches the parent's switch, carrying its details.
    expect([...chatsWithDangerVerdicts(writes)]).toEqual([['chat-8', verdict]]);
  });
});
