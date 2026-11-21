// Updates für die Desktop-App: lädt die neue Version von GitHub und installiert sie.
// Windows (portable .exe): neue Datei neben die alte legen, starten, alte beenden.
// Linux (.deb): herunterladen und mit pkexec + apt-get installieren, danach neu starten.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');

function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

// Wo die neue Datei hin soll
function targetDir() {
  if (process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE) return path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  return app.getPath('downloads');
}

async function download(url, name, onProgress) {
  if (!/^https:\/\/(github\.com|objects\.githubusercontent\.com|release-assets\.githubusercontent\.com)\//.test(url)) throw new Error('Unbekannte Download-Adresse');
  const safe = path.basename(name);
  if (!/^FabrikKoop-[\d.]+-(linux-amd64\.deb|windows-x64-portable\.exe)$/.test(safe)) throw new Error('Unerwarteter Dateiname');
  const file = path.join(targetDir(), safe);
  const part = file + '.download';
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error('Download fehlgeschlagen (' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(part);
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
    onProgress(total ? Math.min(1, got / total) : 0);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  fs.renameSync(part, file);
  return file;
}

function run(cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: 'ignore' });
    p.on('error', () => resolve(-1));
    p.on('exit', (code) => resolve(code));
  });
}

async function install(file) {
  if (process.platform === 'win32') {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
    return { ok: true, restarting: true };
  }
  if (process.platform === 'linux') {
    // Fragt nach dem Passwort (wie beim Installieren aus dem App-Store)
    const code = await run('pkexec', ['apt-get', 'install', '-y', '--allow-downgrades', file]);
    if (code === 0) {
      app.relaunch();
      setTimeout(() => app.quit(), 300);
      return { ok: true, restarting: true };
    }
    // Ohne pkexec oder abgebrochen: Paket im Software-Center öffnen
    await shell.openPath(file);
    return { ok: true, restarting: false, file };
  }
  await shell.openPath(file);
  return { ok: true, restarting: false, file };
}

// Alte portable Versionen im selben Ordner aufräumen (nach dem Update-Neustart)
function cleanupOld(current) {
  if (process.platform !== 'win32' || !process.env.PORTABLE_EXECUTABLE_FILE) return;
  const dir = path.dirname(process.env.PORTABLE_EXECUTABLE_FILE);
  const self = path.basename(process.env.PORTABLE_EXECUTABLE_FILE);
  let tries = 0;
  const sweep = () => {
    let left = 0;
    for (const f of fs.readdirSync(dir)) {
      const m = /^FabrikKoop-([\d.]+)-windows-x64-portable\.exe$/.exec(f);
      if (!m || f === self || cmpVersion(m[1], current) >= 0) continue;
      try { fs.unlinkSync(path.join(dir, f)); } catch { left++; }
    }
    if (left && ++tries < 10) setTimeout(sweep, 3000);
  };
  setTimeout(sweep, 3000);
}

module.exports = { cmpVersion, download, install, cleanupOld };
