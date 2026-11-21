'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { World, TECHS, DEFS } = require('../src/game');

// Gegenstände auf einem Band (Bänder tragen jetzt mehrere hintereinander)
const onBelt = (b) => (b.state.list || []).map((it) => it.item);

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
  w.research.done.push('logistik');
  assert.strictEqual(w.bonus('band'), 1.25);
  w.research.done.push('baender1');
  assert.strictEqual(w.bonus('band'), 1.25 * 1.5);
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
  assert.ok(onBelt(w.at(6, 5)).length && onBelt(w.at(5, 6)).length && onBelt(w.at(5, 4)).length);
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
  // Kleine Welten werden beim Laden auf 160x160 erweitert, alles rückt um 70 Felder in die Mitte
  const o = 70;
  const w2 = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.strictEqual(w2.w, 160);
  assert.strictEqual(w2.at(2 + o, 10 + o).kind, 'bohrer');
  assert.strictEqual(w2.tileAt(2 + o, 10 + o), 'e');
  assert.strictEqual(w2.at(3 + o, 3 + o).dir, 2);
  assert.strictEqual(w2.hub.x, 9 + o);
  assert.strictEqual([...w2.buildings.values()].filter((b) => b.kind === 'zentrale').length, 1);
  assert.strictEqual(w2.research.stock.ziegel, 5);
  for (const ch of ['~', 'u', 'w']) assert.ok(w2.tiles.includes(ch), ch + ' fehlt in der erweiterten Welt');
  // Große Welten bleiben beim Speichern/Laden unverändert
  const big = new World({ seed: 5 });
  big.place('band', 10, 10, 1);
  const big2 = World.fromJSON(JSON.parse(JSON.stringify(big.toJSON())));
  assert.strictEqual(big2.tiles, big.tiles);
  assert.strictEqual(big2.at(10, 10).dir, 1);
  const old = { w: 20, h: 20, seed: 1, tiles: 'r' + '.'.repeat(399), research: { level: 3, progress: {} }, buildings: [{ kind: 'montage', x: 1, y: 1, dir: 0 }, { kind: 'band', x: 2, y: 2, dir: 0, state: { item: 'rubinerz' } }] };
  const w3 = World.fromJSON(old);
  assert.strictEqual(w3.tileAt(o, o), 'e');
  assert.deepStrictEqual(w3.research.done, ['grundlagen']);
  assert.ok(!w3.at(1 + o, 1 + o));
  assert.deepStrictEqual(onBelt(w3.at(2 + o, 2 + o)), []);
  // altes Einzel-Item auf einem Band wird übernommen, alter Zusammenführer wird zum Band
  const w4 = World.fromJSON({ ...w.toJSON(), buildings: [{ kind: 'band', x: 4, y: 4, dir: 0, state: { item: 'stein', p: 0.4 } }, { kind: 'zusammenfuehrer', x: 5, y: 4, dir: 0 }] });
  assert.deepStrictEqual(onBelt(w4.at(4 + o, 4 + o)), ['stein']);
  assert.strictEqual(w4.at(5 + o, 4 + o).kind, 'band');
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
  w.money = 10000;
  assert.strictEqual(w.place('bohrer', 2, 10, 0), null);
  w.place('band', 3, 10, 0);
  assert.strictEqual(w.place('zentrifuge', 4, 10, 0), null);
  for (let x = 5; x <= 8; x++) w.place('band', x, 10, 0);
  run(w, 500);
  assert.ok((w.research.stock.uranpellet || 0) > 2, JSON.stringify(w.research.stock));
});

