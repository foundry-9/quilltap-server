/**
 * Unit tests for lib/startup/db-encryption-state.ts
 *
 * Covers both the legacy boolean isDatabaseEncrypted(dbPath) wrapper and the
 * tri-state getDatabaseEncryptionState(dbPath) primary, including the retry
 * loop for transient EAGAIN/EBUSY/EWOULDBLOCK reads.
 */

// ---------------------------------------------------------------------------
// fs mock - all calls go through jest.fn() so we can control behaviour
// per test via mockImplementation / mockReturnValue.
// ---------------------------------------------------------------------------

const mockExistsSync = jest.fn<boolean, [string]>();
const mockOpenSync = jest.fn<number, [string, string]>();
const mockReadSync = jest.fn<number, [number, Buffer, number, number, number]>();
const mockCloseSync = jest.fn<void, [number]>();

jest.mock('fs', () => ({
  existsSync: (...args: Parameters<typeof mockExistsSync>) => mockExistsSync(...args),
  openSync: (...args: Parameters<typeof mockOpenSync>) => mockOpenSync(...args),
  readSync: (...args: Parameters<typeof mockReadSync>) => mockReadSync(...args),
  closeSync: (...args: Parameters<typeof mockCloseSync>) => mockCloseSync(...args),
}));

// The functions under test - imported after the mock is registered.
import {
  isDatabaseEncrypted,
  getDatabaseEncryptionState,
} from '@/lib/startup/db-encryption-state';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The exact 16-byte SQLite format magic (including the NUL terminator). */
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'ascii');

/**
 * Configure the fs mock so that openSync/readSync/closeSync behave as if
 * `filePath` exists and its first 16 bytes are `headerBytes`.
 */
function mockFileWithHeader(filePath: string, headerBytes: Buffer): void {
  const FAKE_FD = 42;

  mockExistsSync.mockImplementation((p) => p === filePath);
  mockOpenSync.mockReturnValue(FAKE_FD);
  mockReadSync.mockImplementation((_fd, buf, offset, _length, _position) => {
    const bytesToCopy = Math.min(headerBytes.length, _length);
    headerBytes.copy(buf as Buffer, offset, 0, bytesToCopy);
    return bytesToCopy;
  });
  mockCloseSync.mockImplementation(() => undefined);
}

function makeFsError(code: string, message: string): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Tests — boolean wrapper
// ---------------------------------------------------------------------------

describe('isDatabaseEncrypted()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns false for a non-existent file', () => {
    mockExistsSync.mockReturnValue(false);

    const result = isDatabaseEncrypted('/no/such/file.db');

    expect(result).toBe(false);
    expect(mockOpenSync).not.toHaveBeenCalled();
  });

  it('returns false for a standard (plaintext) SQLite file whose header matches the magic', () => {
    mockFileWithHeader('/data/plaintext.db', SQLITE_MAGIC);

    const result = isDatabaseEncrypted('/data/plaintext.db');

    expect(result).toBe(false);
  });

  it('returns true for an encrypted file whose first 16 bytes do not match the magic', () => {
    const encryptedHeader = Buffer.from(
      [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
       0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
    );
    mockFileWithHeader('/data/encrypted.db', encryptedHeader);

    const result = isDatabaseEncrypted('/data/encrypted.db');

    expect(result).toBe(true);
  });

  it('returns false for a file that is too small (fewer than 16 bytes)', () => {
    const shortContent = Buffer.from('tiny', 'ascii');
    const FAKE_FD = 7;

    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation((_fd, buf, offset, _length, _position) => {
      shortContent.copy(buf as Buffer, offset, 0, shortContent.length);
      return shortContent.length;
    });
    mockCloseSync.mockImplementation(() => undefined);

    const result = isDatabaseEncrypted('/data/tiny.db');

    expect(result).toBe(false);
  });

  it('returns false when a non-transient read error is thrown', () => {
    const FAKE_FD = 99;

    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation(() => {
      throw makeFsError('EIO', 'EIO: i/o error');
    });
    mockCloseSync.mockImplementation(() => undefined);

    expect(() => isDatabaseEncrypted('/data/bad.db')).not.toThrow();
    const result = isDatabaseEncrypted('/data/bad.db');
    expect(result).toBe(false);
  });

  it('closes the file descriptor even when a read error occurs', () => {
    const FAKE_FD = 55;

    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation(() => {
      throw makeFsError('EIO', 'EIO: i/o error');
    });
    mockCloseSync.mockImplementation(() => undefined);

    isDatabaseEncrypted('/data/bad.db');

    expect(mockCloseSync).toHaveBeenCalledWith(FAKE_FD);
  });

  it('returns false when openSync throws (e.g. permission denied)', () => {
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockImplementation(() => {
      throw makeFsError('EACCES', 'EACCES: permission denied');
    });

    expect(() => isDatabaseEncrypted('/data/locked.db')).not.toThrow();
    const result = isDatabaseEncrypted('/data/locked.db');
    expect(result).toBe(false);
  });

  it('returns true for a file whose header starts with SQLite but has wrong bytes', () => {
    const almostMagic = Buffer.from('SQLite format 3X', 'ascii');
    mockFileWithHeader('/data/almost.db', almostMagic);

    const result = isDatabaseEncrypted('/data/almost.db');

    expect(result).toBe(true);
  });

  it('calls closeSync with the file descriptor returned by openSync on success', () => {
    const FAKE_FD = 123;
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation((_fd, buf, offset, _length, _position) => {
      SQLITE_MAGIC.copy(buf as Buffer, offset);
      return 16;
    });
    mockCloseSync.mockImplementation(() => undefined);

    isDatabaseEncrypted('/data/clean.db');

    expect(mockCloseSync).toHaveBeenCalledWith(FAKE_FD);
  });
});

