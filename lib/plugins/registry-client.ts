/**
 * Plugin Registry Client
 *
 * A lightweight npm registry client that talks directly to the npm registry
 * HTTP API, replacing the need to shell out to the npm CLI for plugin
 * installation and version checking.
 *
 * Quilltap plugins bundle their own dependencies, so this client only
 * downloads and extracts the single package tarball — no dependency
 * resolution is performed.
 */

import path from 'path';
import fs from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import * as tar from 'tar';
import { logger } from '@/lib/logger';

const log = logger.child({ module: 'RegistryClient' });

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_REGISTRY_URL = 'https://registry.npmjs.org';
const VERSION_CHECK_TIMEOUT = 30_000;   // 30 seconds
const DOWNLOAD_TIMEOUT = 120_000;       // 2 minutes

// ============================================================================
// TYPES
// ============================================================================

interface NpmDistTags {
  latest: string;
  [tag: string]: string;
}

interface NpmVersionDist {
  tarball: string;
  shasum?: string;
  integrity?: string;
}

interface NpmVersionInfo {
  version: string;
  dist: NpmVersionDist;
}

interface NpmPackageMetadata {
  name: string;
  'dist-tags': NpmDistTags;
  versions: Record<string, NpmVersionInfo>;
}

export interface RegistryInstallResult {
  success: boolean;
  error?: string;
  version?: string;
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Encode a package name for use in a registry URL.
 * Scoped packages like @org/pkg become @org%2Fpkg.
 */
function encodePackageName(packageName: string): string {
  if (packageName.startsWith('@')) {
    return packageName.replace('/', '%2F');
  }
  return packageName;
}

/**
 * Fetch JSON from the npm registry with a timeout.
 */
async function fetchRegistryJson<T>(
  url: string,
  timeoutMs: number,
): Promise<T> {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Registry returned HTTP ${response.status} for ${url}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download a file from a URL and return it as a Buffer.
 */
async function downloadBuffer(
  url: string,
  timeoutMs: number,
): Promise<Buffer> {

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Download failed with HTTP ${response.status} for ${url}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get the latest version of a package from the npm registry.
 *
 * @param packageName - npm package name (scoped or unscoped)
 * @param registryUrl - Base registry URL (defaults to https://registry.npmjs.org)
 * @returns Latest version string, or null if unable to fetch
 */
export async function getLatestVersion(
  packageName: string,
  registryUrl: string = DEFAULT_REGISTRY_URL,
): Promise<string | null> {
  try {
    const encoded = encodePackageName(packageName);
    const url = `${registryUrl}/${encoded}`;

    const metadata = await fetchRegistryJson<NpmPackageMetadata>(
      url,
      VERSION_CHECK_TIMEOUT,
    );

    const latest = metadata['dist-tags']?.latest;
    if (!latest) {
      log.warn('No latest dist-tag found in registry response', { packageName });
      return null;
    }
    return latest;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('abort')) {
        log.warn('Timeout checking registry for package version', { packageName });
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('fetch failed')) {
        log.warn('Cannot reach npm registry', { packageName });
      } else if (error.message.includes('404')) {
        log.warn('Package not found on npm registry', { packageName });
      } else {
        log.warn('Error checking registry for package version', {
          packageName,
          error: error.message,
        });
      }
    }
    return null;
  }
}

/**
 * Install a package from the npm registry by downloading and extracting
 * its tarball directly — no npm CLI or dependency resolution required.
 *
 * The tarball is extracted to `targetDir/node_modules/{packageName}/`.
 * For scoped packages the scope directory (e.g. `node_modules/@org/`) is
 * created automatically.
 *
 * @param packageName - npm package name (scoped or unscoped)
 * @param targetDir   - Directory in which to create node_modules/
 * @param registryUrl - Base registry URL (defaults to https://registry.npmjs.org)
 * @returns Result object with success flag, optional error, and installed version
 */
export async function installPackageFromRegistry(
  packageName: string,
  targetDir: string,
  registryUrl: string = DEFAULT_REGISTRY_URL,
): Promise<RegistryInstallResult> {
  try {
    // 1. Fetch package metadata

    const encoded = encodePackageName(packageName);
    const url = `${registryUrl}/${encoded}`;

    const metadata = await fetchRegistryJson<NpmPackageMetadata>(
      url,
      VERSION_CHECK_TIMEOUT,
    );

    const latestTag = metadata['dist-tags']?.latest;
    if (!latestTag) {
      return { success: false, error: 'No latest version found in registry' };
    }

    const versionInfo = metadata.versions?.[latestTag];
    if (!versionInfo) {
      return { success: false, error: `Version ${latestTag} not found in registry metadata` };
    }

    const tarballUrl = versionInfo.dist?.tarball;
    if (!tarballUrl) {
      return { success: false, error: `No tarball URL found for version ${latestTag}` };
    }

    // 2. Download the tarball
    const tarballBuffer = await downloadBuffer(tarballUrl, DOWNLOAD_TIMEOUT);

    // 3. Prepare the extraction target
    const extractDir = path.join(targetDir, 'node_modules', packageName);
    await fs.mkdir(extractDir, { recursive: true });

    // 4. Extract the tarball, stripping the top-level `package/` directory.
    //    npm tarballs are gzipped and always contain a single top-level
    //    `package/` folder. The `tar` module handles gzip decompression
    //    automatically.
    const bufferStream = Readable.from(tarballBuffer);
    await pipeline(
      bufferStream,
      tar.extract({
        cwd: extractDir,
        strip: 1,
      }),
    );

    // 5. Verify the extraction produced something
    const entries = await fs.readdir(extractDir);
    if (entries.length === 0) {
      return { success: false, error: 'Tarball extraction produced no files' };
    }

    log.info('Package installed from registry', {
      packageName,
      version: latestTag,
      targetDir,
      fileCount: entries.length,
    });

    return { success: true, version: latestTag };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (error instanceof Error) {
      if (error.name === 'AbortError' || message.includes('abort')) {
        log.error('Installation timed out', { packageName });
        return { success: false, error: 'Installation timed out - please try again' };
      }
      if (message.includes('ENOTFOUND') || message.includes('fetch failed')) {
        log.error('Could not reach npm registry', { packageName });
        return { success: false, error: 'Could not reach npm registry - check your internet connection' };
      }
    }

    log.error('Package installation from registry failed', {
      packageName,
      error: message,
    });
    return { success: false, error: message };
  }
}
