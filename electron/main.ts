import { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HOST_PORT,
  LIMA_HOME,
  ROOTFS_BUILD_ID_PATH,
  SPLASH_WIDTH,
  SPLASH_HEIGHT,
  MAIN_WIDTH,
  MAIN_HEIGHT,
  DEFAULT_ROOTFS_URL,
  DEFAULT_DATA_DIR,
  APP_VERSION,
  DOCKER_IMAGE,
  vmBuildIdPath,
} from './constants';
import { IVMManager, createVMManager } from './vm-manager';
import { LimaManager } from './lima-manager';
import { DockerManager } from './docker-manager';
import { EmbeddedManager } from './embedded-manager';
import { DownloadManager } from './download-manager';
import { HealthChecker } from './health-checker';
import { SplashUpdate, DirectoryInfo, DirectorySizeInfo, RuntimeMode, DetailLevel, WindowBounds } from './types';
import { AppSettings, loadSettings, saveSettings, saveWindowBounds, getWindowBounds, defaultNameForPath } from './settings';
import { getSizesForDir } from './disk-utils';
import { runCrashGuard, markStartupSuccess, isInSafeMode } from './crash-guard';
import { initStartupLog, logStartup, closeStartupLog } from './startup-log';
import { WorkspaceWatcher } from './workspace-watcher';

const isDev = !!process.env.ELECTRON_DEV;

/** Detect the host OS timezone to pass through to the backend */
const hostTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
console.log('[Main] Detected host timezone:', hostTimezone);

// Run crash guard before app is ready — tracks consecutive crashes and enters
// safe mode after 3 consecutive failures (clears caches, resets settings)
runCrashGuard();

// Prevent macOS NSPersistentUIRestorer from attempting window state restoration,
// which can cause EXC_BREAKPOINT crashes in the Electron Framework
if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('disable-session-crashed-bubble');
  try {
    fs.rmSync(
      path.join(os.homedir(), 'Library', 'Saved Application State', 'com.foundry9.quilltap.savedState'),
      { recursive: true, force: true }
    );
  } catch {
    // Non-fatal — directory may not exist
  }
}

// Handle Ubuntu 24.04+ unprivileged user namespace restriction
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox');
}

/** Root of the app directory (for static files like electron/splash/) */
const appRoot = app.isPackaged
  ? app.getAppPath()
  : path.join(__dirname, '..');

let splashWindow: BrowserWindow | null = null;
let mainWindow: BrowserWindow | null = null;
let vmManager: IVMManager;
let dockerManager: DockerManager;
let embeddedManager: EmbeddedManager;
let downloadManager: DownloadManager;
let healthChecker: HealthChecker;
let isQuitting = false;
let appSettings: AppSettings;
let dockerAvailable = false;
const embeddedAvailable = true; // Always available — uses Electron's own Node.js
let workspaceWatcher: WorkspaceWatcher | null = null;

/** Whether we're in the auto-start countdown (can be interrupted) */
let autoStartPending = false;

/** When true, onSplashReady() skips auto-start and goes straight to the directory chooser */
let skipAutoStart = false;

/** Send an update to the splash screen */
function sendSplashUpdate(update: SplashUpdate): void {
  logStartup(update.message, update.detail, update.detailLevel || update.phase);
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:update', update);
  }
}

/** Send an error to the splash screen */
function sendSplashError(message: string, canRetry: boolean = true): void {
  logStartup(message, canRetry ? 'canRetry=true' : 'canRetry=false', 'ERROR');
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:error', {
      phase: 'error' as const,
      message,
      canRetry,
    });
  }
}

/** Get the VM label for the current platform */
function getVMLabel(): string {
  if (process.platform === 'linux') return 'Docker';
  return process.platform === 'win32' ? 'WSL2' : 'Lima';
}

