'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { World, TECHS, DEFS } = require('../src/game');

// Kleine Testwelt mit einem Eisenvorkommen links von der Zentrale
function makeWorld(depositChar = 'e') {
  const tiles = '.'.repeat(400).split('');
  tiles[10 * 20 + 2] = depositChar;
  return new World({ w: 20, h: 20, seed: 1, tiles: tiles.join('') }); // Zentrale bei (9..11, 9..11)
}

function run(w, n) { for (let i = 0; i < n; i++) w.step(); }
function give(w, item, n) { for (let i = 0; i < n; i++) w.deliver(item); }

test('Bohrer nur auf Vorkommen', () => {
  const w = makeWorld();
  assert.strictEqual(w.place('bohrer', 3, 10, 0), 'Bohrer nur auf Vorkommen');
  assert.strictEqual(w.place('bohrer', 2, 10, 0), null);
});

test('Gesperrte Gebäude können nicht gebaut werden', () => {
  const w = makeWorld();
  assert.strictEqual(w.place('presse', 4, 4, 0), 'Noch nicht erforscht');
});

test('Bohrer -> Band -> Schmelzofen -> Band -> Zentrale füllt das Lager', () => {
  const w = makeWorld();
  assert.strictEqual(w.place('bohrer', 2, 10, 0), null);
  w.place('band', 3, 10, 0);
  w.place('band', 4, 10, 0);
  w.place('schmelze', 5, 10, 0);
  for (let x = 6; x <= 8; x++) w.place('band', x, 10, 0);
  run(w, 400);
  assert.ok((w.research.stock.eisenbarren || 0) > 5, JSON.stringify(w.research));
  assert.ok(!w.research.stock.eisenerz, 'Erz sollte verarbeitet werden');
});

test('Wald liefert Holz, Sägewerk macht Bretter', () => {
  const w = makeWorld('h');
  w.place('bohrer', 2, 10, 0);
  w.place('saege', 3, 10, 0);
  for (let x = 4; x <= 8; x++) w.place('band', x, 10, 0);
  run(w, 300);
  assert.ok((w.research.stock.bretter || 0) > 3);
});

test('Techbaum: Vorgänger und Kosten werden geprüft', () => {
  const w = makeWorld();
  assert.match(w.doResearch('handwerk'), /Vorgänger/);
  assert.match(w.doResearch('metallbau'), /fehlen/);
  give(w, 'eisenbarren', 20);
  give(w, 'bretter', 12);
  assert.strictEqual(w.doResearch('metallbau'), null);
  assert.strictEqual(w.research.stock.bretter, 2);
  assert.ok(w.unlocked().includes('presse'));
  assert.strictEqual(w.place('presse', 4, 4, 0), null);
  assert.strictEqual(w.doResearch('metallbau'), 'Schon erforscht');
});

test('Techbaum ist zusammenhängend und alle Kosten sind herstellbar', () => {
  const ids = new Set(TECHS.map((t) => t.id));
  const makeable = new Set(Object.values(DEFS.DEPOSITS));
  Object.values(DEFS.RECIPES).flat().forEach((r) => makeable.add(r.out));
  for (const t of TECHS) {
    t.req.forEach((q) => assert.ok(ids.has(q), `${t.id} braucht unbekanntes ${q}`));
    Object.keys(t.cost).forEach((i) => assert.ok(makeable.has(i), `${i} ist nicht herstellbar`));
  }
});

test('Bonus macht Bänder schneller', () => {
  const w = makeWorld();
  w.research.done.push('logistik', 'baender1');
  assert.strictEqual(w.bonus('band'), 1.5);
});

test('Hochofen braucht beide Zutaten', () => {
  const w = makeWorld();
  w.research.done.push('metallbau', 'feuer');
  w.place('hochofen', 5, 5, 0);
  const m = w.at(5, 5);
  assert.ok(w.accepts(m, 'kohle', 4, 5));
  w.insert(m, 'kohle');
  assert.ok(w.accepts(m, 'eisenbarren', 5, 4));
  w.insert(m, 'eisenbarren');
  run(w, 31);
  assert.strictEqual(m.state.out, 'stahl');
});

