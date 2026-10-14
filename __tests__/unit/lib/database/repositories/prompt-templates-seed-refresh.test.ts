/**
 * Built-in prompt templates must track the shipped text.
 *
 * The seeder used to insert a built-in row only when none existed by name, so
 * revising a prompt in qtap-plugin-default-system-prompts never reached an
 * existing install's template library. Built-ins are read-only to the user
 * (their edits go to copies), so the shipped text is authoritative: a changed
 * prompt refreshes the row, an unchanged one is left alone.
 */

jest.mock('@/lib/database/manager', () => ({
  getDatabaseAsync: jest.fn(),
  ensureCollection: jest.fn(),
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/lib/plugins/system-prompt-registry', () => ({
  systemPromptRegistry: {
    isInitialized: jest.fn(() => true),
    getAll: jest.fn(() => []),
  },
}));

jest.mock('@/lib/prompts/sample-prompts-loader', () => ({
  loadSamplePrompts: jest.fn(async () => []),
}));

import { PromptTemplatesRepository } from '@/lib/database/repositories/prompt-templates.repository';
import type { PromptTemplate } from '@/lib/schemas/types';

const { getDatabaseAsync } = jest.requireMock('@/lib/database/manager') as {
  getDatabaseAsync: jest.Mock;
};
const { systemPromptRegistry } = jest.requireMock('@/lib/plugins/system-prompt-registry') as {
  systemPromptRegistry: { isInitialized: jest.Mock; getAll: jest.Mock };
};

const ROW_ID = '44444444-4444-4444-8444-444444444444';

function makeCollection(rows: PromptTemplate[]) {
  const collection = {
    findOne: jest.fn(async (filter: Partial<PromptTemplate>) =>
      rows.find(r =>
        Object.entries(filter).every(([k, v]) => r[k as keyof PromptTemplate] === v)
      ) ?? null
    ),
    insertOne: jest.fn(async (doc: PromptTemplate) => {
      rows.push(doc);
      return { insertedId: doc.id };
    }),
    updateOne: jest.fn(async (filter: { id: string }, update: { $set: Partial<PromptTemplate> }) => {
      const row = rows.find(r => r.id === filter.id);
      if (!row) return { modifiedCount: 0 };
      Object.assign(row, update.$set);
      return { modifiedCount: 1 };
    }),
  };
  getDatabaseAsync.mockResolvedValue({ getCollection: () => collection });
  return collection;
}

function builtInRow(content: string): PromptTemplate {
  return {
    id: ROW_ID,
    userId: null,
    name: 'MODERN_GENERAL',
    content,
    description: 'GENERAL prompt optimized for MODERN models',
    isBuiltIn: true,
    category: 'GENERAL',
    modelHint: 'MODERN',
    tags: [],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function shipped(content: string) {
  systemPromptRegistry.getAll.mockReturnValue([
    { id: 'default-system-prompts/MODERN_GENERAL', name: 'MODERN_GENERAL', content, modelHint: 'MODERN', category: 'GENERAL' },
  ]);
}

describe('PromptTemplatesRepository built-in seeding', () => {
  it('inserts a built-in prompt that does not exist yet', async () => {
    const rows: PromptTemplate[] = [];
    const collection = makeCollection(rows);
    shipped('new text');

    await new PromptTemplatesRepository().seedSamplePrompts();

    expect(collection.insertOne).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'MODERN_GENERAL', content: 'new text', isBuiltIn: true, userId: null });
  });

  it('refreshes an existing built-in row whose shipped text changed', async () => {
    const rows = [builtInRow('old text')];
    const collection = makeCollection(rows);
    shipped('revised text');

    await new PromptTemplatesRepository().seedSamplePrompts();

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(collection.updateOne).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(ROW_ID);
    expect(rows[0].content).toBe('revised text');
  });

  it('leaves an up-to-date built-in row alone', async () => {
    const rows = [builtInRow('same text')];
    const collection = makeCollection(rows);
    shipped('same text');

    await new PromptTemplatesRepository().seedSamplePrompts();

    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(rows[0].updatedAt).toBe('2026-07-01T00:00:00.000Z');
  });
});
