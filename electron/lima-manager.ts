import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import {
  LIMA_HOME,
  LIMA_BINARY_NAME,
  CLT_VERIFIED_MARKER,
  DEFAULT_DATA_DIR,
  VM_CREATE_TIMEOUT_S,
  VM_START_TIMEOUT_S,
  VM_STOP_TIMEOUT_S,
  vmNameForDir,
  DIR_MAP_PATH,
} from './constants';
import { VMStatus, CommandResult } from './types';
import { IVMManager } from './vm-manager';
import { dirSize } from './disk-utils';

/**
 * Manages per-directory Lima VM lifecycle: create, start, stop, delete, and status checks.
 * macOS-only implementation using the Lima hypervisor.
 *
 * Each data directory gets its own VM named `quilltap-<hash>` so that switching
 * directories only requires stop + start (no delete + recreate).
 */
export class LimaManager implements IVMManager {
  private limaPath: string;
  private templatePath: string;
  private dataDir: string;
  private vmName: string;

  constructor() {
    const resourcesPath = app.isPackaged
      ? process.resourcesPath
      : path.join(__dirname, '..');

    // Bundled limactl binary (packaged) or system limactl (dev)
    const bundledLima = path.join(resourcesPath, 'lima', 'bin', LIMA_BINARY_NAME);
    this.limaPath = fs.existsSync(bundledLima)
      ? bundledLima
      : LIMA_BINARY_NAME; // fall back to PATH

    // Lima template YAML
    this.templatePath = app.isPackaged
      ? path.join(resourcesPath, 'lima', 'quilltap.yaml')
      : path.join(__dirname, '..', 'lima', 'quilltap.yaml');

    // Default data directory and derived VM name
    this.dataDir = DEFAULT_DATA_DIR;
    this.vmName = vmNameForDir(this.dataDir);
  }

  /** Set the host-side data directory for the VM mount */
  setDataDir(hostPath: string): void {
    console.log('[LimaManager] Data directory set to:', hostPath);
    this.dataDir = hostPath;
    this.vmName = vmNameForDir(hostPath);
    console.log('[LimaManager] VM name for directory:', this.vmName);
    this.updateDirMap();
  }

  /** Get the currently configured data directory */
  getDataDir(): string {
    return this.dataDir;
  }

  /** Get the VM name for the current data directory */
  getVMName(): string {
    return this.vmName;
  }

  /** Get the disk size of the VM directory in bytes */
  async getVMDiskSize(): Promise<number> {
    const vmDir = path.join(LIMA_HOME, this.vmName);
    return dirSize(vmDir);
  }

  /** Get the disk size of the data directory in bytes */
  async getDataDirDiskSize(): Promise<number> {
    return dirSize(this.dataDir);
  }

  /** Verify that Xcode CLT and limactl are available */
  async checkPrerequisites(): Promise<{ ok: boolean; error?: string }> {
    // Step 1: Check for Xcode Command Line Tools
    const cltOk = await this.verifyCLT();
    if (!cltOk) {
      console.log('[LimaManager] Xcode Command Line Tools not found');
      return { ok: false, error: 'CLT_MISSING' };
    }

    // Step 2: Check limactl
    const result = await this.exec(['--version'], 10);
    if (result.success) {
      console.log('[LimaManager] Prerequisites OK:', result.stdout.trim());
      return { ok: true };
    }
    return {
      ok: false,
      error: 'Lima is not installed or not found. Please install Lima (https://lima-vm.io).',
    };
  }

