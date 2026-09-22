const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nextstepDesktop', Object.freeze({
  getAgents: () => ipcRenderer.invoke('nextstep:agents'),
  connectAgent: provider => ipcRenderer.invoke('nextstep:connect-agent', provider),
  openAgent: (provider,purpose) => ipcRenderer.invoke('nextstep:open-agent', provider,purpose),
}));
