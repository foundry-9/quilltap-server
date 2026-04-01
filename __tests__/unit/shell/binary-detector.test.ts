/**
 * Binary Detector Tests
 *
 * Tests for detecting binary executable formats by magic bytes.
 */

import { isBinaryExecutable } from '@/lib/tools/shell/binary-detector';

describe('isBinaryExecutable', () => {
  it('should detect ELF executables', () => {
    const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
    expect(isBinaryExecutable(elfHeader)).toBe(true);
  });

  it('should detect PE/MZ executables', () => {
    const peHeader = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    expect(isBinaryExecutable(peHeader)).toBe(true);
  });

  it('should detect Mach-O 32-bit executables', () => {
    const machoHeader = Buffer.from([0xfe, 0xed, 0xfa, 0xce]);
    expect(isBinaryExecutable(machoHeader)).toBe(true);
  });

  it('should detect Mach-O 64-bit executables', () => {
    const machoHeader = Buffer.from([0xfe, 0xed, 0xfa, 0xcf]);
    expect(isBinaryExecutable(machoHeader)).toBe(true);
  });

  it('should detect Mach-O fat/universal binaries', () => {
    const fatHeader = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
    expect(isBinaryExecutable(fatHeader)).toBe(true);
  });

  it('should detect Mach-O 32-bit reverse byte order', () => {
    const machoRevHeader = Buffer.from([0xce, 0xfa, 0xed, 0xfe]);
    expect(isBinaryExecutable(machoRevHeader)).toBe(true);
  });

  it('should detect Mach-O 64-bit reverse byte order', () => {
    const machoRevHeader = Buffer.from([0xcf, 0xfa, 0xed, 0xfe]);
    expect(isBinaryExecutable(machoRevHeader)).toBe(true);
  });

  it('should NOT detect plain text files', () => {
    const textContent = Buffer.from('Hello, world!', 'utf-8');
    expect(isBinaryExecutable(textContent)).toBe(false);
  });

  it('should NOT detect JSON files', () => {
    const jsonContent = Buffer.from('{"key": "value"}', 'utf-8');
    expect(isBinaryExecutable(jsonContent)).toBe(false);
  });

  it('should NOT detect PNG files', () => {
    const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(isBinaryExecutable(pngHeader)).toBe(false);
  });

  it('should NOT detect JPEG files', () => {
    const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    expect(isBinaryExecutable(jpegHeader)).toBe(false);
  });

  it('should NOT detect ZIP files', () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    expect(isBinaryExecutable(zipHeader)).toBe(false);
  });

  it('should handle empty buffers', () => {
    expect(isBinaryExecutable(Buffer.alloc(0))).toBe(false);
  });

  it('should handle single-byte buffers', () => {
    expect(isBinaryExecutable(Buffer.from([0x7f]))).toBe(false);
  });

  it('should handle two-byte buffers for PE detection', () => {
    const peShort = Buffer.from([0x4d, 0x5a]);
    expect(isBinaryExecutable(peShort)).toBe(true);
  });

  it('should handle three-byte buffers (too short for 4-byte magic)', () => {
    const shortElf = Buffer.from([0x7f, 0x45, 0x4c]);
    expect(isBinaryExecutable(shortElf)).toBe(false);
  });
});
