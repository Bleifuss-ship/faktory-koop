// Desktop-App (Linux/Windows): startet den Spielserver im Hintergrund und öffnet das Spiel.
// Andere Spieler im selben Netzwerk können über die angezeigte Adresse beitreten.
'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const { startServer } = require('../src/server');
const updater = require('./updater');

let srv = null;

async function boot() {
  const saveDir = path.join(app.getPath('userData'), 'saves');
  try {
    srv = await startServer({ port: 3000, saveDir });
  } catch (err) {
    // Port 3000 belegt (z. B. zweites Fenster): freien Port nehmen
    srv = await startServer({ port: 0, saveDir });
  }

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 480,
    minHeight: 400,
    title: 'Fabrik-Koop',
    backgroundColor: '#7cc8e8',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
  });
  // Externe Links im normalen Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://localhost:${srv.port}/`);

  // Update herunterladen und installieren (Knopf im Hauptmenü)
  ipcMain.handle('fk-update', async (e, url, name) => {
    try {
      const file = await updater.download(url, name, (p) => { if (!e.sender.isDestroyed()) e.sender.send('fk-update-progress', p); });
      if (srv) srv.saveAll();
      return await updater.install(file);
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  updater.cleanupOld(app.getVersion());
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (srv) srv.close(); });
