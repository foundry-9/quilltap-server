/**
 * Unit tests for the `qtap://` URI codec (lib/doc-edit/qtap-uri.ts).
 *
 * The codec is pure string work — no DB, no resolution — so these tests need no
 * mocks. They cover every worked example in the spec (§2.3) and every edge case
 * called out for explicit testing (§3.4).
 *
 * @jest-environment node
 */

import {
  isQtapUri,
  parseQtapUri,
  formatQtapUri,
  qtapUriToResolverInput,
  formatDocStoreUri,
  formatScopedUri,
  formatSelfUri,
  QtapUriError,
  type QtapUriParts,
} from '../qtap-uri';
import { SELF_VAULT_TOKEN } from '../path-resolver';

describe('codec self-token stays in sync with the resolver', () => {
  it('the resolver SELF_VAULT_TOKEN is "self" (the literal the codec hardcodes)', () => {
    // The codec keeps a local copy so it can stay dependency-free; pin it here.
    expect(SELF_VAULT_TOKEN).toBe('self');
    expect(parseQtapUri('qtap://self/x.md').mountPoint).toBe(SELF_VAULT_TOKEN);
    expect(formatSelfUri('x.md')).toBe(`qtap://${SELF_VAULT_TOKEN}/x.md`);
  });
});

describe('isQtapUri', () => {
  it('accepts qtap:// strings (case-insensitive scheme)', () => {
    expect(isQtapUri('qtap://self/x.md')).toBe(true);
    expect(isQtapUri('QTAP://self/x.md')).toBe(true);
  });

  it('rejects non-qtap strings and non-strings', () => {
    expect(isQtapUri('https://example.com')).toBe(false);
    expect(isQtapUri('/settings')).toBe(false);
    expect(isQtapUri('self/x.md')).toBe(false);
    expect(isQtapUri(undefined)).toBe(false);
    expect(isQtapUri(42)).toBe(false);
  });
});

describe('parseQtapUri — worked examples (§2.3)', () => {
  it('qtap://self/Mail/...', () => {
    const p = parseQtapUri('qtap://self/Mail/1781578632981-from-friday.md');
    expect(p).toEqual({
      scope: 'document_store',
      mountPoint: 'self',
      path: 'Mail/1781578632981-from-friday.md',
    });
  });

  it('encoded store name with spaces and colon (%3A)', () => {
    const p = parseQtapUri(
      'qtap://Project%20Files%3A%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md'
    );
    expect(p).toEqual({
      scope: 'document_store',
      mountPoint: 'Project Files: Voyages of the Covenant',
      path: 'Knowledge/rank_markings.md',
    });
  });

  it('accepts a literal colon in the authority too', () => {
    const p = parseQtapUri(
      'qtap://Project%20Files:%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md'
    );
    expect(p.mountPoint).toBe('Project Files: Voyages of the Covenant');
    expect(p.path).toBe('Knowledge/rank_markings.md');
  });

  it('UUID authority', () => {
    const p = parseQtapUri('qtap://550e8400-e29b-41d4-a716-446655440000/notes/today.md');
    expect(p).toEqual({
      scope: 'document_store',
      mountPoint: '550e8400-e29b-41d4-a716-446655440000',
      path: 'notes/today.md',
    });
  });

  it('project scope', () => {
    const p = parseQtapUri('qtap://project/Outline.md');
    expect(p).toEqual({ scope: 'project', path: 'Outline.md' });
    expect(p.mountPoint).toBeUndefined();
  });

  it('general scope', () => {
    const p = parseQtapUri('qtap://general/Scenarios/intro.md');
    expect(p).toEqual({ scope: 'general', path: 'Scenarios/intro.md' });
    expect(p.mountPoint).toBeUndefined();
  });

  it('fragment with heading and level', () => {
    const p = parseQtapUri('qtap://self/Backstory.md#Childhood:2');
    expect(p).toEqual({
      scope: 'document_store',
      mountPoint: 'self',
      path: 'Backstory.md',
      heading: 'Childhood',
      level: 2,
    });
  });

  it('store root (trailing slash)', () => {
    const p = parseQtapUri('qtap://self/');
    expect(p).toEqual({ scope: 'document_store', mountPoint: 'self', path: '' });
  });

  it('store root (no trailing slash)', () => {
    const p = parseQtapUri('qtap://self');
    expect(p).toEqual({ scope: 'document_store', mountPoint: 'self', path: '' });
  });
});

