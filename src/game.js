// Spiellogik von "Fabrik-Koop". Läuft nur auf dem Server, der Client bekommt
// den Zustand und die Definitionen per WebSocket.
'use strict';

const SAVE_VERSION = 2;

const DIRS = [
  [1, 0], // 0 rechts
  [0, 1], // 1 unten
  [-1, 0], // 2 links
  [0, -1], // 3 oben
];

// Bodenvorkommen: Buchstabe im Kartenstring -> Rohstoff
const DEPOSITS = {
  h: 'holz',
  t: 'stein',
  e: 'eisenerz',
  k: 'kupfererz',
  c: 'kohle',
  w: 'wolframerz',
};

const ITEMS = {
  // Rohstoffe
  holz: { name: 'Holz', color: '#a0703c', shape: 'log' },
  stein: { name: 'Stein', color: '#9aa0a8', shape: 'rock' },
  eisenerz: { name: 'Eisenerz', color: '#9a5a4e', shape: 'rock' },
  kupfererz: { name: 'Kupfererz', color: '#f0943c', shape: 'rock' },
  kohle: { name: 'Kohle', color: '#3a3d46', shape: 'rock' },
  wolframerz: { name: 'Wolframerz', color: '#8a7fb0', shape: 'crystal' },
  // Stufe 1
  bretter: { name: 'Bretter', color: '#d9a866', shape: 'plank' },
  ziegel: { name: 'Ziegel', color: '#d0624a', shape: 'brick' },
  eisenbarren: { name: 'Eisenbarren', color: '#c4cad4', shape: 'bar' },
  kupferbarren: { name: 'Kupferbarren', color: '#f09a5a', shape: 'bar' },
  // Stufe 2
  zahnrad: { name: 'Zahnrad', color: '#aab4c4', shape: 'gear' },
  kupferdraht: { name: 'Kupferdraht', color: '#f0a060', shape: 'coil' },
  stahl: { name: 'Stahlträger', color: '#6f7d92', shape: 'beam' },
  wolframbarren: { name: 'Wolframbarren', color: '#9a8cd0', shape: 'bar' },
  // Stufe 3
  motor: { name: 'Motor', color: '#ffb84a', shape: 'box' },
  platine: { name: 'Platine', color: '#3fae6a', shape: 'board' },
  stahlrahmen: { name: 'Stahlrahmen', color: '#5a6a82', shape: 'frame' },
  bohrkopf: { name: 'Bohrkopf', color: '#b4a6ee', shape: 'drill' },
  // Stufe 4
  roboterarm: { name: 'Roboterarm', color: '#f06a55', shape: 'arm' },
  helferbot: { name: 'Helferbot', color: '#b48cff', shape: 'bot' },
};

const RECIPES = {
  saege: [
    { in: { holz: 1 }, out: 'bretter', time: 15 },
  ],
  schmelze: [
    { in: { eisenerz: 1 }, out: 'eisenbarren', time: 20 },
    { in: { kupfererz: 1 }, out: 'kupferbarren', time: 20 },
    { in: { stein: 1 }, out: 'ziegel', time: 20 },
  ],
  presse: [
    { in: { eisenbarren: 1 }, out: 'zahnrad', time: 15 },
    { in: { kupferbarren: 1 }, out: 'kupferdraht', time: 15 },
  ],
  hochofen: [
    { in: { eisenbarren: 1, kohle: 1 }, out: 'stahl', time: 30 },
    { in: { wolframerz: 1, kohle: 1 }, out: 'wolframbarren', time: 35 },
  ],
  werkbank: [
    { in: { zahnrad: 1, kupferdraht: 1 }, out: 'motor', time: 30 },
    { in: { kupferdraht: 1, bretter: 1 }, out: 'platine', time: 25 },
    { in: { stahl: 1, ziegel: 1 }, out: 'stahlrahmen', time: 30 },
    { in: { wolframbarren: 1, stahl: 1 }, out: 'bohrkopf', time: 35 },
  ],
  fabrikator: [
    { in: { motor: 1, platine: 1 }, out: 'roboterarm', time: 40 },
    { in: { roboterarm: 1, bohrkopf: 1 }, out: 'helferbot', time: 50 },
  ],
};

