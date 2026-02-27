import { ChildProcess, spawn, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { APP_VERSION, HOST_PORT } from './constants';

/**
 * Common locations for the Node.js binary on macOS, Linux, and Windows.
 * Packaged Electron apps have a minimal PATH that often excludes
 * /usr/local/bin, nvm directories, etc., so we probe these explicitly.
 */
const NODE_SEARCH_PATHS: string[] = process.platform === 'win32'
  ? [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'nodejs', 'node.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'fnm_multishells'),
  ].filter(Boolean)
  : [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    '/usr/bin/node',
    // nvm typical locations
    path.join(process.env.HOME || '', '.nvm', 'current', 'bin', 'node'),
    // fnm typical location
    path.join(process.env.HOME || '', '.local', 'share', 'fnm', 'aliases', 'default', 'bin', 'node'),
  ];

/**
 * Extra directories to add to PATH when spawning npx commands.
 * Ensures npx and node are findable even under Electron's minimal PATH.
 */
const EXTRA_PATH_DIRS: string[] = process.platform === 'win32'
  ? [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs'),
    path.join(process.env.APPDATA || '', 'npm'),
  ].filter(Boolean)
  : [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    ...(process.env.HOME
      ? [
        path.join(process.env.HOME, '.nvm', 'current', 'bin'),
        path.join(process.env.HOME, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
        path.join(process.env.HOME, '.local', 'bin'),
      ]
      : []),
  ];

/** Minimum supported Node.js major version */
const MIN_NODE_MAJOR = 18;

/**
 * Resolve the full path to the `node` binary.
 * Tries `which node` first, then falls back to well-known install locations.
 */
function resolveNodePath(): string | null {
  // Try `which` first (works when PATH includes node's directory)
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    const result = execFileSync(whichCmd, ['node'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3_000,
      encoding: 'utf-8',
      env: { ...process.env, PATH: buildAugmentedPath() },
    }).trim();
    // `where` on Windows may return multiple lines — take the first
    const firstLine = result.split('\n')[0].trim();
    if (firstLine) return firstLine;
  } catch {
    // which/where failed — try known paths
  }

  for (const candidate of NODE_SEARCH_PATHS) {
    try {
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // Not executable or doesn't exist — continue
    }
  }

  return null;
}

/** Build an augmented PATH that includes common Node.js install directories */
function buildAugmentedPath(): string {
  const currentPath = process.env.PATH || '';
  const pathParts = currentPath.split(path.delimiter);
  const extraDirs = EXTRA_PATH_DIRS.filter(d => !pathParts.includes(d));
  return extraDirs.length > 0
    ? `${currentPath}${path.delimiter}${extraDirs.join(path.delimiter)}`
    : currentPath;
}

/**
 * Manages the Node.js/npx backend process for Quilltap.
 * Spawns `npx quilltap@{version}` as a child process — no VM or container needed.
 */
export class NpxManager {
  private nodePath: string | null = null;
  private childProcess: ChildProcess | null = null;
  private augmentedPath: string;

  constructor() {
    this.augmentedPath = buildAugmentedPath();
    this.nodePath = resolveNodePath();
    console.log('[NpxManager] Resolved node path:', this.nodePath || '(not found)');
  }

  /**
   * Check whether Node.js >= 18 is available on this system.
   * Probes well-known paths since packaged Electron has minimal PATH.
   */
  async isNodeAvailable(): Promise<boolean> {
    if (!this.nodePath) {
      console.log('[NpxManager] Node.js not found on this system');
      return false;
    }

    try {
      const versionOutput = execFileSync(this.nodePath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5_000,
        encoding: 'utf-8',
        env: { ...process.env, PATH: this.augmentedPath },
      }).trim();

      // Parse version string like "v20.11.0"
      const match = versionOutput.match(/^v(\d+)\./);
      if (!match) {
        console.log('[NpxManager] Could not parse Node.js version:', versionOutput);
        return false;
      }

      const major = parseInt(match[1], 10);
      console.log(`[NpxManager] Node.js version: ${versionOutput} (major: ${major})`);

      if (major < MIN_NODE_MAJOR) {
        console.log(`[NpxManager] Node.js ${major} is below minimum required version ${MIN_NODE_MAJOR}`);
        return false;
      }

      return true;
    } catch (err) {
      console.log('[NpxManager] Error checking Node.js version:', err);
      return false;
    }
  }

  /**
   * Start the Quilltap server via npx.
   * Spawns `npx -y quilltap@{APP_VERSION} --port 5050 --data-dir {dataDir}`.
   */
  startServer(
    dataDir: string,
    onOutput?: (line: string) => void,
    onError?: (error: string) => void,
  ): void {
    if (this.childProcess) {
      console.warn('[NpxManager] Server already running — stopping first');
      this.stopServer();
    }

    if (!APP_VERSION) {
      const msg = 'APP_VERSION is not set — cannot determine which quilltap package to run';
      console.error('[NpxManager]', msg);
      if (onError) onError(msg);
      return;
    }

    // Resolve npx path — it's typically alongside node
    const npxName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    let npxPath = npxName;
    if (this.nodePath) {
      const nodeDir = path.dirname(this.nodePath);
      const npxCandidate = path.join(nodeDir, npxName);
      if (fs.existsSync(npxCandidate)) {
        npxPath = npxCandidate;
      }
    }

    const args = [
      '-y',
      `quilltap@${APP_VERSION}`,
      '--port', String(HOST_PORT),
      '--data-dir', dataDir,
    ];

    console.log(`[NpxManager] Spawning: ${npxPath} ${args.join(' ')}`);

    this.childProcess = spawn(npxPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: this.augmentedPath },
      // On Windows, npx.cmd needs shell mode
      shell: process.platform === 'win32',
    });

    this.childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      if (onOutput) {
        text.split('\n').filter(Boolean).forEach(onOutput);
      }
    });

    this.childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      // stderr often contains progress info from npx, not just errors
      if (onOutput) {
        text.split('\n').filter(Boolean).forEach(onOutput);
      }
    });

    this.childProcess.on('error', (err) => {
      console.error('[NpxManager] spawn error:', err.message);
      if (onError) onError(err.message);
      this.childProcess = null;
    });

    this.childProcess.on('close', (code) => {
      console.log(`[NpxManager] Process exited with code ${code}`);
      this.childProcess = null;
    });
  }

  /**
   * Stop the running npx server process.
   * Sends SIGTERM with a 10s timeout, then SIGKILL.
   * On Windows, uses taskkill for process tree cleanup.
   */
  async stopServer(): Promise<void> {
    if (!this.childProcess) {
      console.log('[NpxManager] No server process to stop');
      return;
    }

    const proc = this.childProcess;
    const pid = proc.pid;
    console.log(`[NpxManager] Stopping server (PID: ${pid})...`);

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
          console.warn('[NpxManager] taskkill error:', err);
        }
      } else {
        // Unix: SIGTERM first
        proc.kill('SIGTERM');
      }

      // Force kill after 10 seconds if still running
      setTimeout(() => {
        if (!resolved && proc.pid) {
          console.warn('[NpxManager] Process did not exit after SIGTERM, sending SIGKILL');
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

  /** Check whether the npx server process is currently running */
  isRunning(): boolean {
    return this.childProcess !== null && !this.childProcess.killed;
  }
}
