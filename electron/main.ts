import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  HOST_PORT,
  LIMA_HOME,
  ROOTFS_BUILD_ID_PATH,
  SPLASH_WIDTH,
  SPLASH_HEIGHT,
  MAIN_WIDTH,
  MAIN_HEIGHT,
  vmBuildIdPath,
} from './constants';
import { IVMManager, createVMManager } from './vm-manager';
import { LimaManager } from './lima-manager';
import { DownloadManager } from './download-manager';
import { HealthChecker } from './health-checker';
import { SplashUpdate, DirectoryInfo, DirectorySizeInfo, DetailLevel } from './types';
import { AppSettings, loadSettings, saveSettings } from './settings';
import { getSizesForDir } from './disk-utils';

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
let appSettings: AppSettings;

/** Whether we're in the auto-start countdown (can be interrupted) */
let autoStartPending = false;

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

/** Send directory info to splash screen (two-phase: immediate with empty sizes, then async with real sizes) */
function sendDirectoryInfo(): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;

  // Phase 1: Send immediately with empty sizes so UI renders fast
  const info: DirectoryInfo = {
    dirs: appSettings.knownDataDirs,
    lastUsed: appSettings.lastDataDir,
    autoStart: appSettings.autoStart,
    sizes: {},
  };
  splashWindow.webContents.send('splash:directories', info);

  // Phase 2: Calculate sizes async in background, send update when done
  calculateDirectorySizes().then((sizes) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      const updated: DirectoryInfo = {
        dirs: appSettings.knownDataDirs,
        lastUsed: appSettings.lastDataDir,
        autoStart: appSettings.autoStart,
        sizes,
      };
      splashWindow.webContents.send('splash:directories', updated);
    }
  });
}

/** Calculate disk sizes for all known data directories */
async function calculateDirectorySizes(): Promise<Record<string, DirectorySizeInfo>> {
  const sizes: Record<string, DirectorySizeInfo> = {};
  for (const dir of appSettings.knownDataDirs) {
    try {
      sizes[dir] = getSizesForDir(dir);
    } catch (err) {
      console.warn('[Main] Error calculating size for', dir, err);
      sizes[dir] = { dataSize: -1, vmSize: -1 };
    }
  }
  return sizes;
}

/**
 * Migrate the legacy single-VM "quilltap" instance to per-directory VMs.
 * On first launch after upgrade, if ~/.qtlima/quilltap/ exists (old single VM),
 * stop and delete it. The new per-directory VM will be created by the normal flow.
 */
async function migrateLegacyVM(): Promise<void> {
  if (process.platform !== 'darwin') return;

  const legacyVmDir = path.join(LIMA_HOME, 'quilltap');
  if (!fs.existsSync(legacyVmDir)) return;

  console.log('[Main] Legacy single-VM detected at', legacyVmDir, '— migrating to per-directory VMs');

  // Use the VM manager's exec capabilities to stop and delete the legacy VM.
  // We temporarily need to interact with the old "quilltap" name.
  // The safest way is to use limactl directly.
  try {
    const { execSync } = require('child_process');
    const env = { ...process.env, LIMA_HOME };

    // Try to stop it if running (ignore errors — it may already be stopped)
    try {
      execSync('limactl stop quilltap', { env, timeout: 60_000, stdio: 'pipe' });
      console.log('[Main] Legacy VM stopped');
    } catch {
      console.log('[Main] Legacy VM was not running (or stop failed — proceeding with delete)');
    }

    // Delete the legacy VM
    try {
      execSync('limactl delete --force quilltap', { env, timeout: 60_000, stdio: 'pipe' });
      console.log('[Main] Legacy VM deleted successfully');
    } catch (err) {
      console.warn('[Main] Could not delete legacy VM via limactl, removing directory directly:', err);
      // Fallback: remove the directory directly
      fs.rmSync(legacyVmDir, { recursive: true, force: true });
      console.log('[Main] Legacy VM directory removed');
    }
  } catch (err) {
    console.error('[Main] Legacy VM migration error:', err);
    // Non-fatal — the old VM directory just takes up space
  }
}