const BUILDINGS = {
  band: { name: 'Förderband', key: '1', desc: 'Transportiert Gegenstände in Pfeilrichtung.' },
  bohrer: { name: 'Bohrer', key: '2', desc: 'Auf ein Vorkommen stellen (auch Wald). Gibt Rohstoffe nach vorne aus.' },
  saege: { name: 'Sägewerk', key: '3', desc: 'Holz → Bretter.' },
  schmelze: { name: 'Schmelzofen', key: '4', desc: 'Erz/Stein → Barren/Ziegel.' },
  verteiler: { name: 'Verteiler', key: '5', desc: 'Verteilt Gegenstände abwechselnd nach vorne, links und rechts.' },
  presse: { name: 'Presse', key: '6', desc: 'Barren → Zahnrad/Draht.' },
  hochofen: { name: 'Hochofen', key: '7', desc: 'Barren oder Erz + Kohle → Stahl/Wolfram.' },
  werkbank: { name: 'Werkbank', key: '8', desc: 'Zwei Zutaten → Bauteil.' },
  fabrikator: { name: 'Fabrikator', key: '9', desc: 'Bauteile → Roboterarm und Helferbot.' },
};

// Techbaum: Jede Technik braucht ihre Vorgänger und kostet Gegenstände aus dem Lager der Zentrale.
// col/row bestimmen nur die Position in der Anzeige.
const TECHS = [
  { id: 'grundlagen', name: 'Grundlagen', req: [], cost: {}, unlock: ['band', 'bohrer', 'saege', 'schmelze'], col: 0, row: 1, text: 'Bänder, Bohrer, Sägewerk und Schmelzofen.' },
  { id: 'logistik', name: 'Logistik', req: ['grundlagen'], cost: { bretter: 20, ziegel: 10 }, unlock: ['verteiler'], col: 1, row: 0, text: 'Schaltet den Verteiler frei.' },
  { id: 'metallbau', name: 'Metallbau', req: ['grundlagen'], cost: { eisenbarren: 20, bretter: 10 }, unlock: ['presse'], col: 1, row: 2, text: 'Schaltet die Presse frei.' },
  { id: 'baender1', name: 'Schnelle Bänder', req: ['logistik'], cost: { eisenbarren: 30, ziegel: 20 }, bonus: { band: 1.5 }, col: 2, row: 0, text: 'Bänder laufen 50 % schneller.' },
  { id: 'feuer', name: 'Hochofen', req: ['metallbau'], cost: { zahnrad: 20, ziegel: 30 }, unlock: ['hochofen'], col: 2, row: 1, text: 'Schaltet den Hochofen frei (braucht Kohle).' },
  { id: 'handwerk', name: 'Werkbank', req: ['metallbau'], cost: { zahnrad: 20, kupferdraht: 20 }, unlock: ['werkbank'], col: 2, row: 3, text: 'Schaltet die Werkbank frei.' },
  { id: 'bohrer1', name: 'Scharfe Bohrer', req: ['handwerk'], cost: { motor: 15 }, bonus: { bohrer: 1.5 }, col: 3, row: 3, text: 'Bohrer arbeiten 50 % schneller.' },
  { id: 'baender2', name: 'Turbobänder', req: ['baender1', 'handwerk'], cost: { motor: 20, stahlrahmen: 10 }, bonus: { band: 1.5 }, col: 3, row: 0, text: 'Bänder laufen noch einmal 50 % schneller.' },
  { id: 'fabrik', name: 'Fabrikator', req: ['feuer', 'handwerk'], cost: { platine: 20, stahl: 20 }, unlock: ['fabrikator'], col: 3, row: 2, text: 'Schaltet den Fabrikator frei.' },
  { id: 'bohrer2', name: 'Wolframbohrer', req: ['bohrer1', 'feuer'], cost: { bohrkopf: 10 }, bonus: { bohrer: 1.5 }, col: 4, row: 3, text: 'Bohrer arbeiten noch einmal 50 % schneller.' },
  { id: 'takt', name: 'Taktstraße', req: ['fabrik'], cost: { roboterarm: 10 }, bonus: { maschine: 1.5 }, col: 4, row: 1, text: 'Alle Maschinen arbeiten 50 % schneller.' },
  { id: 'ziel', name: 'Helferbot-Programm', req: ['fabrik', 'bohrer2'], cost: { helferbot: 10 }, win: true, col: 5, row: 2, text: 'Das große Ziel: 10 Helferbots. Danach ist die Fabrik fertig!' },
];
const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));

