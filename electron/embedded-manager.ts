import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { HOST_PORT } from './constants';

/**
 * Resolve the path to the Next.js standalone server.js.
 *
 * - **Dev mode** (`ELECTRON_DEV`): not used — dev connects directly to localhost:3000
 * - **Packaged app**: `<resourcesPath>/server/server.js`
 * - **Local build testing**: `.next/standalone/server.js` from project root
 */
function resolveServerPath(): string {
  // Packaged Electron app — electron-builder copies standalone into resources/server/
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, 'server', 'server.js');
    if (fs.existsSync(packaged)) {
      return packaged;
    }
  }

  // Local / CI testing — use the Next.js standalone output directly
  const projectRoot = path.join(__dirname, '..');
  const local = path.join(projectRoot, '.next', 'standalone', 'server.js');
  if (fs.existsSync(local)) {
    return local;
  }

  throw new Error(
    'Could not find server.js. Build the standalone output first (next build) ' +
    'or package the Electron app with electron-builder.'
  );
}

/**
 * Manages the embedded Quilltap server process.
 * Uses Electron's own Node.js runtime (via ELECTRON_RUN_AS_NODE=1) to run
 * the Next.js standalone server.js directly — no system Node.js required.
 */
export class EmbeddedManager {
  private childProcess: ChildProcess | null = null;

  constructor() {
    console.log('[EmbeddedManager] Initialized — will use Electron Node.js runtime');
  }

  /**
   * Start the Quilltap server using Electron's bundled Node.js.
   * Spawns `process.execPath` with ELECTRON_RUN_AS_NODE=1 to run server.js.
   */
  startServer(
    dataDir: string,
    onOutput?: (line: string) => void,
    onError?: (error: string) => void,
  ): void {
    if (this.childProcess) {
      console.warn('[EmbeddedManager] Server already running — stopping first');
      this.stopServer();
    }

    let serverPath: string;
    try {
      serverPath = resolveServerPath();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[EmbeddedManager]', msg);
      if (onError) onError(msg);
      return;
    }

    console.log(`[EmbeddedManager] Spawning: ${process.execPath} ${serverPath}`);
    console.log(`[EmbeddedManager] Data dir: ${dataDir}`);

    // Detect the host OS timezone to pass through to the server
    const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    this.childProcess = spawn(process.execPath, [serverPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        // ELECTRON_RUN_AS_NODE makes Electron's binary behave as plain Node.js
        ELECTRON_RUN_AS_NODE: '1',
        // Server configuration
        PORT: String(HOST_PORT),
        HOSTNAME: '0.0.0.0',
        NODE_ENV: 'production',
        QUILLTAP_DATA_DIR: dataDir,
        QUILLTAP_TIMEZONE: hostTimezone,
        NODE_OPTIONS: '--max-old-space-size=2048',
        // Preserve PATH for native module resolution
        PATH: process.env.PATH || '',
        // Preserve HOME for various lookups
        HOME: process.env.HOME || '',
        USERPROFILE: process.env.USERPROFILE || '',
        APPDATA: process.env.APPDATA || '',
        LOCALAPPDATA: process.env.LOCALAPPDATA || '',
        // Preserve temp directory
        TMPDIR: process.env.TMPDIR || '',
        TEMP: process.env.TEMP || '',
        TMP: process.env.TMP || '',
      },
      // Set cwd to the server directory so relative paths in server.js resolve correctly
      cwd: path.dirname(serverPath),
    });

    this.childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (onOutput) {
        text.split('\n').filter(Boolean).forEach(onOutput);
      }
    });

    this.childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (onOutput) {
        text.split('\n').filter(Boolean).forEach(onOutput);
      }
    });

    this.childProcess.on('error', (err) => {
      console.error('[EmbeddedManager] spawn error:', err.message);
      if (onError) onError(err.message);
      this.childProcess = null;
    });

    this.childProcess.on('close', (code) => {
      console.log(`[EmbeddedManager] Process exited with code ${code}`);
      this.childProcess = null;
    });
  }

  /**
   * Stop the running embedded server process.
   * Sends SIGTERM with a 10s timeout, then SIGKILL.
   * On Windows, uses taskkill for process tree cleanup.
   */
  async stopServer(): Promise<void> {
    if (!this.childProcess) {
      console.log('[EmbeddedManager] No server process to stop');
      return;
    }

    const proc = this.childProcess;
    const pid = proc.pid;
    console.log(`[EmbeddedManager] Stopping server (PID: ${pid})...`);

    return new Promise<void>((resolve) => {
      let resolved = false;

      const finish = () => {
        if (!resolved) {
          resolved = true;
          this.childProcess = null;
          resolve();
        }
      };

      // Listen for process exit
      proc.once('close', finish);

      if (process.platform === 'win32' && pid) {
        // Windows: use taskkill to kill the process tree
        try {
          spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
            stdio: 'ignore',
          });
        } catch (err) {
          console.warn('[EmbeddedManager] taskkill error:', err);
        }
      } else {
        // Unix: SIGTERM first
        proc.kill('SIGTERM');
      }

      // Force kill after 10 seconds if still running
      setTimeout(() => {
        if (!resolved && proc.pid) {
          console.warn('[EmbeddedManager] Process did not exit after SIGTERM, sending SIGKILL');
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process may have already exited
          }
        }
        // Resolve regardless after timeout
        setTimeout(finish, 1000);
      }, 10_000);
    });
  }

  /** Check whether the embedded server process is currently running */
  isRunning(): boolean {
    return this.childProcess !== null && !this.childProcess.killed;
  }
}
