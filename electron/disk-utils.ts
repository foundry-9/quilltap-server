import * as fs from 'fs';
import * as path from 'path';
import { LIMA_HOME, vmNameForDir } from './constants';
import { DirectorySizeInfo } from './types';

/**
 * Recursively compute the total size of a directory in bytes.
 * Returns -1 if the directory does not exist or cannot be read.
 */
export function dirSize(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return -1;

    let total = 0;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = dirSize(fullPath);
          if (sub > 0) total += sub;
        } else if (entry.isFile()) {
          total += fs.statSync(fullPath).size;
        }
      } catch {
        // Skip unreadable entries (permission errors, broken symlinks)
      }
    }
    return total;
  } catch {
    return -1;
  }
}

/**
 * Calculate both data directory and VM disk sizes for a given data directory.
 */
export function getSizesForDir(dataDir: string): DirectorySizeInfo {
  const dataSize = dirSize(dataDir);

  // Check for a Lima VM associated with this directory
  const vmName = vmNameForDir(dataDir);
  const vmDir = path.join(LIMA_HOME, vmName);
  const vmSize = dirSize(vmDir);

  return { dataSize, vmSize };
}

/**
 * Format a byte count into a human-readable string (e.g., "1.2 GB").
 */
export function formatBytes(bytes: number): string {
  if (bytes < 0) return 'Unknown';
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
