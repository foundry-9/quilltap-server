import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import {
  LIMA_HOME,
  VM_NAME,
  LIMA_BINARY_NAME,
  CLT_VERIFIED_MARKER,
  DEFAULT_DATA_DIR,
  VM_CREATE_TIMEOUT_S,
  VM_START_TIMEOUT_S,
  VM_STOP_TIMEOUT_S,
} from './constants';
import { VMStatus, CommandResult } from './types';
import { IVMManager } from './vm-manager';

/**
 * Manages the Lima VM lifecycle: create, start, stop, delete, and status checks.
 * macOS-only implementation using the Lima hypervisor.
 */
export class LimaManager implements IVMManager {
  private limaPath: string;
  private templatePath: string;
  private dataDir: string;

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

    // Default data directory
    this.dataDir = DEFAULT_DATA_DIR;
  }

  /** Set the host-side data directory for the VM mount */
  setDataDir(hostPath: string): void {
    console.log('[LimaManager] Data directory set to:', hostPath);
    this.dataDir = hostPath;
  }

  /** Get the currently configured data directory */
  getDataDir(): string {
    return this.dataDir;
  }

  /**
   * Check if the running VM's mounted data directory matches the configured one.
   * Reads the instance YAML to compare mount locations.
   */
  async dataDirMatchesVM(): Promise<boolean> {
    const instanceYaml = path.join(LIMA_HOME, VM_NAME, 'lima.yaml');
    try {
      if (!fs.existsSync(instanceYaml)) {
        console.log('[LimaManager] No instance YAML found — no VM to compare');
        return true; // No VM exists, so no mismatch
      }

      const content = fs.readFileSync(instanceYaml, 'utf-8');
      // Look for the mount location line that maps to /data/quilltap
      // The YAML has:  - location: "~/Library/Application Support/Quilltap"
      //                  mountPoint: "/data/quilltap"
      const mountMatch = content.match(/location:\s*"?([^"\n]+)"?\s*\n\s*mountPoint:\s*"?\/data\/quilltap/);
      if (!mountMatch) {
        console.log('[LimaManager] Could not find data mount in instance YAML');
        return false;
      }

      const vmMountPath = mountMatch[1].trim();
      // Resolve ~ to homedir for comparison
      const resolvedVmPath = vmMountPath.startsWith('~/')
        ? path.join(require('os').homedir(), vmMountPath.slice(2))
        : vmMountPath;
      const resolvedDataDir = this.dataDir.startsWith('~/')
        ? path.join(require('os').homedir(), this.dataDir.slice(2))
        : this.dataDir;

      const matches = resolvedVmPath === resolvedDataDir;
      console.log(`[LimaManager] VM mount="${resolvedVmPath}" configured="${resolvedDataDir}" matches=${matches}`);
      return matches;
    } catch (err) {
      console.warn('[LimaManager] Error checking VM data dir:', err);
      return false;
    }
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

  /** Check if the VM exists and whether it's running */
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
        if (vm.name === VM_NAME) {
          const running = vm.status === 'Running';
          return {
            exists: true,
            running,
            message: `VM ${VM_NAME} exists, status: ${vm.status}`,
          };
        }
      }
      return { exists: false, running: false, message: `VM ${VM_NAME} not found` };
    } catch {
      return { exists: false, running: false, message: 'Failed to parse limactl output' };
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
    const tempPath = path.join(LIMA_HOME, 'quilltap-generated.yaml');
    fs.writeFileSync(tempPath, modified, 'utf-8');
    console.log('[LimaManager] Generated modified template at', tempPath, 'with dataDir:', this.dataDir);
    return tempPath;
  }

  /** Create the VM from the template (using modified template with configured data dir) */
  async createVM(onOutput?: (line: string) => void): Promise<CommandResult> {
    const templateToUse = this.generateModifiedTemplate();
    console.log('[LimaManager] Creating VM from template:', templateToUse);
    return this.exec(
      ['create', '--name', VM_NAME, templateToUse],
      VM_CREATE_TIMEOUT_S,
      onOutput
    );
  }

  /** Start an existing VM */
  async startVM(onOutput?: (line: string) => void): Promise<CommandResult> {
    console.log('[LimaManager] Starting VM:', VM_NAME);
    return this.exec(['start', VM_NAME], VM_START_TIMEOUT_S, onOutput);
  }

  /** Stop a running VM */
  async stopVM(): Promise<CommandResult> {
    console.log('[LimaManager] Stopping VM:', VM_NAME);
    return this.exec(['stop', VM_NAME], VM_STOP_TIMEOUT_S);
  }

  /** Force-delete the VM */
  async deleteVM(): Promise<CommandResult> {
    console.log('[LimaManager] Deleting VM:', VM_NAME);
    return this.exec(['delete', '--force', VM_NAME], VM_STOP_TIMEOUT_S);
  }

  /** Read recent VM logs for debugging */
  async getLogs(lines: number = 50): Promise<string> {
    const logPath = path.join(LIMA_HOME, VM_NAME, 'serial.log');
    try {
      const content = fs.readFileSync(logPath, 'utf-8');
      const allLines = content.split('\n');
      return allLines.slice(-lines).join('\n');
    } catch {
      return 'No logs available';
    }
  }
}