  /**
   * Verify Xcode Command Line Tools are installed.
   * Uses a cached marker file to avoid running xcode-select on every launch.
   */
  private async verifyCLT(): Promise<boolean> {
    // Check cached marker first
    if (fs.existsSync(CLT_VERIFIED_MARKER)) {
      console.log('[LimaManager] CLT verified (cached)');
      return true;
    }

    // Run xcode-select -p to check for CLT
    return new Promise((resolve) => {
      const child = spawn('xcode-select', ['-p'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      });

      child.on('close', (code) => {
        if (code === 0) {
          // Write marker file with timestamp
          try {
            fs.mkdirSync(path.dirname(CLT_VERIFIED_MARKER), { recursive: true });
            fs.writeFileSync(CLT_VERIFIED_MARKER, new Date().toISOString(), 'utf-8');
            console.log('[LimaManager] CLT verified, marker written');
          } catch (err) {
            console.warn('[LimaManager] Could not write CLT marker:', err);
          }
          resolve(true);
        } else {
          resolve(false);
        }
      });

      child.on('error', () => {
        resolve(false);
      });
    });
  }

  /** Clear the CLT verification cache, forcing a re-check on next startup */
  clearCLTCache(): void {
    try {
      if (fs.existsSync(CLT_VERIFIED_MARKER)) {
        fs.unlinkSync(CLT_VERIFIED_MARKER);
        console.log('[LimaManager] CLT cache cleared');
      }
    } catch (err) {
      console.warn('[LimaManager] Could not clear CLT cache:', err);
    }
  }

  /** Environment variables applied to every limactl spawn */
  private get env(): NodeJS.ProcessEnv {
    const resourcesPath = app.isPackaged
      ? process.resourcesPath
      : path.join(__dirname, '..');
    const limaDir = path.join(resourcesPath, 'lima', 'bin');

    return {
      ...process.env,
      LIMA_HOME,
      PATH: `${limaDir}:${process.env.PATH}`,
    };
  }

