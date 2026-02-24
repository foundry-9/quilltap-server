'use strict';

/**
 * Download manager for the Quilltap standalone tarball.
 *
 * On first run (or version mismatch), downloads the pre-built standalone
 * output from GitHub Releases and caches it locally. Subsequent runs
 * start instantly from the cache.
 *
 * Uses only Node.js built-ins — no external dependencies.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractTarGz } = require('./tar-extract');

const MAX_RETRIES = 3;
const PROGRESS_THROTTLE_MS = 250;
const GITHUB_REPO = 'foundry-9/quilltap';

/**
 * Get the platform-specific cache directory for standalone files.
 * Follows the same conventions as the Electron app.
 */
function getCacheDir() {
  const platform = process.platform;

  if (platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'Quilltap', 'standalone');
  }

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Quilltap', 'standalone');
  }

  // Linux and others: XDG_CACHE_HOME or ~/.cache
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheHome, 'quilltap', 'standalone');
}

/**
 * Check if the cached standalone matches the expected version.
 * @param {string} cacheDir - The cache directory
 * @param {string} version - Expected version
 * @returns {boolean} true if cache is valid and matches version
 */
function isCacheValid(cacheDir, version) {
  const versionFile = path.join(cacheDir, '.version');
  const serverJs = path.join(cacheDir, 'server.js');

  if (!fs.existsSync(serverJs)) {
    return false;
  }

  try {
    const cachedVersion = fs.readFileSync(versionFile, 'utf-8').trim();
    return cachedVersion === version;
  } catch {
    // No version file — cache is invalid
    return false;
  }
}

/**
 * Build the download URL for a given version.
 * @param {string} version
 * @returns {string}
 */
function getDownloadUrl(version) {
  return `https://github.com/${GITHUB_REPO}/releases/download/${version}/quilltap-standalone-${version}.tar.gz`;
}

/**
 * Format bytes into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

/**
 * Format bytes/second into a speed string.
 * @param {number} bytesPerSecond
 * @returns {string}
 */
function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond >= 1024 * 1024) {
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  if (bytesPerSecond >= 1024) {
    return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
  }
  return `${Math.round(bytesPerSecond)} B/s`;
}

/**
 * Render a terminal progress bar.
 * @param {number} percent
 * @param {number} received
 * @param {number} total
 * @param {string} speed
 */
function renderProgress(percent, received, total, speed) {
  const barWidth = 30;
  const filled = Math.round((percent / 100) * barWidth);
  const empty = barWidth - filled;
  const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);

  const totalStr = total > 0 ? formatBytes(total) : '?';
  const line = `  Downloading: ${bar} ${percent}% (${formatBytes(received)}/${totalStr}) ${speed}`;

  // Clear line and write progress
  process.stdout.write('\r' + line + '   ');
}

/**
 * Download a file from a URL, following redirects.
 * @param {string} url
 * @param {string} destPath - Path to save the downloaded file
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    const request = protocol.get(url, { headers: { 'User-Agent': 'quilltap-cli' } }, (response) => {
      // Handle redirects (GitHub releases redirect to S3)
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
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
      const startTime = Date.now();

      const tempPath = destPath + '.tmp';
      const fileStream = fs.createWriteStream(tempPath);

      response.on('data', (chunk) => {
        bytesReceived += chunk.length;

        const now = Date.now();
        if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
          const elapsed = (now - lastProgressTime) / 1000;
          const bytesInPeriod = bytesReceived - lastProgressBytes;
          const speedBps = elapsed > 0 ? bytesInPeriod / elapsed : 0;
          const percent = totalBytes > 0 ? Math.round((bytesReceived / totalBytes) * 100) : 0;

          renderProgress(percent, bytesReceived, totalBytes, formatSpeed(speedBps));

          lastProgressTime = now;
          lastProgressBytes = bytesReceived;
        }
      });

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => {
          // Clear progress line
          process.stdout.write('\r' + ' '.repeat(80) + '\r');

          const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
          console.log(`  Downloaded ${formatBytes(bytesReceived)} in ${totalTime}s`);

          // Move temp file to final location
          fs.renameSync(tempPath, destPath);
          resolve();
        });
      });

      fileStream.on('error', (err) => {
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        reject(err);
      });

      response.on('error', reject);
    });

    request.on('error', reject);
  });
}

/**
 * Download and extract the standalone tarball for the given version.
 * Retries with exponential backoff on failure.
 *
 * @param {string} version - The version to download
 * @param {string} cacheDir - The cache directory
 * @param {object} [options]
 * @param {boolean} [options.force] - Force re-download even if cache is valid
 * @returns {Promise<string>} Path to the standalone directory
 */
async function ensureStandalone(version, cacheDir, options = {}) {
  if (!options.force && isCacheValid(cacheDir, version)) {
    return cacheDir;
  }

  const url = getDownloadUrl(version);
  const tarballPath = path.join(os.tmpdir(), `quilltap-standalone-${version}.tar.gz`);

  console.log('');
  console.log(`  Quilltap v${version} — first-run setup`);
  console.log('');
  console.log('  The application files need to be downloaded. This only');
  console.log('  happens once per version and takes about a minute.');
  console.log('');

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await downloadFile(url, tarballPath);

      // Clean existing cache
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true, force: true });
      }
      fs.mkdirSync(cacheDir, { recursive: true });

      // Extract
      console.log('  Extracting...');
      await extractTarGz(tarballPath, cacheDir);

      // Write version sidecar
      fs.writeFileSync(path.join(cacheDir, '.version'), version, 'utf-8');

      // Clean up tarball
      try { fs.unlinkSync(tarballPath); } catch { /* ignore */ }

      console.log('  Ready!');
      console.log('');

      return cacheDir;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(`  Download attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}`);

      // Clean up partial downloads
      try { fs.unlinkSync(tarballPath); } catch { /* ignore */ }

      if (attempt < MAX_RETRIES) {
        const delayMs = Math.pow(2, attempt) * 1000;
        console.log(`  Retrying in ${delayMs / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw new Error(
    `Failed to download Quilltap standalone after ${MAX_RETRIES} attempts.\n` +
    `  URL: ${url}\n` +
    `  Error: ${lastError ? lastError.message : 'Unknown error'}\n\n` +
    `  Please check your internet connection and try again.\n` +
    `  If the problem persists, you can download manually from:\n` +
    `  https://github.com/${GITHUB_REPO}/releases`
  );
}

module.exports = {
  getCacheDir,
  isCacheValid,
  ensureStandalone,
  getDownloadUrl,
};
