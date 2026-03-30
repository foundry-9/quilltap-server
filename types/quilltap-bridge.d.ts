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

  // --- File system ---
  openPath: (dirPath: string) => Promise<void>;
}

declare global {
  interface Window {
    quilltap?: QuilltapElectronBridge;
  }
}

export {};