// ---------------------------------------------------------------------------
// Tests — tri-state primary
// ---------------------------------------------------------------------------

describe('getDatabaseEncryptionState()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns "plaintext" for a non-existent file (so callers don\'t loop on a missing path)', () => {
    mockExistsSync.mockReturnValue(false);
    expect(getDatabaseEncryptionState('/no/such/file.db')).toBe('plaintext');
  });

  it('returns "plaintext" for an unencrypted SQLite file', () => {
    mockFileWithHeader('/data/plaintext.db', SQLITE_MAGIC);
    expect(getDatabaseEncryptionState('/data/plaintext.db')).toBe('plaintext');
  });

  it('returns "encrypted" for a SQLCipher file', () => {
    const encryptedHeader = Buffer.from(
      [0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6, 0x07, 0x18,
       0x29, 0x3a, 0x4b, 0x5c, 0x6d, 0x7e, 0x8f, 0x90]
    );
    mockFileWithHeader('/data/encrypted.db', encryptedHeader);
    expect(getDatabaseEncryptionState('/data/encrypted.db')).toBe('encrypted');
  });

  it('returns "unknown" when read keeps failing with EAGAIN past the retry limit', () => {
    const FAKE_FD = 11;
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation(() => {
      throw makeFsError('EAGAIN', 'EAGAIN: resource temporarily unavailable');
    });
    mockCloseSync.mockImplementation(() => undefined);

    const state = getDatabaseEncryptionState('/data/flaky.db');

    expect(state).toBe('unknown');
    // 5 attempts is the retry budget — every attempt re-opens the fd, so
    // closeSync should have been invoked at least that many times.
    expect(mockCloseSync.mock.calls.length).toBeGreaterThanOrEqual(5);
  }, 15_000);

  it('recovers and returns the right state when an EAGAIN clears on retry', () => {
    const FAKE_FD = 12;
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);

    let calls = 0;
    mockReadSync.mockImplementation((_fd, buf, offset, _length, _position) => {
      calls++;
      if (calls < 3) {
        throw makeFsError('EBUSY', 'EBUSY: resource busy');
      }
      SQLITE_MAGIC.copy(buf as Buffer, offset);
      return 16;
    });
    mockCloseSync.mockImplementation(() => undefined);

    const state = getDatabaseEncryptionState('/data/recovers.db');

    expect(state).toBe('plaintext');
    expect(calls).toBe(3);
  }, 5_000);

  it('rethrows a non-transient error path through to "unknown"', () => {
    const FAKE_FD = 13;
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation(() => {
      throw makeFsError('EACCES', 'EACCES: permission denied');
    });
    mockCloseSync.mockImplementation(() => undefined);

    // Non-transient errors don't retry — they bubble up to the outer catch
    // and end up as 'unknown' to the caller, which is the safe default.
    expect(getDatabaseEncryptionState('/data/locked.db')).toBe('unknown');
    // Exactly one open attempt — no retry on a non-transient error.
    expect(mockOpenSync).toHaveBeenCalledTimes(1);
  });
});
