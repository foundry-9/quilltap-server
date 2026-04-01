/**
 * Workspace Watcher
 *
 * Monitors the workspace directory on the host side for files
 * created or modified by the VM. Applies security protections:
 *
 * 1. Rejects binary executables (ELF, PE, Mach-O)
 * 2. Strips execute bits from all files
 * 3. Applies OS-specific quarantine markers
 *
 * @module electron/workspace-watcher
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { randomUUID } from 'crypto';

// ============================================================================
// Binary Detection (duplicated from lib to avoid Node module resolution issues
// in Electron main process which can't import from @/lib)
// ============================================================================

const MAGIC = {
  ELF: Buffer.from([0x7f, 0x45, 0x4c, 0x46]),
  PE: Buffer.from([0x4d, 0x5a]),
  MACHO_32: Buffer.from([0xfe, 0xed, 0xfa, 0xce]),
  MACHO_64: Buffer.from([0xfe, 0xed, 0xfa, 0xcf]),
  MACHO_FAT: Buffer.from([0xca, 0xfe, 0xba, 0xbe]),
  MACHO_32_REV: Buffer.from([0xce, 0xfa, 0xed, 0xfe]),
  MACHO_64_REV: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]),
};

function isBinaryExecutable(buf: Buffer): boolean {
  if (buf.length < 2) return false;
  if (buf[0] === MAGIC.PE[0] && buf[1] === MAGIC.PE[1]) return true;
  if (buf.length < 4) return false;
  const first4 = buf.subarray(0, 4);
  for (const [name, magic] of Object.entries(MAGIC)) {
    if (name === 'PE') continue;
    if (magic.length === 4 && first4.equals(magic)) return true;
  }
  return false;
}

// ============================================================================
// Quarantine Markers
// ============================================================================

function applyMacOSQuarantine(filePath: string): void {
  try {
    const timestamp = Math.floor(Date.now() / 1000).toString(16);
    const uuid = randomUUID();
    execSync(
      `xattr -w com.apple.quarantine "0083;${timestamp};Quilltap;${uuid}" "${filePath}"`,
      { timeout: 5000 }
    );
  } catch {
    // xattr may fail on some filesystems — non-fatal
  }
}

function applyWindowsZoneIdentifier(filePath: string): void {
  try {
    const adsPath = `${filePath}:Zone.Identifier`;
    fs.writeFileSync(adsPath, '[ZoneTransfer]\nZoneId=3\n', 'utf-8');
  } catch {
    // ADS may not be supported on all filesystems — non-fatal
  }
}

// ============================================================================
// Workspace Watcher
// ============================================================================

export interface WorkspaceWatcherOptions {
  /** Path to the workspace directory to watch */
  workspaceDir: string;
  /** Log function for output */
  log?: (message: string, data?: Record<string, unknown>) => void;
}

export class WorkspaceWatcher {
  private watcher: fs.FSWatcher | null = null;
  private workspaceDir: string;
  private platform: NodeJS.Platform;
  private log: (message: string, data?: Record<string, unknown>) => void;

  constructor(options: WorkspaceWatcherOptions) {
    this.workspaceDir = options.workspaceDir;
    this.platform = process.platform;
    this.log = options.log || ((msg, data) => console.log(`[WorkspaceWatcher] ${msg}`, data || ''));
  }

  /**
   * Start watching the workspace directory
   */
  start(): void {
    // Ensure workspace directory exists
    if (!fs.existsSync(this.workspaceDir)) {
      fs.mkdirSync(this.workspaceDir, { recursive: true });
    }

    this.log('Starting workspace watcher', { dir: this.workspaceDir });

    try {
      this.watcher = fs.watch(this.workspaceDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(this.workspaceDir, filename);
        this.handleFileEvent(eventType, fullPath, filename);
      });

      this.watcher.on('error', (error) => {
        this.log('Watcher error', { error: error.message });
      });
    } catch (error) {
      this.log('Failed to start watcher', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      this.log('Workspace watcher stopped');
    }
  }

  /**
   * Handle a file system event
   */
  private handleFileEvent(eventType: string, fullPath: string, filename: string): void {
    // Only process actual files (not directory events)
    try {
      const stats = fs.statSync(fullPath);
      if (!stats.isFile()) return;
    } catch {
      // File may have been deleted already
      return;
    }

    // Step 1: Check for binary executable
    try {
      const fd = fs.openSync(fullPath, 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);

      if (isBinaryExecutable(buf)) {
        this.log('Binary executable detected, deleting', {
          file: filename,
          direction: 'vm-to-host',
          filterResult: 'rejected',
        });
        fs.unlinkSync(fullPath);
        return;
      }
    } catch {
      // Could not read file — skip binary check
    }

    // Step 2: Strip execute bits
    try {
      const stats = fs.statSync(fullPath);
      const newMode = stats.mode & ~0o111;
      if (newMode !== stats.mode) {
        fs.chmodSync(fullPath, newMode);
      }
    } catch {
      // chmod may fail — non-fatal
    }

    // Step 3: Apply OS quarantine markers
    if (this.platform === 'darwin') {
      applyMacOSQuarantine(fullPath);
    } else if (this.platform === 'win32') {
      applyWindowsZoneIdentifier(fullPath);
    }
    // Linux: execute bits already stripped, no additional markers

    this.log('File processed', {
      file: filename,
      direction: 'vm-to-host',
      timestamp: new Date().toISOString(),
      filterResult: 'allowed',
    });
  }
}
