// 3D-Darstellung von "Fabrik-Koop" mit Three.js.
// Der Client (client.js) liefert den Spielzustand, dieses Modul zeichnet ihn und
// rechnet Bildschirmpunkte in Weltkoordinaten um (Bauen, Kamera).
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';

const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const ROOF = { bohrer: 0xf6a83b, schmelze: 0xf06a55, presse: 0x5b8ff0, montage: 0x3fc48a, zentrale: 0x9a7cf2 };
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
    const soil = { r: '#c9c58a', b: '#a3c7b4', s: '#dcd895' };
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

  // Rohstoff-Deko als Instanzen: Steine, Kristalle, Sandhügel
  function buildDeposits(world) {
    const kinds = {
      r: { geo: new THREE.DodecahedronGeometry(0.11, 0), mat: mat(0xe8645a, { flatShading: true }), list: [] },
      b: { geo: new THREE.OctahedronGeometry(0.1, 0).scale(0.8, 1.8, 0.8), mat: mat(0x4f9cf0, { flatShading: true }), list: [] },
      s: { geo: new THREE.SphereGeometry(0.15, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.5, 1), mat: mat(0xf2d58a), list: [] },
    };
    for (let y = 0; y < world.h; y++) {
      for (let x = 0; x < world.w; x++) {
        const k = kinds[world.tiles[y * world.w + x]];
        if (!k) continue;
        const n = 2 + Math.floor(hash(x, y, 6) * 2);
        for (let i = 0; i < n; i++) k.list.push([x + 0.2 + hash(x, y, 10 + i) * 0.6, y + 0.2 + hash(x, y, 20 + i) * 0.6, 0.7 + hash(x, y, 30 + i) * 0.7, hash(x, y, 40 + i) * 6]);
      }
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (const [t, k] of Object.entries(kinds)) {
      const inst = new THREE.InstancedMesh(k.geo, k.mat, k.list.length);
      k.list.forEach(([x, z, s, r], i) => {
        q.setFromEuler(new THREE.Euler(t === 'r' ? r : 0, r, t === 'b' ? (r - 3) * 0.08 : 0));
        m4.compose(new THREE.Vector3(x, t === 'b' ? 0.1 * s : t === 'r' ? 0.07 * s : 0, z), q, new THREE.Vector3(s, s, s));
        inst.setMatrixAt(i, m4);
      });
      inst.castShadow = true;
      inst.receiveShadow = true;
      worldGroup.add(inst);
    }
  }

  // --- Gebäude ---
  function addCommon(g, kind, ghost) {
    const body = new THREE.Mesh(G.body, ghost || M.cream);
    body.position.y = 0.18;
    const roof = new THREE.Mesh(G.roof, ghost || M.roof[kind]);
    roof.position.y = 0.38;
    const tab = new THREE.Mesh(G.tab, ghost || M.grey);
    tab.position.set(0.42, 0.06, 0);
    const arrow = new THREE.Mesh(G.arrow, ghost || M.dark);
    arrow.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
    arrow.position.set(0.46, 0.13, 0);
    g.add(body, roof, tab, arrow);
  }

  function makeBuilding(kind, ghost) {
    const g = new THREE.Group();
    g.userData.kind = kind;
    const m = (geo, material) => new THREE.Mesh(geo, ghost || material);
    if (kind === 'band') {
      const f = m(G.beltFrame, M.grey); f.position.y = 0.05;
      const t = m(G.beltTop, beltMat); t.position.y = BELT_TOP;
      g.add(f, t);
    } else if (kind === 'zentrale') {
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
    } else {
      addCommon(g, kind, ghost);
      if (kind === 'bohrer') {
        const rotor = new THREE.Group();
        rotor.position.y = 0.5;
        for (let i = 0; i < 3; i++) {
          const b = m(G.blade, M.white);
          b.position.x = 0.13;
          const arm = new THREE.Group();
          arm.rotation.y = (i * Math.PI * 2) / 3;
          arm.add(b);
          rotor.add(arm);
        }
        rotor.add(m(G.hubCyl, M.roof.bohrer));
        g.add(rotor);
        g.userData.rotor = rotor;
      } else if (kind === 'schmelze') {
        const ch = m(G.chimney, M.creamDark); ch.position.set(-0.2, 0.58, -0.2);
        const fl = m(G.flame, ghost || M.flame); fl.position.set(0.05, 0.56, 0.05);
        g.add(ch, fl);
        g.userData.flame = fl;
      } else if (kind === 'presse') {
        for (const z of [-0.17, 0.17]) { const p = m(G.pillar, M.white); p.position.set(0, 0.6, z); g.add(p); }
        const plate = m(G.plate, M.white); plate.position.y = 0.72;
        const anvil = m(G.plate, M.creamDark); anvil.position.y = 0.47;
        g.add(plate, anvil);
        g.userData.plate = plate;
      } else if (kind === 'montage') {
        const gear = m(G.gear, M.white); gear.position.y = 0.45;
        const gear2 = m(G.gear, M.creamDark); gear2.position.set(-0.2, 0.47, -0.2); gear2.scale.setScalar(0.6);
        g.add(gear, gear2);
        g.userData.gear = gear;
        g.userData.gear2 = gear2;
      }
    }
    g.traverse((o) => { if (o.isMesh && !ghost) { o.castShadow = o.receiveShadow = true; } });
    return g;
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
  };
  const ITEM_LIFT = { rock: 0.1, dust: 0, bar: 0.05, pane: 0.02, gear: 0, coil: 0.09, box: 0.08, bulb: 0.11, bot: 0.12 };
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
      if (u.rotor && busyItem) u.rotor.rotation.y += dtSec * 8;
      if (u.flame) { const f = busyItem ? 1 + Math.sin(t * 16 + id) * 0.18 : 0.35; u.flame.scale.set(f, f, f); }
      if (u.plate) u.plate.position.y = busyItem ? 0.6 + Math.abs(Math.sin(t * 6 + id)) * 0.12 : 0.72;
      if (u.gear && busyItem) { u.gear.rotation.y += dtSec * 2; u.gear2.rotation.y -= dtSec * 3.3; }
    }

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
      v.set(g.position.x, 1.0 + Math.sin(t * 3 + id) * 0.06, g.position.z);
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

  return { view, setWorld, render, pick, panStart, panMove, zoomAt, rotateBy, pinchStart, pinchMove, moveBy, resize };
}

window.Render3D = { create };
