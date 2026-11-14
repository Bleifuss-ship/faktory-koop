// Spiellogik von "Fabrik-Koop". Läuft nur auf dem Server, der Client bekommt
// den Zustand und die Definitionen per WebSocket.
'use strict';

const DIRS = [
  [1, 0], // 0 rechts
  [0, 1], // 1 unten
  [-1, 0], // 2 links
  [0, -1], // 3 oben
];

// Bodenvorkommen: Buchstabe im Kartenstring -> Rohstoff
const DEPOSITS = {
  r: 'rubinerz',
  b: 'azurit',
  s: 'quarzsand',
};

const ITEMS = {
  rubinerz: { name: 'Rubinerz', color: '#c8463c', shape: 'rock' },
  azurit: { name: 'Azurit', color: '#3c78c8', shape: 'rock' },
  quarzsand: { name: 'Quarzsand', color: '#e0cf8a', shape: 'dust' },
  rubinbarren: { name: 'Rubinbarren', color: '#e0584a', shape: 'bar' },
  azurbarren: { name: 'Azurbarren', color: '#5a9ae8', shape: 'bar' },
  glas: { name: 'Glasscheibe', color: '#a8e8e0', shape: 'pane' },
  zahnrad: { name: 'Zahnrad', color: '#f0a040', shape: 'gear' },
  spule: { name: 'Kupferspule', color: '#70b8ff', shape: 'coil' },
  motor: { name: 'Motor', color: '#ffb84a', shape: 'box' },
  lampe: { name: 'Lampe', color: '#fff070', shape: 'bulb' },
  robo: { name: 'Helferbot', color: '#b48cff', shape: 'bot' },
};

const RECIPES = {
  schmelze: [
    { in: { rubinerz: 1 }, out: 'rubinbarren', time: 20 },
    { in: { azurit: 1 }, out: 'azurbarren', time: 20 },
    { in: { quarzsand: 1 }, out: 'glas', time: 20 },
  ],
  presse: [
    { in: { rubinbarren: 1 }, out: 'zahnrad', time: 15 },
    { in: { azurbarren: 1 }, out: 'spule', time: 15 },
  ],
  montage: [
    { in: { zahnrad: 1, spule: 1 }, out: 'motor', time: 30 },
    { in: { glas: 1, spule: 1 }, out: 'lampe', time: 30 },
    { in: { motor: 1, lampe: 1 }, out: 'robo', time: 40 },
  ],
};

const BUILDINGS = {
  band: { name: 'Förderband', key: '1', desc: 'Transportiert Gegenstände in Pfeilrichtung.' },
  bohrer: { name: 'Bohrer', key: '2', desc: 'Auf ein Vorkommen stellen. Gibt Rohstoffe nach vorne aus.' },
  schmelze: { name: 'Schmelze', key: '3', desc: 'Erz/Sand → Barren/Glas.' },
  presse: { name: 'Presse', key: '4', desc: 'Barren → Zahnrad/Spule.' },
  montage: { name: 'Montage', key: '5', desc: 'Zwei Zutaten → Bauteil.' },
};

// Forschungsstufen: liefere Gegenstände an die Zentrale, um weiterzukommen.
const RESEARCH = [
  { name: 'Erste Barren', need: { rubinbarren: 20 }, unlock: ['presse'], text: 'Schaltet die Presse frei.' },
  { name: 'Mechanik', need: { zahnrad: 20, azurbarren: 20 }, unlock: ['montage'], text: 'Schaltet die Montage frei.' },
  { name: 'Antrieb', need: { motor: 15, glas: 30 }, bonus: { bohrer: 1.5 }, text: 'Bohrer arbeiten 50 % schneller.' },
  { name: 'Beleuchtung', need: { lampe: 15, spule: 40 }, bonus: { band: 1.5 }, text: 'Förderbänder laufen 50 % schneller.' },
  { name: 'Automatisierung', need: { robo: 10 }, text: 'Die Fabrik ist komplett. Gewonnen!' },
];

const START_UNLOCKED = ['band', 'bohrer', 'schmelze'];
const BASE_BELT_SPEED = 0.125; // Zellen pro Tick
const BASE_DRILL_TIME = 25; // Ticks pro Rohstoff
const HUB_SIZE = 3;

// --- Zufall mit Startwert, damit jede Welt reproduzierbar ist ---
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function generateMap(w, h, seed) {
  const rand = rng(seed);
  const tiles = new Array(w * h).fill('.');
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const kinds = Object.keys(DEPOSITS);
  const blob = (bx, by, kind, size) => {
    for (let y = -size; y <= size; y++) {
      for (let x = -size; x <= size; x++) {
        const d = Math.hypot(x, y) + rand() * 1.5;
        const tx = bx + x;
        const ty = by + y;
        if (d < size && tx >= 0 && ty >= 0 && tx < w && ty < h) tiles[ty * w + tx] = kind;
      }
    }
  };
  // Je ein garantiertes Vorkommen in der Nähe der Zentrale
  kinds.forEach((k, i) => {
    const a = (i / kinds.length) * Math.PI * 2 + rand();
    blob(Math.round(cx + Math.cos(a) * 9), Math.round(cy + Math.sin(a) * 9), k, 3);
  });
  // Weitere verstreute Vorkommen
  for (let i = 0; i < (w * h) / 220; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    if (Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6) continue;
    blob(x, y, kinds[Math.floor(rand() * kinds.length)], 2 + Math.floor(rand() * 3));
  }
  // Platz um die Zentrale frei halten
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) tiles[y * w + x] = '.';
  return tiles.join('');
}

