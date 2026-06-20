/**
 * Tests for lib/doc-edit/document-policy.ts
 *
 * The coercion helper is the load-bearing correctness surface of the
 * per-document policy feature: every indexer, migration, and tool gate reads
 * the three flags through it. The motivating reference document writes the
 * values as QUOTED strings (`embed: "false"`), so the string forms matter as
 * much as bare YAML booleans.
 */

// Mock the logger so parseFrontmatter doesn't drag the real logging stack
// (and its native deps) into this pure-function suite.
jest.mock('@/lib/logging/create-logger', () => ({
  createServiceLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import {
  coercePolicyBool,
  policyFromFrontmatterData,
  policyFromContent,
  DEFAULT_DOCUMENT_POLICY,
} from '@/lib/doc-edit/document-policy';

describe('coercePolicyBool', () => {
  const falseCases: Array<[string, unknown]> = [
    ['bare false', false],
    ['quoted "false"', 'false'],
    ['uppercase "FALSE"', 'FALSE'],
    ['mixed-case "False"', 'False'],
    ['"no"', 'no'],
    ['"0" string', '0'],
    ['"off"', 'off'],
    ['"n"', 'n'],
    ['numeric 0', 0],
    ['whitespace-padded " false "', '  false  '],
  ];

  it.each(falseCases)('coerces %s → false', (_label, value) => {
    expect(coercePolicyBool(value)).toBe(false);
  });

  const trueCases: Array<[string, unknown]> = [
    ['bare true', true],
    ['quoted "true"', 'true'],
    ['uppercase "TRUE"', 'TRUE'],
    ['"yes"', 'yes'],
    ['"1" string', '1'],
    ['"on"', 'on'],
    ['"y"', 'y'],
    ['numeric 1', 1],
    ['numeric 2 (non-zero)', 2],
  ];

  it.each(trueCases)('coerces %s → true', (_label, value) => {
    expect(coercePolicyBool(value)).toBe(true);
  });

  describe('fallback (default true) for absent / unrecognized values', () => {
    it('undefined → true', () => expect(coercePolicyBool(undefined)).toBe(true));
    it('null → true', () => expect(coercePolicyBool(null)).toBe(true));
    it('empty string → true', () => expect(coercePolicyBool('')).toBe(true));
    it('whitespace-only string → true', () => expect(coercePolicyBool('   ')).toBe(true));
    it('unrecognized string → true', () => expect(coercePolicyBool('maybe')).toBe(true));
    it('object junk → true', () => expect(coercePolicyBool({})).toBe(true));
    it('array junk → true', () => expect(coercePolicyBool([1, 2])).toBe(true));
  });

  it('honors a false fallback when supplied', () => {
    expect(coercePolicyBool(undefined, false)).toBe(false);
    expect(coercePolicyBool('mystery', false)).toBe(false);
    // Recognized tokens still win over the fallback.
    expect(coercePolicyBool('true', false)).toBe(true);
    expect(coercePolicyBool('false', true)).toBe(false);
  });
});

describe('policyFromFrontmatterData', () => {
  it('null data → all-true default (fresh copy, not the shared constant)', () => {
    const policy = policyFromFrontmatterData(null);
    expect(policy).toEqual(DEFAULT_DOCUMENT_POLICY);
    expect(policy).not.toBe(DEFAULT_DOCUMENT_POLICY);
  });

  it('empty data → all-true', () => {
    expect(policyFromFrontmatterData({})).toEqual({
      embed: true,
      characterRead: true,
      characterWrite: true,
    });
  });

  it('reads all three keys with quoted-string falses', () => {
    expect(
      policyFromFrontmatterData({
        embed: 'false',
        character_read: 'false',
        character_write: 'false',
      })
    ).toEqual({ embed: false, characterRead: false, characterWrite: false });
  });

  it('reads keys independently when character_read is true (missing keys stay true)', () => {
    expect(
      policyFromFrontmatterData({ character_write: false, title: 'Notes' })
    ).toEqual({ embed: true, characterRead: true, characterWrite: false });
  });

  describe('character_read cascade (master gate)', () => {
    it('character_read:false forces embed and character_write false even when absent', () => {
      expect(policyFromFrontmatterData({ character_read: 'false' })).toEqual({
        embed: false,
        characterRead: false,
        characterWrite: false,
      });
    });

    it('character_read:false overrides explicit embed:true / character_write:true', () => {
      expect(
        policyFromFrontmatterData({
          character_read: false,
          embed: true,
          character_write: true,
        })
      ).toEqual({ embed: false, characterRead: false, characterWrite: false });
    });

    it('character_read:true leaves embed:false / character_write:false standing', () => {
      expect(
        policyFromFrontmatterData({
          character_read: true,
          embed: false,
          character_write: false,
        })
      ).toEqual({ embed: false, characterRead: true, characterWrite: false });
    });
  });
});

describe('policyFromContent', () => {
  it('parses the motivating ad-Daiat frontmatter (quoted "false")', () => {
    const content = [
      '---',
      'embed: "false"',
      'character_read: "false"',
      'character_write: "false"',
      '---',
      '',
      '# Recurring Scenarios',
      'Body text.',
    ].join('\n');
    expect(policyFromContent(content)).toEqual({
      embed: false,
      characterRead: false,
      characterWrite: false,
    });
  });

  it('parses bare YAML booleans', () => {
    const content = '---\nembed: false\ncharacter_read: true\n---\nbody';
    expect(policyFromContent(content)).toEqual({
      embed: false,
      characterRead: true,
      characterWrite: true,
    });
  });

  it('no frontmatter → all-true', () => {
    expect(policyFromContent('# Just a heading\nbody')).toEqual({
      embed: true,
      characterRead: true,
      characterWrite: true,
    });
  });

  it('unrelated frontmatter keys → all-true', () => {
    const content = '---\ntitle: Something\ntags: [a, b]\n---\nbody';
    expect(policyFromContent(content)).toEqual({
      embed: true,
      characterRead: true,
      characterWrite: true,
    });
  });

  it('empty string → all-true', () => {
    expect(policyFromContent('')).toEqual({
      embed: true,
      characterRead: true,
      characterWrite: true,
    });
  });
});
