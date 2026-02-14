import * as path from 'path';
import * as os from 'os';

/** Lima home directory — isolated from default ~/.lima */
export const LIMA_HOME = path.join(os.homedir(), '.qtlima');

/** Name of the Lima VM instance */
export const VM_NAME = 'quilltap';

/** Host port that maps to guest port 3000 */
export const HOST_PORT = 5050;

/** Health endpoint URL */
export const HEALTH_URL = `http://localhost:${HOST_PORT}/api/health`;

/** Milliseconds between health polls */
export const HEALTH_POLL_INTERVAL_MS = 2000;

/** Maximum health poll attempts before timeout (2 minutes at 2s intervals) */
export const HEALTH_MAX_ATTEMPTS = 60;

/** Rootfs tarball filename */
export const ROOTFS_FILENAME = 'quilltap-linux-arm64.tar.gz';

/** Directory where rootfs tarballs are cached */
export const ROOTFS_CACHE_DIR = path.join(
  os.homedir(),
  'Library',
  'Caches',
  'Quilltap',
  'lima-images'
);

/** Full path to the cached rootfs tarball */
export const ROOTFS_PATH = path.join(ROOTFS_CACHE_DIR, ROOTFS_FILENAME);

/** Lima binary name */
export const LIMA_BINARY_NAME = 'limactl';

/** Timeout for VM creation (seconds) */
export const VM_CREATE_TIMEOUT_S = 300;

/** Timeout for VM start (seconds) */
export const VM_START_TIMEOUT_S = 120;

/** Timeout for VM stop (seconds) */
export const VM_STOP_TIMEOUT_S = 60;

/** Splash window dimensions */
export const SPLASH_WIDTH = 500;
export const SPLASH_HEIGHT = 350;

/** Main window dimensions */
export const MAIN_WIDTH = 1200;
export const MAIN_HEIGHT = 800;

/** Download progress throttle (ms) */
export const DOWNLOAD_PROGRESS_THROTTLE_MS = 500;

/** Maximum download retry attempts */
export const DOWNLOAD_MAX_RETRIES = 3;
