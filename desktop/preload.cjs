const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dayan', {
  load: () => ipcRenderer.invoke('dayan:load'),
  save: state => ipcRenderer.invoke('dayan:save', state),
  saveSync: state => ipcRenderer.sendSync('dayan:save-sync', state),
  windowAction: action => ipcRenderer.invoke('dayan:window-action', action),
  securitySetPassword: payload => ipcRenderer.invoke('dayan:security-set-password', payload),
  securityLock: () => ipcRenderer.invoke('dayan:security-lock'),
  securityVerify: password => ipcRenderer.invoke('dayan:security-verify', password),
  securityUnlockInput: enabled => ipcRenderer.invoke('dayan:security-unlock-input', enabled),
  onUnlockKey: callback => {
    const listener = (_event, key) => callback(key);
    ipcRenderer.on('dayan:unlock-key', listener);
    return () => ipcRenderer.removeListener('dayan:unlock-key', listener);
  },
  securityPolicyStatus: () => ipcRenderer.invoke('dayan:security-policy-status'),
  securityPolicyEnable: () => ipcRenderer.invoke('dayan:security-policy-enable'),
  securityPolicyRestore: () => ipcRenderer.invoke('dayan:security-policy-restore'),
  setAutoStart: enabled => ipcRenderer.invoke('dayan:auto-start', enabled),
  updateCheck: () => ipcRenderer.invoke('dayan:update-check'),
  updateInstall: () => ipcRenderer.invoke('dayan:update-install'),
  settingsSeen: () => ipcRenderer.invoke('dayan:settings-seen'),
  resizeStart: (corner, pointer) => ipcRenderer.send('dayan:resize-start', corner, pointer),
  resizeMove: pointer => ipcRenderer.send('dayan:resize-move', pointer),
  resizeEnd: () => ipcRenderer.send('dayan:resize-end'),
  onWindowState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('dayan:window-state', listener);
    return () => ipcRenderer.removeListener('dayan:window-state', listener);
  },
  onUpdateAvailable: callback => {
    const listener = (_event, info) => callback(info);
    ipcRenderer.on('dayan:update-available', listener);
    return () => ipcRenderer.removeListener('dayan:update-available', listener);
  },
  onUpdateProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('dayan:update-progress', listener);
    return () => ipcRenderer.removeListener('dayan:update-progress', listener);
  },
  onUpdateError: callback => {
    const listener = (_event, error) => callback(error);
    ipcRenderer.on('dayan:update-error', listener);
    return () => ipcRenderer.removeListener('dayan:update-error', listener);
  },
  onDesktopCommand: callback => {
    const listener = (_event, action) => callback(action);
    ipcRenderer.on('dayan:desktop-command', listener);
    return () => ipcRenderer.removeListener('dayan:desktop-command', listener);
  }
});
