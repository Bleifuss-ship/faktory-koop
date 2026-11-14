// Client von "Fabrik-Koop": Darstellung, Eingabe und Verbindung zum Server.
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  const ctx = canvas.getContext('2d');

  // ---------- Zustand ----------
  let ws = null;
  let defs = null;
  let me = null;
  const world = { w: 0, h: 0, tiles: '', buildings: new Map(), grid: new Map(), ground: null };
  let items = [];
  let busy = new Map();
  let research = null;
  let unlocked = [];
  let beltSpeed = 0.125;
  let players = [];
  let cursors = new Map();
  let lastTickAt = performance.now();

  const cam = { x: 0, y: 0, zoom: 40 };
  let tool = 'hand';
  let dir = 0;
  let hover = null;
  let dpr = 1;

  const TOOLS = ['hand', 'band', 'bohrer', 'schmelze', 'presse', 'montage', 'delete'];
  const TILE_COLORS = { '.': ['#2b3a2f', '#2e3e32'], r: ['#5a2e2c', '#6a3431'], b: ['#24395c', '#2a4268'], s: ['#5c5436', '#6a613f'] };
  const BUILD_COLORS = { band: '#3a3f52', bohrer: '#7a6a58', schmelze: '#8a4a3a', presse: '#4a5a7a', montage: '#5a7a4a', zentrale: '#6a5a8a' };
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
    renderGround();
    renderResearch();
  }

  function addBuilding(b) {
    const old = world.buildings.get(b.id);
    if (old) removeBuilding(b.id);
    world.buildings.set(b.id, b);
    for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) world.grid.set((b.x + x) + ',' + (b.y + y), b);
  }

  function removeBuilding(id) {
    const b = world.buildings.get(id);
    if (!b) return;
    for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) world.grid.delete((b.x + x) + ',' + (b.y + y));
    world.buildings.delete(id);
  }

  function applyChange(c) {
    if (c.op === 'add') addBuilding(c.b);
    else if (c.op === 'del') removeBuilding(c.id);
    else if (c.op === 'research') {
      const done = defs.RESEARCH[c.level - 1];
      if (done) toast(`Forschung abgeschlossen: ${done.name}! ${done.text}`, 4000);
    }
  }

  // ---------- Boden vorrendern ----------
  function renderGround() {
    const S = 16;
    const g = document.createElement('canvas');
    g.width = world.w * S;
    g.height = world.h * S;
    const c = g.getContext('2d');
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const t = world.tiles[y * world.w + x];
        const cols = TILE_COLORS[t] || TILE_COLORS['.'];
        c.fillStyle = cols[(x + y) & 1];
        c.fillRect(x * S, y * S, S, S);
        if (t !== '.') {
          // ein paar Brocken als Vorkommen-Muster
          c.fillStyle = { r: '#c8463c', b: '#4a8ae0', s: '#e0cf8a' }[t];
          const h = (x * 73856093) ^ (y * 19349663);
          for (let i = 0; i < 3; i++) {
            const px = ((h >> (i * 4)) & 15) / 16;
            const py = ((h >> (i * 4 + 12)) & 15) / 16;
            c.beginPath();
            c.arc(x * S + 2 + px * (S - 4), y * S + 2 + py * (S - 4), 1.6, 0, Math.PI * 2);
            c.fill();
          }
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

  // Zeichnet ein Gebäude in Pixelkoordinaten (x,y = linke obere Ecke, s = Zellgröße)
  function drawBuilding(c, kind, x, y, s, d, opts = {}) {
    const size = opts.size || 1;
    const W = s * size;
    const t = performance.now() / 1000;
    c.save();
    if (opts.alpha) c.globalAlpha = opts.alpha;
    if (kind === 'band') {
      c.fillStyle = BUILD_COLORS.band;
      c.fillRect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88);
      // laufende Streifen
      c.save();
      c.beginPath();
      c.rect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88);
      c.clip();
      c.translate(x + s / 2, y + s / 2);
      c.rotate(d * Math.PI / 2);
      c.strokeStyle = '#4b5168';
      c.lineWidth = Math.max(1, s * 0.06);
      const off = ((t * beltSpeed * 10) % 1) * (s / 3);
      for (let i = -2; i <= 2; i++) {
        const px = i * (s / 3) + off;
        c.beginPath();
        c.moveTo(px - s * 0.08, -s * 0.4);
        c.lineTo(px + s * 0.08, 0);
        c.lineTo(px - s * 0.08, s * 0.4);
        c.stroke();
      }
      c.restore();
      drawArrow(c, x + s / 2, y + s / 2, s * 0.55, d, 'rgba(255,255,255,0.18)');
    } else if (kind === 'zentrale') {
      c.fillStyle = BUILD_COLORS.zentrale;
      roundRect(c, x + s * 0.08, y + s * 0.08, W - s * 0.16, W - s * 0.16, s * 0.3);
      c.fill();
      c.strokeStyle = '#b8a8e8';
      c.lineWidth = s * 0.08;
      c.stroke();
      c.fillStyle = '#d8ccff';
      c.beginPath();
      const cx = x + W / 2;
      const cy = y + W / 2;
      for (let i = 0; i < 6; i++) {
        const a = t * 0.6 + (i * Math.PI) / 3;
        c.lineTo(cx + Math.cos(a) * W * 0.22, cy + Math.sin(a) * W * 0.22);
      }
      c.closePath();
      c.fill();
      c.fillStyle = '#1b1f2a';
      c.font = `bold ${Math.max(8, s * 0.32)}px system-ui`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('ZENTRALE', cx, y + W - s * 0.38);
    } else {
      c.fillStyle = BUILD_COLORS[kind] || '#666';
      roundRect(c, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.16);
      c.fill();
      c.strokeStyle = 'rgba(0,0,0,0.35)';
      c.lineWidth = Math.max(1, s * 0.05);
      c.stroke();
      const cx = x + s / 2;
      const cy = y + s / 2;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = Math.max(1, s * 0.06);
      const spin = opts.busy ? t * 4 : 0;
      if (kind === 'bohrer') {
        c.save();
        c.translate(cx, cy);
        c.rotate(spin);
        for (let i = 0; i < 3; i++) {
          c.rotate((Math.PI * 2) / 3);
          c.beginPath();
          c.moveTo(0, 0);
          c.lineTo(s * 0.26, -s * 0.07);
          c.lineTo(s * 0.26, s * 0.07);
          c.closePath();
          c.fill();
        }
        c.restore();
      } else if (kind === 'schmelze') {
        const flick = opts.busy ? 0.8 + Math.sin(t * 12) * 0.2 : 0.5;
        c.fillStyle = `rgba(255,${150 + flick * 60},60,${flick})`;
        c.beginPath();
        c.moveTo(cx, cy - s * 0.25);
        c.quadraticCurveTo(cx + s * 0.22, cy, cx, cy + s * 0.22);
        c.quadraticCurveTo(cx - s * 0.22, cy, cx, cy - s * 0.25);
        c.fill();
      } else if (kind === 'presse') {
        const p = opts.busy ? Math.abs(Math.sin(t * 5)) * s * 0.1 : 0;
        c.fillRect(cx - s * 0.22, cy - s * 0.24 + p, s * 0.44, s * 0.12);
        c.fillRect(cx - s * 0.22, cy + s * 0.12, s * 0.44, s * 0.12);
      } else if (kind === 'montage') {
        c.save();
        c.translate(cx, cy);
        c.rotate(spin * 0.5);
        c.beginPath();
        c.moveTo(-s * 0.2, 0); c.lineTo(s * 0.2, 0);
        c.moveTo(0, -s * 0.2); c.lineTo(0, s * 0.2);
        c.stroke();
        c.beginPath();
        c.arc(0, 0, s * 0.12, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
      // Ausgabe-Pfeil am Rand
      const [dx, dy] = DIRS[d];
      drawArrow(c, cx + dx * s * 0.36, cy + dy * s * 0.36, s * 0.45, d, '#ffd27a');
      if (opts.busy && typeof opts.busy === 'string') drawItem(c, opts.busy, x + s * 0.78, y + s * 0.22, s * 0.32);
    }
    c.restore();
  }

  function drawItem(c, id, cx, cy, s) {
    const it = defs && defs.ITEMS[id];
    if (!it) return;
    c.save();
    c.fillStyle = it.color;
    c.strokeStyle = 'rgba(0,0,0,0.5)';
    c.lineWidth = Math.max(1, s * 0.08);
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
    c.restore();
  }

  function frame() {
    requestAnimationFrame(frame);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#12151d';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
    if (!world.ground) return;
    updateKeys();

    const s = cam.zoom;
    const [ox, oy] = toScreen(0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(world.ground, ox, oy, world.w * s, world.h * s);

    // Raster bei genug Zoom
    const [x0, y0] = toWorld(0, 0).map(Math.floor);
    const [x1, y1] = toWorld(innerWidth, innerHeight).map(Math.ceil);
    if (s > 22) {
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.max(0, x0); x <= Math.min(world.w, x1); x++) { const [sx] = toScreen(x, 0); ctx.moveTo(sx, oy); ctx.lineTo(sx, oy + world.h * s); }
      for (let y = Math.max(0, y0); y <= Math.min(world.h, y1); y++) { const [, sy] = toScreen(0, y); ctx.moveTo(ox, sy); ctx.lineTo(ox + world.w * s, sy); }
      ctx.stroke();
    }

    // Gebäude
    for (const b of world.buildings.values()) {
      if (b.x + b.size < x0 || b.y + b.size < y0 || b.x > x1 || b.y > y1) continue;
      const [sx, sy] = toScreen(b.x, b.y);
      drawBuilding(ctx, b.kind, sx, sy, s, b.dir, { size: b.size, busy: busy.get(b.id) });
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
      drawItem(ctx, items[i + 2], sx, sy, s * 0.5);
    }

    // Vorschau
    if (hover && tool !== 'hand') {
      const [sx, sy] = toScreen(hover.x, hover.y);
      if (tool === 'delete') {
        ctx.fillStyle = 'rgba(255,80,80,0.3)';
        ctx.fillRect(sx, sy, s, s);
      } else {
        const ok = canPlace(tool, hover.x, hover.y);
        drawBuilding(ctx, tool, sx, sy, s, dir, { alpha: 0.55 });
        ctx.strokeStyle = ok ? 'rgba(255,255,255,0.8)' : 'rgba(255,80,80,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, s - 2, s - 2);
      }
    }

    // Mauszeiger der Mitspieler
    for (const [id, c] of cursors) {
      const p = players.find((pl) => pl.id === id);
      if (!p) continue;
      const [sx, sy] = toScreen(c.x, c.y);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 12, sy + 5);
      ctx.lineTo(sx + 5, sy + 12);
      ctx.closePath();
      ctx.fill();
      ctx.font = '12px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(p.name, sx + 12, sy + 12);
    }
  }

  function canPlace(kind, x, y) {
    if (x < 0 || y < 0 || x >= world.w || y >= world.h) return false;
    const b = world.grid.get(x + ',' + y);
    if (b && !(b.kind === 'band' && kind === 'band')) return false;
    if (kind === 'bohrer' && world.tiles[y * world.w + x] === '.') return false;
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
    TOOLS.forEach((t, i) => {
      const btn = document.createElement('button');
      btn.dataset.tool = t;
      if (t === 'hand') { btn.textContent = '✋'; btn.title = 'Kamera verschieben (H)'; }
      else if (t === 'delete') { btn.textContent = '🗑'; btn.title = 'Abreißen (X)'; }
      else {
        const def = defs.BUILDINGS[t];
        btn.appendChild(iconCanvas((c) => drawBuilding(c, t, 0, 0, 72, 0)));
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
    rot.title = 'Drehen (R)';
    rot.onclick = () => rotate();
    bar.appendChild(rot);
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
    }
    $('info').textContent = text;
  }

  function renderResearch() {
    if (!research || !defs) return;
    const goal = defs.RESEARCH[research.level];
    const box = $('research-goals');
    box.innerHTML = '';
    if (!goal) {
      $('research-title').textContent = 'Alle Forschungen abgeschlossen 🎉';
      $('research-text').textContent = 'Eure Fabrik läuft. Baut weiter, so groß ihr wollt!';
      return;
    }
    $('research-title').textContent = `Forschung ${research.level + 1}/${defs.RESEARCH.length}: ${goal.name}`;
    $('research-text').textContent = goal.text;
    for (const [id, n] of Object.entries(goal.need)) {
      const have = research.progress[id] || 0;
      const row = document.createElement('div');
      row.className = 'goal';
      row.appendChild(iconCanvas((c) => drawItem(c, id, 36, 36, 64)));
      const label = document.createElement('span');
      label.textContent = `${defs.ITEMS[id].name} ${have}/${n}`;
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.innerHTML = `<div style="width:${Math.min(100, (have / n) * 100)}%"></div>`;
      row.append(label, bar);
      box.appendChild(row);
    }
  }

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
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, mid: toWorld((a.x + b.x) / 2, (a.y + b.y) / 2) };
      drag = null;
      return;
    }
    const cell = cellAt(e.clientX, e.clientY);
    hover = cell;
    if (e.button === 1 || spaceDown || (tool === 'hand' && e.button === 0)) {
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, camx: cam.x, camy: cam.y };
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
    if (drag.mode === 'pan') {
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
    if (k === 'h' || k === 'escape') setTool('hand');
    if (k === 'x' || k === 'delete') setTool('delete');
    if (defs) for (const [id, b] of Object.entries(defs.BUILDINGS)) if (b.key === k) setTool(id);
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === ' ') spaceDown = false;
  });
  addEventListener('blur', () => keys.clear());

  function updateKeys() {
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