test('Großer Techbaum: jede Technik ist mit den Gebäuden ihrer Vorgänger bezahlbar', () => {
  const byId = Object.fromEntries(TECHS.map((t) => [t.id, t]));
  const ancestors = (id, set = new Set()) => { for (const q of byId[id].req) if (!set.has(q)) { set.add(q); ancestors(q, set); } return set; };
  for (const t of TECHS) {
    const built = new Set();
    for (const a of [...ancestors(t.id)]) (byId[a].unlock || []).forEach((k) => built.add(k));
    const have = new Set(Object.values(DEFS.DEPOSITS));
    let grew = true;
    while (grew) {
      grew = false;
      for (const k of built) for (const r of DEFS.RECIPES[k] || []) {
        if (!have.has(r.out) && Object.keys(r.in).every((i) => have.has(i))) { have.add(r.out); grew = true; }
      }
    }
    for (const i of Object.keys(t.cost)) assert.ok(have.has(i), `${t.id}: ${i} ist mit den Vorgängern noch nicht herstellbar`);
  }
  // Umfang: mindestens 25 Techniken, 13 Gebäude, 11 Rohstoffe, 50 Gegenstände
  assert.ok(TECHS.length >= 25);
  assert.ok(Object.keys(DEFS.BUILDINGS).length >= 13);
  assert.ok(Object.keys(DEFS.DEPOSITS).length >= 11);
  assert.ok(Object.keys(DEFS.ITEMS).length >= 50);
  // Jedes Gebäude wird von einer Technik freigeschaltet, jeder Gegenstand ist ein Rohstoff oder ein Produkt
  const unlocks = new Set(TECHS.flatMap((t) => t.unlock || []));
  for (const k of Object.keys(DEFS.BUILDINGS)) if (!DEFS.BUILDINGS[k].hidden) assert.ok(unlocks.has(k), k + ' wird nie freigeschaltet');
  const made = new Set([...Object.values(DEFS.DEPOSITS), ...Object.values(DEFS.RECIPES).flat().map((r) => r.out)]);
  for (const i of Object.keys(DEFS.ITEMS)) assert.ok(made.has(i), i + ' kann nicht entstehen');
  // Innerhalb einer Maschine darf kein Rezept eine Teilmenge eines anderen sein
  for (const [k, list] of Object.entries(DEFS.RECIPES)) for (const a of list) for (const b of list) {
    if (a === b) continue;
    assert.ok(!Object.keys(a.in).every((i) => b.in[i]), `${k}: ${a.out} steckt in ${b.out}`);
  }
});

test('Montagehalle verarbeitet drei Zutaten', () => {
  const w = makeWorld();
  w.research.done.push('montage');
  w.money = 10000;
  w.place('montagehalle', 5, 5, 0);
  const b = w.at(5, 5);
  for (const it of ['roboterarm', 'bohrkopf', 'batterie']) { assert.ok(w.accepts(b, it, 4, 5), it); w.insert(b, it); }
  assert.ok(!w.accepts(b, 'computer', 4, 5));
  run(w, 200);
  assert.strictEqual(b.state.buf.roboterarm || 0, 0, JSON.stringify(b.state));
});

test('Geld: Bauen kostet, Abreißen erstattet, Liefern bringt Geld', () => {
  const w = makeWorld();
  assert.strictEqual(w.money, 300);
  assert.strictEqual(w.place('schmelze', 4, 4, 0), null);
  assert.strictEqual(w.money, 300 - DEFS.COSTS.schmelze);
  w.place('band', 5, 5, 0);
  w.place('band', 5, 5, 1); // drehen ist kostenlos
  assert.strictEqual(w.money, 300 - DEFS.COSTS.schmelze - DEFS.COSTS.band);
  w.remove(4, 4);
  assert.strictEqual(w.money, 300 - DEFS.COSTS.band);
  w.money = 10;
  assert.match(w.place('schmelze', 4, 4, 0), /Nicht genug Geld/);
  w.deliver('eisenbarren');
  assert.strictEqual(w.money, 10 + DEFS.VALUES.eisenbarren);
  // Wert steigt mit jeder Verarbeitungsstufe
  for (const r of Object.values(DEFS.RECIPES).flat()) {
    const sum = Object.entries(r.in).reduce((a, [i, n]) => a + DEFS.VALUES[i] * n, 0);
    assert.ok(DEFS.VALUES[r.out] > sum, r.out);
  }
  const w2 = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.strictEqual(w2.money, w.money);
});

