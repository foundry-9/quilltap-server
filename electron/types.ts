/** Runtime mode: VM (Lima/WSL2), Docker, or Node.js (npx) */
export type RuntimeMode = 'docker' | 'vm' | 'npx';

/** Phase identifiers for splash screen state machine */
export type SplashPhase =
  | 'choose-directory'
  | 'initializing'
  | 'downloading'
  | 'creating-vm'
  | 'updating-vm'
  | 'starting-vm'
  | 'pulling-image'
  | 'starting-container'
  | 'installing-npx'
  | 'waiting-health'
  | 'ready'
  | 'error';

/** Saved window bounds for restore on next launch */
export interface WindowBounds {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

/** A data directory with a human-readable name */
export interface NamedDataDir {
  /** Absolute file path */
  path: string;
  /** Human-readable display name */
  name: string;
  /** Remembered main window bounds for this instance */
  windowBounds?: WindowBounds;
}

/** Disk usage information for a single data directory */
export interface DirectorySizeInfo {
  /** Size of the data directory in bytes, or -1 if unknown/missing */
  dataSize: number;
  /** Size of the associated VM in bytes, or -1 if no VM exists */
  vmSize: number;
}

/** Directory information sent to the splash screen */
export interface DirectoryInfo {
  /** All known data directories */
  dirs: NamedDataDir[];
  /** The last-used directory (pre-selected) */
  lastUsed: string;
  /** Whether auto-start is enabled */
  autoStart: boolean;
  /** Disk usage per directory path (may arrive asynchronously) */
  sizes: Record<string, DirectorySizeInfo>;
  /** Current runtime mode (docker or vm) */
  runtimeMode: RuntimeMode;
  /** Whether Docker CLI is available on this system */
  dockerAvailable: boolean;
  /** Whether Node.js >= 18 is available on this system */
  nodeAvailable: boolean;
  /** Label for the VM button (e.g. "Lima" on macOS, "WSL2" on Windows) */
  vmLabel: string;
  /** Host platform (darwin, win32, linux) */
  platform: string;
}

/** Status of the VM (Lima on macOS, WSL2 on Windows) */
export interface VMStatus {
  exists: boolean;
  running: boolean;
  message: string;
}

/** @deprecated Use VMStatus instead */
export type LimaStatus = VMStatus;

/** Progress information during rootfs download */
export interface DownloadProgress {
  phase: 'downloading';
  bytesReceived: number;
  totalBytes: number;
  percent: number;
  speed: string;
}

/** Health endpoint polling status */
export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unreachable' | 'locked';
  attempts: number;
  error?: string;
  /** Present when status is 'locked' — the database key state */
  dbKeyState?: string;
}

/** Log level for color-coding detail text on the splash screen */
export type DetailLevel = 'info' | 'warn' | 'error' | 'debug';

/** Update message sent to splash screen via IPC */
export interface SplashUpdate {
  phase: SplashPhase;
  message: string;
  progress?: number;
  detail?: string;
  /** Log level for color-coding the detail text */
  detailLevel?: DetailLevel;
  canRetry?: boolean;
}

/** Result of a VM command execution (limactl or wsl.exe) */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}
