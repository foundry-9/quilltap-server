import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';

// --- Lima-specific (macOS only) ---

/** Lima home directory — isolated from default ~/.lima */
export const LIMA_HOME = path.join(os.homedir(), '.qtlima');

/** Lima binary name */
export const LIMA_BINARY_NAME = 'limactl';

/** Lima version to download from GitHub Releases */
export const LIMA_VERSION = '2.0.3';

/** Directory where downloaded Lima tarballs are cached */
export const LIMA_CACHE_DIR = path.join(os.homedir(), 'Library', 'Caches', 'Quilltap', 'lima-binaries');

/** Marker file indicating Xcode CLT has been verified */
export const CLT_VERIFIED_MARKER = path.join(LIMA_HOME, '.clt-verified');

// --- WSL-specific (Windows only) ---

/** Directory where the WSL2 distro ext4 vhdx is stored */
export const WSL_DISTRO_INSTALL_DIR = path.join(os.homedir(), '.qtvm', 'quilltap');

// --- Shared constants ---

/** Name of the WSL2 distro instance (Windows only — Lima uses per-directory VM names) */
export const WSL_DISTRO_NAME = 'quilltap';

/** @deprecated Use WSL_DISTRO_NAME for WSL or vmNameForDir() for Lima */
export const VM_NAME = WSL_DISTRO_NAME;

/** Host port that maps to guest port 5050 */
export const HOST_PORT = 5050;

/** Health endpoint URL */
export const HEALTH_URL = `http://localhost:${HOST_PORT}/api/health`;

/** Milliseconds between health polls */
export const HEALTH_POLL_INTERVAL_MS = 2000;

/** Maximum health poll attempts before timeout (2 minutes at 2s intervals) */
export const HEALTH_MAX_ATTEMPTS = 60;

/** Rootfs tarball filename — architecture-specific */
export const ROOTFS_FILENAME = process.platform === 'win32'
  ? 'quilltap-linux-amd64.tar.gz'
  : 'quilltap-linux-arm64.tar.gz';

/** Directory where rootfs tarballs are cached */
export const ROOTFS_CACHE_DIR = (() => {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
      || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Quilltap', 'vm-images');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'Quilltap', 'lima-images');
  }
  // Linux
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheHome, 'quilltap', 'vm-images');
})();

/** Full path to the cached rootfs tarball */
export const ROOTFS_PATH = path.join(ROOTFS_CACHE_DIR, ROOTFS_FILENAME);

/** Build ID sidecar file written by build-rootfs.ts next to the tarball */
export const ROOTFS_BUILD_ID_PATH = ROOTFS_PATH + '.build-id';

/**
 * Derive a deterministic Lima VM name from an absolute data directory path.
 * Produces names like `quilltap-a1b2c3d4e5f6` (valid Lima instance names).
 */
export function vmNameForDir(dirPath: string): string {
  const hash = crypto.createHash('sha256').update(dirPath).digest('hex').slice(0, 12);
  return `quilltap-${hash}`;
}

/**
 * Return the path to the build-ID sidecar for a specific VM.
 * Each VM has its own `.rootfs-build-id` at `~/.qtlima/<vm-name>/.rootfs-build-id`.
 */
export function vmBuildIdPath(vmName: string): string {
  return path.join(LIMA_HOME, vmName, '.rootfs-build-id');
}

/** JSON map of VM name -> data dir path, for debugging */
export const DIR_MAP_PATH = path.join(LIMA_HOME, '.dir-map.json');

/** Default data directory per platform */
export const DEFAULT_DATA_DIR = (() => {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
      || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Quilltap');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Quilltap');
  }
  // Linux fallback
  return path.join(os.homedir(), '.quilltap');
})();

/** @deprecated Use DEFAULT_DATA_DIR instead. Windows-side data directory (passed into WSL2 as env var) */
export const WIN_DATA_DIR = DEFAULT_DATA_DIR;

/** Timeout for VM creation (seconds) */
export const VM_CREATE_TIMEOUT_S = 300;

/** Timeout for VM start (seconds) */
export const VM_START_TIMEOUT_S = 120;

/** Timeout for VM stop (seconds) */
export const VM_STOP_TIMEOUT_S = 60;

/** Splash window dimensions */
export const SPLASH_WIDTH = 580;
export const SPLASH_HEIGHT = 680;

/** Main window dimensions */
export const MAIN_WIDTH = 1200;
export const MAIN_HEIGHT = 800;

/** Docker image name on Docker Hub */
export const DOCKER_IMAGE = 'foundry9/quilltap';

/** Port the Quilltap container listens on internally */
export const DOCKER_CONTAINER_PORT = 3000;

/** Download progress throttle (ms) */
export const DOWNLOAD_PROGRESS_THROTTLE_MS = 500;

/** Maximum download retry attempts */
export const DOWNLOAD_MAX_RETRIES = 3;

/** GitHub repository for release asset URLs */
const GITHUB_REPO = 'foundry-9/quilltap';

/** App version read from package.json */
export const APP_VERSION = (() => {
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version as string;
  } catch {
    return '';
  }
})();

/** Default rootfs download URL — GitHub Releases asset for current version */
export const DEFAULT_ROOTFS_URL = APP_VERSION
  ? `https://github.com/${GITHUB_REPO}/releases/download/${APP_VERSION}/${ROOTFS_FILENAME}`
  : '';
