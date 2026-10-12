const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nextstepDesktop', Object.freeze({
  getAgents: () => ipcRenderer.invoke('nextstep:agents'),
  connectAgent: provider => ipcRenderer.invoke('nextstep:connect-agent', provider),
  openAgent: (provider,purpose) => ipcRenderer.invoke('nextstep:open-agent', provider,purpose),
  getPreferences: () => ipcRenderer.invoke('nextstep:preferences'),
  setAppearance: color => ipcRenderer.invoke('nextstep:set-appearance',color),
  setBackend: url => ipcRenderer.invoke('nextstep:set-backend',url),
  onAppearanceChanged: callback => {
    const listener = (_event,color) => callback(color);
    ipcRenderer.on('nextstep:appearance-changed',listener);
    return () => ipcRenderer.removeListener('nextstep:appearance-changed',listener);
  },
  onOpenSettings: callback => {
    const listener = () => callback();
    ipcRenderer.on('nextstep:open-settings',listener);
    return () => ipcRenderer.removeListener('nextstep:open-settings',listener);
  },
}));
