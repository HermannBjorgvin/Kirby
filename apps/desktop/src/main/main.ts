import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
} from 'electron';
import {
  registerHostHandlers,
  setExternalOpener,
  setFolderPicker,
} from '../host/register-handlers.js';
import { killAll } from '@kirby/app-core';
import { openStartupRepo } from '../host/services/repo.js';
import { setSessionBroadcaster } from '../host/services/sessions.js';
import { loadTarget, rendererWebPreferences, windowChrome } from './window.js';

const DIST = join(import.meta.dirname, '..');
const DEV_SERVER_URL = process.env.KIRBY_VITE_URL;

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Kirby',
    show: false,
    ...windowChrome(nativeTheme.shouldUseDarkColors),
    webPreferences: rendererWebPreferences(
      join(DIST, 'preload', 'preload.cjs')
    ),
  });

  // Keep the native overlay controls in step with the OS theme.
  nativeTheme.on('updated', () => {
    const chrome = windowChrome(nativeTheme.shouldUseDarkColors);
    if (chrome.titleBarOverlay && typeof chrome.titleBarOverlay === 'object') {
      try {
        win.setTitleBarOverlay(chrome.titleBarOverlay);
      } catch {
        // not supported on this platform
      }
    }
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

  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    console.log('[desktop] renderer loaded');
    void runQaSteps(win);
  });

  // Links in PR comments etc. open in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

// ── Headless QA hook ─────────────────────────────────────────────
// KIRBY_QA_STEPS='[{"js":"...","waitMs":500,"shot":"/tmp/a.png"}]'
// runs each step's JS in the page, waits, captures a PNG, then quits.
// Dev/CI only — lets us screenshot the real app under xvfb.

interface QaStep {
  js?: string;
  waitMs?: number;
  shot?: string;
}

async function runQaSteps(win: BrowserWindow): Promise<void> {
  const raw = process.env.KIRBY_QA_STEPS;
  if (!raw) return;
  let steps: QaStep[] = [];
  try {
    steps = JSON.parse(raw) as QaStep[];
  } catch (err) {
    console.error('[desktop] bad KIRBY_QA_STEPS:', err);
    app.quit();
    return;
  }
  const { writeFile } = await import('node:fs/promises');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Hidden/occluded windows may never paint, which makes capturePage
  // hang — force the window visible and un-throttled for the run.
  win.show();
  win.focus();
  win.webContents.setBackgroundThrottling(false);
  console.log(`[desktop] qa: ${steps.length} steps`);
  await sleep(1500);
  let i = 0;
  for (const step of steps) {
    i += 1;
    try {
      if (step.js) {
        const r: unknown = await win.webContents.executeJavaScript(
          step.js,
          true
        );
        console.log(`[desktop] qa step ${i} js →`, r);
      }
      await sleep(step.waitMs ?? 600);
      if (step.shot) {
        const img = await win.webContents.capturePage();
        await writeFile(step.shot, img.toPNG());
        console.log(`[desktop] qa step ${i} shot → ${step.shot}`);
      }
    } catch (err) {
      console.error(`[desktop] qa step ${i} failed:`, err);
    }
  }
  app.quit();
}

// ── Host contract (main-process side) ────────────────────────────

registerHostHandlers(ipcMain);

// Native folder picker — Electron glue lives here so the handler
// registry stays testable without Electron.
setFolderPicker(async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Open repository',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

setExternalOpener(async (url) => {
  if (!/^https?:/i.test(url)) throw new Error(`Refusing to open ${url}`);
  await shell.openExternal(url);
});

setSessionBroadcaster((channel, payload) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
});

// ── App lifecycle ────────────────────────────────────────────────

// One instance at a time: a second launch focuses the existing
// window instead of opening a competing (possibly stale-cached) one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

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
}

app.on('window-all-closed', () => {
  // Unlike macOS, quitting when all windows close is expected on
  // Linux and Windows.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Agent PTYs must never outlive the app (same guarantee as the TUI).
app.on('will-quit', () => {
  try {
    killAll();
  } catch {
    // nothing was running
  }
});
