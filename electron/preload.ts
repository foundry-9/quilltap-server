import { contextBridge, ipcRenderer } from 'electron';
import { SplashUpdate } from './types';

contextBridge.exposeInMainWorld('quilltap', {
  onUpdate: (callback: (data: SplashUpdate) => void) => {
    ipcRenderer.on('splash:update', (_event, data: SplashUpdate) => callback(data));
  },
  onError: (callback: (data: SplashUpdate) => void) => {
    ipcRenderer.on('splash:error', (_event, data: SplashUpdate) => callback(data));
  },
  retry: () => ipcRenderer.send('splash:retry'),
  quit: () => ipcRenderer.send('splash:quit'),
});
