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
  u: 'uranerz',
  q: 'sand',
  b: 'bauxit',
  s: 'schwefel',
  g: 'golderz',
};
// Wasser ('~'): Seen und Flüsse. Dort gehen nur Förderbänder (als Brücke).
const WATER = '~';

const ITEMS = {
  // Rohstoffe
  holz: { name: 'Holz', color: '#a0703c', shape: 'log' },
  stein: { name: 'Stein', color: '#9aa0a8', shape: 'rock' },
  eisenerz: { name: 'Eisenerz', color: '#9a5a4e', shape: 'rock' },
  kupfererz: { name: 'Kupfererz', color: '#f0943c', shape: 'rock' },
  kohle: { name: 'Kohle', color: '#3a3d46', shape: 'rock' },
  wolframerz: { name: 'Wolframerz', color: '#8a7fb0', shape: 'crystal' },
  uranerz: { name: 'Uranerz', color: '#7ad94a', shape: 'crystal' },
  sand: { name: 'Quarzsand', color: '#ecd89a', shape: 'dust' },
  bauxit: { name: 'Bauxit', color: '#c0603a', shape: 'rock' },
  schwefel: { name: 'Schwefel', color: '#f2dc3a', shape: 'crystal' },
  golderz: { name: 'Golderz', color: '#e8c040', shape: 'rock' },
  // Stufe 1: Sägewerk, Schmelzofen, Brecher
  bretter: { name: 'Bretter', color: '#d9a866', shape: 'plank' },
  ziegel: { name: 'Ziegel', color: '#d0624a', shape: 'brick' },
  eisenbarren: { name: 'Eisenbarren', color: '#c4cad4', shape: 'bar' },
  kupferbarren: { name: 'Kupferbarren', color: '#f09a5a', shape: 'bar' },
  glas: { name: 'Glasscheibe', color: '#a8e4f8', shape: 'pane' },
  goldbarren: { name: 'Goldbarren', color: '#ffd24a', shape: 'bar' },
  kies: { name: 'Kies', color: '#b8b4aa', shape: 'dust' },
  tonerde: { name: 'Tonerde', color: '#e8b8a0', shape: 'dust' },
  schwefelpulver: { name: 'Schwefelpulver', color: '#fff07a', shape: 'dust' },
  // Stufe 2
  zahnrad: { name: 'Zahnrad', color: '#aab4c4', shape: 'gear' },
  kupferdraht: { name: 'Kupferdraht', color: '#f0a060', shape: 'coil' },
  golddraht: { name: 'Golddraht', color: '#ffd86a', shape: 'coil' },
  stahl: { name: 'Stahlträger', color: '#6f7d92', shape: 'beam' },
  wolframbarren: { name: 'Wolframbarren', color: '#9a8cd0', shape: 'bar' },
  aluminium: { name: 'Aluminiumbarren', color: '#e4ecf4', shape: 'bar' },
  beton: { name: 'Betonblock', color: '#bcbcb4', shape: 'box' },
  stahlbeton: { name: 'Stahlbeton', color: '#8a9098', shape: 'brick' },
  saeure: { name: 'Säurekanister', color: '#c8f05a', shape: 'cell' },
  uranpellet: { name: 'Uranpellet', color: '#9cf06a', shape: 'pellet' },
  // Stufe 3
  motor: { name: 'Motor', color: '#ffb84a', shape: 'box' },
  platine: { name: 'Platine', color: '#3fae6a', shape: 'board' },
  stahlrahmen: { name: 'Stahlrahmen', color: '#5a6a82', shape: 'frame' },
  bohrkopf: { name: 'Bohrkopf', color: '#b4a6ee', shape: 'drill' },
  gluehbirne: { name: 'Glühbirne', color: '#fff2a0', shape: 'bulb' },
  alublech: { name: 'Alublech', color: '#d4dce8', shape: 'pane' },
  kunstharz: { name: 'Kunstharz', color: '#f07ab4', shape: 'pellet' },
  batterie: { name: 'Batterie', color: '#5a8af0', shape: 'cell' },
  // Stufe 4
  steuerchip: { name: 'Steuerchip', color: '#2a8a5a', shape: 'board' },
  energiezelle: { name: 'Energiezelle', color: '#4ad9a0', shape: 'cell' },
  isolierkabel: { name: 'Isolierkabel', color: '#e05a7a', shape: 'coil' },
  leichtrahmen: { name: 'Leichtrahmen', color: '#b8c8dc', shape: 'frame' },
  solarzelle: { name: 'Solarzelle', color: '#3a5ad0', shape: 'board' },
  // Stufe 5
  roboterarm: { name: 'Roboterarm', color: '#f06a55', shape: 'arm' },
  turbine: { name: 'Turbine', color: '#8ab4d8', shape: 'gear' },
  // Stufe 6: Montagehalle
  helferbot: { name: 'Helferbot', color: '#b48cff', shape: 'bot' },
  generator: { name: 'Generator', color: '#f0c040', shape: 'box' },
  computer: { name: 'Computer', color: '#4a5a7a', shape: 'box' },
  solarsegel: { name: 'Solarsegel', color: '#4a6ae0', shape: 'pane' },
  // Stufe 7: das große Ziel
  raumsonde: { name: 'Raumsonde', color: '#ffffff', shape: 'probe' },
};