/**
 * Extract a user-friendly status message and log level from VM manager output lines.
 *
 * Lima (logrus key=value text format):
 *   time="2026-02-16T07:43:47-06:00" level=info msg="[hostagent] [VZ] - vm state change: running"
 *   — We extract the msg= value and the level= value.
 *
 * Lima (short logrus format, some operations):
 *   INFO[0005] Attempting to download the image  from="https://..." digest="sha256:..."
 *
 * Lima (JSON format, if configured):
 *   {"level":"info","msg":"Starting the VM","time":"..."}
 *
 * WSL outputs plain-text progress during import.
 */
function formatVMOutput(line: string): { message: string; level: DetailLevel } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Try JSON format first: {"level":"info","msg":"..."}
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.msg) {
        return { message: truncate(parsed.msg), level: toDetailLevel(parsed.level) };
      }
    } catch {
      // Not valid JSON — fall through
    }
  }

  // Logrus key=value text format: time="..." level=info msg="..."
  const msgMatch = trimmed.match(/\bmsg="((?:[^"\\]|\\.)*)"/);
  if (msgMatch) {
    const msg = msgMatch[1].replace(/\\"/g, '"');
    const levelMatch = trimmed.match(/\blevel=(\w+)/);
    const level = levelMatch ? toDetailLevel(levelMatch[1]) : 'info';
    return { message: truncate(msg), level };
  }

  // Short logrus format: LEVEL[NNNN] message  key=value
  const shortMatch = trimmed.match(/^(DEBU|INFO|WARN|ERRO|FATA|PANI)\[\d+\]\s+(.+)/);
  if (shortMatch) {
    const levelMap: Record<string, DetailLevel> = {
      'DEBU': 'debug', 'INFO': 'info', 'WARN': 'warn',
      'ERRO': 'error', 'FATA': 'error', 'PANI': 'error',
    };
    const level = levelMap[shortMatch[1]] || 'info';
    const fullText = shortMatch[2];
    // The msg ends where key=value pairs begin (double-space separator)
    const dblIdx = fullText.indexOf('  ');
    const msg = dblIdx > 0 ? fullText.substring(0, dblIdx) : fullText;
    return { message: truncate(msg.trim()), level };
  }

  // Plain text (WSL or other) — return as info
  const cleaned = trimmed.replace(/\0/g, '');
  if (!cleaned) return null;
  return { message: truncate(cleaned), level: 'info' };
}

/** Normalize a level string to a valid DetailLevel */
function toDetailLevel(raw: string | undefined): DetailLevel {
  if (!raw) return 'info';
  const lower = raw.toLowerCase();
  if (lower === 'warning') return 'warn';
  if (lower === 'fatal' || lower === 'panic') return 'error';
  if (['info', 'warn', 'error', 'debug'].includes(lower)) return lower as DetailLevel;
  return 'info';
}