/** Send directory info to splash screen (two-phase: immediate with empty sizes, then async with real sizes) */
function sendDirectoryInfo(): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;

  const common = {
    dirs: appSettings.knownDataDirs,
    lastUsed: appSettings.lastDataDir,
    autoStart: appSettings.autoStart,
    runtimeMode: appSettings.runtimeMode,
    dockerAvailable,
    embeddedAvailable,
    vmLabel: getVMLabel(),
    platform: process.platform,
  };

  // Phase 1: Send immediately with empty sizes so UI renders fast
  const info: DirectoryInfo = { ...common, sizes: {} };
  splashWindow.webContents.send('splash:directories', info);

  // Phase 2: Calculate sizes async in background, send update when done
  calculateDirectorySizes().then((sizes) => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      const updated: DirectoryInfo = { ...common, sizes };
      splashWindow.webContents.send('splash:directories', updated);
    }
  });
}

/** Calculate disk sizes for all known data directories */
async function calculateDirectorySizes(): Promise<Record<string, DirectorySizeInfo>> {
  const sizes: Record<string, DirectorySizeInfo> = {};
  for (const dir of appSettings.knownDataDirs) {
    try {
      sizes[dir.path] = getSizesForDir(dir.path);
    } catch (err) {
      console.warn('[Main] Error calculating size for', dir.path, err);
      sizes[dir.path] = { dataSize: -1, vmSize: -1 };
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

/**
 * Messages that are pure noise — suppress entirely (never shown or logged).
 * These are Lima internals that provide no value to the user or for debugging.
 */
const VM_OUTPUT_SUPPRESS_PATTERNS = [
  /\bNot forwarding\b/,
  /\btcpproxy:.*error dialing\b/,
];

/**
 * Messages that repeat during boot — show the first occurrence, suppress duplicates.
 * Maps a regex to the last message key seen (reset per startup via resetVMOutputState).
 */
const VM_OUTPUT_DEDUP_PATTERNS = [
  /guest agent events closed unexpectedly/,
  /Waiting for the essential requirement/,
  /Waiting for the final requirement/,
];

/** Track which dedup messages we've already seen (reset per startup) */
let seenDedupMessages = new Set<number>();

/** Reset dedup tracking at the start of each startup sequence */
function resetVMOutputState(): void {
  seenDedupMessages = new Set();
}

function formatVMOutput(line: string): { message: string; level: DetailLevel } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Suppress known noise patterns entirely
  for (const pattern of VM_OUTPUT_SUPPRESS_PATTERNS) {
    if (pattern.test(trimmed)) return null;
  }

  // Try JSON format first: {"level":"info","msg":"..."}
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.msg) {
        return filterDedupAndReturn(truncate(parsed.msg), toDetailLevel(parsed.level));
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
    return filterDedupAndReturn(truncate(msg), level);
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
    return filterDedupAndReturn(truncate(msg.trim()), level);
  }

  // Plain text (WSL or other) — return as info
  const cleaned = trimmed.replace(/\0/g, '');
  if (!cleaned) return null;
  return filterDedupAndReturn(truncate(cleaned), 'info');
}

/** Check dedup patterns and suppress repeated messages after the first occurrence */
function filterDedupAndReturn(message: string, level: DetailLevel): { message: string; level: DetailLevel } | null {
  for (let i = 0; i < VM_OUTPUT_DEDUP_PATTERNS.length; i++) {
    if (VM_OUTPUT_DEDUP_PATTERNS[i].test(message)) {
      if (seenDedupMessages.has(i)) {
        return null; // Already shown this pattern once — suppress
      }
      seenDedupMessages.add(i);
    }
  }
  return { message, level };
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
    backgroundColor: '#0f1729',
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

/** Stop the currently running backend (VM, Docker container, or embedded server) */
async function stopCurrentBackend(): Promise<void> {
  if (appSettings.runtimeMode === 'docker') {
    console.log('[Main] Stopping Docker container...');
    try {
      await dockerManager.stopContainer();
    } catch (err) {
      console.warn('[Main] Error stopping Docker container (non-fatal):', err);
    }
  } else if (appSettings.runtimeMode === 'embedded') {
    console.log('[Main] Stopping embedded server...');
    try {
      await embeddedManager.stopServer();
    } catch (err) {
      console.warn('[Main] Error stopping embedded server (non-fatal):', err);
    }
  } else {
    console.log('[Main] Stopping VM...');
    try {
      await vmManager.stopVM();
    } catch (err) {
      console.warn('[Main] Error stopping VM (non-fatal):', err);
    }
  }
}

/**
 * Restart the backend server. Closes the main window, stops the current
 * backend, recreates the splash, and relaunches with the same data directory.
 */
async function restartServer(): Promise<void> {
  console.log('[Main] Restarting server...');

  // Close main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }

  // Show splash with restart status
  splashWindow = createSplashWindow();
  splashWindow.webContents.on('did-finish-load', async () => {
    sendSplashUpdate({
      phase: 'initializing',
      message: 'Restarting server...',
    });

    await stopCurrentBackend();
    routeStartup(appSettings.lastDataDir);
  });
}

/**
 * Switch to a different data directory. Closes the main window, stops the
 * current backend, and shows the directory chooser on the splash screen.
 */
async function changeSite(): Promise<void> {
  console.log('[Main] Changing site...');

  // Close main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }

  // Set flag so onSplashReady goes to directory chooser instead of auto-start
  skipAutoStart = true;

  // Show splash — onSplashReady will handle showing the directory chooser
  splashWindow = createSplashWindow();
  splashWindow.webContents.on('did-finish-load', async () => {
    sendSplashUpdate({
      phase: 'initializing',
      message: 'Stopping server...',
    });

    await stopCurrentBackend();
    onSplashReady();
  });
}

/** Build the application menu with Navigate items */
function buildAppMenu(win: BrowserWindow): void {
  const appOrigin = isDev ? 'http://localhost:3000' : `http://localhost:${HOST_PORT}`;

  const navigateItems: { label: string; path: string; accelerator?: string }[] = [
    { label: 'Home', path: '/', accelerator: 'CmdOrCtrl+Shift+H' },
    { label: 'Projects', path: '/prospero', accelerator: 'CmdOrCtrl+Shift+P' },
    { label: 'Files', path: '/files', accelerator: 'CmdOrCtrl+Shift+F' },
    { label: 'Characters', path: '/aurora', accelerator: 'CmdOrCtrl+Shift+C' },
    { label: 'Chats', path: '/salon', accelerator: 'CmdOrCtrl+Shift+S' },
    { label: 'Settings', path: '/settings', accelerator: 'CmdOrCtrl+,' },
    { label: 'Profile', path: '/profile' },
    { label: 'About', path: '/about' },
  ];

  const navigateSubmenu = navigateItems.map(({ label, path, accelerator }) => ({
    label,
    accelerator,
    click: () => {
      win.webContents.loadURL(`${appOrigin}${path}`);
    },
  }));

  const serverItems: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Restart Server',
      click: () => { restartServer(); },
    },
    {
      label: 'Change Site...',
      click: () => { changeSite(); },
    },
  ];

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            ...serverItems,
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : [{
          label: 'File',
          submenu: [
            ...serverItems,
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Navigate',
      submenu: navigateSubmenu,
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
            ]
          : [
              { role: 'close' as const },
            ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/** Validate that saved window bounds are still visible on a connected display */
function validateBounds(bounds: WindowBounds): WindowBounds | null {
  const displays = screen.getAllDisplays();
  // Check that at least part of the window is on a visible display
  const x = bounds.x ?? 0;
  const y = bounds.y ?? 0;
  const visible = displays.some((display) => {
    const { x: dx, y: dy, width: dw, height: dh } = display.bounds;
    // Window is "visible" if at least 100px of it overlaps a display
    return (
      x + bounds.width > dx + 100 &&
      x < dx + dw - 100 &&
      y + bounds.height > dy + 100 &&
      y < dy + dh - 100
    );
  });
  if (!visible) {
    console.log('[Main] Saved window bounds are off-screen, using defaults');
    return null;
  }
  return bounds;
}

/** Save the current main window bounds to the active data directory's settings */
function persistWindowBounds(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const isMaximized = win.isMaximized();
  // When maximized, preserve the pre-maximized bounds so we restore to the right size
  const normalBounds = win.getNormalBounds();
  const bounds: WindowBounds = {
    ...normalBounds,
    isMaximized,
  };
  if (bounds.width && bounds.height) {
    saveWindowBounds(appSettings, appSettings.lastDataDir, bounds);
  }
}

/** Create the main application window */
function createMainWindow(urlPath?: string): BrowserWindow {
  // Restore saved bounds for this data directory, or fall back to defaults
  const dirBounds = getWindowBounds(appSettings, appSettings.lastDataDir);
  const saved = dirBounds ? validateBounds(dirBounds) : null;

  const winOptions: Electron.BrowserWindowConstructorOptions = {
    width: saved?.width ?? MAIN_WIDTH,
    height: saved?.height ?? MAIN_HEIGHT,
    show: false,
    title: 'Quilltap',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
  if (saved?.x !== undefined && saved?.y !== undefined) {
    winOptions.x = saved.x;
    winOptions.y = saved.y;
  }

  const win = new BrowserWindow(winOptions);

  if (saved?.isMaximized) {
    win.maximize();
  }

  // Persist bounds on resize, move, maximize, and unmaximize
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const debouncedPersist = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => persistWindowBounds(win), 500);
  };
  win.on('resize', debouncedPersist);
  win.on('move', debouncedPersist);
  win.on('maximize', () => persistWindowBounds(win));
  win.on('unmaximize', () => persistWindowBounds(win));

  const baseUrl = isDev
    ? 'http://localhost:3000'
    : `http://localhost:${HOST_PORT}`;
  const url = urlPath ? `${baseUrl}${urlPath}` : baseUrl;

  // Intercept new-window requests (target="_blank", window.open)
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith(baseUrl)) {
      // Same-origin URLs (images, files) can't be opened externally — block them.
      // The frontend handles these with in-app preview modals when running in Electron.
      console.log('[Main] Blocked same-origin new-window request:', targetUrl);
      return { action: 'deny' };
    }
    // External URLs → open in system browser
    console.log('[Main] Opening external URL in system browser:', targetUrl);
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  // Prevent the main window from navigating away to external URLs
  win.webContents.on('will-navigate', (event, navUrl) => {
    if (!navUrl.startsWith(baseUrl)) {
      event.preventDefault();
      console.log('[Main] Blocked in-window navigation to external URL:', navUrl);
      shell.openExternal(navUrl);
    }
  });

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

  buildAppMenu(win);

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

  // "Change Site" sets this flag to bypass auto-start
  if (skipAutoStart) {
    skipAutoStart = false;
    showDirectoryChooser();
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
        routeStartup(appSettings.lastDataDir);
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

  // Initialize startup log (overwrites any previous log)
  initStartupLog(dataDir);
  resetVMOutputState();

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
      markStartupSuccess();
      return;
    }

    if (status.status === 'locked') {
      // Server is in locked mode — load the setup/unlock page
      mainWindow = createMainWindow('/setup');
      markStartupSuccess();
      return;
    }

    sendSplashError(
      'Could not connect to dev server at localhost:3000. Is "npm run dev" running?',
      true
    );
    return;
  }

  // --- Production / VM mode ---

  // Step 0: Stop any running Docker container or embedded server to prevent port conflicts
  try {
    dockerManager.setDataDir(dataDir);
    await dockerManager.stopContainer();
  } catch (err) {
    console.warn('[Main] Could not stop Docker container (non-fatal):', err);
  }
  try {
    await embeddedManager.stopServer();
  } catch (err) {
    console.warn('[Main] Could not stop embedded server (non-fatal):', err);
  }

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

    if (prereq.error === 'DOCKER_PERMISSION_DENIED') {
      sendSplashError(
        'Docker permission denied.\n\n' +
        'Add your user to the docker group:\n' +
        '  sudo usermod -aG docker $USER\n\n' +
        'Then log out and back in.',
        true
      );
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
      const downloadUrl = process.env.QUILLTAP_ROOTFS_URL || DEFAULT_ROOTFS_URL;
      if (!downloadUrl) {
        sendSplashError(
          'No rootfs tarball found and no download URL available. ' +
          'Set QUILLTAP_ROOTFS_URL or install from an official release.',
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

  if (healthStatus.status === 'locked') {
    sendSplashUpdate({ phase: 'ready', message: 'Database locked — passphrase required' });
    closeStartupLog();
    mainWindow = createMainWindow('/setup');
    markStartupSuccess();
    return;
  }

  if (healthStatus.status === 'healthy' || healthStatus.status === 'degraded') {
    sendSplashUpdate({
      phase: 'ready',
      message: 'Ready!',
    });

    closeStartupLog();
    mainWindow = createMainWindow();
    markStartupSuccess();

    // Start workspace watcher after VM/Docker is healthy
    try {
      const workspaceDir = path.join(dataDir, 'workspace');
      workspaceWatcher = new WorkspaceWatcher({
        workspaceDir,
        log: (msg, data) => logStartup(`[WorkspaceWatcher] ${msg} ${data ? JSON.stringify(data) : ''}`),
      });
      workspaceWatcher.start();
    } catch (err) {
      logStartup(`[WorkspaceWatcher] Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const logs = await vmManager.getLogs(20);
    sendSplashError(
      `Server did not become healthy after ${healthStatus.attempts} attempts.\n\nRecent logs:\n${logs}`,
      true
    );
    closeStartupLog();
  }
}

/**
 * Route startup to the correct backend based on runtime mode setting.
 */
function routeStartup(dataDir: string): void {
  if (appSettings.runtimeMode === 'docker') {
    dockerStartupSequence(dataDir);
  } else if (appSettings.runtimeMode === 'embedded') {
    embeddedStartupSequence(dataDir);
  } else {
    startupSequence(dataDir);
  }
}

/**
 * Docker startup sequence. Orchestrates:
 * 1. Verify Docker available
 * 2. Stop any running VM (port conflict prevention)
 * 3. Pull Docker image if needed
 * 4. Start container with bind mount
 * 5. Health check polling
 * 6. Main window launch
 */
async function dockerStartupSequence(dataDir: string): Promise<void> {
  autoStartPending = false;

  // Initialize startup log (overwrites any previous log)
  initStartupLog(dataDir);
  resetVMOutputState();

  dockerManager.setDataDir(dataDir);
  console.log(`[Main] Docker startup with data directory: ${dataDir}`);
  console.log(`[Main] Container name: ${dockerManager.getContainerName()}`);

  // Step 1: Verify Docker is available
  sendSplashUpdate({
    phase: 'initializing',
    message: 'Checking Docker...',
  });

  if (!dockerAvailable) {
    const installMsg = process.platform === 'linux'
      ? 'Docker Engine is required. Install it from https://docs.docker.com/engine/install/'
      : 'Docker is not available. Install Docker Desktop and try again.';
    sendSplashError(installMsg, true);
    return;
  }

  // Step 2: Stop any running VM or embedded server to prevent port conflicts
  if (process.platform !== 'linux') {
    try {
      const vmStatus = await vmManager.checkStatus();
      if (vmStatus.running) {
        console.log('[Main] Stopping running VM to prevent port conflict with Docker');
        sendSplashUpdate({
          phase: 'initializing',
          message: 'Stopping virtual machine...',
          detail: 'Preventing port conflict with Docker',
        });
        await vmManager.stopVM();
      }
    } catch (err) {
      console.warn('[Main] Could not check/stop VM (non-fatal):', err);
    }
  }
  try {
    await embeddedManager.stopServer();
  } catch (err) {
    console.warn('[Main] Could not stop embedded server (non-fatal):', err);
  }

  // Step 3: Ensure the version-matched Docker image is available
  if (!APP_VERSION) {
    sendSplashError('Cannot determine app version — Docker mode requires a version-tagged image.', false);
    return;
  }

  const versionExists = await dockerManager.imageExistsLocally(APP_VERSION);
  if (!versionExists) {
    // Try to pull the version-specific tag
    sendSplashUpdate({
      phase: 'pulling-image',
      message: 'Pulling Quilltap image...',
      detail: `${DOCKER_IMAGE}:${APP_VERSION}`,
    });

    const pullResult = await dockerManager.pullImage(APP_VERSION, (line) => {
      sendSplashUpdate({
        phase: 'pulling-image',
        message: 'Pulling Quilltap image...',
        detail: line.length > 120 ? line.substring(0, 117) + '...' : line,
      });
    });

    if (!pullResult.success) {
      sendSplashError(
        `Failed to pull Docker image ${DOCKER_IMAGE}:${APP_VERSION}.\n\n` +
        `The Electron app requires the exact matching Docker image for version ${APP_VERSION}.\n\n` +
        `Error: ${pullResult.error}`,
        true
      );
      return;
    }
  }

  // Step 4: Start container
  sendSplashUpdate({
    phase: 'starting-container',
    message: 'Starting Quilltap container...',
  });

  const startResult = await dockerManager.startContainer((line) => {
    sendSplashUpdate({
      phase: 'starting-container',
      message: 'Starting Quilltap container...',
      detail: line.length > 120 ? line.substring(0, 117) + '...' : line,
    });
  });

  if (!startResult.success) {
    sendSplashError(`Failed to start Docker container: ${startResult.error}`, true);
    return;
  }

  // Step 5: Wait for health
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

  if (healthStatus.status === 'locked') {
    sendSplashUpdate({ phase: 'ready', message: 'Database locked — passphrase required' });
    closeStartupLog();
    mainWindow = createMainWindow('/setup');
    markStartupSuccess();
  } else if (healthStatus.status === 'healthy' || healthStatus.status === 'degraded') {
    sendSplashUpdate({
      phase: 'ready',
      message: 'Ready!',
    });

    closeStartupLog();
    mainWindow = createMainWindow();
    markStartupSuccess();
  } else {
    const logs = await dockerManager.getLogs(20);
    sendSplashError(
      `Server did not become healthy after ${healthStatus.attempts} attempts.\n\nRecent logs:\n${logs}`,
      true
    );
    closeStartupLog();
  }
}

/**
 * Embedded server startup sequence. Orchestrates:
 * 1. Stop any running VM/Docker to prevent port conflicts
 * 2. Spawn server.js via Electron's Node.js runtime
 * 3. Health check polling
 * 4. Main window launch
 */
async function embeddedStartupSequence(dataDir: string): Promise<void> {
  autoStartPending = false;

  // Initialize startup log (overwrites any previous log)
  initStartupLog(dataDir);

  console.log(`[Main] Embedded server startup with data directory: ${dataDir}`);

  // Step 1: Stop any running VM or Docker container to prevent port conflicts
  sendSplashUpdate({
    phase: 'initializing',
    message: 'Preparing to start server...',
  });

  if (process.platform !== 'linux') {
    try {
      const vmStatus = await vmManager.checkStatus();
      if (vmStatus.running) {
        console.log('[Main] Stopping running VM to prevent port conflict with embedded server');
        sendSplashUpdate({
          phase: 'initializing',
          message: 'Stopping virtual machine...',
          detail: 'Preventing port conflict with embedded server',
        });
        await vmManager.stopVM();
      }
    } catch (err) {
      console.warn('[Main] Could not check/stop VM (non-fatal):', err);
    }
  }

  try {
    dockerManager.setDataDir(dataDir);
    await dockerManager.stopContainer();
  } catch (err) {
    console.warn('[Main] Could not stop Docker container (non-fatal):', err);
  }

  // Step 2: Start the embedded server
  sendSplashUpdate({
    phase: 'starting-server',
    message: 'Starting Quilltap server...',
    detail: 'Using embedded Node.js runtime',
  });

  let startError: string | null = null;

  embeddedManager.startServer(
    dataDir,
    (line) => {
      console.log('[EmbeddedManager] output:', line);
      sendSplashUpdate({
        phase: 'starting-server',
        message: 'Starting Quilltap server...',
        detail: line.length > 120 ? line.substring(0, 117) + '...' : line,
      });
    },
    (error) => {
      startError = error;
    },
  );

  // Give the process a moment to fail immediately
  await new Promise(resolve => setTimeout(resolve, 2000));

  if (startError) {
    sendSplashError(`Failed to start server: ${startError}`, true);
    return;
  }

  if (!embeddedManager.isRunning()) {
    sendSplashError('Server process exited unexpectedly.', true);
    return;
  }

  // Step 3: Wait for health
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

  if (healthStatus.status === 'locked') {
    sendSplashUpdate({ phase: 'ready', message: 'Database locked — passphrase required' });
    closeStartupLog();
    mainWindow = createMainWindow('/setup');
    markStartupSuccess();
  } else if (healthStatus.status === 'healthy' || healthStatus.status === 'degraded') {
    sendSplashUpdate({
      phase: 'ready',
      message: 'Ready!',
    });

    closeStartupLog();
    mainWindow = createMainWindow();
    markStartupSuccess();
  } else {
    sendSplashError(
      `Server did not become healthy after ${healthStatus.attempts} attempts.\n\n` +
      'Check the application logs for details.',
      true
    );
    closeStartupLog();
  }
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  appSettings = loadSettings();

  // If crash guard triggered safe mode, ensure autoStart is off so user gets
  // the directory chooser and can pick a different (working) data directory
  if (isInSafeMode()) {
    console.log('[Main] Safe mode active — disabling autoStart');
    appSettings.autoStart = false;
    saveSettings(appSettings);
  }

  vmManager = createVMManager();
  dockerManager = new DockerManager();
  embeddedManager = new EmbeddedManager();
  downloadManager = new DownloadManager();
  healthChecker = isDev
    ? new HealthChecker('http://localhost:3000/api/health')
    : new HealthChecker();

  // Pre-configure VM manager with last-used directory
  vmManager.setDataDir(appSettings.lastDataDir);

  // Check Docker availability asynchronously (non-blocking)
  // Embedded mode is always available — uses Electron's own Node.js
  dockerAvailable = await dockerManager.isDockerAvailable();
  console.log('[Main] Docker available:', dockerAvailable);

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
    runtimeMode: appSettings.runtimeMode,
    dockerAvailable,
    embeddedAvailable,
    vmLabel: getVMLabel(),
    platform: process.platform,
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
  if (!appSettings.knownDataDirs.some(d => d.path === selectedPath)) {
    appSettings.knownDataDirs.push({ path: selectedPath, name: defaultNameForPath(selectedPath) });
    saveSettings(appSettings);
  }

  // Send updated directory list to splash
  sendDirectoryInfo();

  return selectedPath;
});

/** Set the runtime mode (docker, vm, or embedded) */
ipcMain.on('splash:set-runtime-mode', (_event, mode: string) => {
  const runtimeMode: RuntimeMode = mode === 'docker' ? 'docker'
    : mode === 'embedded' ? 'embedded' : 'vm';
  console.log('[Main] Runtime mode set to:', runtimeMode);
  appSettings.runtimeMode = runtimeMode;
  saveSettings(appSettings);
});

/** Delete a directory: remove config entry and optionally delete data on disk */
ipcMain.handle('splash:delete-directory', async (_event, dirPath: string, action: string): Promise<boolean> => {
  console.log('[Main] Delete directory:', dirPath, 'action:', action);

  try {
    // Stop and delete any associated VM
    try {
      const tempVMManager = createVMManager();
      tempVMManager.setDataDir(dirPath);
      const vmStatus = await tempVMManager.checkStatus();
      if (vmStatus.running) {
        console.log('[Main] Stopping VM for directory:', dirPath);
        await tempVMManager.stopVM();
      }
      if (vmStatus.exists) {
        console.log('[Main] Deleting VM for directory:', dirPath);
        await tempVMManager.deleteVM();
      }
    } catch (err) {
      console.warn('[Main] Error cleaning up VM for', dirPath, '(non-fatal):', err);
    }

    // Stop and delete any associated Docker container
    try {
      await dockerManager.deleteContainerForDir(dirPath);
    } catch (err) {
      console.warn('[Main] Error cleaning up Docker container for', dirPath, '(non-fatal):', err);
    }

    // If config-and-data, delete the data directory from disk
    if (action === 'config-and-data') {
      console.log('[Main] Deleting data directory from disk:', dirPath);
      fs.rmSync(dirPath, { recursive: true, force: true });
    }

    // Remove from known dirs
    appSettings.knownDataDirs = appSettings.knownDataDirs.filter(d => d.path !== dirPath);

    // Ensure at least one directory remains
    if (appSettings.knownDataDirs.length === 0) {
      appSettings.knownDataDirs = [{ path: DEFAULT_DATA_DIR, name: 'Default' }];
    }

    // If deleted dir was last-used, switch to first available
    if (appSettings.lastDataDir === dirPath) {
      appSettings.lastDataDir = appSettings.knownDataDirs[0].path;
    }

    saveSettings(appSettings);
    sendDirectoryInfo();
    return true;
  } catch (err) {
    console.error('[Main] Error deleting directory:', err);
    return false;
  }
});

/** User chose a directory and clicked Start */
ipcMain.on('splash:start', (_event, dirPath: string) => {
  console.log('[Main] Starting with directory:', dirPath);
  autoStartPending = false;

  // Update settings
  appSettings.lastDataDir = dirPath;
  if (!appSettings.knownDataDirs.some(d => d.path === dirPath)) {
    appSettings.knownDataDirs.push({ path: dirPath, name: defaultNameForPath(dirPath) });
  }
  saveSettings(appSettings);

  routeStartup(dirPath);
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

/** Rename a data directory's display name */
ipcMain.handle('splash:rename-directory', (_event, dirPath: string, newName: string): boolean => {
  const trimmed = newName.trim();
  if (!trimmed) return false;

  const entry = appSettings.knownDataDirs.find(d => d.path === dirPath);
  if (!entry) {
    console.warn('[Main] Rename failed — directory not found:', dirPath);
    return false;
  }

  console.log(`[Main] Renaming directory "${entry.name}" → "${trimmed}" (${dirPath})`);
  entry.name = trimmed;
  saveSettings(appSettings);
  sendDirectoryInfo();
  return true;
});

// Handle retry from splash screen
ipcMain.on('splash:retry', () => {
  routeStartup(appSettings.lastDataDir);
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

// Open a path in the host's file browser
ipcMain.handle('app:open-path', async (_event, dirPath: string) => {
  console.log(`[Main] Opening path in file browser: ${dirPath}`);
  await shell.openPath(dirPath);
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

/** Create a small, frameless window showing a shutdown message */
function createShutdownWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 360,
    height: 200,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#0f1729',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const backendLabel = appSettings.runtimeMode === 'docker' ? 'container'
    : appSettings.runtimeMode === 'embedded' ? 'server' : 'virtual machine';
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #0f1729; color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100vh; -webkit-app-region: drag; user-select: none;
  }
  .title {
    font-family: Georgia, Cambria, "Times New Roman", serif;
    font-size: 24px; font-weight: 700; color: #f0ebe3; margin-bottom: 16px;
  }
  .message { font-size: 14px; color: #a0a0a0; margin-bottom: 12px; }
  .spinner {
    width: 24px; height: 24px; border: 3px solid #333;
    border-top-color: #d4af37; border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style></head><body>
  <div class="title">Quilltap</div>
  <div class="message">Stopping ${backendLabel}…</div>
  <div class="spinner"></div>
</body></html>`;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.once('ready-to-show', () => win.show());
  return win;
}

// Graceful shutdown: stop the VM or Docker container before quitting
app.on('before-quit', async (event) => {
  if (isQuitting || isDev) return;

  isQuitting = true;
  event.preventDefault();

  // Stop workspace watcher
  if (workspaceWatcher) {
    workspaceWatcher.stop();
    workspaceWatcher = null;
  }

  // Close interactive windows immediately so the user can't keep clicking
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
    mainWindow = null;
  }
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }

  // Show a small shutdown indicator
  const shutdownWindow = createShutdownWindow();

  if (appSettings.runtimeMode === 'docker') {
    console.log('[Main] Stopping Docker container before quit...');
    try {
      await dockerManager.stopContainer();
    } catch (err) {
      console.error('[Main] Error stopping Docker container:', err);
    }
  } else if (appSettings.runtimeMode === 'embedded') {
    console.log('[Main] Stopping embedded server before quit...');
    try {
      await embeddedManager.stopServer();
    } catch (err) {
      console.error('[Main] Error stopping embedded server:', err);
    }
  } else {
    console.log('[Main] Stopping VM before quit...');
    try {
      await vmManager.stopVM();
    } catch (err) {
      console.error('[Main] Error stopping VM:', err);
    }
  }

  if (!shutdownWindow.isDestroyed()) {
    shutdownWindow.close();
  }

  app.quit();
});

// On macOS, quit when all windows closed (not default Electron behavior)
// Guard against the shutdown state where we intentionally close windows before quitting
app.on('window-all-closed', () => {
  if (!isQuitting) {
    app.quit();
  }
});
