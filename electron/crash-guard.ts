import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Crash guard state persisted between launches */
interface CrashGuardState {
  consecutiveCrashes: number;
  lastStartTimestamp: number;
  safeMode: boolean;
}

/** Number of consecutive crashes before entering safe mode */
const CRASH_THRESHOLD = 3;

/** Chromium cache directories that are safe to delete */
const CHROMIUM_CACHE_DIRS = [
  'Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache',
  'Session Storage', 'Local Storage', 'WebStorage', 'blob_storage',
  'Cookies', 'Cookies-journal', 'DIPS', 'DIPS-wal',
  'Network Persistent State', 'Preferences', 'Trust Tokens',
  'Trust Tokens-journal', 'Shared Dictionary', 'SharedStorage',
];

/** Module-level safe mode flag for the current launch */
let safeModeActive = false;

/**
 * Compute the Electron userData path without relying on app.getPath().
 * This must work before app.whenReady() resolves.
 */
function getUserDataDir(): string {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Quilltap');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Quilltap');
  }
  // Linux
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(configHome, 'Quilltap');
}

/** Path to the crash guard state file */
function stateFilePath(): string {
  return path.join(getUserDataDir(), 'quilltap-crash-guard.json');
}

/** Read the crash guard state from disk */
function readState(): CrashGuardState {
  try {
    const raw = fs.readFileSync(stateFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      consecutiveCrashes: typeof parsed.consecutiveCrashes === 'number' ? parsed.consecutiveCrashes : 0,
      lastStartTimestamp: typeof parsed.lastStartTimestamp === 'number' ? parsed.lastStartTimestamp : 0,
      safeMode: typeof parsed.safeMode === 'boolean' ? parsed.safeMode : false,
    };
  } catch {
    return { consecutiveCrashes: 0, lastStartTimestamp: 0, safeMode: false };
  }
}

/** Write the crash guard state to disk */
function writeState(state: CrashGuardState): void {
  try {
    const filePath = stateFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    console.error('[CrashGuard] Failed to write state:', err);
  }
}

/**
 * Run the crash guard check. Call this synchronously before app.whenReady().
 * Increments the crash counter on each launch. If the threshold is reached,
 * enters safe mode: clears Chromium caches, resets settings, and removes
 * macOS saved application state.
 */
export function runCrashGuard(): void {
  const state = readState();
  const newCount = state.consecutiveCrashes + 1;

  console.log(`[CrashGuard] Launch #${newCount} (threshold: ${CRASH_THRESHOLD})`);

  if (newCount >= CRASH_THRESHOLD) {
    console.log('[CrashGuard] Crash threshold reached — entering safe mode');
    safeModeActive = true;
    performSafeMode();
    // Reset counter so user gets fresh attempts after safe mode
    writeState({ consecutiveCrashes: 0, lastStartTimestamp: Date.now(), safeMode: true });
  } else {
    writeState({ consecutiveCrashes: newCount, lastStartTimestamp: Date.now(), safeMode: false });
  }
}

/**
 * Mark startup as successful. Call this after the main window is created
 * and the health check passes. Resets the crash counter to 0.
 */
export function markStartupSuccess(): void {
  console.log('[CrashGuard] Startup successful — resetting crash counter');
  writeState({ consecutiveCrashes: 0, lastStartTimestamp: Date.now(), safeMode: false });
}

/** Returns whether safe mode was triggered on this launch */
export function isInSafeMode(): boolean {
  return safeModeActive;
}

/**
 * Perform safe mode cleanup:
 * 1. Clear Chromium cache directories
 * 2. Remove macOS saved application state
 * 3. Reset settings to safe defaults (preserve data dir config)
 */
function performSafeMode(): void {
  const userDataDir = getUserDataDir();

  // 1. Clear Chromium cache directories
  for (const dir of CHROMIUM_CACHE_DIRS) {
    const target = path.join(userDataDir, dir);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch {
      // Ignore — directory may not exist
    }
  }
  console.log('[CrashGuard] Cleared Chromium cache directories');

  // 2. Remove macOS saved application state
  if (process.platform === 'darwin') {
    /* eslint-disable quilltap/no-quilltap-misspelling -- actual macOS bundle ID */
    const savedStatePath = path.join(
      os.homedir(), 'Library', 'Saved Application State',
      'com.foundry9.quilltap.savedState'
    );
    /* eslint-enable quilltap/no-quilltap-misspelling */
    try {
      fs.rmSync(savedStatePath, { recursive: true, force: true });
      console.log('[CrashGuard] Removed macOS saved application state');
    } catch {
      // Ignore — may not exist
    }
  }

  // 3. Reset settings to safe defaults (preserve directory config)
  const settingsFile = path.join(userDataDir, 'quilltap-settings.json');
  try {
    if (fs.existsSync(settingsFile)) {
      const raw = fs.readFileSync(settingsFile, 'utf-8');
      const settings = JSON.parse(raw);
      // Disable auto-start to prevent immediate re-crash
      settings.autoStart = false;
      // Reset data dir to platform default if it might be the problem
      const defaultDataDir = getDefaultDataDir();
      settings.lastDataDir = defaultDataDir;
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
      console.log('[CrashGuard] Reset settings: autoStart=false, lastDataDir=default');
    }
  } catch (err) {
    console.error('[CrashGuard] Failed to reset settings:', err);
  }
}

/** Get the platform default data directory (mirrors constants.ts DEFAULT_DATA_DIR) */
function getDefaultDataDir(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Quilltap');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Quilltap');
  }
  return path.join(os.homedir(), '.quilltap');
}
