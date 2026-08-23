const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// Every window in the app looks the same, launcher or game, so the options
// live in one place rather than drifting between the two call sites.
const WINDOW_OPTIONS = {
  width: 1440,
  height: 900,
  minWidth: 960,
  minHeight: 600,
  backgroundColor: '#07080b',
  autoHideMenuBar: true,
  icon: path.join(__dirname, 'icons', 'icon-512.png'),
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
  },
};

// The pages that ship inside the build. Anything else asking for a window is
// the open web and belongs in the user's real browser.
const BUNDLED_PAGES = ['index.html', 'voidsignal.html', 'tetris.html', '2048.html', 'sensfinder.html'];

function isBundledPage(url) {
  if (!url.startsWith('file://')) return false;
  try {
    return BUNDLED_PAGES.includes(path.basename(decodeURIComponent(new URL(url).pathname)));
  } catch (e) {
    return false;
  }
}

// The launcher opens games with window.open so the library stays put behind
// them. Without a handler those windows would come up with Electron's own
// defaults — wrong size, white flash on load, menu bar showing — so they are
// given the same options as the window they came from.
function handleWindowOpen(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isBundledPage(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: WINDOW_OPTIONS };
    }
    // An external link should not open a chrome-less window with no way back
    // inside the app; hand it to the browser instead.
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // A game window can open windows of its own, so the rule has to follow the
  // children rather than applying only to the launcher.
  win.webContents.on('did-create-window', (child) => handleWindowOpen(child));
}

function createWindow() {
  const win = new BrowserWindow(WINDOW_OPTIONS);
  handleWindowOpen(win);
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
