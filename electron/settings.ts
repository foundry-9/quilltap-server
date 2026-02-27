import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { DEFAULT_DATA_DIR } from './constants';
import { NamedDataDir, RuntimeMode } from './types';

/** Persisted application settings for data directory management */
export interface AppSettings {
  /** Last-used data directory path */
  lastDataDir: string;
  /** All directories the user has used or added */
  knownDataDirs: NamedDataDir[];
  /** Whether to auto-start with lastDataDir (skip chooser) */
  autoStart: boolean;
  /** Runtime mode: 'docker', 'vm' (Lima/WSL2), or 'npx' (Node.js) */
  runtimeMode: RuntimeMode;
}

/** Derive a human-readable name for a data directory path */
export function defaultNameForPath(dirPath: string): string {
  if (dirPath === DEFAULT_DATA_DIR) return 'Default';
  return path.basename(dirPath) || dirPath;
}

/** Default settings for first launch */
function defaultSettings(): AppSettings {
  return {
    lastDataDir: DEFAULT_DATA_DIR,
    knownDataDirs: [{ path: DEFAULT_DATA_DIR, name: 'Default' }],
    autoStart: false,
    runtimeMode: process.platform === 'linux' ? 'docker' : 'vm',
  };
}

/** Path to the settings JSON file in Electron's userData directory */
function settingsPath(): string {
  return path.join(app.getPath('userData'), 'quilltap-settings.json');
}

/** Load persisted settings, returning defaults if none exist */
export function loadSettings(): AppSettings {
  const filePath = settingsPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      console.log('[Settings] Loaded settings from', filePath);

      // Merge with defaults for forward-compatibility
      const defaults = defaultSettings();

      // Migrate knownDataDirs from old string[] format to NamedDataDir[]
      let knownDataDirs: NamedDataDir[] = defaults.knownDataDirs;
      if (Array.isArray(parsed.knownDataDirs) && parsed.knownDataDirs.length > 0) {
        if (typeof parsed.knownDataDirs[0] === 'string') {
          // Old format: string[] — migrate to NamedDataDir[]
          console.log('[Settings] Migrating knownDataDirs from string[] to NamedDataDir[]');
          knownDataDirs = (parsed.knownDataDirs as string[]).map((dirPath: string) => ({
            path: dirPath,
            name: defaultNameForPath(dirPath),
          }));
        } else {
          // New format: NamedDataDir[]
          knownDataDirs = parsed.knownDataDirs;
        }
      }

      return {
        lastDataDir: parsed.lastDataDir || defaults.lastDataDir,
        knownDataDirs,
        autoStart: typeof parsed.autoStart === 'boolean' ? parsed.autoStart : defaults.autoStart,
        runtimeMode: process.platform === 'linux' ? 'docker'
          : (parsed.runtimeMode === 'docker' ? 'docker'
            : parsed.runtimeMode === 'npx' ? 'npx' : 'vm'),
      };
    }
  } catch (err) {
    console.warn('[Settings] Failed to load settings, using defaults:', err);
  }

  console.log('[Settings] No settings file found, using defaults');
  return defaultSettings();
}

/** Save settings to disk */
export function saveSettings(settings: AppSettings): void {
  const filePath = settingsPath();
  try {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    console.log('[Settings] Saved settings to', filePath);
  } catch (err) {
    console.error('[Settings] Failed to save settings:', err);
  }
}