class World {
  constructor(opts = {}) {
    this.w = opts.w || 80;
    this.h = opts.h || 80;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.tiles = opts.tiles || generateMap(this.w, this.h, this.seed);
    this.grid = new Map(); // "x,y" -> Gebäude
    this.buildings = new Map(); // id -> Gebäude
    this.nextId = 1;
    this.tick = 0;
    this.research = { level: 0, progress: {}, delivered: {} };
    this.changes = []; // Gebäudeänderungen seit dem letzten Senden
    const hx = Math.floor(this.w / 2) - 1;
    const hy = Math.floor(this.h / 2) - 1;
    this.hub = this._add({ kind: 'zentrale', x: hx, y: hy, size: HUB_SIZE, dir: 0 }, true);
  }

  key(x, y) { return x + ',' + y; }
  tileAt(x, y) { return this.tiles[y * this.w + x]; }
  at(x, y) { return this.grid.get(this.key(x, y)); }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  unlocked() {
    const u = new Set(START_UNLOCKED);
    for (let i = 0; i < this.research.level && i < RESEARCH.length; i++) {
      (RESEARCH[i].unlock || []).forEach((k) => u.add(k));
    }
    return [...u];
  }

  bonus(kind) {
    let f = 1;
    for (let i = 0; i < this.research.level && i < RESEARCH.length; i++) {
      const b = RESEARCH[i].bonus;
      if (b && b[kind]) f *= b[kind];
    }
    return f;
  }