const RECIPES = {
  saege: [
    { in: { holz: 1 }, out: 'bretter', time: 15 },
  ],
  schmelze: [
    { in: { eisenerz: 1 }, out: 'eisenbarren', time: 20 },
    { in: { kupfererz: 1 }, out: 'kupferbarren', time: 20 },
    { in: { stein: 1 }, out: 'ziegel', time: 20 },
    { in: { sand: 1 }, out: 'glas', time: 20 },
    { in: { golderz: 1 }, out: 'goldbarren', time: 25 },
  ],
  brecher: [
    { in: { stein: 1 }, out: 'kies', time: 15 },
    { in: { bauxit: 1 }, out: 'tonerde', time: 20 },
    { in: { schwefel: 1 }, out: 'schwefelpulver', time: 15 },
  ],
  presse: [
    { in: { eisenbarren: 1 }, out: 'zahnrad', time: 15 },
    { in: { kupferbarren: 1 }, out: 'kupferdraht', time: 15 },
    { in: { goldbarren: 1 }, out: 'golddraht', time: 20 },
    { in: { aluminium: 1 }, out: 'alublech', time: 20 },
  ],
  hochofen: [
    { in: { eisenbarren: 1, kohle: 1 }, out: 'stahl', time: 30 },
    { in: { wolframerz: 1, kohle: 1 }, out: 'wolframbarren', time: 35 },
    { in: { tonerde: 1, kohle: 1 }, out: 'aluminium', time: 35 },
  ],
  werkbank: [
    { in: { zahnrad: 1, kupferdraht: 1 }, out: 'motor', time: 30 },
    { in: { kupferdraht: 1, bretter: 1 }, out: 'platine', time: 25 },
    { in: { glas: 1, kupferdraht: 1 }, out: 'gluehbirne', time: 25 },
    { in: { stahl: 1, ziegel: 1 }, out: 'stahlrahmen', time: 30 },
    { in: { wolframbarren: 1, stahl: 1 }, out: 'bohrkopf', time: 35 },
    { in: { uranpellet: 1, stahlrahmen: 1 }, out: 'energiezelle', time: 40 },
    { in: { alublech: 1, stahlrahmen: 1 }, out: 'leichtrahmen', time: 35 },
  ],
  chemiewerk: [
    { in: { kies: 1, ziegel: 1 }, out: 'beton', time: 25 },
    { in: { beton: 1, stahl: 1 }, out: 'stahlbeton', time: 30 },
    { in: { schwefelpulver: 1, kohle: 1 }, out: 'saeure', time: 30 },
    { in: { saeure: 1, bretter: 1 }, out: 'kunstharz', time: 30 },
    { in: { saeure: 1, kupferbarren: 1 }, out: 'batterie', time: 35 },
    { in: { kunstharz: 1, kupferdraht: 1 }, out: 'isolierkabel', time: 30 },
  ],
  fabrikator: [
    { in: { platine: 1, golddraht: 2 }, out: 'steuerchip', time: 40 },
    { in: { glas: 1, golddraht: 1 }, out: 'solarzelle', time: 40 },
    { in: { motor: 1, steuerchip: 1 }, out: 'roboterarm', time: 45 },
    { in: { alublech: 2, motor: 1 }, out: 'turbine', time: 45 },
  ],
  zentrifuge: [
    { in: { uranerz: 1 }, out: 'uranpellet', time: 40 },
  ],
  montagehalle: [
    { in: { roboterarm: 1, bohrkopf: 1, batterie: 1 }, out: 'helferbot', time: 60 },
    { in: { turbine: 1, isolierkabel: 2, energiezelle: 1 }, out: 'generator', time: 60 },
    { in: { steuerchip: 2, kunstharz: 1, gluehbirne: 1 }, out: 'computer', time: 60 },
    { in: { solarzelle: 2, leichtrahmen: 1, isolierkabel: 1 }, out: 'solarsegel', time: 60 },
    { in: { computer: 1, generator: 1, solarsegel: 2 }, out: 'raumsonde', time: 90 },
  ],
};

