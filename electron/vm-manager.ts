import { VMStatus, CommandResult } from './types';

/**
 * Platform-agnostic VM manager interface.
 * Implemented by LimaManager (macOS) and WSLManager (Windows).
 */
export interface IVMManager {
  /** Verify platform prerequisites (e.g. WSL2 installed, limactl available) */
  checkPrerequisites(): Promise<{ ok: boolean; error?: string }>;
  checkStatus(): Promise<VMStatus>;
  createVM(onOutput?: (line: string) => void): Promise<CommandResult>;
  startVM(onOutput?: (line: string) => void): Promise<CommandResult>;
  stopVM(): Promise<CommandResult>;
  deleteVM(): Promise<CommandResult>;
  getLogs(lines?: number): Promise<string>;

  /** Set the host-side data directory for the VM mount / env var */
  setDataDir(hostPath: string): void;

  /** Get the currently configured data directory */
  getDataDir(): string;

  /** Get the VM/distro name for the current data directory */
  getVMName(): string;

  /** Get the disk size of the VM in bytes (-1 if no VM exists) */
  getVMDiskSize(): Promise<number>;

  /** Get the disk size of the data directory in bytes (-1 if missing) */
  getDataDirDiskSize(): Promise<number>;
}

/**
 * Factory: returns the correct VM manager for the current platform.
 */
export function createVMManager(): IVMManager {
  if (process.platform === 'linux') {
    const { DockerManager } = require('./docker-manager');
    return new DockerManager();
  }
  if (process.platform === 'darwin') {
    const { LimaManager } = require('./lima-manager');
    return new LimaManager();
  }
  if (process.platform === 'win32') {
    const { WSLManager } = require('./wsl-manager');
    return new WSLManager();
  }
  throw new Error(`Unsupported platform: ${process.platform}`);
}
