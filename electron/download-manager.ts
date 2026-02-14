import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import {
  ROOTFS_CACHE_DIR,
  ROOTFS_PATH,
  DOWNLOAD_PROGRESS_THROTTLE_MS,
  DOWNLOAD_MAX_RETRIES,
} from './constants';
import { DownloadProgress } from './types';

/**
 * Handles first-run rootfs tarball acquisition with progress reporting,
 * retry logic, and cache management.
 */
export class DownloadManager {
  /** Check if the rootfs tarball already exists in cache */
  needsDownload(): boolean {
    return !fs.existsSync(ROOTFS_PATH);
  }

  /**
   * Download the rootfs tarball from a URL with progress reporting.
   * Supports retries with exponential backoff.
   */
  async download(
    url: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    // Ensure cache directory exists
    fs.mkdirSync(ROOTFS_CACHE_DIR, { recursive: true });

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= DOWNLOAD_MAX_RETRIES; attempt++) {
      try {
        await this.downloadAttempt(url, onProgress);
        return; // Success
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(
          `[DownloadManager] Attempt ${attempt}/${DOWNLOAD_MAX_RETRIES} failed:`,
          lastError.message
        );

        // Clean up partial download
        try {
          fs.unlinkSync(ROOTFS_PATH);
        } catch {
          // File may not exist
        }

        if (attempt < DOWNLOAD_MAX_RETRIES) {
          const delayMs = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
          console.log(`[DownloadManager] Retrying in ${delayMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    throw lastError || new Error('Download failed after all retries');
  }

  /** Single download attempt with progress tracking */
  private downloadAttempt(
    url: string,
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          this.downloadAttempt(response.headers.location, onProgress)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
        let bytesReceived = 0;
        let lastProgressTime = 0;
        let lastProgressBytes = 0;

        const tempPath = ROOTFS_PATH + '.tmp';
        const fileStream = fs.createWriteStream(tempPath);

        response.on('data', (chunk: Buffer) => {
          bytesReceived += chunk.length;

          if (onProgress) {
            const now = Date.now();
            if (now - lastProgressTime >= DOWNLOAD_PROGRESS_THROTTLE_MS) {
              const elapsed = (now - lastProgressTime) / 1000;
              const bytesInPeriod = bytesReceived - lastProgressBytes;
              const speedBps = elapsed > 0 ? bytesInPeriod / elapsed : 0;

              onProgress({
                phase: 'downloading',
                bytesReceived,
                totalBytes,
                percent: totalBytes > 0 ? Math.round((bytesReceived / totalBytes) * 100) : 0,
                speed: formatSpeed(speedBps),
              });

              lastProgressTime = now;
              lastProgressBytes = bytesReceived;
            }
          }
        });

        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close(() => {
            // Move temp file to final location
            fs.renameSync(tempPath, ROOTFS_PATH);
            resolve();
          });
        });

        fileStream.on('error', (err) => {
          // Clean up temp file
          try {
            fs.unlinkSync(tempPath);
          } catch {
            // Ignore
          }
          reject(err);
        });

        response.on('error', (err) => {
          reject(err);
        });
      });

      request.on('error', (err) => {
        reject(err);
      });
    });
  }
}

/** Format bytes/second into a human-readable speed string */
function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}