const BUILDINGS = {
  band: { name: 'Förderband', key: '1', desc: 'Transportiert Gegenstände in Pfeilrichtung.' },
  bohrer: { name: 'Bohrer', key: '2', desc: 'Auf ein Vorkommen stellen (auch Wald). Gibt Rohstoffe nach vorne aus.' },
  saege: { name: 'Sägewerk', key: '3', desc: 'Holz → Bretter.' },
  schmelze: { name: 'Schmelzofen', key: '4', desc: 'Erz, Stein, Sand → Barren, Ziegel, Glas.' },
  verteiler: { name: 'Verteiler', key: '5', desc: 'Verteilt Gegenstände abwechselnd nach vorne, links und rechts.' },
  presse: { name: 'Presse', key: '6', desc: 'Barren → Zahnrad, Draht, Blech.' },
  brecher: { name: 'Steinbrecher', key: '7', desc: 'Zermahlt Stein, Bauxit und Schwefel.' },
  hochofen: { name: 'Hochofen', key: '8', desc: 'Barren oder Erz + Kohle → Stahl, Wolfram, Aluminium.' },
  werkbank: { name: 'Werkbank', key: '9', desc: 'Zwei Zutaten → Bauteil.' },
  chemiewerk: { name: 'Chemiewerk', key: '0', desc: 'Beton, Säure, Kunstharz, Batterien und Kabel.' },
  fabrikator: { name: 'Fabrikator', key: 'v', desc: 'Elektronik und Maschinenteile.' },
  zentrifuge: { name: 'Zentrifuge', key: 'b', desc: 'Uranerz → Uranpellet.' },
  montagehalle: { name: 'Montagehalle', key: 'n', desc: 'Drei Bauteile → große Baugruppen.' },
  // Entsteht automatisch, wenn man ein Band quer über ein anderes zieht (nicht in der Werkzeugleiste)
  kreuzung: { name: 'Kreuzung', key: '', hidden: true, desc: 'Zwei Bänder kreuzen sich, beide laufen geradeaus weiter.' },
};

