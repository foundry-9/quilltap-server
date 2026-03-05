/**
 * Binary Executable Detector
 *
 * Detects binary executable files by checking for known magic bytes
 * (ELF, PE/MZ, Mach-O 32-bit, Mach-O 64-bit, Mach-O fat/universal).
 * Used to prevent executable binaries from crossing the workspace boundary.
 *
 * @module tools/shell/binary-detector
 */

import fs from 'fs';
import { logger } from '@/lib/logger';

const moduleLogger = logger.child({ module: 'binary-detector' });

// Magic byte sequences for executable formats
const MAGIC_BYTES = {
  /** ELF executable (Linux) */
  ELF: Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  /** PE/MZ executable (Windows .exe, .dll) */
  PE: Buffer.from([0x4d, 0x5a]),
  /** Mach-O 32-bit (macOS) */
  MACHO_32: Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  /** Mach-O 64-bit (macOS) */
  MACHO_64: Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  /** Mach-O fat/universal binary (macOS) */
  MACHO_FAT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  /** Mach-O 32-bit reverse byte order */
  MACHO_32_REV: Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  /** Mach-O 64-bit reverse byte order */
  MACHO_64_REV: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
};

/**
 * Check if a buffer starts with the magic bytes of a known binary executable format
 *
 * @param buf Buffer containing at least the first 4 bytes of the file
 * @returns true if the buffer matches a known executable format
 */
export function isBinaryExecutable(buf: Buffer): boolean {
  if (buf.length < 2) {
    return false;
  }

  // Check PE/MZ (only needs 2 bytes)
  if (buf[0] === MAGIC_BYTES.PE[0] && buf[1] === MAGIC_BYTES.PE[1]) {
    return true;
  }

  if (buf.length < 4) {
    return false;
  }

  // Check ELF
  if (buf[0] === MAGIC_BYTES.ELF[0] &&
      buf[1] === MAGIC_BYTES.ELF[1] &&
      buf[2] === MAGIC_BYTES.ELF[2] &&
      buf[3] === MAGIC_BYTES.ELF[3]) {
    return true;
  }

  // Check Mach-O variants (all 4 bytes)
  const first4 = buf.subarray(0, 4);
  for (const [name, magic] of Object.entries(MAGIC_BYTES)) {
    if (name === 'PE' || name === 'ELF') continue; // Already checked
    if (magic.length === 4 && first4.equals(magic)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a file at the given path is a binary executable
 *
 * @param filePath Path to the file to check
 * @returns true if the file is a binary executable
 */
export function isFileBinaryExecutable(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    return isBinaryExecutable(buf);
  } catch (error) {
    moduleLogger.warn('Failed to check file for binary executable', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Strip execute bits from a file
 *
 * @param filePath Path to the file
 */
export function stripExecuteBits(filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    const newMode = stats.mode & ~0o111;
    if (newMode !== stats.mode) {
      fs.chmodSync(filePath, newMode);
      moduleLogger.debug('Stripped execute bits', { filePath, oldMode: stats.mode, newMode });
    }
  } catch (error) {
    moduleLogger.warn('Failed to strip execute bits', {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
