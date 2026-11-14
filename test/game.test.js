'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { World } = require('../src/game');

// Kleine Testwelt: Vorkommen links von der Zentrale in einer Reihe
function makeWorld(depositChar = 'r') {
  const w = new World({ w: 20, h: 20, seed: 1, tiles: '.'.repeat(400) });
  const tiles = w.tiles.split('');
  tiles[10 * 20 + 2] = depositChar;
  w.tiles = tiles.join('');
  return w; // Zentrale bei (9..11, 9..11)
}

function run(w, n) { for (let i = 0; i < n; i++) w.step(); }

test('Bohrer nur auf Vorkommen', () => {
  const w = makeWorld();
  assert.strictEqual(w.place('bohrer', 3, 10, 0), 'Bohrer nur auf Vorkommen');
  assert.strictEqual(w.place('bohrer', 2, 10, 0), null);
});

test('Gesperrte Gebäude können nicht gebaut werden', () => {
  const w = makeWorld();
  assert.strictEqual(w.place('presse', 4, 4, 0), 'Noch nicht erforscht');
});

test('Bohrer -> Band -> Schmelze -> Band -> Zentrale liefert Barren', () => {
  const w = makeWorld();
  assert.strictEqual(w.place('bohrer', 2, 10, 0), null);
  w.place('band', 3, 10, 0);
  w.place('band', 4, 10, 0);
  w.place('schmelze', 5, 10, 0);
  for (let x = 6; x <= 8; x++) w.place('band', x, 10, 0);
  run(w, 400);
  assert.ok((w.research.delivered.rubinbarren || 0) > 5, JSON.stringify(w.research));
  assert.ok(!w.research.delivered.rubinerz, 'Erz sollte verarbeitet werden');
});

test('Forschung schaltet die Presse frei', () => {
  const w = makeWorld();
  for (let i = 0; i < 20; i++) w.deliver('rubinbarren');
  assert.strictEqual(w.research.level, 1);
  assert.ok(w.unlocked().includes('presse'));
  assert.strictEqual(w.place('presse', 4, 4, 0), null);
});

test('Montage braucht beide Zutaten', () => {
  const w = makeWorld();
  w.research.level = 2;
  w.place('montage', 5, 5, 0);
  const m = w.at(5, 5);
  assert.ok(w.accepts(m, 'zahnrad', 4, 5));
  w.insert(m, 'zahnrad');
  assert.ok(!w.accepts(m, 'glas', 4, 5), 'Glas passt nicht zu Zahnrad');
  assert.ok(w.accepts(m, 'spule', 5, 4));
  w.insert(m, 'spule');
  run(w, 31);
  assert.ok(m.state.out === 'motor' || m.state.out === null);
});

test('Band nimmt nichts frontal an', () => {
  const w = makeWorld();
  w.place('band', 5, 5, 0); // zeigt nach rechts auf (6,5)
  assert.ok(!w.accepts(w.at(5, 5), 'glas', 6, 5));
  assert.ok(w.accepts(w.at(5, 5), 'glas', 4, 5));
});

test('Speichern und Laden', () => {
  const w = makeWorld();
  w.place('bohrer', 2, 10, 1);
  w.place('band', 3, 3, 2);
  const w2 = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.strictEqual(w2.at(2, 10).kind, 'bohrer');
  assert.strictEqual(w2.at(3, 3).dir, 2);
  assert.strictEqual(w2.at(10, 10).kind, 'zentrale');
});
