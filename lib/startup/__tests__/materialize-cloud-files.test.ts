/**
 * @jest-environment node
 */
import { EventEmitter } from 'events';
import { materializeDataDirFiles } from '../materialize-cloud-files';
import fs from 'fs';
import { getPlatform, getDataDir } from '@/lib/paths';

jest.mock('fs');
jest.mock('@/lib/paths');
jest.mock('../../../migrations/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockedFs = jest.mocked(fs);
const mockedGetPlatform = jest.mocked(getPlatform);
const mockedGetDataDir = jest.mocked(getDataDir);

/** A Dirent-like top-level file entry. */
function fileEntry(name: string): fs.Dirent {
  return { name, isFile: () => true } as unknown as fs.Dirent;
}

/** A Stats-like result with just the fields the detector reads. */
function stat(size: number, blocks: number): fs.Stats {
  return { size, blocks } as unknown as fs.Stats;
}

/** A createReadStream stub that emits one data chunk then `end` next tick. */
function streamThatCompletes(): EventEmitter & { destroy: jest.Mock } {
  const ee = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
  ee.destroy = jest.fn();
  setImmediate(() => {
    ee.emit('data', Buffer.alloc(8));
    ee.emit('end');
  });
  return ee;
}

/** A createReadStream stub that never emits — used to exercise the stall guard. */
function streamThatStalls(): EventEmitter & { destroy: jest.Mock } {
  const ee = new EventEmitter() as EventEmitter & { destroy: jest.Mock };
  // The module destroys the stream on stall; a real stream emits 'error' in
  // response, which is how the read promise rejects. Mirror that here.
  ee.destroy = jest.fn((err?: Error) => ee.emit('error', err ?? new Error('destroyed')));
  return ee;
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.QUILLTAP_SKIP_CLOUD_MATERIALIZE;
  mockedGetPlatform.mockReturnValue('darwin');
  mockedGetDataDir.mockReturnValue('/fake/data');
});

describe('materializeDataDirFiles', () => {
  it('detects a fully-dataless file (size > 0, blocks === 0) and streams it in', async () => {
    mockedFs.readdirSync.mockReturnValue([fileEntry('quilltap.db')] as never);
    mockedFs.statSync.mockReturnValue(stat(200_000_000, 0));
    mockedFs.createReadStream.mockReturnValue(streamThatCompletes() as never);

    const summary = await materializeDataDirFiles();

    expect(mockedFs.createReadStream).toHaveBeenCalledWith('/fake/data/quilltap.db', expect.anything());
    expect(summary).toMatchObject({ checked: 1, downloaded: 1, failed: 0 });
  });

  it('detects a PARTIALLY-materialized file (blocks > 0 but blocks*512 < size) and streams it in', async () => {
    // 200 MB file with only ~51 MB of blocks faulted in — the header is local
    // (so blocks !== 0) but the tail is still in the cloud. This is the case
    // that slipped through the old blocks===0 check and wedged a cold boot.
    mockedFs.readdirSync.mockReturnValue([fileEntry('quilltap.db')] as never);
    mockedFs.statSync.mockReturnValue(stat(200_000_000, 100_000));
    mockedFs.createReadStream.mockReturnValue(streamThatCompletes() as never);

    const summary = await materializeDataDirFiles();

    expect(mockedFs.createReadStream).toHaveBeenCalledWith('/fake/data/quilltap.db', expect.anything());
    expect(summary).toMatchObject({ checked: 1, downloaded: 1, failed: 0 });
  });

  it('leaves a fully-resident file (blocks*512 >= size) untouched', async () => {
    // Allocation rounds up, so a resident file has at least size/512 blocks.
    mockedFs.readdirSync.mockReturnValue([fileEntry('quilltap.db')] as never);
    mockedFs.statSync.mockReturnValue(stat(200_000_000, 394_096));

    const summary = await materializeDataDirFiles();

    expect(mockedFs.createReadStream).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ checked: 0, downloaded: 0, failed: 0 });
  });

  it('never flags a zero-byte file', async () => {
    mockedFs.readdirSync.mockReturnValue([fileEntry('quilltap.db-journal')] as never);
    mockedFs.statSync.mockReturnValue(stat(0, 0));

    const summary = await materializeDataDirFiles();

    expect(mockedFs.createReadStream).not.toHaveBeenCalled();
    expect(summary.checked).toBe(0);
  });

  it('skips directories and symlinks (only top-level files are considered)', async () => {
    const dir = { name: 'backups', isFile: () => false } as unknown as fs.Dirent;
    mockedFs.readdirSync.mockReturnValue([dir] as never);

    const summary = await materializeDataDirFiles();

    expect(mockedFs.statSync).not.toHaveBeenCalled();
    expect(summary.checked).toBe(0);
  });

  it('counts a stalled download as failed rather than throwing', async () => {
    mockedFs.readdirSync.mockReturnValue([fileEntry('quilltap.db')] as never);
    mockedFs.statSync.mockReturnValue(stat(200_000_000, 0));
    mockedFs.createReadStream.mockReturnValue(streamThatStalls() as never);

    // Tiny stall window so the timer fires immediately.
    const summary = await materializeDataDirFiles({ stallMs: 1 });

    expect(summary).toMatchObject({ checked: 1, downloaded: 0, failed: 1 });
    expect(summary.failedNames).toContain('quilltap.db');
  });

  it('is a no-op when QUILLTAP_SKIP_CLOUD_MATERIALIZE=1', async () => {
    process.env.QUILLTAP_SKIP_CLOUD_MATERIALIZE = '1';

    const summary = await materializeDataDirFiles();

    expect(mockedFs.readdirSync).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ checked: 0, downloaded: 0, failed: 0 });
  });

  it('is a no-op on non-macOS platforms (detection seam not yet implemented)', async () => {
    mockedGetPlatform.mockReturnValue('linux');

    const summary = await materializeDataDirFiles();

    expect(mockedFs.readdirSync).not.toHaveBeenCalled();
    expect(summary.checked).toBe(0);
  });
});
