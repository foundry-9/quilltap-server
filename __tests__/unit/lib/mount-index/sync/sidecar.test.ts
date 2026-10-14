/**
 * `<file>.description.md` — naming, partner resolution, and the round trip
 * that keeps an editor's trailing newline from looking like an edit.
 *
 * Guards:
 *   - lib/mount-index/sync/sidecar.ts
 */

import { describe, it, expect } from '@jest/globals';
import {
  descriptionSha256,
  descriptionsEqual,
  isSidecarPath,
  parseSidecar,
  partnerPathFor,
  renderSidecar,
  sidecarPathFor,
} from '@/lib/mount-index/sync/sidecar';

describe('naming', () => {
  it('appends the suffix to the whole file name, extension and all', () => {
    expect(sidecarPathFor('lore/harbour.png')).toBe('lore/harbour.png.description.md');
  });

  it('keeps two images of the same stem apart', () => {
    expect(sidecarPathFor('harbour.png')).not.toBe(sidecarPathFor('harbour.webp'));
  });

  it('recognises a sidecar whatever its casing', () => {
    expect(isSidecarPath('a.png.description.md')).toBe(true);
    expect(isSidecarPath('a.png.DESCRIPTION.md')).toBe(true);
    expect(isSidecarPath('a.png')).toBe(false);
    // A file plainly called `description.md` is a document, not a sidecar —
    // the suffix includes the dot that separates it from a partner's name.
    expect(isSidecarPath('description.md')).toBe(false);
  });

  it('round-trips a path through its sidecar', () => {
    expect(partnerPathFor(sidecarPathFor('lore/harbour.png'))).toBe('lore/harbour.png');
  });

  it('has no partner for a bare `.description.md`', () => {
    expect(partnerPathFor('.description.md')).toBeNull();
  });

  it('has no partner for something that is not a sidecar', () => {
    expect(partnerPathFor('notes.md')).toBeNull();
  });
});

describe('body round trip', () => {
  it('writes the description verbatim with one trailing newline', () => {
    expect(renderSidecar('A map of the harbour.')).toBe('A map of the harbour.\n');
  });

  it('writes nothing at all for an empty description', () => {
    expect(renderSidecar('')).toBe('');
    expect(renderSidecar('   \n')).toBe('');
  });

  it('survives a trip through an editor that added whitespace', () => {
    const original = 'A map of the harbour.';
    expect(parseSidecar(`${renderSidecar(original)}\n\n`)).toBe(original);
  });

  it('keeps interior newlines, which are the author’s', () => {
    const multi = 'A map of the harbour.\n\nDrawn in 1923.';
    expect(parseSidecar(renderSidecar(multi))).toBe(multi);
  });
});

describe('comparison', () => {
  it('hashes the parsed text, so whitespace is not an edit', () => {
    expect(descriptionSha256('caption')).toBe(descriptionSha256('caption\n\n'));
  });

  it('distinguishes genuinely different captions', () => {
    expect(descriptionSha256('one')).not.toBe(descriptionSha256('two'));
  });

  it('treats absent and empty as the same thing', () => {
    expect(descriptionsEqual(undefined, '')).toBe(true);
    expect(descriptionsEqual('  ', undefined)).toBe(true);
  });

  it('reports a real difference', () => {
    expect(descriptionsEqual('one', 'two')).toBe(false);
  });
});
