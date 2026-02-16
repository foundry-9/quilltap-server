/**
 * Type declarations for the Quilltap Electron preload bridge.
 *
 * When running inside Electron, `window.quilltap` is exposed via contextBridge
 * in electron/preload.ts. In a regular browser this object does not exist.
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
}

declare global {
  interface Window {
    quilltap?: QuilltapElectronBridge;
  }
}

export {};
