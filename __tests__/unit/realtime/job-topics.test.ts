/**
 * Unit tests for the job → topic and write-batch → topic mappings.
 */

import { topicsForCompletedJob, topicsForWriteBatch } from '@/lib/realtime/job-topics';

describe('topicsForCompletedJob', () => {
  it('announces both the room list and the chat for an autonomous turn', () => {
    expect(topicsForCompletedJob('AUTONOMOUS_ROOM_TURN', { chatId: 'chat-1' })).toEqual([
      { topic: 'autonomousRooms' },
      { topic: 'chats', id: 'chat-1' },
    ]);
  });

  it('routes a story background to whichever owner the payload names', () => {
    expect(topicsForCompletedJob('STORY_BACKGROUND_GENERATION', { chatId: 'chat-1' })).toEqual([
      { topic: 'chats', id: 'chat-1' },
    ]);
    expect(topicsForCompletedJob('STORY_BACKGROUND_GENERATION', { projectId: 'proj-1' })).toEqual([
      { topic: 'projects', id: 'proj-1' },
    ]);
    expect(topicsForCompletedJob('STORY_BACKGROUND_GENERATION', {})).toEqual([]);
  });

  it('leaves the id off when the payload does not carry one', () => {
    expect(topicsForCompletedJob('TITLE_UPDATE', {})).toEqual([{ topic: 'chats' }]);
  });

  /**
   * Bug 128. Nothing announced a memory landing, so the Salon sidebar's count
   * — and the destructive button it labels — sat at whatever was true when the
   * tab opened. Every chat-scoped memory job carries `chatId` on its payload;
   * housekeeping is character-scoped and prunes across chats, so its hint has
   * to be collection-wide.
   */
  describe('memory jobs', () => {
    it.each([
      'MEMORY_EXTRACTION',
      'INTER_CHARACTER_MEMORY',
      'CARINA_MEMORY_EXTRACTION',
      'MEMORY_REGENERATE_CHAT',
    ])('scopes %s to the chat its payload names', (jobType) => {
      expect(topicsForCompletedJob(jobType, { chatId: 'chat-1' })).toEqual([
        { topic: 'memories', id: 'chat-1' },
      ]);
    });

    it('sweeps the namespace for character-scoped housekeeping', () => {
      expect(topicsForCompletedJob('MEMORY_HOUSEKEEPING', { characterId: 'char-1' })).toEqual([
        { topic: 'memories' },
      ]);
    });
  });

  it('returns nothing for a job type with no entity worth announcing', () => {
    expect(topicsForCompletedJob('LLM_LOG_CLEANUP', {})).toEqual([]);
    expect(topicsForCompletedJob(undefined)).toEqual([]);
  });
});

describe('topicsForWriteBatch', () => {
  /**
   * Bug 128, the other half. `firstIdArg` returns a positional first argument
   * whenever it is a string, so a `memories` row in REPOSITORY_TOPICS would
   * publish `memories.delete(memoryId)`'s *memory* id under a topic every
   * subscriber filters by *chat* id. A hint that reaches nobody looks like
   * coverage, so the namespace stays out of the table on purpose.
   */
  it('never derives a memories hint from a repository write', () => {
    expect(topicsForWriteBatch([{ method: 'memories.delete', args: ['memory-1'] }])).toEqual([]);
  });

  it('derives the topic from the repository namespace', () => {
    expect(topicsForWriteBatch([{ method: 'chats.update', args: ['chat-1', {}] }])).toEqual([
      { topic: 'chats', id: 'chat-1' },
    ]);
  });

  it('reads an id out of an object-shaped payload', () => {
    expect(
      topicsForWriteBatch([{ method: 'docMountFiles.create', args: [{ mountPointId: 'mp-1' }] }]),
    ).toEqual([{ topic: 'mountPoints', id: 'mp-1' }]);
  });

  it('falls back to a collection-wide hint when no id is readable', () => {
    expect(topicsForWriteBatch([{ method: 'characters.updateMany', args: [42] }])).toEqual([
      { topic: 'characters' },
    ]);
  });

  it('deduplicates a batch that touches one row many times', () => {
    const writes = Array.from({ length: 200 }, () => ({
      method: 'chats.update',
      args: ['chat-1', {}],
    }));
    expect(topicsForWriteBatch(writes)).toEqual([{ topic: 'chats', id: 'chat-1' }]);
  });

  it('skips repository namespaces with no client-visible topic', () => {
    expect(topicsForWriteBatch([{ method: 'llmLogs.create', args: [{}] }])).toEqual([]);
  });
});
