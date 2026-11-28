const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('motionLabDesktop', {
  exportPdf: (html, defaultName) => ipcRenderer.invoke('motionlab:export-pdf', { html, defaultName }),
});