test('Kreuzung: von Hand gesetzt, beide Richtungen laufen geradeaus', () => {
  const tiles = '.'.repeat(400).split('');
  tiles[5 * 20 + 1] = 'e'; // Eisen links
  tiles[1 * 20 + 5] = 'k'; // Kupfer oben
  const w = new World({ w: 20, h: 20, seed: 1, tiles: tiles.join('') });
  w.money = 1000;
  w.research.done.push('logistik'); // Kreuzung und Verteiler müssen erforscht werden
  // waagerechte Linie y=5 von x=2..8 nach rechts, Ende in Sammelband nach unten
  w.place('bohrer', 1, 5, 0);
  for (let x = 2; x <= 8; x++) w.place('band', x, 5, 0);
  // senkrechte Linie x=5 von y=2..8 nach unten, kreuzt bei (5,5)
  w.place('bohrer', 5, 1, 1);
  for (let y = 2; y <= 8; y++) if (y !== 5) assert.strictEqual(w.place('band', 5, y, 1), null);
  // Band quer darüber ziehen dreht es nur, es entsteht keine Kreuzung von selbst
  w.place('band', 5, 5, 1);
  assert.strictEqual(w.at(5, 5).kind, 'band');
  w.place('band', 5, 5, 0);
  // Kreuzung aus dem Bau-Menü direkt auf das Band setzen
  const m0 = w.money;
  assert.strictEqual(w.place('kreuzung', 5, 5, 0), null);
  assert.strictEqual(w.at(5, 5).kind, 'kreuzung');
  assert.strictEqual(w.money, m0 - (DEFS.COSTS.kreuzung - DEFS.COSTS.band));
  w.place('band', 3, 5, 1);
  assert.strictEqual(w.at(3, 5).kind, 'band');
  w.place('band', 3, 5, 0);
  // Ziel: Kisten am Ende zählen über Fake-Zentrale -> wir prüfen Items hinter der Kreuzung
  const seen = { h: new Set(), v: new Set() };
  for (let i = 0; i < 400; i++) {
    w.step();
    for (const a of onBelt(w.at(6, 5))) seen.h.add(a);
    for (const b of onBelt(w.at(5, 6))) seen.v.add(b);
  }
  assert.deepStrictEqual([...seen.h], ['eisenerz']);
  assert.deepStrictEqual([...seen.v], ['kupfererz']);
  const before = w.money;
  w.remove(5, 5);
  assert.strictEqual(w.money, before + DEFS.COSTS.kreuzung);
  // Speichern mit Kreuzung
  // Kreuzung auf leerem Feld
  assert.strictEqual(w.place('kreuzung', 5, 5, 0), null);
  assert.strictEqual(w.at(5, 5).kind, 'kreuzung');
  const w2 = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.ok([...w2.buildings.values()].some((b) => b.kind === 'kreuzung'));
});

