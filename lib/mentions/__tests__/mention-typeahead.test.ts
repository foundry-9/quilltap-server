/**
 * Pure-logic tests for the composer's `@` character typeahead.
 *
 * @module lib/mentions/__tests__/mention-typeahead.test
 */

import {
  BRAHMA_MENTION,
  classifyLineStartMention,
  mentionCandidatesFor,
  findMentionTrigger,
  rankMentionCandidates,
} from '../mention-typeahead';

describe('findMentionTrigger', () => {
  it.each([
    ['@', 0, ''],
    ['@ari', 0, 'ari'],
    ['hello @Ari', 6, 'Ari'],
    ['(@zo', 1, 'zo'],
    ['line one\n@Vi', 9, 'Vi'],
    ['@Zoë', 0, 'Zoë'],
  ])('opens on %j', (text, start, query) => {
    expect(findMentionTrigger(text)).toEqual({ start, end: text.length, query, closed: false });
  });

  it.each([
    'name@example.com',
    'hello @ari ',
    'plain text',
    'x@',
  ])('stays shut on %j', (text) => {
    expect(findMentionTrigger(text)).toBeNull();
  });
});

describe('rankMentionCandidates', () => {
  const cast = [
    { id: '1', name: 'Aristarchus' },
    { id: '2', name: 'Lady Arabella' },
    { id: '3', name: 'Barnaby' },
    { id: '4', name: 'Arden' },
    { id: '5', name: '' },
  ];

  it('offers everyone with a name on an empty query, alphabetically', () => {
    expect(rankMentionCandidates(cast, '', new Set(), 10).map((c) => c.name)).toEqual([
      'Arden',
      'Aristarchus',
      'Barnaby',
      'Lady Arabella',
    ]);
  });

  it('ranks name prefix over word prefix, case-insensitively, and skips mid-word hits', () => {
    expect(rankMentionCandidates(cast, 'AR', new Set(), 10).map((c) => c.name)).toEqual([
      'Arden',
      'Aristarchus',
      'Lady Arabella',
    ]);
  });

  it('floats the chat cast to the top', () => {
    expect(rankMentionCandidates(cast, 'ar', new Set(['2']), 10)[0].name).toBe('Lady Arabella');
  });

  it('drops non-matches and honours the limit', () => {
    expect(rankMentionCandidates(cast, 'zz', new Set(), 10)).toEqual([]);
    expect(rankMentionCandidates(cast, '', new Set(), 2)).toHaveLength(2);
  });
});

describe('classifyLineStartMention', () => {
  it.each([
    ['@Aristarchus', 'pending'],
    ['@Aristarchus:', 'pending'],
    ['@Aristarchus?', 'pending'],
    ['@Aristarchus: what is the date?', 'keep'],
    ['@Aristarchus? a whisper', 'keep'],
    ['@Aristarchus ', 'strip'],
    ['@Aristarchus,', 'strip'],
    ['@Aristarchuss', 'strip'],
    ['@Aristarchus:x', 'strip'],
    ['@Aristarch', 'abandon'],
    ['Aristarchus', 'abandon'],
  ])('%j → %s', (line, verdict) => {
    expect(classifyLineStartMention(line, 'Aristarchus')).toBe(verdict);
  });

  it.each(['Jean-Luc', 'Zoë', "O'Neil", 'X'])(
    'strips at once for %j, which the Carina parser cannot address',
    (name) => {
      expect(classifyLineStartMention(`@${name}`, name)).toBe('strip');
      expect(classifyLineStartMention(`@${name}: hello`, name)).toBe('strip');
    },
  );

  it('handles names with interior spaces', () => {
    expect(classifyLineStartMention('@Lady Arabella: hello', 'Lady Arabella')).toBe('keep');
    expect(classifyLineStartMention('@Lady Arabella said', 'Lady Arabella')).toBe('strip');
  });
});

describe('mentionCandidatesFor', () => {
  const cast = [{ id: '1', name: 'Aristarchus' }];

  it('adds Brahma only at the start of a line', () => {
    expect(mentionCandidatesFor(cast, false)).toEqual(cast);
    expect(mentionCandidatesFor(cast, true)).toEqual([...cast, BRAHMA_MENTION]);
  });

  it('does not add a second Brahma when a character already answers to it', () => {
    const withBrahma = [...cast, { id: '2', name: ' brahma ' }];
    expect(mentionCandidatesFor(withBrahma, true)).toEqual(withBrahma);
  });

  it('offers a name the Carina parser can address', () => {
    expect(classifyLineStartMention('@Brahma? hi', BRAHMA_MENTION.name)).toBe('keep');
  });
});
