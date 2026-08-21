import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { registerHostHandlers } from '../host/register-handlers.js';
import { openStartupRepo } from '../host/services/repo.js';
import { setSessionBroadcaster } from '../host/services/sessions.js';
import { ipcMain } from 'electron';
import { loadTarget, rendererWebPreferences } from './window.js';

const DIST = join(import.meta.dirname, '..');
const DEV_SERVER_URL = process.env.KIRBY_VITE_URL;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Kirby',
    backgroundColor: '#0d1117',
    webPreferences: rendererWebPreferences(
      join(DIST, 'preload', 'preload.cjs')
    ),
  });

  const target = loadTarget(
    DEV_SERVER_URL,
    join(DIST, 'renderer', 'index.html')
  );
  if (target.kind === 'dev-server') {
    void win.loadURL(target.url);
  } else {
    void win.loadFile(target.path);
  }

  win.webContents.on('did-finish-load', () => {
    console.log('[desktop] renderer loaded');
  });

  return win;
}

// ── Host contract (main-process side) ────────────────────────────

registerHostHandlers(ipcMain);

setSessionBroadcaster((channel, payload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
});

// ── App lifecycle ────────────────────────────────────────────────

app.whenReady().then(() => {
  const opened = openStartupRepo();
  console.log(`[desktop] startup repo: ${opened ? opened.cwd : 'none'}`);

  void createMainWindow();

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked and
    // no windows are open.
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Unlike macOS, quitting when all windows close is expected on
  // Linux and Windows.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