test('Automatische Zusammenführung: treffen Bänder aufeinander, kommen alle gerecht dran', () => {
  const tiles = '.'.repeat(400).split('');
  tiles[5 * 20 + 1] = 'e'; // Eisen links (hinten)
  tiles[1 * 20 + 5] = 'k'; // Kupfer oben (links)
  tiles[9 * 20 + 5] = 't'; // Stein unten (rechts)
  const w = new World({ w: 20, h: 20, seed: 1, tiles: tiles.join('') });
  w.money = 1000;
  assert.ok(!DEFS.BUILDINGS.zusammenfuehrer, 'Zusammenführer ist kein eigenes Bauteil mehr');
  w.research.done.push('baender1', 'logistik'); // schnellere Bänder, damit sich alles staut
  w.place('bohrer', 1, 5, 0); for (let x = 2; x <= 4; x++) w.place('band', x, 5, 0);
  w.place('bohrer', 5, 1, 1); for (let y = 2; y <= 4; y++) w.place('band', 5, y, 1);
  w.place('bohrer', 5, 9, 3); for (let y = 6; y <= 8; y++) w.place('band', 5, y, 3);
  w.place('band', 5, 5, 0); // gewöhnliches Band, an dem drei Bänder zusammentreffen
  w.place('band', 6, 5, 0);
  const count = {};
  for (let i = 0; i < 3000; i++) {
    w.step();
    // Band dahinter als Senke: abnehmen, was ankommt
    const b = w.at(6, 5);
    for (const it of b.state.list || []) count[it.item] = (count[it.item] || 0) + 1;
    b.state.list = [];
  }
  const n = ['eisenerz', 'kupfererz', 'stein'].map((it) => count[it] || 0);
  assert.ok(Math.min(...n) > 10, 'alle drei kommen durch: ' + JSON.stringify(count));
  // Stau: der Ausgang ist langsamer als die drei Zuläufe zusammen, trotzdem kommt jeder gleich oft dran
  const w2 = new World({ w: 20, h: 20, seed: 1, tiles: '.'.repeat(400) });
  w2.money = 1000;
  for (let x = 2; x <= 4; x++) w2.place('band', x, 5, 0);
  for (let y = 2; y <= 4; y++) w2.place('band', 5, y, 1);
  for (let y = 6; y <= 8; y++) w2.place('band', 5, y, 3);
  w2.place('band', 5, 5, 0); w2.place('band', 6, 5, 0);
  const c2 = {};
  for (let i = 0; i < 3000; i++) {
    for (const [x, y, it, fx, fy] of [[2, 5, 'eisenerz', 1, 5], [5, 2, 'kupfererz', 5, 1], [5, 8, 'stein', 5, 9]]) {
      const b = w2.at(x, y);
      if (w2.accepts(b, it, fx, fy)) w2.insert(b, it, b.dir);
    }
    w2.step();
    if (i % 12 === 0) { const b = w2.at(6, 5); for (const it of b.state.list || []) c2[it.item] = (c2[it.item] || 0) + 1; b.state.list = []; }
  }
  const n2 = ['eisenerz', 'kupfererz', 'stein'].map((it) => c2[it] || 0);
  assert.ok(Math.min(...n2) > 100 && Math.max(...n2) - Math.min(...n2) <= 3, 'gerecht im Stau: ' + JSON.stringify(c2));
});

test('Bänder tragen mehrere Gegenstände dicht hintereinander', () => {
  const w = makeWorld();
  for (let x = 3; x <= 6; x++) w.place('band', x, 5, 0); // Ende bei x=6 blockiert (nichts davor)
  for (let i = 0; i < 200; i++) {
    const b = w.at(3, 5);
    if (w.accepts(b, 'stein', 2, 5)) w.insert(b, 'stein', 0);
    w.step();
  }
  const total = [3, 4, 5, 6].reduce((n, x) => n + onBelt(w.at(x, 5)).length, 0);
  assert.ok(total >= 11, 'mindestens 3 pro Feld, gefunden: ' + total);
  // Abstand wird eingehalten
  for (let x = 3; x <= 6; x++) {
    const ps = w.at(x, 5).state.list.map((it) => it.p);
    for (let i = 1; i < ps.length; i++) assert.ok(ps[i - 1] - ps[i] >= DEFS.BELT_GAP - 1e-9);
  }
});

test('Verteiler direkt auf ein Band setzen teilt in drei Richtungen', () => {
  const w = makeWorld();
  w.money = 1000;
  w.research.done.push('logistik');
  w.place('band', 5, 5, 0);
  assert.strictEqual(w.place('verteiler', 5, 5, 0), null);
  const v = w.at(5, 5);
  assert.strictEqual(v.kind, 'verteiler');
  w.place('band', 6, 5, 0); w.place('band', 5, 6, 1); w.place('band', 5, 4, 3);
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    w.insert(v, 'bretter');
    w.step();
    for (const [x, y] of [[6, 5], [5, 6], [5, 4]]) if (onBelt(w.at(x, y)).length) seen.add(x + ',' + y);
  }
  assert.strictEqual(seen.size, 3);
});