// Techbaum: Jede Technik braucht ihre Vorgänger und kostet Gegenstände aus dem Lager der Zentrale.
// col/row bestimmen nur die Position in der Anzeige.
const TECHS = [
  { id: 'grundlagen', name: 'Grundlagen', req: [], cost: {}, unlock: ['band', 'bohrer', 'saege', 'schmelze'], col: 0, row: 3, text: 'Bänder, Bohrer, Sägewerk und Schmelzofen.' },
  { id: 'logistik', name: 'Logistik', req: ['grundlagen'], cost: { bretter: 20, ziegel: 10 }, unlock: ['verteiler'], col: 1, row: 1, text: 'Schaltet den Verteiler frei.' },
  { id: 'metallbau', name: 'Metallbau', req: ['grundlagen'], cost: { eisenbarren: 20, bretter: 10 }, unlock: ['presse'], col: 1, row: 3, text: 'Schaltet die Presse frei.' },
  { id: 'steinbruch', name: 'Steinbruch', req: ['grundlagen'], cost: { ziegel: 20, eisenbarren: 10 }, unlock: ['brecher'], col: 1, row: 5, text: 'Schaltet den Steinbrecher frei (Kies, Tonerde, Schwefelpulver).' },
  { id: 'baender1', name: 'Schnelle Bänder', req: ['logistik'], cost: { eisenbarren: 30, ziegel: 20 }, bonus: { band: 1.5 }, col: 2, row: 0, text: 'Bänder laufen 50 % schneller.' },
  { id: 'feuer', name: 'Hochofen', req: ['metallbau'], cost: { zahnrad: 20, ziegel: 30 }, unlock: ['hochofen'], col: 2, row: 2, text: 'Schaltet den Hochofen frei (braucht Kohle).' },
  { id: 'handwerk', name: 'Werkbank', req: ['metallbau'], cost: { zahnrad: 20, kupferdraht: 20 }, unlock: ['werkbank'], col: 2, row: 3, text: 'Schaltet die Werkbank frei.' },
  { id: 'bohrer1', name: 'Scharfe Bohrer', req: ['steinbruch', 'metallbau'], cost: { kies: 30, zahnrad: 20 }, bonus: { bohrer: 1.25 }, col: 2, row: 5, text: 'Bohrer arbeiten 25 % schneller.' },
  { id: 'baender2', name: 'Turbobänder', req: ['baender1', 'handwerk'], cost: { motor: 20, platine: 15 }, bonus: { band: 1.5 }, col: 3, row: 0, text: 'Bänder laufen noch einmal 50 % schneller.' },
  { id: 'elektrik', name: 'Elektrik', req: ['handwerk'], cost: { platine: 25, gluehbirne: 20 }, bonus: { maschine: 1.2 }, col: 3, row: 1, text: 'Alle Maschinen arbeiten 20 % schneller.' },
  { id: 'fabrik', name: 'Fabrikator', req: ['feuer', 'handwerk'], cost: { platine: 20, stahl: 20 }, unlock: ['fabrikator'], col: 3, row: 3, text: 'Schaltet den Fabrikator frei.' },
  { id: 'chemie', name: 'Chemie', req: ['steinbruch', 'feuer'], cost: { stahl: 20, kies: 30, glas: 20 }, unlock: ['chemiewerk'], col: 3, row: 5, text: 'Schaltet das Chemiewerk frei.' },
  { id: 'solartechnik', name: 'Solartechnik', req: ['elektrik', 'fabrik'], cost: { solarzelle: 20, glas: 40 }, bonus: { maschine: 1.15 }, col: 4, row: 1, text: 'Maschinen arbeiten 15 % schneller.' },
  { id: 'automatik', name: 'Steuerungstechnik', req: ['fabrik'], cost: { steuerchip: 15, motor: 20 }, bonus: { maschine: 1.25 }, col: 4, row: 2, text: 'Maschinen arbeiten 25 % schneller.' },
  { id: 'bohrer2', name: 'Wolframbohrer', req: ['bohrer1', 'fabrik'], cost: { bohrkopf: 10, kies: 40 }, bonus: { bohrer: 1.4 }, col: 4, row: 4, text: 'Bohrer arbeiten 40 % schneller.' },
  { id: 'kunststoff', name: 'Kunststoffe', req: ['chemie'], cost: { kunstharz: 25, batterie: 10 }, bonus: { bohrer: 1.2 }, col: 4, row: 5, text: 'Bohrer arbeiten 20 % schneller.' },
  { id: 'leichtbau', name: 'Leichtbau', req: ['fabrik', 'chemie'], cost: { alublech: 30, stahlrahmen: 15 }, bonus: { band: 1.25 }, col: 4, row: 3, text: 'Bänder laufen 25 % schneller.' },
  { id: 'baender3', name: 'Magnetbänder', req: ['baender2', 'leichtbau'], cost: { turbine: 10, alublech: 40 }, bonus: { band: 1.5 }, col: 5, row: 0, text: 'Bänder laufen noch einmal 50 % schneller.' },
  { id: 'takt', name: 'Taktstraße', req: ['automatik'], cost: { roboterarm: 20, steuerchip: 20 }, bonus: { maschine: 1.5 }, col: 5, row: 2, text: 'Alle Maschinen arbeiten 50 % schneller.' },
  { id: 'montage', name: 'Montagehalle', req: ['automatik', 'kunststoff'], cost: { roboterarm: 15, isolierkabel: 20, stahlbeton: 20 }, unlock: ['montagehalle'], col: 5, row: 3, text: 'Schaltet die Montagehalle frei (drei Zutaten).' },
  { id: 'kernkraft', name: 'Urantechnik', req: ['bohrer2', 'chemie'], cost: { wolframbarren: 20, saeure: 20 }, unlock: ['zentrifuge'], col: 5, row: 5, text: 'Schaltet die Zentrifuge frei (für Uranerz).' },
  { id: 'reaktor', name: 'Kleinreaktor', req: ['kernkraft'], cost: { energiezelle: 15 }, bonus: { bohrer: 1.5, maschine: 1.25 }, col: 6, row: 5, text: 'Bohrer +50 %, Maschinen +25 %.' },
  { id: 'helfer', name: 'Helferbots', req: ['montage'], cost: { helferbot: 10 }, bonus: { bohrer: 1.3 }, col: 6, row: 2, text: 'Helferbots warten die Bohrer: +30 %.' },
  { id: 'rechenzentrum', name: 'Rechenzentrum', req: ['montage'], cost: { computer: 10 }, bonus: { band: 1.2, maschine: 1.1 }, col: 6, row: 3, text: 'Bänder +20 %, Maschinen +10 %.' },
  { id: 'energie', name: 'Energienetz', req: ['montage', 'reaktor'], cost: { generator: 10 }, bonus: { maschine: 1.3 }, col: 6, row: 4, text: 'Alle Maschinen arbeiten 30 % schneller.' },
  { id: 'raumfahrt', name: 'Raumfahrt', req: ['helfer', 'rechenzentrum', 'energie'], cost: { solarsegel: 20, computer: 10 }, bonus: { maschine: 1.2 }, col: 7, row: 3, text: 'Bereitet den Start der Raumsonde vor. Maschinen +20 %.' },
  { id: 'ziel', name: 'Raumsonden-Start', req: ['raumfahrt'], cost: { raumsonde: 10 }, win: true, col: 8, row: 3, text: 'Das große Ziel: 10 Raumsonden. Danach ist die Fabrik fertig!' },
];
// --- Geld ---
// Baukosten in Talern. Abreißen gibt den vollen Preis zurück.
const COSTS = {
  band: 2, kreuzung: 4, verteiler: 20, bohrer: 25, saege: 40, schmelze: 60, presse: 120, brecher: 150,
  hochofen: 300, werkbank: 400, chemiewerk: 800, fabrikator: 1500, zentrifuge: 2500, montagehalle: 5000,
};
const START_MONEY = 300;
// Verkaufswert an der Zentrale: Rohstoffe haben einen Grundwert, jedes Produkt ist
// 30 % mehr wert als seine Zutaten zusammen, plus etwas für die Arbeitszeit.
const RAW_VALUE = { holz: 1, stein: 1, eisenerz: 2, kupfererz: 2, kohle: 2, sand: 2, bauxit: 3, schwefel: 3, wolframerz: 5, golderz: 6, uranerz: 8 };
const VALUES = (() => {
  const v = { ...RAW_VALUE };
  const all = Object.values(RECIPES).flat();
  for (let pass = 0; pass < 20; pass++) {
    for (const r of all) {
      if (v[r.out] || !Object.keys(r.in).every((i) => v[i])) continue;
      const sum = Object.entries(r.in).reduce((a, [i, n]) => a + v[i] * n, 0);
      v[r.out] = Math.round(sum * 1.3 + r.time / 10);
    }
  }
  return v;
})();

