import { spawn, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  DOCKER_IMAGE,
  DOCKER_CONTAINER_PORT,
  HOST_PORT,
  APP_VERSION,
  vmNameForDir,
} from './constants';
import { CommandResult } from './types';

/**
 * Common locations for the Docker CLI binary on macOS and Linux.
 * Packaged Electron apps have a minimal PATH that often excludes
 * /usr/local/bin and /opt/homebrew/bin, so we probe these explicitly.
 */
const DOCKER_SEARCH_PATHS = [
  '/usr/local/bin/docker',
  '/opt/homebrew/bin/docker',
  '/usr/bin/docker',
  '/snap/bin/docker',
];

/**
 * Extra directories to add to PATH when spawning Docker commands.
 * Docker invokes credential helpers (e.g. docker-credential-osxkeychain on macOS,
 * docker-credential-wincred on Windows) as subprocesses, and those helpers
 * won't be found under the minimal PATH that packaged Electron apps inherit.
 */
const EXTRA_PATH_DIRS: string[] = process.platform === 'win32'
  ? [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin'),
    path.join(process.env.ProgramW6432 || 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin'),
    path.join(process.env.LOCALAPPDATA || '', 'Docker', 'wsl', 'docker-credential-wincred'),
  ].filter(Boolean)
  : [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/snap/bin',
  ];

/**
 * Resolve the full path to the `docker` CLI binary.
 * Tries `which docker` first (works in dev / when PATH is correct),
 * then falls back to well-known install locations.
 */
function resolveDockerPath(): string {
  // Try `which` first — works when PATH includes docker's directory
  try {
    const result = execFileSync('which', ['docker'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3_000,
      encoding: 'utf-8',
    }).trim();
    if (result) return result;
  } catch {
    // which failed — try known paths
  }

  for (const candidate of DOCKER_SEARCH_PATHS) {
    try {
      if (fs.existsSync(candidate)) {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      }
    } catch {
      // Not executable or doesn't exist — continue
    }
  }

  // Last resort — hope it's on PATH at runtime
  return 'docker';
}

/**
 * Manages Docker container lifecycle for Quilltap.
 * Alternative to Lima/WSL2 VM backends — uses Docker Desktop or Engine.
 */
export class DockerManager {
  private dockerPath: string;
  private dataDir: string = '';
  private containerName: string = '';

  constructor() {
    this.dockerPath = resolveDockerPath();
    console.log('[DockerManager] Resolved docker CLI path:', this.dockerPath);
  }

  /** Check whether the `docker` CLI is available */
  async isDockerAvailable(): Promise<boolean> {
    try {
      const result = await this.exec(['--version'], 5_000);
      console.log('[DockerManager] Docker version:', result.stdout.trim());
      return result.success;
    } catch {
      console.log('[DockerManager] Docker CLI not found');
      return false;
    }
  }

  /** Set the data directory and derive the container name */
  setDataDir(hostPath: string): void {
    console.log('[DockerManager] Data directory set to:', hostPath);
    this.dataDir = hostPath;
    this.containerName = vmNameForDir(hostPath);
    console.log('[DockerManager] Container name:', this.containerName);
  }

  /** Get the container name for the current data directory */
  getContainerName(): string {
    return this.containerName;
  }

  /** Check whether an image exists locally */
  async imageExistsLocally(tag: string): Promise<boolean> {
    const result = await this.exec(['image', 'inspect', `${DOCKER_IMAGE}:${tag}`], 10_000);
    return result.success;
  }

  /** Pull a Docker image, streaming output line-by-line */
  async pullImage(tag: string, onOutput?: (line: string) => void): Promise<CommandResult> {
    const imageRef = `${DOCKER_IMAGE}:${tag}`;
    console.log('[DockerManager] Pulling image:', imageRef);
    return this.exec(['pull', imageRef], 600_000, onOutput);
  }

  /**
   * Start a container with the configured data directory mounted.
   * Cleans up any existing container with the same name first.
   */
  async startContainer(onOutput?: (line: string) => void): Promise<CommandResult> {
    if (!this.dataDir) {
      return { success: false, stdout: '', stderr: '', error: 'No data directory set' };
    }

    // Clean up any existing container with this name
    await this.exec(['rm', '-f', this.containerName], 10_000);

    // Always use the version-specific image tag — no fallback to latest
    if (!APP_VERSION) {
      return { success: false, stdout: '', stderr: '', error: 'APP_VERSION is not set — cannot determine which Docker image to run' };
    }
    const imageTag = APP_VERSION;

    const imageRef = `${DOCKER_IMAGE}:${imageTag}`;
    console.log('[DockerManager] Starting container:', this.containerName, 'from', imageRef);

    const args = [
      'run', '-d',
      '--name', this.containerName,
      '-p', `${HOST_PORT}:${DOCKER_CONTAINER_PORT}`,
      '-v', `${this.dataDir}:/app/quilltap`,
      '-e', `QUILLTAP_HOST_DATA_DIR=${this.dataDir}`,
      imageRef,
    ];

    return this.exec(args, 60_000, onOutput);
  }

  /** Stop and remove the current container */
  async stopContainer(): Promise<CommandResult> {
    if (!this.containerName) {
      return { success: true, stdout: '', stderr: '', error: undefined };
    }

    console.log('[DockerManager] Stopping container:', this.containerName);

    // Stop gracefully (10s timeout built into docker stop)
    await this.exec(['stop', this.containerName], 30_000);

    // Remove the container
    return this.exec(['rm', '-f', this.containerName], 10_000);
  }

  /** Stop and remove a container for a specific data directory */
  async deleteContainerForDir(dirPath: string): Promise<void> {
    const name = vmNameForDir(dirPath);
    console.log('[DockerManager] Deleting container for dir:', dirPath, '→', name);

    await this.exec(['stop', name], 30_000);
    await this.exec(['rm', '-f', name], 10_000);
  }

  /** Get recent container logs */
  async getLogs(lines: number = 50): Promise<string> {
    if (!this.containerName) return '';

    const result = await this.exec(['logs', '--tail', String(lines), this.containerName], 10_000);
    return result.success ? result.stdout : result.stderr;
  }

  /**
   * Execute a docker CLI command.
   * Returns a CommandResult with stdout/stderr captured.
   */
  private exec(
    args: string[],
    timeout: number = 30_000,
    onOutput?: (line: string) => void,
  ): Promise<CommandResult> {
    return new Promise((resolve) => {
      console.log('[DockerManager] exec:', this.dockerPath, args.join(' '));

      // Augment PATH so Docker can find credential helpers
      // (e.g. docker-credential-osxkeychain on macOS, docker-credential-wincred on Windows)
      const currentPath = process.env.PATH || '';
      const pathParts = currentPath.split(path.delimiter);
      const extraDirs = EXTRA_PATH_DIRS.filter(d => !pathParts.includes(d));
      const augmentedPath = extraDirs.length > 0
        ? `${currentPath}${path.delimiter}${extraDirs.join(path.delimiter)}`
        : currentPath;

      const proc = spawn(this.dockerPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout,
        env: { ...process.env, PATH: augmentedPath },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        stdout += text;
        if (onOutput) {
          text.split('\n').filter(Boolean).forEach(onOutput);
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        stderr += text;
        if (onOutput) {
          text.split('\n').filter(Boolean).forEach(onOutput);
        }
      });

      proc.on('error', (err) => {
        console.error('[DockerManager] spawn error:', err.message);
        resolve({
          success: false,
          stdout,
          stderr,
          error: err.message,
        });
      });

      proc.on('close', (code) => {
        const success = code === 0;
        if (!success) {
          console.warn(`[DockerManager] docker ${args[0]} exited with code ${code}`);
        }
        resolve({ success, stdout, stderr, error: success ? undefined : stderr.trim() || `Exit code ${code}` });
      });
    });
  }
}
