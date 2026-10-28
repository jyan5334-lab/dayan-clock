const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dayan', {
  load: () => ipcRenderer.invoke('dayan:load'),
  save: state => ipcRenderer.invoke('dayan:save', state),
  saveSync: state => ipcRenderer.sendSync('dayan:save-sync', state),
  windowAction: action => ipcRenderer.invoke('dayan:window-action', action),
  securitySetPassword: payload => ipcRenderer.invoke('dayan:security-set-password', payload),
  securityLock: () => ipcRenderer.invoke('dayan:security-lock'),
  securityVerify: password => ipcRenderer.invoke('dayan:security-verify', password),
  securityPolicyStatus: () => ipcRenderer.invoke('dayan:security-policy-status'),
  securityPolicyEnable: () => ipcRenderer.invoke('dayan:security-policy-enable'),
  securityPolicyRestore: () => ipcRenderer.invoke('dayan:security-policy-restore'),
  settingsSeen: () => ipcRenderer.invoke('dayan:settings-seen'),
  resizeStart: (corner, pointer) => ipcRenderer.send('dayan:resize-start', corner, pointer),
  resizeMove: pointer => ipcRenderer.send('dayan:resize-move', pointer),
  resizeEnd: () => ipcRenderer.send('dayan:resize-end'),
  onWindowState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('dayan:window-state', listener);
    return () => ipcRenderer.removeListener('dayan:window-state', listener);
  }
});