const TECH_BY_ID = Object.fromEntries(TECHS.map((t) => [t.id, t]));

const MACHINES = Object.keys(RECIPES);
const BASE_BELT_SPEED = 0.125; // Zellen pro Tick
const BASE_DRILL_TIME = 25; // Ticks pro Rohstoff
const HUB_SIZE = 3;
const MAP_SIZE = 160;

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

// Glattes Rauschen (Value-Noise mit mehreren Oktaven), damit Wälder, Seen und
// Erzfelder natürliche, zusammenhängende Formen bekommen.
function makeNoise(seed) {
  const R = rng(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = R(); }
  for (let i = 255; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
  const sm = (t) => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = sm(x - x0), fy = sm(y - y0);
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * fx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * fx;
    return a + (b - a) * fy;
  };
  return (x, y, oct = 4) => {
    let sum = 0, amp = 1, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) { sum += n(x * f + o * 17.3, y * f - o * 9.1) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
  };
}

function generateMap(w, h, seed) {
  const rand = rng(seed);
  const tiles = new Array(w * h).fill('.');
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const idx = (x, y) => y * w + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
  const scale = Math.max(w, h) / 160; // Merkmale wachsen mit der Kartengröße
  const nWater = makeNoise(seed ^ 0x51a7);
  const nWood = makeNoise(seed ^ 0x7007);
  const nRock = makeNoise(seed ^ 0x3c3c);
  const nShape = makeNoise(seed ^ 0x9e37);
  const fromHub = (x, y) => Math.hypot(x - cx, y - cy);

  // 1. Seen: tiefe Stellen im Rauschen, nicht direkt an der Zentrale
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = fromHub(x, y);
    const lake = nWater(x / (26 * scale), y / (26 * scale));
    if (lake < 0.3 - Math.max(0, 14 - d) * 0.03) tiles[idx(x, y)] = '~';
  }
  // 2. Ein Fluss schlängelt sich quer über die Karte (an der Zentrale vorbei)
  {
    const vertical = rand() < 0.5;
    const len = vertical ? h : w;
    const cross = vertical ? w : h;
    const mid = vertical ? cx : cy;
    const side = rand() < 0.5 ? -1 : 1;
    let pos = mid + side * (18 + rand() * 10) * scale;
    let drift = 0;
    for (let t = 0; t < len; t++) {
      drift += (rand() - 0.5) * 0.35;
      drift *= 0.94;
      pos += drift + (nShape(t / 20, 3.7) - 0.5) * 0.9;
      // nie zu nah an die Zentrale
      if (Math.abs(pos - mid) < 12 * scale) pos = mid + Math.sign(pos - mid || side) * 12 * scale;
      pos = Math.max(2, Math.min(cross - 3, pos));
      const width = 1.2 + nShape(t / 14, 8.2) * 1.6;
      for (let o = -Math.ceil(width); o <= Math.ceil(width); o++) {
        if (Math.abs(o) > width) continue;
        const p = Math.round(pos + o);
        const [x, y] = vertical ? [p, t] : [t, p];
        if (inside(x, y)) tiles[idx(x, y)] = '~';
      }
    }
  }
  // 3. Wälder: große zusammenhängende Flächen mit Lichtungen
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[idx(x, y)] !== '.') continue;
    const f = nWood(x / (18 * scale), y / (18 * scale));
    const gap = nShape(x / 4, y / 4, 2);
    if (f > 0.6 && gap > 0.32) tiles[idx(x, y)] = 'h';
    else if (f > 0.5 && gap > 0.78) tiles[idx(x, y)] = 'h'; // einzelne Bäume am Waldrand
  }
  // 4. Felsiges Hochland mit Steinvorkommen
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (tiles[idx(x, y)] === '~') continue;
    const r = nRock(x / (20 * scale), y / (20 * scale));
    if (r > 0.68 && nShape(x / 3, y / 3, 2) > 0.38) tiles[idx(x, y)] = 't';
  }

  // 4b. Sandstrände: Quarzsand an manchen Ufern
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    if (tiles[idx(x, y)] !== '.' && tiles[idx(x, y)] !== 'h') continue;
    const shore = tiles[idx(x - 1, y)] === '~' || tiles[idx(x + 1, y)] === '~' || tiles[idx(x, y - 1)] === '~' || tiles[idx(x, y + 1)] === '~';
    if (shore && nShape(x / 9 + 50, y / 9, 2) > 0.62) tiles[idx(x, y)] = 'q';
  }

  // Erzfeld mit unregelmäßigem Rand (nicht über Wasser, außer bei erzwungenen Feldern)
  const field = (bx, by, kind, size, force) => {
    const R = Math.ceil(size + 2);
    const off = rand() * 100;
    for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) {
      const tx = bx + x, ty = by + y;
      if (!inside(tx, ty)) continue;
      const d = Math.hypot(x, y) / size + (nShape(tx / 3 + off, ty / 3 - off, 2) - 0.5) * 0.9;
      if (d >= 0.8) continue;
      if (!force && tiles[idx(tx, ty)] === '~') continue;
      tiles[idx(tx, ty)] = kind;
    }
  };
  // Ort im Abstandsring [r0, r1] um die Zentrale suchen, möglichst auf Land
  const spot = (r0, r1) => {
    let best = null;
    for (let i = 0; i < 30; i++) {
      const a = rand() * Math.PI * 2;
      const r = r0 + rand() * (r1 - r0);
      const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
      if (!inside(x, y)) continue;
      best = [x, y];
      if (tiles[idx(x, y)] !== '~') break;
    }
    return best;
  };

  // 5. Garantierte Startvorkommen rund um die Zentrale
  const near = ['h', 't', 'e', 'k'];
  const a0 = rand() * Math.PI * 2;
  near.forEach((k, i) => {
    const a = a0 + (i / near.length) * Math.PI * 2 + (rand() - 0.5) * 0.6;
    field(Math.round(cx + Math.cos(a) * 10), Math.round(cy + Math.sin(a) * 10), k, k === 'h' ? 3.6 : 3, true);
  });
  // 6. Weitere Felder: seltene Erze liegen weiter draußen und sind dafür größer
  const ores = [
    // Art, Anzahl je 160x160, Abstand von, bis, Größe von, bis
    ['e', 9, 16, 80, 2.5, 4.5],
    ['k', 9, 16, 80, 2.5, 4.5],
    ['t', 5, 16, 80, 2.5, 4],
    ['c', 8, 18, 80, 2.5, 4.5],
    ['w', 5, 32, 85, 2, 3.5],
    ['u', 4, 46, 90, 2, 3],
    ['q', 4, 14, 70, 2.5, 4],
    ['b', 6, 20, 80, 2.5, 4],
    ['s', 5, 26, 85, 2.5, 3.5],
    ['g', 4, 40, 90, 2, 3],
  ];
  const area = (w * h) / (160 * 160);
  const reach = Math.hypot(cx, cy);
  for (const [k, count, d0, d1, s0, s1] of ores) {
    const n = Math.max(1, Math.round(count * area));
    for (let i = 0; i < n; i++) {
      const lo = Math.min(d0 * scale, reach * 0.8);
      const hi = Math.min(d1 * scale, reach);
      const p = spot(lo, Math.max(lo + 1, hi));
      // Das erste Feld jeder Sorte wird auf jeden Fall gesetzt
      if (p) field(p[0], p[1], k, s0 + rand() * (s1 - s0), i === 0);
    }
  }
  // 7. Platz um die Zentrale frei halten
  for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) if (inside(x, y)) tiles[idx(x, y)] = '.';
  return tiles.join('');
}

