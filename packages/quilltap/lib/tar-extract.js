'use strict';

/**
 * Minimal tar.gz extractor using only Node.js built-ins.
 * Handles POSIX tar format (ustar) — sufficient for extracting
 * the Quilltap standalone tarball.
 *
 * No external dependencies required.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * Extract a .tar.gz file to the given directory.
 * @param {string} tarGzPath - Path to the .tar.gz file
 * @param {string} destDir - Directory to extract into
 * @returns {Promise<void>}
 */
function extractTarGz(tarGzPath, destDir) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(tarGzPath);
    const gunzip = zlib.createGunzip();
    const chunks = [];

    readStream.pipe(gunzip);

    gunzip.on('data', (chunk) => chunks.push(chunk));
    gunzip.on('error', reject);
    readStream.on('error', reject);

    gunzip.on('end', () => {
      try {
        const tarBuffer = Buffer.concat(chunks);
        extractTarBuffer(tarBuffer, destDir);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

/**
 * Parse and extract files from a raw tar buffer.
 * @param {Buffer} buffer - The uncompressed tar data
 * @param {string} destDir - Directory to extract into
 */
function extractTarBuffer(buffer, destDir) {
  let offset = 0;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);

    // Check for end-of-archive (two consecutive zero blocks)
    if (isZeroBlock(header)) {
      break;
    }

    const parsed = parseHeader(header);
    if (!parsed) {
      // Skip malformed header
      offset += 512;
      continue;
    }

    offset += 512; // Move past header

    const { name, size, type, linkName } = parsed;

    // Security: prevent path traversal
    const safeName = name.replace(/^\.\//, '');
    if (safeName.startsWith('/') || safeName.includes('..')) {
      // Skip dangerous paths
      offset += Math.ceil(size / 512) * 512;
      continue;
    }

    const fullPath = path.join(destDir, safeName);

    switch (type) {
      case 'directory':
        // If a file exists at this path, remove it so the directory can be created
        if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
          fs.unlinkSync(fullPath);
        }
        fs.mkdirSync(fullPath, { recursive: true });
        break;

      case 'file': {
        // Ensure parent directory exists
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });

        // If a directory exists at the file path, remove it first
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        }

        const fileData = buffer.subarray(offset, offset + size);
        fs.writeFileSync(fullPath, fileData);

        // Set executable permission if needed
        if (parsed.mode & 0o111) {
          try {
            fs.chmodSync(fullPath, parsed.mode);
          } catch {
            // chmod may fail on Windows, that's fine
          }
        }
        break;
      }

      case 'symlink': {
        const dir = path.dirname(fullPath);
        fs.mkdirSync(dir, { recursive: true });
        try {
          fs.symlinkSync(linkName, fullPath);
        } catch {
          // Symlinks may fail on Windows without privileges
        }
        break;
      }

      // Skip other types (hard links, etc.)
    }

    // Advance past file data (padded to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }
}

/**
 * Parse a 512-byte tar header block.
 * @param {Buffer} header
 * @returns {{ name: string, size: number, type: string, mode: number, linkName: string } | null}
 */
function parseHeader(header) {
  // Validate checksum
  const storedChecksum = parseOctal(header, 148, 8);
  const computedChecksum = computeChecksum(header);
  if (storedChecksum !== computedChecksum) {
    return null;
  }

  const name = parseName(header, 0, 100);
  const mode = parseOctal(header, 100, 8);
  const size = parseOctal(header, 124, 12);
  const typeFlag = String.fromCharCode(header[156]);
  const linkName = parseName(header, 157, 100);

  // UStar prefix (extends the name field for longer paths)
  const magic = header.subarray(257, 263).toString('ascii');
  let fullName = name;
  if (magic.startsWith('ustar')) {
    const prefix = parseName(header, 345, 155);
    if (prefix) {
      fullName = prefix + '/' + name;
    }
  }

  // Determine entry type
  let type;
  switch (typeFlag) {
    case '0':
    case '\0':
    case '': // Regular file
      type = 'file';
      break;
    case '2': // Symbolic link
      type = 'symlink';
      break;
    case '5': // Directory
      type = 'directory';
      break;
    default:
      type = 'other';
  }

  // A name ending with '/' is also a directory
  if (fullName.endsWith('/') && type === 'file' && size === 0) {
    type = 'directory';
  }

  return { name: fullName, size, type, mode, linkName };
}

/**
 * Read a null-terminated string from a buffer region.
 */
function parseName(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const nullIndex = slice.indexOf(0);
  const str = slice.subarray(0, nullIndex >= 0 ? nullIndex : length).toString('utf-8');
  return str;
}

/**
 * Parse an octal number from a buffer region.
 */
function parseOctal(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length);
  const str = slice.toString('ascii').replace(/\0/g, '').trim();
  if (!str) return 0;
  return parseInt(str, 8) || 0;
}

/**
 * Compute the checksum of a tar header (treat checksum field as spaces).
 */
function computeChecksum(header) {
  let sum = 0;
  for (let i = 0; i < 512; i++) {
    // The checksum field (bytes 148-155) is treated as spaces (0x20)
    if (i >= 148 && i < 156) {
      sum += 0x20;
    } else {
      sum += header[i];
    }
  }
  return sum;
}

/**
 * Check if a 512-byte block is all zeros.
 */
function isZeroBlock(block) {
  for (let i = 0; i < 512; i++) {
    if (block[i] !== 0) return false;
  }
  return true;
}

module.exports = { extractTarGz };
