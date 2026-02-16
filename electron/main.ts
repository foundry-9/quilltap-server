import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  HOST_PORT,
  ROOTFS_BUILD_ID_PATH,
  VM_BUILD_ID_PATH,
  SPLASH_WIDTH,
  SPLASH_HEIGHT,
  MAIN_WIDTH,
  MAIN_HEIGHT,
} from './constants';
import { IVMManager, createVMManager } from './vm-manager';
import { LimaManager } from './lima-manager';
import { DownloadManager } from './download-manager';
import { HealthChecker } from './health-checker';
import { SplashUpdate } from './types';

const isDev = !!process.env.ELECTRON_DEV;

/** Root of the app directory (for static files like electron/splash/) */
const appRoot = app.isPackaged
  ? app.getAppPath()
  : path.join(__dirname, '..');

let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let vmManager: IVMManager;
let downloadManager: DownloadManager;
let healthChecker: HealthChecker;
let isQuitting = false;

/** Send an update to the splash screen */
function sendSplashUpdate(update: SplashUpdate): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:update', update);
  }
}

/** Send an error to the splash screen */
function sendSplashError(message: string, canRetry: boolean = true): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:error', {
      phase: 'error' as const,
      message,
      canRetry,
    });
  }
}

/**
 * Extract a user-friendly status message from VM manager output lines.
 * Lima outputs lines like: INFO[0005] Attempting to download the image...
 * WSL outputs progress during import.
 */
function formatVMOutput(line: string): string {
  // Lima log format: INFO[NNNN] message  or  WARN[NNNN] message
  const limaMatch = line.match(/(?:INFO|WARN)\[\d+\]\s+(.+)/);
  if (limaMatch) {
    return limaMatch[1].trim();
  }

  // For WSL or other plain-text output, return it directly if it's short enough
  const cleaned = line.replace(/\0/g, '').trim();
  if (cleaned && cleaned.length <= 120) {
    return cleaned;
  }

  // Truncate overly long lines
  if (cleaned) {
    return cleaned.substring(0, 117) + '...';
  }

  return '';
}

/** Create the splash window */
function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    frame: false,
    resizable: false,
    transparent: false,
    center: true,
    show: false,
    backgroundColor: '#1a1a1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(appRoot, 'electron', 'splash', 'splash.html'));
  win.once('ready-to-show', () => win.show());

  return win;
}

