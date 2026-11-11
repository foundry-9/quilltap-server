import { describe, expect, it } from '@jest/globals';
import { translateFilter } from './query-translator';

describe('SQLite query translator null comparisons', () => {
  it('translates $eq null to IS NULL without a bound NULL parameter', () => {
    expect(translateFilter({ messageId: { $eq: null } })).toEqual({
      sql: '"messageId" IS NULL',
      params: [],
    });
  });

  it('translates $ne null to IS NOT NULL without a bound NULL parameter', () => {
    expect(translateFilter({ messageId: { $ne: null } })).toEqual({
      sql: '"messageId" IS NOT NULL',
      params: [],
    });
  });
});