  _add(b, silent) {
    b.id = this.nextId++;
    b.size = b.size || 1;
    b.state = b.state || {};
    for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) this.grid.set(this.key(b.x + x, b.y + y), b);
    this.buildings.set(b.id, b);
    if (!silent) this.changes.push({ op: 'add', b: this.publicBuilding(b) });
    return b;
  }

  publicBuilding(b) {
    return { id: b.id, kind: b.kind, x: b.x, y: b.y, dir: b.dir, size: b.size };
  }

  // Gibt null bei Erfolg zurück, sonst einen Fehlertext.
  place(kind, x, y, dir) {
    if (!BUILDINGS[kind]) return 'Unbekanntes Gebäude';
    if (!this.unlocked().includes(kind)) return 'Noch nicht erforscht';
    if (!this.inBounds(x, y)) return 'Außerhalb der Karte';
    dir = ((dir | 0) % 4 + 4) % 4;
    const existing = this.at(x, y);
    if (existing) {
      // Bänder dürfen gedreht/ersetzt werden, alles andere nicht
      if (existing.kind === kind && kind === 'band') {
        if (existing.dir !== dir) {
          existing.dir = dir;
          this.changes.push({ op: 'add', b: this.publicBuilding(existing) });
        }
        return null;
      }
      return 'Feld ist belegt';
    }
    if (kind === 'bohrer' && !DEPOSITS[this.tileAt(x, y)]) return 'Bohrer nur auf Vorkommen';
    this._add({ kind, x, y, dir });
    return null;
  }

  remove(x, y) {
    const b = this.at(x, y);
    if (!b || b.kind === 'zentrale') return false;
    this.grid.delete(this.key(x, y));
    this.buildings.delete(b.id);
    this.changes.push({ op: 'del', id: b.id });
    return true;
  }

  // Kann Gebäude b ein Item von Feld (fx,fy) annehmen?
  accepts(b, item, fx, fy) {
    if (b.kind === 'zentrale') return true;
    if (b.kind === 'band') {
      if (b.state.item) return false;
      const [dx, dy] = DIRS[b.dir];
      // Nicht von dem Feld annehmen, in das das Band zeigt (frontal)
      return !(b.x + dx === fx && b.y + dy === fy);
    }
    const recipes = RECIPES[b.kind];
    if (!recipes) return false;
    const [dx, dy] = DIRS[b.dir];
    if (b.x + dx === fx && b.y + dy === fy) return false; // Ausgang nimmt nichts an
    const buf = b.state.buf || {};
    const have = Object.keys(buf).filter((k) => buf[k] > 0);
    return recipes.some((r) => {
      if (!r.in[item]) return false;
      if ((buf[item] || 0) >= r.in[item] * 3) return false;
      return have.every((k) => r.in[k]);
    });
  }

  insert(b, item) {
    if (b.kind === 'zentrale') { this.deliver(item); return; }
    if (b.kind === 'band') { b.state.item = item; b.state.p = 0; return; }
    const buf = (b.state.buf = b.state.buf || {});
    buf[item] = (buf[item] || 0) + 1;
  }

  deliver(item) {
    const r = this.research;
    r.delivered[item] = (r.delivered[item] || 0) + 1;
    const goal = RESEARCH[r.level];
    if (!goal) return;
    if (goal.need[item] && (r.progress[item] || 0) < goal.need[item]) {
      r.progress[item] = (r.progress[item] || 0) + 1;
    }
    const done = Object.keys(goal.need).every((k) => (r.progress[k] || 0) >= goal.need[k]);
    if (done) {
      r.level++;
      r.progress = {};
      this.changes.push({ op: 'research', level: r.level });
    }
  }

  // Versucht, ein Item aus Gebäude b nach vorne zu schieben.
  push(b, item) {
    const [dx, dy] = DIRS[b.dir];
    const tx = b.x + dx;
    const ty = b.y + dy;
    const t = this.at(tx, ty);
    if (!t || t === b) return false;
    if (!this.accepts(t, item, b.x, b.y)) return false;
    this.insert(t, item);
    return true;
  }

  step() {
    this.tick++;
    const beltSpeed = BASE_BELT_SPEED * this.bonus('band');
    const drillTime = BASE_DRILL_TIME / this.bonus('bohrer');
    for (const b of this.buildings.values()) {
      const s = b.state;
      switch (b.kind) {
        case 'band':
          if (s.item) {
            if (s.p < 1) s.p = Math.min(1, s.p + beltSpeed);
            if (s.p >= 1) {
              const item = s.item;
              s.item = null;
              if (!this.push(b, item)) { s.item = item; }
            }
          }
          break;
        case 'bohrer':
          if (!s.out) {
            s.t = (s.t || 0) + 1;
            if (s.t >= drillTime) { s.t = 0; s.out = DEPOSITS[this.tileAt(b.x, b.y)]; }
          }
          if (s.out && this.push(b, s.out)) s.out = null;
          break;
        case 'schmelze':
        case 'presse':
        case 'montage':
          this.stepMachine(b);
          break;
      }
    }
  }

  stepMachine(b) {
    const s = b.state;
    const buf = (s.buf = s.buf || {});
    if (s.out && this.push(b, s.out)) s.out = null;
    if (s.out) return;
    if (s.recipe) {
      s.t = (s.t || 0) + 1;
      if (s.t >= s.recipe.time) {
        s.out = s.recipe.out;
        s.recipe = null;
        s.t = 0;
        if (this.push(b, s.out)) s.out = null;
      }
      return;
    }
    const r = RECIPES[b.kind].find((rc) => Object.keys(rc.in).every((k) => (buf[k] || 0) >= rc.in[k]));
    if (r) {
      for (const k of Object.keys(r.in)) buf[k] -= r.in[k];
      s.recipe = r;
      s.t = 0;
    }
  }

  // Kompakter Zustand für jeden Tick: Items auf Bändern und arbeitende Maschinen
  snapshot() {
    const items = [];
    const busy = [];
    for (const b of this.buildings.values()) {
      if (b.kind === 'band' && b.state.item) items.push(b.x, b.y, b.state.item, Math.round(b.state.p * 100) / 100);
      else if (b.state.recipe || b.state.out) busy.push(b.id, b.state.recipe ? b.state.recipe.out : b.state.out);
    }
    return { items, busy };
  }

  fullState() {
    return {
      w: this.w,
      h: this.h,
      tiles: this.tiles,
      buildings: [...this.buildings.values()].map((b) => this.publicBuilding(b)),
      research: this.research,
      unlocked: this.unlocked(),
      beltSpeed: BASE_BELT_SPEED * this.bonus('band'),
    };
  }

  toJSON() {
    return {
      w: this.w, h: this.h, seed: this.seed, tiles: this.tiles, research: this.research,
      buildings: [...this.buildings.values()].filter((b) => b.kind !== 'zentrale').map((b) => ({
        kind: b.kind, x: b.x, y: b.y, dir: b.dir,
        state: { item: b.state.item || null, p: b.state.p || 0, buf: b.state.buf, out: b.state.out || null },
      })),
    };
  }

  static fromJSON(data) {
    const w = new World({ w: data.w, h: data.h, seed: data.seed, tiles: data.tiles });
    w.research = data.research || w.research;
    for (const b of data.buildings || []) {
      if (w.at(b.x, b.y)) continue;
      w._add({ kind: b.kind, x: b.x, y: b.y, dir: b.dir, state: b.state || {} }, true);
    }
    return w;
  }
}

const DEFS = { DIRS, DEPOSITS, ITEMS, BUILDINGS, RECIPES, RESEARCH };

module.exports = { World, DEFS, generateMap };