test('Bandteile müssen erforscht werden', () => {
  const w = makeWorld();
  w.money = 1000;
  assert.ok(w.unlocked().includes('band'));
  for (const k of ['kreuzung', 'verteiler', 'unterfuehrung']) assert.strictEqual(w.place(k, 5, 5, 0), 'Noch nicht erforscht');
  w.research.done.push('logistik');
  assert.strictEqual(w.place('verteiler', 5, 5, 0), null);
  assert.strictEqual(w.place('unterfuehrung', 6, 6, 0), 'Noch nicht erforscht');
  w.research.done.push('tunnelbau');
  assert.strictEqual(w.place('unterfuehrung', 6, 6, 0), null);
});

test('Unterführung: Gegenstände laufen unter einem querenden Band hindurch', () => {
  const tiles = '.'.repeat(400).split('');
  tiles[5 * 20 + 1] = 'e';
  const w = new World({ w: 20, h: 20, seed: 1, tiles: tiles.join('') });
  w.money = 1000;
  w.research.done.push('logistik', 'tunnelbau');
  w.place('bohrer', 1, 5, 0);
  w.place('band', 2, 5, 0);
  w.place('unterfuehrung', 3, 5, 0); // Eingang
  for (let y = 2; y <= 8; y++) w.place('band', 5, y, 1); // querendes Band dazwischen
  w.place('band', 4, 5, 3); w.place('band', 6, 5, 1); // weitere Hindernisse
  w.place('unterfuehrung', 7, 5, 0); // Ausgang, 3 Felder dazwischen
  w.place('band', 8, 5, 0);
  assert.ok(w.tunnelIsEntrance(w.at(3, 5)) && !w.tunnelIsEntrance(w.at(7, 5)));
  assert.strictEqual(w.tunnelPartner(w.at(3, 5)).k, 4);
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    w.step();
    for (const it of w.at(8, 5).state.list || []) seen.add(it.item);
    for (const it of w.at(5, 5).state.list || []) assert.notStrictEqual(it.item, 'eisenerz', 'nichts landet auf dem querenden Band');
  }
  assert.deepStrictEqual([...seen], ['eisenerz']);
  // zu weit auseinander: kein Tunnel
  const w2 = new World({ w: 20, h: 20, seed: 1, tiles: '.'.repeat(400) });
  w2.money = 1000; w2.research.done.push('logistik', 'tunnelbau');
  w2.place('unterfuehrung', 2, 2, 0); w2.place('unterfuehrung', 8, 2, 0);
  assert.strictEqual(w2.tunnelPartner(w2.at(2, 2)), null);
  // Speichern/Laden behält Gegenstände im Tunnel
  const w3 = World.fromJSON(JSON.parse(JSON.stringify(w.toJSON())));
  assert.ok([...w3.buildings.values()].some((b) => b.kind === 'unterfuehrung'));
});

test('Von der Seite einlaufende Gegenstände gleiten zur Mitte, Kurven starten am Anfang', () => {
  const w = makeWorld();
  w.place('band', 5, 5, 0); w.place('band', 4, 5, 0); w.place('band', 5, 4, 1); // T-Stück: hinten und links
  const b = w.at(5, 5);
  w.insert(b, 'stein', 1); // von oben (links in Laufrichtung)
  assert.strictEqual(b.state.list[0].p, 0.5);
  assert.strictEqual(b.state.list[0].s, -0.5);
  for (let i = 0; i < 4; i++) w.step();
  assert.ok(!b.state.list[0].s);
  // Kurve: nur von der Seite beliefert -> Start am Anfang der Kurve ohne Versatz
  const c = new World({ w: 20, h: 20, seed: 1, tiles: '.'.repeat(400) });
  c.place('band', 5, 5, 0); c.place('band', 5, 4, 1);
  c.insert(c.at(5, 5), 'stein', 1);
  assert.deepStrictEqual(c.at(5, 5).state.list[0], { item: 'stein', p: 0 });
});
