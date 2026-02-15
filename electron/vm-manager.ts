import { VMStatus, CommandResult } from './types';

/**
 * Platform-agnostic VM manager interface.
 * Implemented by LimaManager (macOS) and WSLManager (Windows).
 */
export interface IVMManager {
  /** Verify platform prerequisites (e.g. WSL2 installed, limactl available) */
  checkPrerequisites(): Promise<{ ok: boolean; error?: string }>;
  checkStatus(): Promise<VMStatus>;
  createVM(): Promise<CommandResult>;
  startVM(): Promise<CommandResult>;
  stopVM(): Promise<CommandResult>;
  deleteVM(): Promise<CommandResult>;
  getLogs(lines?: number): Promise<string>;
}

/**
 * Factory: returns the correct VM manager for the current platform.
 */
export function createVMManager(): IVMManager {
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
