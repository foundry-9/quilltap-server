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
  /** Remove a directory from the known list */
  removeDirectory: (dirPath: string) => ipcRenderer.send('splash:remove-directory', dirPath),
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
});
