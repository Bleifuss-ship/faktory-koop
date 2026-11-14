// Desktop-App (Linux/Windows): startet den Spielserver im Hintergrund und öffnet das Spiel.
// Andere Spieler im selben Netzwerk können über die angezeigte Adresse beitreten.
'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell } = require('electron');
const { startServer } = require('../src/server');

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
    backgroundColor: '#1b1f2a',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  // Externe Links im normalen Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.loadURL(`http://localhost:${srv.port}/`);
}

app.whenReady().then(boot);
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { if (srv) srv.close(); });
