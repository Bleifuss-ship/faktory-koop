'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const JC = require('../public/joincode');
const { startServer } = require('../src/server');

test('Code: Heim-WLAN hat 5 Zeichen und kommt zurück', () => {
  const code = JC.encode('192.168.1.20:3000');
  assert.strictEqual(code.length, 5);
  assert.strictEqual(JC.decode(code), '192.168.1.20:3000');
  assert.strictEqual(JC.decode(code.toLowerCase()), '192.168.1.20:3000');
  assert.strictEqual(JC.encode('192.168.1.20'), code);
});

test('Code: andere Netze und Ports', () => {
  for (const a of ['10.0.0.7:3000', '172.20.3.4:3000', '192.168.178.44:41523', '10.1.2.3:3001', '192.168.0.0:3000', '255.255.255.255:65535']) {
    const c = JC.encode(a);
    assert.ok(c, a);
    assert.strictEqual(JC.decode(c), a, a);
    assert.strictEqual(JC.decode(JC.pretty(c)), a, 'mit Bindestrichen ' + a);
  }
  assert.strictEqual(JC.encode('10.0.0.7:3000').length, 8);
  assert.strictEqual(JC.encode('10.0.0.7:4000').length, 12);
});

test('Code: Tippfehler werden erkannt', () => {
  const code = JC.encode('192.168.1.20:3000');
  let caught = 0, total = 0;
  const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let i = 0; i < code.length; i++) {
    for (const ch of ABC) {
      if (ch === code[i]) continue;
      total++;
      const bad = code.slice(0, i) + ch + code.slice(i + 1);
      if (JC.decode(bad) === null) caught++;
    }
  }
  assert.ok(caught / total > 0.95, `${caught}/${total}`);
  assert.strictEqual(JC.decode(''), null);
  assert.strictEqual(JC.decode('HALLO!'), null);
  assert.strictEqual(JC.encode('kein.netz'), null);
});

test('Code: Heimnetz wird zuerst angezeigt', () => {
  assert.deepStrictEqual(JC.sortAddresses(['172.17.0.1:3000', '169.254.1.1:3000', '192.168.2.5:3000', '10.8.0.2:3000']),
    ['192.168.2.5:3000', '10.8.0.2:3000', '172.17.0.1:3000', '169.254.1.1:3000']);
});

// Kleiner Spieler für den Server-Test
function client(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const inbox = [];
    const waiters = [];
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.t === 'tick') return;
      const i = waiters.findIndex((w) => w.t === m.t);
      if (i >= 0) waiters.splice(i, 1)[0].res(m); else inbox.push(m);
    });
    ws.on('open', () => resolve({
      ws,
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (t) => new Promise((res) => {
        const i = inbox.findIndex((m) => m.t === t);
        if (i >= 0) res(inbox.splice(i, 1)[0]); else waiters.push({ t, res });
      }),
    }));
    ws.on('error', reject);
  });
}

test('Server: Beitritt per Code landet in der Welt des Hosts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-'));
  const srv = await startServer({ port: 0, host: '127.0.0.1', saveDir: dir });
  try {
    // Noch niemand in einer Welt: Beitritt wird abgelehnt
    const early = await client(srv.port);
    early.send({ t: 'join', name: 'Früh', code: true });
    const fail = await early.wait('fail');
    assert.match(fail.text, /keiner Welt/);
    early.ws.close();

    const host = await client(srv.port);
    host.send({ t: 'join', name: 'Host', room: 'meine-fabrik' });
    const hi = await host.wait('init');
    assert.strictEqual(hi.room, 'meine-fabrik');
    assert.strictEqual(hi.host, true);
    assert.ok(Array.isArray(hi.share));

    const guest = await client(srv.port);
    guest.send({ t: 'join', name: 'Gast', code: true });
    const gi = await guest.wait('init');
    assert.strictEqual(gi.room, 'meine-fabrik');
    assert.strictEqual(gi.players.length, 2);

    const info = await (await fetch(`http://127.0.0.1:${srv.port}/info`)).json();
    assert.strictEqual(info.hostWorld, 'meine-fabrik');
    const worlds = await (await fetch(`http://127.0.0.1:${srv.port}/worlds`)).json();
    assert.ok(worlds.some((w) => w.name === 'meine-fabrik' && w.players === 2));
    host.ws.close();
    guest.ws.close();
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
