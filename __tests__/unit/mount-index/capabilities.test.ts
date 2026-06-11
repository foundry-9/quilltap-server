/**
 * `deriveMountCapabilities` is the single server-side source of truth for which
 * verbs the file-manager UI may offer per mount. These tests pin the derivation
 * across the `enabled × conversionStatus × scanStatus` matrix so the heavy and
 * light costumes can't drift apart, and so a mount mid-conversion (or scanning,
 * for the convert action) correctly refuses the mutating verbs.
 *
 * Pure function — no DB, no logging, no SVAR. The route handler does the logging.
 */

import { deriveMountCapabilities } from '@/lib/mount-index/capabilities';
import type { DocMountPoint } from '@/lib/schemas/mount-index.types';

function makeMount(overrides: Partial<DocMountPoint> = {}): DocMountPoint {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Test mount',
    basePath: '/tmp/mount',
    mountType: 'filesystem',
    storeType: 'documents',
    includePatterns: ['*.md'],
    excludePatterns: ['.git'],
    enabled: true,
    scanStatus: 'idle',
    conversionStatus: 'idle',
    fileCount: 0,
    chunkCount: 0,
    totalSizeBytes: 0,
    createdAt: '2026-06-10T00:00:00.000Z',
    updatedAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('deriveMountCapabilities', () => {
  it('grants everything on an enabled, idle mount', () => {
    expect(deriveMountCapabilities(makeMount())).toEqual({
      canWrite: true,
      canDelete: true,
      canCreateFolder: true,
      canMoveIn: true,
      canMoveOut: true,
      canConvert: true,
    });
  });

  it('denies everything on a disabled mount', () => {
    expect(deriveMountCapabilities(makeMount({ enabled: false }))).toEqual({
      canWrite: false,
      canDelete: false,
      canCreateFolder: false,
      canMoveIn: false,
      canMoveOut: false,
      canConvert: false,
    });
  });

  it.each(['converting', 'deconverting'] as const)(
    'quiesces all verbs while %s',
    (conversionStatus) => {
      const caps = deriveMountCapabilities(makeMount({ conversionStatus }));
      expect(caps).toEqual({
        canWrite: false,
        canDelete: false,
        canCreateFolder: false,
        canMoveIn: false,
        canMoveOut: false,
        canConvert: false,
      });
    }
  );

  it('keeps mutating verbs but refuses convert while scanning', () => {
    const caps = deriveMountCapabilities(makeMount({ scanStatus: 'scanning' }));
    expect(caps.canWrite).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.canCreateFolder).toBe(true);
    expect(caps.canMoveIn).toBe(true);
    expect(caps.canMoveOut).toBe(true);
    // The convert/deconvert action is the only verb gated on scan state.
    expect(caps.canConvert).toBe(false);
  });

  it('treats a scan-error mount as convertible (error ≠ in-progress)', () => {
    // scanStatus 'error' is a resting state, not an in-flight scan, so it does
    // not block conversion — only an active 'scanning' does.
    expect(deriveMountCapabilities(makeMount({ scanStatus: 'error' })).canConvert).toBe(true);
  });

  it('derives identically regardless of mountType (policy is timing, not backend)', () => {
    for (const mountType of ['filesystem', 'obsidian', 'database'] as const) {
      expect(deriveMountCapabilities(makeMount({ mountType })).canConvert).toBe(true);
    }
  });

  it('a conversion-error mount is idle again, so verbs return', () => {
    // conversionStatus 'error' is terminal/resting (not converting/deconverting),
    // so the mount is quiescent and accepts verbs (the user can retry).
    const caps = deriveMountCapabilities(makeMount({ conversionStatus: 'error' }));
    expect(caps.canWrite).toBe(true);
    expect(caps.canConvert).toBe(true);
  });
});
