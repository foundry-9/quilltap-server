/** Phase identifiers for splash screen state machine */
export type SplashPhase =
  | 'initializing'
  | 'downloading'
  | 'creating-vm'
  | 'updating-vm'
  | 'starting-vm'
  | 'waiting-health'
  | 'ready'
  | 'error';

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

/** Update message sent to splash screen via IPC */
export interface SplashUpdate {
  phase: SplashPhase;
  message: string;
  progress?: number;
  detail?: string;
  canRetry?: boolean;
}

/** Result of a VM command execution (limactl or wsl.exe) */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}
