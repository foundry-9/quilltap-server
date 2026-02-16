import * as path from 'path';
import * as os from 'os';

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

/** Name of the VM / distro instance */
export const VM_NAME = 'quilltap';

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
  // macOS
  return path.join(os.homedir(), 'Library', 'Caches', 'Quilltap', 'lima-images');
})();

/** Full path to the cached rootfs tarball */
export const ROOTFS_PATH = path.join(ROOTFS_CACHE_DIR, ROOTFS_FILENAME);

/** Build ID sidecar file written by build-rootfs.sh next to the tarball */
export const ROOTFS_BUILD_ID_PATH = ROOTFS_PATH + '.build-id';

/** Marker file inside LIMA_HOME recording the build ID of the currently provisioned VM */
export const VM_BUILD_ID_PATH = path.join(LIMA_HOME, VM_NAME, '.rootfs-build-id');

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
export const SPLASH_WIDTH = 500;
export const SPLASH_HEIGHT = 420;

/** Main window dimensions */
export const MAIN_WIDTH = 1200;
export const MAIN_HEIGHT = 800;

/** Download progress throttle (ms) */
export const DOWNLOAD_PROGRESS_THROTTLE_MS = 500;

/** Maximum download retry attempts */
export const DOWNLOAD_MAX_RETRIES = 3;
