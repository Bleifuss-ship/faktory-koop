// Client von "Fabrik-Koop": Darstellung, Eingabe und Verbindung zum Server.
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  // 3D-Darstellung, wenn WebGL geht. Mit ?2d in der Adresse oder ohne WebGL gibt es die flache Ansicht.
  let r3d = null;
  try {
    if (window.Render3D && !/[?&]2d\b/.test(location.search)) r3d = window.Render3D.create(canvas);
  } catch (err) {
    console.warn('3D nicht verfügbar, nutze 2D', err);
  }
  const ctx = r3d ? null : canvas.getContext('2d');

  // ---------- Zustand ----------
  let ws = null;
  let defs = null;
  let me = null;
  const world = { w: 0, h: 0, tiles: '', buildings: new Map(), grid: new Map(), ground: null, version: 0 };
  let items = [];
  let busy = new Map();
  let research = null;
  let unlocked = [];
  let beltSpeed = 0.125;
  let players = [];
  let cursors = new Map();
  let lastTickAt = performance.now();

  const cam = { x: 0, y: 0, zoom: 40 };
  if (r3d) r3d.view.cam = cam;
  let tool = 'hand';
  let dir = 0;
  let hover = null;
  let dpr = 1;

  let TOOLS = ['hand', 'delete'];
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

  // ---------- Verbindung ----------
  // In der Handy-App gibt es keinen eigenen Server, dort muss eine Adresse eingetragen werden.
  const isApp = !!window.Capacitor || !/^https?:$/.test(location.protocol);

  function wsUrl(server) {
    let s = (server || '').trim();
    if (!s) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const secure = /^(https|wss):\/\//i.test(s);
    s = s.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
    if (!/:\d+$/.test(s) && !secure) s += ':3000';
    return `${secure ? 'wss' : 'ws'}://${s}`;
  }

  let everConnected = false;
  function connect(name, room, server) {
    ws = new WebSocket(wsUrl(server));
    ws.onopen = () => { everConnected = true; ws.send(JSON.stringify({ t: 'join', name, room })); };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => {
      if (!everConnected) {
        // Erste Verbindung fehlgeschlagen: zurück zum Startbildschirm
        $('join').classList.remove('hidden');
        $('server-hint').textContent = `Keine Verbindung zu ${server || 'diesem Rechner'}. Stimmt die Adresse, und läuft dort das Spiel?`;
        $('server-hint').style.color = '#ff8a7a';
        return;
      }
      toast('Verbindung verloren, verbinde neu …');
      setTimeout(() => connect(name, room, server), 2000);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function handle(m) {
    switch (m.t) {
      case 'init':
        defs = m.defs;
        me = m.you;
        loadWorld(m.world);
        players = m.players;
        renderPlayers();
        buildToolbar();
        if (!cam.x) { cam.x = world.w / 2; cam.y = world.h / 2; }
        history.replaceState(null, '', '?welt=' + encodeURIComponent(m.room));
        document.title = 'Fabrik-Koop ' + (m.version || '');
        toast(`Fabrik-Koop ${m.version || ''} · Welt „${m.room}“ · Karte ${world.w} × ${world.h}`, 4500);
        break;
      case 'tick':
        items = m.items;
        busy = new Map();
        for (let i = 0; i < m.busy.length; i += 2) busy.set(m.busy[i], m.busy[i + 1]);
        lastTickAt = performance.now();
        if (m.changes) for (const c of m.changes) applyChange(c);
        if (m.research) {
          const before = unlocked.join();
          research = m.research;
          unlocked = m.unlocked;
          beltSpeed = m.beltSpeed;
          if (before !== unlocked.join()) buildToolbar();
          renderResearch();
        }
        if (m.cursors) {
          cursors = new Map(m.cursors.filter((c) => c[0] !== me).map((c) => [c[0], { x: c[1], y: c[2] }]));
        }
        break;
      case 'players':
        players = m.players;
        renderPlayers();
        break;
      case 'error':
        toast(m.text);
        break;
      case 'chat':
        toast(`${m.from}: ${m.text}`);
        break;
    }
  }

  function loadWorld(w) {
    world.w = w.w;
    world.h = w.h;
    world.tiles = w.tiles;
    world.buildings.clear();
    world.grid.clear();
    for (const b of w.buildings) addBuilding(b);
    research = w.research;
    unlocked = w.unlocked;
    beltSpeed = w.beltSpeed;
    if (r3d) r3d.setWorld(world);
    else renderGround();
    renderResearch();
    renderMinimapBase();
  }

  // ---------- Übersichtskarte ----------
  // Ein Pixel pro Feld; Gebäude und Kameraposition werden laufend darübergezeichnet.
  const mini = { el: $('minimap'), base: null, drawn: 0 };
  const MINI_COL = { '.': '#9bd16f', '~': '#4aa6d6', h: '#4f9a4a', t: '#b4b8c0', e: '#b0705e', k: '#f0943c', c: '#3a3d46', w: '#9a8cd0', u: '#7ad94a', q: '#f0e0a8', b: '#c0603a', s: '#f2dc3a', g: '#e8c040' };
  function renderMinimapBase() {
    const b = document.createElement('canvas');
    b.width = world.w; b.height = world.h;
    const g = b.getContext('2d');
    const img = g.createImageData(world.w, world.h);
    const rgb = {};
    for (const [k, v] of Object.entries(MINI_COL)) rgb[k] = [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
    for (let i = 0; i < world.w * world.h; i++) {
      const c = rgb[world.tiles[i]] || rgb['.'];
      img.data.set([c[0], c[1], c[2], 255], i * 4);
    }
    g.putImageData(img, 0, 0);
    mini.base = b;
    mini.el.width = world.w; mini.el.height = world.h;
    mini.el.classList.add('on');
  }
  function drawMinimap() {
    if (!mini.base || mini.el.classList.contains('off')) return;
    const now = performance.now();
    if (now - mini.drawn < 200) return;
    mini.drawn = now;
    const g = mini.el.getContext('2d');
    g.drawImage(mini.base, 0, 0);
    for (const b of world.buildings.values()) {
      g.fillStyle = b.kind === 'band' ? '#596173' : b.kind === 'zentrale' ? '#9a7cf2' : (KIND_COLORS[b.kind] || ['#fff'])[0];
      g.fillRect(b.x, b.y, b.size, b.size);
    }
    // Sichtbereich: die vier Bildschirmecken auf den Boden projiziert
    const pts = [[0, 0], [innerWidth, 0], [innerWidth, innerHeight], [0, innerHeight]].map(([x, y]) => toWorld(x, y));
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(1, world.w / 110);
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.stroke();
    for (const p of players) {
      const c = cursors.get(p.id);
      if (!c || p.id === me) continue;
      g.fillStyle = p.color;
      g.beginPath(); g.arc(c.x, c.y, world.w / 60, 0, Math.PI * 2); g.fill();
    }
  }
  function miniJump(e) {
    const r = mini.el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * world.w;
    const y = ((e.clientY - r.top) / r.height) * world.h;
    if (r3d) { r3d.view.cam.x = x; r3d.view.cam.y = y; } else { cam.x = x; cam.y = y; }
  }
  mini.el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    mini.el.setPointerCapture(e.pointerId);
    miniJump(e);
    const move = (ev) => miniJump(ev);
    const up = () => { mini.el.removeEventListener('pointermove', move); mini.el.removeEventListener('pointerup', up); };
    mini.el.addEventListener('pointermove', move);
    mini.el.addEventListener('pointerup', up);
  });

  function addBuilding(b) {
    const old = world.buildings.get(b.id);
    if (old) removeBuilding(b.id);
    world.buildings.set(b.id, b);
    world.version++;
    for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) world.grid.set((b.x + x) + ',' + (b.y + y), b);
  }

  function removeBuilding(id) {
    const b = world.buildings.get(id);
    if (!b) return;
    for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) world.grid.delete((b.x + x) + ',' + (b.y + y));
    world.buildings.delete(id);
    world.version++;
  }

  function applyChange(c) {
    if (c.op === 'add') addBuilding(c.b);
    else if (c.op === 'del') removeBuilding(c.id);
    else if (c.op === 'research') {
      const done = defs.TECHS.find((t) => t.id === c.id);
      if (done) toast(done.win ? `🎉 ${done.name} geschafft! Eure Fabrik ist fertig.` : `Erforscht: ${done.name}! ${done.text}`, 4500);
      renderTechTree();
    }
  }

  // ---------- Boden vorrendern ----------
  function renderGround() {
    const S = Math.max(12, Math.min(32, Math.floor(4096 / Math.max(world.w, world.h))));
    const g = document.createElement('canvas');
    g.width = world.w * S;
    g.height = world.h * S;
    const c = g.getContext('2d');
    const hash = (x, y, k = 0) => {
      let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
      h = (h ^ (h >>> 13)) * 1274126177;
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    // Wiese mit sanften Farbflecken
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const n = (Math.sin(x * 0.35) + Math.cos(y * 0.29) + Math.sin((x + y) * 0.17)) / 6 + hash(x, y) * 0.08;
        const l = 62 + n * 10;
        c.fillStyle = `hsl(${96 + n * 12}, 52%, ${l}%)`;
        c.fillRect(x * S, y * S, S, S);
      }
    }
    // Seen und Flüsse: Ufer, Wasser, kleine Wellen
    const isW = (x, y) => world.tiles[y * world.w + x] === '~';
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (!isW(x, y)) continue;
        c.fillStyle = '#e8d9a0';
        c.beginPath(); c.arc(x * S + S / 2, y * S + S / 2, S * 0.78, 0, Math.PI * 2); c.fill();
      }
    }
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (!isW(x, y)) continue;
        c.fillStyle = '#5fb8e0';
        c.beginPath(); c.arc(x * S + S / 2, y * S + S / 2, S * 0.62, 0, Math.PI * 2); c.fill();
      }
    }
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (!isW(x, y)) continue;
        const deep = isW(x - 1, y) && isW(x + 1, y) && isW(x, y - 1) && isW(x, y + 1);
        c.fillStyle = deep ? '#4aa6d6' : '#5fb8e0';
        c.fillRect(x * S, y * S, S, S);
        if (hash(x, y, 7) < 0.25) {
          c.strokeStyle = 'rgba(255,255,255,0.6)';
          c.lineWidth = Math.max(1, S / 14);
          const px = x * S + S * 0.5, py = y * S + S * 0.5;
          c.beginPath(); c.moveTo(px - S * 0.25, py); c.quadraticCurveTo(px - S * 0.12, py - S * 0.12, px, py); c.quadraticCurveTo(px + S * 0.12, py - S * 0.12, px + S * 0.25, py); c.stroke();
        }
      }
    }
    // Grasbüschel und Blumen
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        if (world.tiles[y * world.w + x] !== '.') continue;
        const r = hash(x, y, 1);
        const px = x * S + 6 + hash(x, y, 2) * (S - 12);
        const py = y * S + 6 + hash(x, y, 3) * (S - 12);
        if (r < 0.28) {
          c.strokeStyle = 'rgba(70,130,50,0.45)';
          c.lineWidth = 1.6;
          c.lineCap = 'round';
          c.beginPath();
          c.moveTo(px - 3, py + 3); c.lineTo(px - 4, py - 2);
          c.moveTo(px, py + 3); c.lineTo(px, py - 4);
          c.moveTo(px + 3, py + 3); c.lineTo(px + 4, py - 2);
          c.stroke();
        } else if (r < 0.34) {
          c.fillStyle = ['#ffffff', '#ffe066', '#ffb3c7'][Math.floor(hash(x, y, 4) * 3)];
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            c.beginPath(); c.arc(px + Math.cos(a) * 2.2, py + Math.sin(a) * 2.2, 1.6, 0, Math.PI * 2); c.fill();
          }
          c.fillStyle = '#f5a524';
          c.beginPath(); c.arc(px, py, 1.4, 0, Math.PI * 2); c.fill();
        }
      }
    }
    // Vorkommen: helle Bodenflecken mit Steinen, Kristallen oder Sandhügeln
    const DEP = {
      h: { soil: '#7fb85a', main: '#4f9a4a', light: '#7cc46a', dark: '#2f6a34' },
      t: { soil: '#c4c8b8', main: '#a4aab4', light: '#d4d8e0', dark: '#7a808c' },
      e: { soil: '#c4ae9e', main: '#9a5a4e', light: '#c48a7e', dark: '#6a3a32' },
      k: { soil: '#c8cf9a', main: '#f0943c', light: '#6fd8c0', dark: '#c0682a' },
      c: { soil: '#9a9a8a', main: '#3a3d46', light: '#6a6e7a', dark: '#22242a' },
      w: { soil: '#b4b0c8', main: '#8a7fb0', light: '#c8c0ee', dark: '#5f5488' },
      u: { soil: '#a8b890', main: '#7ad94a', light: '#d4ff9a', dark: '#3f8a2a' },
      q: { soil: '#f0e0a8', main: '#e6cf88', light: '#fff4cc', dark: '#c8ae66' },
      b: { soil: '#d8a890', main: '#c0603a', light: '#e89070', dark: '#8a3a22' },
      s: { soil: '#e8e0a0', main: '#f2dc3a', light: '#fff6a0', dark: '#b8a020' },
      g: { soil: '#c8c0a8', main: '#e8c040', light: '#fff0a0', dark: '#a88420' },
    };
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const t = world.tiles[y * world.w + x];
        const d = DEP[t];
        if (!d) continue;
        c.fillStyle = d.soil;
        c.beginPath();
        c.ellipse(x * S + S / 2, y * S + S / 2, S * 0.74, S * 0.7, hash(x, y, 5) * 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const t = world.tiles[y * world.w + x];
        const d = DEP[t];
        if (!d) continue;
        const n = 2 + Math.floor(hash(x, y, 6) * 2);
        for (let i = 0; i < n; i++) {
          const px = x * S + 7 + hash(x, y, 10 + i) * (S - 14);
          const py = y * S + 8 + hash(x, y, 20 + i) * (S - 14);
          const r = 3.5 + hash(x, y, 30 + i) * 3.5;
          c.fillStyle = 'rgba(40,70,30,0.22)';
          c.beginPath(); c.ellipse(px + 1, py + r * 0.7, r * 1.05, r * 0.45, 0, 0, Math.PI * 2); c.fill();
          if (t === 'h') {
            // Baum von oben: Stamm-Schatten und runde Krone
            c.fillStyle = d.dark;
            c.beginPath(); c.arc(px, py + r * 0.2, r * 1.15, 0, Math.PI * 2); c.fill();
            c.fillStyle = d.main;
            c.beginPath(); c.arc(px, py, r * 1.05, 0, Math.PI * 2); c.fill();
            c.fillStyle = d.light;
            c.beginPath(); c.arc(px - r * 0.35, py - r * 0.35, r * 0.4, 0, Math.PI * 2); c.fill();
          } else if (t === 'w' || t === 'u' || t === 's') {
            // Kristall
            c.fillStyle = d.main;
            c.beginPath();
            c.moveTo(px, py - r * 1.4); c.lineTo(px + r * 0.7, py - r * 0.3); c.lineTo(px + r * 0.5, py + r * 0.6);
            c.lineTo(px - r * 0.5, py + r * 0.6); c.lineTo(px - r * 0.7, py - r * 0.3); c.closePath(); c.fill();
            c.fillStyle = d.light;
            c.beginPath(); c.moveTo(px, py - r * 1.4); c.lineTo(px - r * 0.7, py - r * 0.3); c.lineTo(px - r * 0.1, py); c.closePath(); c.fill();
          } else {
            // runder Stein
            c.fillStyle = d.dark;
            c.beginPath(); c.arc(px, py + r * 0.15, r, 0, Math.PI * 2); c.fill();
            c.fillStyle = d.main;
            c.beginPath(); c.arc(px, py, r * 0.92, 0, Math.PI * 2); c.fill();
            c.fillStyle = d.light;
            c.beginPath(); c.arc(px - r * 0.3, py - r * 0.35, r * 0.32, 0, Math.PI * 2); c.fill();
          }
          if (t === 'h') break; // ein Baum pro Feld reicht
        }
      }
    }
    world.ground = g;
  }
  // ---------- Zeichnen ----------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
  }
  addEventListener('resize', resize);
  resize();

  function toScreen(wx, wy) {
    return [(wx - cam.x) * cam.zoom + innerWidth / 2, (wy - cam.y) * cam.zoom + innerHeight / 2];
  }
  function toWorld(sx, sy) {
    if (r3d) return r3d.pick(sx, sy);
    return [(sx - innerWidth / 2) / cam.zoom + cam.x, (sy - innerHeight / 2) / cam.zoom + cam.y];
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawArrow(c, cx, cy, s, d, color) {
    c.save();
    c.translate(cx, cy);
    c.rotate(d * Math.PI / 2);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(s * 0.28, 0);
    c.lineTo(-s * 0.12, -s * 0.22);
    c.lineTo(-s * 0.12, s * 0.22);
    c.closePath();
    c.fill();
    c.restore();
  }

  // Farben der Gebäude: Dach (Hauptfarbe) und dunklere Kante
  const KIND_COLORS = {
    bohrer: ['#f6a83b'],
    saege: ['#c98a4b'],
    schmelze: ['#f06a55'],
    verteiler: ['#8a94a8'],
    presse: ['#5b8ff0'],
    hochofen: ['#d94f6b'],
    werkbank: ['#3fc48a'],
    fabrikator: ['#22b8c8'],
    zentrifuge: ['#7ac943'],
    brecher: ['#e0a030'],
    chemiewerk: ['#e05aa0'],
    montagehalle: ['#4a7ae0'],
    zentrale: ['#9a7cf2', '#6f52c870'],
  };

  // Weicher Schlagschatten unter Gebäuden
  function shadowRect(c, x, y, w, h, r, s) {
    c.fillStyle = 'rgba(40,80,30,0.22)';
    roundRect(c, x + s * 0.05, y + s * 0.1, w, h, r);
    c.fill();
  }

  // Gebäudekörper: helles Gehäuse mit sichtbarer Unterkante, darauf farbiges Dach
  function body(c, x, y, w, h, r, s, roof) {
    const lip = s * 0.08;
    c.fillStyle = '#d9d4c8';
    roundRect(c, x, y + lip, w, h - lip, r);
    c.fill();
    c.fillStyle = '#fbf8f1';
    roundRect(c, x, y, w, h - lip, r);
    c.fill();
    if (roof) {
      const m = s * 0.1;
      c.fillStyle = roof;
      roundRect(c, x + m, y + m, w - m * 2, h - lip - m * 2, Math.max(2, r - m * 0.6));
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(c, x + m, y + m, w - m * 2, (h - lip - m * 2) * 0.42, Math.max(2, r - m * 0.6));
      c.fill();
    }
  }

  // Zeichnet ein Gebäude in Pixelkoordinaten (x,y = linke obere Ecke, s = Zellgröße)
  function drawBuilding(c, kind, x, y, s, d, opts = {}) {
    const size = opts.size || 1;
    const W = s * size;
    const t = performance.now() / 1000;
    c.save();
    if (opts.alpha) c.globalAlpha = opts.alpha;
    if (kind === 'band') {
      const m = s * 0.04;
      c.save();
      c.translate(x + s / 2, y + s / 2);
      c.rotate(d * Math.PI / 2);
      // Rahmen (Seitenschienen) und Laufband
      c.fillStyle = 'rgba(40,80,30,0.18)';
      c.fillRect(-s / 2 + m, -s * 0.36 + s * 0.06, s - m * 2, s * 0.72);
      c.fillStyle = '#c7cbd6';
      c.fillRect(-s / 2, -s * 0.38, s, s * 0.76);
      c.fillStyle = '#596173';
      c.fillRect(-s / 2, -s * 0.28, s, s * 0.56);
      c.save();
      c.beginPath();
      c.rect(-s / 2, -s * 0.28, s, s * 0.56);
      c.clip();
      c.strokeStyle = '#8791a8';
      c.lineWidth = Math.max(1.2, s * 0.07);
      c.lineCap = 'round';
      c.lineJoin = 'round';
      const step = s / 3;
      const off = ((t * beltSpeed * 10) % 1) * step;
      for (let i = -2; i <= 2; i++) {
        const px = i * step + off;
        c.beginPath();
        c.moveTo(px - s * 0.09, -s * 0.15);
        c.lineTo(px + s * 0.03, 0);
        c.lineTo(px - s * 0.09, s * 0.15);
        c.stroke();
      }
      c.restore();
      // Nieten auf den Schienen
      c.fillStyle = '#a4aab8';
      for (const sy of [-0.33, 0.33]) for (const sx of [-0.3, 0.2]) { c.beginPath(); c.arc(sx * s, sy * s, Math.max(0.8, s * 0.025), 0, Math.PI * 2); c.fill(); }
      c.restore();
    } else if (kind === 'zentrale') {
      const pad = s * 0.12;
      const r = s * 0.42;
      shadowRect(c, x + pad, y + pad, W - pad * 2, W - pad * 2, r, s);
      body(c, x + pad, y + pad, W - pad * 2, W - pad * 2, r, s, KIND_COLORS.zentrale[0]);
      const cx = x + W / 2;
      const cy = y + W / 2 - s * 0.08;
      // drehender Ring mit Lichtpunkten
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = s * 0.07;
      c.setLineDash([s * 0.18, s * 0.14]);
      c.lineDashOffset = -t * s * 0.6;
      c.beginPath(); c.arc(cx, cy - s * 0.12, W * 0.24, 0, Math.PI * 2); c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#ffffff';
      c.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -t * 0.8 + (i * Math.PI) / 3;
        c.lineTo(cx + Math.cos(a) * W * 0.12, cy - s * 0.12 + Math.sin(a) * W * 0.12);
      }
      c.closePath();
      c.fill();
      c.fillStyle = '#ffffff';
      c.font = `800 ${Math.max(7, s * 0.3)}px system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('ZENTRALE', cx, y + W - pad - s * 0.48);
    } else {
      const pad = s * 0.08;
      const w = s - pad * 2;
      const r = s * 0.2;
      const [roof] = KIND_COLORS[kind] || ['#999'];
      // Ausgabe-Lasche am Rand, unter dem Gehäuse
      const [dx, dy] = DIRS[d];
      c.save();
      c.translate(x + s / 2 + dx * s * 0.4, y + s / 2 + dy * s * 0.4);
      c.rotate(d * Math.PI / 2);
      c.fillStyle = '#c7cbd6';
      roundRect(c, -s * 0.12, -s * 0.18, s * 0.2, s * 0.36, s * 0.05);
      c.fill();
      c.restore();
      if (!opts.icon) shadowRect(c, x + pad, y + pad, w, w, r, s);
      body(c, x + pad, y + pad, w, w, r, s, roof);
      const cx = x + s / 2;
      const cy = y + s / 2 - s * 0.04;
      c.fillStyle = '#ffffff';
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(1.2, s * 0.065);
      c.lineCap = 'round';
      const spin = opts.busy ? t * 4 : 0;
      if (kind === 'bohrer') {
        c.save();
        c.translate(cx, cy);
        c.rotate(spin);
        for (let i = 0; i < 3; i++) {
          c.rotate((Math.PI * 2) / 3);
          c.beginPath();
          c.ellipse(s * 0.12, 0, s * 0.13, s * 0.06, 0, 0, Math.PI * 2);
          c.fill();
        }
        c.fillStyle = roof;
        c.beginPath(); c.arc(0, 0, s * 0.05, 0, Math.PI * 2); c.fill();
        c.restore();
      } else if (kind === 'schmelze') {
        const f = opts.busy ? 1 + Math.sin(t * 14) * 0.12 : 0.9;
        c.save();
        c.translate(cx, cy + s * 0.08);
        c.scale(1, f);
        c.beginPath();
        c.moveTo(0, -s * 0.26);
        c.bezierCurveTo(s * 0.2, -s * 0.08, s * 0.18, s * 0.1, 0, s * 0.1);
        c.bezierCurveTo(-s * 0.18, s * 0.1, -s * 0.2, -s * 0.08, 0, -s * 0.26);
        c.fill();
        c.fillStyle = opts.busy ? '#ffd166' : 'rgba(255,255,255,0.0)';
        c.beginPath(); c.ellipse(0, 0, s * 0.06, s * 0.08, 0, 0, Math.PI * 2); c.fill();
        c.restore();
      } else if (kind === 'presse') {
        const p = opts.busy ? Math.abs(Math.sin(t * 6)) * s * 0.08 : 0;
        roundRect(c, cx - s * 0.2, cy - s * 0.2 + p, s * 0.4, s * 0.12, s * 0.04); c.fill();
        roundRect(c, cx - s * 0.2, cy + s * 0.1, s * 0.4, s * 0.12, s * 0.04); c.fill();
        c.fillRect(cx - s * 0.025, cy - s * 0.26, s * 0.05, s * 0.08 + p);
      } else if (kind === 'saege') {
        c.save();
        c.translate(cx, cy);
        c.rotate(spin * 1.5);
        c.beginPath();
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          const rr = i % 2 ? s * 0.15 : s * 0.21;
          c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        c.closePath();
        c.fill();
        c.fillStyle = roof;
        c.beginPath(); c.arc(0, 0, s * 0.05, 0, Math.PI * 2); c.fill();
        c.restore();
      } else if (kind === 'verteiler') {
        for (const a of [0, Math.PI / 2, -Math.PI / 2]) {
          c.save();
          c.translate(cx, cy);
          c.rotate(a + d * Math.PI / 2);
          c.beginPath(); c.moveTo(0, 0); c.lineTo(s * 0.17, 0); c.stroke();
          c.beginPath(); c.moveTo(s * 0.24, 0); c.lineTo(s * 0.14, -s * 0.07); c.lineTo(s * 0.14, s * 0.07); c.closePath(); c.fill();
          c.restore();
        }
      } else if (kind === 'hochofen') {
        roundRect(c, cx - s * 0.18, cy - s * 0.04, s * 0.36, s * 0.24, s * 0.05); c.fill();
        c.fillRect(cx + s * 0.06, cy - s * 0.26, s * 0.09, s * 0.22);
        const f = opts.busy ? 1 + Math.sin(t * 14) * 0.15 : 0.8;
        c.fillStyle = opts.busy ? '#ffb030' : roof;
        c.beginPath(); c.ellipse(cx - s * 0.02, cy + s * 0.09, s * 0.07 * f, s * 0.06 * f, 0, 0, Math.PI * 2); c.fill();
      } else if (kind === 'fabrikator') {
        c.save();
        c.translate(cx - s * 0.12, cy + s * 0.14);
        c.rotate(-0.6 + (opts.busy ? Math.sin(t * 3) * 0.4 : 0));
        c.fillRect(-s * 0.04, -s * 0.3, s * 0.08, s * 0.3);
        c.translate(0, -s * 0.28);
        c.rotate(1.4);
        c.fillRect(-s * 0.035, -s * 0.2, s * 0.07, s * 0.2);
        c.restore();
        c.beginPath(); c.arc(cx - s * 0.12, cy + s * 0.14, s * 0.07, 0, Math.PI * 2); c.fill();
      } else if (kind === 'brecher') {
        // zwei gegenläufige Walzen
        for (const sx of [-1, 1]) {
          c.save();
          c.translate(cx + sx * s * 0.1, cy);
          c.rotate(spin * sx * 2);
          c.beginPath(); c.arc(0, 0, s * 0.11, 0, Math.PI * 2); c.fill();
          c.fillStyle = roof;
          c.fillRect(-s * 0.1, -s * 0.015, s * 0.2, s * 0.03);
          c.restore();
          c.fillStyle = '#ffffff';
        }
      } else if (kind === 'chemiewerk') {
        // Kolben mit blubbernder Flüssigkeit
        c.beginPath();
        c.moveTo(cx - s * 0.05, cy - s * 0.24); c.lineTo(cx + s * 0.05, cy - s * 0.24); c.lineTo(cx + s * 0.05, cy - s * 0.08);
        c.lineTo(cx + s * 0.2, cy + s * 0.18); c.lineTo(cx - s * 0.2, cy + s * 0.18); c.lineTo(cx - s * 0.05, cy - s * 0.08); c.closePath(); c.fill();
        c.fillStyle = '#c8f05a';
        c.beginPath(); c.moveTo(cx - s * 0.13, cy + s * 0.06); c.lineTo(cx + s * 0.13, cy + s * 0.06); c.lineTo(cx + s * 0.18, cy + s * 0.16); c.lineTo(cx - s * 0.18, cy + s * 0.16); c.closePath(); c.fill();
        if (opts.busy) { c.beginPath(); c.arc(cx + Math.sin(t * 5) * s * 0.03, cy - s * 0.3 - ((t * 0.8) % 1) * s * 0.1, s * 0.03, 0, Math.PI * 2); c.fill(); }
      } else if (kind === 'montagehalle') {
        // Halle mit Satteldach und Tor
        c.beginPath(); c.moveTo(cx - s * 0.24, cy - s * 0.02); c.lineTo(cx, cy - s * 0.24); c.lineTo(cx + s * 0.24, cy - s * 0.02); c.closePath(); c.fill();
        c.fillRect(cx - s * 0.2, cy - s * 0.02, s * 0.4, s * 0.22);
        c.fillStyle = roof;
        c.fillRect(cx - s * 0.08, cy + s * 0.06, s * 0.16, s * 0.14);
      } else if (kind === 'zentrifuge') {
        c.save();
        c.translate(cx, cy);
        c.beginPath(); c.arc(0, 0, s * 0.2, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#3f8a2a';
        c.rotate(spin * 2);
        for (let i = 0; i < 3; i++) {
          c.rotate((Math.PI * 2) / 3);
          c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, s * 0.17, -0.45, 0.45); c.closePath(); c.fill();
        }
        c.fillStyle = '#d4ff9a';
        c.beginPath(); c.arc(0, 0, s * 0.05, 0, Math.PI * 2); c.fill();
        c.restore();
      } else if (kind === 'werkbank') {
        c.save();
        c.translate(cx, cy);
        c.rotate(spin * 0.4);
        c.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6;
          const rr = i % 2 ? s * 0.13 : s * 0.19;
          c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        c.closePath();
        c.fill();
        c.fillStyle = roof;
        c.beginPath(); c.arc(0, 0, s * 0.06, 0, Math.PI * 2); c.fill();
        c.restore();
      }
      // kleiner Richtungspfeil auf der Lasche
      c.save();
      c.translate(x + s / 2 + dx * s * 0.44, y + s / 2 + dy * s * 0.44);
      c.rotate(d * Math.PI / 2);
      c.fillStyle = '#596173';
      c.beginPath(); c.moveTo(s * 0.05, 0); c.lineTo(-s * 0.03, -s * 0.07); c.lineTo(-s * 0.03, s * 0.07); c.closePath(); c.fill();
      c.restore();
      // Produkt-Bläschen über arbeitenden Maschinen
      if (opts.busy && typeof opts.busy === 'string') {
        const bx = x + s * 0.8;
        const by = y + s * 0.14 + Math.sin(t * 3) * s * 0.02;
        c.fillStyle = 'rgba(40,60,40,0.18)';
        c.beginPath(); c.arc(bx + s * 0.02, by + s * 0.03, s * 0.17, 0, Math.PI * 2); c.fill();
        c.fillStyle = '#ffffff';
        c.beginPath(); c.arc(bx, by, s * 0.17, 0, Math.PI * 2); c.fill();
        drawItem(c, opts.busy, bx, by, s * 0.24);
      }
    }
    c.restore();
  }

  function drawItem(c, id, cx, cy, s) {
    const it = defs && defs.ITEMS[id];
    if (!it) return;
    c.save();
    c.fillStyle = it.color;
    c.strokeStyle = 'rgba(40,45,70,0.45)';
    c.lineWidth = Math.max(1, s * 0.07);
    c.lineJoin = 'round';
    const r = s * 0.42;
    c.beginPath();
    switch (it.shape) {
      case 'rock':
        c.moveTo(cx - r, cy + r * 0.2);
        c.lineTo(cx - r * 0.4, cy - r * 0.8);
        c.lineTo(cx + r * 0.6, cy - r * 0.6);
        c.lineTo(cx + r, cy + r * 0.3);
        c.lineTo(cx + r * 0.2, cy + r * 0.85);
        c.closePath();
        break;
      case 'dust':
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2 + 0.6;
          c.moveTo(cx + Math.cos(a) * r * 0.5 + r * 0.38, cy + Math.sin(a) * r * 0.5);
          c.arc(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.38, 0, Math.PI * 2);
        }
        break;
      case 'bar':
        c.moveTo(cx - r, cy + r * 0.5);
        c.lineTo(cx - r * 0.6, cy - r * 0.5);
        c.lineTo(cx + r * 0.6, cy - r * 0.5);
        c.lineTo(cx + r, cy + r * 0.5);
        c.closePath();
        break;
      case 'pane':
        c.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
        break;
      case 'gear':
        for (let i = 0; i < 16; i++) {
          const a = (i * Math.PI) / 8;
          const rr = i % 2 ? r * 0.7 : r;
          c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        c.closePath();
        break;
      case 'coil':
        c.rect(cx - r * 0.7, cy - r * 0.8, r * 1.4, r * 1.6);
        break;
      case 'box':
        roundRect(c, cx - r, cy - r * 0.8, r * 2, r * 1.6, r * 0.3);
        break;
      case 'bulb':
        c.arc(cx, cy - r * 0.15, r * 0.75, 0, Math.PI * 2);
        break;
      case 'bot':
        roundRect(c, cx - r * 0.8, cy - r, r * 1.6, r * 2, r * 0.4);
        break;
      case 'log':
        roundRect(c, cx - r, cy - r * 0.45, r * 2, r * 0.9, r * 0.45);
        break;
      case 'crystal':
        c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.6, cy - r * 0.2); c.lineTo(cx + r * 0.4, cy + r * 0.8);
        c.lineTo(cx - r * 0.4, cy + r * 0.8); c.lineTo(cx - r * 0.6, cy - r * 0.2); c.closePath();
        break;
      case 'plank':
        c.rect(cx - r, cy - r * 0.55, r * 2, r * 0.45);
        c.rect(cx - r, cy + r * 0.1, r * 2, r * 0.45);
        break;
      case 'brick':
        roundRect(c, cx - r, cy - r * 0.5, r * 2, r, r * 0.12);
        break;
      case 'beam':
        c.rect(cx - r, cy - r * 0.6, r * 2, r * 0.25);
        c.rect(cx - r * 0.15, cy - r * 0.6, r * 0.3, r * 1.2);
        c.rect(cx - r, cy + r * 0.35, r * 2, r * 0.25);
        break;
      case 'board':
        roundRect(c, cx - r * 0.9, cy - r * 0.7, r * 1.8, r * 1.4, r * 0.15);
        break;
      case 'frame':
        c.rect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
        c.rect(cx - r * 0.5, cy + r * 0.5, r, -r);
        break;
      case 'drill':
        c.moveTo(cx - r * 0.55, cy - r * 0.7); c.lineTo(cx + r * 0.55, cy - r * 0.7); c.lineTo(cx, cy + r); c.closePath();
        break;
      case 'arm':
        c.moveTo(cx - r * 0.8, cy + r * 0.8); c.lineTo(cx - r * 0.8, cy + r * 0.3); c.lineTo(cx - r * 0.2, cy + r * 0.3);
        c.lineTo(cx + r * 0.2, cy - r * 0.6); c.lineTo(cx + r * 0.8, cy - r * 0.6); c.lineTo(cx + r * 0.8, cy - r * 0.2);
        c.lineTo(cx + r * 0.45, cy - r * 0.2); c.lineTo(cx + r * 0.05, cy + r * 0.8); c.closePath();
        break;
      case 'probe':
        c.moveTo(cx, cy - r); c.lineTo(cx + r * 0.4, cy + r * 0.2); c.lineTo(cx + r * 0.9, cy + r * 0.8);
        c.lineTo(cx - r * 0.9, cy + r * 0.8); c.lineTo(cx - r * 0.4, cy + r * 0.2); c.closePath();
        break;
      case 'pellet':
        roundRect(c, cx - r * 0.5, cy - r * 0.8, r, r * 1.6, r * 0.35);
        break;
      case 'cell':
        roundRect(c, cx - r * 0.6, cy - r * 0.8, r * 1.2, r * 1.7, r * 0.2);
        c.rect(cx - r * 0.25, cy - r, r * 0.5, r * 0.2);
        break;
      default:
        c.arc(cx, cy, r, 0, Math.PI * 2);
    }
    c.fill();
    c.stroke();
    // kleine Details
    c.fillStyle = 'rgba(0,0,0,0.45)';
    if (it.shape === 'gear') { c.beginPath(); c.arc(cx, cy, r * 0.28, 0, Math.PI * 2); c.fill(); }
    if (it.shape === 'coil') { for (let i = -1; i <= 1; i++) c.fillRect(cx - r * 0.7, cy + i * r * 0.45 - r * 0.06, r * 1.4, r * 0.12); }
    if (it.shape === 'bot') { c.fillStyle = '#1b1f2a'; c.fillRect(cx - r * 0.45, cy - r * 0.45, r * 0.25, r * 0.25); c.fillRect(cx + r * 0.2, cy - r * 0.45, r * 0.25, r * 0.25); }
    if (it.shape === 'box') { c.fillRect(cx - r * 0.6, cy - r * 0.1, r * 1.2, r * 0.2); }
    if (it.shape === 'log') { c.fillStyle = '#e8c08a'; c.beginPath(); c.ellipse(cx + r * 0.75, cy, r * 0.22, r * 0.4, 0, 0, Math.PI * 2); c.fill(); }
    if (it.shape === 'board') { c.fillStyle = '#ffd27a'; for (let i = -1; i <= 1; i++) c.fillRect(cx - r * 0.6, cy + i * r * 0.4 - r * 0.05, r * 1.2, r * 0.1); }
    if (it.shape === 'cell') { c.fillStyle = '#eaffd0'; c.beginPath(); c.moveTo(cx + r * 0.1, cy - r * 0.55); c.lineTo(cx - r * 0.25, cy + r * 0.1); c.lineTo(cx + r * 0.05, cy + r * 0.1); c.lineTo(cx - r * 0.1, cy + r * 0.65); c.lineTo(cx + r * 0.3, cy - r * 0.05); c.lineTo(cx, cy - r * 0.05); c.closePath(); c.fill(); }
    if (it.shape === 'brick') { c.fillRect(cx - r * 0.05, cy - r * 0.5, r * 0.1, r); }
    c.restore();
  }

  function frame() {
    requestAnimationFrame(frame);
    if (r3d) {
      if (!world.w) return;
      updateKeys();
      drawMinimap();
      r3d.render({ world, items, busy, beltSpeed, lastTickAt, hover, tool, dir, cursors, players, defs, canPlace });
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Wasser rund um die Insel
    ctx.fillStyle = '#7cc8e8';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    if (!world.ground) return;
    updateKeys();
    drawMinimap();

    const s = cam.zoom;
    const [ox, oy] = toScreen(0, 0);
    const t = performance.now() / 1000;
    // Wellen
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    const wave = 70;
    const wx0 = ((ox % wave) + wave) % wave - wave;
    const wy0 = ((oy % wave) + wave) % wave - wave;
    for (let y = wy0; y < innerHeight + wave; y += wave) {
      for (let x = wx0 + ((y - wy0) / wave % 2) * wave / 2; x < innerWidth + wave; x += wave) {
        const o = Math.sin(t * 1.5 + x * 0.05 + y * 0.03) * 3;
        ctx.beginPath();
        ctx.moveTo(x - 8, y + o);
        ctx.quadraticCurveTo(x - 4, y - 4 + o, x, y + o);
        ctx.quadraticCurveTo(x + 4, y - 4 + o, x + 8, y + o);
        ctx.stroke();
      }
    }
    // Sandstrand und Wiese
    const W = world.w * s;
    const H = world.h * s;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(ctx, ox - s * 0.55, oy - s * 0.55, W + s * 1.1, H + s * 1.1, s * 0.9);
    ctx.fill();
    ctx.fillStyle = '#f1dfa4';
    roundRect(ctx, ox - s * 0.4, oy - s * 0.4, W + s * 0.8, H + s * 0.8, s * 0.7);
    ctx.fill();
    ctx.save();
    roundRect(ctx, ox, oy, W, H, s * 0.4);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(world.ground, ox, oy, W, H);
    ctx.restore();

    // Raster bei genug Zoom
    const [x0, y0] = toWorld(0, 0).map(Math.floor);
    const [x1, y1] = toWorld(innerWidth, innerHeight).map(Math.ceil);
    if (s > 22) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.22, (s - 22) / 80)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.max(1, x0); x <= Math.min(world.w - 1, x1); x++) { const [sx] = toScreen(x, 0); ctx.moveTo(sx, oy); ctx.lineTo(sx, oy + H); }
      for (let y = Math.max(1, y0); y <= Math.min(world.h - 1, y1); y++) { const [, sy] = toScreen(0, y); ctx.moveTo(ox, sy); ctx.lineTo(ox + W, sy); }
      ctx.stroke();
    }

    // Erst Bänder, dann Gebäude (damit Schatten und Laschen über den Bändern liegen)
    const visible = [];
    for (const b of world.buildings.values()) {
      if (b.x + b.size < x0 || b.y + b.size < y0 || b.x > x1 || b.y > y1) continue;
      visible.push(b);
    }
    for (const b of visible) {
      if (b.kind !== 'band') continue;
      const [sx, sy] = toScreen(b.x, b.y);
      drawBuilding(ctx, b.kind, sx, sy, s, b.dir);
    }

    // Items auf Bändern (zwischen Ticks interpoliert)
    const dt = Math.min(1, (performance.now() - lastTickAt) / 100);
    for (let i = 0; i < items.length; i += 4) {
      const x = items[i];
      const y = items[i + 1];
      if (x < x0 - 1 || y < y0 - 1 || x > x1 || y > y1) continue;
      const b = world.grid.get(x + ',' + y);
      const d = b ? b.dir : 0;
      const p = Math.min(1, items[i + 3] + (items[i + 3] < 1 ? beltSpeed * dt : 0));
      const [dx, dy] = DIRS[d];
      const [sx, sy] = toScreen(x + 0.5 + dx * (p - 0.5), y + 0.5 + dy * (p - 0.5));
      ctx.fillStyle = 'rgba(20,30,40,0.28)';
      ctx.beginPath(); ctx.ellipse(sx + s * 0.03, sy + s * 0.12, s * 0.2, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      drawItem(ctx, items[i + 2], sx, sy, s * 0.5);
    }

    for (const b of visible) {
      if (b.kind === 'band') continue;
      const [sx, sy] = toScreen(b.x, b.y);
      drawBuilding(ctx, b.kind, sx, sy, s, b.dir, { size: b.size, busy: busy.get(b.id) });
    }

    // Vorschau
    if (hover && tool !== 'hand') {
      const [sx, sy] = toScreen(hover.x, hover.y);
      ctx.lineWidth = 3;
      if (tool === 'delete') {
        ctx.fillStyle = 'rgba(255,90,90,0.28)';
        roundRect(ctx, sx + 2, sy + 2, s - 4, s - 4, s * 0.18);
        ctx.fill();
        ctx.strokeStyle = '#ff5a5a';
        ctx.stroke();
      } else {
        const ok = canPlace(tool, hover.x, hover.y);
        drawBuilding(ctx, tool, sx, sy, s, dir, { alpha: 0.6 });
        ctx.strokeStyle = ok ? '#ffffff' : '#ff5a5a';
        ctx.setLineDash(ok ? [] : [6, 4]);
        roundRect(ctx, sx + 1.5, sy + 1.5, s - 3, s - 3, s * 0.18);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Mauszeiger der Mitspieler
    for (const [id, c] of cursors) {
      const p = players.find((pl) => pl.id === id);
      if (!p) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 14, sy + 6);
      ctx.lineTo(sx + 6, sy + 14);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(p.name).width;
      ctx.fillStyle = p.color;
      roundRect(ctx, sx + 12, sy + 14, tw + 12, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.name, sx + 18, sy + 23);
    }
  }

  function canPlace(kind, x, y) {
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
    const b = world.grid.get(x + ',' + y);
    if (b && !(b.kind === 'band' && kind === 'band')) return false;
    const tile = world.tiles[y * world.w + x];
    if (kind === 'bohrer' && !(defs && defs.DEPOSITS[tile])) return false;
    if (kind !== 'band' && tile === '~') return false;
    return true;
  }

  // ---------- Oberfläche ----------
  function iconCanvas(drawFn) {
    const c = document.createElement('canvas');
    c.width = 72;
    c.height = 72;
    drawFn(c.getContext('2d'));
    return c;
  }

  function buildToolbar() {
    const bar = $('toolbar');
    bar.innerHTML = '';
    TOOLS = ['hand', ...Object.keys(defs.BUILDINGS), 'delete'];
    TOOLS.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.dataset.tool = t;
      if (t === 'hand') { btn.textContent = '✋'; btn.title = 'Kamera verschieben (H)'; }
      else if (t === 'delete') { btn.textContent = '🗑'; btn.title = 'Abreißen (X)'; }
      else {
        const def = defs.BUILDINGS[t];
        const pic = r3d && r3d.icon(t);
        if (pic) {
          const img = document.createElement('img');
          img.src = pic;
          img.alt = '';
          btn.appendChild(img);
        } else {
          btn.appendChild(iconCanvas((c) => drawBuilding(c, t, 0, 0, 72, 0)));
        }
        btn.title = `${def.name} (${def.key}): ${def.desc}`;
        const k = document.createElement('span');
        k.className = 'k';
        k.textContent = def.key;
        btn.appendChild(k);
        btn.disabled = !unlocked.includes(t);
        if (btn.disabled) btn.title = `${def.name}: noch nicht erforscht`;
      }
      btn.onclick = () => setTool(t);
      bar.appendChild(btn);
      if (i === 0 || i === TOOLS.length - 2) {
        const sep = document.createElement('div');
        sep.className = 'sep';
        bar.appendChild(sep);
      }
    });
    const rot = document.createElement('button');
    rot.textContent = '⟳';
    rot.title = 'Gebäude drehen (R)';
    rot.onclick = () => rotate();
    bar.appendChild(rot);
    if (r3d) {
      const camBtn = document.createElement('button');
      camBtn.textContent = '🧭';
      camBtn.title = 'Kamera drehen (Q/E, am Handy mit zwei Fingern)';
      camBtn.onclick = () => r3d.rotateBy(-Math.PI / 4, true);
      bar.appendChild(camBtn);
    }
    setTool(unlocked.includes(tool) || tool === 'hand' || tool === 'delete' ? tool : 'hand');
  }

  function setTool(t) {
    if (defs && defs.BUILDINGS[t] && !unlocked.includes(t)) return;
    tool = t;
    document.querySelectorAll('#toolbar button[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    updateInfo();
  }

  function rotate() {
    dir = (dir + 1) % 4;
    if (hover && tool === 'hand') {
      const b = world.grid.get(hover.x + ',' + hover.y);
      if (b && b.kind === 'band') send({ t: 'place', kind: 'band', x: b.x, y: b.y, dir: (b.dir + 1) % 4 });
    }
  }

  function updateInfo() {
    let text = '';
    if (defs && defs.BUILDINGS[tool]) {
      const d = defs.BUILDINGS[tool];
      text = `${d.name}: ${d.desc}`;
      const rec = defs.RECIPES[tool];
      if (rec) text += '  ' + rec.map((r) => Object.keys(r.in).map((k) => defs.ITEMS[k].name).join(' + ') + ' → ' + defs.ITEMS[r.out].name).join(' · ');
    } else if (hover) {
      const b = world.grid.get(hover.x + ',' + hover.y);
      const t = world.tiles[hover.y * world.w + hover.x];
      if (b && b.kind === 'zentrale') text = 'Zentrale: Hierhin liefern, um zu forschen.';
      else if (b) text = defs.BUILDINGS[b.kind].name + (busy.get(b.id) ? ' (stellt ' + defs.ITEMS[busy.get(b.id)].name + ' her)' : '');
      else if (defs && defs.DEPOSITS[t]) text = 'Vorkommen: ' + defs.ITEMS[defs.DEPOSITS[t]].name;
      else if (t === '~') text = 'Wasser: Hier gehen nur Förderbänder (als Brücke).';
    }
    $('info').textContent = text;
  }

  // ---------- Techbaum ----------
  const techState = (t) => {
    if (research.done.includes(t.id)) return 'done';
    if (!t.req.every((q) => research.done.includes(q))) return 'locked';
    const ok = Object.entries(t.cost).every(([i, n]) => (research.stock[i] || 0) >= n);
    return ok ? 'ready' : 'open';
  };

  function costChips(t) {
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    for (const [id, n] of Object.entries(t.cost)) {
      const have = Math.min(n, research.stock[id] || 0);
      const chip = document.createElement('div');
      chip.className = 'chip' + (have >= n ? ' full' : '');
      chip.title = defs.ITEMS[id].name;
      chip.appendChild(iconCanvas((c) => drawItem(c, id, 36, 36, 64)));
      const label = document.createElement('span');
      label.textContent = `${have}/${n}`;
      chip.appendChild(label);
      const bar = document.createElement('i');
      bar.style.width = `${(have / n) * 100}%`;
      chip.appendChild(bar);
      wrap.appendChild(chip);
    }
    return wrap;
  }

  function researchButton(t, state) {
    const b = document.createElement('button');
    b.className = 'research-btn';
    b.textContent = state === 'ready' ? 'Erforschen' : 'Sammeln …';
    b.disabled = state !== 'ready';
    b.onclick = (e) => { e.stopPropagation(); send({ t: 'research', id: t.id }); };
    return b;
  }

  let researchKey = '';
  function renderResearch() {
    if (!research || !defs) return;
    const key = JSON.stringify([research.done, research.stock]);
    if (key === researchKey) return;
    researchKey = key;
    const done = research.done.length;
    const total = defs.TECHS.length;
    $('research-title').textContent = research.won ? 'Fabrik fertig 🎉' : `Techbaum ${done}/${total}`;
    const box = $('research-goals');
    box.innerHTML = '';
    const open = defs.TECHS.filter((t) => ['ready', 'open'].includes(techState(t)));
    open.sort((a, b) => (techState(a) === 'ready' ? -1 : 0) - (techState(b) === 'ready' ? -1 : 0));
    for (const t of open.slice(0, 2)) {
      const row = document.createElement('div');
      row.className = 'tech-mini';
      const head = document.createElement('div');
      head.className = 'tech-mini-head';
      const name = document.createElement('b');
      name.textContent = t.name;
      head.append(name, researchButton(t, techState(t)));
      row.append(head, costChips(t));
      box.appendChild(row);
    }
    $('research-text').textContent = open.length > 2 ? `+ ${open.length - 2} weitere im Techbaum` : (open.length ? '' : 'Alles erforscht. Baut weiter, so groß ihr wollt!');
    renderTechTree();
  }

  function renderTechTree() {
    const overlay = $('techtree');
    if (!defs || !research || overlay.classList.contains('hidden')) return;
    const area = $('tree-area');
    area.innerHTML = '';
    const small = innerWidth < 700;
    const CW = small ? 172 : 192, RH = small ? 150 : 168, NW = small ? 152 : 170;
    const cols = Math.max(...defs.TECHS.map((t) => t.col)) + 1;
    const rows = Math.max(...defs.TECHS.map((t) => t.row)) + 1;
    area.style.width = `${cols * CW}px`;
    area.style.height = `${rows * RH}px`;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', cols * CW);
    svg.setAttribute('height', rows * RH);
    const pos = (t) => [t.col * CW + 15, t.row * RH + 10];
    for (const t of defs.TECHS) {
      for (const q of t.req) {
        const p = defs.TECHS.find((x) => x.id === q);
        const [x1, y1] = pos(p);
        const [x2, y2] = pos(t);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const sx = x1 + NW, sy = y1 + 40, ex = x2, ey = y2 + 40;
        path.setAttribute('d', `M${sx},${sy} C${sx + 30},${sy} ${ex - 30},${ey} ${ex},${ey}`);
        path.setAttribute('class', research.done.includes(q) ? 'link on' : 'link');
        svg.appendChild(path);
      }
    }
    area.appendChild(svg);
    for (const t of defs.TECHS) {
      const st = techState(t);
      const node = document.createElement('div');
      node.className = `tech ${st}`;
      const [x, y] = pos(t);
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
      node.style.width = `${NW}px`;
      const h = document.createElement('div');
      h.className = 'tech-name';
      h.textContent = (st === 'done' ? '✓ ' : st === 'locked' ? '🔒 ' : '') + t.name;
      const d = document.createElement('div');
      d.className = 'tech-text';
      d.textContent = t.text;
      node.title = t.text;
      // Erledigte und gesperrte Techniken kompakt halten, damit der große Baum übersichtlich bleibt
      node.append(h);
      if (st === 'open' || st === 'ready') node.append(d);
      if (st !== 'done' && Object.keys(t.cost).length) node.appendChild(costChips(t));
      if (st === 'ready' || st === 'open') node.appendChild(researchButton(t, st));
      area.appendChild(node);
    }
  }

  function openTechTree() {
    $('techtree').classList.remove('hidden');
    renderTechTree();
    // Zur ersten erforschbaren Technik scrollen
    const next = document.querySelector('#tree-area .tech.ready, #tree-area .tech.open');
    if (next) next.scrollIntoView({ block: 'center', inline: 'center' });
  }
  $('open-tree').onclick = openTechTree;
  $('close-tree').onclick = () => $('techtree').classList.add('hidden');
  $('techtree').addEventListener('click', (e) => { if (e.target.id === 'techtree') $('techtree').classList.add('hidden'); });


  function renderPlayers() {
    $('players').innerHTML = players.map((p) => `<div><span style="background:${p.color}"></span>${escapeHtml(p.name)}${p.id === me ? ' (du)' : ''}</div>`).join('');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  let toastTimer = null;
  function toast(text, ms = 2200) {
    const el = $('toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---------- Eingabe ----------
  const pointers = new Map();
  let drag = null; // { mode: 'pan'|'build'|'erase', last: {x,y}, sx, sy, camx, camy }
  let pinch = null;
  let spaceDown = false;
  const keys = new Set();
  let lastCursorSent = 0;

  function cellAt(sx, sy) {
    const [wx, wy] = toWorld(sx, sy);
    return { x: Math.floor(wx), y: Math.floor(wy), wx, wy };
  }

  function buildAt(cell, from) {
    if (tool === 'band' && from && (from.x !== cell.x || from.y !== cell.y)) {
      // Linie von "from" nach "cell" in Einzelschritten, Bänder zeigen in Zugrichtung
      const cells = [];
      let cx = from.x;
      let cy = from.y;
      while (cx !== cell.x || cy !== cell.y) {
        const dx = Math.sign(cell.x - cx);
        const dy = Math.sign(cell.y - cy);
        const step = Math.abs(cell.x - cx) >= Math.abs(cell.y - cy) ? [dx, 0] : [0, dy];
        const d = DIRS.findIndex((v) => v[0] === step[0] && v[1] === step[1]);
        cells.push({ x: cx, y: cy, dir: d });
        cx += step[0];
        cy += step[1];
        dir = d;
      }
      cells.push({ x: cx, y: cy, dir });
      send({ t: 'place', kind: 'band', cells });
    } else {
      send({ t: 'place', kind: tool, x: cell.x, y: cell.y, dir });
    }
  }

  function eraseAt(cell) {
    send({ t: 'remove', x: cell.x, y: cell.y });
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      // Zwei Finger: zoomen und verschieben
      const [a, b] = [...pointers.values()];
      if (r3d) { r3d.pinchStart(a, b); pinch = {}; drag = null; return; }
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, mid: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2) };
      drag = null;
      return;
    }
    const cell = cellAt(e.clientX, e.clientY);
    hover = cell;
    if (e.button === 1 || spaceDown || (tool === 'hand' && e.button === 0)) {
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, camx: cam.x, camy: cam.y };
      if (r3d) r3d.panStart(e.clientX, e.clientY);
    } else if (e.button === 2 || tool === 'delete') {
      drag = { mode: 'erase', last: cell };
      eraseAt(cell);
    } else if (e.button === 0) {
      drag = { mode: 'build', last: cell };
      buildAt(cell, null);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (r3d) { r3d.pinchMove(a, b); return; }
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      cam.zoom = clampZoom(pinch.zoom * (d / pinch.dist));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      cam.x = pinch.mid[0] - (mx - innerWidth / 2) / cam.zoom;
      cam.y = pinch.mid[1] - (my - innerHeight / 2) / cam.zoom;
      return;
    }
    const cell = cellAt(e.clientX, e.clientY);
    const changed = !hover || hover.x !== cell.x || hover.y !== cell.y;
    hover = cell;
    if (changed) updateInfo();
    const now = performance.now();
    if (now - lastCursorSent > 100) { send({ t: 'cursor', x: cell.wx, y: cell.wy }); lastCursorSent = now; }
    if (!drag) return;
    if (drag.mode === 'pan' && r3d) {
      r3d.panMove(e.clientX, e.clientY);
    } else if (drag.mode === 'pan') {
      cam.x = drag.camx - (e.clientX - drag.sx) / cam.zoom;
      cam.y = drag.camy - (e.clientY - drag.sy) / cam.zoom;
    } else if (changed && drag.mode === 'build') {
      buildAt(cell, drag.last);
      drag.last = cell;
    } else if (changed && drag.mode === 'erase') {
      eraseAt(cell);
      drag.last = cell;
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) drag = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });

  function clampZoom(z) { return Math.max(8, Math.min(120, z)); }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (r3d) { r3d.zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY); return; }
    const before = toWorld(e.clientX, e.clientY);
    cam.zoom = clampZoom(cam.zoom * Math.exp(-e.deltaY * 0.0015));
    const after = toWorld(e.clientX, e.clientY);
    cam.x += before[0] - after[0];
    cam.y += before[1] - after[1];
  }, { passive: false });

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (k === ' ') { spaceDown = true; e.preventDefault(); }
    if (k === 'r') rotate();
    if (k === 't') { if ($('techtree').classList.contains('hidden')) openTechTree(); else $('techtree').classList.add('hidden'); }
    if (k === 'escape') $('techtree').classList.add('hidden');
    if (k === 'h' || k === 'escape') setTool('hand');
    if (k === 'x' || k === 'delete') setTool('delete');
    if (k === 'm') mini.el.classList.toggle('off');
    if (defs) for (const [id, b] of Object.entries(defs.BUILDINGS)) if (b.key === k) setTool(id);
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === ' ') spaceDown = false;
  });
  addEventListener('blur', () => keys.clear());

  function updateKeys() {
    if (r3d) {
      const fw = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const rt = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
      if (fw || rt) r3d.moveBy(rt, fw);
      if (keys.has('q')) r3d.rotateBy(0.035);
      if (keys.has('e')) r3d.rotateBy(-0.035);
      return;
    }
    const sp = 12 / cam.zoom;
    if (keys.has('w') || keys.has('arrowup')) cam.y -= sp;
    if (keys.has('s') || keys.has('arrowdown')) cam.y += sp;
    if (keys.has('a') || keys.has('arrowleft')) cam.x -= sp;
    if (keys.has('d') || keys.has('arrowright')) cam.x += sp;
  }

  // ---------- Start ----------
  const params = new URLSearchParams(location.search);
  $('join-room').value = params.get('welt') || '';
  try {
    $('join-name').value = localStorage.getItem('fk-name') || '';
    $('join-server').value = params.get('server') || localStorage.getItem('fk-server') || '';
  } catch {}
  if (isApp) {
    $('join-server').placeholder = 'z. B. 192.168.1.20:3000';
    $('join-server').required = true;
    $('server-hint').textContent = 'Adresse des Rechners, auf dem Fabrik-Koop läuft. Sie steht dort auf dem Startbildschirm.';
  } else {
    // Adressen anzeigen, unter denen andere diesem Spiel beitreten können
    fetch('/info').then((r) => r.json()).then((info) => {
      if (info.version) $('join').querySelector('h1').dataset.version = 'Version ' + info.version;
      if (info.addresses && info.addresses.length) {
        $('lan-info').innerHTML = 'Mitspieler im selben Netzwerk verbinden sich mit: ' + info.addresses.map((a) => `<b>${escapeHtml(a)}</b>`).join(', ');
      }
    }).catch(() => {});
  }
  $('join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('join-name').value.trim() || 'Gast';
    const server = $('join-server').value.trim();
    try { localStorage.setItem('fk-name', name); localStorage.setItem('fk-server', server); } catch {}
    $('join').classList.add('hidden');
    everConnected = false;
    connect(name, $('join-room').value.trim() || 'start', server);
  });

  requestAnimationFrame(frame);
})();
