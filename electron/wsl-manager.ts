import { spawn } from 'child_process';
import * as fs from 'fs';
import {
  WSL_DISTRO_NAME,
  WSL_DISTRO_INSTALL_DIR,
  ROOTFS_PATH,
  DEFAULT_DATA_DIR,
  VM_CREATE_TIMEOUT_S,
  VM_START_TIMEOUT_S,
  VM_STOP_TIMEOUT_S,
} from './constants';
import { VMStatus, CommandResult } from './types';
import { IVMManager } from './vm-manager';
import { dirSize } from './disk-utils';

/**
 * Manages the WSL2 distro lifecycle on Windows: import, start, stop, unregister.
 */
export class WSLManager implements IVMManager {
  private wslPath: string = 'wsl.exe';
  private dataDir: string;

  constructor() {
    this.dataDir = DEFAULT_DATA_DIR;
  }

  /** Set the host-side data directory (passed as env var to WSL2) */
  setDataDir(hostPath: string): void {
    console.log('[WSLManager] Data directory set to:', hostPath);
    this.dataDir = hostPath;
  }

  /** Get the currently configured data directory */
  getDataDir(): string {
    return this.dataDir;
  }

  /** Get the WSL2 distro name (always the same — data dir is passed as env var) */
  getVMName(): string {
    return WSL_DISTRO_NAME;
  }

  /** Get the disk size of the WSL2 distro install directory in bytes */
  async getVMDiskSize(): Promise<number> {
    return dirSize(WSL_DISTRO_INSTALL_DIR);
  }

  /** Get the disk size of the data directory in bytes */
  async getDataDirDiskSize(): Promise<number> {
    return dirSize(this.dataDir);
  }

  /** Execute a wsl.exe command and capture output */
  private exec(args: string[], timeoutS: number, onOutput?: (line: string) => void): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(this.wslPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutS * 1000,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let outputBuf = '';

      child.stdout.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;

        if (onOutput) {
          outputBuf += chunk;
          const lines = outputBuf.split('\n');
          outputBuf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.replace(/\0/g, '').trim();
            if (trimmed) onOutput(trimmed);
          }
        }
      });

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;

        if (onOutput) {
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmed = line.replace(/\0/g, '').trim();
            if (trimmed) onOutput(trimmed);
          }
        }
      });

      child.on('close', (code) => {
        if (onOutput && outputBuf.replace(/\0/g, '').trim()) {
          onOutput(outputBuf.replace(/\0/g, '').trim());
        }

        if (code === 0) {
          resolve({ success: true, stdout, stderr });
        } else {
          resolve({
            success: false,
            stdout,
            stderr,
            error: `wsl.exe exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
          });
        }
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          stdout,
          stderr,
          error: `Failed to spawn wsl.exe: ${err.message}`,
        });
      });
    });
  }

  /**
   * Check if WSL2 is available on this system.
   * Returns a descriptive error if not.
   */
  async checkPrerequisites(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.exec(['--status'], 30);
      if (result.success) {
        return { ok: true };
      }
      return {
        ok: false,
        error: 'WSL2 is not properly configured. Please run "wsl --install" in PowerShell as Administrator.',
      };
    } catch {
      return {
        ok: false,
        error: 'WSL2 is not installed. Please run "wsl --install" in PowerShell as Administrator.',
      };
    }
  }

  /**
   * Check if the distro exists and whether it's running.
   * Parses the output of `wsl --list --verbose`.
   */
  async checkStatus(): Promise<VMStatus> {
    const result = await this.exec(['--list', '--verbose'], 30);

    if (!result.success) {
      return { exists: false, running: false, message: result.error || 'Failed to list WSL distros' };
    }

    try {
      // wsl --list --verbose output format (may have UTF-16 BOM):
      //   NAME        STATE       VERSION
      // * Ubuntu      Running     2
      //   quilltap    Stopped     2
      const lines = result.stdout
        .replace(/\0/g, '')  // strip UTF-16 null bytes
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        // Skip header line
        if (line.startsWith('NAME') || line.startsWith('---')) continue;

        // Remove leading '*' (default distro marker) and extra whitespace
        const cleaned = line.replace(/^\*?\s*/, '');
        const parts = cleaned.split(/\s+/);

        if (parts[0] === WSL_DISTRO_NAME) {
          const state = parts[1] || '';
          const running = state.toLowerCase() === 'running';
          return {
            exists: true,
            running,
            message: `Distro ${WSL_DISTRO_NAME} exists, state: ${state}`,
          };
        }
      }

      return { exists: false, running: false, message: `Distro ${WSL_DISTRO_NAME} not found` };
    } catch {
      return { exists: false, running: false, message: 'Failed to parse wsl output' };
    }
  }

  /** Import the rootfs tarball as a new WSL2 distro */
  async createVM(onOutput?: (line: string) => void): Promise<CommandResult> {
    console.log('[WSLManager] Importing distro from rootfs:', ROOTFS_PATH);

    // Ensure install directory exists
    fs.mkdirSync(WSL_DISTRO_INSTALL_DIR, { recursive: true });

    return this.exec(
      ['--import', WSL_DISTRO_NAME, WSL_DISTRO_INSTALL_DIR, ROOTFS_PATH, '--version', '2'],
      VM_CREATE_TIMEOUT_S,
      onOutput
    );
  }

  /**
   * Start the distro and launch the Quilltap backend.
   * WSL keeps the distro alive as long as the Node.js process is running.
   */
  async startVM(onOutput?: (line: string) => void): Promise<CommandResult> {
    console.log('[WSLManager] Starting distro:', WSL_DISTRO_NAME);

    // Ensure Windows-side data directory exists
    if (this.dataDir) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Launch wsl-init.sh in the background inside the distro.
    // We pass the Windows data directory path as an env var;
    // wsl-init.sh converts it to a WSL path via wslpath.
    const dataEnv = this.dataDir
      ? `QUILTTAP_WIN_DATADIR=${this.dataDir}`
      : '';

    const cmd = `${dataEnv} nohup /usr/local/bin/wsl-init.sh > /tmp/quilltap-stdout.log 2>&1 &`;

    return this.exec(
      ['-d', WSL_DISTRO_NAME, '--exec', 'sh', '-c', cmd],
      VM_START_TIMEOUT_S,
      onOutput
    );
  }

  /** Terminate the distro */
  async stopVM(): Promise<CommandResult> {
    console.log('[WSLManager] Terminating distro:', WSL_DISTRO_NAME);
    return this.exec(['--terminate', WSL_DISTRO_NAME], VM_STOP_TIMEOUT_S);
  }

  /** Unregister the distro (deletes all data inside the distro) */
  async deleteVM(): Promise<CommandResult> {
    console.log('[WSLManager] Unregistering distro:', WSL_DISTRO_NAME);
    return this.exec(['--unregister', WSL_DISTRO_NAME], VM_STOP_TIMEOUT_S);
  }

  /** Read recent logs from inside the distro */
  async getLogs(lines: number = 50): Promise<string> {
    // Try the stdout log first, then fall back to the app's combined log
    const logPaths = [
      '/tmp/quilltap-stdout.log',
      '/data/quilltap/logs/combined.log',
    ];

    for (const logPath of logPaths) {
      const result = await this.exec(
        ['-d', WSL_DISTRO_NAME, '--exec', 'tail', '-n', String(lines), logPath],
        15
      );
      if (result.success && result.stdout.trim()) {
        return result.stdout;
      }
    }

    return 'No logs available';
  }
}
