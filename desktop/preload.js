// Brücke zwischen Spielseite und Desktop-App (nur für Updates)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fkDesktop', {
  platform: process.platform,
  update(url, name, onProgress) {
    const listener = (_e, p) => onProgress && onProgress(p);
    ipcRenderer.on('fk-update-progress', listener);
    return ipcRenderer.invoke('fk-update', url, name).finally(() => ipcRenderer.removeListener('fk-update-progress', listener));
  },
});
