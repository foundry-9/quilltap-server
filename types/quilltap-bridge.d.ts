/**
 * Type declarations for the Quilltap desktop bridge.
 *
 * When running inside the Quilltap Electron shell (separate repository),
 * `window.quilltap` is exposed via contextBridge. In a regular browser
 * this object does not exist — all consumers use optional chaining.
 */

interface QuilltapElectronBridge {
  // --- Splash lifecycle (only meaningful in the splash window) ---
  onUpdate: (callback: (data: unknown) => void) => void;
  onError: (callback: (data: unknown) => void) => void;
  retry: () => void;
  quit: () => void;

  // --- Directory chooser ---
  getDirectories: () => Promise<unknown>;
  selectDirectory: () => Promise<string>;
  removeDirectory: (dirPath: string) => void;
  startWithDirectory: (dirPath: string) => void;
  setAutoStart: (enabled: boolean) => void;
  showDirectoryChooser: () => void;
  onDirectories: (callback: (data: unknown) => void) => void;

  // --- File downloads (used by main app window) ---
  saveFile: (data: ArrayBuffer, filename: string) => Promise<boolean>;
  downloadUrl: (url: string) => Promise<void>;

  // --- Clipboard ---
  copyImageToClipboard: (dataUrl: string) => Promise<boolean>;

  // --- File system ---
  openPath: (dirPath: string) => Promise<void>;

  // --- Native menu bar (optional — present only when the shell builds one) ---
  /**
   * Register the page's handler for a native navigation menu click. The shell
   * sends the clicked item's id (`GET /api/v1/system/navigation`); the page
   * runs the same activator a rail click runs. Returns an unsubscribe when the
   * shell supplies one.
   */
  onNavigate?: (handler: (itemId: string) => void) => (() => void) | void;

  // --- Spellcheck (optional — present only when the shell ships the bridge) ---
  setDictionaryWords?: (words: string[]) => Promise<void>;
  setSpellCheckerLanguages?: (codes: string[]) => Promise<void>;
  getSpellCheckerStatus?: () => Promise<{
    enabled: boolean;
    languages: string[];
    availableLanguages: string[];
  }>;
}

declare global {
  interface Window {
    quilltap?: QuilltapElectronBridge;
  }
}

export {};