const MACHINES = Object.keys(RECIPES);
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
  // Garantierte Vorkommen: die Grundstoffe nah an der Zentrale, Kohle und Wolfram weiter weg
  const near = ['h', 't', 'e', 'k'];
  near.forEach((k, i) => {
    const a = (i / near.length) * Math.PI * 2 + rand();
    blob(Math.round(cx + Math.cos(a) * 9), Math.round(cy + Math.sin(a) * 9), k, 3);
  });
  [['c', 15, 3], ['w', 20, 2]].forEach(([k, r, size]) => {
    const a = rand() * Math.PI * 2;
    blob(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), k, size);
  });
  // Weitere verstreute Vorkommen (Wolfram selten, Wald häufig)
  const weights = [['h', 5], ['t', 3], ['e', 3], ['k', 3], ['c', 2], ['w', 1]];
  const total = weights.reduce((a, [, n]) => a + n, 0);
  for (let i = 0; i < (w * h) / 200; i++) {
    const x = Math.floor(rand() * w);
    const y = Math.floor(rand() * h);
    if (Math.abs(x - cx) < 6 && Math.abs(y - cy) < 6) continue;
    let r = rand() * total;
    let kind = 'h';
    for (const [k, n] of weights) { if ((r -= n) < 0) { kind = k; break; } }
    blob(x, y, kind, 2 + Math.floor(rand() * 3));
  }
  // Platz um die Zentrale frei halten
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) tiles[y * w + x] = '.';
  return tiles.join('');
}

