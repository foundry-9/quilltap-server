/**
 * Unit tests for lib/startup/db-encryption-state.ts
 *
 * Tests the isDatabaseEncrypted(dbPath) function which determines whether
 * a SQLite database file is encrypted by checking its header magic bytes.
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

// The function under test - imported after the mock is registered.
import { isDatabaseEncrypted } from '@/lib/startup/db-encryption-state';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isDatabaseEncrypted()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns false for a non-existent file', () => {
    mockExistsSync.mockReturnValue(false);

    const result = isDatabaseEncrypted('/no/such/file.db');

    expect(result).toBe(false);
    // Should not attempt to open a file that does not exist
    expect(mockOpenSync).not.toHaveBeenCalled();
  });

  it('returns false for a standard (plaintext) SQLite file whose header matches the magic', () => {
    mockFileWithHeader('/data/plaintext.db', SQLITE_MAGIC);

    const result = isDatabaseEncrypted('/data/plaintext.db');

    expect(result).toBe(false);
  });

  it('returns true for an encrypted file whose first 16 bytes do not match the magic', () => {
    // Simulate SQLCipher-encrypted file - first 16 bytes are random ciphertext
    const encryptedHeader = Buffer.from(
      [0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
       0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]
    );
    mockFileWithHeader('/data/encrypted.db', encryptedHeader);

    const result = isDatabaseEncrypted('/data/encrypted.db');

    expect(result).toBe(true);
  });

  it('returns false for a file that is too small (fewer than 16 bytes)', () => {
    // readSync returns only a few bytes
    const shortContent = Buffer.from('tiny', 'ascii'); // 4 bytes
    const FAKE_FD = 7;

    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation((_fd, buf, offset, _length, _position) => {
      shortContent.copy(buf as Buffer, offset, 0, shortContent.length);
      return shortContent.length; // only 4 bytes read
    });
    mockCloseSync.mockImplementation(() => undefined);

    const result = isDatabaseEncrypted('/data/tiny.db');

    expect(result).toBe(false);
  });

  it('returns false when a read error is thrown', () => {
    const FAKE_FD = 99;

    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation(() => {
      throw new Error('EIO: i/o error');
    });
    mockCloseSync.mockImplementation(() => undefined);

    // Should not propagate the error - the function must catch and return false
    expect(() => isDatabaseEncrypted('/data/bad.db')).not.toThrow();
    const result = isDatabaseEncrypted('/data/bad.db');
    expect(result).toBe(false);
  });

  it('closes the file descriptor even when a read error occurs', () => {
    const FAKE_FD = 55;

    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockReturnValue(FAKE_FD);
    mockReadSync.mockImplementation(() => {
      throw new Error('EIO: i/o error');
    });
    mockCloseSync.mockImplementation(() => undefined);

    isDatabaseEncrypted('/data/bad.db');

    expect(mockCloseSync).toHaveBeenCalledWith(FAKE_FD);
  });

  it('returns false when openSync throws (e.g. permission denied)', () => {
    mockExistsSync.mockReturnValue(true);
    mockOpenSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => isDatabaseEncrypted('/data/locked.db')).not.toThrow();
    const result = isDatabaseEncrypted('/data/locked.db');
    expect(result).toBe(false);
  });

  it('returns true for a file whose header starts with SQLite but has wrong bytes', () => {
    // Alter the last byte so it is not the expected NUL
    const almostMagic = Buffer.from('SQLite format 3X', 'ascii'); // 'X' instead of '\0'
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
