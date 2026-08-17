const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('launcherAPI', {
  getConfig: () => ipcRenderer.invoke('get-client-config'),
  getSavedNickname: () => ipcRenderer.invoke('get-saved-nickname'),
  saveNickname: (nickname) => ipcRenderer.send('save-nickname', nickname),
  getSavedSpecies: () => ipcRenderer.invoke('get-saved-species'),
  saveSpecies: (species) => ipcRenderer.send('save-species', species),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  getSavedDisplayId: () => ipcRenderer.invoke('get-saved-display-id'),
  saveDisplayId: (displayId) => ipcRenderer.send('save-display-id', displayId),
  getSavedViewScale: () => ipcRenderer.invoke('get-saved-view-scale'),
  saveViewScale: (viewScale) => ipcRenderer.send('save-view-scale', viewScale),
  copyText: (text) => ipcRenderer.send('copy-to-clipboard', text),
  // params = { mode: 'offline' | 'multiplayer', nickname, species, displayId?, roomCode?, viewScale? }
  start: (params) => ipcRenderer.send('launcher-start', params),
})
