// Beitritts-Codes für Fabrik-Koop.
// Ein Code ist die Netzwerk-Adresse des Hosts (IP und Port), kurz und lesbar verpackt.
// Im typischen Heim-WLAN (192.168.x.y, Port 3000) hat er nur 5 Zeichen, z. B. "K7Q2M".
// Wird im Browser (window.JoinCode) und in den Tests (require) benutzt.
(function (root) {
  'use strict';

  // 32 Zeichen ohne die leicht verwechselbaren 0, 1, I und O
  const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const PORT = 3000;
  // Länge der Nutzdaten in Byte → Anzahl Zeichen im Code
  const LEN = { 2: 5, 4: 8, 6: 12 };

  function check(bytes) {
    let c = 0x5a ^ bytes.length;
    for (const b of bytes) c = ((c * 31) + b + 7) & 0xff;
    return c;
  }

  function toChars(bytes, n) {
    let v = 0n;
    for (const b of bytes) v = (v << 8n) | BigInt(b);
    let s = '';
    for (let i = 0; i < n; i++) { s = ABC[Number(v & 31n)] + s; v >>= 5n; }
    return s;
  }

  function fromChars(s, nBytes) {
    let v = 0n;
    for (const ch of s) {
      const i = ABC.indexOf(ch);
      if (i < 0) return null;
      v = (v << 5n) | BigInt(i);
    }
    const out = [];
    for (let i = 0; i < nBytes; i++) { out.unshift(Number(v & 255n)); v >>= 8n; }
    return v === 0n ? out : null; // Überzählige Bits müssen leer sein
  }

  function parseAddr(addr) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(String(addr).trim());
    if (!m) return null;
    const ip = m.slice(1, 5).map(Number);
    const port = m[5] ? Number(m[5]) : PORT;
    if (ip.some((n) => n > 255) || port < 1 || port > 65535) return null;
    return { ip, port };
  }

  // "192.168.1.20:3000" → "K7Q2M"
  function encode(addr) {
    const a = parseAddr(addr);
    if (!a) return null;
    let data;
    if (a.port !== PORT) data = [...a.ip, a.port >> 8, a.port & 255];
    else if (a.ip[0] === 192 && a.ip[1] === 168) data = [a.ip[2], a.ip[3]];
    else data = a.ip;
    const bytes = [...data, check(data)];
    return toChars(bytes, LEN[data.length]);
  }

  // "k7q2m" oder "K7Q2-M" → "192.168.1.20:3000", ungültig → null
  function decode(code) {
    const s = String(code || '').toUpperCase().replace(/[\s\-_.]/g, '');
    const len = Object.keys(LEN).find((k) => LEN[k] === s.length);
    if (!len) return null;
    const bytes = fromChars(s, Number(len) + 1);
    if (!bytes) return null;
    const data = bytes.slice(0, -1);
    if (check(data) !== bytes[bytes.length - 1]) return null;
    if (data.length === 2) return `192.168.${data[0]}.${data[1]}:${PORT}`;
    if (data.length === 4) return `${data.join('.')}:${PORT}`;
    return `${data.slice(0, 4).join('.')}:${(data[4] << 8) | data[5]}`;
  }

  // Zum Anzeigen in Vierergruppen: "K7Q2M" bleibt, "AB3DEF7G" → "AB3D-EF7G"
  function pretty(code) {
    if (!code || code.length <= 5) return code;
    return code.match(/.{1,4}/g).join('-');
  }

  // Heim-Netzwerke zuerst, damit der angezeigte Code meistens der richtige ist
  function rank(addr) {
    const a = parseAddr(addr);
    if (!a) return 9;
    const [x, y] = a.ip;
    if (x === 192 && y === 168) return 0;
    if (x === 10) return 1;
    if (x === 172 && y >= 16 && y < 32) return 2;
    if (x === 169 && y === 254) return 8; // ohne Router vergebene Notadresse
    return 3;
  }

  function sortAddresses(list) {
    return [...(list || [])].filter(parseAddr).sort((a, b) => rank(a) - rank(b));
  }

  const api = { encode, decode, pretty, sortAddresses };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JoinCode = api;
})(typeof window !== 'undefined' ? window : globalThis);