function freshResearch() {
  return { done: ['grundlagen'], stock: {}, delivered: {}, won: false };
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
    this.research = freshResearch();
    this.changes = []; // Gebäudeänderungen seit dem letzten Senden
    const hx = Math.floor(this.w / 2) - 1;
    const hy = Math.floor(this.h / 2) - 1;
    this.hub = this._add({ kind: 'zentrale', x: hx, y: hy, size: HUB_SIZE, dir: 0 }, true);
  }

  key(x, y) { return x + ',' + y; }
  tileAt(x, y) { return this.tiles[y * this.w + x]; }
  at(x, y) { return this.grid.get(this.key(x, y)); }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }

  doneTechs() { return this.research.done.map((id) => TECH_BY_ID[id]).filter(Boolean); }

  unlocked() {
    const u = new Set();
    for (const t of this.doneTechs()) (t.unlock || []).forEach((k) => u.add(k));
    return [...u];
  }

  bonus(kind) {
    let f = 1;
    for (const t of this.doneTechs()) if (t.bonus && t.bonus[kind]) f *= t.bonus[kind];
    return f;
  }

  // Kann diese Technik gerade erforscht werden? Gibt null oder einen Grund zurück.
  canResearch(id) {
    const t = TECH_BY_ID[id];
    const r = this.research;
    if (!t) return 'Unbekannte Technik';
    if (r.done.includes(id)) return 'Schon erforscht';
    if (!t.req.every((q) => r.done.includes(q))) return 'Erst die Vorgänger erforschen';
    for (const [item, n] of Object.entries(t.cost)) {
      if ((r.stock[item] || 0) < n) return `Es fehlen noch ${n - (r.stock[item] || 0)} × ${ITEMS[item].name}`;
    }
    return null;
  }

  doResearch(id) {
    const err = this.canResearch(id);
    if (err) return err;
    const t = TECH_BY_ID[id];
    for (const [item, n] of Object.entries(t.cost)) this.research.stock[item] -= n;
    this.research.done.push(id);
    if (t.win) this.research.won = true;
    this.changes.push({ op: 'research', id });
    return null;
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
      // Bänder dürfen gedreht werden, alles andere nicht
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
    const [dx, dy] = DIRS[b.dir];
    const fromFront = b.x + dx === fx && b.y + dy === fy;
    if (b.kind === 'band' || b.kind === 'verteiler') {
      // Nicht von dem Feld annehmen, in das das Gebäude zeigt (frontal)
      return !b.state.item && !fromFront;
    }
    const recipes = RECIPES[b.kind];
    if (!recipes || fromFront) return false;
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
    if (b.kind === 'verteiler') { b.state.item = item; return; }
    const buf = (b.state.buf = b.state.buf || {});
    buf[item] = (buf[item] || 0) + 1;
  }

  // Alles, was an der Zentrale ankommt, landet im Lager und kann für Forschung ausgegeben werden.
  deliver(item) {
    const r = this.research;
    r.delivered[item] = (r.delivered[item] || 0) + 1;
    r.stock[item] = (r.stock[item] || 0) + 1;
  }

  // Versucht, ein Item aus Gebäude b in Richtung d (Standard: vorne) zu schieben.
  push(b, item, d = b.dir) {
    const [dx, dy] = DIRS[d];
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
    const machineSpeed = this.bonus('maschine');
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
        case 'verteiler':
          if (s.item) {
            // vorne, rechts, links reihum
            const order = [b.dir, (b.dir + 1) % 4, (b.dir + 3) % 4];
            const start = s.next || 0;
            for (let i = 0; i < 3; i++) {
              const k = (start + i) % 3;
              const item = s.item;
              s.item = null;
              if (this.push(b, item, order[k])) { s.next = (k + 1) % 3; break; }
              s.item = item;
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
        default:
          if (RECIPES[b.kind]) this.stepMachine(b, machineSpeed);
      }
    }
  }

  stepMachine(b, speed = 1) {
    const s = b.state;
    const buf = (s.buf = s.buf || {});
    if (s.out && this.push(b, s.out)) s.out = null;
    if (s.out) return;
    if (s.recipe) {
      s.t = (s.t || 0) + speed;
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
      version: SAVE_VERSION,
      w: this.w, h: this.h, seed: this.seed, tiles: this.tiles, research: this.research,
      buildings: [...this.buildings.values()].filter((b) => b.kind !== 'zentrale').map((b) => ({
        kind: b.kind, x: b.x, y: b.y, dir: b.dir,
        state: { item: b.state.item || null, p: b.state.p || 0, buf: b.state.buf, out: b.state.out || null, next: b.state.next || 0 },
      })),
    };
  }

  static fromJSON(data) {
    let tiles = data.tiles;
    let research = data.research;
    if ((data.version || 1) < SAVE_VERSION) {
      // Alte Welten (Rubin/Azurit/Quarz): Vorkommen umwandeln und Forschung neu beginnen
      tiles = tiles.replace(/r/g, 'e').replace(/b/g, 'k').replace(/s/g, 't');
      research = null;
    }
    const w = new World({ w: data.w, h: data.h, seed: data.seed, tiles });
    if (research && Array.isArray(research.done)) w.research = { ...freshResearch(), ...research };
    for (const b of data.buildings || []) {
      if (!BUILDINGS[b.kind] || w.at(b.x, b.y)) continue;
      const st = b.state || {};
      const ok = (it) => (it && ITEMS[it] ? it : null);
      const buf = {};
      for (const [k, n] of Object.entries(st.buf || {})) if (ITEMS[k] && n > 0) buf[k] = n;
      w._add({ kind: b.kind, x: b.x, y: b.y, dir: b.dir, state: { item: ok(st.item), p: st.p || 0, buf, out: ok(st.out), next: st.next || 0 } }, true);
    }
    return w;
  }
}

const DEFS = { DIRS, DEPOSITS, ITEMS, BUILDINGS, RECIPES, TECHS, MACHINES };

module.exports = { World, DEFS, generateMap, TECHS };
