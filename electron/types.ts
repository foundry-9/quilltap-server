/** Phase identifiers for splash screen state machine */
export type SplashPhase =
  | 'initializing'
  | 'downloading'
  | 'creating-vm'
  | 'starting-vm'
  | 'waiting-health'
  | 'ready'
  | 'error';

/** Status of the Lima VM */
export interface LimaStatus {
  exists: boolean;
  running: boolean;
  message: string;
}

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

/** Result of a Lima command execution */
export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
}
