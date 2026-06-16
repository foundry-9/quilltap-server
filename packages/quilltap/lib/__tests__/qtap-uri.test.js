/**
 * Unit tests for the CLI-local qtap:// codec (packages/quilltap/lib/qtap-uri.js).
 * Mirrors the server codec's tests (§3.4 / §2.3) — same grammar, same encoding.
 *
 * @jest-environment node
 */

'use strict';

const {
  isQtapUri,
  parseQtapUri,
  formatQtapUri,
  formatDocStoreUri,
  QtapUriError,
} = require('../qtap-uri');

describe('CLI isQtapUri', () => {
  it('accepts qtap:// (case-insensitive), rejects others', () => {
    expect(isQtapUri('qtap://self/x.md')).toBe(true);
    expect(isQtapUri('QTAP://self/x.md')).toBe(true);
    expect(isQtapUri('https://x')).toBe(false);
    expect(isQtapUri('self/x')).toBe(false);
    expect(isQtapUri(undefined)).toBe(false);
  });
});

describe('CLI parseQtapUri — worked examples', () => {
  it('self vault', () => {
    expect(parseQtapUri('qtap://self/Mail/a.md')).toEqual({
      scope: 'document_store',
      mountPoint: 'self',
      path: 'Mail/a.md',
    });
  });

  it('encoded name with space + colon', () => {
    const p = parseQtapUri('qtap://Project%20Files%3A%20Voyages/Knowledge/x.md');
    expect(p.mountPoint).toBe('Project Files: Voyages');
    expect(p.path).toBe('Knowledge/x.md');
  });

  it('UUID authority', () => {
    expect(parseQtapUri('qtap://550e8400-e29b-41d4-a716-446655440000/n/t.md').mountPoint).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });

  it('project + general scopes', () => {
    expect(parseQtapUri('qtap://project/Outline.md')).toEqual({ scope: 'project', path: 'Outline.md' });
    expect(parseQtapUri('qtap://general/S/intro.md')).toEqual({ scope: 'general', path: 'S/intro.md' });
  });

  it('fragment heading + level', () => {
    expect(parseQtapUri('qtap://self/Backstory.md#Childhood:2')).toEqual({
      scope: 'document_store',
      mountPoint: 'self',
      path: 'Backstory.md',
      heading: 'Childhood',
      level: 2,
    });
  });

  it('store root, with and without trailing slash', () => {
    expect(parseQtapUri('qtap://self/').path).toBe('');
    expect(parseQtapUri('qtap://self').path).toBe('');
  });

  it('reserved words win, case-insensitively', () => {
    expect(parseQtapUri('qtap://SELF/x').mountPoint).toBe('self');
    expect(parseQtapUri('qtap://Project/x').scope).toBe('project');
  });
});

describe('CLI parseQtapUri — errors', () => {
  it('NOT_A_QTAP_URI / EMPTY_AUTHORITY / BAD_LEVEL', () => {
    expect(() => parseQtapUri('https://x')).toThrow(QtapUriError);
    expect(() => parseQtapUri('qtap:///foo')).toThrow(/empty authority/i);
    expect(() => parseQtapUri('qtap://self/x#H:0')).toThrow(/level/i);
    expect(() => parseQtapUri('qtap://self/x#H:x')).toThrow(/level/i);
  });
});

describe('CLI formatQtapUri — canonical', () => {
  it('encodes colon as %3A and spaces as %20', () => {
    expect(
      formatQtapUri({ scope: 'document_store', mountPoint: 'A: B', path: 'c d.md' })
    ).toBe('qtap://A%3A%20B/c%20d.md');
  });

  it('store root has trailing slash', () => {
    expect(formatQtapUri({ scope: 'document_store', mountPoint: 'self', path: '' })).toBe('qtap://self/');
  });

  it('formatDocStoreUri builds a store URI', () => {
    expect(formatDocStoreUri('My Store', 'a/b.md')).toBe('qtap://My%20Store/a/b.md');
    expect(formatDocStoreUri('My Store', '')).toBe('qtap://My%20Store/');
  });
});

describe('CLI round-trip', () => {
  const cases = [
    ['qtap://self/Mail/a.md', 'qtap://self/Mail/a.md'],
    ['qtap://Project%20Files:%20Voyages/k.md', 'qtap://Project%20Files%3A%20Voyages/k.md'],
    ['qtap://project/Outline.md', 'qtap://project/Outline.md'],
    ['qtap://self', 'qtap://self/'],
  ];
  it.each(cases)('%s → %s', (input, expected) => {
    expect(formatQtapUri(parseQtapUri(input))).toBe(expected);
  });
});
