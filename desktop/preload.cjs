const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nextstepDesktop', Object.freeze({
  platform: process.platform,
  getAgents: () => ipcRenderer.invoke('nextstep:agents'),
  connectAgent: provider => ipcRenderer.invoke('nextstep:connect-agent', provider),
  openAgent: (provider,purpose) => ipcRenderer.invoke('nextstep:open-agent', provider,purpose),
  openCrmAgent: provider => ipcRenderer.invoke('nextstep:open-crm-agent',provider),
  getCollectionLayout: key => ipcRenderer.invoke('nextstep:collection-layout',key),
  setCollectionLayout: (key,value) => ipcRenderer.invoke('nextstep:set-collection-layout',key,value),
  getBoardSettings: key => ipcRenderer.invoke('nextstep:board-settings',key),
  setBoardSettings: (key,value) => ipcRenderer.invoke('nextstep:set-board-settings',key,value),
  getUpdateState: () => ipcRenderer.invoke('nextstep:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('nextstep:check-updates'),
  downloadUpdate: () => ipcRenderer.invoke('nextstep:download-update'),
  installUpdate: () => ipcRenderer.invoke('nextstep:install-update'),
  setAutomaticUpdates: value => ipcRenderer.invoke('nextstep:automatic-updates',value),
  onUpdateStateChanged: callback => { const listener = (_event,state) => callback(state); ipcRenderer.on('nextstep:update-state-changed',listener); return () => ipcRenderer.removeListener('nextstep:update-state-changed',listener); },
  chooseNotesFolder: () => ipcRenderer.invoke('nextstep:notes-folder'),
  getPreferences: () => ipcRenderer.invoke('nextstep:preferences'),
  setSidebarCollapsed: value => ipcRenderer.invoke('nextstep:set-sidebar-collapsed',value),
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
