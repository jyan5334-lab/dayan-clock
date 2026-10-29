const path = require('node:path');
const { BrowserWindow, ipcMain, screen } = require('electron');

function createWallpaperControls({ enabled, host, onAction }) {
  let window, lastInside = 0, checking = false;
  const actions = new Set(['style-toggle', 'settings-toggle', 'background', 'fullscreen', 'lock', 'minimize', 'close']);
  const hide = () => { if (window && !window.isDestroyed()) window.hide(); };
  const receive = (event, action) => {
    if (event.sender !== window?.webContents || !enabled() || !actions.has(action)) return;
    hide();
    Promise.resolve(onAction(action)).catch(error => console.error('Wallpaper control failed:', error.message));
  };
  ipcMain.on('dayan:wallpaper-action', receive);
  const poll = setInterval(async () => {
    if (!enabled()) { hide(); return; }
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    if (window?.isVisible()) {
      const rect = window.getBounds();
      if (point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height) lastInside = Date.now();
      if (Date.now() - lastInside > 1000) hide();
      return;
    }
    if (point.y < display.bounds.y || point.y > display.bounds.y + 3 || checking) return;
    checking = true;
    try {
      const nativePoint = screen.dipToScreenPoint(point);
      const hit = await host.run(['point', nativePoint.x, nativePoint.y]);
      if (!['SysListView32', 'SHELLDLL_DefView', 'WorkerW', 'Progman'].includes(hit.window.cls) || !enabled()) return;
      if (!window || window.isDestroyed()) {
        window = new BrowserWindow({ width:348, height:42, frame:false, resizable:false, skipTaskbar:true, show:false, focusable:false, backgroundColor:'#0c1215', webPreferences:{ preload:path.join(__dirname, 'wallpaper-preload.cjs'), nodeIntegration:false, contextIsolation:true, sandbox:true } });
        window.setAlwaysOnTop(true, 'floating');
        window.webContents.setWindowOpenHandler(() => ({ action:'deny' }));
        window.webContents.on('will-navigate', event => event.preventDefault());
        await window.loadFile(path.join(__dirname, 'wallpaper-controls.html'));
      }
      window.setBounds({ x:display.bounds.x + display.bounds.width - 372, y:display.bounds.y, width:348, height:42 }, false);
      lastInside = Date.now();
      if (enabled()) window.showInactive();
    } catch (error) { console.error('Wallpaper toolbar failed:', error.message); }
    finally { checking = false; }
  }, 150);
  poll.unref();
  return { hide, destroy() { clearInterval(poll); ipcMain.removeListener('dayan:wallpaper-action', receive); if (window && !window.isDestroyed()) window.destroy(); } };
}
module.exports = { createWallpaperControls };
