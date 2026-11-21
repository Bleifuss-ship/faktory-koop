// HTTP- und WebSocket-Server für "Fabrik-Koop".
// Jede Welt ("Raum") läuft hier auf dem Server, alle Spieler im Raum bauen gemeinsam.
'use strict';

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const VERSION = require('../package.json').version;
const { World, DEFS } = require('./game');

const TICK_MS = 100; // 10 Ticks pro Sekunde
const COLORS = ['#ff6b6b', '#4ecdc4', '#ffd93d', '#a78bfa', '#6bcb77', '#ff9f45', '#4d96ff', '#f472b6'];

// IPv4-Adressen im lokalen Netz, damit Mitspieler wissen, wohin sie sich verbinden
function lanAddresses(port) {
  const list = [];
  for (const ifs of Object.values(os.networkInterfaces())) {
    for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) list.push(`${i.address}:${port}`);
  }
  return list;
}

// Startet den Spielserver. Wird von der Kommandozeile und von der Desktop-App benutzt.
function startServer(opts = {}) {
  const PORT = opts.port ?? (Number(process.env.PORT) || 3000);
  const HOST = opts.host || process.env.HOST || '0.0.0.0';
  const SAVE_DIR = opts.saveDir || process.env.SAVE_DIR || path.join(__dirname, '..', 'saves');
  const PUBLIC_DIR = opts.publicDir || path.join(__dirname, '..', 'public');

  fs.mkdirSync(SAVE_DIR, { recursive: true });

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/info') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ game: 'fabrik-koop', version: VERSION, addresses: lanAddresses(server.address().port), local: isLocal(req), hostWorld: hostRoom() }));
      return;
    }
    if (url.pathname === '/worlds') {
      // Gespeicherte Welten nur für den eigenen Rechner auflisten
      if (!isLocal(req)) { res.writeHead(403); res.end('[]'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(listWorlds()));
      return;
    }
    const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
      // Nie zwischenspeichern, damit nach einem Update sofort der neue Stand geladen wird
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });

  // --- Räume ---
  const rooms = new Map();
  let lastHostRoom = null;

  // Spieler auf demselben Rechner wie der Server sind der Host
  function isLocal(req) {
    const a = (req.socket && req.socket.remoteAddress) || '';
    return a === '::1' || a.startsWith('127.') || a.startsWith('::ffff:127.');
  }

  function hasLocal(room) {
    return !!room && [...room.players.values()].some((p) => p.local);
  }

  // Die Welt, in der der Host gerade spielt. Wer mit Code beitritt, landet dort.
  function hostRoom() {
    if (hasLocal(rooms.get(lastHostRoom))) return lastHostRoom;
    for (const r of rooms.values()) if (hasLocal(r)) return r.name;
    return null;
  }

  function listWorlds() {
    const out = new Map();
    try {
      for (const f of fs.readdirSync(SAVE_DIR)) {
        if (!f.endsWith('.json')) continue;
        const st = fs.statSync(path.join(SAVE_DIR, f));
        out.set(f.slice(0, -5), { name: f.slice(0, -5), saved: st.mtimeMs, players: 0 });
      }
    } catch {}
    for (const r of rooms.values()) {
      const e = out.get(r.name) || { name: r.name, saved: Date.now() };
      e.players = r.players.size;
      if (r.players.size) e.saved = Date.now();
      out.set(r.name, e);
    }
    return [...out.values()].sort((a, b) => b.saved - a.saved);
  }

  function roomFile(name) { return path.join(SAVE_DIR, name + '.json'); }

  function cleanRoomName(name) {
    return String(name || 'start').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'start';
  }

  function getRoom(name) {
    if (rooms.has(name)) return rooms.get(name);
    let world;
    try {
      world = World.fromJSON(JSON.parse(fs.readFileSync(roomFile(name), 'utf8')));
    } catch {
      world = new World();
    }
    const room = { name, world, players: new Map(), dirty: true };
    rooms.set(name, room);
    return room;
  }

  function saveRoom(room, sync) {
    if (!room.dirty) return;
    room.dirty = false;
    const data = JSON.stringify(room.world.toJSON());
    if (sync) fs.writeFileSync(roomFile(room.name), data);
    else fs.writeFile(roomFile(room.name), data, () => {});
  }

  function send(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function broadcast(room, msg) {
    const s = JSON.stringify(msg);
    for (const p of room.players.values()) if (p.ws.readyState === 1) p.ws.send(s);
  }

  function playerList(room) {
    return [...room.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, host: p.local }));
  }

  // --- WebSocket ---
  const wss = new WebSocketServer({ server });
  let nextPlayerId = 1;

  wss.on('connection', (ws, req) => {
    const local = isLocal(req);
    let room = null;
    let player = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.t === 'join' && !room) {
        let name = msg.room;
        if (msg.code) {
          // Beitritt per Code: in die Welt des Hosts
          name = hostRoom();
          if (!name) { send(ws, { t: 'fail', text: 'Der Host ist gerade in keiner Welt. Er muss zuerst eine Welt starten.' }); return; }
        }
        room = getRoom(cleanRoomName(name));
        if (local) lastHostRoom = room.name;
        const used = new Set([...room.players.values()].map((p) => p.color));
        player = {
          id: nextPlayerId++,
          name: String(msg.name || 'Gast').slice(0, 16) || 'Gast',
          color: COLORS.find((c) => !used.has(c)) || COLORS[room.players.size % COLORS.length],
          ws,
          local,
          cursor: null,
        };
        room.players.set(player.id, player);
        send(ws, { t: 'init', you: player.id, room: room.name, version: VERSION, defs: DEFS, world: room.world.fullState(), players: playerList(room), host: local, share: local ? lanAddresses(server.address().port) : [] });
        broadcast(room, { t: 'players', players: playerList(room) });
        return;
      }
      if (!room) return;
      const w = room.world;

      switch (msg.t) {
        case 'place': {
          const cells = Array.isArray(msg.cells) ? msg.cells.slice(0, 200) : [msg];
          for (const c of cells) {
            const err = w.place(String(msg.kind), c.x | 0, c.y | 0, c.dir | 0);
            if (err && (cells.length === 1 || err.startsWith('Nicht genug Geld'))) { send(ws, { t: 'error', text: err }); if (cells.length > 1) break; }
          }
          room.dirty = true;
          break;
        }
        case 'remove': {
          const cells = Array.isArray(msg.cells) ? msg.cells.slice(0, 200) : [msg];
          for (const c of cells) w.remove(c.x | 0, c.y | 0);
          room.dirty = true;
          break;
        }
        case 'research': {
          const err = w.doResearch(String(msg.id));
          if (err) send(ws, { t: 'error', text: err });
          room.dirty = true;
          break;
        }
        case 'cursor':
          player.cursor = { x: +msg.x || 0, y: +msg.y || 0 };
          break;
        case 'chat':
          broadcast(room, { t: 'chat', from: player.name, color: player.color, text: String(msg.text || '').slice(0, 200) });
          break;
      }
    });

    ws.on('close', () => {
      if (!room) return;
      room.players.delete(player.id);
      broadcast(room, { t: 'players', players: playerList(room) });
    });
  });

  // --- Spielschleife ---
  const loop = setInterval(() => {
    for (const room of rooms.values()) {
      if (room.players.size === 0) continue; // leere Welten pausieren
      const w = room.world;
      w.step();
      const changes = w.changes;
      w.changes = [];
      const snap = w.snapshot();
      const msg = { t: 'tick', n: w.tick, items: snap.items, busy: snap.busy, cross: snap.cross, money: w.money };
      if (changes.length) msg.changes = changes;
      if (changes.some((c) => c.op === 'research') || w.tick % 5 === 0) {
        msg.research = w.research;
        msg.unlocked = w.unlocked();
        msg.beltSpeed = w.fullState().beltSpeed;
      }
      if (w.tick % 2 === 0) {
        msg.cursors = [...room.players.values()].filter((p) => p.cursor).map((p) => [p.id, p.cursor.x, p.cursor.y]);
      }
      if (w.tick % 10 === 0) room.dirty = true;
      broadcast(room, msg);
    }
  }, TICK_MS);

  const saver = setInterval(() => rooms.forEach((r) => saveRoom(r)), 15000);

  function saveAll() {
    rooms.forEach((r) => { r.dirty = true; saveRoom(r, true); });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, () => {
      const port = server.address().port;
      resolve({
        port,
        addresses: lanAddresses(port),
        saveAll,
        close() { clearInterval(loop); clearInterval(saver); saveAll(); wss.close(); server.close(); },
      });
    });
  });
}

module.exports = { startServer };

if (require.main === module) {
  startServer().then((srv) => {
    console.log(`Fabrik-Koop läuft auf http://localhost:${srv.port}`);
    srv.addresses.forEach((a) => console.log(`Mitspieler im Netzwerk: http://${a}`));
    const stop = () => { srv.saveAll(); process.exit(0); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}