  /** Execute a limactl command and capture output */
  private exec(args: string[], timeoutS: number, onOutput?: (line: string) => void): Promise<CommandResult> {
    return new Promise((resolve) => {
      const child = spawn(this.limaPath, args, {
        env: this.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutS * 1000,
      });

      let stdout = '';
      let stderr = '';
      let stderrBuf = '';

      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;

        if (onOutput) {
          stderrBuf += chunk;
          const lines = stderrBuf.split('\n');
          // Keep the last incomplete line in the buffer
          stderrBuf = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) onOutput(trimmed);
          }
        }
      });

      child.on('close', (code) => {
        // Flush any remaining buffered output
        if (onOutput && stderrBuf.trim()) {
          onOutput(stderrBuf.trim());
        }

        if (code === 0) {
          resolve({ success: true, stdout, stderr });
        } else {
          resolve({
            success: false,
            stdout,
            stderr,
            error: `limactl exited with code ${code}: ${stderr.trim() || stdout.trim()}`,
          });
        }
      });

      child.on('error', (err) => {
        resolve({
          success: false,
          stdout,
          stderr,
          error: `Failed to spawn limactl: ${err.message}`,
        });
      });
    });
  }

  /** Check if the VM for the current data directory exists and whether it's running */
  async checkStatus(): Promise<VMStatus> {
    const result = await this.exec(['list', '--json'], 30);

    if (!result.success) {
      return { exists: false, running: false, message: result.error || 'Failed to list VMs' };
    }

    try {
      // limactl list --json outputs one JSON object per line
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const vm = JSON.parse(line);
        if (vm.name === this.vmName) {
          const running = vm.status === 'Running';
          return {
            exists: true,
            running,
            message: `VM ${this.vmName} exists, status: ${vm.status}`,
          };
        }
      }
      return { exists: false, running: false, message: `VM ${this.vmName} not found` };
    } catch {
      return { exists: false, running: false, message: 'Failed to parse limactl output' };
    }
  }

  /**
   * Stop any other running quilltap-* VM to prevent port conflicts on host:5050.
   * Called before starting the current VM.
   */
  async stopOtherRunningVMs(): Promise<void> {
    const result = await this.exec(['list', '--json'], 30);
    if (!result.success) return;

    try {
      const lines = result.stdout.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const vm = JSON.parse(line);
        if (
          vm.name !== this.vmName &&
          vm.name.startsWith('quilltap-') &&
          vm.status === 'Running'
        ) {
          console.log(`[LimaManager] Stopping other running VM: ${vm.name}`);
          await this.exec(['stop', vm.name], VM_STOP_TIMEOUT_S);
        }
      }
    } catch (err) {
      console.warn('[LimaManager] Error checking for other running VMs:', err);
    }
  }

  /**
   * Generate a modified YAML template with the configured data directory.
   * Copies the base template and replaces the mount location.
   * Returns the path to the generated file.
   */
  private generateModifiedTemplate(): string {
    const content = fs.readFileSync(this.templatePath, 'utf-8');

    // Replace the data mount location line
    // The template has:  - location: "~/Library/Application Support/Quilltap"
    const modified = content.replace(
      /(-\s*location:\s*)"[^"]*"(\s*\n\s*mountPoint:\s*"?\/data\/quilltap)/,
      `$1"${this.dataDir}"$2`
    );

    // Write to a temp file in LIMA_HOME
    fs.mkdirSync(LIMA_HOME, { recursive: true });
    const tempPath = path.join(LIMA_HOME, `${this.vmName}-generated.yaml`);
    fs.writeFileSync(tempPath, modified, 'utf-8');
    console.log('[LimaManager] Generated modified template at', tempPath, 'with dataDir:', this.dataDir);
    return tempPath;
  }

  /** Create the VM from the template (using modified template with configured data dir) */
  async createVM(onOutput?: (line: string) => void): Promise<CommandResult> {
    const templateToUse = this.generateModifiedTemplate();
    console.log('[LimaManager] Creating VM', this.vmName, 'from template:', templateToUse);
    return this.exec(
      ['create', '--name', this.vmName, templateToUse],
      VM_CREATE_TIMEOUT_S,
      onOutput
    );
  }

  /** Start an existing VM (stops any other quilltap-* VM first) */
  async startVM(onOutput?: (line: string) => void): Promise<CommandResult> {
    // Prevent port conflicts: stop any other running quilltap-* VMs
    await this.stopOtherRunningVMs();

    console.log('[LimaManager] Starting VM:', this.vmName);
    return this.exec(['start', this.vmName], VM_START_TIMEOUT_S, onOutput);
  }

  /** Stop a running VM */
  async stopVM(): Promise<CommandResult> {
    console.log('[LimaManager] Stopping VM:', this.vmName);
    return this.exec(['stop', this.vmName], VM_STOP_TIMEOUT_S);
  }

  /** Force-delete the VM */
  async deleteVM(): Promise<CommandResult> {
    console.log('[LimaManager] Deleting VM:', this.vmName);
    return this.exec(['delete', '--force', this.vmName], VM_STOP_TIMEOUT_S);
  }

  /** Read recent VM logs for debugging */
  async getLogs(lines: number = 50): Promise<string> {
    const logPath = path.join(LIMA_HOME, this.vmName, 'serial.log');
    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      return 'No logs available';
    }
  }

  /**
   * Update the dir-map JSON file that maps VM names to data directory paths.
   * This is purely for debugging/discovery — not used at runtime.
   */
  private updateDirMap(): void {
    try {
      let map: Record<string, string> = {};
      if (fs.existsSync(DIR_MAP_PATH)) {
        map = JSON.parse(fs.readFileSync(DIR_MAP_PATH, 'utf-8'));
      }
      map[this.vmName] = this.dataDir;
      fs.mkdirSync(path.dirname(DIR_MAP_PATH), { recursive: true });
      fs.writeFileSync(DIR_MAP_PATH, JSON.stringify(map, null, 2), 'utf-8');
      console.log('[LimaManager] Updated dir-map:', this.vmName, '->', this.dataDir);
    } catch (err) {
      console.warn('[LimaManager] Could not update dir-map:', err);
    }
  }
}
