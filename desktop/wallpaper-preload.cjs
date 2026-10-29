const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wallpaper', { action: action => ipcRenderer.send('dayan:wallpaper-action', action) });