/** Truncate a string to a splash-friendly length */
function truncate(text: string, max: number = 120): string {
  if (text.length <= max) return text;
  return text.substring(0, max - 3) + '...';
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
      preload: path.join(__dirname, 'preload.js'),
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
 * Show the directory chooser on the splash screen.
 * Called on first launch or when user clicks "change directory".
 */
function showDirectoryChooser(): void {
  console.log('[Main] Showing directory chooser');
  sendSplashUpdate({
    phase: 'choose-directory',
    message: 'Choose data directory',
  });
  sendDirectoryInfo();
}

/**
 * Handle the splash screen ready event.
 * Decides whether to auto-start or show the directory chooser.
 */
function onSplashReady(): void {
  if (isDev) {
    // In dev mode, skip directory chooser entirely
    startupSequence(appSettings.lastDataDir);
    return;
  }

  if (appSettings.autoStart && appSettings.lastDataDir) {
    // Auto-start: show a brief loading state with "change" link visible
    autoStartPending = true;
    sendSplashUpdate({
      phase: 'initializing',
      message: 'Starting up...',
    });
    // Send directory info so the "change" link knows the state
    sendDirectoryInfo();

    // Give user time to see and click "change directory" before auto-starting
    setTimeout(() => {
      if (autoStartPending) {
        autoStartPending = false;
        startupSequence(appSettings.lastDataDir);
      }
    }, 5000);
  } else {
    // First launch or auto-start disabled — show directory chooser
    showDirectoryChooser();
  }
}

/**
 * Main startup sequence. Orchestrates:
 * 1. System requirements check
 * 2. Rootfs download (if needed)
 * 3. VM creation (if needed) — per-directory VM, no recreation on dir change
 * 4. VM start (if needed)
 * 5. Health check polling
 * 6. Main window launch
 */
async function startupSequence(dataDir: string): Promise<void> {
  autoStartPending = false;

  // Configure the VM manager with the chosen data directory
  vmManager.setDataDir(dataDir);
  console.log(`[Main] Starting with data directory: ${dataDir}`);
  console.log(`[Main] VM name for directory: ${vmManager.getVMName()}`);

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

  // Migrate legacy single-VM if present (one-time operation)
  await migrateLegacyVM();

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

  // Step 3: Check VM status (per-directory VM — no mismatch check needed)
  sendSplashUpdate({
    phase: 'initializing',
    message: 'Checking virtual machine...',
  });

  const vmStatus = await vmManager.checkStatus();

  // Step 3b: Check if rootfs tarball has been updated since the VM was provisioned
  const currentVmBuildIdPath = vmBuildIdPath(vmManager.getVMName());
  if (vmStatus.exists) {
    let tarballBuildId = '';
    let vmBuildId = '';
    try { tarballBuildId = fs.readFileSync(ROOTFS_BUILD_ID_PATH, 'utf-8').trim(); } catch { /* missing is fine */ }
    try { vmBuildId = fs.readFileSync(currentVmBuildIdPath, 'utf-8').trim(); } catch { /* missing is fine */ }

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
      const parsed = formatVMOutput(line);
      if (parsed) {
        sendSplashUpdate({
          phase: 'creating-vm',
          message: 'Creating virtual machine...',
          detail: parsed.message,
          detailLevel: parsed.level,
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
        fs.mkdirSync(path.dirname(currentVmBuildIdPath), { recursive: true });
        fs.writeFileSync(currentVmBuildIdPath, tarballBuildId, 'utf-8');
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
      const parsed = formatVMOutput(line);
      if (parsed) {
        sendSplashUpdate({
          phase: 'starting-vm',
          message: 'Starting virtual machine...',
          detail: parsed.message,
          detailLevel: parsed.level,
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
  appSettings = loadSettings();
  vmManager = createVMManager();
  downloadManager = new DownloadManager();
  healthChecker = isDev
    ? new HealthChecker('http://localhost:3000/api/health')
    : new HealthChecker();

  // Pre-configure VM manager with last-used directory
  vmManager.setDataDir(appSettings.lastDataDir);

  // Handle file downloads (backups, exports, etc.) — prompt user with a save dialog
  session.defaultSession.on('will-download', (_event, item) => {
    const suggestedName = item.getFilename();
    const parentWindow = mainWindow || splashWindow || undefined;

    const savePath = dialog.showSaveDialogSync(parentWindow as BrowserWindow, {
      defaultPath: suggestedName,
      filters: [
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (savePath) {
      item.setSavePath(savePath);
      console.log(`[Main] Downloading file to: ${savePath}`);
    } else {
      item.cancel();
      console.log('[Main] Download cancelled by user');
    }
  });

  splashWindow = createSplashWindow();

  // Wait for splash to load before starting sequence
  splashWindow.webContents.on('did-finish-load', () => {
    onSplashReady();
  });
});

// --- IPC handlers for directory chooser ---

/** Return current directory list and settings */
ipcMain.handle('splash:get-directories', (): DirectoryInfo => {
  return {
    dirs: appSettings.knownDataDirs,
    lastUsed: appSettings.lastDataDir,
    autoStart: appSettings.autoStart,
    sizes: {},
  };
});

/** Open native folder picker */
ipcMain.handle('splash:select-directory', async (): Promise<string> => {
  if (!splashWindow) return '';

  const result = await dialog.showOpenDialog(splashWindow, {
    title: 'Choose Quilltap Data Directory',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Select',
  });

  if (result.canceled || result.filePaths.length === 0) {
    return '';
  }

  const selectedPath = result.filePaths[0];
  console.log('[Main] User selected directory:', selectedPath);

  // Add to known dirs if not already present
  if (!appSettings.knownDataDirs.includes(selectedPath)) {
    appSettings.knownDataDirs.push(selectedPath);
    saveSettings(appSettings);
  }

  // Send updated directory list to splash
  sendDirectoryInfo();

  return selectedPath;
});

/** Remove a directory from the known list */
ipcMain.on('splash:remove-directory', (_event, dirPath: string) => {
  console.log('[Main] Removing directory from known list:', dirPath);

  // Don't allow removing the last-used directory while it's in use
  appSettings.knownDataDirs = appSettings.knownDataDirs.filter(d => d !== dirPath);

  // Ensure at least one directory remains
  if (appSettings.knownDataDirs.length === 0) {
    const { DEFAULT_DATA_DIR } = require('./constants');
    appSettings.knownDataDirs = [DEFAULT_DATA_DIR];
  }

  // If removed dir was last-used, switch to first available
  if (appSettings.lastDataDir === dirPath) {
    appSettings.lastDataDir = appSettings.knownDataDirs[0];
  }

  saveSettings(appSettings);
  sendDirectoryInfo();
});

/** User chose a directory and clicked Start */
ipcMain.on('splash:start', (_event, dirPath: string) => {
  console.log('[Main] Starting with directory:', dirPath);
  autoStartPending = false;

  // Update settings
  appSettings.lastDataDir = dirPath;
  if (!appSettings.knownDataDirs.includes(dirPath)) {
    appSettings.knownDataDirs.push(dirPath);
  }
  saveSettings(appSettings);

  startupSequence(dirPath);
});

/** Toggle auto-start preference */
ipcMain.on('splash:set-auto-start', (_event, enabled: boolean) => {
  console.log('[Main] Auto-start set to:', enabled);
  appSettings.autoStart = enabled;
  saveSettings(appSettings);
});

/** Interrupt auto-start to show directory chooser */
ipcMain.on('splash:show-chooser', () => {
  console.log('[Main] User interrupted auto-start — showing directory chooser');
  autoStartPending = false;
  showDirectoryChooser();
});

// Handle retry from splash screen
ipcMain.on('splash:retry', () => {
  startupSequence(appSettings.lastDataDir);
});

// Handle quit from splash screen
ipcMain.on('splash:quit', () => {
  app.quit();
});

// Handle file save from main app window (for blobs already in memory)
ipcMain.handle('app:save-file', async (_event, data: ArrayBuffer, filename: string) => {
  const ext = path.extname(filename).replace('.', '');
  const parentWindow = mainWindow || undefined;
  const result = await dialog.showSaveDialog(parentWindow as BrowserWindow, {
    defaultPath: filename,
    filters: [{ name: ext.toUpperCase() || 'All Files', extensions: [ext || '*'] }],
  });
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, Buffer.from(data));
  console.log(`[Main] Saved file to: ${result.filePath}`);
  return true;
});

// Handle URL download from main app window (streams to disk via will-download handler)
ipcMain.handle('app:download-url', async (_event, url: string) => {
  if (!mainWindow) return;
  // Resolve relative URLs against the app server
  const baseUrl = isDev ? 'http://localhost:3000' : `http://localhost:${HOST_PORT}`;
  const fullUrl = url.startsWith('/') ? `${baseUrl}${url}` : url;
  console.log(`[Main] Triggering download for: ${fullUrl}`);
  mainWindow.webContents.downloadURL(fullUrl);
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
