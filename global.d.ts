/**
 * Global type declarations for Quilltap
 *
 * Ambient types that augment the global scope for Electron preload bridge
 * and webpack/bundler internals.
 */

// ---------------------------------------------------------------------------
// Electron preload bridge (exposed via contextBridge in electron/preload.ts)
// ---------------------------------------------------------------------------

interface QuilltapPreloadBridge {
  // Splash lifecycle
  onUpdate: (callback: (data: unknown) => void) => void;
  onError: (callback: (data: unknown) => void) => void;
  retry: () => void;
  quit: () => void;

  // Directory chooser
  getDirectories: () => Promise<unknown>;
  selectDirectory: () => Promise<string>;
  setRuntimeMode: (mode: string) => void;
  deleteDirectory: (dirPath: string, action: string) => Promise<boolean>;
  renameDirectory: (dirPath: string, newName: string) => Promise<boolean>;
  startWithDirectory: (dirPath: string) => void;
  setAutoStart: (enabled: boolean) => void;
  showDirectoryChooser: () => void;
  onDirectories: (callback: (data: unknown) => void) => void;

  // File downloads
  saveFile: (data: ArrayBuffer, filename: string) => Promise<boolean>;
  downloadUrl: (url: string) => Promise<void>;

  // File system
  openPath: (dirPath: string) => Promise<void>;

  // Workspace
  applyQuarantine: (filePath: string) => Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Webpack internals — __non_webpack_require__
// ---------------------------------------------------------------------------
// Webpack provides this global so code can call native Node.js require()
// without the bundler intercepting and rewriting the call.

export {};

declare global {
  interface Window {
    quilltap?: QuilltapPreloadBridge;
  }

  // eslint-disable-next-line no-var
  var __non_webpack_require__: NodeRequire | undefined;
}
