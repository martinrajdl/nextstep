const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nextstepDesktop', Object.freeze({
  platform: process.platform,
  getAgents: () => ipcRenderer.invoke('nextstep:agents'),
  connectAgent: provider => ipcRenderer.invoke('nextstep:connect-agent', provider),
  openAgent: (provider,purpose) => ipcRenderer.invoke('nextstep:open-agent', provider,purpose),
  openCrmAgent: provider => ipcRenderer.invoke('nextstep:open-crm-agent',provider),
  getPreferences: () => ipcRenderer.invoke('nextstep:preferences'),
  setAppearance: color => ipcRenderer.invoke('nextstep:set-appearance',color),
  setTheme: theme => ipcRenderer.invoke('nextstep:set-theme',theme),
  setUsageEnabled: enabled => ipcRenderer.invoke('nextstep:set-usage',enabled),
  setBackend: url => ipcRenderer.invoke('nextstep:set-backend',url),
  onAppearanceChanged: callback => {
    const listener = (_event,color) => callback(color);
    ipcRenderer.on('nextstep:appearance-changed',listener);
    return () => ipcRenderer.removeListener('nextstep:appearance-changed',listener);
  },
  onThemeChanged: callback => {
    const listener = (_event,theme) => callback(theme);
    ipcRenderer.on('nextstep:theme-changed',listener);
    return () => ipcRenderer.removeListener('nextstep:theme-changed',listener);
  },
  onOpenSettings: callback => {
    const listener = () => callback();
    ipcRenderer.on('nextstep:open-settings',listener);
    return () => ipcRenderer.removeListener('nextstep:open-settings',listener);
  },
}));
