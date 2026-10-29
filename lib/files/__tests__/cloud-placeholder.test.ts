/**
 * @jest-environment node
 *
 * Cloud placeholder detection: the broad "fault it in" rule and the narrow
 * "leave it alone" rule must not be confused. A store pointed at an
 * iCloud-synced ~/Documents read every evicted file and held the startup
 * gate for five minutes; a compressed file flagged as evicted would vanish
 * from the index instead.
 */

import {
  isEvictedCloudPlaceholder,
  isNotFullyMaterialized,
} from '../cloud-placeholder';

describe('isEvictedCloudPlaceholder', () => {
  it('flags a fully evicted file on macOS', () => {
    expect(isEvictedCloudPlaceholder({ size: 118035, blocks: 0 }, 'darwin')).toBe(true);
  });

  it('flags a fully evicted file on Windows', () => {
    expect(isEvictedCloudPlaceholder({ size: 4013, blocks: 0 }, 'win32')).toBe(true);
  });

  it('leaves a resident file alone', () => {
    expect(isEvictedCloudPlaceholder({ size: 80241, blocks: 160 }, 'darwin')).toBe(false);
  });

  it('leaves a partially downloaded or compressed file alone', () => {
    expect(isEvictedCloudPlaceholder({ size: 100_000, blocks: 8 }, 'darwin')).toBe(false);
  });

  it('never flags an empty file', () => {
    expect(isEvictedCloudPlaceholder({ size: 0, blocks: 0 }, 'darwin')).toBe(false);
  });

  it('never flags anything on Linux, where there are no placeholders', () => {
    expect(isEvictedCloudPlaceholder({ size: 4096, blocks: 0 }, 'linux')).toBe(false);
  });
});

describe('isNotFullyMaterialized', () => {
  it('flags a fully evicted file', () => {
    expect(isNotFullyMaterialized({ size: 4096, blocks: 0 })).toBe(true);
  });

  it('flags a partially downloaded file', () => {
    expect(isNotFullyMaterialized({ size: 100_000, blocks: 8 })).toBe(true);
  });

  it('passes a resident file whose allocation rounds up', () => {
    expect(isNotFullyMaterialized({ size: 1000, blocks: 8 })).toBe(false);
  });

  it('passes an empty file', () => {
    expect(isNotFullyMaterialized({ size: 0, blocks: 0 })).toBe(false);
  });
});
