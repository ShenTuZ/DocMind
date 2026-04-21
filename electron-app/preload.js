const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

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
  onVoiceError: (callback) => ipcRenderer.on('voice-error', callback),
  processRAGFiles: (files) => ipcRenderer.invoke('process-rag-files', files),
  getKnowledgeStats: () => ipcRenderer.invoke('get-knowledge-stats'),
  searchKnowledge: (query) => ipcRenderer.invoke('search-knowledge', query),
  chatWithKnowledge: (query, filePath) => ipcRenderer.invoke('chat-with-knowledge', query, filePath),
  getKnowledgeFiles: () => ipcRenderer.invoke('get-knowledge-files'),
  deleteKnowledgeFile: (filePath) => ipcRenderer.invoke('delete-knowledge-file', filePath),
  onKnowledgeStream: (callback) => ipcRenderer.on('knowledge-stream', callback),
  processPageIndexFiles: (files) => ipcRenderer.invoke('process-pageindex-files', files),
  getPageIndexFiles: () => ipcRenderer.invoke('get-pageindex-files'),
  deletePageIndexFile: (filePath) => ipcRenderer.invoke('delete-pageindex-file', filePath),
  chatWithPageIndex: (query, filePath) => ipcRenderer.invoke('chat-with-pageindex', query, filePath),
  getOllamaModels: () => ipcRenderer.invoke('get-ollama-models'),
  loginSuccess: (data) => ipcRenderer.send('login-success', data),
  getUserHome: () => os.homedir(),
  // 日常文件管理
  uploadDailyFiles: (filePaths) => ipcRenderer.invoke('upload-daily-files', filePaths),
  getDailyFiles: () => ipcRenderer.invoke('get-daily-files'),
  downloadDailyFile: (filePath, filename) => ipcRenderer.invoke('download-daily-file', filePath, filename),
  deleteDailyFile: (fileId) => ipcRenderer.invoke('delete-daily-file', fileId)
});