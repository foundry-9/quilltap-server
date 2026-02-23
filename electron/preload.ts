import { contextBridge, ipcRenderer } from 'electron';
import { SplashUpdate, DirectoryInfo } from './types';

contextBridge.exposeInMainWorld('quilltap', {
  // --- Existing splash lifecycle ---
  onUpdate: (callback: (data: SplashUpdate) => void) => {
    ipcRenderer.on('splash:update', (_event, data: SplashUpdate) => callback(data));
  },
  onError: (callback: (data: SplashUpdate) => void) => {
    ipcRenderer.on('splash:error', (_event, data: SplashUpdate) => callback(data));
  },
  retry: () => ipcRenderer.send('splash:retry'),
  quit: () => ipcRenderer.send('splash:quit'),

  // --- Directory chooser ---
  /** Request the current directory list and settings */
  getDirectories: (): Promise<DirectoryInfo> => ipcRenderer.invoke('splash:get-directories'),
  /** Open native folder picker and return chosen path (or empty string if cancelled) */
  selectDirectory: (): Promise<string> => ipcRenderer.invoke('splash:select-directory'),
  /** Set the runtime mode (docker or vm) */
  setRuntimeMode: (mode: string) => ipcRenderer.send('splash:set-runtime-mode', mode),
  /** Delete a directory with confirmation action ('config-only' or 'config-and-data') */
  deleteDirectory: (dirPath: string, action: string): Promise<boolean> =>
    ipcRenderer.invoke('splash:delete-directory', dirPath, action),
  /** Rename a directory's display name */
  renameDirectory: (dirPath: string, newName: string): Promise<boolean> =>
    ipcRenderer.invoke('splash:rename-directory', dirPath, newName),
  /** Save chosen directory and begin startup */
  startWithDirectory: (dirPath: string) => ipcRenderer.send('splash:start', dirPath),
  /** Toggle auto-start preference */
  setAutoStart: (enabled: boolean) => ipcRenderer.send('splash:set-auto-start', enabled),
  /** Interrupt auto-start to show directory chooser */
  showDirectoryChooser: () => ipcRenderer.send('splash:show-chooser'),
  /** Receive updated directory info from main process */
  onDirectories: (callback: (data: DirectoryInfo) => void) => {
    ipcRenderer.on('splash:directories', (_event, data: DirectoryInfo) => callback(data));
  },

  // --- File downloads (used by main app window) ---
  /** Save file data to disk via native save dialog (for blobs already in memory) */
  saveFile: (data: ArrayBuffer, filename: string): Promise<boolean> =>
    ipcRenderer.invoke('app:save-file', data, filename),
  /** Download a URL to disk via native save dialog (streams to disk, no memory pressure) */
  downloadUrl: (url: string): Promise<void> =>
    ipcRenderer.invoke('app:download-url', url),

  // --- File system ---
  /** Open a path in the host's file browser */
  openPath: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke('app:open-path', dirPath),
});
