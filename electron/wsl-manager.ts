import { ChildProcess, spawn } from 'child_process';
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

  /**
   * Long-lived wsl.exe child process that keeps the distro alive.
   * WSL2 terminates a distro when no active sessions remain, so we must
   * keep the wsl.exe process running for the lifetime of the Electron app.
   */
  private serverProcess: ChildProcess | null = null;

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
   *
   * Spawns wsl.exe as a long-lived foreground process running wsl-init.sh
   * directly (no nohup, no backgrounding). This keeps the WSL2 session
   * alive for the lifetime of the Electron app — WSL2 terminates a distro
   * when no active sessions remain, so backgrounding with `nohup ... &`
   * caused the distro to shut down immediately after the shell exited.
   *
   * We use `--exec env VAR=value /path/to/script` instead of `sh -c "..."`
   * to avoid shell interpretation of Windows backslashes in the data dir path.
   */
  async startVM(onOutput?: (line: string) => void): Promise<CommandResult> {
    console.log('[WSLManager] Starting distro:', WSL_DISTRO_NAME);

    // Ensure Windows-side data directory exists
    if (this.dataDir) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Build args: wsl.exe -d quilltap --exec env QUILLTAP_WIN_DATADIR=<path> /usr/local/bin/wsl-init.sh
    // Using --exec bypasses shell interpretation, so Windows backslashes in
    // the data dir path are passed through verbatim to the env command.
    const wslArgs = ['-d', WSL_DISTRO_NAME, '--exec'];

    // Build environment variables to pass into WSL2
    const envVars: string[] = [];
    if (this.dataDir) {
      envVars.push(`QUILLTAP_WIN_DATADIR=${this.dataDir}`);
    }

    // Pass host timezone to WSL2 backend
    try {
      const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (hostTimezone) {
        envVars.push(`QUILLTAP_TIMEZONE=${hostTimezone}`);
      }
    } catch {
      // Intl not available — backend will use system default
    }

    if (envVars.length > 0) {
      wslArgs.push('env', ...envVars);
    }

    wslArgs.push('/usr/local/bin/wsl-init.sh');

    return new Promise((resolve) => {
      const child = spawn(this.wslPath, wslArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.serverProcess = child;

      let resolved = false;

      // Forward output to the splash screen callback
      const handleData = (stream: 'stdout' | 'stderr') => (data: Buffer) => {
        const lines = data.toString().split('\n');
        for (const line of lines) {
          const trimmed = line.replace(/\0/g, '').trim();
          if (trimmed && onOutput) {
            onOutput(trimmed);
          }
        }
      };

      child.stdout?.on('data', handleData('stdout'));
      child.stderr?.on('data', handleData('stderr'));

      // If wsl.exe fails to start (e.g. binary not found), report the error
      child.on('error', (err) => {
        this.serverProcess = null;
        if (!resolved) {
          resolved = true;
          resolve({
            success: false,
            stdout: '',
            stderr: '',
            error: `Failed to spawn wsl.exe: ${err.message}`,
          });
        }
      });

      // If the process exits unexpectedly before the health checker takes over,
      // that's fine — the health checker will detect the failure. But if it exits
      // immediately (within 2s), it's likely a startup error we should report.
      child.on('close', (code) => {
        this.serverProcess = null;
        console.log(`[WSLManager] wsl.exe exited with code ${code}`);
      });

      // The server takes time to start. We return success immediately after
      // spawning — the health checker in main.ts handles waiting for readiness.
      // Give it a brief moment to catch immediate spawn failures.
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ success: true, stdout: '', stderr: '' });
        }
      }, 1000);
    });
  }

  /** Gracefully stop the Node.js server, then terminate the distro */
  async stopVM(): Promise<CommandResult> {
    console.log('[WSLManager] Gracefully stopping Node.js server in distro:', WSL_DISTRO_NAME);

    // Send SIGTERM to the Node.js server process so it can flush writes and close the database
    const killResult = await this.exec(
      ['-d', WSL_DISTRO_NAME, '--exec', 'pkill', '-TERM', 'node'],
      10
    );

    if (killResult.success) {
      // Give the process a few seconds to finish cleanup
      console.log('[WSLManager] Waiting for Node.js server to exit...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    } else {
      console.log('[WSLManager] No Node.js process found or already stopped');
    }

    // Clean up the long-lived wsl.exe child process
    if (this.serverProcess) {
      console.log('[WSLManager] Killing wsl.exe server process');
      this.serverProcess.kill();
      this.serverProcess = null;
    }

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
    // The server runs as a foreground process (stdout goes to the wsl.exe pipe),
    // so we read from the app's own log file inside the distro.
    // The data dir is a wslpath-converted Windows path (e.g. /mnt/c/.../Quilltap).
    const logPaths: string[] = [];

    // If we know the Windows data dir, convert it to a WSL path for the log
    if (this.dataDir) {
      // wslpath conversion: C:\Users\... → /mnt/c/Users/...
      // Do a quick inline approximation (the real conversion happens in the distro)
      const wslDataDir = this.dataDir
        .replace(/\\/g, '/')
        .replace(/^([A-Za-z]):/, (_m, drive: string) => `/mnt/${drive.toLowerCase()}`);
      logPaths.push(`${wslDataDir}/logs/combined.log`);
    }

    // Fallback paths
    logPaths.push('/data/quilltap/logs/combined.log');

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
