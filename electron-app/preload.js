const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadConfig: () => ipcRenderer.invoke('load-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  loadKnowledge: () => ipcRenderer.invoke('load-knowledge'),
  saveKnowledge: (data) => ipcRenderer.invoke('save-knowledge', data),
  sendMessage: (data, attachment) => ipcRenderer.invoke('send-message', data, attachment),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  startVoiceRecognition: () => ipcRenderer.invoke('start-voice-recognition'),
  stopVoiceRecognition: () => ipcRenderer.invoke('stop-voice-recognition'),
  onVoiceStatus: (callback) => ipcRenderer.on('voice-status', callback),
  onVoiceResult: (callback) => ipcRenderer.on('voice-result', callback),
  onVoiceError: (callback) => ipcRenderer.on('voice-error', callback)
});