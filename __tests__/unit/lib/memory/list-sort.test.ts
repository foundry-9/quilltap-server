import { MemoryListSortSchema, MemoryListSortOrderSchema } from '@/lib/memory/list-sort';

describe('memory list sort schemas', () => {
  it.each(['createdAt', 'updatedAt', 'importance'])('accepts %s', (v) => {
    expect(MemoryListSortSchema.safeParse(v).success).toBe(true);
  });

  it.each(['content" DESC, (SELECT 1) --', 'embedding', '', 'id;DROP TABLE memories'])(
    'refuses %j',
    (v) => {
      expect(MemoryListSortSchema.safeParse(v).success).toBe(false);
    }
  );

  it('accepts only asc and desc for the order', () => {
    expect(MemoryListSortOrderSchema.safeParse('asc').success).toBe(true);
    expect(MemoryListSortOrderSchema.safeParse('DESC;').success).toBe(false);
  });
});