function freshResearch() {
  return { done: ['grundlagen'], stock: {}, delivered: {}, won: false };
}

class World {
  constructor(opts = {}) {
    this.w = opts.w || MAP_SIZE;
    this.h = opts.h || MAP_SIZE;
    this.seed = opts.seed ?? Math.floor(Math.random() * 1e9);
    this.tiles = opts.tiles || generateMap(this.w, this.h, this.seed);
    this.grid = new Map(); // "x,y" -> Gebäude
    this.buildings = new Map(); // id -> Gebäude
    this.nextId = 1;
    this.tick = 0;
    this.research = freshResearch();
    this.money = opts.money ?? START_MONEY;
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
  place(kind, x, y, dir, opts = {}) {
    if (!BUILDINGS[kind] || BUILDINGS[kind].hidden) return 'Unbekanntes Gebäude';
    if (!this.unlocked().includes(kind)) return 'Noch nicht erforscht';
    if (!this.inBounds(x, y)) return 'Außerhalb der Karte';
    dir = ((dir | 0) % 4 + 4) % 4;
    const existing = this.at(x, y);
    if (existing) {
      // Bänder dürfen gedreht werden, alles andere nicht
      // Quer über ein Band gezogen: daraus wird eine Kreuzung
      if (kind === 'band' && existing.kind === 'band' && opts.cross && existing.dir % 2 !== dir % 2) {
        const extra = COSTS.kreuzung - COSTS.band;
        if (this.money < extra) return `Nicht genug Geld: Eine Kreuzung kostet ${COSTS.kreuzung} Taler`;
        this.money -= extra;
        this.grid.delete(this.key(x, y));
        this.buildings.delete(existing.id);
        this.changes.push({ op: 'del', id: existing.id });
        const k = this._add({ kind: 'kreuzung', x, y, dir: existing.dir });
        // Was gerade auf dem alten Band lag, fährt in seiner Richtung weiter
        if (existing.state.item) k.state[existing.dir % 2 ? 'v' : 'h'] = { item: existing.state.item, p: existing.state.p || 0, d: existing.dir };
        return null;
      }
      if (existing.kind === 'kreuzung' && kind === 'band') return null;
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
    if (kind !== 'band' && this.tileAt(x, y) === WATER) return 'Im Wasser gehen nur Förderbänder';
    const cost = COSTS[kind] || 0;
    if (this.money < cost) return `Nicht genug Geld: ${BUILDINGS[kind].name} kostet ${cost} Taler`;
    this.money -= cost;
    this._add({ kind, x, y, dir });
    return null;
  }

  remove(x, y) {
    const b = this.at(x, y);
    if (!b || b.kind === 'zentrale') return false;
    this.money += COSTS[b.kind] || 0;
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
    if (b.kind === 'kreuzung') {
      const d = DIRS.findIndex(([x, y]) => x === b.x - fx && y === b.y - fy);
      if (d < 0) return false;
      return !b.state[d % 2 ? 'v' : 'h'];
    }
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

  insert(b, item, d) {
    if (b.kind === 'zentrale') { this.deliver(item); return; }
    if (b.kind === 'kreuzung') { b.state[d % 2 ? 'v' : 'h'] = { item, p: 0, d }; return; }
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
    this.money += VALUES[item] || 0;
  }

  // Versucht, ein Item aus Gebäude b in Richtung d (Standard: vorne) zu schieben.
  push(b, item, d = b.dir) {
    const [dx, dy] = DIRS[d];
    const tx = b.x + dx;
    const ty = b.y + dy;
    const t = this.at(tx, ty);
    if (!t || t === b) return false;
    if (!this.accepts(t, item, b.x, b.y)) return false;
    this.insert(t, item, d);
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
        case 'kreuzung':
          for (const slot of ['h', 'v']) {
            const it = s[slot];
            if (!it) continue;
            if (it.p < 1) it.p = Math.min(1, it.p + beltSpeed);
            if (it.p >= 1) {
              s[slot] = null;
              if (!this.push(b, it.item, it.d)) s[slot] = it;
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
    const cross = [];
    for (const b of this.buildings.values()) {
      if (b.kind === 'kreuzung') {
        for (const slot of ['h', 'v']) { const it = b.state[slot]; if (it) cross.push(b.x, b.y, it.item, Math.round(it.p * 100) / 100, it.d); }
      } else if (b.kind === 'band' && b.state.item) items.push(b.x, b.y, b.state.item, Math.round(b.state.p * 100) / 100);
      else if (b.state.recipe || b.state.out) busy.push(b.id, b.state.recipe ? b.state.recipe.out : b.state.out);
    }
    return { items, busy, cross };
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
      money: this.money,
    };
  }

  toJSON() {
    return {
      version: SAVE_VERSION,
      w: this.w, h: this.h, seed: this.seed, tiles: this.tiles, research: this.research, money: this.money,
      buildings: [...this.buildings.values()].filter((b) => b.kind !== 'zentrale').map((b) => ({
        kind: b.kind, x: b.x, y: b.y, dir: b.dir,
        state: { item: b.state.item || null, p: b.state.p || 0, buf: b.state.buf, out: b.state.out || null, next: b.state.next || 0, h: b.state.h || null, v: b.state.v || null },
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
    // Alte kleine Welten (z. B. 80x80) werden auf die große Karte erweitert: Die alte Fläche
    // bleibt in der Mitte erhalten, drumherum entsteht neues Land mit allen Erzen.
    let ox = 0, oy = 0, W = data.w, H = data.h;
    if (data.w < MAP_SIZE || data.h < MAP_SIZE) {
      W = Math.max(MAP_SIZE, data.w);
      H = Math.max(MAP_SIZE, data.h);
      ox = Math.floor(W / 2) - Math.floor(data.w / 2);
      oy = Math.floor(H / 2) - Math.floor(data.h / 2);
      const big = generateMap(W, H, data.seed ?? 1).split('');
      for (let y = 0; y < data.h; y++) for (let x = 0; x < data.w; x++) big[(y + oy) * W + x + ox] = tiles[y * data.w + x];
      tiles = big.join('');
    }
    // Alte Spielstände ohne Geld bekommen ein Startkapital
    const w = new World({ w: W, h: H, seed: data.seed, tiles, money: typeof data.money === 'number' ? data.money : 1000 });
    if (research && Array.isArray(research.done)) w.research = { ...freshResearch(), ...research };
    for (const b of data.buildings || []) {
      const st = b.state || {};
      const ok = (it) => (it && ITEMS[it] ? it : null);
      const buf = {};
      for (const [k, n] of Object.entries(st.buf || {})) if (ITEMS[k] && n > 0) buf[k] = n;
      if (!BUILDINGS[b.kind] || w.at(b.x + ox, b.y + oy)) continue;
      const slot = (q) => (q && ITEMS[q.item] && q.d >= 0 && q.d < 4 ? { item: q.item, p: q.p || 0, d: q.d } : null);
      w._add({ kind: b.kind, x: b.x + ox, y: b.y + oy, dir: b.dir, state: { item: ok(st.item), p: st.p || 0, buf, out: ok(st.out), next: st.next || 0, h: slot(st.h), v: slot(st.v) } }, true);
    }
    return w;
  }
}

const DEFS = { COSTS, VALUES, DIRS, DEPOSITS, WATER, ITEMS, BUILDINGS, RECIPES, TECHS, MACHINES };

module.exports = { World, DEFS, generateMap, TECHS };
