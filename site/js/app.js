/* Ortskarte in 3D - Hauptprogramm. Ortsangaben kommen aus data/ort.js (window.ORT, erzeugt aus ort.json).
   Abhaengigkeiten: three.js r149 (classic), util.js, data/meta.js, data/addr.js, events.js.
   Kacheln (data/t_i_j.js) und Luftbilder (img/p_i_j.jpg, img/d_i_j.jpg) werden bei Bedarf nachgeladen. */
(function () {
  'use strict';
  const THREE = window.THREE, AL = window.AL, M = window.AL_META, A = window.AL_ADDR, EVENTS = (window.AL_EVENTS || []).concat((window.AL_EVENTS_AUTO || {}).items || []);
  const LAT = M.origin.lat, LON = M.origin.lon, rad = AL.rad;
  const C = M.cell, X0 = M.x0, Z0 = M.z0, W = M.nx * C, H = M.nz * C, CX = X0 + W / 2, CZ = Z0 + H / 2;
  const ORT = window.ORT || {}, ORT_NAME = ORT.name || 'Ort', NB_NAME = ORT.nb || 'Nachbarort', ART = ORT.art || 'Gemeinde';
  const BETR = ORT.betreiberKurz || 'Fahrplan'; // Kurzname des Fahrplan-Betreibers (ort.json)
  const ORTSTEILE_SEITE = ORT.ortsteileSeite || ''; // optional: Seite mit Ortsporträts der Gemeinde (ort.json), leer = keine
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const col = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const OT = M.ortsteile, STREETS = A.streets, ROWS = A.rows;
  const otName = (o) => (o >= 0 && OT[o] ? OT[o].n : '');
  const whereOf = (p) => (p.nb ? NB_NAME : otName(p.o)); // Orte und Haltestellen des Nachbarorts tragen nb

  // ------------------------------------------------------------------ Zustand
  const S = {
    dirty: true, moved: true, colorMode: 'nutzung', sel: null, pending: null, panel: null,
    L: { photo: true, buildings: true, trees: true, places: true, stops: true, events: true, labels: true, borders: true, roads: false, shadows: true, brw: false },
    sun: { y: 2026, mo: 6, d: 21, min: 14 * 60 }, playing: false, spot: null, evFilter: '30', evCats: new Set(), evArea: 'all', plSel: new Set(), plArea: 'gem', dim: 1,
  };

  // ------------------------------------------------------------------ Renderer / Szene
  const canvas = $('#c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#0c1f38'); // Nachtflug: tiefes Blau wie die Startseite
  const camera = new THREE.PerspectiveCamera(45, 1, 5, 120000);
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x7a7a62, 0.6);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(hemi, sun, sun.target);
  let sunDir = new THREE.Vector3(0, 1, 0);

  // Boden: Uebersicht (12 m/px) fuer die ganze Gemeinde, darueber Kacheln (2 m/px, bebaut 1 m/px)
  const planeGeo = (w, h) => new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2);
  const ground = new THREE.Group();
  scene.add(ground);
  const ovMat = new THREE.MeshBasicMaterial({ color: 0x0b1424 });
  const ov = new THREE.Mesh(planeGeo(W, H), ovMat);
  ov.position.set(CX, -0.4, CZ);
  ground.add(ov);
  new THREE.TextureLoader().load('img/overview.jpg', (t) => {
    t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
    ovMat.map = t; ovMat.color.setScalar(S.dim); ovMat.needsUpdate = true; S.dirty = true; hideLoading();
  }, undefined, hideLoading);
  const outerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  { // feines Raster wie auf der Startseite (1 km), nur außerhalb der Luftbilder sichtbar
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const g = cv.getContext('2d'); g.fillStyle = '#0a1626'; g.fillRect(0, 0, 128, 128); g.fillStyle = '#18305a'; g.fillRect(0, 0, 128, 2); g.fillRect(0, 0, 2, 128);
    const gt = new THREE.CanvasTexture(cv); gt.wrapS = gt.wrapT = THREE.RepeatWrapping; gt.repeat.set(300, 300); gt.anisotropy = 8; gt.encoding = THREE.sRGBEncoding; outerMat.map = gt;
  }
  const outer = new THREE.Mesh(planeGeo(300000, 300000), outerMat);
  outer.position.y = -0.8;
  scene.add(outer);
  const catcher = new THREE.Mesh(planeGeo(3200, 3200), new THREE.ShadowMaterial({ opacity: 0.4 }));
  catcher.position.y = 0.12; catcher.receiveShadow = true;
  Object.assign(catcher.material, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  scene.add(catcher);

  // ------------------------------------------------------------------ Luftbild-Kacheln (Streaming)
  const CELLS = {}; // "i_j" -> {i,j,nb,x,z,mesh,mat,base,det,loadB,loadD,used}
  M.cells.forEach(([i, j, nb]) => { CELLS[i + '_' + j] = { key: i + '_' + j, i, j, nb, x: X0 + (i + 0.5) * C, z: Z0 + (j + 0.5) * C, used: 0 }; });
  const CELL_LIST = Object.keys(CELLS).map((k) => CELLS[k]);
  const texLoader = new THREE.TextureLoader();
  let photoBusy = 0;
  function loadTex(url, cb) {
    photoBusy++;
    texLoader.load(url, (t) => {
      photoBusy--; t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; cb(t);
    }, undefined, () => { photoBusy--; cb(null); });
  }
  function ensureCellMesh(c) {
    if (c.mesh) return;
    c.mat = new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(S.dim) });
    c.mesh = new THREE.Mesh(planeGeo(C, C), c.mat);
    c.mesh.position.set(c.x, 0, c.z);
    c.mesh.visible = false;
    ground.add(c.mesh);
  }
  function streamPhotos(now) {
    const d = view.dist;
    const wantB = [], wantD = [];
    if (S.L.photo && d < 9500) {
      const rb = clamp(d * 0.9, 2300, 4600), rd = clamp(d * 0.9, 1500, 3000);
      CELL_LIST.forEach((c) => {
        const dist = Math.hypot(c.x - view.tx, c.z - view.tz);
        c.dist = dist;
        if (dist < rb) wantB.push(c);
        if (d < 3800 && dist < rd && c.nb >= 10) wantD.push(c);
      });
    }
    wantB.sort((a, b) => a.dist - b.dist); wantD.sort((a, b) => a.dist - b.dist);
    const setB = new Set(wantB), setD = new Set(wantD);
    wantB.concat(wantD.filter((c) => !setB.has(c))).forEach((c) => { c.used = now; });
    for (const c of wantB) {
      if (photoBusy >= 4) break;
      if (!c.base && !c.loadB) {
        c.loadB = true; ensureCellMesh(c);
        loadTex('img/p_' + c.key + '.jpg', (t) => { c.loadB = false; if (t) { c.base = t; if (!c.det) { c.mat.map = t; c.mat.needsUpdate = true; } c.mesh.visible = true; S.dirty = true; } });
      }
    }
    for (const c of wantD) {
      if (photoBusy >= 4) break;
      if (!c.det && !c.loadD && !c.failD) {
        c.loadD = true; ensureCellMesh(c);
        loadTex('img/d_' + c.key + '.jpg', (t) => { c.loadD = false; if (!t) { c.failD = true; return; } c.det = t; c.mat.map = t; c.mat.needsUpdate = true; c.mesh.visible = true; S.dirty = true; });
      }
    }
    // Speicher freigeben: Details zuerst, dann Basis (LRU)
    const dets = CELL_LIST.filter((c) => c.det && !setD.has(c)).sort((a, b) => a.used - b.used);
    dets.slice(0, Math.max(0, CELL_LIST.filter((c) => c.det).length - 9)).forEach((c) => {
      c.det.dispose(); c.det = null; c.mat.map = c.base || null; c.mat.needsUpdate = true; S.dirty = true;
    });
    const bases = CELL_LIST.filter((c) => c.base && !setB.has(c)).sort((a, b) => a.used - b.used);
    bases.slice(0, Math.max(0, CELL_LIST.filter((c) => c.base).length - 44)).forEach((c) => {
      if (c.det) { c.det.dispose(); c.det = null; }
      c.base.dispose(); c.base = null; c.mesh.visible = false; c.mat.map = null; S.dirty = true;
    });
  }

  // ------------------------------------------------------------------ Kartenansicht ohne Luftbild (Flaechen, Strassen)
  const AREA_COL = { wood: '#6f9461', water: '#8fb7d6', scrub: '#a7b57a', wet: '#9cb8a0', grass: '#b8d08f', farm: '#dccf93', res: '#d8d4c6', ind: '#c9c5bd', leisure: '#a4cc8c' };
  const AREA_Y = { res: 0.04, ind: 0.04, farm: 0.05, grass: 0.06, leisure: 0.07, scrub: 0.08, wet: 0.09, wood: 0.1, water: 0.11 };
  const flatBase = new THREE.Mesh(planeGeo(W, H), new THREE.MeshLambertMaterial({ color: col('#cdd6ae') }));
  flatBase.position.set(CX, -0.2, CZ);
  const flat = new THREE.Group();
  flat.add(flatBase);
  flat.visible = false;
  scene.add(flat);
  let areasState = 0; // 0 nicht geladen, 1 laedt, 2 fertig
  function ensureAreas() {
    if (areasState) return;
    areasState = 1;
    const s = document.createElement('script');
    s.src = 'data/areas.js';
    s.onload = () => {
      const pos = [], colr = [], idx = [];
      (window.AL_AREAS || []).forEach(([kind, outer, holes]) => {
        if (outer.length < 8) return;
        const toV = (f) => { const v = []; for (let i = 0; i < f.length; i += 2) v.push(new THREE.Vector2(f[i], f[i + 1])); return v; };
        const contour = toV(outer), hs = holes.map(toV);
        let faces;
        try { faces = THREE.ShapeUtils.triangulateShape(contour, hs); } catch (e) { return; }
        const all = contour.concat(...hs), c = col(AREA_COL[kind] || '#cfd3bd'), y = AREA_Y[kind] || 0.05, base = pos.length / 3;
        all.forEach((p) => { pos.push(p.x, y, p.y); colr.push(c.r, c.g, c.b); });
        faces.forEach((f) => idx.push(base + f[0], base + f[1], base + f[2]));
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
      flat.add(m); areasState = 2; S.dirty = true;
    };
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------------ Kacheldaten: Gebaeude, Baeume, Strassen
  const T = {}; // "i_j" -> {key,i,j,st,data,bld,trees,roads}
  const tileScripts = { n: 0 };
  function loadTile(key) {
    if (T[key]) return T[key];
    const [i, j] = key.split('_').map(Number), t = (T[key] = { key, i, j, st: 'loading', x: X0 + (i + 0.5) * C, z: Z0 + (j + 0.5) * C, used: 0 });
    const s = document.createElement('script');
    s.src = 'data/t_' + key + '.js';
    s.onload = () => { t.data = window.AL_TILES[key]; t.st = t.data ? 'data' : 'failed'; S.dirty = true; };
    s.onerror = () => { t.st = 'failed'; };
    document.head.appendChild(s);
    return t;
  }

  const WALL = { wohnen: '#ebdcc4', gewerbe: '#dcc9a3', industrie: '#bdb9b1', oeffentlich: '#c9d6dd', landwirtschaft: '#d8c9a3',
    verkehr: '#cbcac4', neben: '#d8d2c6', versorgung: '#c2c9cf', unbekannt: '#d9d4c9' };
  const WALL_C = {}; Object.keys(WALL).forEach((k) => { WALL_C[k] = col(WALL[k]); });
  const ROOF_TILE = ['#b5543a', '#a24a35', '#c0623f', '#8c4635', '#7a5444'].map(col);
  const ROOF_GREY = ['#7c8085', '#8d9094', '#6d7176'].map(col);
  const RAMP = ['#f0e6c8', '#e0983f', '#8b2e2e'].map(col);
  const SEL_ROOF = col('#ffb347'), SEL_WALL = col('#ffd48a');
  const USE_DE = { wohnen: 'Wohnen', gewerbe: 'Handel und Gewerbe', industrie: 'Industrie', oeffentlich: 'Öffentliche Nutzung', landwirtschaft: 'Landwirtschaft',
    verkehr: 'Verkehr (z. B. Garage)', neben: 'Nebengebäude', versorgung: 'Versorgung/Entsorgung', unbekannt: 'Nutzung unbekannt' };
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const bMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const tmpC = new THREE.Color();

  function buildBuildings(t) {
    const B = t.data.b;
    const box = new THREE.Box3();
    if (!B.length) { t.bld = { empty: true, box, boxes: [] }; return; }
    let nv = 0, ni = 0;
    B.forEach((b) => { nv += (b.wv.length + b.rv.length) / 3; ni += b.wi.length + b.ri.length; });
    const pos = new Float32Array(nv * 3), idx = new Uint32Array(ni), kind = new Uint8Array(nv), vb = new Uint16Array(nv);
    const ts = new Uint32Array(B.length), te = new Uint32Array(B.length), boxes = B.map(() => new THREE.Box3());
    let vo = 0, io = 0;
    B.forEach((b, bi) => {
      ts[bi] = io / 3;
      const put = (v, ix, k) => {
        const base = vo;
        for (let i = 0; i < v.length; i += 3) { pos[vo * 3] = v[i] + b.x; pos[vo * 3 + 1] = v[i + 1]; pos[vo * 3 + 2] = v[i + 2] + b.z; kind[vo] = k; vb[vo] = bi; vo++; }
        for (let i = 0; i < ix.length; i++) idx[io++] = ix[i] + base;
      };
      put(b.wv, b.wi, 0); put(b.rv, b.ri, 1);
      te[bi] = io / 3;
    });
    const p = new THREE.Vector3();
    for (let v = 0; v < nv; v++) { p.set(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); boxes[vb[v]].expandByPoint(p); box.expandByPoint(p); }
    boxes.forEach((b) => b.expandByScalar(0.15));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ca = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    g.setAttribute('color', ca);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, bMat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.visible = S.L.buildings;
    scene.add(mesh);
    t.bld = { mesh, pos, idx, kind, vb, ts, te, boxes, box, ca };
    recolorTile(t);
  }
  function recolorTile(t) {
    const bl = t.bld;
    if (!bl || bl.empty) return;
    const B = t.data.b, wc = [], rc = [];
    B.forEach((b, bi) => {
      if (S.sel && S.sel.key === t.key && S.sel.k === bi) { wc.push(SEL_WALL); rc.push(SEL_ROOF); return; }
      if (S.colorMode === 'brw') {
        const q = brwAt(b.x, b.z), c = !q ? WALL_C.unbekannt : q.aussen ? BRW_AUSSEN : BRW_C[brwClass(q.w)];
        wc.push(c); rc.push(c);
      } else if (S.colorMode === 'hoehe') {
        const f = clamp(b.t / 18, 0, 1), c = f < 0.5 ? tmpC.clone().lerpColors(RAMP[0], RAMP[1], f * 2) : tmpC.clone().lerpColors(RAMP[1], RAMP[2], (f - 0.5) * 2);
        wc.push(c); rc.push(c);
      } else if (S.colorMode === 'einheitlich') { wc.push(WALL_C.unbekannt); rc.push(ROOF_TILE[0]); }
      else {
        const h = hash(b.id);
        wc.push(WALL_C[b.u] || WALL_C.unbekannt);
        rc.push(b.u === 'wohnen' ? ROOF_TILE[h % ROOF_TILE.length] : ROOF_GREY[h % ROOF_GREY.length]);
      }
    });
    const a = bl.ca.array;
    for (let v = 0; v < bl.vb.length; v++) { const c = (bl.kind[v] ? rc : wc)[bl.vb[v]]; a[v * 3] = c.r; a[v * 3 + 1] = c.g; a[v * 3 + 2] = c.b; }
    bl.ca.needsUpdate = true; S.dirty = true;
  }

  const treeGeo = new THREE.ConeGeometry(2.6, 9, 5).translate(0, 5.5, 0);
  const treeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const TREE_COL = ['#4f7a45', '#3f6a3c', '#5b8650', '#35603a'].map(col);
  function buildTrees(t) {
    const tr = t.data.tr, n = tr.length / 2;
    if (!n) { t.trees = { empty: true }; return; }
    const mesh = new THREE.InstancedMesh(treeGeo, treeMat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const h = hash(t.key + i), s = 0.7 + (h % 100) / 140;
      sc.set(s, s * (0.9 + ((h >>> 8) % 40) / 100), s); ps.set(tr[i * 2], 0, tr[i * 2 + 1]);
      m4.compose(ps, q, sc); mesh.setMatrixAt(i, m4); mesh.setColorAt(i, TREE_COL[(h >>> 4) % 4]);
    }
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.visible = S.L.trees;
    scene.add(mesh); t.trees = { mesh };
  }

  const ROAD_W = { motorway: 14, trunk: 12, primary: 10, secondary: 9, tertiary: 8, unclassified: 6, residential: 6, living_street: 5, service: 4,
    track: 3, path: 1.8, footway: 1.8, cycleway: 1.8, pedestrian: 3, steps: 1.8, bridleway: 2, rail: 2.4, 'w:river': 7, 'w:canal': 5, 'w:stream': 2.5, 'w:ditch': 1.5 };
  const ROAD_COL = { track: '#b7a27c', path: '#c9b99a', footway: '#d0c4ac', cycleway: '#c9b99a', service: '#9d9d96', steps: '#c9b99a', rail: '#5b5b5b',
    'w:river': '#8fb7d6', 'w:canal': '#8fb7d6', 'w:stream': '#8fb7d6', 'w:ditch': '#9dbbd3', primary: '#7b7d7e', secondary: '#7b7d7e', tertiary: '#7b7d7e', trunk: '#7b7d7e' };
  function buildRoads(t) {
    const pos = [], idx = [], colr = [];
    t.data.rd.forEach(([k, f]) => {
      const w = ROAD_W[k] || 4, c = col(ROAD_COL[k] || '#8d8e8b');
      for (let i = 0; i + 3 < f.length; i += 2) {
        const x0 = f[i], z0 = f[i + 1], x1 = f[i + 2], z1 = f[i + 3], dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz);
        if (l < 0.01) continue;
        const nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2, b = pos.length / 3;
        pos.push(x0 + nx, 0.06, z0 + nz, x0 - nx, 0.06, z0 - nz, x1 - nx, 0.06, z1 - nz, x1 + nx, 0.06, z1 + nz);
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
        for (let q = 0; q < 4; q++) colr.push(c.r, c.g, c.b);
      }
    });
    if (!pos.length) { t.roads = { empty: true }; return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    scene.add(mesh); t.roads = { mesh };
  }

  function disposeMesh(o) { if (o && o.mesh) { scene.remove(o.mesh); o.mesh.geometry.dispose(); if (o.mesh.dispose) o.mesh.dispose(); } }
  let buildBudget = 0;
  function streamTiles() {
    const d = view.dist;
    const rb = d < 7000 ? clamp(d * 1.5, 1600, 6000) : 0, rt = d < 4500 ? clamp(d * 1.2, 1300, 3200) : 0;
    const needRoads = !S.L.photo || S.L.roads;
    M.cells.forEach(([i, j]) => {
      const key = i + '_' + j, cx = X0 + (i + 0.5) * C, cz = Z0 + (j + 0.5) * C, dist = Math.hypot(cx - view.tx, cz - view.tz) - C * 0.7;
      const wantB = dist < rb, wantT = S.L.trees && dist < rt, wantR = needRoads && dist < Math.max(rb, 1600);
      let t = T[key];
      if ((wantB || wantT || wantR) && !t) t = loadTile(key);
      if (!t) return;
      if (wantB || wantT || wantR) t.used = performance.now();
      if (t.st === 'data') {
        if (wantB && !t.bld && buildBudget < 1) { buildBuildings(t); buildBudget++; }
        if (wantT && !t.trees && buildBudget < 1) { buildTrees(t); buildBudget++; }
        if (wantR && !t.roads && buildBudget < 1) { buildRoads(t); buildBudget++; }
      }
      if (t.bld && !t.bld.empty && dist > rb * 1.4 + 800 && !(S.sel && S.sel.key === key)) { disposeMesh(t.bld); t.bld = null; }
      if (t.trees && !t.trees.empty && dist > rt * 1.4 + 800) { disposeMesh(t.trees); t.trees = null; }
      if (t.roads && !t.roads.empty && (!needRoads || dist > Math.max(rb, 1600) * 1.4 + 800)) { disposeMesh(t.roads); t.roads = null; }
    });
    buildBudget = 0;
  }

  // ------------------------------------------------------------------ Grenzen (Gemeinde, Ortsteile)
  const borders = new THREE.Group();
  (function () {
    const mk = (f, color, y) => {
      const pts = []; for (let i = 0; i < f.length; i += 2) pts.push(new THREE.Vector3(f[i], y, f[i + 1]));
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color }));
      borders.add(l);
    };
    OT.forEach((o) => o.rings.forEach((r) => mk(r, 0xffffff, 6)));
    M.boundary.forEach((r) => mk(r, 0xffb347, 8));
    scene.add(borders);
  })();

  // ------------------------------------------------------------------ Orte, Haltestellen, Veranstaltungen (Marker)
  const GROUPS = { food: { label: 'Essen & Trinken', icon: '🍽' }, shop: { label: 'Einkaufen', icon: '🛍' }, service: { label: 'Dienste', icon: '🔧' },
    health: { label: 'Gesundheit & Pflege', icon: '⚕' }, lodging: { label: 'Übernachten', icon: '🛏' }, culture: { label: 'Kultur & Freizeit', icon: '🎭' },
    sights: { label: 'Sehenswertes & Info', icon: 'ℹ️' }, faith: { label: 'Kirchen & Friedhöfe', icon: '⛪' }, edu: { label: 'Bildung & Betreuung', icon: '🎓' }, other: { label: 'Sonstiges', icon: '📍' } };
  // Symbol je Art des Ortes; fehlt die Art, gilt das Symbol der Gruppe
  const TICON = { restaurant: '🍽', cafe: '☕', fast_food: '🍔', bar: '🍸', pub: '🍺', biergarten: '🍺', ice_cream: '🍦', nightclub: '🎶',
    butcher: '🥩', hairdresser: '✂️', car: '🚗', car_repair: '🔧', motorcycle: '🏍', bicycle: '🚲', florist: '💐', supermarket: '🛒', convenience: '🛒', gift: '🎁', stationery: '✏️',
    farm: '🌾', agrarian: '🌾', 'agrarian;farm': '🌾', furniture: '🛋', interior_decoration: '🛋',
    fuel: '⛽', car_wash: '🚿', parcel_locker: '📦', post_office: '📮', bank: '🏦', atm: '🏦', townhall: '🏛', government: '🏛', police: '🚓', fire_station: '🚒', charging_station: '⚡', therapist: '💆',
    doctors: '⚕', dentist: '🦷', pharmacy: '💊', clinic: '🏥', hospital: '🏥', veterinary: '🐾', nursing_home: '🩺',
    hotel: '🏨', guest_house: '🛏', apartment: '🏠', hostel: '🛏', camp_site: '⛺',
    arts_centre: '🎭', theatre: '🎭', cinema: '🎬', museum: '🏛', events_venue: '🎪', community_centre: '🏠', youth_centre: '🧑‍🤝‍🧑', social_club: '🤝', driver_training: '🏍', public_bookcase: '📚',
    information: 'ℹ️', viewpoint: '🔭', artwork: '🖼', place_of_worship: '⛪', grave_yard: '🪦',
    kindergarten: '🧸', childcare: '🧸', school: '🏫', library: '📚', college: '🎓' };
  const T_FOOD = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'biergarten', 'ice_cream'], T_HEALTH = ['doctors', 'pharmacy', 'dentist', 'clinic', 'hospital', 'veterinary'];
  const T_CULT = ['arts_centre', 'community_centre', 'theatre', 'cinema', 'museum', 'social_club', 'events_venue', 'youth_centre'], T_EDU = ['school', 'kindergarten', 'childcare', 'library', 'college'];
  const T_SERV = ['fuel', 'bank', 'post_office', 'parcel_locker', 'atm', 'townhall', 'police', 'fire_station', 'charging_station', 'driving_school'];
  const TYPE_DE = { restaurant: 'Restaurant', cafe: 'Café', fast_food: 'Imbiss', bar: 'Bar', pub: 'Kneipe', fuel: 'Tankstelle', hairdresser: 'Friseur', arts_centre: 'Kulturzentrum',
    community_centre: 'Gemeindezentrum', parcel_locker: 'Paketstation', convenience: 'Lebensmittelladen', farm: 'Hofladen', car: 'Autohaus', motorcycle: 'Motorradhandel',
    interior_decoration: 'Wohnen und Deko', kindergarten: 'Kindergarten', school: 'Schule', pharmacy: 'Apotheke', doctors: 'Arztpraxis', dentist: 'Zahnarzt', bank: 'Bank',
    driver_training: 'Fahrtraining', post_office: 'Post', townhall: 'Rathaus', museum: 'Museum', hotel: 'Hotel', guest_house: 'Pension', apartment: 'Ferienwohnung', fire_station: 'Feuerwehr',
    hostel: 'Herberge', camp_site: 'Campingplatz', information: 'Infotafel', viewpoint: 'Aussichtspunkt', artwork: 'Kunstwerk', place_of_worship: 'Kirche', grave_yard: 'Friedhof',
    nightclub: 'Nachtclub', nursing_home: 'Pflegeheim', car_wash: 'Autowaschanlage', public_bookcase: 'Bücherschrank', events_venue: 'Veranstaltungsort', car_repair: 'Autowerkstatt',
    butcher: 'Fleischerei', florist: 'Blumenladen', bicycle: 'Fahrradladen', supermarket: 'Supermarkt', youth_centre: 'Jugendtreff', theatre: 'Theater', therapist: 'Therapie',
    agrarian: 'Landhandel', 'agrarian;farm': 'Landwirtschaft', gift: 'Geschenke', yes: 'Büro', property_management: 'Hausverwaltung', stationery: 'Schreibwaren', company: 'Firma',
    beverages: 'Getränke', government: 'Behörde', 'hydraulics;pneumatics': 'Technischer Handel', furniture: 'Möbel', biergarten: 'Biergarten' };
  TYPE_DE.community_centre = 'Dorfgemeinschaftshaus';
  Object.assign(TYPE_DE, { doityourself: 'Baumarkt', clothes: 'Bekleidung', bakery: 'Bäckerei', beauty: 'Kosmetik', travel_agency: 'Reisebüro', insurance: 'Versicherung', tax_advisor: 'Steuerberater',
    advertising_agency: 'Werbeagentur', driving_school: 'Fahrschule', social_facility: 'Soziale Einrichtung', physiotherapist: 'Physiotherapie', alternative: 'Heilpraktiker', speech_therapist: 'Logopädie',
    occupational_therapist: 'Ergotherapie', laboratory: 'Labor', attraction: 'Sehenswürdigkeit', hardware: 'Eisenwaren', shoes: 'Schuhe', optician: 'Optiker', mobile_phone: 'Handyladen', jewelry: 'Juwelier',
    books: 'Buchhandlung', electronics: 'Elektronik', kiosk: 'Kiosk', pet: 'Tierbedarf', toys: 'Spielwaren', garden_centre: 'Gartenmarkt', variety_store: 'Gemischtwaren', department_store: 'Kaufhaus', chemist: 'Drogerie' });
  // Fachrichtung (OSM healthcare:speciality) in Worten
  const FA_DE = { general: 'Allgemeinmedizin', internal: 'Innere Medizin', paediatrics: 'Kinderheilkunde', gynaecology: 'Frauenheilkunde', otolaryngology: 'HNO', urology: 'Urologie', orthopaedics: 'Orthopädie',
    dermatology: 'Hautarzt', ophthalmology: 'Augenheilkunde', child_psychiatry: 'Kinder- und Jugendpsychiatrie', psychiatry: 'Psychiatrie', neurology: 'Neurologie', radiology: 'Radiologie', surgery: 'Chirurgie',
    dentist: 'Zahnarzt', acupuncture: 'Akupunktur', chiropractic: 'Chirotherapie', physiotherapy: 'Physiotherapie', occupational_therapist: 'Ergotherapie', speech_therapist: 'Logopädie' };
  const faLabel = (fa) => String(fa).split(';').map((x) => FA_DE[x.trim()]).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(', ');
  const LODGING = ['hotel', 'guest_house', 'apartment', 'hostel', 'camp_site', 'motel', 'chalet'], SIGHTS = ['information', 'viewpoint', 'artwork', 'attraction', 'picnic_site'];
  const T_CARE = ['nursing_home', 'social_facility', 'physiotherapist', 'alternative', 'speech_therapist', 'occupational_therapist', 'laboratory'], T_LEISURE = ['nightclub', 'driver_training', 'public_bookcase'];
  const classify = (p) => {
    if (LODGING.indexOf(p.t) >= 0 || /\b(Pension|Ferienwohnung|Herberge|Mennotel)\b/.test(p.n) && p.t !== 'restaurant' && p.t !== 'fast_food') return 'lodging';
    if (p.k === 'tourism') return SIGHTS.indexOf(p.t) >= 0 ? 'sights' : p.t === 'museum' ? 'culture' : 'sights';
    if (p.t === 'place_of_worship' || p.t === 'grave_yard') return 'faith';
    if (p.t === 'school' && /Flugschule/.test(p.n)) return 'culture';
    if (p.k === 'shop') return 'shop'; if (p.k === 'healthcare' || p.t === 'therapist') return 'health'; if (p.k === 'office') return 'service';
    if (T_FOOD.indexOf(p.t) >= 0) return 'food'; if (T_HEALTH.indexOf(p.t) >= 0 || T_CARE.indexOf(p.t) >= 0) return 'health'; if (T_CULT.indexOf(p.t) >= 0 || T_LEISURE.indexOf(p.t) >= 0) return 'culture';
    if (T_EDU.indexOf(p.t) >= 0) return 'edu'; if (T_SERV.indexOf(p.t) >= 0 || p.t === 'car_wash') return 'service'; return 'other';
  };
  const PLACES = M.pois.map((p, i) => Object.assign({ i, g: classify(p) }, p));
  Object.assign(TICON, { doityourself: '🔨', hardware: '🔨', garden_centre: '🌱', clothes: '👕', shoes: '👟', bakery: '🥖', beauty: '💅', travel_agency: '✈️', insurance: '🏢', tax_advisor: '🏢', advertising_agency: '🏢', driving_school: '🚘', social_facility: '🤝', physiotherapist: '💆', alternative: '🌿', speech_therapist: '🗣', occupational_therapist: '🩺', laboratory: '🔬', attraction: '📷', optician: '👓', books: '📚', pet: '🐾', chemist: '🧴', company: '🏢', yes: '🏢', property_management: '🏢', 'hydraulics;pneumatics': '⚙️', beverages: '🍺' });
  PLACES.forEach((p) => {
    p.ic = TICON[p.t] || GROUPS[p.g].icon;
    if (p.g === 'lodging' && LODGING.indexOf(p.t) < 0) { p.ic = '🛏'; p.tl = 'Pension'; } // Name nennt eine Unterkunft, die Art im Kartenbestand nicht
    if (/Flugschule/.test(p.n)) { p.ic = '✈️'; p.tl = 'Flugschule'; }
    if (p.fa && !p.tl) { const f = faLabel(p.fa); if (f) p.tl = f; }
  });
  const typeDe = (p) => p.tl || TYPE_DE[p.t] || p.t.replace(/_/g, ' ');
  const placeByName = (n) => PLACES.find((p) => p.name === n || p.n === n);
  PLACES.forEach((p) => { p.name = p.n; });

  const nowB = () => AL.berlinParts(Date.now());
  const today = nowB();
  Object.assign(S.sun, { y: today.y, mo: today.mo, d: today.d, min: today.h * 60 + today.mi }); // Sonnenstand beginnt mit dem Datum und der Uhrzeit des Seitenaufrufs
  const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const longFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const otNied = OT.findIndex((o) => o.n.indexOf(ORT_NAME) === 0);
  const EV = EVENTS.map((e) => {
    const base = e.date ? e.date.split('-').map(Number) : null;
    const t = base ? Date.UTC(base[0], base[1] - 1, base[2]) : Date.UTC(today.y, today.mo - 1, today.d + e.off), pl = e.place ? placeByName(e.place) : null;
    const nbE = !!(M.nb && e.ortsteil === M.nb.n), oi = e.ortsteil ? OT.findIndex((o) => o.n === e.ortsteil) : otNied, at = oi >= 0 ? OT[oi] : null; // ohne Kartenort: Mitte des genannten Ortsteils
    return Object.assign({}, e, { nbE, t, off: Math.round((t - Date.UTC(today.y, today.mo - 1, today.d)) / 864e5), dow: (new Date(t).getUTCDay() + 6) % 7,
      x: pl ? pl.x : (nbE ? M.nb.x : (at ? at.x : CX)), z: pl ? pl.z : (nbE ? M.nb.z : (at ? at.z : CZ)), pl });
  }).sort((a, b) => a.t - b.t || a.from.localeCompare(b.from));

  const markersEl = $('#markers'), markers = [];
  function addMarker(cls, html, wx, wy, wz, onClick, label) {
    const el = document.createElement('div');
    el.className = 'mk ' + cls;
    el.innerHTML = html + (label ? '<span class="lbl">' + esc(label) + '</span>' : '');
    el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    el.setAttribute('role', 'button'); el.tabIndex = 0;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') onClick(); });
    markersEl.appendChild(el);
    const m = { el, v: new THREE.Vector3(wx, wy, wz), cls };
    markers.push(m);
    return m;
  }
  PLACES.forEach((p) => { p.marker = addMarker('poi', p.ic, p.x, 14, p.z, () => showPlace(p.i, true), p.name); p.marker.grp = p.g; });
  const STOPS = M.stops.map((s, i) => Object.assign({ i, g: -1 }, s));

  // VBB-Fahrplan (Sollfahrplan): OSM-Haltestellen den Haltestellengruppen des Feeds zuordnen
  const FP = window.AL_FAHRPLAN, FPG = FP ? FP.groups : [];
  const fpBase = FP ? Date.UTC.apply(null, FP.base.split('-').map((v, i) => (i === 1 ? +v - 1 : +v))) : 0;
  const firstTok = (n) => norm0(n).split(',')[0].replace(/\s*\(.*?\)\s*/g, '').trim();
  function norm0(s) { return String(s).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  if (FP) {
    STOPS.forEach((s) => {
      let best = 1e9, bi = -1;
      FPG.forEach((g, gi) => {
        const d = Math.hypot(g.x - s.x, g.z - s.z), same = firstTok(g.n) === firstTok(s.n);
        const lim = s.k === 'rail' ? 450 : 160, score = d + (same ? 0 : 90) + (s.k === 'rail' && !/bahnhof/i.test(g.n) ? 400 : 0);
        if (d < lim && score < best) { best = score; bi = gi; }
      });
      s.g = bi;
    });
    const matched = new Set(STOPS.map((s) => s.g));
    FPG.forEach((g, gi) => { // Haltestellen des Feeds ohne OSM-Gegenstück ergänzen
      if (matched.has(gi)) return;
      const o = OT.findIndex((t) => g.n.indexOf(t.n) === 0);
      STOPS.push({ i: STOPS.length, n: g.n, k: /bahnhof/i.test(g.n) ? 'rail' : 'bus', x: g.x, z: g.z, o, g: gi });
    });
  }
  { // Mehrere OSM-Punkte derselben Haltestelle (Steige, Gegenrichtung, Bahnhof und Busbahnhof-Eingang) gehören zu einer Fahrplangruppe: ein Marker an der mittleren Lage
    const keep = [], nm = (s) => norm0(s.g >= 0 && FPG[s.g] ? FPG[s.g].n : s.n);
    STOPS.forEach((s) => {
      const t = keep.find((q) => (s.g >= 0 && q.g === s.g) || (nm(q) === nm(s) && Math.hypot(q.x - s.x, q.z - s.z) < 450)); // gleiche Gruppe oder gleicher Name in der Nähe
      if (t) { t._n++; t._sx += s.x; t._sz += s.z; if (s.k === 'rail') t.k = 'rail'; if (t.g < 0 && s.g >= 0) t.g = s.g; return; }
      s._n = 1; s._sx = s.x; s._sz = s.z;
      keep.push(s);
    });
    keep.forEach((s, i) => { s.i = i; if (s._n > 1) { s.x = s._sx / s._n; s.z = s._sz / s._n; } });
    STOPS.length = 0; keep.forEach((s) => STOPS.push(s));
  }
  STOPS.forEach((s) => { s.marker = addMarker('stop ' + s.k, s.k === 'rail' ? '🚆' : '🚌', s.x, 10, s.z, () => showStop(s.i), s.n); });
  const evGroups = {};
  EV.forEach((e) => { const k = e.pl ? e.place : (e.x + ',' + e.z); (evGroups[k] = evGroups[k] || []).push(e); });
  Object.keys(evGroups).forEach((k) => {
    const list = evGroups[k], mk = addMarker('ev', '📅 ' + list.length, list[0].x, 34, list[0].z, () => showEventsAt(list), null);
    list.forEach((e) => { e.marker = mk; });
  });
  OT.forEach((o, i) => { o.marker = addMarker('ot', esc(o.n), o.x, 30, o.z, () => goOrtsteil(i), null); });
  if (M.nb && M.nb.x != null) { // Nachbarort: eigene, dezente Beschriftung (gestrichelter Rand)
    const nbm = addMarker('ot', esc(M.nb.n), M.nb.x, 30, M.nb.z, () => flyTo({ tx: M.nb.x, tz: M.nb.z, dist: 2400, phi: 0.9 }, 1200), null);
    nbm.el.classList.add('nb'); nbm.el.title = M.nb.n + ' (Nachbarort)';
  }

  // Mouseover auf den Ortsteil-Namen: Kurzinfo (Einwohner laut Gemeinde, Flaeche, Adressen, Gebaeude, Ersterwaehnung, Sehenswertes)
  const tipEl = document.createElement('div');
  tipEl.id = 'tip'; tipEl.className = 'tip'; tipEl.hidden = true; tipEl.setAttribute('role', 'tooltip');
  document.body.appendChild(tipEl);
  const ewText = (o) => { const e = o.info && o.info.einwohner; return e ? (e.ca ? 'rund ' : '') + e.zahl : null; };
  const km2 = (o) => (o.ha / 100).toFixed(1).replace('.', ',');
  function tipHtml(o) {
    const ew = ewText(o), inf = o.info || {};
    return '<b>' + esc(o.n) + '</b>'
      + '<div>Einwohner: ' + (ew ? esc(ew) + ' <span class="s">(Angabe der Gemeinde)</span>' : '<span class="s">keine Angabe der Gemeinde</span>') + '</div>'
      + '<div>Fläche ' + km2(o) + ' km² · ' + o.nA + ' Adressen · ' + o.nB + ' Gebäude</div>'
      + (inf.erstwaehnung ? '<div>Urkundlich erwähnt seit ' + inf.erstwaehnung + '</div>' : '')
      + (inf.sehenswert && inf.sehenswert.length ? '<div>Sehenswert: ' + esc(inf.sehenswert.slice(0, 2).join(', ')) + '</div>' : '')
      + '<div class="s">Klicken für mehr</div>';
  }
  function showTip(o) {
    tipEl.innerHTML = tipHtml(o); tipEl.hidden = false;
    const r = o.marker.el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    const below = r.bottom + 8 + h < innerHeight - 8;
    tipEl.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + 'px';
    tipEl.style.top = (below ? r.bottom + 8 : Math.max(8, r.top - 8 - h)) + 'px';
  }
  const hideTip = () => { tipEl.hidden = true; };
  OT.forEach((o) => {
    const el = o.marker.el;
    el.addEventListener('mouseenter', () => showTip(o)); el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', () => showTip(o)); el.addEventListener('blur', hideTip); el.addEventListener('click', hideTip);
  });

  // ------------------------------------------------------------------ Bodenrichtwerte (BORIS Brandenburg, Stichtag aus den Daten)
  const BRW = window.AL_BRW;
  const BRW_COL = ['#f4ecc2', '#e9cf7a', '#e0a24a', '#c9692f', '#8f2f2a'], BRW_C = BRW_COL.map(col), BRW_AUSSEN = col('#cfcfc8');
  const BRW_LBL = ['unter 10', '10 bis unter 20', '20 bis unter 40', '40 bis unter 60', '60 und mehr'];
  const brwClass = (w) => (w < 10 ? 0 : w < 20 ? 1 : w < 40 ? 2 : w < 60 ? 3 : 4);
  const nfEUR = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });
  const fmtW = (w) => nfEUR.format(w) + ' €/m²';
  const fmtIso = (s) => (s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '');
  const BRW_Z = BRW ? BRW.zones.filter((q) => q.ring) : [];
  const BRW_OUT = BRW ? BRW.zones.find((q) => q.aussen) : null;
  const inRing = (x, z, f) => { let c = false; for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) { if ((f[i + 1] > z) !== (f[j + 1] > z) && x < (f[j] - f[i]) * (z - f[i + 1]) / (f[j + 1] - f[i + 1]) + f[i]) c = !c; } return c; };
  BRW_Z.forEach((q) => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < q.ring.length; i += 2) { a = Math.min(a, q.ring[i]); c = Math.max(c, q.ring[i]); b = Math.min(b, q.ring[i + 1]); d = Math.max(d, q.ring[i + 1]); } q.bb = [a, b, c, d]; });
  function brwAt(x, z) { for (const q of BRW_Z) { if (x >= q.bb[0] && x <= q.bb[2] && z >= q.bb[1] && z <= q.bb[3] && inRing(x, z, q.ring)) return q; } return BRW_OUT; }
  const brwGroup = new THREE.Group();
  brwGroup.visible = false; scene.add(brwGroup);
  BRW_Z.forEach((q) => {
    const v = []; for (let i = 0; i < q.ring.length; i += 2) v.push(new THREE.Vector2(q.ring[i], q.ring[i + 1]));
    let faces; try { faces = THREE.ShapeUtils.triangulateShape(v, []); } catch (e) { return; }
    const pos = []; v.forEach((p) => pos.push(p.x, 0.3, p.y));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(faces.flat());
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: BRW_C[brwClass(q.w)], transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    m.renderOrder = 2; brwGroup.add(m);
    q.marker = addMarker('brw', '<b>' + esc(nfEUR.format(q.w)) + '</b> €', q.c[0], 6, q.c[1], () => showBrw(q), null);
    q.marker.el.style.background = BRW_COL[brwClass(q.w)]; q.marker.el.title = q.n + ': ' + fmtW(q.w);
  });
  const landLine = () => { const l = BRW.land; return (l.acker ? 'Acker ' + fmtW(l.acker.w) + (l.acker.az ? ' (Ackerzahl ' + l.acker.az + ')' : '') : '') + (l.gruen ? ', Grünland ' + fmtW(l.gruen.w) + (l.gruen.gz ? ' (Grünlandzahl ' + l.gruen.gz + ')' : '') : '') + (l.forst ? ', Forst ' + fmtW(l.forst.w) : ''); };
  const BRW_NOTE = '<p class="note">Der Bodenrichtwert ist ein durchschnittlicher Lagewert je m² Grundstücksfläche für eine Zone, kein Verkehrswert eines einzelnen Grundstücks.</p>';
  function brwRow(x, z) {
    const q = BRW ? brwAt(x, z) : null;
    if (!q) return '';
    return '<dt>Bodenrichtwert</dt><dd><b>' + esc(fmtW(q.w)) + '</b> <span class="s">' + esc(q.artDe) + (q.aussen ? ', Außenbereich' : '') + '</span><span class="s">Zone „' + esc(q.n) + '“, Stichtag ' + esc(fmtIso(q.stichtag)) + '</span></dd>';
  }
  function showBrw(q) {
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); if (q.marker) q.marker.el.classList.add('sel');
    openCard('<h3>' + esc(fmtW(q.w)) + '</h3><p class="sub">Bodenrichtwertzone „' + esc(q.n) + '“' + (q.o >= 0 ? ' · ' + esc(otName(q.o)) : '') + '</p><dl>'
      + '<dt>Nutzung</dt><dd>' + esc(q.artDe) + '</dd><dt>Zustand</dt><dd>' + esc(q.ez) + '</dd><dt>Zonenfläche</dt><dd>' + nfEUR.format(q.ha) + ' ha</dd>'
      + (q.vg ? '<dt>Vollgeschosse</dt><dd>' + q.vg + '</dd>' : '') + '<dt>Stichtag</dt><dd>' + esc(fmtIso(q.stichtag)) + '</dd><dt>Zonen-Nr.</dt><dd>' + esc(q.nr) + '</dd></dl>'
      + (q.aussen ? '<p class="note">Land- und Forstwirtschaft, gemeindeweit: ' + esc(landLine()) + '.</p>' : '') + BRW_NOTE
      + sourceLine('BORIS Brandenburg (LGB), dl-de/by-2.0', 'https://www.govdata.de/dl-de/by-2-0'));
    flyTo({ tx: q.c[0], tz: q.c[1], dist: Math.max(Math.sqrt(q.ha * 1e4) * 1.6, 500), phi: 0.9 }, 1200);
  }
  function updateLegend() {
    const on = S.L.brw || S.colorMode === 'brw', el = $('#legend'), lg = (c, t) => '<span class="lg"><i style="background:' + c + '"></i>' + t + '</span>';
    if (on && BRW) {
      el.hidden = false;
      el.innerHTML = '<b>Bodenrichtwert, €/m²</b><span class="s">Bauland, Stichtag ' + esc(fmtIso(BRW.stichtag)) + '</span>'
        + BRW_COL.map((c, i) => lg(c, BRW_LBL[i])).join('') + lg('#cfcfc8', 'Außenbereich (6 €/m²)');
    } else if (S.colorMode === 'hoehe') {
      el.hidden = false;
      el.innerHTML = '<b>Gebäudehöhe</b>' + lg('#f0e6c8', 'niedrig') + lg('#e0983f', 'rund 9 m') + lg('#8b2e2e', '18 m und mehr');
    } else if (S.colorMode === 'nutzung') {
      el.hidden = false;
      el.innerHTML = '<b>Gebäudenutzung</b>' + ['wohnen', 'gewerbe', 'industrie', 'oeffentlich', 'landwirtschaft', 'neben'].map((k) => lg(WALL[k], USE_DE[k])).join('');
    } else el.hidden = true;
  }
  $('#nPlaces').textContent = PLACES.filter((p) => !p.nb).length;
  $('#nEvents').textContent = EV.filter((e) => e.off >= 0 && !e.nbE).length; // Zähler: Gebiet (der Nachbarort steht in der Liste dazu)
  (function evBanner() { // Herkunft der Termine: Beispieldaten kennzeichnen, echte Termine mit Quelle und Stand
    const el = $('#evBanner'), auto = window.AL_EVENTS_AUTO;
    if (EV.some((e) => e.dummy)) el.textContent = 'Beispieldaten · echte Termine folgen';
    else if (auto && auto.stand) el.textContent = (auto.quellen && auto.quellen.length ? 'Quellen: ' + auto.quellen.join(', ') : 'Von Hand gepflegte Termine') + ', Stand ' + auto.stand.slice(8, 10) + '.' + auto.stand.slice(5, 7) + '.' + auto.stand.slice(0, 4);
    else el.hidden = true;
  })();

  function updateMarkers() {
    const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3(), far = view.dist > 1300;
    markers.forEach((m) => {
      const on = m.cls === 'poi' ? S.L.places && (!S.plSel.size || S.plSel.has(m.grp)) : m.cls === 'ev' ? S.L.events : m.cls === 'ot' ? S.L.labels : m.cls === 'brw' ? S.L.brw : S.L.stops;
      v.copy(m.v).project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const near = m.cls === 'ot' ? far : m.cls === 'brw' ? view.dist < 12000 : (!far || view.dist < 2600) && camera.position.distanceTo(m.v) < 1900;
      const vis = on && near && v.z < 1 && x > -60 && x < w + 60 && y > -40 && y < h + 40;
      m.el.style.display = vis ? '' : 'none';
      if (vis) m.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-100%)';
    });
  }

  // ------------------------------------------------------------------ Kamera / Steuerung
  const homeView = () => (innerHeight > innerWidth ? { tx: CX, tz: CZ, theta: 0, phi: 0.4, dist: 36000 } : { tx: CX, tz: CZ, theta: 0, phi: 0.75, dist: 27000 }); // Hochformat (Handy): steiler und weiter weg, damit die Gemeinde die Breite füllt
  const view = Object.assign({}, homeView());
  let anim = null;
  function applyView() {
    view.phi = clamp(view.phi, 0.04, 1.4);
    view.dist = clamp(view.dist, 25, 36000);
    view.tx = clamp(view.tx, X0, X0 + W); view.tz = clamp(view.tz, Z0, Z0 + H);
    const sp = Math.sin(view.phi);
    camera.position.set(view.tx + view.dist * sp * Math.sin(view.theta), view.dist * Math.cos(view.phi), view.tz + view.dist * sp * Math.cos(view.theta));
    camera.near = Math.max(2, view.dist * 0.04); camera.far = Math.max(8000, view.dist * 6);
    camera.lookAt(view.tx, 0, view.tz); camera.updateProjectionMatrix();
    catcher.position.set(view.tx, 0.12, view.tz);
    updateSunRig(); S.dirty = true; S.moved = true;
  }
  function flyTo(to, ms) { anim = { t0: performance.now(), ms: ms || 1000, from: Object.assign({}, view), to: Object.assign({}, view, to) }; }
  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); S.dirty = true;
  }
  addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas); // Kartenfläche ändert sich mit Seitenleiste und Handy-Layout

  const ptrs = new Map();
  let down = null, pinch = null;
  const panBy = (dx, dy) => {
    const k = view.dist * 0.0016;
    view.tx += -Math.cos(view.theta) * dx * k - Math.sin(view.theta) * dy * k;
    view.tz += Math.sin(view.theta) * dx * k - Math.cos(view.theta) * dy * k;
  };
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0, btn: e.button, n: ptrs.size };
    if (ptrs.size === 2) { const [a, b] = Array.from(ptrs.values()); pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; }
    anim = null; canvas.focus();
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (down) down.moved += Math.abs(dx) + Math.abs(dy);
    if (ptrs.size === 1) {
      if ((e.buttons & 2) || (e.buttons & 4) || e.shiftKey) panBy(dx, dy);
      else { view.theta -= dx * 0.005; view.phi -= dy * 0.005; }
    } else if (ptrs.size === 2 && pinch) {
      const [a, b] = Array.from(ptrs.values()), d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      view.dist *= pinch.d / Math.max(d, 1); panBy(cx - pinch.cx, cy - pinch.cy); pinch = { d, cx, cy };
    }
    applyView();
  });
  const endPtr = (e) => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (down && ptrs.size === 0 && down.n === 1 && down.moved < 6 && performance.now() - down.t < 500 && down.btn === 0) pick(e.clientX, e.clientY);
    if (ptrs.size === 0) down = null;
  };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); view.dist *= Math.exp(e.deltaY * 0.0011); anim = null; applyView(); }, { passive: false });
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase(), s = 30;
    if (k === 'arrowleft' || k === 'a') panBy(-s, 0); else if (k === 'arrowright' || k === 'd') panBy(s, 0);
    else if (k === 'arrowup' || k === 'w') panBy(0, -s); else if (k === 'arrowdown' || k === 's') panBy(0, s);
    else if (k === 'q') view.theta += 0.1; else if (k === 'e') view.theta -= 0.1;
    else if (k === '+' || k === '=') view.dist *= 0.9; else if (k === '-') view.dist *= 1.1; else return;
    e.preventDefault(); applyView();
  });
  $('#bRotL').onclick = () => flyTo({ theta: view.theta + Math.PI / 4 }, 500);
  $('#bRotR').onclick = () => flyTo({ theta: view.theta - Math.PI / 4 }, 500);
  let lastPhi = 1.0;
  $('#bTop').onclick = () => { if (view.phi > 0.2) { lastPhi = view.phi; flyTo({ phi: 0.04 }, 600); } else flyTo({ phi: lastPhi }, 600); };
  $('#bHome').onclick = () => { closeCard(); flyTo(homeView(), 1400); };

  // ------------------------------------------------------------------ Sonne
  const sunVec = (alt, b) => new THREE.Vector3(Math.sin(b) * Math.cos(alt), Math.sin(alt), -Math.cos(b) * Math.cos(alt));
  function updateSunRig() {
    const half = clamp(view.dist * 0.8, 160, 700);
    sun.target.position.set(view.tx, 0, view.tz);
    sun.position.copy(sunDir).multiplyScalar(900).add(sun.target.position);
    const c = sun.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 10; c.far = 2200; c.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
  }
  const SKY = { day: new THREE.Color('#0c1f38'), tw: new THREE.Color('#1b2347'), night: new THREE.Color('#060d1a') };
  function applySun() {
    const s = S.sun, p = AL.sunPosition(new Date(AL.berlinToUTC(s.y, s.mo, s.d, Math.floor(s.min / 60), s.min % 60)), LAT, LON), altDeg = p.alt / rad;
    sunDir = sunVec(Math.max(p.alt, 0.02), p.bearing);
    const dayF = clamp((altDeg + 3) / 12, 0, 1);
    sun.intensity = 1.25 * dayF; sun.castShadow = S.L.shadows && altDeg > 0.5; hemi.intensity = 0.18 + 0.5 * dayF;
    scene.background.copy(altDeg > 6 ? SKY.day : altDeg > 0 ? SKY.tw.clone().lerp(SKY.day, altDeg / 6) : SKY.night.clone().lerp(SKY.tw, clamp((altDeg + 8) / 8, 0, 1)));
    S.dim = 0.22 + 0.78 * dayF;
    ovMat.color.setScalar(S.dim); CELL_LIST.forEach((c) => { if (c.mat) c.mat.color.setScalar(S.dim); });
    outer.material.color.setScalar(0.55 + 0.45 * dayF);
    updateSunRig();
    const t = AL.sunTimes(s.y, s.mo, s.d, LAT, LON);
    $('#sunDateLbl').textContent = longFmt.format(new Date(Date.UTC(s.y, s.mo - 1, s.d)));
    $('#sunTimeLbl').textContent = AL.hhmm(s.min) + ' Uhr';
    $('#sunInfo').textContent = (altDeg > 0 ? 'Sonne ' + Math.round(altDeg) + '° hoch aus ' + AL.compass(p.bearing) : 'Sonne unter dem Horizont') + (t.rise != null ? ' · Aufgang ' + AL.hhmm(t.rise) + ' · Untergang ' + AL.hhmm(t.set) : '');
    $('#sunDay').value = dayOfYear(s.y, s.mo, s.d); $('#sunTime').value = s.min; S.dirty = true;
    const dk = s.y + '-' + s.mo + '-' + s.d; // Haltestellen-Popup folgt dem gewählten Tag
    if (dk !== applySun.dk) { applySun.dk = dk; if (S.card && S.card.type === 'stop') renderStop(); }
  }
  const dayOfYear = (y, mo, d) => Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 864e5);
  const fromDayOfYear = (y, n) => { const dt = new Date(Date.UTC(y, 0, n)); return { mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() }; };
  function setSun(patch) { Object.assign(S.sun, patch); applySun(); if (S.spot) scheduleSpot(); }
  $('#sunDay').oninput = (e) => setSun(fromDayOfYear(S.sun.y, +e.target.value));
  $('#sunTime').oninput = (e) => setSun({ min: +e.target.value });
  $('#sunNow').onclick = () => { const n = nowB(); setSun({ y: n.y, mo: n.mo, d: n.d, min: n.h * 60 + n.mi }); };
  $$('[data-preset]').forEach((b) => { b.onclick = () => { const [mo, d] = b.dataset.preset.split('-').map(Number); setSun({ mo, d }); }; });
  let playTimer = null;
  $('#sunPlay').onclick = () => {
    S.playing = !S.playing; $('#sunPlay').textContent = S.playing ? '❚❚' : '▶'; clearInterval(playTimer);
    if (S.playing) playTimer = setInterval(() => { S.sun.min = (S.sun.min + 10) % 1440; applySun(); }, 90);
  };
  $('#sunShadows').onchange = (e) => { S.L.shadows = e.target.checked; $('[data-layer=shadows]').checked = S.L.shadows; applySun(); };

  // Verdeckungstest gegen die geladenen Gebaeude (Moeller-Trumbore)
  const ray = new THREE.Ray();
  function occluded(o, d) {
    ray.origin.copy(o); ray.direction.copy(d);
    for (const key in T) {
      const bl = T[key].bld;
      if (!bl || bl.empty || !ray.intersectsBox(bl.box)) continue;
      const { boxes, ts, te, idx, pos } = bl;
      for (let bi = 0; bi < boxes.length; bi++) {
        if (!ray.intersectsBox(boxes[bi])) continue;
        for (let t = ts[bi]; t < te[bi]; t++) {
          const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
          const ax = pos[i0], ay = pos[i0 + 1], az = pos[i0 + 2];
          const e1x = pos[i1] - ax, e1y = pos[i1 + 1] - ay, e1z = pos[i1 + 2] - az, e2x = pos[i2] - ax, e2y = pos[i2 + 1] - ay, e2z = pos[i2 + 2] - az;
          const px = d.y * e2z - d.z * e2y, py = d.z * e2x - d.x * e2z, pz = d.x * e2y - d.y * e2x, det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-9) continue;
          const inv = 1 / det, tx = o.x - ax, ty = o.y - ay, tz = o.z - az, u = (tx * px + ty * py + tz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (d.x * qx + d.y * qy + d.z * qz) * inv;
          if (v < 0 || u + v > 1) continue;
          if ((e2x * qx + e2y * qy + e2z * qz) * inv > 0.05) return true;
        }
      }
    }
    return false;
  }
  function dayProfile(p, y, mo, d, step) {
    const out = [];
    for (let m = 0; m < 1440; m += step) {
      const sp = AL.sunPosition(new Date(AL.berlinToUTC(y, mo, d, Math.floor(m / 60), m % 60)), LAT, LON);
      out.push(sp.alt < 0.01 ? 0 : occluded(p, sunVec(sp.alt, sp.bearing)) ? 1 : 2);
    }
    return out;
  }
  let spotTimer = null;
  const scheduleSpot = () => { clearTimeout(spotTimer); spotTimer = setTimeout(renderSpot, 120); };
  function renderSpot() {
    const box = $('#sunSpot'), sp = S.spot;
    if (!sp) { box.innerHTML = '<p class="note">Ein Gebäude oder eine Stelle auf der Karte anklicken, um die Besonnung dort zu sehen.</p>'; return; }
    const s = S.sun, step = 10, prof = dayProfile(sp.p, s.y, s.mo, s.d, step), sunMin = prof.filter((v) => v === 2).length * step, mons = [];
    for (let mo = 1; mo <= 12; mo++) mons.push(dayProfile(sp.p, s.y, mo, 15, 20).filter((v) => v === 2).length * 20 / 60);
    box.innerHTML = '<div class="big">' + esc(sp.label) + '</div><div class="row"><span>Am gewählten Tag</span><b>' + Math.floor(sunMin / 60) + ' h ' + AL.pad(sunMin % 60) + ' min Sonne</b></div>'
      + '<canvas id="dayBar" width="300" height="14" aria-label="Sonne und Schatten über den Tag"></canvas><div class="months" style="justify-content:space-between"><span>0</span><span>6</span><span>12</span><span>18</span><span>24 Uhr</span></div>'
      + '<div class="chart" aria-label="Sonnenstunden je Monat">' + mons.map((h, i) => '<i class="' + (i + 1 === s.mo ? 'sel' : '') + '" style="height:' + Math.max(2, h / 16 * 100) + '%" title="' + h.toFixed(1) + ' h"></i>').join('') + '</div>'
      + '<div class="months">' + 'JFMAMJJASOND'.split('').map((m) => '<span>' + m + '</span>').join('') + '</div>'
      + '<p class="note">Sonnenstunden pro Tag (Monatsmitte), ' + sp.p.y.toFixed(0) + ' m über Boden. Horizont nur aus Gebäuden (LoD2), ohne Bäume und Gelände. Schätzung ohne Gewähr.</p>';
    const cv = $('#dayBar'), cx = cv.getContext('2d'), w = cv.width / prof.length;
    prof.forEach((v, i) => { cx.fillStyle = v === 0 ? '#2b3350' : v === 1 ? '#8e9aa3' : '#f0b13e'; cx.fillRect(i * w, 0, w + 0.5, 14); });
  }

  // ------------------------------------------------------------------ Auswahl
  const caster = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.5);
  function tileMeshes() { const l = []; for (const k in T) { const b = T[k].bld; if (b && b.mesh && b.mesh.visible) l.push(b.mesh); } return l; }
  function pick(px, py) {
    const cr = canvas.getBoundingClientRect();
    caster.setFromCamera(new THREE.Vector2(((px - cr.left) / cr.width) * 2 - 1, -((py - cr.top) / cr.height) * 2 + 1), camera);
    const hit = S.L.buildings ? caster.intersectObjects(tileMeshes(), false)[0] : null;
    const gp = new THREE.Vector3(), hasG = caster.ray.intersectPlane(groundPlane, gp);
    if (hit && (!hasG || hit.distance < caster.ray.origin.distanceTo(gp))) {
      let key = null; for (const k in T) if (T[k].bld && T[k].bld.mesh === hit.object) key = k;
      const bl = T[key].bld, bi = bl.vb[bl.idx[hit.faceIndex * 3]], n = hit.face.normal.clone();
      if (n.dot(caster.ray.direction) > 0) n.negate();
      const p = hit.point.clone().addScaledVector(n, 0.4); p.y = Math.max(p.y, 1.0);
      selectBuilding(key, bi, p);
    } else if (hasG) {
      clearSel(); gp.y = 1.5;
      const where = nearestAddr(gp.x, gp.z), q = BRW ? brwAt(gp.x, gp.z) : null;
      if (q) openCard('<h3>Gewählte Stelle</h3><p class="sub">' + (where ? 'bei ' + esc(where) : 'ohne Adresse in der Nähe') + '</p><dl>' + brwRow(gp.x, gp.z) + '</dl>'
        + (q.aussen ? '<p class="note">Land- und Forstwirtschaft, gemeindeweit: ' + esc(landLine()) + '.</p>' : '') + BRW_NOTE + sourceLine('BORIS Brandenburg (LGB), dl-de/by-2.0', 'https://www.govdata.de/dl-de/by-2-0'));
      else closeCard();
      setSpot(gp, 'Gewählte Stelle' + (where ? ' (bei ' + where + ')' : ''));
    }
  }
  function nearestAddr(x, z) {
    let best = 60, r = null;
    ROWS.forEach((a) => { const d = Math.hypot(a[2] - x, a[3] - z); if (d < best) { best = d; r = a; } });
    return r ? STREETS[r[0]] + ' ' + r[1] + ', ' + otName(r[4]) : '';
  }
  function clearSel() { const old = S.sel; S.sel = null; if (old && T[old.key]) recolorTile(T[old.key]); }
  function selectBuilding(key, k, p) {
    clearSel(); S.sel = { key, k };
    const t = T[key]; recolorTile(t);
    const b = t.data.b[k];
    showBuilding(b);
    setSpot(p || new THREE.Vector3(b.x, b.t + 0.3, b.z), b.a.length ? 'Gebäude ' + STREETS[b.a[0][0]] + ' ' + b.a[0][1] : 'Gewähltes Gebäude · ' + (USE_DE[b.u] || 'Gebäude'));
  }
  function setSpot(p, label) { S.spot = { p, label }; $('#sunSpot').innerHTML = '<p class="note">Besonnung wird berechnet …</p>'; scheduleSpot(); }

  // ------------------------------------------------------------------ Karten und Panels
  const card = $('#card'), cardBody = $('#cardBody');
  function openCard(html) { S.card = null; cardBody.innerHTML = html; card.hidden = false; }
  function closeCard() { S.card = null; card.hidden = true; $$('.mk.sel').forEach((m) => m.classList.remove('sel')); }
  const sourceLine = (txt, url) => '<div class="src">Quelle: ' + (safeUrl(url) ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(txt) + '</a>' : esc(txt)) + '</div>';
  const ohDe = (oh) => String(oh).replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (m) => ({ Tu: 'Di', We: 'Mi', Th: 'Do', Su: 'So', PH: 'Feiertag' }[m] || m));

  function showBuilding(b) {
    const addr = b.a.map((a) => esc(STREETS[a[0]]) + ' ' + esc(a[1]));
    openCard('<h3>' + (addr.length ? addr[0] : 'Gebäude') + '</h3><p class="sub">' + (otName(b.o) ? esc(otName(b.o)) + ' · ' : '') + esc(USE_DE[b.u] || 'Nutzung unbekannt') + '</p><dl>'
      + (addr.length > 1 ? '<dt>Weitere Adressen</dt><dd>' + addr.slice(1).join(', ') + '</dd>' : '')
      + (addr.length ? '' : '<dt>Adresse</dt><dd>keine amtliche Adresse zugeordnet</dd>')
      + '<dt>Höhe</dt><dd>' + (b.h ? b.h.toFixed(1) + ' m über Grund' : '–') + '</dd><dt>Gesamthöhe</dt><dd>' + b.t.toFixed(1) + ' m</dd>' + brwRow(b.x, b.z) + '</dl>'
      + (BRW ? BRW_NOTE : '') + '<button class="chip" id="toSun">☀ Besonnung anzeigen</button>'
      + sourceLine('LGB Brandenburg: Gebäude LoD2 und Adressen (dl-de/by-2.0)', 'https://www.govdata.de/dl-de/by-2-0'));
    $('#toSun').onclick = () => openPanel('sun', true);
  }
  function showPlace(i, fly) {
    const p = PLACES[i], st = AL.openStatus(p.oh, nowB()), web = safeUrl(p.web), evs = EV.filter((e) => e.place === p.name);
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); p.marker.el.classList.add('sel');
    openCard('<h3>' + esc(p.name) + '</h3><p class="sub">' + esc(GROUPS[p.g].label) + ' · ' + esc(typeDe(p)) + (whereOf(p) ? ' · ' + esc(whereOf(p)) : '') + '</p><dl>'
      + (p.ad ? '<dt>Adresse</dt><dd>' + esc(p.ad) + '</dd>' : '') + '<dt>Jetzt</dt><dd><span class="tag ' + st.state + '">' + esc(st.text) + '</span></dd>'
      + '<dt>Zeiten</dt><dd>' + (p.oh ? esc(ohDe(p.oh)) + (p.ohw ? '<span class="s">laut Webseite, Stand ' + esc(fmtIso(p.wg)) + '</span>' : '') : p.wt ? esc(p.wt) + '<span class="s">Wortlaut der Webseite, Stand ' + esc(fmtIso(p.wg)) + '</span>' : 'nicht verifiziert') + '</dd>'
      + (p.tel ? '<dt>Telefon</dt><dd><a href="tel:' + esc(String(p.tel).replace(/[^+\d]/g, '')) + '">' + esc(p.tel) + '</a></dd>' : '')
      + (p.mail && /^[^\s@<>"]+@[^\s@<>"]+$/.test(p.mail) ? '<dt>E-Mail</dt><dd><a href="mailto:' + esc(p.mail) + '">' + esc(p.mail) + '</a></dd>' : '') + '</dl>'
      + (web ? '<a href="' + esc(web) + '" target="_blank" rel="noopener">Webseite öffnen →</a>' : '<p class="note">Keine Webseite in OpenStreetMap hinterlegt.</p>')
      + (evs.length ? '<p class="note">' + evs.length + ' Veranstaltung(en) hier' + (evs.some((e) => e.dummy) ? ' (Beispieldaten)' : '') + '.</p>' : '') + sourceLine('OpenStreetMap, Objekt ' + p.osm, 'https://www.openstreetmap.org/' + p.osm)
      + (p.wq && safeUrl(p.wq) && (p.wt || p.tel || p.mail || p.ohw) ? sourceLine('Zeiten und Kontakt: eigene Webseite, gelesen ' + fmtIso(p.wg), p.wq) : '')
      + (p.kq ? sourceLine(p.kq) : ''));
    if (fly) flyTo({ tx: p.x, tz: p.z, dist: Math.min(view.dist, 220), phi: Math.min(view.phi, 1.1) }, 900);
  }
  const fmtYmd = (s) => s.slice(6, 8) + '.' + s.slice(4, 6) + '.' + s.slice(0, 4);
  const opShort = (o) => String(o || '').replace(/\s+(GmbH|AG|mbH)$/i, '').replace('Verkehrsgesellschaft Teltow-Fläming', 'VGTF').replace('ODEG Ostdeutsche Eisenbahn', 'ODEG');
  function fpDeps(g, day) {
    const sd = day || S.stopDay || S.sun, ds = String(sd.y) + AL.pad(sd.mo) + AL.pad(sd.d);
    if (ds < FP.feedFrom || ds > FP.feedTo) return { err: 'Der Fahrplan (' + BETR + ') liegt nur vom ' + fmtYmd(FP.feedFrom) + ' bis ' + fmtYmd(FP.feedTo) + ' vor. Für diesen Tag gibt es keine Daten.' };
    const i = Math.round((Date.UTC(sd.y, sd.mo - 1, sd.d) - fpBase) / 864e5);
    if (i < 0 || i >= FP.n) return { err: 'Dieser Tag liegt außerhalb der aufbereiteten Daten (Stand ' + esc(FP.stand) + ').' };
    const out = [];
    g.d.forEach((x) => {
      if (x[0] < 1440 ? FP.svc[x[3]][i] === '1' : (i > 0 && FP.svc[x[3]][i - 1] === '1')) out.push([x[0] % 1440, x[1], x[2]]);
    });
    out.sort((a, b) => a[0] - b[0]);
    return { list: out };
  }
  // ------------------------------------------------------------------ Live Bahn und Bus (nur mit Einwilligung des Besuchers)
  // Echtzeit-Abfahrten und Meldungen kommen direkt aus dem Browser von v6.bvg.transport.rest bzw. v6.vbb.transport.rest (freie, inoffizielle Schnittstellen auf VBB-Daten).
  // Ohne Klick auf "Live-Daten einblenden" wird keine Verbindung aufgebaut.
  // Zwei freie, inoffizielle Instanzen derselben Schnittstelle (HAFAS-Daten des VBB-Netzes): fällt die eine aus, antwortet die andere.
  const VBB_HOSTS = ORT.liveHosts || []; // ort.json: fahrplan.live_hosts; leer = keine Live-Daten
  let vbbOk = false; try { vbbOk = localStorage.getItem('alw-vbb') === 'ja'; } catch (e) { /* ohne Speicher */ }
  const vbbSet = (on) => { try { if (on) localStorage.setItem('alw-vbb', 'ja'); else localStorage.removeItem('alw-vbb'); } catch (e) { /* egal */ } vbbOk = on; };
  let vbbHost = 0;
  async function vbbGet(path) {
    let err;
    for (let k = 0; k < VBB_HOSTS.length; k++) {
      const i = (vbbHost + k) % VBB_HOSTS.length, ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 9000); // nach 9 s aufgeben, nicht ewig warten
      try {
        const r = await fetch(VBB_HOSTS[i] + path, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
        if (!r.ok) throw new Error(r.status);
        const j = await r.json(); vbbHost = i; return j;
      } catch (e) { err = e; } finally { clearTimeout(tm); }
    }
    throw err;
  }
  const hostList = () => VBB_HOSTS.map((h) => '<b>' + esc(h.replace('https://', '')) + '</b>').join(' oder, falls diese nicht antwortet, ');
  const vbbConsent = (why) => '<div class="live"><b>Live-Daten Bahn und Bus</b><p class="note">' + why + ' Dafür verbindet sich Ihr Browser mit ' + hostList() + ' (freie, inoffizielle Schnittstellen). Dabei wird Ihre IP-Adresse an diesen Dienst übertragen. Ohne Zustimmung findet keine Verbindung statt. ' + (ORT.datenschutz ? '<a href="' + esc(ORT.datenschutz) + '" target="_blank" rel="noopener">Datenschutz</a>' : '') + '</p><button class="wxbtn" data-vbb="ja">Live-Daten einblenden</button></div>';
  const vbbHostName = () => VBB_HOSTS[vbbHost].replace('https://', '');
  const toLL = (x, z) => { const lat = M.origin.lat - z / 111194; return [lat, M.origin.lon + x / (111320 * Math.cos(lat * Math.PI / 180))]; };
  const vbbCache = {};
  async function vbbStopId(s) { // HAFAS-Haltestelle zur OSM-Haltestelle: bevorzugt die Kennung aus dem Fahrplan-Feed, sonst Namenssuche (nächstgelegene innerhalb von 500 m)
    if (s.hid !== undefined) return s.hid;
    if (s.g >= 0 && FPG[s.g] && FPG[s.g].h) { s.hid = FPG[s.g].h; return s.hid; }
    const [lat, lon] = toLL(s.x, s.z), kx = 111320 * Math.cos(lat * Math.PI / 180);
    const r = await vbbGet('/locations?query=' + encodeURIComponent(s.n) + '&results=6&stops=true&addresses=false&poi=false');
    let best = null, bd = 500;
    r.forEach((q) => { if (q.type !== 'stop' || !q.location) return; const d = Math.hypot((q.location.latitude - lat) * 111194, (q.location.longitude - lon) * kx); if (d < bd) { bd = d; best = q.id; } });
    s.hid = best; return best;
  }
  async function vbbDeps(s, mins, back) { // mins ab jetzt (höchstens 24 Stunden), back Minuten in die Vergangenheit (nur für die Haltestellenkarte)
    const id = await vbbStopId(s); if (!id) return null;
    mins = Math.min(mins, 1440); back = back || 0;
    const k = id + ':' + mins + ':' + back, c = vbbCache[k]; if (c && Date.now() - c.t < 60000) return c.d;
    const d = await vbbGet('/stops/' + id + '/departures?' + (back ? 'when=' + encodeURIComponent(new Date(Date.now() - back * 60000).toISOString()) + '&' : '') + 'duration=' + (mins + back) + '&results=' + (back ? 45 : 25) + '&remarks=true&language=de');
    vbbCache[k] = { t: Date.now(), d }; return d;
  }
  const clockFmt = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
  const lnClass = (p) => (p === 'bus' ? 'bus' : p === 'suburban' ? 'sbahn' : p === 'tram' ? 'tram' : p === 'regional' || p === 'express' ? 'bahn' : '');
  const warnTexts = (dep) => { const m = new Map(); (dep.departures || []).forEach((x) => (x.remarks || []).forEach((r) => { if (r.type === 'warning' && (r.summary || r.text)) m.set(r.summary || r.text, r); })); return [...m.values()]; };
  const warnHtml = (list) => list.map((r) => '<div class="warnbox"><b>' + esc(r.summary || '') + '</b>' + (r.text && r.text !== r.summary ? '<span class="s">' + esc(String(r.text).slice(0, 320)) + '</span>' : '') + '</div>').join('');
  // Nur Abfahrten ab jetzt: bei Verspätung zählt die tatsächliche Zeit, bei Ausfall die planmäßige (eine Minute Nachlauf)
  const depTime = (x) => new Date(x.cancelled ? x.plannedWhen : (x.when || x.plannedWhen)).getTime();
  const depUpcoming = (x) => depTime(x) >= Date.now() - 60000;
  const isRailDep = (x) => !!(x.line && ['suburban', 'regional', 'express'].indexOf(x.line.product) >= 0);
  const depRecentRail = (x) => !depUpcoming(x) && isRailDep(x) && depTime(x) >= Date.now() - 3600000; // Züge der letzten Stunde: war der Zug pünktlich?
  function depRow(x) {
    const when = x.when || x.plannedWhen, delay = Math.round((x.delay || 0) / 60), late = x.cancelled ? '' : delay >= 1 ? '<span class="del">+' + delay + '</span>' : '';
    return '<div class="dep' + (x.cancelled || !depUpcoming(x) ? ' past' : '') + '"><span class="t">' + clockFmt.format(new Date(x.cancelled ? x.plannedWhen : when)) + '</span>' + late + '<span class="ln ' + lnClass(x.line && x.line.product) + '">' + esc(x.line ? x.line.name : '?') + '</span><span class="hd">'
      + esc(x.direction || '') + '<span class="s">' + (x.cancelled ? '<b class="del">fällt aus</b> · ' : '') + (x.platform ? 'Gleis/Steig ' + esc(x.platform) : '') + '</span></span></div>';
  }
  function bindVbb(box, again) {
    const b = $('[data-vbb]', box); if (b) b.onclick = () => { vbbSet(true); again(); };
    const o = $('[data-vbb-off]', box); if (o) o.onclick = (e) => { e.preventDefault(); vbbSet(false); again(); };
    const r = $('[data-vbb-retry]', box); if (r) r.onclick = (e) => { e.preventDefault(); again(); };
  }
  async function liveFill(s, box) {
    const again = () => liveFill(s, box);
    if (!VBB_HOSTS.length) { box.innerHTML = ''; return; }
    if (!vbbOk) { box.innerHTML = vbbConsent('Echtzeit-Abfahrten mit Verspätungen und Meldungen für diese Haltestelle.'); bindVbb(box, again); return; }
    box.innerHTML = '<p class="note">Live-Daten werden geladen …</p>';
    try {
      const d = await vbbDeps(s, 180, 60);
      if (!S.card || S.card.type !== 'stop' || S.card.i !== s.i) return;
      if (!d) { box.innerHTML = '<p class="note">Live: Haltestelle im Echtzeitdienst nicht gefunden.</p>'; return; }
      const w = warnTexts(d), all = d.departures || [], list = all.filter(depRecentRail).slice(-4).concat(all.filter(depUpcoming).slice(0, 8)); // bis zu 4 Züge der letzten Stunde (grau), dann die nächsten
      box.innerHTML = '<div class="live"><b>Live, nächste 3 Stunden</b>' + warnHtml(w) + (list.length ? '<div class="deps">' + list.map(depRow).join('') + '</div>' : '<p class="note">In den nächsten 3 Stunden fährt hier laut Echtzeitdienst nichts ab.</p>')
        + '<p class="note">Quelle: Echtzeitdaten (' + BETR + ') über ' + vbbHostName() + ', Stand ' + (d.realtimeDataUpdatedAt ? clockFmt.format(new Date(d.realtimeDataUpdatedAt * 1000)) + ' Uhr' : 'unbekannt') + '. Inoffiziell, ohne Gewähr. <a href="#" data-vbb-off>Live-Daten ausblenden</a></p></div>';
      bindVbb(box, again);
    } catch (e) { box.innerHTML = '<p class="note">Live-Daten zurzeit nicht abrufbar: Die Dienste antworten nicht. <a href="#" data-vbb-retry>Erneut versuchen</a> · <a href="#" data-vbb-off>Live-Daten ausblenden</a></p>'; }
  }
  async function trafficFill() {
    const box = $('#trafficBody'), again = trafficFill;
    if (!VBB_HOSTS.length) { box.innerHTML = ''; return; }
    if (!vbbOk) { box.innerHTML = vbbConsent('Aktuelle Meldungen, Verspätungen und Ausfälle an den Bahnhöfen der Gemeinde.'); bindVbb(box, again); return; }
    box.innerHTML = '<p class="note">Live-Daten werden geladen …</p>';
    const seen = new Set(), st = STOPS.filter((q) => q.k === 'rail' && !seen.has(q.n) && seen.add(q.n)).slice(0, 5);
    try {
      const res = await Promise.all(st.map((q) => vbbDeps(q, 120).then((d) => ({ q, d })).catch(() => ({ q, d: null }))));
      const ok = res.filter((r) => r.d);
      if (!ok.length) { box.innerHTML = '<p class="note">Live-Daten zurzeit nicht abrufbar: Die Dienste antworten nicht. <a href="#" data-vbb-retry>Erneut versuchen</a> · <a href="#" data-vbb-off>Live-Daten ausblenden</a></p>'; return; }
      const all = new Map(); ok.forEach((r) => warnTexts(r.d).forEach((w) => all.set(w.summary || w.text, w)));
      let html = '<h3 class="lh">Meldungen</h3>' + (all.size ? warnHtml([...all.values()]) : '<p class="note">Keine Meldungen an den Bahnhöfen der Gemeinde.</p>');
      html += '<h3 class="lh">Verspätungen und Ausfälle</h3>';
      const bad = [];
      ok.forEach((r) => (r.d.departures || []).filter(depUpcoming).forEach((x) => { if (x.cancelled || (x.delay || 0) >= 300) bad.push([r.q.n, x]); }));
      html += bad.length ? '<div class="deps">' + bad.slice(0, 12).map(([n, x]) => '<div class="s lh2">' + esc(n) + '</div>' + depRow(x)).join('') + '</div>' : '<p class="note">Keine Ausfälle und keine Verspätungen ab 5 Minuten in den nächsten 2 Stunden.</p>';
      html += '<h3 class="lh">Nächste Abfahrten</h3>' + ok.map((r) => '<div class="s lh2">' + esc(r.q.n) + '</div><div class="deps">' + ((r.d.departures || []).filter(depUpcoming).slice(0, 3).map(depRow).join('') || '<p class="note">Keine Abfahrt in 2 Stunden.</p>') + '</div>').join('');
      html += '<p class="note">Quelle: Echtzeitdaten (' + BETR + ') über ' + vbbHostName() + ' (inoffiziell), Bahnhöfe: ' + esc(ok.map((r) => r.q.n).join(', ')) + '. Ohne Gewähr, maßgeblich sind die Auskünfte der Verkehrsunternehmen. <a href="#" data-vbb-off>Live-Daten ausblenden</a></p>';
      box.innerHTML = html; bindVbb(box, again);
    } catch (e) { box.innerHTML = '<p class="note">Live-Daten zurzeit nicht abrufbar: Die Dienste antworten nicht. <a href="#" data-vbb-retry>Erneut versuchen</a> · <a href="#" data-vbb-off>Live-Daten ausblenden</a></p>'; }
  }

  function renderStop() {
    const s = STOPS[S.card.i], g = s.g >= 0 ? FPG[s.g] : null, n = nowB(), sd = S.stopDay || (S.stopDay = { y: n.y, mo: n.mo, d: n.d }); // eigener Tag der Haltestelle, nicht der Tag des Sonnenstands
    const isToday = sd.y === n.y && sd.mo === n.mo && sd.d === n.d, nowMin = n.h * 60 + n.mi;
    let html = '<h3>' + esc(s.n) + '</h3><p class="sub">' + (s.k === 'rail' ? 'Bahnhof / Haltepunkt' : 'Bushaltestelle') + (whereOf(s) ? ' · ' + esc(whereOf(s)) : '') + '</p>';
    if (!g) html += '<p class="note">Zu dieser Haltestelle wurde im Fahrplan keine passende Haltestelle gefunden (Lage oder Name weichen ab).</p>';
    else {
      const r = fpDeps(g);
      if (r.list && isToday) { // heute: nur die nächsten 24 Stunden ab jetzt (Rest von heute plus die frühen Abfahrten von morgen), nichts Vergangenes
        const tm = new Date(Date.UTC(n.y, n.mo - 1, n.d + 1)), rt = fpDeps(g, { y: tm.getUTCFullYear(), mo: tm.getUTCMonth() + 1, d: tm.getUTCDate() });
        r.list = r.list.filter(([m, ri]) => m >= nowMin || (m >= nowMin - 60 && ['bahn', 'sbahn', 'ubahn'].indexOf(FP.routes[ri][1]) >= 0)).concat(rt.list ? rt.list.filter(([m]) => m < nowMin).map((x) => [x[0], x[1], x[2], 1]) : []);
      }
      const dayTxt = dateFmt.format(new Date(Date.UTC(sd.y, sd.mo - 1, sd.d)));
      html += '<div class="daynav"><button class="chip" data-d="-1" aria-label="Vortag">◀</button><b>' + esc(dayTxt) + (isToday ? ' (heute)' : '') + '</b><button class="chip" data-d="1" aria-label="Folgetag">▶</button><button class="chip" data-d="0">Heute</button></div>';
      if (r.err) html += '<p class="note">' + r.err + '</p>';
      else if (!r.list.length) html += '<p class="note">' + (isToday ? 'Heute fährt hier laut Sollfahrplan nichts mehr ab.' : 'An diesem Tag fährt hier laut Sollfahrplan nichts ab.') + '</p>';
      else {
        let nextDone = false, sev = false;
        html += '<p class="note">' + (isToday ? r.list.filter(([m, ri, hi, tmr]) => tmr || m >= nowMin).length : r.list.length) + (isToday ? ' Abfahrten in den nächsten 24 Stunden, dazu die Züge der letzten Stunde (grau)' : ' Abfahrten am gewählten Tag') + '</p><div class="deps" id="deps">' + r.list.map(([m, ri, hi, tmr]) => {
          const rt = FP.routes[ri], past = isToday && !tmr && m < nowMin, next = isToday && !past && !nextDone;
          if (next) nextDone = true;
          if (rt[1] === 'sev') sev = true;
          return '<div class="dep' + (past ? ' past' : '') + (next ? ' next' : '') + '"><span class="t">' + AL.hhmm(m) + (tmr ? '<span class="s"> morgen</span>' : '') + '</span><span class="ln ' + esc(rt[1]) + '"' + (rt[1] === 'sev' ? ' title="Bus unter einer Bahnliniennummer, vermutlich Schienenersatzverkehr"' : '') + '>' + esc(rt[0]) + '</span><span class="hd">'
            + esc(FP.heads[hi]) + '<span class="s">' + esc(opShort(rt[2])) + '</span></span></div>';
        }).join('') + '</div>' + (sev ? '<p class="note">Grau-gelbe Linien: Bus unter einer Bahnliniennummer, vermutlich Schienenersatzverkehr (Schlussfolgerung aus den Daten).</p>' : '');
      }
      html += '<p class="note">Sollfahrplan ohne Echtzeit, ohne Gewähr. Abweichungen, Baustellen und Ausfälle sind nicht enthalten.</p>';
    }
    html += sourceLine('Fahrplan: ' + (ORT.betreiberKurz || '') + ' (' + (ORT.lizenz || '') + '), Stand ' + (FP ? fmtYmd(FP.stand.replace(/-/g, '')) : '–') + '; Lage: OpenStreetMap', ORT.lizenzUrl || '#');
    html = html.replace('</p>', '</p><div id="liveBox"></div>');
    openCard(html); S.card = { type: 'stop', i: s.i };
    liveFill(s, $('#liveBox', cardBody));
    $$('[data-d]', cardBody).forEach((b) => { b.onclick = () => {
      const k = +b.dataset.d, t = new Date(k === 0 ? Date.UTC(n.y, n.mo - 1, n.d) : Date.UTC(sd.y, sd.mo - 1, sd.d + k));
      S.stopDay = { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
      renderStop();
    }; });
    const nx = $('.dep.next', cardBody), box = $('#deps', cardBody);
    if (nx && box) box.scrollTop = Math.max(0, nx.offsetTop - box.offsetTop - 6);
  }
  function showStop(i) {
    const s = STOPS[i];
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); s.marker.el.classList.add('sel');
    S.card = { type: 'stop', i };
    renderStop();
    flyTo({ tx: s.x, tz: s.z, dist: Math.min(view.dist, 260), phi: Math.min(view.phi, 1.1) }, 900);
  }
  function showEvent(e) {
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); if (e.marker) e.marker.el.classList.add('sel');
    openCard('<h3>' + esc(e.title) + '</h3><p class="sub">' + (e.dummy ? '<span class="tag unknown">Beispieldaten</span> ' : '') + esc(dateFmt.format(new Date(e.t))) + ', ' + esc(e.from) + (e.to ? '–' + esc(e.to) : '') + ' Uhr</p><dl>'
      + '<dt>Ort</dt><dd>' + esc(e.place || 'unbekannt') + (e.placeNote ? '<span class="s">' + esc(e.placeNote) + '</span>' : '') + '</dd><dt>Kategorie</dt><dd>' + esc(e.cat || '–') + '</dd></dl>'
      + (e.desc ? '<p>' + esc(e.desc) + '</p>' : '') + (e.url && !e.dummy ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">Zur Veranstaltung beim Veranstalter →</a>' : '')
      + sourceLine(e.dummy ? 'Platzhalter, keine echte Veranstaltung' : (e.source || 'unbekannt'), e.url));
    flyTo({ tx: e.x, tz: e.z, dist: Math.min(view.dist, 300), phi: Math.min(view.phi, 1.1) }, 900);
  }
  function showEventsAt(list) {
    openCard('<h3>' + esc(list[0].place || 'Veranstaltungen') + '</h3><p class="sub">' + list.length + ' Veranstaltung(en)</p>'
      + list.map((e) => '<button class="item" data-ev="' + EV.indexOf(e) + '"><span class="t">' + esc(e.from) + '</span><span>' + esc(e.title) + '<span class="s">' + esc(dateFmt.format(new Date(e.t))) + '</span></span></button>').join(''));
    $$('[data-ev]', cardBody).forEach((b) => { b.onclick = () => showEvent(EV[+b.dataset.ev]); });
  }
  function goOrtsteil(i) {
    const o = OT[i], nA = ROWS.filter((r) => r[4] === i).length, rail = STOPS.filter((s) => s.o === i && s.k === 'rail'), bus = STOPS.filter((s) => s.o === i && s.k === 'bus').length;
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); o.marker.el.classList.add('sel');
    const ew = ewText(o), inf = o.info || {};
    openCard('<h3>' + esc(o.n) + '</h3><p class="sub">Ortsteil: ' + esc(ART) + ' ' + esc(ORT_NAME) + '</p><dl>'
      + '<dt>Einwohner</dt><dd>' + (ew ? esc(ew) + '<span class="s">Angabe im Ortsporträt der Gemeinde</span>' : 'keine Angabe der Gemeinde') + '</dd>'
      + '<dt>Fläche</dt><dd>' + km2(o) + ' km²<span class="s">nach der Grenze in OpenStreetMap</span></dd>'
      + (inf.erstwaehnung ? '<dt>Erwähnt seit</dt><dd>' + inf.erstwaehnung + '</dd>' : '')
      + (inf.sehenswert && inf.sehenswert.length ? '<dt>Sehenswert</dt><dd>' + inf.sehenswert.map(esc).join(', ') + '<span class="s">laut Ortsporträt der Gemeinde</span></dd>' : '')
      + '<dt>Adressen</dt><dd>' + nA + '</dd><dt>Gebäude</dt><dd>' + o.nB + '</dd><dt>Bahnhof</dt><dd>' + (rail.length ? esc(rail[0].n) + ' (DB)' : 'keiner') + '</dd>'
      + '<dt>Bushaltepunkte</dt><dd>' + bus + '</dd><dt>Orte</dt><dd>' + PLACES.filter((p) => p.o === i).length + '</dd>'
      + (BRW && BRW_Z.some((q) => q.o === i) ? '<dt>Bodenrichtwert</dt><dd>' + BRW_Z.filter((q) => q.o === i).map((q) => '<b>' + esc(fmtW(q.w)) + '</b> <span class="s">' + esc(q.artDe) + '</span>').join('') + '<span class="s">Stichtag ' + esc(fmtIso(BRW.stichtag)) + ', Bauland</span></dd>' : '') + '</dl>'
      + (ORTSTEILE_SEITE ? '<a href="' + ORTSTEILE_SEITE + '" target="_blank" rel="noopener">Ortsporträt auf der Website von ' + esc(ORT_NAME) + ' →</a>' : '')
      + sourceLine('Ortsporträts: Website der Gemeinde' + (M.ortsteilInfo && M.ortsteilInfo.gelesen ? ' (gelesen ' + fmtIso(M.ortsteilInfo.gelesen) + ')' : '') + '; Grenzen: OpenStreetMap; Adressen und Gebäude: LGB', ORTSTEILE_SEITE));
    flyTo({ tx: o.x, tz: o.z, dist: 1500, phi: 0.95 }, 1600);
  }

  function openPanel(name, keep) {
    if (name === 'sources') { const d = $('#sources'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); return; }
    S.panel = (S.panel === name && !keep) ? null : name;
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + S.panel; });
    $$('.pill[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === S.panel));
    document.body.classList.toggle('has-panel', !!S.panel);
    if (S.panel === 'sun') { applySun(); if (S.spot) scheduleSpot(); }
    if (S.panel === 'traffic') { trafficFill(); if (window.ALL) window.ALL.baustellen($('#bauBox')); }
  }
  $$('.pill[data-panel]').forEach((b) => { b.onclick = () => openPanel(b.dataset.panel); });
  $$('[data-close="panel"]').forEach((b) => { b.onclick = () => openPanel(S.panel); });
  $('[data-close="card"]').onclick = () => { closeCard(); clearSel(); };
  $('[data-close="dialog"]').onclick = () => $('#sources').close();

  // Veranstaltungsliste
  { // Kategorien als Schaltflächen: beliebig viele an- und abwählbar, "Alle" hebt die Auswahl auf
    const box = $('#evCatChips'), cats = Array.from(new Set(EV.map((e) => e.cat).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'de'));
    const sync = () => $$('.chip', box).forEach((x) => { const on = x.dataset.c === '' ? S.evCats.size === 0 : S.evCats.has(x.dataset.c); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    [''].concat(cats).forEach((c) => {
      const b = document.createElement('button'); b.className = 'chip' + (c === '' ? ' on' : ''); b.textContent = c === '' ? 'Alle Kategorien' : c; b.dataset.c = c; b.setAttribute('aria-pressed', c === '' ? 'true' : 'false');
      b.onclick = () => { if (c === '') S.evCats.clear(); else if (S.evCats.has(c)) S.evCats.delete(c); else S.evCats.add(c); sync(); renderEvents(); };
      box.appendChild(b);
    });
  }
  const evMatch = (e) => e.off >= 0 && (S.evArea === 'all' || (S.evArea === 'nb') === !!e.nbE) && (!S.evCats.size || S.evCats.has(e.cat)) && (S.evFilter === 'today' ? e.off === 0 : S.evFilter === 'weekend' ? e.dow >= 5 && e.off <= 13 : S.evFilter === '30' ? e.off <= 30 : true);
  function renderEvents() {
    let html = '', last = '';
    EV.filter(evMatch).forEach((e) => {
      const day = dateFmt.format(new Date(e.t));
      if (day !== last) { html += '<div class="dayhead">' + esc(day) + '</div>'; last = day; }
      html += '<button class="item" data-ev="' + EV.indexOf(e) + '"><span class="t">' + esc(e.from) + '</span><span>' + esc(e.title) + '<span class="s">' + esc(e.place || '') + (e.nbE ? ' · ' + esc(NB_NAME) : '') + '</span></span></button>';
    });
    $('#evList').innerHTML = html || '<p class="note">Keine Veranstaltungen im gewählten Zeitraum.</p>';
    $$('#evList [data-ev]').forEach((b) => { b.onclick = () => showEvent(EV[+b.dataset.ev]); });
  }
  $$('#evFilter .chip').forEach((c) => { c.onclick = () => { S.evFilter = c.dataset.f; $$('#evFilter .chip').forEach((x) => x.classList.toggle('on', x === c)); renderEvents(); }; });
  const evArea = $('#evArea');
  if (evArea && EV.some((e) => e.nbE)) { evArea.hidden = false; evArea.onchange = () => { S.evArea = evArea.value; renderEvents(); }; }

  // Ortsliste
  const plFilter = $('#plFilter');
  [['', 'Alle']].concat(Object.keys(GROUPS).filter((g) => PLACES.some((p) => p.g === g)).map((g) => [g, GROUPS[g].icon + ' ' + GROUPS[g].label])).forEach(([k, l]) => {
    const b = document.createElement('button'); b.className = 'chip' + (k === '' ? ' on' : ''); b.textContent = l; b.dataset.g = k; b.setAttribute('aria-pressed', k === '' ? 'true' : 'false');
    b.onclick = () => { // Mehrfachauswahl: jede Gruppe lässt sich an- und abwählen, "Alle" hebt die Auswahl auf
      if (k === '') S.plSel.clear(); else if (S.plSel.has(k)) S.plSel.delete(k); else S.plSel.add(k);
      $$('.chip', plFilter).forEach((x) => { const on = x.dataset.g === '' ? S.plSel.size === 0 : S.plSel.has(x.dataset.g); x.classList.toggle('on', on); x.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      renderPlaces(); S.dirty = true; S.moved = true;
    };
    plFilter.appendChild(b);
  });
  const plArea = $('#plArea');
  if (plArea && PLACES.some((p) => p.nb)) { plArea.hidden = false; plArea.onchange = () => { S.plArea = plArea.value; renderPlaces(); }; }
  function renderPlaces() {
    const n = nowB();
    $('#plList').innerHTML = PLACES.filter((p) => (!S.plSel.size || S.plSel.has(p.g)) && (S.plArea === 'all' || (S.plArea === 'nb') === !!p.nb)).map((p) => {
      const st = AL.openStatus(p.oh, n);
      return '<button class="item" data-pl="' + p.i + '"><span class="ic">' + p.ic + '</span><span><b>' + esc(p.name) + '</b><span class="s">' + esc(typeDe(p)) + (whereOf(p) ? ' · ' + esc(whereOf(p)) : '') + '</span><span class="tag ' + st.state + '">' + esc(st.text) + '</span></span></button>';
    }).join('');
    $$('#plList [data-pl]').forEach((b) => { b.onclick = () => showPlace(+b.dataset.pl, true); });
  }

  // ------------------------------------------------------------------ Neuigkeiten (Wochenlauf: scripts/update_weekly.py)
  const NEWS = window.AL_NEWS || { items: [], first: true };
  const NEWS_ICON = { poi_new: '📍', poi_oh: '🕒', poi_web: '🔗', poi_gone: '✖', stop_new: '🚏', stop_gone: '🚏', feed: '🚆', line_new: '🚌', line_gone: '🚌', event_new: '📅', addr: '🏠', bld: '🏗' };
  const dayMs = 864e5, todayMs = Date.UTC(today.y, today.mo - 1, today.d);
  const ageDays = (iso) => Math.round((todayMs - Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))) / dayMs);
  function openNews(it) {
    if (it.ref && it.ref.poi) { const p = PLACES.find((q) => q.osm === it.ref.poi); if (p) return showPlace(p.i, true); }
    if (it.ref && it.ref.event) { const e = EV.find((q) => q.id === it.ref.event); if (e) return showEvent(e); }
    if (it.x != null) { closeCard(); flyTo({ tx: it.x, tz: it.z, dist: 320, phi: 0.95 }, 1000); }
  }
  function renderNews() {
    const items = NEWS.items, recent = items.filter((i) => ageDays(i.date) <= 7).length;
    $('#nNews').textContent = recent; $('#nNews').hidden = !recent;
    $('#newsInfo').textContent = NEWS.stand
      ? 'Stand der Daten: ' + fmtIso(NEWS.stand) + (NEWS.since ? ', verglichen mit ' + fmtIso(NEWS.since) : '') + '. Gezeigt werden die letzten ' + (NEWS.keepDays || 28) + ' Tage.'
      : 'Noch kein Wochenlauf ausgeführt.';
    let html = '', last = '';
    items.forEach((it, n) => {
      if (it.date !== last) { html += '<div class="dayhead">' + esc(fmtIso(it.date)) + (ageDays(it.date) === 0 ? ' (heute)' : '') + '</div>'; last = it.date; }
      html += '<button class="item" data-nw="' + n + '"><span class="ic">' + (NEWS_ICON[it.kind] || '•') + '</span><span><b>' + esc(it.title) + '</b>' + (it.sub ? '<span class="s">' + esc(it.sub) + '</span>' : '') + '</span></button>';
    });
    $('#newsList').innerHTML = html || '<p class="note">' + (NEWS.first
      ? 'Der Ausgangsstand ist gespeichert. Ab dem nächsten Wochenlauf erscheinen hier neue und geänderte Orte, Haltestellen, Fahrpläne und Veranstaltungen.'
      : 'Seit dem letzten Lauf hat sich nichts geändert.') + '</p>';
    $$('#newsList [data-nw]').forEach((b) => { b.onclick = () => openNews(items[+b.dataset.nw]); });
    items.filter((i) => i.kind === 'poi_new' && ageDays(i.date) <= 14 && i.ref).forEach((i) => { const p = PLACES.find((q) => q.osm === i.ref.poi); if (p) p.marker.el.classList.add('neu'); });
  }
  renderNews();

  // ------------------------------------------------------------------ Suche (Strasse, Hausnummer, Ort)
  const norm = (s) => String(s).toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/str\./g, 'strasse').replace(/\s+/g, ' ').trim();
  const STREETS_N = STREETS.map(norm);
  const qIn = $('#q'), qRes = $('#qres');
  let qOt = -1, qItems = [];
  function searchRun() {
    const raw = norm(qIn.value);
    qItems = [];
    if (raw.length < 2) { qRes.hidden = true; return; }
    const m = raw.match(/^(.*?)(?:\s+(\d+)\s*([a-z]?))?$/), sp = (m[1] || '').trim(), num = m[2] || '', ext = m[3] || '';
    const sIdx = [];
    if (sp) STREETS_N.forEach((s, i) => { if (s.indexOf(sp) >= 0) sIdx.push(i); });
    sIdx.sort((a, b) => (STREETS_N[a].indexOf(sp) === 0 ? 0 : 1) - (STREETS_N[b].indexOf(sp) === 0 ? 0 : 1) || a - b);
    if (num && sIdx.length) {
      const want = num + ext;
      ROWS.filter((r) => sIdx.indexOf(r[0]) >= 0 && norm(r[1]).indexOf(want) === 0 && (qOt < 0 || r[4] === qOt))
        .sort((a, b) => (norm(a[1]) === want ? 0 : 1) - (norm(b[1]) === want ? 0 : 1)).slice(0, 10)
        .forEach((r) => qItems.push({ t: STREETS[r[0]] + ' ' + r[1], s: otName(r[4]), a: () => goAddress(r) }));
    } else if (sIdx.length) {
      const seen = {};
      ROWS.forEach((r) => {
        if (sIdx.indexOf(r[0]) < 0) return;
        const k = r[0] + '_' + r[4]; (seen[k] = seen[k] || { s: r[0], o: r[4], n: 0, x: 0, z: 0 }); const g = seen[k]; g.n++; g.x += r[2]; g.z += r[3];
      });
      Object.keys(seen).map((k) => seen[k]).sort((a, b) => sIdx.indexOf(a.s) - sIdx.indexOf(b.s) || a.o - b.o).slice(0, 8).forEach((g) => {
        qItems.push({ t: STREETS[g.s], s: otName(g.o) + ' · ' + g.n + ' Hausnummern', a: () => { qOt = g.o; qIn.value = STREETS[g.s] + ' '; qIn.focus(); flyTo({ tx: g.x / g.n, tz: g.z / g.n, dist: 450, phi: 0.95 }, 1200); searchRun(); } });
      });
    }
    if (!num) {
      OT.forEach((o, i) => { if (norm(o.n).indexOf(raw) >= 0) qItems.push({ t: o.n, s: 'Ortsteil', a: () => { goOrtsteil(i); } }); });
      PLACES.filter((p) => norm(p.name).indexOf(raw) >= 0).slice(0, 4).forEach((p) => qItems.push({ t: p.name, s: (TYPE_DE[p.t] || 'Ort') + (whereOf(p) ? ' · ' + whereOf(p) : ''), a: () => showPlace(p.i, true) }));
    }
    qRes.innerHTML = qItems.length ? qItems.map((it, i) => '<button class="item" data-q="' + i + '"><span><b>' + esc(it.t) + '</b><span class="s">' + esc(it.s) + '</span></span></button>').join('') : '<p class="note">Keine Treffer. Straße und Hausnummer getrennt eingeben, z. B. „Kastanienallee 21".</p>';
    qRes.hidden = false;
    $$('[data-q]', qRes).forEach((b) => { b.onclick = () => { const it = qItems[+b.dataset.q]; it.a(); if (!/ $/.test(qIn.value)) qRes.hidden = true; }; });
  }
  function goAddress(r) {
    qRes.hidden = true; qIn.value = STREETS[r[0]] + ' ' + r[1]; qIn.blur();
    flyTo({ tx: r[2], tz: r[3], dist: 140, phi: 0.95 }, 1500);
    if (r[7] >= 0) { S.pending = { key: r[5] + '_' + r[6], k: r[7] }; loadTile(S.pending.key); }
    else { clearSel(); openCard('<h3>' + esc(STREETS[r[0]] + ' ' + r[1]) + '</h3><p class="sub">' + esc(otName(r[4])) + '</p><p class="note">Zu dieser Adresse gibt es kein Gebäudemodell in der Nähe.</p>' + sourceLine('LGB Brandenburg, Adressen (dl-de/by-2.0)', 'https://www.govdata.de/dl-de/by-2-0')); }
  }
  qIn.addEventListener('input', () => { if (!qIn.value.trim()) qOt = -1; searchRun(); });
  qIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && qItems[0]) { e.preventDefault(); qItems[0].a(); } if (e.key === 'Escape') { qRes.hidden = true; } });
  qIn.addEventListener('focus', () => { if (qIn.value.trim().length >= 2) searchRun(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) qRes.hidden = true; });

  // ------------------------------------------------------------------ Menues
  $$('input[name=colormode]').forEach((r) => { r.onchange = () => { S.colorMode = r.value; for (const k in T) recolorTile(T[k]); updateLegend(); }; });
  const otSel = $('#otSel');
  OT.forEach((o, i) => { const op = document.createElement('option'); op.value = i; op.textContent = o.n; otSel.appendChild(op); });
  if (M.nb && M.nb.x != null) { const op = document.createElement('option'); op.value = 'nb'; op.textContent = M.nb.n + ' (Nachbarort)'; otSel.appendChild(op); }
  otSel.onchange = () => {
    if (otSel.value === 'nb') flyTo({ tx: M.nb.x, tz: M.nb.z, dist: 2400, phi: 0.9 }, 1200);
    else if (otSel.value !== '') goOrtsteil(+otSel.value);
    otSel.value = '';
  };
  function applyLayers() {
    ground.visible = S.L.photo; flat.visible = !S.L.photo; if (!S.L.photo) ensureAreas();
    for (const k in T) { const t = T[k]; if (t.bld && t.bld.mesh) t.bld.mesh.visible = S.L.buildings; if (t.trees && t.trees.mesh) t.trees.mesh.visible = S.L.trees; }
    borders.visible = S.L.borders; brwGroup.visible = S.L.brw; updateLegend(); $('#sunShadows').checked = S.L.shadows; applySun(); S.moved = true; S.dirty = true;
  }
  $$('[data-layer]').forEach((c) => {
    c.onchange = () => {
      S.L[c.dataset.layer] = c.checked;
      if (c.dataset.layer === 'photo' && !c.checked) { S.L.roads = true; $('[data-layer=roads]').checked = true; }
      applyLayers();
    };
  });
  $('#sourcesBody').innerHTML = '<ul>'
    + '<li><b>Luftbild, Gebäude (3D, LoD2), Adressen:</b> © GeoBasis-DE/LGB, <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2-0</a> (Daten geändert). Landesvermessung und Geobasisinformation Brandenburg. ' + M.nBuildings + ' Gebäude, ' + M.nAddr + ' Adressen, Stand ' + esc(M.stand) + '. Das Luftbild ist ein Abzug mit 1 bis 2 m je Bildpunkt, nicht das Original mit 20 cm.</li>'
    + '<li><b>Straßen, Orte, Haltestellen, Flächen, Grenzen, Öffnungszeiten:</b> © OpenStreetMap-Mitwirkende, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ODbL</a>. Öffnungszeiten stammen aus OSM und können veraltet sein.</li>'
    + (BRW ? '<li><b>Bodenrichtwerte:</b> BORIS Brandenburg (Gutachterausschuss, bereitgestellt vom LGB), © GeoBasis-DE/LGB, <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2-0</a> (Daten geändert), Stichtag ' + esc(fmtIso(BRW.stichtag)) + '. Zone und Werte wie veröffentlicht, nur Euro je m². Ein Bodenrichtwert ist ein durchschnittlicher Lagewert und kein Verkehrswert. Maßgeblich ist die amtliche Auskunft (<a href="https://boris.brandenburg.de" target="_blank" rel="noopener">BORIS Brandenburg</a>).</li>' : '')
    + '<li><b>Bäume:</b> symbolisch. Sie werden in Waldflächen zufällig verteilt und zeigen keine echten Einzelbäume.</li>'
    + '<li><b>Besonnung und Schatten:</b> Schätzung ohne Gewähr. Berücksichtigt nur Gebäude aus LoD2, keine Bäume, kein Gelände.</li>'
    + '<li><b>Fahrpläne (Bus und Bahn):</b> Sollfahrplan: ' + esc(ORT.betreiber || '') + ', <a href="' + esc(ORT.lizenzUrl || '#') + '" target="_blank" rel="noopener">' + esc(ORT.lizenz || '') + '</a>, ' + (FP ? 'Stand ' + esc(FP.stand) + ', gültig ' + esc(fmtYmd(FP.feedFrom)) + ' bis ' + esc(fmtYmd(FP.feedTo)) : 'nicht geladen') + '. Auf die Haltestellen des Gebiets gefiltert (Daten geändert). Ohne Gewähr.</li>'
    + '<li><b>Veranstaltungen:</b> ' + (((window.AL_EVENTS_AUTO || {}).quellen || []).length ? esc(window.AL_EVENTS_AUTO.quellen.join(', ')) : 'von Hand gepflegt (events.js)') + ((window.AL_EVENTS_AUTO || {}).stand ? ' (gelesen am ' + esc(fmtIso(window.AL_EVENTS_AUTO.stand)) + ')' : '') + '. Übernommen werden nur Titel, Datum, Uhrzeit und Ort mit Link zur Originalseite.</li>'
    + '<li><b>Öffnungszeiten und Kontakt der Orte:</b> aus OpenStreetMap, ergänzt durch den Wortlaut der eigenen Webseite des Ortes, wo dort maschinell lesbar vorhanden (mit Lesedatum und Link in der Ortskarte). Ohne Angabe steht „nicht verifiziert“. Zeiten ändern sich, bitte beim Betrieb nachfragen.</li>'
    + '<li><b>Schriften:</b> Sora und JetBrains Mono, SIL Open Font License 1.1, lokal eingebunden.</li>'
    + '<li><b>Wetter (nur auf Wunsch):</b> Deutscher Wetterdienst (DWD, offene Daten nach GeoNutzV) über die freie Schnittstelle <a href="https://brightsky.dev" target="_blank" rel="noopener">Bright Sky</a>. Der Browser ruft die Daten erst nach Ihrer Zustimmung direkt dort ab. Dazu gehören die amtlichen Wetterwarnungen des DWD.</li>'
    + '<li><b>Luftqualität (nur auf Wunsch):</b> Modelldaten des Copernicus-Dienstes CAMS über <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">Open-Meteo</a>, CC BY 4.0, keine Messung vor Ort. Abruf erst nach Ihrer Zustimmung direkt aus dem Browser.</li>'
    + '<li><b>Baustellen und Sperrungen (nur auf Wunsch):</b> © Landesbetrieb Straßenwesen Brandenburg, <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2.0</a>, über den Geodienst isk.geobasis-bb.de. Abruf erst nach Ihrer Zustimmung direkt aus dem Browser.</li>'
    + (VBB_HOSTS.length ? '<li><b>Live-Abfahrten und Meldungen Bahn und Bus (nur auf Wunsch):</b> Echtzeitdaten über die freien, inoffiziellen Schnittstellen ' + esc(VBB_HOSTS.map((h) => h.replace('https://', '')).join(' und ')) + ' (<a href="https://github.com/public-transport/transport.rest" target="_blank" rel="noopener">transport.rest</a>). Abruf erst nach Ihrer Zustimmung direkt aus dem Browser. Ohne Gewähr.</li>' : '')
    + '<li><b>Aktualisierung:</b> Orte, Haltestellen und Fahrplan wöchentlich' + (NEWS.stand ? ' (letzter Lauf ' + esc(fmtIso(NEWS.stand)) + ')' : '') + ', Gebäude und Adressen vierteljährlich, Bodenrichtwerte jährlich.</li>'
    + (ORTSTEILE_SEITE ? '<li><b>Ortsinformationen (Einwohnerzahl, Ersterwähnung, Sehenswertes):</b> Ortsporträts auf der <a href="' + ORTSTEILE_SEITE + '" target="_blank" rel="noopener">Website: ' + esc(ORT_NAME) + '</a>' + (M.ortsteilInfo && M.ortsteilInfo.gelesen ? ' (gelesen am ' + esc(fmtIso(M.ortsteilInfo.gelesen)) + ')' : '') + '. Übernommen werden nur einzelne Angaben, keine Texte und keine Personen. Einwohnerzahlen sind Angaben aus den Texten ohne einheitlichen Stand, bei ' + OT.filter((o) => !ewText(o)).length + ' von ' + OT.length + ' Ortsteilen fehlt sie. Fläche, Adress- und Gebäudezahl stammen aus eigenen Daten (Grenze: OpenStreetMap, Adressen und Gebäude: LGB).</li>' : '')
    + '<li><b>3D-Darstellung:</b> three.js (MIT-Lizenz), läuft lokal im Browser, es werden keine Daten an Dritte gesendet.</li></ul><p class="note">Prototyp. Keine Gewähr für Richtigkeit und Vollständigkeit.</p>';

  // ------------------------------------------------------------------ Schleife
  let loadingHidden = false;
  function hideLoading() { if (loadingHidden) return; loadingHidden = true; setTimeout(() => $('#loading').classList.add('done'), 300); }
  let lastStream = 0;
  function frame(now) {
    try { step(now); } catch (err) { if (!frame.warned) { frame.warned = true; console.error('Fehler in der Darstellungsschleife:', err); } }
    requestAnimationFrame(frame);
  }
  function step(now) {
    if (anim) {
      const t = clamp((now - anim.t0) / anim.ms, 0, 1), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      ['tx', 'tz', 'theta', 'phi', 'dist'].forEach((k) => { view[k] = lerp(anim.from[k], anim.to[k], e); });
      applyView(); if (t >= 1) anim = null;
    }
    if (S.moved || now - lastStream > 700) { if (now - lastStream > 250) { lastStream = now; S.moved = false; streamPhotos(now); streamTiles(); S.dirty = true; } }
    if (S.pending) {
      const t = T[S.pending.key];
      if (t && t.st === 'data' && !t.bld) { buildBuildings(t); }
      if (t && t.bld) { const k = S.pending.k; S.pending = null; if (t.data.b[k]) selectBuilding(t.key, k); }
      else if (t && t.st === 'failed') S.pending = null;
    }
    if (S.dirty) { S.dirty = false; renderer.render(scene, camera); updateMarkers(); }
  }
  resize(); recolorAll(); renderEvents(); renderPlaces(); applyLayers(); applyView();
  function recolorAll() { for (const k in T) recolorTile(T[k]); }
  (function legalLinks() { // Impressum und Datenschutz aus rechtliches.js (nur gueltige Adressen)
    const R = window.AL_RECHT || {}, ok = (u) => !!safeUrl(u) || /^(\.\/|\/)?[\w./-]+\.html?$/i.test(u || '');
    const links = [['Impressum', R.impressum], ['Datenschutz', R.datenschutz]].filter((p) => ok(p[1]));
    $('#legal').innerHTML = links.map((p) => ' · <a href="' + esc(p[1]) + '" target="_blank" rel="noopener">' + p[0] + '</a>').join('');
  })();
  (function standInfo() { // Aktualisierungsstand aus data/stand.js (schreibt scripts/schreibe_stand.py)
    const st = window.AL_STAND, el = $('#stand');
    if (!st || !el) return;
    el.textContent = 'Daten: ' + fmtIso(st.lauf);
    el.title = 'Orte und Haltestellen ' + fmtIso(st.osm) + ' · Fahrplan gültig ' + fmtIso(st.fahrplan.von) + ' bis ' + fmtIso(st.fahrplan.bis) + ' · Termine ' + fmtIso(st.termine.stand) + ' · Gebäude und Adressen (LGB) abgerufen ' + fmtIso(st.lgb);
  })();
  (function sprungZumOrtsteil() { // Links der Startseite: karte.html#ortsteil=<Nummer>
    const m = /ortsteil=(\d+)/.exec(location.hash);
    if (m && OT[+m[1]]) setTimeout(() => goOrtsteil(+m[1]), 700);
  })();
  if (matchMedia('(max-width: 900px)').matches) $('#colorpanel').open = false; // auf kleinen Bildschirmen zugeklappt starten
  requestAnimationFrame(frame);
  setTimeout(hideLoading, 8000);
  window.AL_DEBUG = { BRW, brwAt, showBrw, STOPS, FP, setSun, showStop, S, view, T, CELLS, scene, camera, renderer, applyView, flyTo, occluded, selectBuilding, goAddress, ROWS, STREETS, OT };
})();
