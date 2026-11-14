const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
function createPresentationEditor() {
  let window, pending = 'settings-toggle';
  return {
    get window() { return window && !window.isDestroyed() ? window : null; },
    close() { if (window && !window.isDestroyed()) window.close(); },
    async open(action) {
      pending = action;
      const area = screen.getPrimaryDisplay().workArea;
      const width = Math.min(600, area.width), height = Math.min(660, area.height);
      const bounds = { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height };
      if (window && !window.isDestroyed()) {
        window.show(); window.focus();
        window.webContents.send('dayan:desktop-command', action);
        return;
      }
      window = new BrowserWindow({ ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: true, skipTaskbar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
      window.setAlwaysOnTop(true, 'floating');
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', event => event.preventDefault());
      const created = window;
      window.on('closed', () => { if (window === created) window = null; });
      await window.loadFile(path.join(__dirname, '../index.html'), { query: { editor: '1' } });
    },
    ready(sender) {
      if (sender !== window?.webContents) return false;
      window.webContents.send('dayan:desktop-command', pending);
      window.show(); window.focus();
      return true;
    }
  };
}
module.exports = { createPresentationEditor };