describe('parseQtapUri — reserved-word precedence (§0.3, §3.4)', () => {
  it('reserved words are case-insensitive (SELF → self)', () => {
    expect(parseQtapUri('qtap://SELF/x.md').mountPoint).toBe('self');
    expect(parseQtapUri('qtap://Project/x.md').scope).toBe('project');
    expect(parseQtapUri('qtap://GENERAL/x.md').scope).toBe('general');
  });

  it('a store literally named "self" is reachable only by UUID', () => {
    // The authority "self" always wins as the reserved token...
    expect(parseQtapUri('qtap://self/x.md').mountPoint).toBe('self');
    // ...so the literal store must be reached by its UUID.
    const byId = parseQtapUri('qtap://11111111-2222-3333-4444-555555555555/x.md');
    expect(byId.scope).toBe('document_store');
    expect(byId.mountPoint).toBe('11111111-2222-3333-4444-555555555555');
  });
});

describe('parseQtapUri — errors', () => {
  it('throws NOT_A_QTAP_URI on non-qtap strings', () => {
    expect(() => parseQtapUri('https://example.com')).toThrow(QtapUriError);
    try {
      parseQtapUri('https://example.com');
    } catch (e) {
      expect((e as QtapUriError).code).toBe('NOT_A_QTAP_URI');
    }
  });

  it('throws EMPTY_AUTHORITY on qtap:///foo', () => {
    try {
      parseQtapUri('qtap:///foo');
      throw new Error('expected throw');
    } catch (e) {
      expect((e as QtapUriError).code).toBe('EMPTY_AUTHORITY');
    }
  });

  it.each(['#X:0', '#X:7', '#X:x'])('throws BAD_LEVEL on fragment %s', (frag) => {
    try {
      parseQtapUri(`qtap://self/Backstory.md${frag}`);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as QtapUriError).code).toBe('BAD_LEVEL');
    }
  });
});

describe('parseQtapUri — fragments and queries', () => {
  it('decodes an encoded heading with a level', () => {
    const p = parseQtapUri('qtap://self/Backstory.md#Heading%20Text:3');
    expect(p.heading).toBe('Heading Text');
    expect(p.level).toBe(3);
  });

  it('heading without a level', () => {
    const p = parseQtapUri('qtap://self/Backstory.md#Childhood');
    expect(p.heading).toBe('Childhood');
    expect(p.level).toBeUndefined();
  });

  it('a heading containing an encoded colon is not split on it', () => {
    const p = parseQtapUri('qtap://self/Backstory.md#Chapter%3A%20One');
    expect(p.heading).toBe('Chapter: One');
    expect(p.level).toBeUndefined();
  });

  it('parses a query string (reserved for future use)', () => {
    const p = parseQtapUri('qtap://self/x.md?foo=bar&baz=qux%20quux');
    expect(p.query).toEqual({ foo: 'bar', baz: 'qux quux' });
  });
});

describe('parseQtapUri — encoded-slash segment (§3.4)', () => {
  it('decodes %2F to a literal slash inside one segment and does not re-split', () => {
    const p = parseQtapUri('qtap://self/a%2Fb/c.md');
    // The first segment decodes to "a/b" (one logical segment); the path string
    // joins it back with the literal separator.
    expect(p.path).toBe('a/b/c.md');
  });
});

describe('formatQtapUri — canonical emission', () => {
  it('always encodes colon as %3A', () => {
    const uri = formatQtapUri({
      scope: 'document_store',
      mountPoint: 'Project Files: Voyages of the Covenant',
      path: 'Knowledge/rank_markings.md',
    });
    expect(uri).toBe(
      'qtap://Project%20Files%3A%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md'
    );
  });

  it('emits self/project/general authorities', () => {
    expect(formatQtapUri({ scope: 'document_store', mountPoint: 'self', path: 'x.md' })).toBe(
      'qtap://self/x.md'
    );
    expect(formatQtapUri({ scope: 'project', path: 'Outline.md' })).toBe('qtap://project/Outline.md');
    expect(formatQtapUri({ scope: 'general', path: 'a/b.md' })).toBe('qtap://general/a/b.md');
  });

  it('emits store root with a trailing slash', () => {
    expect(formatQtapUri({ scope: 'document_store', mountPoint: 'self', path: '' })).toBe(
      'qtap://self/'
    );
  });

  it('emits a fragment with heading and level', () => {
    expect(
      formatQtapUri({
        scope: 'document_store',
        mountPoint: 'self',
        path: 'Backstory.md',
        heading: 'Heading Text',
        level: 3,
      })
    ).toBe('qtap://self/Backstory.md#Heading%20Text:3');
  });
});

