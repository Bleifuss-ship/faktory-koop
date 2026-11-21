// Client von "Fabrik-Koop": Darstellung, Eingabe und Verbindung zum Server.
'use strict';

(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('view');
  // 3D-Darstellung, wenn WebGL geht. Mit ?2d in der Adresse oder ohne WebGL gibt es die flache Ansicht.
  let r3d = null;
  try {
    let gfx = null;
    try { gfx = localStorage.getItem('fk-gfx'); } catch {}
    if (window.Render3D && !/[?&]2d\b/.test(location.search) && gfx !== '2d') r3d = window.Render3D.create(canvas);
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
  let crossItems = []; // Gegenstände auf Kreuzungen: x, y, item, p, Richtung
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
  let leaving = false;
  let session = null; // { name, room, server, code, wantShare }
  function connect(opts) {
    session = opts;
    ws = new WebSocket(wsUrl(opts.server));
    ws.onopen = () => {
      everConnected = true;
      ws.send(JSON.stringify(opts.room ? { t: 'join', name: opts.name, room: opts.room } : { t: 'join', name: opts.name, code: true }));
    };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => {
      if (leaving) return;
      if (!me) {
        // Noch nie in der Welt angekommen: zurück ins Menü mit Hinweis
        menuError(opts, opts.code
          ? `Unter dem Code ${opts.code} wurde kein Spiel gefunden. Hat der Host das Spiel offen, und seid ihr im selben WLAN?`
          : `Keine Verbindung zu ${opts.server || 'diesem Rechner'}. Stimmt die Adresse, und läuft dort das Spiel?`);
        return;
      }
      toast('Verbindung verloren, verbinde neu …');
      setTimeout(() => { if (!leaving) connect(opts); }, 2000);
    };
  }

  function send(msg) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  function handle(m) {
    switch (m.t) {
      case 'fail':
        // Server lehnt den Beitritt ab (z. B. Host in keiner Welt)
        leaving = true;
        ws.close();
        menuError(session, m.text);
        break;
      case 'init':
        defs = m.defs;
        me = m.you;
        enterGame(m);
        loadWorld(m.world);
        players = m.players;
        renderPlayers();
        buildToolbar();
        if (!cam.x) { cam.x = world.w / 2; cam.y = world.h / 2; }
        document.title = 'Fabrik-Koop ' + (m.version || '');
        toast(`Fabrik-Koop ${m.version || ''} · Welt „${m.room}“ · Karte ${world.w} × ${world.h}`, 4500);
        break;
      case 'tick':
        items = m.items;
        crossItems = m.cross || [];
        busy = new Map();
        for (let i = 0; i < m.busy.length; i += 2) busy.set(m.busy[i], m.busy[i + 1]);
        lastTickAt = performance.now();
        if (typeof m.money === 'number') setMoney(m.money);
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
    setMoney(w.money || 0, true);
    if (r3d) r3d.setWorld(world);
    else renderGround();
    renderResearch();
    renderMinimapBase();
  }

  // ---------- Geld ----------
  let money = 0;
  let moneyGain = 0, moneyGainT = 0;
  const fmt = (n) => Math.floor(n).toLocaleString('de-DE');
  function setMoney(v, silent) {
    const diff = v - money;
    const changed = v !== money;
    money = v;
    if (!changed) return;
    $('money-val').textContent = fmt(v);
    if (!silent && diff > 0) {
      // Einnahmen kurz sammeln und als „+N“ zeigen
      const now = performance.now();
      moneyGain = now - moneyGainT < 1500 ? moneyGain + diff : diff;
      moneyGainT = now;
      const d = $('money-delta');
      d.textContent = '+' + fmt(moneyGain);
      d.classList.remove('pop'); void d.offsetWidth; d.classList.add('pop');
    }
    updateAffordable();
  }
  function updateAffordable() {
    if (!defs) return;
    document.querySelectorAll('#toolbar button[data-tool]').forEach((b) => {
      const c = defs.COSTS && defs.COSTS[b.dataset.tool];
      b.classList.toggle('poor', c != null && money < c);
    });
  }

  // ---------- Übersichtskarte ----------
  // Ein Pixel pro Feld; Gebäude und Kameraposition werden laufend darübergezeichnet.
  const mini = { el: $('minimap'), base: null, drawn: 0 };
  const MINI_COL = { '.': '#4f8357', '~': '#4aa6d6', h: '#2f5e36', t: '#b4b8c0', e: '#b0705e', k: '#f0943c', c: '#3a3d46', w: '#9a8cd0', u: '#7ad94a', q: '#f0e0a8', b: '#c0603a', s: '#f2dc3a', g: '#e8c040' };
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
      g.fillStyle = ['band', 'kreuzung', 'verteiler', 'unterfuehrung'].includes(b.kind) ? '#1f2426' : b.kind === 'zentrale' ? '#9a7cf2' : (KIND_COLORS[b.kind] || ['#fff'])[0];
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

  // ---------- Bandkurven ----------
  // Ein Band, das nicht von hinten, aber genau von einer Seite beliefert wird, ist eine Kurve:
  // +1 = Zulauf von rechts, -1 = Zulauf von links (relativ zur Laufrichtung), 0 = gerade.
  const curveCache = { v: -1, m: new Map() };
  // Liefert das Nachbarfeld (b.x+ox, b.y+oy) Gegenstände in Band b?
  function feedsInto(b, ox, oy) {
    const n = world.grid.get((b.x + ox) + ',' + (b.y + oy));
    if (!n || n === b || n.size > 1) return false;
    if (n.kind === 'kreuzung') return true; // Kreuzungen geben geradeaus weiter
    if (n.kind === 'unterfuehrung' && tunnelIsEntrance(n)) return false; // Eingang gibt unter der Erde weiter
    if (n.kind === 'verteiler') { // Verteiler geben nach vorne, rechts und links aus
      const back = DIRS[(n.dir + 2) % 4];
      return !(n.x + back[0] === b.x && n.y + back[1] === b.y);
    }
    const [fx, fy] = DIRS[n.dir];
    return n.x + fx === b.x && n.y + fy === b.y;
  }
  // Automatische Zusammenführung: gerades Band, in das zwei oder drei Bänder hineinlaufen.
  // Gibt die Eingänge zurück ('back', 'right', 'left') oder null.
  function beltMerge(b) {
    if (b.kind !== 'band') return null;
    const ins = [];
    for (const [name, o] of [['back', 2], ['right', 1], ['left', 3]]) {
      const [ox, oy] = DIRS[(b.dir + o) % 4];
      if (feedsInto(b, ox, oy)) ins.push(name);
    }
    if (ins.length < 2) return null;
    return ins;
  }
  function beltCurve(b) {
    if (curveCache.v !== world.version) { curveCache.v = world.version; curveCache.m.clear(); }
    let c = curveCache.m.get(b.id);
    if (c !== undefined) return c;
    c = 0;
    const feeds = (ox, oy) => feedsInto(b, ox, oy);
    const [dx, dy] = DIRS[b.dir];
    const [rx, ry] = DIRS[(b.dir + 1) % 4];
    if (!feeds(-dx, -dy)) {
      const r = feeds(rx, ry), l = feeds(-rx, -ry);
      if (r && !l) c = 1; else if (l && !r) c = -1;
    }
    curveCache.m.set(b.id, c);
    return c;
  }
  // Gerades Band, in das von der Seite ein anderes Band einmündet (T-Stück)
  const BELT_KINDS = new Set(['band', 'kreuzung', 'verteiler', 'unterfuehrung']);
  function beltSides(b) {
    const side = (o) => {
      const [ox, oy] = DIRS[(b.dir + o) % 4];
      const n = world.grid.get((b.x + ox) + ',' + (b.y + oy));
      // Neben jedem anderen Bandteil fällt die Schiene weg: Bänder verschmelzen zu einer dunklen Fläche
      return !!n && BELT_KINDS.has(n.kind);
    };
    return { openR: side(1), openL: side(3) };
  }
  // Mündet Band b seitlich in ein gerades Band? Dann reicht sein Laufband über dessen Schiene.
  function beltJoin(b) {
    const [fx, fy] = DIRS[b.dir];
    const n = world.grid.get((b.x + fx) + ',' + (b.y + fy));
    if (!n || n.kind !== 'band' || n.dir % 2 === b.dir % 2) return false;
    return beltCurve(n) === 0;
  }
  // Unterführungen: gleiche Richtung, bis zu 4 Felder dazwischen, abwechselnd Eingang und Ausgang
  function tunnelNeighbor(t, sign) {
    const [dx, dy] = DIRS[t.dir];
    const R = (defs && defs.TUNNEL_RANGE) || 5;
    for (let k = 1; k <= R; k++) {
      const n = world.grid.get((t.x + dx * k * sign) + ',' + (t.y + dy * k * sign));
      if (n && n.kind === 'unterfuehrung' && n.dir === t.dir) return n;
    }
    return null;
  }
  function tunnelIsEntrance(t, depth = 0) {
    const prev = tunnelNeighbor(t, -1);
    return !prev || depth > 50 ? true : !tunnelIsEntrance(prev, depth + 1);
  }
  // { role: 'in' | 'out', alone: ohne Partner }
  function tunnelRole(t) {
    if (tunnelIsEntrance(t)) return { role: 'in', alone: !tunnelNeighbor(t, 1) };
    return { role: 'out', alone: false };
  }
  // Gegenstand i der Tick-Liste [x, y, item, p, s, m]: Position zwischen zwei Ticks.
  // Nur Gegenstände, die sich im letzten Tick bewegt haben (m), laufen weiter; s ist der seitliche Versatz.
  const ITEM_STRIDE = 6;
  function itemPoint(i, dt) {
    const x = items[i], y = items[i + 1];
    const b = world.grid.get(x + ',' + y);
    const moving = items[i + 5];
    let sOff = items[i + 4];
    let p = items[i + 3];
    if (moving && sOff) sOff -= Math.sign(sOff) * Math.min(Math.abs(sOff), beltSpeed * dt);
    else if (moving) p = Math.min(1, p + beltSpeed * dt);
    if (!b) return [x + 0.5, y + 0.5, 0];
    const [wx, wy, ang] = beltPoint(b, p);
    const [rx, ry] = DIRS[(b.dir + 1) % 4];
    return [wx + rx * sOff, wy + ry * sOff, ang];
  }
  // Punkt und Laufrichtung (Winkel) auf einem Band bei Fortschritt p (0..1), in Weltkoordinaten
  function beltPoint(b, p) {
    const c = b.kind === 'band' ? beltCurve(b) : 0;
    const [fx, fy] = DIRS[b.dir];
    const [rx, ry] = DIRS[(b.dir + 1) % 4];
    let lx = p - 0.5, lz = 0, head = 0;
    if (c) {
      const a = Math.PI + c * p * Math.PI / 2;
      lx = 0.5 + 0.5 * Math.cos(a);
      lz = c * 0.5 + 0.5 * Math.sin(a);
      head = Math.atan2(c * Math.cos(a), -c * Math.sin(a));
    }
    return [b.x + 0.5 + lx * fx + lz * rx, b.y + 0.5 + lx * fy + lz * ry, b.dir * Math.PI / 2 + head];
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
        c.fillStyle = `hsl(${128 + n * 6}, 25%, ${42 + n * 5}%)`;
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
    // Vorkommen: helle Bodenflecken mit Steinen, Kristallen oder Sandhügeln
    const DEP = {
      h: { soil: '#4d7c4f', main: '#4f9a4a', light: '#7cc46a', dark: '#2f6a34' },
      t: { soil: '#7f8a80', main: '#a4aab4', light: '#d4d8e0', dark: '#7a808c' },
      e: { soil: '#80705e', main: '#9a5a4e', light: '#c48a7e', dark: '#6a3a32' },
      k: { soil: '#87916a', main: '#f0943c', light: '#6fd8c0', dark: '#c0682a' },
      c: { soil: '#5a5f58', main: '#3a3d46', light: '#6a6e7a', dark: '#22242a' },
      w: { soil: '#76708e', main: '#8a7fb0', light: '#c8c0ee', dark: '#5f5488' },
      u: { soil: '#6f8a5a', main: '#7ad94a', light: '#d4ff9a', dark: '#3f8a2a' },
      q: { soil: '#a8a070', main: '#e6cf88', light: '#fff4cc', dark: '#c8ae66' },
      b: { soil: '#8e6a5a', main: '#c0603a', light: '#e89070', dark: '#8a3a22' },
      s: { soil: '#a09a62', main: '#f2dc3a', light: '#fff6a0', dark: '#b8a020' },
      g: { soil: '#8a856e', main: '#e8c040', light: '#fff0a0', dark: '#a88420' },
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
    verteiler: ['#4f86f7'],
    kreuzung: ['#f5b82e'],
    zusammenfuehrer: ['#22b39a'],
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
    // violetter Sockel-Rahmen mit heller Innenkante
    c.fillStyle = '#3f3a6e';
    roundRect(c, x, y + lip, w, h - lip, r);
    c.fill();
    c.fillStyle = '#5f58a0';
    roundRect(c, x, y, w, h - lip, r);
    c.fill();
    const e = s * 0.05;
    c.fillStyle = '#efe6d2';
    roundRect(c, x + e, y + e, w - e * 2, h - lip - e * 2, Math.max(2, r - e));
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

  // Gurtstück (lokal, Laufrichtung +x): Lamellen und helle Pfeile, die mitlaufen
  function beltStrip(c, x0, y0, w, h, s, t, noArrows) {
    c.save();
    c.beginPath(); c.rect(x0, y0, w, h); c.clip();
    c.fillStyle = '#2d3233';
    c.fillRect(x0, y0, w, h);
    // ein türkiser Bogenpfeil pro Feld, läuft mit dem Band mit
    if (!noArrows) {
      const off = ((t * beltSpeed * 10) % 1) * s;
      c.strokeStyle = '#4fb0c0';
      c.lineWidth = Math.max(1.5, s * 0.075);
      c.lineCap = 'round';
      for (let i = -2; i <= 2; i++) {
        const px = i * s + off - s * 0.12;
        c.beginPath(); c.arc(px, 0, s * 0.17, -0.95, 0.95); c.stroke();
      }
    }
    c.restore();
  }

  // weißer quadratischer Rahmen auf Bandteilen (Mitte = Ursprung)
  function whiteFrame2d(c, s, size) {
    c.strokeStyle = '#d2d7d8';
    c.lineWidth = Math.max(1.5, s * 0.06);
    c.strokeRect(-size * s / 2, -size * s / 2, size * s, size * s);
  }

  // Zeichnet ein Gebäude in Pixelkoordinaten (x,y = linke obere Ecke, s = Zellgröße)
  function drawBuilding(c, kind, x, y, s, d, opts = {}) {
    const size = opts.size || 1;
    const W = s * size;
    const t = performance.now() / 1000;
    c.save();
    if (opts.alpha) c.globalAlpha = opts.alpha;
    if (kind === 'kreuzung' || kind === 'verteiler' || kind === 'zusammenfuehrer') {
      // Bandteile: dunkler Grund, Bandstücke; Verteiler/Zusammenführer als bunter Kasten mit Öffnungen
      const col = KIND_COLORS[kind][0];
      c.translate(x + s / 2, y + s / 2);
      c.rotate(d * Math.PI / 2);
      c.fillStyle = '#2d3233';
      if (!opts.boxOnly) c.fillRect(-s / 2, -s / 2, s, s);
      const stub = (a, out) => { c.save(); c.rotate(a); beltStrip(c, out ? 0 : -s / 2, -s * 0.4, s / 2, s * 0.8, s, t); c.restore(); };
      if (kind === 'kreuzung') {
        beltStrip(c, -s / 2, -s * 0.4, s, s * 0.8, s, t);
        c.save(); c.rotate(Math.PI / 2); beltStrip(c, -s / 2, -s * 0.4, s, s * 0.8, s, t); c.restore();
        whiteFrame2d(c, s, 0.62);
      } else {
        const split = kind === 'verteiler';
        const ANG = { back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 };
        const ins = split ? [Math.PI] : (opts.ins || ['back', 'right', 'left']).map((n) => ANG[n]);
        const outs = split ? [0, Math.PI / 2, -Math.PI / 2] : [0];
        if (!opts.boxOnly) {
          for (const a of ins) stub(a + Math.PI, false);
          for (const a of outs) stub(a, true);
        }
        if (split) { whiteFrame2d(c, s, 0.36); c.restore(); return; } // Verteiler: Band-T-Stück mit kleinem weißen Rahmen
        // Kasten mit Schatten
        c.fillStyle = 'rgba(0,0,0,0.25)';
        roundRect(c, -s * 0.33 + s * 0.04, -s * 0.33 + s * 0.05, s * 0.66, s * 0.66, s * 0.12); c.fill();
        c.fillStyle = col;
        roundRect(c, -s * 0.33, -s * 0.33, s * 0.66, s * 0.66, s * 0.12); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.35)';
        roundRect(c, -s * 0.26, -s * 0.26, s * 0.52, s * 0.52, s * 0.08); c.fill();
        // dunkle Öffnungen
        c.fillStyle = '#2b303b';
        for (const a of [...ins, ...outs]) { c.save(); c.rotate(a); roundRect(c, s * 0.27, -s * 0.21, s * 0.07, s * 0.42, s * 0.03); c.fill(); c.restore(); }
        // weiße Pfeile
        c.fillStyle = '#ffffff';
        const arrows = split ? outs.map((a) => [a, 0.13, false]) : [...ins.map((a) => [a, 0.17, true]), [0, 0.02, false]];
        for (const [a, r, flip] of arrows) {
          c.save(); c.rotate(a); c.translate(r * s, 0); if (flip) c.rotate(Math.PI);
          c.beginPath(); c.moveTo(s * 0.11, 0); c.lineTo(-s * 0.03, -s * 0.085); c.lineTo(-s * 0.03, s * 0.085); c.closePath(); c.fill();
          c.restore();
        }
      }
    } else if (kind === 'unterfuehrung') {
      // Unterführung: halbes Band, das in ein Tunneltor läuft (Eingang) oder aus ihm kommt (Ausgang)
      const out = opts.role === 'out';
      c.translate(x + s / 2, y + s / 2);
      c.rotate(d * Math.PI / 2);
      c.fillStyle = '#2d3233';
      c.fillRect(-s / 2, -s / 2, s, s);
      const bx = out ? 0 : -s / 2;
      beltStrip(c, bx, -s * 0.4, s / 2, s * 0.8, s, t);
      c.fillStyle = '#d2d7d8';
      roundRect(c, bx, -s / 2, s / 2, s * 0.1, s * 0.04); c.fill();
      roundRect(c, bx, s * 0.4, s / 2, s * 0.1, s * 0.04); c.fill();
      // Tor aus Stein mit dunkler Öffnung zur Bandseite
      const gx = out ? -s / 2 : 0;
      c.fillStyle = 'rgba(0,0,0,0.25)';
      roundRect(c, gx + s * 0.03, -s * 0.46 + s * 0.04, s / 2, s * 0.92, s * 0.1); c.fill();
      c.fillStyle = opts.alone ? '#c9a0a0' : '#a7afbd';
      roundRect(c, gx, -s * 0.46, s / 2, s * 0.92, s * 0.1); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.25)';
      roundRect(c, gx + s * 0.06, -s * 0.38, s * 0.38, s * 0.76, s * 0.07); c.fill();
      c.fillStyle = '#1f232b';
      const mx = out ? -s * 0.08 : 0;
      roundRect(c, mx, -s * 0.34, s * 0.08, s * 0.68, s * 0.04); c.fill();
      // Pfeil nach unten bzw. oben (Eingang/Ausgang)
      c.fillStyle = '#ffffff';
      c.beginPath();
      const ax = out ? -s * 0.25 : s * 0.25;
      if (out) { c.moveTo(ax + s * 0.1, 0); c.lineTo(ax - s * 0.04, -s * 0.09); c.lineTo(ax - s * 0.04, s * 0.09); }
      else { c.moveTo(ax + s * 0.1, 0); c.lineTo(ax - s * 0.04, -s * 0.09); c.lineTo(ax - s * 0.04, s * 0.09); }
      c.closePath(); c.fill();
    } else if (kind === 'band' && opts.curve) {
      // Kurve: Viertelkreis um die innere Ecke
      const k = opts.curve;
      c.save();
      c.translate(x + s / 2, y + s / 2);
      c.rotate(d * Math.PI / 2);
      const a0 = Math.PI, a1 = Math.PI + k * Math.PI / 2;
      const arc = (r, w, col) => { c.strokeStyle = col; c.lineWidth = w; c.lineCap = 'butt'; c.beginPath(); c.arc(s / 2, k * s / 2, r, a0, a1, k < 0); c.stroke(); };
      arc(s / 2, s, '#2d3233');
      arc(s / 2, s * 0.8, '#2d3233');
      arc(s * 0.95, s * 0.1, '#d2d7d8');
      c.strokeStyle = '#4fb0c0';
      c.lineWidth = Math.max(1.5, s * 0.075);
      c.lineCap = 'round';
      const off = (t * beltSpeed * 10) % 1;
      for (let i = -1; i < 1; i++) {
        const p = i + off + 0.5;
        if (p < 0 || p > 1) continue;
        const a = Math.PI + k * p * Math.PI / 2;
        const px = s / 2 + (s / 2) * Math.cos(a), py = k * s / 2 + (s / 2) * Math.sin(a);
        c.save();
        c.translate(px, py);
        c.rotate(Math.atan2(k * Math.cos(a), -k * Math.sin(a)));
        c.beginPath(); c.arc(-s * 0.12, 0, s * 0.17, -0.95, 0.95); c.stroke();
        c.restore();
      }
      c.restore();
    } else if (kind === 'band') {
      c.save();
      c.translate(x + s / 2, y + s / 2);
      c.rotate(d * Math.PI / 2);
      // dunkler Grund über das ganze Feld, Gurt, helle runde Seitenschienen
      c.fillStyle = '#2d3233';
      c.fillRect(-s / 2, -s / 2, s, s);
      beltStrip(c, -s / 2, -s * 0.4, s, s * 0.8, s, t);
      c.fillStyle = '#d2d7d8';
      if (!opts.openR) { roundRect(c, -s / 2, s * 0.4, s, s * 0.1, s * 0.04); c.fill(); }
      if (!opts.openL) { roundRect(c, -s / 2, -s / 2, s, s * 0.1, s * 0.04); c.fill(); }
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
      c.fillStyle = '#f07a3c';
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
      r3d.render({ world, items, crossItems, busy, beltSpeed, beltCurve, beltJoin, beltSides, beltMerge, beltPoint, itemPoint, itemStride: ITEM_STRIDE, tunnelRole, lastTickAt, hover, tool, dir, cursors, players, defs, canPlace });
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
    if (s > 14) {
      ctx.strokeStyle = `rgba(20,50,25,${Math.min(0.32, (s - 14) / 60)})`;
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
      if (b.kind === 'kreuzung' || b.kind === 'verteiler' || b.kind === 'unterfuehrung') {
        // flache Bandteile gehören unter die Gegenstände
        const [sx, sy] = toScreen(b.x, b.y);
        drawBuilding(ctx, b.kind, sx, sy, s, b.kind === 'kreuzung' ? 0 : b.dir, b.kind === 'unterfuehrung' ? tunnelRole(b) : {});
        continue;
      }
      if (b.kind !== 'band') continue;
      const [sx, sy] = toScreen(b.x, b.y);
      const curve = beltCurve(b);
      drawBuilding(ctx, b.kind, sx, sy, s, b.dir, curve ? { curve } : beltSides(b));
    }

    // Items auf Bändern (zwischen Ticks interpoliert)
    const dt = Math.min(1, (performance.now() - lastTickAt) / 100);
    for (let i = 0; i < items.length; i += ITEM_STRIDE) {
      const x = items[i];
      const y = items[i + 1];
      if (x < x0 - 1 || y < y0 - 1 || x > x1 || y > y1) continue;
      const [wx, wy] = itemPoint(i, dt);
      const [sx, sy] = toScreen(wx, wy);
      ctx.fillStyle = 'rgba(20,30,40,0.28)';
      ctx.beginPath(); ctx.ellipse(sx + s * 0.03, sy + s * 0.12, s * 0.2, s * 0.08, 0, 0, Math.PI * 2); ctx.fill();
      drawItem(ctx, items[i + 2], sx, sy, s * 0.36);
    }
    for (let i = 0; i < crossItems.length; i += 5) {
      const [dx, dy] = DIRS[crossItems[i + 4]];
      const p = Math.min(1, crossItems[i + 3] + (crossItems[i + 3] < 1 ? beltSpeed * dt : 0));
      const [sx, sy] = toScreen(crossItems[i] + 0.5 + dx * (p - 0.5), crossItems[i + 1] + 0.5 + dy * (p - 0.5));
      drawItem(ctx, crossItems[i + 2], sx, sy, s * 0.36);
    }

    for (const b of visible) {
      if (b.kind === 'band' || b.kind === 'kreuzung' || b.kind === 'verteiler' || b.kind === 'unterfuehrung') continue;
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
        // kräftig blaue Markierung unter der Vorschau, damit man sie gut sieht
        ctx.fillStyle = ok ? 'rgba(47,140,255,0.45)' : 'rgba(255,90,90,0.4)';
        roundRect(ctx, sx + 1.5, sy + 1.5, s - 3, s - 3, s * 0.18);
        ctx.fill();
        drawBuilding(ctx, tool, sx, sy, s, dir, { alpha: 0.75 });
        ctx.strokeStyle = ok ? '#1f6fff' : '#ff5a5a';
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
    const part = defs && defs.BELT_PARTS ? defs.BELT_PARTS.includes(kind) : kind === 'kreuzung';
    if (b && !(b.kind === 'band' && (kind === 'band' || part))) return false;
    const tile = world.tiles[y * world.w + x];
    if (kind === 'bohrer' && !(defs && defs.DEPOSITS[tile])) return false;
    if (kind !== 'band' && !part && tile === '~') return false;
    if ((!b || part) && defs && defs.COSTS && money < (defs.COSTS[kind] || 0)) return false;
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
    TOOLS = ['hand', ...Object.keys(defs.BUILDINGS).filter((k) => !defs.BUILDINGS[k].hidden), 'delete'];
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
        const cost = defs.COSTS ? defs.COSTS[t] : 0;
        if (cost) {
          const pr = document.createElement('span');
          pr.className = 'price';
          pr.textContent = fmt(cost);
          btn.appendChild(pr);
          btn.title += ` · kostet ${fmt(cost)} Taler`;
        }
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
    updateAffordable();
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
      text = `${d.name} (${fmt((defs.COSTS && defs.COSTS[tool]) || 0)} Taler): ${d.desc}`;
      const rec = defs.RECIPES[tool];
      if (rec) text += '  ' + rec.map((r) => Object.keys(r.in).map((k) => defs.ITEMS[k].name).join(' + ') + ' → ' + defs.ITEMS[r.out].name).join(' · ');
    } else if (hover) {
      const b = world.grid.get(hover.x + ',' + hover.y);
      const t = world.tiles[hover.y * world.w + hover.x];
      if (b && b.kind === 'zentrale') text = 'Zentrale: Hierhin liefern. Jede Lieferung bringt Taler und füllt das Lager für die Forschung.';
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
    } else if (e.button === 2) {
      // Rechtsklick macht absichtlich nichts (kein Abreißen mehr)
      return;
    } else if (tool === 'delete') {
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
    if (k === 'escape') {
      // Esc schließt zuerst den Techbaum, dann das Werkzeug, dann öffnet es das Menü
      if (!$('techtree').classList.contains('hidden')) $('techtree').classList.add('hidden');
      else if (!$('pause').classList.contains('hidden')) closePause();
      else if (tool !== 'hand') setTool('hand');
      else if (me) openPause();
      return;
    }
    if (!$('pause').classList.contains('hidden') || !$('menu').classList.contains('hidden')) return;
    if (k === 'h') setTool('hand');
    if (k === 'x' || k === 'delete') setTool('delete');
    if (k === 'm') { mini.el.classList.toggle('off'); store('fk-mini', mini.el.classList.contains('off') ? 'off' : 'on'); }
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

  // ---------- Menü ----------
  const params = new URLSearchParams(location.search);
  const JC = window.JoinCode;
  const isDesktop = /Electron/.test(navigator.userAgent);
  let info = null; // Antwort von /info des eigenen Servers
  let shareCodes = [];

  function load(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function store(k, v) { try { localStorage.setItem(k, v); } catch {} }

  if (load('fk-mini') === 'off') mini.el.classList.add('off');

  function showPage(id) {
    for (const sec of document.querySelectorAll('#menu section')) sec.classList.toggle('hidden', sec.dataset.page !== id);
    if (id === 'worlds' || id === 'host') {
      const host = id === 'host';
      $('menu').querySelector('[data-page="worlds"]').classList.remove('hidden');
      $('menu').querySelector('[data-page="worlds"]').dataset.host = host ? '1' : '';
      $('w-title').textContent = host ? '👥 Welt für Mitspieler wählen' : '🏭 Welt wählen';
      $('w-sub').textContent = host
        ? 'Starte eine Welt. Danach bekommst du einen Code, den deine Freunde eingeben.'
        : 'Deine Welten auf diesem Gerät.';
      $('w-err').textContent = '';
      loadWorlds();
    }
    if (id === 'code') setTimeout(() => $('c-code').focus(), 30);
    if (id === 'settings') renderSettings();
  }

  function playerName() {
    const n = $('m-name').value.trim();
    if (n) store('fk-name', n);
    return n || 'Gast';
  }

  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 90) return 'gerade eben';
    if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
    if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
    const d = Math.round(s / 86400);
    return d === 1 ? 'gestern' : `vor ${d} Tagen`;
  }

  function loadWorlds() {
    const list = $('w-list');
    list.innerHTML = '<p class="m-sub">Lade …</p>';
    fetch('/worlds').then((r) => r.json()).then((worlds) => {
      if (!worlds.length) { list.innerHTML = '<p class="m-sub">Noch keine Welt. Leg unten eine neue an.</p>'; return; }
      list.innerHTML = '';
      for (const w of worlds) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'w-item';
        b.innerHTML = `<b>${escapeHtml(w.name)}</b><small>${w.players ? `🟢 ${w.players} spielen gerade` : 'gespeichert ' + ago(w.saved)}</small><span>▶</span>`;
        b.onclick = () => startLocal(w.name, hostMode());
        list.appendChild(b);
      }
    }).catch(() => { list.innerHTML = '<p class="m-sub">Welten konnten nicht geladen werden.</p>'; });
  }

  function cleanName(n) {
    return String(n || '').toLowerCase().replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c])).replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  }

  function hideMenu() {
    $('menu').classList.add('hidden');
  }

  function hostMode() { return $('menu').querySelector('[data-page="worlds"]').dataset.host === '1'; }

  function startLocal(room, wantShare) {
    store('fk-last', JSON.stringify({ room }));
    hideMenu();
    connect({ name: playerName(), room, server: '', wantShare });
  }

  function startCode(code) {
    const addr = JC.decode(code);
    if (!addr) { $('c-err').textContent = 'Diesen Code gibt es nicht. Bitte noch einmal genau abtippen.'; return; }
    const pretty = JC.pretty(JC.encode(addr));
    store('fk-last', JSON.stringify({ code: pretty }));
    hideMenu();
    connect({ name: playerName(), server: addr, code: pretty });
  }

  // Zurück ins Menü, wenn der Beitritt nicht geklappt hat
  function menuError(opts, text) {
    $('menu').classList.remove('hidden');
    if (opts.code) { showPage('code'); $('c-code').value = opts.code; $('c-err').textContent = text; }
    else if (opts.server) { showPage('code'); $('m-adv').open = true; $('c-err').textContent = text; }
    else { showPage('home'); toast(text, 5000); }
    leaving = false;
    everConnected = false;
  }

  function renderSettings() {
    const gfx = load('fk-gfx') === '2d' || !r3d ? '2d' : '3d';
    for (const b of $('s-gfx').children) b.classList.toggle('on', b.dataset.v === gfx);
    const mm = mini.el.classList.contains('off') ? 'off' : 'on';
    for (const b of $('s-mini').children) b.classList.toggle('on', b.dataset.v === mm);
    $('s-note').textContent = window.Render3D || r3d ? '' : '3D ist auf diesem Gerät nicht verfügbar.';
  }

  $('s-gfx').addEventListener('click', (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v || v === (r3d ? '3d' : '2d')) return;
    store('fk-gfx', v);
    playerName();
    // Die Darstellung wird beim Start gewählt, also neu laden und wieder in die Einstellungen
    location.href = location.pathname + '?seite=settings';
  });
  $('s-mini').addEventListener('click', (e) => {
    const v = e.target.dataset && e.target.dataset.v;
    if (!v) return;
    mini.el.classList.toggle('off', v === 'off');
    store('fk-mini', v);
    renderSettings();
  });

  for (const b of document.querySelectorAll('#menu [data-go]')) b.addEventListener('click', () => showPage(b.dataset.go));

  $('w-new').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = $('w-new-name').value.trim();
    const name = cleanName(raw);
    if (!name) { $('w-err').textContent = 'Bitte einen Namen eingeben (Buchstaben und Zahlen).'; return; }
    const exists = [...$('w-list').querySelectorAll('.w-item b')].some((b) => b.textContent === name);
    if (exists) { $('w-err').textContent = `Die Welt „${name}“ gibt es schon. Tippe sie oben an, um sie zu laden.`; return; }
    startLocal(name, hostMode());
  });

  $('c-code').addEventListener('input', () => {
    const el = $('c-code');
    el.value = el.value.toUpperCase().replace(/[^0-9A-Z-]/g, '');
    $('c-err').textContent = '';
  });
  $('c-form').addEventListener('submit', (e) => { e.preventDefault(); startCode($('c-code').value); });
  $('a-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const server = $('a-server').value.trim();
    if (!server) { $('c-err').textContent = 'Bitte die Adresse des Hosts eintragen.'; return; }
    const room = cleanName($('a-room').value);
    store('fk-server', server);
    hideMenu();
    connect({ name: playerName(), server, room: room || null });
  });

  $('m-continue').addEventListener('click', () => {
    let last = null;
    try { last = JSON.parse(load('fk-last')); } catch {}
    if (!last) return;
    if (last.code) startCode(last.code);
    else startLocal(last.room);
  });
  $('m-here').addEventListener('click', () => { hideMenu(); connect({ name: playerName(), server: '' }); });
  $('m-quit').addEventListener('click', () => window.close());

  // ---------- Menü im Spiel ----------
  function enterGame(m) {
    $('menu').classList.add('hidden');
    $('menu-btn').classList.remove('hidden');
    $('p-world').textContent = `Welt „${m.room}“`;
    shareCodes = m.host ? JC.sortAddresses(m.share).map((a) => JC.pretty(JC.encode(a))).filter(Boolean) : [];
    const chip = $('code-chip');
    if (shareCodes.length) {
      chip.innerHTML = `👥 Code <b>${shareCodes[0]}</b>`;
      chip.classList.remove('hidden');
      $('p-code').textContent = shareCodes[0];
      $('p-code').classList.toggle('long', shareCodes[0].length > 5);
      $('p-alt').textContent = shareCodes.length > 1 ? `Klappt es nicht? Andere Netzwerke dieses Rechners: ${shareCodes.slice(1).join(', ')}` : '';
      $('p-share').classList.remove('hidden');
      $('p-guest').classList.add('hidden');
    } else {
      chip.classList.add('hidden');
      $('p-share').classList.add('hidden');
      $('p-guest').textContent = session && session.code ? `Du spielst mit Code ${session.code} bei einem Freund mit.` : '';
      $('p-guest').classList.toggle('hidden', !$('p-guest').textContent);
    }
    if (m.host && session && session.wantShare) openPause();
  }

  function openPause() {
    $('pause').classList.remove('hidden');
    $('pause').querySelector('.m-help')?.remove();
  }
  function closePause() { $('pause').classList.add('hidden'); }

  $('menu-btn').addEventListener('click', () => ($('pause').classList.contains('hidden') ? openPause() : closePause()));
  $('code-chip').addEventListener('click', openPause);
  $('p-resume').addEventListener('click', closePause);
  $('pause').addEventListener('click', (e) => { if (e.target === $('pause')) closePause(); });
  $('p-help').addEventListener('click', () => {
    const card = $('pause').querySelector('.menu-card');
    const old = card.querySelector('.m-help');
    if (old) { old.remove(); return; }
    const list = $('menu').querySelector('.m-help').cloneNode(true);
    $('p-help').after(list);
  });
  $('p-leave').addEventListener('click', () => {
    leaving = true;
    if (ws) ws.close();
    // Neu laden, damit das Hauptmenü mit sauberem Zustand startet (der Server speichert die Welt)
    setTimeout(() => { location.href = location.pathname; }, 150);
  });

  // ---------- Start ----------
  $('m-name').value = load('fk-name') || '';
  $('a-server').value = params.get('server') || load('fk-server') || '';
  $('m-quit').classList.toggle('hidden', !isDesktop);

  function setLocalButtons(on) {
    for (const b of document.querySelectorAll('#menu [data-local]')) b.classList.toggle('hidden', !on);
  }

  function showContinue() {
    let last = null;
    try { last = JSON.parse(load('fk-last')); } catch {}
    const btn = $('m-continue');
    if (!last || (last.room && !info?.local)) { btn.classList.add('hidden'); return; }
    btn.querySelector('small').textContent = last.code ? `Bei Code ${last.code} mitspielen` : `Welt „${last.room}“`;
    btn.classList.remove('hidden');
  }

  setLocalButtons(false);
  if (!isApp) {
    fetch('/info').then((r) => r.json()).then((i) => {
      info = i;
      if (i.version) $('menu-version').textContent = 'Version ' + i.version;
      if (i.local) {
        setLocalButtons(true);
      } else {
        // Im Browser auf einem anderen Gerät, das die Seite des Hosts geöffnet hat
        $('m-here').classList.remove('hidden');
        $('m-here').querySelector('small').textContent = i.hostWorld ? `Welt „${i.hostWorld}“ auf ${location.host}` : location.host;
      }
      showContinue();
    }).catch(() => showContinue());
  } else {
    $('menu-version').textContent = 'Handy-App';
    showContinue();
  }

  // Alte Links mit ?welt=name direkt starten
  const linkRoom = cleanName(params.get('welt'));
  const startPage = params.get('seite');
  if (params.get('code')) { showPage('code'); $('c-code').value = params.get('code').toUpperCase(); }
  else if (startPage) showPage(startPage);
  else showPage('home');
  if (linkRoom && load('fk-name')) startLocal(linkRoom);
  if (startPage) history.replaceState(null, '', location.pathname);

  requestAnimationFrame(frame);
})();
