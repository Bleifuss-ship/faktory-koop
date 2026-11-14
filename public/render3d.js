// 3D-Darstellung von "Fabrik-Koop" mit Three.js.
// Der Client (client.js) liefert den Spielzustand, dieses Modul zeichnet ihn und
// rechnet Bildschirmpunkte in Weltkoordinaten um (Bauen, Kamera).
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const ROOF = { bohrer: 0xf6a83b, saege: 0xc98a4b, schmelze: 0xf06a55, verteiler: 0x8a94a8, presse: 0x5b8ff0, hochofen: 0xd94f6b, werkbank: 0x3fc48a, fabrikator: 0x22b8c8, zentrale: 0x9a7cf2 };
const BELT_TOP = 0.11;

function hash(x, y, k = 0) {
  let h = (x * 374761393 + y * 668265263 + k * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function create(canvas) {
  const mobile = Math.min(innerWidth, innerHeight) < 700 || /Android|iPhone|iPad/i.test(navigator.userAgent);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile || devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, mobile ? 1.5 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7cc8e8);
  scene.fog = new THREE.Fog(0x7cc8e8, 60, 140);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
  const view = { az: 0.35, azTarget: 0.35, el: 0.95, dist: 22, cam: { x: 0, y: 0 } };

  // Licht: weicher Himmel + Sonne mit Schatten
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9fcf7a, 1.25));
  const sun = new THREE.DirectionalLight(0xfff4e0, 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  // --- Materialien (geteilt, damit es auf dem Handy flüssig bleibt) ---
  const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
  const M = {
    cream: mat(0xfbf8f1),
    creamDark: mat(0xd9d4c8),
    grey: mat(0xc7cbd6),
    dark: mat(0x596173),
    white: mat(0xffffff),
    wood: mat(0xa0703c),
    flame: mat(0xffb030, { emissive: 0xff7a10, emissiveIntensity: 0.9 }),
    roof: Object.fromEntries(Object.entries(ROOF).map(([k, c]) => [k, mat(c)])),
    ghost: new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    ghostBad: new THREE.MeshLambertMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.55, depthWrite: false }),
  };

  // --- Geometrien ---
  const G = {
    body: new RoundedBoxGeometry(0.84, 0.36, 0.84, 2, 0.12),
    roof: new RoundedBoxGeometry(0.68, 0.12, 0.68, 2, 0.05),
    tab: new THREE.BoxGeometry(0.18, 0.12, 0.34),
    arrow: new THREE.ConeGeometry(0.07, 0.14, 3),
    blade: new RoundedBoxGeometry(0.3, 0.05, 0.1, 1, 0.02),
    hubCyl: new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10),
    chimney: new THREE.CylinderGeometry(0.07, 0.08, 0.32, 10),
    flame: new THREE.ConeGeometry(0.1, 0.24, 8),
    pillar: new THREE.BoxGeometry(0.07, 0.34, 0.07),
    plate: new RoundedBoxGeometry(0.42, 0.07, 0.3, 1, 0.02),
    gear: makeGearGeometry(),
    beltFrame: new THREE.BoxGeometry(1, 0.1, 0.78),
    beltTop: new THREE.PlaneGeometry(1, 0.58).rotateX(-Math.PI / 2),
    cursor: new THREE.ConeGeometry(0.16, 0.36, 4).rotateX(Math.PI),
    hover: new THREE.PlaneGeometry(0.94, 0.94).rotateX(-Math.PI / 2),
  };

  function makeGearGeometry() {
    const s = new THREE.Shape();
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 ? 0.14 : 0.2;
      const p = [Math.cos(a) * r, Math.sin(a) * r];
      if (i === 0) s.moveTo(...p); else s.lineTo(...p);
    }
    s.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.06, 0, Math.PI * 2, true);
    s.holes.push(hole);
    return new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: false }).rotateX(-Math.PI / 2);
  }

  // --- Wasser, Strand und Insel ---
  const waveTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#7cc8e8';
    x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(255,255,255,0.55)';
    x.lineWidth = 3;
    x.lineCap = 'round';
    for (const [px, py] of [[30, 30], [94, 62], [40, 100]]) {
      x.beginPath();
      x.moveTo(px - 12, py); x.quadraticCurveTo(px - 6, py - 6, px, py); x.quadraticCurveTo(px + 6, py - 6, px + 12, py);
      x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(60, 60);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const water = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: waveTex }));
  water.position.y = -0.32;
  scene.add(water);

  let island = null;
  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  function groundTexture(world) {
    const S = mobile ? 16 : 24;
    const c = document.createElement('canvas');
    c.width = world.w * S;
    c.height = world.h * S;
    const g = c.getContext('2d');
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const n = (Math.sin(x * 0.35) + Math.cos(y * 0.29) + Math.sin((x + y) * 0.17)) / 6 + hash(x, y) * 0.08;
        g.fillStyle = `hsl(${96 + n * 12}, 50%, ${60 + n * 10}%)`;
        g.fillRect(x * S, y * S, S, S);
      }
    }
    const soil = { h: '#86b860', t: '#c4c8b8', e: '#c4ae9e', k: '#c8cf9a', c: '#9a9a8a', w: '#b4b0c8' };
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const t = world.tiles[y * world.w + x];
        if (soil[t]) {
          g.fillStyle = soil[t];
          g.beginPath();
          g.ellipse(x * S + S / 2, y * S + S / 2, S * 0.74, S * 0.7, hash(x, y, 5) * 3, 0, Math.PI * 2);
          g.fill();
        } else if (hash(x, y, 1) < 0.3) {
          const px = x * S + S * 0.2 + hash(x, y, 2) * S * 0.6;
          const py = y * S + S * 0.2 + hash(x, y, 3) * S * 0.6;
          g.strokeStyle = 'rgba(70,130,50,0.45)';
          g.lineWidth = S / 16;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(px - S * 0.09, py + S * 0.09); g.lineTo(px - S * 0.12, py - S * 0.06);
          g.moveTo(px, py + S * 0.09); g.lineTo(px, py - S * 0.12);
          g.moveTo(px + S * 0.09, py + S * 0.09); g.lineTo(px + S * 0.12, py - S * 0.06);
          g.stroke();
        } else if (hash(x, y, 1) < 0.35) {
          g.fillStyle = ['#ffffff', '#ffe066', '#ffb3c7'][Math.floor(hash(x, y, 4) * 3)];
          g.beginPath();
          g.arc(x * S + S / 2, y * S + S / 2, S * 0.09, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // feines Raster
    g.strokeStyle = 'rgba(255,255,255,0.13)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 1; i < world.w; i++) { g.moveTo(i * S + 0.5, 0); g.lineTo(i * S + 0.5, c.height); }
    for (let i = 1; i < world.h; i++) { g.moveTo(0, i * S + 0.5); g.lineTo(c.width, i * S + 0.5); }
    g.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  // Rohstoff-Deko als Instanzen: Bäume, Steine, Erzbrocken, Kristalle.
  // Unter Gebäuden wird die Deko ausgeblendet (Skalierung 0).
  const depositSets = [];
  function buildDeposits(world) {
    depositSets.length = 0;
    const rock = new THREE.DodecahedronGeometry(0.11, 0);
    const kinds = {
      h: { parts: [
        { geo: new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6).translate(0, 0.15, 0), mat: mat(0x8a5a32) },
        { geo: new THREE.ConeGeometry(0.24, 0.5, 7).translate(0, 0.5, 0), mat: mat(0x4f9a4a, { flatShading: true }) },
        { geo: new THREE.ConeGeometry(0.17, 0.36, 7).translate(0, 0.74, 0), mat: mat(0x63b45a, { flatShading: true }) },
      ], per: 1, y: 0, scale: [0.8, 1.25] },
      t: { parts: [{ geo: rock, mat: mat(0xa4aab4, { flatShading: true }) }], per: 3, y: 0.07, scale: [0.8, 1.6] },
      e: { parts: [{ geo: rock, mat: mat(0x9a5a4e, { flatShading: true }) }], per: 3, y: 0.07, scale: [0.7, 1.4] },
      k: { parts: [{ geo: rock, mat: mat(0xf0943c, { flatShading: true }) }, { geo: new THREE.OctahedronGeometry(0.05, 0).translate(0.04, 0.12, 0.02), mat: mat(0x5fd0b8, { flatShading: true }) }], per: 3, y: 0.07, scale: [0.7, 1.4] },
      c: { parts: [{ geo: new THREE.DodecahedronGeometry(0.12, 0), mat: mat(0x34373f, { flatShading: true }) }], per: 3, y: 0.07, scale: [0.7, 1.4] },
      w: { parts: [{ geo: new THREE.OctahedronGeometry(0.1, 0).scale(0.8, 1.8, 0.8), mat: mat(0x8a7fb0, { flatShading: true }) }], per: 2, y: 0.12, scale: [0.8, 1.5] },
    };
    for (const [t, k] of Object.entries(kinds)) {
      const list = [];
      for (let y = 0; y < world.h; y++) {
        for (let x = 0; x < world.w; x++) {
          if (world.tiles[y * world.w + x] !== t) continue;
          const n = k.per === 1 ? 1 : k.per - 1 + Math.floor(hash(x, y, 6) * 2);
          for (let i = 0; i < n; i++) {
            const sc = k.scale[0] + hash(x, y, 30 + i) * (k.scale[1] - k.scale[0]);
            const jitter = k.per === 1 ? 0.25 : 0.6;
            list.push({ tx: x, ty: y, x: x + 0.5 + (hash(x, y, 10 + i) - 0.5) * jitter, z: y + 0.5 + (hash(x, y, 20 + i) - 0.5) * jitter, s: sc, r: hash(x, y, 40 + i) * 6 });
          }
        }
      }
      const meshes = k.parts.map((part) => {
        const inst = new THREE.InstancedMesh(part.geo, part.mat, Math.max(1, list.length));
        inst.count = list.length;
        inst.castShadow = true;
        inst.receiveShadow = true;
        worldGroup.add(inst);
        return inst;
      });
      depositSets.push({ t, k, list, meshes });
    }
    updateDeposits(world);
  }

  function updateDeposits(world) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (const { t, k, list, meshes } of depositSets) {
      list.forEach((d, i) => {
        const hidden = world.grid.has(d.tx + ',' + d.ty);
        e.set(t === 'h' ? 0 : d.r, d.r, t === 'w' ? (d.r - 3) * 0.08 : 0);
        q.setFromEuler(e);
        pos.set(d.x, t === 'h' ? 0 : k.y * d.s, d.z);
        sc.setScalar(hidden ? 0 : d.s);
        m4.compose(pos, q, sc);
        for (const inst of meshes) inst.setMatrixAt(i, m4);
      });
      for (const inst of meshes) inst.instanceMatrix.needsUpdate = true;
    }
  }

  // --- Gebäude ---
  // Kleine Canvas-Texturen für Ziegel, Holz und Warnstreifen
  function canvasTex(w, h, draw, rx = 1, ry = 1) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const brickTex = (base, mortar, rx, ry) => canvasTex(128, 128, (x, w, h) => {
    x.fillStyle = mortar; x.fillRect(0, 0, w, h);
    const bh = 16, bw = 32;
    for (let row = 0; row < h / bh; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let col = -1; col < w / bw + 1; col++) {
        const shade = (Math.sin(row * 7.1 + col * 3.7) + 1) * 8;
        x.fillStyle = base.replace('L', 40 + shade);
        x.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
      }
    }
  }, rx, ry);
  const woodTex = canvasTex(64, 64, (x, w, h) => {
    x.fillStyle = '#c99a5c'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      x.fillStyle = i % 2 ? '#d6a868' : '#c08e52';
      x.fillRect(0, i * 16 + 1, w, 14);
      x.strokeStyle = 'rgba(110,70,30,0.35)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(0, i * 16 + 8 + Math.sin(i) * 3); x.bezierCurveTo(20, i * 16 + 4, 40, i * 16 + 12, 64, i * 16 + 7); x.stroke();
    }
  });
  const stripeTex = canvasTex(64, 16, (x, w, h) => {
    x.fillStyle = '#ffd23f'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#2b2f3a';
    for (let i = -1; i < 5; i++) { x.beginPath(); x.moveTo(i * 16, h); x.lineTo(i * 16 + 8, h); x.lineTo(i * 16 + 16, 0); x.lineTo(i * 16 + 8, 0); x.closePath(); x.fill(); }
  }, 2, 1);

  const BM = {
    plinth: mat(0xe9e4d8),
    brickRed: mat(0xffffff, { map: brickTex('hsl(10, 55%, L%)', '#d8cfc0', 2, 1) }),
    brickDark: mat(0xffffff, { map: brickTex('hsl(8, 45%, L%)', '#a89c8c', 3, 2) }),
    stone: mat(0xffffff, { map: brickTex('hsl(30, 8%, L%)', '#cfc8bc', 2, 1) }),
    wood: mat(0xffffff, { map: woodTex }),
    bark: mat(0x7a5230),
    logEnd: mat(0xe8c48a),
    metal: mat(0xb8bfcc),
    darkMetal: mat(0x4a5060),
    steel: new THREE.MeshPhongMaterial({ color: 0xdfe4ec, shininess: 80, specular: 0x888888 }),
    stripes: mat(0xffffff, { map: stripeTex }),
    ember: new THREE.MeshBasicMaterial({ color: 0xffa040 }),
    glass: new THREE.MeshPhongMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, shininess: 100, depthWrite: false }),
    lampGreen: new THREE.MeshBasicMaterial({ color: 0x5cff8a }),
    coal: mat(0x2c2e35, { flatShading: true }),
  };
  const BG = {
    plinth: new RoundedBoxGeometry(0.92, 0.08, 0.92, 2, 0.04).translate(0, 0.04, 0),
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    sphere: new THREE.SphereGeometry(0.5, 16, 10),
    dome: new THREE.SphereGeometry(0.5, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    cone: new THREE.ConeGeometry(0.5, 1, 16),
    ring4: new THREE.TorusGeometry(0.5, 0.025, 4, 4),
    band: new THREE.TorusGeometry(0.5, 0.04, 6, 24),
    sawBlade: (() => {
      const s = new THREE.Shape();
      const teeth = 24;
      for (let i = 0; i < teeth; i++) {
        const a0 = (i / teeth) * Math.PI * 2;
        const a1 = ((i + 0.6) / teeth) * Math.PI * 2;
        const p0 = [Math.cos(a0) * 0.22, Math.sin(a0) * 0.22];
        if (i === 0) s.moveTo(...p0); else s.lineTo(...p0);
        s.lineTo(Math.cos(a1) * 0.27, Math.sin(a1) * 0.27);
      }
      s.closePath();
      const hole = new THREE.Path(); hole.absarc(0, 0, 0.04, 0, Math.PI * 2, true); s.holes.push(hole);
      return new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }).translate(0, 0, -0.01);
    })(),
  };

  // Hilfsfunktion: Teil mit Größe/Position/Drehung anlegen
  function part(g, geo, material, [sx, sy, sz], [px, py, pz], rot) {
    const mesh = new THREE.Mesh(geo, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(px, py, pz);
    if (rot) mesh.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
    g.add(mesh);
    return mesh;
  }
  // Schräge Strebe von a nach b
  function strut(g, material, a, b, thick) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const mesh = new THREE.Mesh(BG.box, material);
    mesh.scale.set(thick, len, thick);
    mesh.position.copy(va).add(vb).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    g.add(mesh);
    return mesh;
  }
  function addOutput(g, ghost, z = 0, ang = 0) {
    const pivot = new THREE.Group();
    pivot.rotation.y = ang;
    const tab = new THREE.Mesh(G.tab, ghost || M.grey);
    tab.position.set(0.43, 0.06, z);
    const arrow = new THREE.Mesh(G.arrow, ghost || M.dark);
    arrow.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    arrow.position.set(0.47, 0.13, z);
    pivot.add(tab, arrow);
    g.add(pivot);
  }

  function makeBuilding(kind, ghost) {
    const g = new THREE.Group();
    g.userData.kind = kind;
    // Im Vorschau-Modus bekommen alle Teile dasselbe halbdurchsichtige Material
    const X = ghost ? new Proxy({}, { get: () => ghost }) : BM;
    const R = ghost ? new Proxy({}, { get: () => ghost }) : M.roof;
    const m = (geo, material) => new THREE.Mesh(geo, ghost || material);
    if (kind === 'band') {
      const f = m(G.beltFrame, M.grey); f.position.y = 0.05;
      const t = m(G.beltTop, beltMat); t.position.y = BELT_TOP;
      g.add(f, t);
      return g;
    }
    if (kind === 'zentrale') {
      const base = m(new RoundedBoxGeometry(2.7, 0.5, 2.7, 3, 0.25), M.cream);
      base.position.y = 0.25;
      const roof = m(new RoundedBoxGeometry(2.4, 0.16, 2.4, 2, 0.1), M.roof.zentrale);
      roof.position.y = 0.55;
      const tower = m(new THREE.CylinderGeometry(0.42, 0.55, 0.7, 20), M.cream);
      tower.position.y = 0.95;
      const cap = m(new THREE.CylinderGeometry(0.46, 0.46, 0.12, 20), M.roof.zentrale);
      cap.position.y = 1.32;
      const ring = m(new THREE.TorusGeometry(0.85, 0.06, 8, 40), M.white);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.72;
      const gem = m(new THREE.OctahedronGeometry(0.28, 0), M.roof.zentrale);
      gem.position.y = 1.75;
      g.add(base, roof, tower, cap, ring, gem);
      if (!ghost) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.36), new THREE.MeshBasicMaterial({ map: labelTexture('ZENTRALE', '#9a7cf2', '#ffffff'), transparent: true }));
        sign.position.set(0, 0.3, 1.36);
        g.add(sign);
      }
      g.userData.ring = ring;
      g.userData.gem = gem;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
      g.position.set(1.5, 0, 1.5);
      const wrap = new THREE.Group();
      wrap.add(g);
      wrap.userData = g.userData;
      return wrap;
    }

    part(g, BG.plinth, X.plinth, [1, 1, 1], [0, 0, 0]);
    addOutput(g, ghost);

    if (kind === 'bohrer') {
      // Bohrturm: vier schräge Stützen, Querringe, Bohrstange mit Spitze, Motor
      const orange = R.bohrer;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) strut(g, orange, [sx * 0.33, 0.08, sz * 0.33], [sx * 0.09, 1.02, sz * 0.09], 0.05);
      part(g, BG.ring4, orange, [0.62, 0.62, 0.62], [0, 0.38, 0], [Math.PI / 2, 0, Math.PI / 4]);
      part(g, BG.ring4, orange, [0.38, 0.38, 0.38], [0, 0.72, 0], [Math.PI / 2, 0, Math.PI / 4]);
      part(g, BG.box, X.darkMetal, [0.26, 0.08, 0.26], [0, 1.06, 0]);
      part(g, BG.box, X.stripes, [0.27, 0.04, 0.27], [0, 1.0, 0]);
      const shaft = new THREE.Group();
      part(shaft, BG.cyl8, X.steel, [0.07, 0.95, 0.07], [0, 0.55, 0]);
      for (const y of [0.3, 0.55, 0.8]) part(shaft, BG.cyl8, X.darkMetal, [0.11, 0.03, 0.11], [0, y, 0]);
      part(shaft, BG.cone, X.steel, [0.12, 0.16, 0.12], [0, 0.07, 0], [Math.PI, 0, 0]);
      g.add(shaft);
      g.userData.drill = shaft;
      part(g, BG.box, X.darkMetal, [0.2, 0.18, 0.18], [-0.28, 0.17, 0.26]);
      part(g, BG.box, orange, [0.21, 0.05, 0.19], [-0.28, 0.22, 0.26]);
    } else if (kind === 'saege') {
      // Sägewerk: Holztisch, großes Sägeblatt, Baumstamm, Sägemehl
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, BG.box, X.wood, [0.06, 0.3, 0.06], [sx * 0.34, 0.23, sz * 0.2]);
      part(g, BG.box, X.wood, [0.82, 0.07, 0.5], [0, 0.4, 0]);
      part(g, BG.box, X.darkMetal, [0.2, 0.2, 0.16], [0.05, 0.2, 0]);
      const blade = new THREE.Mesh(BG.sawBlade, X.steel);
      blade.position.set(0.08, 0.42, 0);
      g.add(blade);
      part(g, BG.cyl, R.saege, [0.07, 0.04, 0.07], [0.08, 0.42, 0.02], [Math.PI / 2, 0, 0]);
      g.userData.saw = blade;
      const log = new THREE.Group();
      part(log, BG.cyl8, X.bark, [0.17, 0.42, 0.17], [0, 0, 0], [0, 0, Math.PI / 2]);
      part(log, BG.cyl8, X.logEnd, [0.15, 0.01, 0.15], [-0.215, 0, 0], [0, 0, Math.PI / 2]);
      log.position.set(-0.22, 0.52, 0);
      g.add(log);
      g.userData.log = log;
      part(g, BG.dome, ghost || mat(0xe6c48c), [0.22, 0.1, 0.18], [0.3, 0.08, 0.3]);
      part(g, BG.box, R.saege, [0.84, 0.03, 0.06], [0, 0.45, -0.25]);
    } else if (kind === 'schmelze') {
      // Schmelzofen: Steinsockel mit Kuppel, glühende Öffnung, Schornstein
      part(g, BG.box, X.stone, [0.74, 0.26, 0.74], [0, 0.21, 0]);
      part(g, BG.dome, X.brickRed, [0.7, 0.62, 0.7], [0, 0.34, 0]);
      part(g, BG.box, X.darkMetal, [0.08, 0.22, 0.28], [0.34, 0.32, 0]);
      const ember = part(g, BG.cyl, X.ember, [0.2, 0.02, 0.2], [0.385, 0.33, 0], [0, 0, Math.PI / 2]);
      g.userData.ember = ember;
      part(g, BG.cyl, X.brickRed, [0.14, 0.42, 0.14], [-0.2, 0.75, -0.2]);
      part(g, BG.cyl, X.darkMetal, [0.17, 0.05, 0.17], [-0.2, 0.97, -0.2]);
      g.userData.smoke = new THREE.Vector3(-0.2, 1.02, -0.2);
    } else if (kind === 'hochofen') {
      // Hochofen: hoher Ziegelturm mit Eisenringen, Haube, hoher Schornstein, Kohlebunker
      part(g, new THREE.CylinderGeometry(0.22, 0.29, 0.85, 18), X.brickDark, [1, 1, 1], [0, 0.505, 0]);
      for (const [y, r] of [[0.25, 0.29], [0.55, 0.265], [0.85, 0.235]]) part(g, BG.band, X.darkMetal, [r * 2, r * 2, r * 2], [0, y, 0], [Math.PI / 2, 0, 0]);
      part(g, BG.cone, X.darkMetal, [0.5, 0.18, 0.5], [0, 1.02, 0]);
      part(g, BG.cyl, X.metal, [0.09, 0.4, 0.09], [0, 1.25, 0]);
      part(g, BG.cyl, X.darkMetal, [0.12, 0.04, 0.12], [0, 1.45, 0]);
      part(g, BG.box, X.darkMetal, [0.1, 0.16, 0.18], [0.26, 0.2, 0]);
      const ember = part(g, BG.box, X.ember, [0.02, 0.1, 0.12], [0.315, 0.2, 0]);
      const lava = part(g, BG.box, X.ember, [0.12, 0.02, 0.06], [0.37, 0.1, 0]);
      g.userData.ember = ember;
      g.userData.ember2 = lava;
      part(g, BG.box, X.darkMetal, [0.22, 0.2, 0.22], [-0.27, 0.18, 0.27]);
      for (let i = 0; i < 4; i++) part(g, new THREE.DodecahedronGeometry(0.05, 0), X.coal, [1, 1, 1], [-0.31 + (i % 2) * 0.08, 0.3, 0.23 + Math.floor(i / 2) * 0.08]);
      g.userData.smoke = new THREE.Vector3(0, 1.5, 0);
    } else if (kind === 'presse') {
      // Hydraulikpresse: Amboss, zwei Säulen, Querbalken, Kolben mit Stempel
      part(g, BG.box, X.darkMetal, [0.6, 0.18, 0.5], [0, 0.17, 0]);
      part(g, BG.box, X.stripes, [0.61, 0.05, 0.02], [0, 0.17, 0.26]);
      part(g, BG.box, X.steel, [0.3, 0.05, 0.3], [0, 0.285, 0]);
      for (const z of [-0.24, 0.24]) part(g, BG.box, R.presse, [0.12, 0.8, 0.1], [0, 0.48, z]);
      part(g, BG.box, R.presse, [0.3, 0.14, 0.62], [0, 0.92, 0]);
      part(g, BG.cyl, X.metal, [0.16, 0.2, 0.16], [0, 0.78, 0]);
      const ram = new THREE.Group();
      part(ram, BG.cyl, X.steel, [0.08, 0.3, 0.08], [0, 0.15, 0]);
      part(ram, BG.box, X.darkMetal, [0.32, 0.06, 0.32], [0, 0, 0]);
      ram.position.y = 0.5;
      g.add(ram);
      g.userData.ram = ram;
    } else if (kind === 'werkbank') {
      // Werkbank: Holztisch mit Ablage, Schraubstock, Hammer, Zahnrad, grüne Werkzeugkiste
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, BG.box, X.wood, [0.06, 0.36, 0.06], [sx * 0.36, 0.26, sz * 0.24]);
      part(g, BG.box, X.wood, [0.84, 0.07, 0.6], [0, 0.46, 0]);
      part(g, BG.box, X.wood, [0.76, 0.04, 0.5], [0, 0.18, 0]);
      part(g, BG.box, R.werkbank, [0.3, 0.16, 0.2], [-0.15, 0.28, 0]);
      part(g, BG.box, X.darkMetal, [0.12, 0.03, 0.03], [-0.15, 0.38, 0]);
      part(g, BG.box, X.darkMetal, [0.14, 0.12, 0.12], [-0.28, 0.55, -0.18]);
      part(g, BG.box, X.metal, [0.03, 0.03, 0.2], [-0.28, 0.6, -0.08]);
      const gear = new THREE.Mesh(G.gear, X.metal);
      gear.position.set(0.18, 0.5, 0.12);
      gear.scale.setScalar(0.7);
      g.add(gear);
      g.userData.gear = gear;
      const hammer = new THREE.Group();
      part(hammer, BG.cyl8, X.wood, [0.035, 0.32, 0.035], [0, 0.16, 0]);
      part(hammer, BG.box, X.darkMetal, [0.14, 0.07, 0.07], [0, 0.32, 0]);
      hammer.position.set(0.05, 0.5, -0.16);
      hammer.rotation.z = -1.3;
      g.add(hammer);
      g.userData.hammer = hammer;
    } else if (kind === 'fabrikator') {
      // Fabrikator: türkises Gehäuse, Glaskuppel, Roboterarm, Statuslampen
      part(g, new RoundedBoxGeometry(0.8, 0.36, 0.8, 2, 0.08), R.fabrikator, [1, 1, 1], [0, 0.26, 0]);
      part(g, BG.box, X.plinth, [0.62, 0.03, 0.62], [0, 0.45, 0]);
      part(g, BG.cyl, X.metal, [0.36, 0.03, 0.36], [0.1, 0.47, 0.1]);
      part(g, BG.dome, ghost || BM.glass, [0.4, 0.36, 0.4], [0.1, 0.48, 0.1]);
      for (let i = 0; i < 3; i++) part(g, BG.sphere, i === 0 ? X.lampGreen : X.darkMetal, [0.045, 0.045, 0.045], [0.41, 0.33, -0.16 + i * 0.08]);
      const arm = new THREE.Group();
      arm.position.set(-0.22, 0.47, -0.22);
      part(arm, BG.cyl, X.darkMetal, [0.14, 0.06, 0.14], [0, 0.03, 0]);
      const upper = new THREE.Group();
      upper.position.y = 0.06;
      upper.rotation.z = -0.35;
      part(upper, BG.box, X.plinth, [0.06, 0.32, 0.06], [0, 0.16, 0]);
      const fore = new THREE.Group();
      fore.position.y = 0.32;
      fore.rotation.z = -1.5;
      part(fore, BG.sphere, X.darkMetal, [0.08, 0.08, 0.08], [0, 0, 0]);
      part(fore, BG.box, X.plinth, [0.05, 0.24, 0.05], [0, 0.12, 0]);
      part(fore, BG.box, X.darkMetal, [0.1, 0.03, 0.06], [0, 0.25, 0]);
      upper.add(fore);
      arm.add(upper);
      g.add(arm);
      g.userData.arm = arm;
      g.userData.fore = fore;
    } else if (kind === 'verteiler') {
      // Verteiler: flacher Metallkasten mit Drehscheibe und drei Pfeilen
      part(g, new RoundedBoxGeometry(0.72, 0.18, 0.72, 2, 0.05), X.metal, [1, 1, 1], [0, 0.17, 0]);
      const disc = part(g, BG.cyl, R.verteiler, [0.44, 0.04, 0.44], [0, 0.28, 0]);
      part(g, BG.cyl, X.plinth, [0.14, 0.06, 0.14], [0, 0.3, 0]);
      for (const a of [0, Math.PI / 2, -Math.PI / 2]) {
        const piv = new THREE.Group();
        piv.rotation.y = a;
        const arrow = new THREE.Mesh(G.arrow, ghost || M.white);
        arrow.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
        arrow.position.set(0.2, 0.31, 0);
        piv.add(arrow);
        g.add(piv);
      }
      g.userData.disc = disc;
      addOutput(g, ghost, 0, Math.PI / 2);
      addOutput(g, ghost, 0, -Math.PI / 2);
    }
    g.traverse((o) => { if (o.isMesh && !ghost) { o.castShadow = o.receiveShadow = true; } });
    return g;
  }

  // Rauchwölkchen über arbeitenden Öfen (Instanzen)
  const SMOKE_MAX = 600;
  const smoke = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 1), mat(0xf2f2f2), SMOKE_MAX);
  smoke.count = 0;
  smoke.frustumCulled = false;
  scene.add(smoke);

  // Bilder der Modelle für die Werkzeugleiste
  const iconCache = new Map();
  function icon(kind) {
    if (iconCache.has(kind)) return iconCache.get(kind);
    try {
      if (!icon.r) {
        icon.r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        icon.r.setSize(128, 128, false);
        icon.r.outputColorSpace = THREE.SRGBColorSpace;
        icon.scene = new THREE.Scene();
        icon.scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b8c8, 1.8));
        const d = new THREE.DirectionalLight(0xffffff, 2.2);
        d.position.set(-2, 4, 3);
        icon.scene.add(d);
        icon.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
      }
      const model = makeBuilding(kind);
      if (kind === 'band') model.scale.setScalar(1.1);
      icon.scene.add(model);
      const tall = kind === 'bohrer' || kind === 'hochofen' ? 0.15 : 0;
      icon.cam.position.set(1.55, 1.75 + tall, 2.1);
      icon.cam.lookAt(0, 0.32 + tall, 0);
      icon.r.render(icon.scene, icon.cam);
      const url = icon.r.domElement.toDataURL('image/png');
      icon.scene.remove(model);
      iconCache.set(kind, url);
      return url;
    } catch (err) {
      return null;
    }
  }

  function labelTexture(text, bg, fg) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 102;
    const x = c.getContext('2d');
    x.fillStyle = bg;
    x.beginPath(); x.roundRect(4, 4, 504, 94, 40); x.fill();
    x.fillStyle = fg;
    x.font = '900 60px system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 256, 54);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // Laufband-Textur mit Pfeilen, wird zum Animieren verschoben
  const beltTex = (() => {
    const c = document.createElement('canvas');
    c.width = 96; c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#596173';
    x.fillRect(0, 0, 96, 64);
    x.strokeStyle = '#8b95ac';
    x.lineWidth = 7;
    x.lineCap = x.lineJoin = 'round';
    for (let i = 0; i < 3; i++) {
      const px = 14 + i * 32;
      x.beginPath(); x.moveTo(px, 14); x.lineTo(px + 12, 32); x.lineTo(px, 50); x.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const beltMat = mat(0xffffff, { map: beltTex });

  // Bänder als Instanzen (es können sehr viele werden)
  const MAX_BELTS = 6000;
  const beltFrames = new THREE.InstancedMesh(G.beltFrame, M.grey, MAX_BELTS);
  const beltTops = new THREE.InstancedMesh(G.beltTop, beltMat, MAX_BELTS);
  beltFrames.receiveShadow = beltTops.receiveShadow = true;
  beltFrames.count = beltTops.count = 0;
  scene.add(beltFrames, beltTops);

  // --- Gegenstände als Instanzen je Sorte ---
  const ITEM_GEO = {
    rock: new THREE.DodecahedronGeometry(0.12, 0),
    dust: new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1),
    bar: new RoundedBoxGeometry(0.26, 0.1, 0.14, 1, 0.03),
    pane: new THREE.BoxGeometry(0.24, 0.04, 0.24),
    gear: makeGearGeometry().scale(0.85, 1, 0.85),
    coil: new THREE.CylinderGeometry(0.09, 0.09, 0.2, 12).rotateZ(Math.PI / 2),
    box: new RoundedBoxGeometry(0.24, 0.16, 0.2, 1, 0.04),
    bulb: new THREE.SphereGeometry(0.11, 12, 8),
    bot: new RoundedBoxGeometry(0.18, 0.24, 0.16, 1, 0.05),
    log: new THREE.CylinderGeometry(0.07, 0.07, 0.28, 8).rotateZ(Math.PI / 2),
    crystal: new THREE.OctahedronGeometry(0.1, 0).scale(0.8, 1.5, 0.8),
    plank: new RoundedBoxGeometry(0.3, 0.05, 0.12, 1, 0.015),
    brick: new RoundedBoxGeometry(0.24, 0.1, 0.12, 1, 0.02),
    beam: new THREE.BoxGeometry(0.3, 0.08, 0.08),
    board: new RoundedBoxGeometry(0.24, 0.03, 0.18, 1, 0.01),
    frame: new THREE.TorusGeometry(0.1, 0.03, 4, 4).rotateX(Math.PI / 2).rotateY(Math.PI / 4),
    drill: new THREE.ConeGeometry(0.09, 0.24, 8).rotateX(Math.PI),
    arm: new THREE.BoxGeometry(0.06, 0.06, 0.26),
  };
  const ITEM_LIFT = { rock: 0.1, dust: 0, bar: 0.05, pane: 0.02, gear: 0, coil: 0.09, box: 0.08, bulb: 0.11, bot: 0.12, log: 0.07, crystal: 0.15, plank: 0.03, brick: 0.05, beam: 0.04, board: 0.02, frame: 0.03, drill: 0.12, arm: 0.03 };
  const itemPools = new Map();
  function itemPool(id, defs) {
    if (itemPools.has(id)) return itemPools.get(id);
    const it = defs.ITEMS[id];
    if (!it) return null;
    const geo = ITEM_GEO[it.shape] || ITEM_GEO.rock;
    const material = mat(it.color, it.shape === 'rock' ? { flatShading: true } : it.shape === 'bulb' ? { emissive: it.color, emissiveIntensity: 0.4 } : it.shape === 'pane' ? { transparent: true, opacity: 0.85 } : {});
    const inst = new THREE.InstancedMesh(geo, material, 3000);
    inst.count = 0;
    inst.frustumCulled = false;
    scene.add(inst);
    const pool = { inst, lift: ITEM_LIFT[it.shape] ?? 0.08, n: 0 };
    itemPools.set(id, pool);
    return pool;
  }

  // --- Zustand der Szene ---
  const groups = new Map(); // Gebäude-ID -> Group
  let builtVersion = -1;
  let ghost = null;
  let ghostKey = '';
  const hoverDel = new THREE.Mesh(G.hover, new THREE.MeshBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.45, depthWrite: false }));
  hoverDel.visible = false;
  scene.add(hoverDel);
  const cursors = new Map();

  function setWorld(world) {
    worldGroup.clear();
    for (const g of groups.values()) scene.remove(g);
    groups.clear();
    builtVersion = -1;
    const w = world.w;
    const h = world.h;
    const top = new THREE.MeshLambertMaterial({ map: groundTexture(world) });
    const side = mat(0x8a6a48);
    island = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, h), [side, side, top, side, side, side]);
    island.position.set(w / 2, -0.2, h / 2);
    island.receiveShadow = true;
    const sand = new THREE.Mesh(new RoundedBoxGeometry(w + 1.6, 0.3, h + 1.6, 2, 0.14), mat(0xf1dfa4));
    sand.position.set(w / 2, -0.3, h / 2);
    sand.receiveShadow = true;
    worldGroup.add(island, sand);
    buildDeposits(world);
  }

  function syncBuildings(world) {
    if (world.version === builtVersion) return;
    builtVersion = world.version;
    updateDeposits(world);
    // Maschinen und Zentrale als eigene Objekte
    for (const [id, g] of groups) {
      const b = world.buildings.get(id);
      if (!b || b.dir !== g.userData.dir) { scene.remove(g); groups.delete(id); }
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (const b of world.buildings.values()) {
      if (b.kind === 'band') {
        if (n >= MAX_BELTS) continue;
        q.setFromAxisAngle(up, -b.dir * Math.PI / 2);
        m4.compose(new THREE.Vector3(b.x + 0.5, 0.05, b.y + 0.5), q, one);
        beltFrames.setMatrixAt(n, m4);
        m4.compose(new THREE.Vector3(b.x + 0.5, BELT_TOP, b.y + 0.5), q, one);
        beltTops.setMatrixAt(n, m4);
        n++;
        continue;
      }
      if (groups.has(b.id)) continue;
      const g = makeBuilding(b.kind);
      if (b.kind === 'zentrale') g.position.set(b.x, 0, b.y);
      else { g.position.set(b.x + 0.5, 0, b.y + 0.5); g.rotation.y = -b.dir * Math.PI / 2; }
      g.userData.dir = b.dir;
      scene.add(g);
      groups.set(b.id, g);
    }
    beltFrames.count = beltTops.count = n;
    beltFrames.instanceMatrix.needsUpdate = beltTops.instanceMatrix.needsUpdate = true;
    beltFrames.computeBoundingSphere();
    beltTops.computeBoundingSphere();
  }

  // --- Kamera ---
  function updateCamera() {
    const { az, el, dist, cam } = view;
    camera.position.set(cam.x + Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, cam.y + Math.cos(az) * Math.cos(el) * dist);
    camera.lookAt(cam.x, 0, cam.y);
    // Schattenbereich folgt der Kamera
    const r = Math.min(40, dist * 0.9 + 4);
    sun.position.set(cam.x - 10, 16, cam.y - 7);
    sun.target.position.set(cam.x, 0, cam.y);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.near = 1;
    sc.far = 80;
    sc.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  function pick(sx, sy) {
    updateCamera();
    ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(ground, hit)) return [view.cam.x, view.cam.y];
    return [hit.x, hit.z];
  }

  let panAnchor = null;
  function panStart(sx, sy) { panAnchor = pick(sx, sy); }
  function panMove(sx, sy) {
    if (!panAnchor) return;
    const p = pick(sx, sy);
    view.cam.x += panAnchor[0] - p[0];
    view.cam.y += panAnchor[1] - p[1];
    clampCam();
  }
  function clampCam() {
    if (!island) return;
    const W = island.geometry.parameters.width;
    const H = island.geometry.parameters.depth;
    view.cam.x = Math.max(-2, Math.min(W + 2, view.cam.x));
    view.cam.y = Math.max(-2, Math.min(H + 2, view.cam.y));
  }
  const clampDist = (d) => Math.max(6, Math.min(70, d));
  function zoomAt(factor, sx, sy) {
    const before = pick(sx, sy);
    view.dist = clampDist(view.dist * factor);
    const after = pick(sx, sy);
    view.cam.x += before[0] - after[0];
    view.cam.y += before[1] - after[1];
    clampCam();
  }
  // smooth = true: weich hindrehen (Knopf), sonst sofort (Tasten)
  function rotateBy(a, smooth) { view.azTarget += a; if (!smooth) view.az = view.azTarget; }
  let pinch = null;
  function pinchStart(a, b) {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), dist: view.dist, az: view.az, anchor: pick(mx, my) };
  }
  function pinchMove(a, b) {
    if (!pinch) return;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    view.dist = clampDist(pinch.dist * (pinch.d / Math.max(10, d)));
    view.az = view.azTarget = pinch.az - (ang - pinch.ang);
    const p = pick((a.x + b.x) / 2, (a.y + b.y) / 2);
    view.cam.x += pinch.anchor[0] - p[0];
    view.cam.y += pinch.anchor[1] - p[1];
    clampCam();
  }
  // Kamera relativ zur Blickrichtung bewegen (Tastatur)
  function moveBy(right, forward) {
    const s = view.dist * 0.02;
    const fx = -Math.sin(view.az);
    const fz = -Math.cos(view.az);
    view.cam.x += (fx * forward - fz * right) * s;
    view.cam.y += (fz * forward + fx * right) * s;
    clampCam();
  }

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  // --- Mitspieler-Zeiger ---
  function cursorFor(p) {
    let c = cursors.get(p.id);
    if (c) return c;
    c = new THREE.Group();
    const cone = new THREE.Mesh(G.cursor, mat(p.color));
    cone.position.y = 0.5;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(p.name, p.color, '#ffffff'), depthTest: false }));
    label.scale.set(1.4, 0.28, 1);
    label.position.y = 1.0;
    label.renderOrder = 10;
    c.add(cone, label);
    scene.add(c);
    cursors.set(p.id, c);
    return c;
  }

  // --- Zeichnen ---
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let lastT = performance.now();

  function render(s) {
    const now = performance.now();
    const dtSec = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    const t = now / 1000;
    syncBuildings(s.world);
    view.az += (view.azTarget - view.az) * Math.min(1, dtSec * 8);
    updateCamera();

    // Wasser und Bänder animieren
    waveTex.offset.x = t * 0.01;
    waveTex.offset.y = Math.sin(t * 0.3) * 0.01;
    beltTex.offset.x -= s.beltSpeed * 10 * dtSec;

    // Maschinen animieren
    for (const [id, g] of groups) {
      const busyItem = s.busy.get(id);
      const u = g.userData;
      if (u.ring) { u.ring.rotation.z = t * 0.6; u.gem.rotation.y = t; u.gem.position.y = 1.75 + Math.sin(t * 2) * 0.08; }
      if (u.drill) { if (busyItem) u.drill.rotation.y += dtSec * 10; u.drill.position.y = busyItem ? Math.sin(t * 5 + id) * 0.03 - 0.02 : 0; }
      if (u.saw && busyItem) u.saw.rotation.z -= dtSec * 14;
      if (u.log) u.log.position.x = busyItem ? -0.22 + ((t * 0.3 + id * 0.1) % 1) * 0.12 : -0.22;
      if (u.ember) {
        // Glut leuchtet nur, wenn der Ofen arbeitet
        u.ember.material = busyItem ? BM.ember : BM.darkMetal;
        if (u.ember2) u.ember2.visible = !!busyItem;
      }
      if (u.ram) u.ram.position.y = busyItem ? 0.34 + Math.abs(Math.cos(t * 5 + id)) * 0.22 : 0.5;
      if (u.hammer) u.hammer.rotation.z = busyItem ? -1.3 + Math.max(0, Math.sin(t * 7 + id)) * 0.9 : -1.3;
      if (u.gear && busyItem) u.gear.rotation.y += dtSec * 1.5;
      if (u.arm) { u.arm.rotation.y = busyItem ? Math.sin(t * 2 + id) * 1.4 : 0.6; u.fore.rotation.z = busyItem ? -1.5 + Math.sin(t * 4 + id) * 0.4 : -1.5; }
      if (u.disc) u.disc.rotation.y += dtSec * 1.5;
    }

    // Rauch über arbeitenden Öfen
    let sn = 0;
    const sp = new THREE.Vector3();
    for (const [id, g] of groups) {
      const u = g.userData;
      if (!u.smoke || !s.busy.get(id) || sn > SMOKE_MAX - 4) continue;
      sp.copy(u.smoke);
      g.localToWorld(sp);
      for (let i = 0; i < 4; i++) {
        const ph = (t * 0.45 + i / 4 + id * 0.37) % 1;
        const size = (0.6 + ph * 1.6) * (1 - ph * ph) * (u.kind === 'hochofen' ? 1.3 : 1);
        q.identity();
        v.set(sp.x + Math.sin(ph * 4 + id) * 0.08 + ph * 0.15, sp.y + ph * 0.9, sp.z - ph * 0.1);
        sc.setScalar(Math.max(0.001, size));
        m4.compose(v, q, sc);
        smoke.setMatrixAt(sn++, m4);
      }
    }
    smoke.count = sn;
    smoke.instanceMatrix.needsUpdate = true;

    // Gegenstände auf Bändern und schwebende Produkte über Maschinen
    for (const p of itemPools.values()) p.n = 0;
    const dt = Math.min(1, (now - s.lastTickAt) / 100);
    const items = s.items;
    for (let i = 0; i < items.length; i += 4) {
      const pool = itemPool(items[i + 2], s.defs);
      if (!pool || pool.n >= 3000) continue;
      const x = items[i];
      const y = items[i + 1];
      const b = s.world.grid.get(x + ',' + y);
      const d = b ? b.dir : 0;
      const p = Math.min(1, items[i + 3] + (items[i + 3] < 1 ? s.beltSpeed * dt : 0));
      const [dx, dy] = DIRS[d];
      q.setFromAxisAngle(up, -d * Math.PI / 2);
      v.set(x + 0.5 + dx * (p - 0.5), BELT_TOP + pool.lift, y + 0.5 + dy * (p - 0.5));
      sc.set(1, 1, 1);
      m4.compose(v, q, sc);
      pool.inst.setMatrixAt(pool.n++, m4);
    }
    for (const [id, g] of groups) {
      const it = s.busy.get(id);
      if (!it || g.userData.kind === 'zentrale') continue;
      const pool = itemPool(it, s.defs);
      if (!pool || pool.n >= 3000) continue;
      q.setFromAxisAngle(up, t * 1.5 + id);
      v.set(g.position.x, (g.userData.kind === 'bohrer' || g.userData.kind === 'hochofen' ? 1.75 : 1.15) + Math.sin(t * 3 + id) * 0.06, g.position.z);
      sc.set(1.3, 1.3, 1.3);
      m4.compose(v, q, sc);
      pool.inst.setMatrixAt(pool.n++, m4);
    }
    for (const p of itemPools.values()) { p.inst.count = p.n; p.inst.instanceMatrix.needsUpdate = true; }

    // Vorschau beim Bauen
    hoverDel.visible = false;
    const key = s.tool + ':' + (s.hover ? s.canPlace(s.tool, s.hover.x, s.hover.y) : '');
    if (s.hover && s.tool === 'delete') {
      hoverDel.visible = true;
      hoverDel.position.set(s.hover.x + 0.5, 0.2, s.hover.y + 0.5);
    }
    const wantGhost = s.hover && s.tool !== 'hand' && s.tool !== 'delete';
    if (!wantGhost || key !== ghostKey) {
      if (ghost) { scene.remove(ghost); ghost = null; }
      ghostKey = '';
    }
    if (wantGhost) {
      if (!ghost) {
        ghost = makeBuilding(s.tool, s.canPlace(s.tool, s.hover.x, s.hover.y) ? M.ghost : M.ghostBad);
        ghost.traverse((o) => { o.renderOrder = 5; });
        ghostKey = key;
        scene.add(ghost);
      }
      ghost.position.set(s.hover.x + 0.5, 0.01, s.hover.y + 0.5);
      ghost.rotation.y = -s.dir * Math.PI / 2;
    }

    // Zeiger der Mitspieler
    const seen = new Set();
    for (const [id, c] of s.cursors) {
      const p = s.players.find((pl) => pl.id === id);
      if (!p) continue;
      const g = cursorFor(p);
      g.position.set(c.x, Math.sin(t * 3 + id) * 0.08, c.y);
      g.children[0].rotation.y = t * 2;
      seen.add(id);
    }
    for (const [id, g] of cursors) if (!seen.has(id)) { scene.remove(g); cursors.delete(id); }

    renderer.render(scene, camera);
  }

  return { view, icon, setWorld, render, pick, panStart, panMove, zoomAt, rotateBy, pinchStart, pinchMove, moveBy, resize };
}

window.Render3D = { create };
