const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadKnowledge: () => ipcRenderer.invoke('load-knowledge'),
  saveKnowledge: (data) => ipcRenderer.invoke('save-knowledge', data),
  sendMessage: (data) => ipcRenderer.invoke('send-message', data),
  clearHistory: () => ipcRenderer.invoke('clear-history')
});