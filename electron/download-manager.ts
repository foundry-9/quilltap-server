import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs';
import {
  ROOTFS_CACHE_DIR,
  ROOTFS_PATH,
  ROOTFS_BUILD_ID_PATH,
  APP_VERSION,
  DOWNLOAD_PROGRESS_THROTTLE_MS,
  DOWNLOAD_MAX_RETRIES,
} from './constants';
import { DownloadProgress } from './types';

/**
 * Handles first-run rootfs tarball acquisition with progress reporting,
 * retry logic, and cache management.
 */
export class DownloadManager {
  /**
   * Check if the rootfs tarball needs downloading.
   * Returns true if the tarball is missing OR if the cached tarball's
   * build-ID version doesn't match the running app version (e.g., a
   * locally-built dev tarball is present but the user installed a release).
   */
  needsDownload(): boolean {
    if (!fs.existsSync(ROOTFS_PATH)) return true;

    // If we can't determine the app version, trust the existing file
    if (!APP_VERSION) return false;

    // Check the build-ID sidecar to see if the cached tarball matches this app version
    try {
      const buildId = fs.readFileSync(ROOTFS_BUILD_ID_PATH, 'utf-8').trim();
      // Build ID format: "VERSION+TIMESTAMP" (e.g., "3.0.0+2026-02-17T12:00:00Z")
      const cachedVersion = buildId.split('+')[0];
      if (cachedVersion !== APP_VERSION) {
        console.log(
          `[DownloadManager] Cached rootfs version "${cachedVersion}" does not match app version "${APP_VERSION}" — re-downloading`
        );
        // Remove stale tarball and build-ID so the download writes fresh ones
        try { fs.unlinkSync(ROOTFS_PATH); } catch { /* ignore */ }
        try { fs.unlinkSync(ROOTFS_BUILD_ID_PATH); } catch { /* ignore */ }
        return true;
      }
    } catch {
      // No build-ID sidecar — can't verify version, trust the existing tarball.
      // This covers tarballs bundled directly in the cache by the CI workflow
      // (which don't have a sidecar) and first-run downloads (sidecar written
      // after download by the startup sequence).
      console.log('[DownloadManager] No build-ID sidecar found, trusting existing tarball');
    }

    return false;
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

            // Write build-ID sidecar so future launches can verify the version
            if (APP_VERSION) {
              try {
                const buildId = `${APP_VERSION}+${new Date().toISOString()}`;
                fs.writeFileSync(ROOTFS_BUILD_ID_PATH, buildId, 'utf-8');
                console.log(`[DownloadManager] Wrote build-ID sidecar: ${buildId}`);
              } catch (err) {
                console.warn('[DownloadManager] Could not write build-ID sidecar:', err);
              }
            }

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