describe('round-trip: formatQtapUri(parseQtapUri(x)) === canonical(x) (§3.4)', () => {
  const canonical: Array<[string, string]> = [
    ['qtap://self/Mail/1781578632981-from-friday.md', 'qtap://self/Mail/1781578632981-from-friday.md'],
    [
      'qtap://Project%20Files%3A%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md',
      'qtap://Project%20Files%3A%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md',
    ],
    // Literal colon on input normalizes to %3A on output.
    [
      'qtap://Project%20Files:%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md',
      'qtap://Project%20Files%3A%20Voyages%20of%20the%20Covenant/Knowledge/rank_markings.md',
    ],
    [
      'qtap://550e8400-e29b-41d4-a716-446655440000/notes/today.md',
      'qtap://550e8400-e29b-41d4-a716-446655440000/notes/today.md',
    ],
    ['qtap://project/Outline.md', 'qtap://project/Outline.md'],
    ['qtap://general/Scenarios/intro.md', 'qtap://general/Scenarios/intro.md'],
    ['qtap://self/Backstory.md#Childhood:2', 'qtap://self/Backstory.md#Childhood:2'],
    // Missing trailing slash normalizes to present.
    ['qtap://self', 'qtap://self/'],
    ['qtap://self/', 'qtap://self/'],
  ];

  it.each(canonical)('%s → %s', (input, expected) => {
    expect(formatQtapUri(parseQtapUri(input))).toBe(expected);
  });

  it('survives spaces, colons, #, ?, and non-ASCII (Café)', () => {
    const parts: QtapUriParts = {
      scope: 'document_store',
      mountPoint: 'Café: Notes & More',
      path: 'Chapter #1/draft?.md',
    };
    const round = parseQtapUri(formatQtapUri(parts));
    expect(round.mountPoint).toBe('Café: Notes & More');
    expect(round.path).toBe('Chapter #1/draft?.md');
  });
});

describe('qtapUriToResolverInput', () => {
  it('builds the resolver triple, omitting mount_point for project/general', () => {
    expect(qtapUriToResolverInput(parseQtapUri('qtap://self/x.md'))).toEqual({
      scope: 'document_store',
      mount_point: 'self',
      path: 'x.md',
    });
    expect(qtapUriToResolverInput(parseQtapUri('qtap://project/x.md'))).toEqual({
      scope: 'project',
      path: 'x.md',
    });
    expect(qtapUriToResolverInput(parseQtapUri('qtap://general/x.md'))).toEqual({
      scope: 'general',
      path: 'x.md',
    });
  });
});

describe('producer helpers (§3.2)', () => {
  it('formatDocStoreUri prefers the name', () => {
    expect(
      formatDocStoreUri({ mountPointName: 'My Store', mountPointId: 'uuid-1', path: 'a.md' })
    ).toBe('qtap://My%20Store/a.md');
  });

  it('formatDocStoreUri falls back to the UUID when the name is ambiguous', () => {
    expect(
      formatDocStoreUri({
        mountPointName: 'My Store',
        mountPointId: 'uuid-1',
        path: 'a.md',
        nameIsAmbiguous: true,
      })
    ).toBe('qtap://uuid-1/a.md');
  });

  it('formatDocStoreUri uses the UUID when the name collides with a reserved word', () => {
    for (const name of ['self', 'Project', 'GENERAL']) {
      expect(
        formatDocStoreUri({ mountPointName: name, mountPointId: 'uuid-collide', path: 'a.md' })
      ).toBe('qtap://uuid-collide/a.md');
    }
  });

  it('formatScopedUri builds project/general URIs', () => {
    expect(formatScopedUri('project', 'Outline.md')).toBe('qtap://project/Outline.md');
    expect(formatScopedUri('general', 'a/b.md')).toBe('qtap://general/a/b.md');
  });

  it('formatSelfUri builds qtap://self/<path>', () => {
    expect(formatSelfUri('Mail/x.md')).toBe('qtap://self/Mail/x.md');
    expect(formatSelfUri('Backstory.md', { heading: 'Childhood', level: 2 })).toBe(
      'qtap://self/Backstory.md#Childhood:2'
    );
  });
});