/** Create the main application window */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    show: false,
    title: 'Quilltap',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = isDev
    ? 'http://localhost:3000'
    : `http://localhost:${HOST_PORT}`;

  win.loadURL(url);
  win.once('ready-to-show', () => {
    win.show();

    // Close splash once main window is visible
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

/**
 * Main startup sequence. Orchestrates:
 * 1. System requirements check
 * 2. Rootfs download (if needed)
 * 3. VM creation (if needed)
 * 4. VM start (if needed)
 * 5. Health check polling
 * 6. Main window launch
 */
async function startupSequence(): Promise<void> {
  // In dev mode, skip VM entirely
  if (isDev) {
    sendSplashUpdate({
      phase: 'waiting-health',
      message: 'Connecting to dev server...',
    });

    const status = await healthChecker.waitForHealthy(30, 1000, (s) => {
      sendSplashUpdate({
        phase: 'waiting-health',
        message: `Waiting for dev server... (attempt ${s.attempts})`,
        detail: s.error || '',
      });
    });

    if (status.status === 'healthy' || status.status === 'degraded') {
      mainWindow = createMainWindow();
      return;
    }

    sendSplashError(
      'Could not connect to dev server at localhost:3000. Is "npm run dev" running?',
      true
    );
    return;
  }

  // --- Production / VM mode ---

  // Step 1: Initializing — check platform prerequisites
  sendSplashUpdate({
    phase: 'initializing',
    message: 'Checking system requirements...',
  });

  // Verify platform prerequisites (WSL2 on Windows, CLT + limactl on macOS)
  const prereq = await vmManager.checkPrerequisites();
  if (!prereq.ok) {
    if (prereq.error === 'CLT_MISSING') {
      // Xcode Command Line Tools not installed — offer to install them
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Xcode Command Line Tools Required',
        message: 'Quilltap needs Xcode Command Line Tools to run its virtual machine.',
        detail:
          'Lima requires macOS SDK libraries provided by Xcode Command Line Tools. ' +
          'Click "Install" to open the Apple installer, then click "Retry" in Quilltap after installation completes.',
        buttons: ['Install', 'Quit'],
        defaultId: 0,
        cancelId: 1,
      });

      if (result.response === 0) {
        // Spawn the Apple CLT installer UI
        spawn('xcode-select', ['--install'], { stdio: 'ignore', detached: true }).unref();
        sendSplashError(
          'Installing Xcode Command Line Tools...\n\n' +
          'Complete the Apple installer, then click Retry.',
          true
        );
      } else {
        app.quit();
      }
      return;
    }

    sendSplashError(prereq.error || 'System requirements not met.', false);
    return;
  }

  // Step 2: Check if rootfs needs downloading
  if (downloadManager.needsDownload()) {
    sendSplashUpdate({
      phase: 'downloading',
      message: 'Downloading system image...',
      detail: 'This only happens on first launch',
    });

    try {
      // TODO: Replace with actual GitHub Releases URL when available
      const downloadUrl = process.env.QUILLTAP_ROOTFS_URL || '';
      if (!downloadUrl) {
        sendSplashError(
          'No rootfs tarball found. Please run scripts/build-rootfs.sh first, ' +
          'or set QUILLTAP_ROOTFS_URL to download it automatically.',
          true
        );
        return;
      }

      await downloadManager.download(downloadUrl, (progress) => {
        sendSplashUpdate({
          phase: 'downloading',
          message: 'Downloading system image...',
          progress: progress.percent,
          detail: `${progress.speed} — ${progress.percent}%`,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendSplashError(`Download failed: ${msg}`, true);
      return;
    }
  }

  // Step 3: Check VM status
  sendSplashUpdate({
    phase: 'initializing',
    message: 'Checking virtual machine...',
  });

  const vmStatus = await vmManager.checkStatus();

  // Step 3b: Check if rootfs tarball has been updated since the VM was provisioned
  if (vmStatus.exists) {
    let tarballBuildId = '';
    let vmBuildId = '';
    try { tarballBuildId = fs.readFileSync(ROOTFS_BUILD_ID_PATH, 'utf-8').trim(); } catch { /* missing is fine */ }
    try { vmBuildId = fs.readFileSync(VM_BUILD_ID_PATH, 'utf-8').trim(); } catch { /* missing is fine */ }

    if (tarballBuildId && tarballBuildId !== vmBuildId) {
      console.log(`[Main] Rootfs updated: tarball="${tarballBuildId}" vm="${vmBuildId}" — reprovisioning VM`);
      sendSplashUpdate({
        phase: 'updating-vm',
        message: 'Updating Quilltap to latest build...',
        detail: `New build: ${tarballBuildId}`,
      });

      if (vmStatus.running) {
        await vmManager.stopVM();
      }
      await vmManager.deleteVM();
      vmStatus.exists = false;
      vmStatus.running = false;
    }
  }

  // Step 4: Create VM if it doesn't exist
  if (!vmStatus.exists) {
    sendSplashUpdate({
      phase: 'creating-vm',
      message: 'Creating virtual machine...',
      detail: 'This may take a minute on first launch',
    });

    const createResult = await vmManager.createVM((line) => {
      const detail = formatVMOutput(line);
      if (detail) {
        sendSplashUpdate({
          phase: 'creating-vm',
          message: 'Creating virtual machine...',
          detail,
        });
      }
    });
    if (!createResult.success) {
      // Clear CLT cache so next retry re-checks prerequisites
      if (vmManager instanceof LimaManager) {
        vmManager.clearCLTCache();
      }
      sendSplashError(`Failed to create VM: ${createResult.error}`, true);
      return;
    }

    // Record the tarball build ID so we can detect future updates
    try {
      const tarballBuildId = fs.readFileSync(ROOTFS_BUILD_ID_PATH, 'utf-8').trim();
      if (tarballBuildId) {
        fs.writeFileSync(VM_BUILD_ID_PATH, tarballBuildId, 'utf-8');
        console.log(`[Main] Wrote VM build ID: ${tarballBuildId}`);
      }
    } catch {
      // Non-fatal — build ID marker is best-effort
      console.warn('[Main] Could not write VM build ID marker');
    }
  }

  // Step 5: Start VM if not running
  if (!vmStatus.running) {
    sendSplashUpdate({
      phase: 'starting-vm',
      message: 'Starting virtual machine...',
    });

    const startResult = await vmManager.startVM((line) => {
      const detail = formatVMOutput(line);
      if (detail) {
        sendSplashUpdate({
          phase: 'starting-vm',
          message: 'Starting virtual machine...',
          detail,
        });
      }
    });
    if (!startResult.success) {
      // Clear CLT cache so next retry re-checks prerequisites
      if (vmManager instanceof LimaManager) {
        vmManager.clearCLTCache();
      }
      sendSplashError(`Failed to start VM: ${startResult.error}`, true);
      return;
    }
  }

  // Step 6: Wait for health
  sendSplashUpdate({
    phase: 'waiting-health',
    message: 'Waiting for Quilltap to start...',
  });

  const healthStatus = await healthChecker.waitForHealthy(undefined, undefined, (s) => {
    sendSplashUpdate({
      phase: 'waiting-health',
      message: `Waiting for server... (attempt ${s.attempts})`,
      detail: s.error || '',
    });
  });

  if (healthStatus.status === 'healthy' || healthStatus.status === 'degraded') {
    sendSplashUpdate({
      phase: 'ready',
      message: 'Ready!',
    });

    mainWindow = createMainWindow();
  } else {
    const logs = await vmManager.getLogs(20);
    sendSplashError(
      `Server did not become healthy after ${healthStatus.attempts} attempts.\n\nRecent logs:\n${logs}`,
      true
    );
  }
}

// --- App lifecycle ---

app.whenReady().then(() => {
  vmManager = createVMManager();
  downloadManager = new DownloadManager();
  healthChecker = new HealthChecker();

  splashWindow = createSplashWindow();

  // Wait for splash to load before starting sequence
  splashWindow.webContents.on('did-finish-load', () => {
    startupSequence();
  });
});

// Handle retry from splash screen
ipcMain.on('splash:retry', () => {
  startupSequence();
});

// Handle quit from splash screen
ipcMain.on('splash:quit', () => {
  app.quit();
});

// Graceful shutdown: stop the VM before quitting
app.on('before-quit', async (event) => {
  if (isQuitting || isDev) return;

  isQuitting = true;
  event.preventDefault();

  console.log('[Main] Stopping VM before quit...');
  try {
    await vmManager.stopVM();
  } catch (err) {
    console.error('[Main] Error stopping VM:', err);
  }

  app.quit();
});

// On macOS, quit when all windows closed (not default Electron behavior)
app.on('window-all-closed', () => {
  app.quit();
});