test('Verteiler verteilt abwechselnd', () => {
  const w = makeWorld();
  w.research.done.push('logistik');
  w.place('verteiler', 5, 5, 0);
  w.place('band', 6, 5, 0); // vorne
  w.place('band', 5, 6, 1); // rechts (unten)
  w.place('band', 5, 4, 3); // links (oben)
  const v = w.at(5, 5);
  for (let i = 0; i < 3; i++) { w.insert(v, 'stein'); w.step(); }
  assert.ok(w.at(6, 5).state.item && w.at(5, 6).state.item && w.at(5, 4).state.item);
});

test('Band nimmt nichts frontal an', () => {
  const w = makeWorld();
  w.place('band', 5, 5, 0);
  assert.ok(!w.accepts(w.at(5, 5), 'stein', 6, 5));
  assert.ok(w.accepts(w.at(5, 5), 'stein', 4, 5));
});

test('Speichern und Laden, alte Spielstände werden umgewandelt', () => {
  const w = makeWorld();
  w.place('bohrer', 2, 10, 1);
  w.place('band', 3, 3, 2);
  give(w, 'ziegel', 5);
  const w2 = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.strictEqual(w2.at(2, 10).kind, 'bohrer');
  assert.strictEqual(w2.at(3, 3).dir, 2);
  assert.strictEqual(w2.research.stock.ziegel, 5);
  const old = { w: 20, h: 20, seed: 1, tiles: 'r' + '.'.repeat(399), research: { level: 3, progress: {} }, buildings: [{ kind: 'montage', x: 1, y: 1, dir: 0 }, { kind: 'band', x: 2, y: 2, dir: 0, state: { item: 'rubinerz' } }] };
  const w3 = World.fromJSON(old);
  assert.strictEqual(w3.tileAt(0, 0), 'e');
  assert.deepStrictEqual(w3.research.done, ['grundlagen']);
  assert.ok(!w3.at(1, 1));
  assert.strictEqual(w3.at(2, 2).state.item, null);
});

test('Karte: groß, mit Wasser, Wald und allen Erzen, Zentrale frei', () => {
  const { generateMap } = require('../src/game');
  for (const seed of [1, 2, 3, 42]) {
    const w = new World({ seed });
    assert.strictEqual(w.w, 160);
    const t = w.tiles;
    for (const ch of ['~', 'h', 't', 'e', 'k', 'c', 'w', 'u']) assert.ok(t.includes(ch), `Seed ${seed}: ${ch} fehlt`);
    for (let y = 76; y <= 84; y++) for (let x = 76; x <= 84; x++) assert.strictEqual(t[y * 160 + x], '.');
    assert.strictEqual(generateMap(160, 160, seed), t, 'gleicher Seed, gleiche Karte');
  }
});

test('Im Wasser gehen nur Bänder', () => {
  const tiles = '.'.repeat(400).split('');
  tiles[2 * 20 + 2] = '~';
  const w = new World({ w: 20, h: 20, seed: 1, tiles: tiles.join('') });
  assert.match(w.place('saege', 2, 2, 0), /Wasser/);
  assert.strictEqual(w.place('band', 2, 2, 0), null);
});

test('Zentrifuge macht aus Uranerz Pellets', () => {
  const w = makeWorld('u');
  w.research.done.push('kernkraft');
  assert.strictEqual(w.place('bohrer', 2, 10, 0), null);
  w.place('band', 3, 10, 0);
  assert.strictEqual(w.place('zentrifuge', 4, 10, 0), null);
  for (let x = 5; x <= 8; x++) w.place('band', x, 10, 0);
  run(w, 500);
  assert.ok((w.research.stock.uranpellet || 0) > 2, JSON.stringify(w.research.stock));
});
