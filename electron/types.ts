/** Runtime mode: VM (Lima/WSL2) or Docker */
export type RuntimeMode = 'docker' | 'vm';

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
  | 'waiting-health'
  | 'ready'
  | 'error';

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
  dirs: string[];
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
  /** Label for the VM button (e.g. "Lima" on macOS, "WSL2" on Windows) */
  vmLabel: string;
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
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unreachable';
  attempts: number;
  error?: string;
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
