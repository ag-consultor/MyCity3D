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
  const GEO = ORT.geobasis || { kurz: 'LGB Brandenburg', text: '© GeoBasis-DE/LGB, dl-de/by-2-0 (Daten geändert). Landesvermessung und Geobasisinformation Brandenburg', lizenz: 'dl-de/by-2-0', url: 'https://www.govdata.de/dl-de/by-2-0' }; // Quellenhinweis Geobasisdaten (scripts/laender.py)
  const ADDR_OSM = !!ORT.adressenOsm; // Adressen teils aus OpenStreetMap (Laender ohne freie amtliche Adressen)
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
    L: { photo: true, buildings: true, trees: true, places: true, stops: true, fahrzeuge: true, events: true, labels: true, borders: true, roads: false, shadows: true, brw: false, wolken: true, relief: false, hang: false, senken: false, notfall: false, sirenen: false, energie: false, flug: false, freizeit: false, alltag: false, lampen: false, touren: false },
    sun: { y: 2026, mo: 6, d: 21, min: 14 * 60 }, playing: false, spot: null, evFilter: '30', evCats: new Set(), evArea: 'all', plSel: new Set(), plArea: 'gem', dim: 1,
  };

  const CL = { mesh: null, ok: false }; // Wolkenebene (nur mit eingeblendeten Wetterdaten)
  const TR = { mesh: null, mat: null, built: false }; // Touren-Bänder (data/touren.js)
  const OVL = [{ k: 'relief', o: 2 }, { k: 'hang', o: 3 }, { k: 'senken', o: 4 }]; // Bildebenen aus dem Geländemodell (img/<name>.png)
  const nfH = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
    s.src = 'data/areas.js?v=' + (window.AL_TV || '');
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
    s.src = 'data/t_' + key + '.js?v=' + (window.AL_TV || '');
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
    const rb = new Uint32Array(B.length), ts = new Uint32Array(B.length), te = new Uint32Array(B.length), boxes = B.map(() => new THREE.Box3());
    let vo = 0, io = 0;
    B.forEach((b, bi) => {
      ts[bi] = io / 3;
      const put = (v, ix, k) => {
        const base = vo;
        for (let i = 0; i < v.length; i += 3) { pos[vo * 3] = v[i] + b.x; pos[vo * 3 + 1] = v[i + 1]; pos[vo * 3 + 2] = v[i + 2] + b.z; kind[vo] = k; vb[vo] = bi; vo++; }
        for (let i = 0; i < ix.length; i++) idx[io++] = ix[i] + base;
      };
      put(b.wv, b.wi, 0); rb[bi] = vo; put(b.rv, b.ri, 1);
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
    t.bld = { mesh, pos, idx, kind, vb, rb, ts, te, boxes, box, ca };
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
      else if (S.colorMode === 'dach') { wc.push(WALL_C.unbekannt); rc.push(b.rc != null ? roofColor(b.rc) : ROOF_GREY[hash(b.id) % ROOF_GREY.length]); }
      else if (S.colorMode === 'solar') { wc.push(col('#cfcfc8')); rc.push(null); }
      else {
        const h = hash(b.id);
        wc.push(WALL_C[b.u] || WALL_C.unbekannt);
        rc.push(b.u === 'wohnen' ? ROOF_TILE[h % ROOF_TILE.length] : ROOF_GREY[h % ROOF_GREY.length]);
      }
    });
    const a = bl.ca.array;
    for (let v = 0; v < bl.vb.length; v++) {
      const bi = bl.vb[v]; let c;
      if (bl.kind[v]) { c = rc[bi] || solarColor(solarOf(B[bi]).vf[v - bl.rb[bi]]); } else c = wc[bi];
      a[v * 3] = c.r; a[v * 3 + 1] = c.g; a[v * 3 + 2] = c.b;
    }
    bl.ca.needsUpdate = true; S.dirty = true;
  }

  // ---- Solarpotenzial und Dachfarbe (Schätzung aus den Dachformen LoD2 und dem Luftbild; keine Anlagenplanung)
  // Eignung je Dachfläche: Strahlung relativ zur besten Ausrichtung (Süd, 35 Grad): f = 0,45 + 0,55 * cos(Winkel zwischen Dachnormale und bester Normale).
  // Nutzbare Fläche: 75 % einer geneigten, 50 % einer flachen Fläche (Abstände, Gauben, Schornsteine, Aufständerung); 0,21 kWp je m²; Ertrag: 980 kWh je kWp und Jahr bei bester Ausrichtung
  // (Mitteldeutschland, ort.json: bausteine.solar_kwh_je_kwp). Gegenprobe an einem bekannten Dach mit 21 kWp installierter Leistung: Schätzung rund 19 kWp. Ohne Verschattung durch Bäume und Nachbarn, ohne Statik, Denkmalschutz, Eigenverbrauch.
  const SOL_KWH = Number(ORT.solarKwh) || 980; // kWh je kWp und Jahr bei bester Ausrichtung
  const SOL_CY = Math.cos(35 * Math.PI / 180), SOL_SZ = Math.sin(35 * Math.PI / 180);
  const SOL_STOPS = [[0.55, col('#5a6785')], [0.8, col('#f1b44c')], [0.95, col('#4fd08a')]];
  function solarColor(f) {
    const s = SOL_STOPS; if (f <= s[0][0]) return s[0][1]; if (f >= s[2][0]) return s[2][1];
    const i = f < s[1][0] ? 0 : 1, u = (f - s[i][0]) / (s[i + 1][0] - s[i][0]);
    return tmpC.clone().lerpColors(s[i][1], s[i + 1][1], u);
  }
  function solarOf(b) {
    if (b._sol) return b._sol;
    const rv = b.rv, ri = b.ri, vf = new Float32Array(rv.length / 3).fill(0.5);
    let tot = 0, use = 0, kwh = 0, kwp = 0;
    for (let t = 0; t < ri.length; t += 3) {
      const a = ri[t] * 3, c = ri[t + 1] * 3, d = ri[t + 2] * 3;
      const ux = rv[c] - rv[a], uy = rv[c + 1] - rv[a + 1], uz = rv[c + 2] - rv[a + 2], vx = rv[d] - rv[a], vy = rv[d + 1] - rv[a + 1], vz = rv[d + 2] - rv[a + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) continue;
      if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const area = len / 2, f = 0.45 + 0.55 * Math.max(0, (ny * SOL_CY + nz * SOL_SZ) / len); // z zeigt nach Süden
      vf[ri[t]] = vf[ri[t + 1]] = vf[ri[t + 2]] = f; tot += area;
      if (f >= 0.7) { const u = area * (ny / len > 0.985 ? 0.5 : 0.75); use += u; kwp += u * 0.21; kwh += u * 0.21 * SOL_KWH * f; }
    }
    return (b._sol = { tot, use, kwh, kwp, vf });
  }
  const roofCache = new Map();
  function roofColor(rc) { // Farbe aus dem Luftbild, etwas aufgehellt und satter (Luftbild liegt im Schatten und im Dunst)
    let c = roofCache.get(rc);
    if (!c) {
      const h = { h: 0, s: 0, l: 0 }; new THREE.Color((rc >> 16 & 255) / 255, (rc >> 8 & 255) / 255, (rc & 255) / 255).getHSL(h);
      c = new THREE.Color().setHSL(h.h, Math.min(1, h.s * 1.3), clamp(h.l * 1.15 + 0.04, 0, 0.85)).convertSRGBToLinear(); roofCache.set(rc, c);
    }
    return c;
  }
  const nf = (n, step) => (Math.round(n / step) * step).toLocaleString('de-DE');
  function solarRows(b) {
    const q = solarOf(b); if (q.tot < 12) return '';
    return '<dt>Dach</dt><dd>' + nf(q.tot, 1) + ' m² Dachfläche</dd><dt>Solar</dt><dd>'
      + (q.use >= 5 ? 'rund ' + nf(q.use, 5) + ' m² nutzbar, ca. ' + nf(q.kwp, 0.5) + ' kWp, ca. ' + nf(q.kwh, 100) + ' kWh im Jahr<span class="s">Schätzung ohne Gewähr, ohne Verschattung und Statik</span>' : 'kaum geeignete Dachfläche (Nordseiten)') + '</dd>';
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
  const nameKey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim(); // Kommas und Zeichensetzung egal: "Familienzentrum, Neustadt" = "Familienzentrum Neustadt"
  const placeByName = (n) => PLACES.find((p) => p.name === n || p.n === n) || PLACES.find((p) => nameKey(p.n) === nameKey(n));
  PLACES.forEach((p) => { p.name = p.n; });

  const nowB = () => AL.berlinParts(Date.now());
  const today = nowB();
  Object.assign(S.sun, { y: today.y, mo: today.mo, d: today.d, min: today.h * 60 + today.mi }); // Sonnenstand beginnt mit dem Datum und der Uhrzeit des Seitenaufrufs
  const dateFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const longFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  { const oc = $('#otCount'); if (oc) oc.textContent = OT.length + ' Ortsteile'; }
  const otNied = OT.findIndex((o) => o.n.indexOf(ORT_NAME) === 0);
  const EV = EVENTS.map((e) => {
    const base = e.date ? e.date.split('-').map(Number) : null;
    const t = base ? Date.UTC(base[0], base[1] - 1, base[2]) : Date.UTC(today.y, today.mo - 1, today.d + e.off), pl = e.place ? placeByName(e.place) : null;
    const nbE = !!(M.nb && e.ortsteil === M.nb.n), oi = e.ortsteil ? OT.findIndex((o) => o.n === e.ortsteil) : otNied, at = oi >= 0 ? OT[oi] : null; // ohne Kartenort: Mitte des genannten Ortsteils
    return Object.assign({}, e, { nbE, t, off: Math.round((t - Date.UTC(today.y, today.mo - 1, today.d)) / 864e5), dow: (new Date(t).getUTCDay() + 6) % 7,
      x: pl ? pl.x : (nbE ? M.nb.x : (at ? at.x : CX)), z: pl ? pl.z : (nbE ? M.nb.z : (at ? at.z : CZ)), pl });
  }).sort((a, b) => a.t - b.t || a.from.localeCompare(b.from));

  const markersEl = $('#markers'), markers = [], NFD = { notfall: 1400, sirenen: 7000, energie: 10000, flug: 24000, freizeit: 3500, alltag: 1200, lampen: 700 }; // ab welcher Kameraentfernung die Marker erscheinen
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
      const t = keep.find((q) => q.k === s.k && ((s.g >= 0 && q.g === s.g) || (nm(q) === nm(s) && Math.hypot(q.x - s.x, q.z - s.z) < 450))); // gleiche Art (Bahn oder Bus) und gleiche Gruppe oder gleicher Name in der Nähe
      if (t) { t._n++; t._sx += s.x; t._sz += s.z; if (t.g < 0 && s.g >= 0) t.g = s.g; return; }
      s._n = 1; s._sx = s.x; s._sz = s.z;
      keep.push(s);
    });
    keep.forEach((s, i) => { s.i = i; if (s._n > 1) { s.x = s._sx / s._n; s.z = s._sz / s._n; } });
    { // Bahnhof und Bushaltestelle teilen sich eine Fahrplangruppe (zum Beispiel Neustadt, Bahnhof): zwei Marker, jeder zeigt nur die Abfahrten seiner Art
      const kinds = {}; keep.forEach((s) => { if (s.g >= 0) (kinds[s.g] = kinds[s.g] || new Set()).add(s.k); });
      keep.forEach((s) => { if (s.g >= 0 && kinds[s.g].size > 1) { s.mode = s.k; s.n = FPG[s.g].n + (s.k === 'bus' ? ' (Bus)' : ' (Bahn)'); } }); // Name aus dem Fahrplan, mit Art
    }
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
  // Bodenrichtwert live auf Klick (z. B. Bayern): Abfrage beim amtlichen Dienst direkt aus dem Browser, erst nach Zustimmung.
  // Nichts wird gespeichert oder mit der Seite ausgeliefert (scripts/laender.py, brw_live).
  const BRW_LIVE = !BRW && ORT.brwLive ? ORT.brwLive : null;
  let brwLiveOk = false; try { brwLiveOk = localStorage.getItem('alw-brw') === 'ja'; } catch (e) { /* ohne Speicher */ }
  const brwLiveBox = () => (BRW_LIVE ? '<div class="live" id="brwLive"></div>' : '');
  const kA = (v) => (v && v !== 'Keine Angabe' ? v : '');
  async function brwLiveFill(x, z) {
    const box = $('#brwLive'); if (!box || !BRW_LIVE) return;
    if (!brwLiveOk) {
      box.innerHTML = '<b>Bodenrichtwert</b><p class="note">Auf Wunsch fragt die Karte den Bodenrichtwert an dieser Stelle beim Dienst der Bayerischen Vermessungsverwaltung ab. Dafür verbindet sich Ihr Browser mit <b>' + esc(BRW_LIVE.host)
        + '</b> und überträgt die Lage der Stelle und Ihre IP-Adresse. Ohne Zustimmung findet keine Verbindung statt. ' + (ORT.datenschutz ? '<a href="' + esc(ORT.datenschutz) + '" target="_blank" rel="noopener">Datenschutz</a>' : '') + '</p>'
        + '<button class="wxbtn" id="brwLiveJa">Bodenrichtwert abfragen</button>';
      $('#brwLiveJa').onclick = () => { brwLiveOk = true; try { localStorage.setItem('alw-brw', 'ja'); } catch (e) { /* egal */ } brwLiveFill(x, z); };
      return;
    }
    box.innerHTML = '<b>Bodenrichtwert</b><p class="note">wird abgefragt …</p>';
    const [lat, lon] = toLL(x, z), d = 0.0004;
    const url = BRW_LIVE.url + '?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&LAYERS=' + BRW_LIVE.layer + '&QUERY_LAYERS=' + BRW_LIVE.layer
      + '&SRS=EPSG:4326&BBOX=' + [lon - d, lat - d, lon + d, lat + d].map((v) => v.toFixed(6)).join(',') + '&WIDTH=101&HEIGHT=101&X=50&Y=50&INFO_FORMAT=application/json&FEATURE_COUNT=1';
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctl.signal });
      if (!r.ok) throw new Error(r.status);
      const f = ((await r.json()).features || [])[0], p = f ? f.properties : null;
      if ($('#brwLive') !== box) return; // Karte inzwischen gewechselt
      if (!p) { box.innerHTML = '<b>Bodenrichtwert</b><p class="note">Für diese Stelle liefert der Dienst keine Bodenrichtwertzone.</p>'; return; }
      const w = p.showbrw === false ? '' : kA(String(p.bodenrichtwert || ''));
      const erl = safeUrl(p.listeumrechnungstabellen) ? ' · <a href="' + esc(p.listeumrechnungstabellen) + '" target="_blank" rel="noopener">Erläuterungen</a>' : '';
      box.innerHTML = '<b>Bodenrichtwert</b><dl>'
        + '<dt>Wert</dt><dd>' + (w ? '<b>' + esc(w) + ' €/m²</b>' : 'vom Gutachterausschuss nicht zur Einsicht freigegeben') + '</dd>'
        + (kA(p.nutzungsart) ? '<dt>Nutzung</dt><dd>' + esc(p.nutzungsart) + '</dd>' : '')
        + (kA(p.entwicklungszustand) ? '<dt>Zustand</dt><dd>' + esc(p.entwicklungszustand) + '</dd>' : '')
        + (kA(p.bodenrichtwertszonenname) ? '<dt>Zone</dt><dd>' + esc(p.bodenrichtwertszonenname) + '</dd>' : '')
        + (kA(p.stichtag) ? '<dt>Stichtag</dt><dd>' + esc(p.stichtag) + '</dd>' : '') + '</dl>'
        + '<p class="note">Durchschnittlicher Lagewert je m² für die Zone, kein Verkehrswert und keine amtliche Auskunft. Amtliche Auskünfte gibt der ' + esc(p.gutachterausschuss_name || 'Gutachterausschuss') + '.</p>'
        + sourceLine(BRW_LIVE.kurz, BRW_LIVE.info).replace('</div>', erl + '</div>');
    } catch (e) {
      if ($('#brwLive') === box) box.innerHTML = '<b>Bodenrichtwert</b><p class="note">Der Dienst antwortet gerade nicht. Bitte später erneut versuchen.</p>';
    } finally { clearTimeout(tm); }
  }
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
    } else if (S.colorMode === 'dach') {
      el.hidden = false;
      el.innerHTML = '<b>Dachfarbe</b><span class="s">aus dem Luftbild (' + esc(GEO.kurz) + ') je Gebäude, Schätzung: Schatten, Bäume und die Schrägsicht des Luftbilds verfälschen einzelne Dächer</span>';
    } else if (S.colorMode === 'solar') {
      el.hidden = false;
      el.innerHTML = '<b>Solar-Eignung je Dachfläche</b><span class="s">Schätzung aus Neigung und Ausrichtung, ohne Verschattung</span>' + lg('#4fd08a', 'gut (Süd, flach)') + lg('#f1b44c', 'bedingt (Ost, West)') + lg('#5a6785', 'wenig (Nordseite)');
    } else if (S.colorMode === 'nutzung') {
      el.hidden = false;
      el.innerHTML = '<b>Gebäudenutzung</b>' + ['wohnen', 'gewerbe', 'industrie', 'oeffentlich', 'landwirtschaft', 'neben'].map((k) => lg(WALL[k], USE_DE[k])).join('');
    } else el.hidden = true;
    const e2 = $('#legend2'), parts = [];
    if (S.L.hang) parts.push('<b>Hangneigung</b><span class="s">Geländeanalyse aus dem 10-m-Raster</span>' + lg('rgb(120,205,120)', '0,5 bis 1°') + lg('rgb(240,215,70)', '1 bis 2°') + lg('rgb(240,140,50)', '2 bis 4°') + lg('rgb(205,50,50)', 'über 4°'));
    if (S.L.senken) parts.push('<b>Geländesenken</b><span class="s">Tiefe unter der Überlaufhöhe (20-m-Raster). Auch Teiche, Gruben und Gräben, keine Gefahrenkarte.</span>' + lg('#96cdff', 'ab 0,3 m') + lg('#2c4dd0', 'ab 2 m'));
    if (S.L.touren) parts.push('<b>Touren</b><span class="s">OpenStreetMap, Verlauf im Gebiet. Mehr unter „Touren“ auf der Startseite.</span>' + lg('#ff5aa5', 'Inline-Skaten') + lg('#3aa0ff', 'Radrouten') + lg('#7fd64f', 'Wanderwege'));
    e2.hidden = !parts.length; e2.innerHTML = parts.join('<hr>');
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
    if (TR.mat) TR.mat.uniforms.uW.value = clamp(view.dist * 0.0016, 3.2, 90);
    markers.forEach((m) => {
      const on = m.cls === 'nf' ? S.L[m.grp] : m.cls === 'poi' ? S.L.places && (!S.plSel.size || S.plSel.has(m.grp)) : m.cls === 'ev' ? S.L.events : m.cls === 'ot' ? S.L.labels : m.cls === 'brw' ? S.L.brw : m.cls === 'veh' ? S.L.fahrzeuge : S.L.stops;
      v.copy(m.v).project(camera);
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
      const near = m.cls === 'nf' ? view.dist < NFD[m.grp] && camera.position.distanceTo(m.v) < NFD[m.grp] * 1.3 : m.cls === 'ot' ? far : m.cls === 'brw' ? view.dist < 12000 : (!far || view.dist < 2600) && camera.position.distanceTo(m.v) < 1900;
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
      else if (BRW_LIVE) { openCard('<h3>Gewählte Stelle</h3><p class="sub">' + (where ? 'bei ' + esc(where) : 'ohne Adresse in der Nähe') + '</p>' + brwLiveBox()); brwLiveFill(gp.x, gp.z); }
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
      + '<dt>Höhe</dt><dd>' + (b.h ? b.h.toFixed(1) + ' m über Grund' : '–') + '</dd><dt>Gesamthöhe</dt><dd>' + b.t.toFixed(1) + ' m</dd>' + (b.hn != null ? '<dt>Gelände</dt><dd>' + nfH(b.hn) + ' m über NHN<span class="s">am Gebäude, aus dem Geländemodell (10 m)</span></dd>' : '') + solarRows(b) + brwRow(b.x, b.z) + '</dl>'
      + (BRW ? BRW_NOTE : '') + brwLiveBox() + '<button class="chip" id="toSun">☀ Besonnung anzeigen</button>'
      + sourceLine(GEO.kurz + ': Gebäude LoD2 und Adressen (' + GEO.lizenz + ')', GEO.url));
    $('#toSun').onclick = () => openPanel('sun', true);
    brwLiveFill(b.x, b.z);
  }
  // Reiter in Karten: Ort und seine Termine bleiben zusammen (Ortskarte: Ort | Termine, Terminkarte: Veranstaltung | Ort)
  function tabbed(head, panes, active) {
    const on = (k) => k === active;
    openCard(head + '<div class="chips tabs" role="tablist">' + panes.map((q) => '<button class="chip' + (on(q.k) ? ' on' : '') + '" role="tab" aria-selected="' + on(q.k) + '" data-ptab="' + q.k + '">' + q.label + '</button>').join('') + '</div>'
      + panes.map((q) => '<div data-pane="' + q.k + '"' + (on(q.k) ? '' : ' hidden') + '>' + q.html + '</div>').join(''));
    $$('[data-ptab]', cardBody).forEach((b) => { b.onclick = () => { $$('[data-ptab]', cardBody).forEach((x) => { const o = x === b; x.classList.toggle('on', o); x.setAttribute('aria-selected', o); }); $$('[data-pane]', cardBody).forEach((d) => { d.hidden = d.dataset.pane !== b.dataset.ptab; }); }; });
    $$('[data-ev]', cardBody).forEach((b) => { b.onclick = () => showEvent(EV[+b.dataset.ev]); });
    $$('[data-goplace]', cardBody).forEach((b) => { b.onclick = () => showPlace(+b.dataset.goplace, true); });
  }
  const placeOf = (e) => e.pl || null;
  const eventsOf = (p) => EV.filter((e) => e.pl === p && e.off >= 0).sort((a, b) => a.t - b.t);
  const evItem = (e) => '<button class="item" data-ev="' + EV.indexOf(e) + '"><span class="t">' + esc(e.from) + '</span><span>' + esc(e.title) + '<span class="s">' + esc(dateFmt.format(new Date(e.t))) + '</span></span></button>';
  const placeHead = (p) => '<h3>' + esc(p.name) + '</h3><p class="sub">' + esc(GROUPS[p.g].label) + ' · ' + esc(typeDe(p)) + (whereOf(p) ? ' · ' + esc(whereOf(p)) : '') + '</p>';
  function placePane(p) {
    const st = AL.openStatus(p.oh, nowB()), web = safeUrl(p.web);
    return '<dl>'
      + (p.ad ? '<dt>Adresse</dt><dd>' + esc(p.ad) + '</dd>' : '') + (p.hn != null ? '<dt>Höhe</dt><dd>' + nfH(p.hn) + ' m über NHN</dd>' : '') + '<dt>Jetzt</dt><dd><span class="tag ' + st.state + '">' + esc(st.text) + '</span></dd>'
      + '<dt>Zeiten</dt><dd>' + (p.oh ? esc(ohDe(p.oh)) + (p.ohw ? '<span class="s">laut Webseite, Stand ' + esc(fmtIso(p.wg)) + '</span>' : '') : p.wt ? esc(p.wt) + '<span class="s">Wortlaut der Webseite, Stand ' + esc(fmtIso(p.wg)) + '</span>' : 'nicht verifiziert') + '</dd>'
      + (p.tel ? '<dt>Telefon</dt><dd><a href="tel:' + esc(String(p.tel).replace(/[^+\d]/g, '')) + '">' + esc(p.tel) + '</a></dd>' : '')
      + (p.mail && /^[^\s@<>"]+@[^\s@<>"]+$/.test(p.mail) ? '<dt>E-Mail</dt><dd><a href="mailto:' + esc(p.mail) + '">' + esc(p.mail) + '</a></dd>' : '') + '</dl>'
      + (web ? '<a href="' + esc(web) + '" target="_blank" rel="noopener">Webseite öffnen →</a>' : '<p class="note">Keine Webseite in OpenStreetMap hinterlegt.</p>')
      + sourceLine('OpenStreetMap, Objekt ' + p.osm, 'https://www.openstreetmap.org/' + p.osm)
      + (p.wq && safeUrl(p.wq) && (p.wt || p.tel || p.mail || p.ohw) ? sourceLine('Zeiten und Kontakt: eigene Webseite, gelesen ' + fmtIso(p.wg), p.wq) : '')
      + (p.kq ? sourceLine(p.kq) : '');
  }
  function showPlace(i, fly, tab) {
    const p = PLACES[i], evs = eventsOf(p);
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); p.marker.el.classList.add('sel');
    if (evs.length) tabbed(placeHead(p), [{ k: 'ort', label: 'Ort', html: placePane(p) }, { k: 'termine', label: 'Termine (' + evs.length + ')', html: evs.map(evItem).join('') + (evs.some((e) => e.dummy) ? '<p class="note">Beispieldaten</p>' : '') }], tab === 'termine' ? 'termine' : 'ort');
    else openCard(placeHead(p) + placePane(p));
    if (fly) flyTo({ tx: p.x, tz: p.z, dist: Math.min(view.dist, 220), phi: Math.min(view.phi, 1.1) }, 900);
  }
  const fmtYmd = (s) => s.slice(6, 8) + '.' + s.slice(4, 6) + '.' + s.slice(0, 4);
  const opShort = (o) => String(o || '').replace(/\s+(GmbH|AG|mbH)$/i, '');
  const opShortK = (o) => { const s = opShort(o), k = ORT.betreiberKuerzel || {}; for (const n in k) if (s.indexOf(n) >= 0) return k[n]; return s; }; // ort.json: fahrplan.betreiber_kuerzel
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
  const vbbSet = (on) => { try { if (on) localStorage.setItem('alw-vbb', 'ja'); else localStorage.removeItem('alw-vbb'); } catch (e) { /* egal */ } vbbOk = on; if (on) fzStart(); else fzStop(); };
  let vbbHost = 0;
  const RADAR = ORT.umgrenzung || [0, 0, 0, 0]; // Süd, West, Nord, Ost (ort.json: geo.umgrenzung_sued_west_nord_ost)
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
      const w = warnTexts(d), all = (d.departures || []).filter((x) => !s.mode || isRailDep(x) === (s.mode === 'rail')), list = all.filter(depRecentRail).slice(-4).concat(all.filter(depUpcoming).slice(0, 8)); // bis zu 4 Züge der letzten Stunde (grau), dann die nächsten
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

  // ------------------------------------------------------------------ Fahrzeuge live (nur mit Einwilligung, Radar des Echtzeitdienstes)
  // Der Echtzeitdienst liefert zu jedem Fahrzeug im Kartenausschnitt die aktuelle Lage und die nächsten Halte mit Ankunfts- und Abfahrtszeit
  // (bei Verspätung die tatsächliche Zeit). Daraus rechnet der Browser die Bewegung: Züge fahren auf dem Gleisnetz (data/gleise.js, kürzester Weg
  // von Halt zu Halt, nach Zeit und Weglänge), Busse laufen in gerader Linie zwischen den Halten und rasten auf die Straße, soweit die Kachel geladen ist.
  // Die Modelle sind Miniaturen nach Betreiber, keine Abbilder der echten Fahrzeuge; Wagenzahl und Länge sind Annahmen.
  const FZ = { list: new Map(), timer: 0, simTimer: 0, liveN: 0, group: new THREE.Group(), busy: false, scale: 1.5, follow: null, sel: null, trail: [], stand: 0 };
  scene.add(FZ.group);
  const FZ_LOOK = {
    odeg: { cars: 2, len: 24, low: '#f2c21b', up: '#f6f3e8' }, // ODEG: gelb-weiß
    db: { cars: 3, len: 26, low: '#c4313a', up: '#f1f1ee' }, // DB Regio: rot-weiß
    ice: { cars: 5, len: 26, low: '#e3e5e8', up: '#f6f6f6', stripe: '#d5222b' }, // Fernverkehr: weiß mit rotem Streifen
    bus: { cars: 1, len: 12, low: '#1b7f93', up: '#e9eeee' }, // Bus: Farbe symbolisch
  };
  const fzLook = (ln) => {
    const op = String((ln.operator && ln.operator.name) || '');
    if (ln.product === 'bus') return 'bus';
    if (ln.product === 'express') return 'ice';
    return /ODEG|Ostdeutsche/i.test(op) ? 'odeg' : 'db';
  };
  const FZ_ART = { odeg: 'Regionalbahn (ODEG)', db: 'Regionalzug (DB Regio)', ice: 'Fernverkehr', bus: 'Bus' };
  const fzGeo = { box: new THREE.BoxGeometry(1, 1, 1), wheel: new THREE.CylinderGeometry(0.55, 0.55, 0.42, 12).rotateX(Math.PI / 2) };
  const fzMat = {}, fzKit = {};
  const fzM = (c) => fzMat[c] || (fzMat[c] = new THREE.MeshLambertMaterial({ color: c }));
  function fzCanvas(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  const fzRR = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  function fzKitFor(kind) { // Seitenbild (Fenster, Türen, Streifen), Stirnbild und Materialien je Bauart, einmal erzeugt
    if (fzKit[kind]) return fzKit[kind];
    const L = FZ_LOOK[kind], bus = kind === 'bus';
    const side = fzCanvas(512, 128, (g, w, h) => {
      g.fillStyle = L.up; g.fillRect(0, 0, w, h);
      g.fillStyle = L.low; g.fillRect(0, bus ? 76 : 70, w, bus ? 40 : 46);
      if (L.stripe) { g.fillStyle = L.stripe; g.fillRect(0, 62, w, 9); }
      g.fillStyle = '#26323f'; g.fillRect(0, 118, w, 10); // Schürze
      const n = bus ? 6 : 8, ww = bus ? 56 : 38, gap = (w - n * ww) / (n + 1);
      for (let i = 0; i < n; i++) {
        const x = gap + i * (ww + gap), door = (!bus && (i === 1 || i === n - 2)) || (bus && i === 1);
        if (door) { g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x - 3, 12, ww + 6, 104); }
        g.fillStyle = '#27394d'; fzRR(g, x, bus ? 14 : 18, ww, bus ? 46 : 40, 5); g.fill();
        g.fillStyle = 'rgba(255,255,255,.22)'; g.fillRect(x + 4, (bus ? 14 : 18) + 4, ww * 0.35, 5);
      }
      if (bus) { g.fillStyle = '#10161d'; [[78, 112], [410, 112]].forEach(([cx, cy]) => { g.beginPath(); g.arc(cx, cy, 27, Math.PI, 0); g.fill(); }); }
    });
    const front = fzCanvas(128, 128, (g, w, h) => {
      g.fillStyle = L.up; g.fillRect(0, 0, w, h); g.fillStyle = L.low; g.fillRect(0, 74, w, 54);
      g.fillStyle = '#1f2a36'; fzRR(g, 12, 12, 104, 54, 8); g.fill();
      g.fillStyle = '#ffeaa8'; [[26, 92], [102, 92]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill(); });
      g.fillStyle = '#26323f'; g.fillRect(0, 118, w, 10);
    });
    const lam = (o) => new THREE.MeshLambertMaterial(o);
    return (fzKit[kind] = { side: lam({ map: side }), front: lam({ map: front }), plain: lam({ color: L.up }), roof: lam({ color: '#9aa3ad' }), floor: lam({ color: '#222a32' }) });
  }
  function fzModel(kind) {
    const L = FZ_LOOK[kind], bus = kind === 'bus', k = fzKitFor(kind), g = new THREE.Group(), w = bus ? 2.5 : 2.9, h = bus ? 3.0 : 3.7, yb = bus ? 0.6 : 0.95;
    const part = (geo, mat, sx, sy, sz, x, y, z, shadow) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = !!shadow; return m; };
    for (let i = 0; i < L.cars; i++) {
      const cx = (i - (L.cars - 1) / 2) * (L.len + 1.0);
      const body = new THREE.Mesh(fzGeo.box, [i === L.cars - 1 ? k.front : k.plain, i === 0 ? k.front : k.plain, k.roof, k.floor, k.side, k.side]);
      body.scale.set(L.len, h, w); body.position.set(cx, yb + h / 2, 0); body.castShadow = true; g.add(body);
      if (bus) {
        [[0.34, 1], [0.34, -1], [-0.28, 1], [-0.28, -1]].forEach(([f, s]) => g.add(part(fzGeo.wheel, fzM('#15181c'), 1, 1, 1, cx + L.len * f, 0.55, s * (w / 2 - 0.12))));
        g.add(part(fzGeo.box, fzM('#cfd6d9'), 2.2, 0.35, w * 0.5, cx - 1, yb + h + 0.17, 0)); // Dachaufbau
      } else {
        [-0.3, 0.3].forEach((f) => g.add(part(fzGeo.box, fzM('#2a2f36'), 4.6, 0.85, w * 0.82, cx + L.len * f, 0.43, 0))); // Drehgestelle
        [-0.22, 0.22].forEach((f) => g.add(part(fzGeo.box, fzM('#8d949b'), 2.8, 0.42, w * 0.5, cx + L.len * f, yb + h + 0.21, 0))); // Dachklimageräte
      }
    }
    g.scale.setScalar(FZ.scale);
    return g;
  }
  const fzX = (lon) => (lon - M.origin.lon) * 111320 * Math.cos(M.origin.lat * Math.PI / 180), fzZ = (lat) => -(lat - M.origin.lat) * 111132;
  const fzTime = (s) => (s ? Date.parse(s) : NaN);
  function fzPath(mv, now) { // Punkte: aktuelle Lage jetzt, danach jeder nächste Halt mit Ankunft und Abfahrt (nie rückwärts in der Zeit)
    const pts = [{ x: fzX(mv.location.longitude), z: fzZ(mv.location.latitude), a: now, d: now }];
    let t = now;
    (mv.nextStopovers || []).forEach((s) => {
      const loc = s.stop && s.stop.location; if (!loc) return;
      let a = fzTime(s.arrival || s.plannedArrival), d = fzTime(s.departure || s.plannedDeparture);
      if (isNaN(a)) a = isNaN(d) ? t + 60000 : d;
      if (isNaN(d)) d = a;
      if (d < now - 20000) return; // der Halt liegt schon hinter dem Fahrzeug (der Dienst liefert auch vergangene Halte mit)
      a = Math.max(a, t + 3000); d = Math.max(d, a);
      pts.push({ x: fzX(loc.longitude), z: fzZ(loc.latitude), a, d, name: s.stop.name, delay: s.arrivalDelay != null ? s.arrivalDelay : s.departureDelay }); t = d;
    });
    return pts;
  }
  function fzAt(pts, now) { // gerade Verbindung zwischen den Halten (Busse), in der Zeit linear, am Halt wartet das Fahrzeug bis zur Abfahrt
    if (now >= pts[pts.length - 1].a) return { x: pts[pts.length - 1].x, z: pts[pts.length - 1].z };
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (now < q.a) { const f = clamp((now - p.d) / Math.max(1, q.a - p.d), 0, 1); return { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f }; }
      if (now < q.d) return { x: q.x, z: q.z };
    }
    return { x: pts[0].x, z: pts[0].z };
  }
  // ---- Gleisnetz: Streckengleise aus OpenStreetMap (site/data/gleise.js) als Graph, kürzester Weg zwischen zwei Punkten
  const RG = { ok: false, nx: [], nz: [], adj: [], ex: [] };
  function rgBuild() {
    if (RG.ok || !window.AL_GLEISE) return;
    const id = new Map(), node = (x, z) => { const k = Math.round(x) + ',' + Math.round(z); let i = id.get(k); if (i === undefined) { i = RG.nx.length; id.set(k, i); RG.nx.push(x); RG.nz.push(z); RG.adj.push([]); } return i; };
    window.AL_GLEISE.forEach((f) => {
      for (let i = 0; i + 3 < f.length; i += 2) {
        const a = node(f[i], f[i + 1]), b = node(f[i + 2], f[i + 3]); if (a === b) continue;
        const l = Math.hypot(RG.nx[a] - RG.nx[b], RG.nz[a] - RG.nz[b]); RG.adj[a].push([b, l]); RG.adj[b].push([a, l]); RG.ex.push([a, b, l]);
      }
    });
    RG.ok = RG.ex.length > 0;
  }
  function rgSnap(x, z, max) { // nächster Punkt auf einem Gleisstück: Stück, Anteil t von a nach b, Lage
    let best = null, bd = max * max;
    RG.ex.forEach((e, i) => {
      const ax = RG.nx[e[0]], az = RG.nz[e[0]], dx = RG.nx[e[1]] - ax, dz = RG.nz[e[1]] - az, l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0, px = ax + dx * t, pz = az + dz * t, d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < bd) { bd = d; best = { e: i, t, x: px, z: pz }; }
    });
    return best;
  }
  function rgDijkstra(a, limit) { // kürzeste Wege von einem Gleispunkt zu allen Netzpunkten bis zur Weglänge limit
    const N = RG.nx.length, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), heap = [];
    const push = (d, n) => { heap.push([d, n]); let i = heap.length - 1; while (i > 0) { const p2 = (i - 1) >> 1; if (heap[p2][0] <= heap[i][0]) break; [heap[p2], heap[i]] = [heap[i], heap[p2]]; i = p2; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    const ea = RG.ex[a.e];
    dist[ea[0]] = a.t * ea[2]; dist[ea[1]] = (1 - a.t) * ea[2]; push(dist[ea[0]], ea[0]); push(dist[ea[1]], ea[1]);
    while (heap.length) {
      const [d, n] = pop(); if (d > dist[n]) continue; if (d > limit) break;
      RG.adj[n].forEach(([m, l]) => { if (d + l < dist[m]) { dist[m] = d + l; prev[m] = n; push(dist[m], m); } });
    }
    return { dist, prev };
  }
  function rgPathFar(p, q) { // Ziel außerhalb des Gleisnetzes (Fernzug): auf den Gleisen bis zum Netzpunkt nächst dem Ziel, dann geradeaus
    const a = rgSnap(p.x, p.z, 300); if (!a) return null;
    const { dist, prev } = rgDijkstra(a, Infinity); let best = -1, bd = Infinity;
    for (let n = 0; n < dist.length; n++) { if (!isFinite(dist[n])) continue; const d = Math.hypot(RG.nx[n] - q.x, RG.nz[n] - q.z); if (d < bd) { bd = d; best = n; } }
    if (best < 0) return null;
    const rev = []; for (let n = best; n >= 0; n = prev[n]) rev.push(RG.nx[n], RG.nz[n]);
    const out = [a.x, a.z]; for (let i = rev.length - 2; i >= 0; i -= 2) out.push(rev[i], rev[i + 1]); out.push(q.x, q.z);
    return out;
  }
  function rgReverse(poly) { if (!poly) return null; const out = []; for (let i = poly.length - 2; i >= 0; i -= 2) out.push(poly[i], poly[i + 1]); return out; } // Weg umdrehen (Start liegt außerhalb des Gleisnetzes, das Ziel darin)
  function rgPath(p, q) { // Weg entlang der Gleise als Liste x,z,x,z,… oder null (kein Weg, Umweg zu groß)
    const a = rgSnap(p.x, p.z, 300), b = rgSnap(q.x, q.z, 300); if (!a || !b) return null;
    const straight = Math.hypot(p.x - q.x, p.z - q.z), ea = RG.ex[a.e], eb = RG.ex[b.e];
    if (a.e === b.e) return [a.x, a.z, b.x, b.z];
    const limit = straight * 3 + 800, { dist, prev } = rgDijkstra(a, limit);
    const viaA = dist[eb[0]] + b.t * eb[2], viaB = dist[eb[1]] + (1 - b.t) * eb[2];
    if (!isFinite(Math.min(viaA, viaB)) || Math.min(viaA, viaB) > limit) return null;
    let n = viaA <= viaB ? eb[0] : eb[1]; const rev = [];
    while (n >= 0) { rev.push(RG.nx[n], RG.nz[n]); n = prev[n]; }
    const out = [a.x, a.z]; for (let i = rev.length - 2; i >= 0; i -= 2) out.push(rev[i], rev[i + 1]); out.push(b.x, b.z);
    return out;
  }
  function fzLeg(poly, t0, t1) { // Abschnitt mit Weglängen
    const cum = [0]; for (let i = 2; i < poly.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(poly[i] - poly[i - 2], poly[i + 1] - poly[i - 1]));
    return { poly, cum, L: cum[cum.length - 1], t0, t1 };
  }
  function fzLegAt(g, f) { // Lage und Fahrtrichtung bei Anteil f der Weglänge
    const d = clamp(f, 0, 1) * g.L; let i = 1; while (i < g.cum.length - 1 && g.cum[i] < d) i++;
    const x0 = g.poly[2 * (i - 1)], z0 = g.poly[2 * (i - 1) + 1], x1 = g.poly[2 * i], z1 = g.poly[2 * i + 1], s = g.cum[i] - g.cum[i - 1], u = s > 0 ? (d - g.cum[i - 1]) / s : 0;
    return { x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u, dx: x1 - x0, dz: z1 - z0 };
  }
  function fzLegsFor(v) { // für Züge: Abschnitte entlang der Gleise von Halt zu Halt (sonst gerade Linie)
    rgBuild(); const legs = [];
    for (let i = 1; i < v.pts.length; i++) {
      const p = v.pts[i - 1], q = v.pts[i], poly = (RG.ok && (rgPath(p, q) || rgPathFar(p, q) || rgReverse(rgPathFar(q, p)))) || [p.x, p.z, q.x, q.z];
      legs.push(fzLeg(poly, p.d, q.a));
    }
    return legs;
  }
  function fzAtLegs(v, t) {
    const L = v.legs;
    for (let i = 0; i < L.length; i++) {
      const g = L[i];
      if (t < g.t0) return fzLegAt(g, 0); // wartet am Halt, Blick in Fahrtrichtung des nächsten Abschnitts
      if (t < g.t1) return fzLegAt(g, (t - g.t0) / Math.max(1, g.t1 - g.t0));
    }
    return fzLegAt(L[L.length - 1], 1);
  }
  const FZ_STRASSE = { motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1, unclassified: 1, residential: 1, living_street: 1, service: 1 };
  function fzSegs(v) { // Straßen aus den geladenen Kacheln im Umfeld der Strecke (Busse)
    const pad = 160, xs = v.pts.map((p) => p.x), zs = v.pts.map((p) => p.z), x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, z0 = Math.min(...zs) - pad, z1 = Math.max(...zs) + pad, out = [];
    for (const k in T) {
      const t = T[k]; if (!t.data || !t.data.rd) continue;
      t.data.rd.forEach(([kind, f]) => {
        if (!FZ_STRASSE[kind]) return;
        for (let i = 0; i + 3 < f.length; i += 2) {
          const a = f[i], b = f[i + 1], c = f[i + 2], d = f[i + 3];
          if ((a < x0 && c < x0) || (a > x1 && c > x1) || (b < z0 && d < z0) || (b > z1 && d > z1)) continue;
          out.push(a, b, c, d);
        }
      });
    }
    return out;
  }
  function fzSnap(s, x, z, max) { // nächster Punkt auf den Segmenten (mit deren Richtung), sonst unverändert
    let bx = x, bz = z, bd = max * max, sx = 0, sz = 0;
    for (let i = 0; i < s.length; i += 4) {
      const ax = s[i], az = s[i + 1], dx = s[i + 2] - ax, dz = s[i + 3] - az, l2 = dx * dx + dz * dz;
      const f = l2 > 0 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0, px = ax + dx * f, pz = az + dz * f, d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < bd) { bd = d; bx = px; bz = pz; sx = dx; sz = dz; }
    }
    return { x: bx, z: bz, sx, sz };
  }
  const fzStateEl = () => $('#fzState');
  function fzSetState(t) { const el = fzStateEl(); if (el) el.textContent = t; }
  function fzRemove(v) { FZ.group.remove(v.g); const i = markers.indexOf(v.m); if (i >= 0) markers.splice(i, 1); v.m.el.remove(); if (FZ.sel === v.id) { FZ.sel = null; FZ.follow = null; FZ.trail = []; } }
  async function fzPoll() {
    if (FZ.busy || document.hidden || !vbbOk || !S.L.fahrzeuge) return;
    FZ.busy = true;
    try {
      const d = await vbbGet('/radar?north=' + RADAR[2] + '&west=' + RADAR[1] + '&south=' + RADAR[0] + '&east=' + RADAR[3] + '&results=80&duration=240&frames=1&polylines=false'), now = Date.now(), seen = new Set();
      (d.movements || []).forEach((mv) => {
        if (!mv.location || !mv.line || !mv.tripId) return;
        const x = fzX(mv.location.longitude), z = fzZ(mv.location.latitude);
        if (x < X0 - 500 || x > X0 + W + 500 || z < Z0 - 500 || z > Z0 + H + 500) return; // nur im Kartenausschnitt
        seen.add(mv.tripId);
        const kind = fzLook(mv.line);
        let v = FZ.list.get(mv.tripId);
        if (!v) {
          const g = fzModel(kind); g.visible = false; FZ.group.add(g);
          const m = addMarker('veh', '<b>' + esc(mv.line.name) + '</b>', x, 8, z, () => { const c = FZ.list.get(mv.tripId); if (c) fzShow(c); }, null);
          m.el.classList.add('vehicle', kind);
          v = { id: mv.tripId, kind, g, m, x, z, ox: 0, oz: 0, miss: 0, segs: [] };
          FZ.list.set(mv.tripId, v);
        }
        v.miss = 0; v.pts = fzPath(mv, now); v.t0 = now; v.line = mv.line.name; v.dir = mv.direction || ''; v.op = (mv.line.operator && mv.line.operator.name) || '';
        v.m.el.title = v.line + ' nach ' + (v.dir || '?');
        if (kind === 'bus') { v.legs = null; v.segs = fzSegs(v); } else v.legs = fzLegsFor(v); // Züge: Gleisweg, Busse: Gerade mit Einrasten
        const p0 = v.legs && v.legs.length ? fzLegAt(v.legs[0], 0) : v.pts[0];
        v.ox = v.x - p0.x; v.oz = v.z - p0.z; // Ausgleich: die angezeigte Lage gleitet zur neuen
      });
      FZ.list.forEach((v, id) => { if (!v.sim && !seen.has(id) && ++v.miss > 2) { fzRemove(v); FZ.list.delete(id); } });
      FZ.liveN = [...FZ.list.values()].filter((v) => !v.sim).length; FZ.stand = now; fzSimSync(); fzSetState('live, Stand ' + clockFmt.format(new Date(now)) + ' Uhr, ' + FZ.list.size + ' Fahrzeuge');
    } catch (e) { fzSetState('Dienst nicht erreichbar, Fahrzeuge bleiben stehen'); }
    FZ.busy = false;
  }
  function fzTick() {
    const t = Date.now();
    FZ.list.forEach((v) => {
      if (!v.pts) return;
      let p, ang;
      if (v.legs && v.legs.length) { // Zug: entlang des Gleises, Richtung = Gleisrichtung
        const r = fzAtLegs(v, t); p = { x: r.x, z: r.z }; if (r.dx || r.dz) ang = Math.atan2(r.dz, r.dx);
        const dec = Math.exp(-(t - v.t0) / 6000); p = { x: p.x + v.ox * dec, z: p.z + v.oz * dec };
      } else if (v.kind !== 'bus') { // Zug ohne weiteren Halt in den Daten: bleibt stehen
        p = { x: v.pts[0].x, z: v.pts[0].z };
      } else { // Bus: gerade Verbindung, auf die Straße gelegt, Richtung = Straße vorwärts zum nächsten Halt
        p = fzAt(v.pts, t); const dec = Math.exp(-(t - v.t0) / 6000); p = { x: p.x + v.ox * dec, z: p.z + v.oz * dec };
        let seg = null;
        if (v.segs.length) { const q = fzSnap(v.segs, p.x, p.z, 45); if (q.sx || q.sz) seg = q; p = q; }
        const nx = v.pts.find((q, i) => i > 0 && t < q.a) || v.pts[v.pts.length - 1], tx = nx.x - p.x, tz = nx.z - p.z, tl = Math.hypot(tx, tz);
        if (seg) { const l = Math.hypot(seg.sx, seg.sz), ux = seg.sx / l, uz = seg.sz / l, sign = tl > 1 ? (ux * tx + uz * tz >= 0 ? 1 : -1) : (v.ang !== undefined && ux * Math.cos(v.ang) + uz * Math.sin(v.ang) < 0 ? -1 : 1); ang = Math.atan2(uz * sign, ux * sign); }
        else if (tl > 1) ang = Math.atan2(tz, tx);
      }
      if (ang !== undefined) { if (v.ang === undefined) v.ang = ang; else { let da = ang - v.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; v.ang += da * 0.2; } }
      v.x += (p.x - v.x) * 0.35; v.z += (p.z - v.z) * 0.35; // leicht glätten, damit das Fahrzeug beim Einrasten nicht springt
      v.g.visible = S.L.fahrzeuge; v.g.position.set(v.x, 0.1, v.z); v.g.rotation.y = -(v.ang || 0);
      v.m.v.set(v.x, 8, v.z);
    });
    const sel = FZ.sel && FZ.list.get(FZ.sel);
    if (sel) {
      if (FZ.follow === sel.id) { view.tx += (sel.x - view.tx) * 0.12; view.tz += (sel.z - view.tz) * 0.12; applyView(); }
      const last = FZ.trail[FZ.trail.length - 1];
      if (!last || Math.hypot(sel.x - last[0], sel.z - last[1]) > 3) FZ.trail.push([sel.x, sel.z, t]);
      while (FZ.trail.length && t - FZ.trail[0][2] > 180000) FZ.trail.shift();
    }
    fzDrawTrail(t);
  }
  const fzTrailGeo = new THREE.BufferGeometry(), fzTrailPos = new Float32Array(600 * 3), fzTrailCol = new Float32Array(600 * 4);
  fzTrailGeo.setAttribute('position', new THREE.BufferAttribute(fzTrailPos, 3).setUsage(THREE.DynamicDrawUsage));
  fzTrailGeo.setAttribute('color', new THREE.BufferAttribute(fzTrailCol, 4).setUsage(THREE.DynamicDrawUsage));
  const fzTrailLine = new THREE.Line(fzTrailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })); fzTrailLine.frustumCulled = false; scene.add(fzTrailLine);
  function fzDrawTrail(t) { // verblassende Spur hinter dem gewählten Fahrzeug
    const pts = FZ.trail.slice(-600), n = pts.length;
    fzTrailLine.visible = n > 1 && S.L.fahrzeuge;
    if (!fzTrailLine.visible) return;
    pts.forEach((q, i) => { const a = 1 - clamp((t - q[2]) / 180000, 0, 1); fzTrailPos.set([q[0], 1.2, q[1]], i * 3); fzTrailCol.set([0.05, 0.89, 0.92, a], i * 4); });
    fzTrailGeo.setDrawRange(0, n); fzTrailGeo.attributes.position.needsUpdate = true; fzTrailGeo.attributes.color.needsUpdate = true;
  }
  function fzShow(v) { // Karte zum Fahrzeug: Lage, nächster Halt, Verfolgen
    if (FZ.sel !== v.id) { FZ.sel = v.id; FZ.follow = null; FZ.trail = []; }
    const nx = (v.pts || []).find((q, i) => i > 0 && Date.now() < q.a + 1000), dl = nx && nx.delay != null ? Math.round(nx.delay / 60) : null;
    openCard('<h3>' + esc(v.line) + ' nach ' + esc(v.dir || '?') + '</h3><p class="sub">' + esc(FZ_ART[v.kind]) + (v.op ? ' · ' + esc(v.op) : '') + '</p><dl>'
      + (nx ? '<dt>Nächster Halt</dt><dd>' + esc(nx.name || '?') + '<span class="s">an ' + clockFmt.format(new Date(nx.a)) + ' Uhr' + (dl ? ' (' + (dl > 0 ? '+' : '') + dl + ' Min.)' : '') + '</span></dd>' : '') + '</dl>'
      + '<p><button class="wxbtn" id="fzFollow" type="button">' + (FZ.follow === v.id ? 'Verfolgen beenden' : 'Verfolgen') + '</button></p>'
      + '<p class="note">' + (v.sim ? 'Aus dem Fahrplan berechnet, ohne Verspätungen und Ausfälle. Mit eingeblendeten Live-Daten (unter „Aktuell“) zeigt die Karte die echten Positionen.' : 'Position nach den Echtzeitdaten berechnet, ' + (v.legs ? 'entlang des Gleises' : 'zwischen den Haltestellen') + '.') + ' Das Modell ist eine Miniatur nach Betreiber, Wagenzahl und Länge sind angenommen.</p>');
    S.card = { type: 'veh', id: v.id };
    $('#fzFollow', cardBody).onclick = (e) => { FZ.follow = FZ.follow === v.id ? null : v.id; e.target.textContent = FZ.follow === v.id ? 'Verfolgen beenden' : 'Verfolgen'; };
    flyTo({ tx: v.x, tz: v.z, dist: Math.min(view.dist, 220), phi: Math.min(view.phi, 1.0) }, 900);
  }
  canvas.addEventListener('pointerdown', () => { if (FZ.follow) { FZ.follow = null; const b = $('#fzFollow', cardBody); if (b) b.textContent = 'Verfolgen'; } }); // wer die Karte anfasst, löst die Verfolgung
  // ---- Fahrzeuge aus dem Sollfahrplan (data/fahrten.js): fahren immer, ohne Verbindung zu Dritten; mit Live-Daten ersetzen die echten Positionen sie
  function fzSimSync() {
    const FA = window.AL_FAHRTEN; if (!FA || !S.L.fahrzeuge) return;
    const n = nowB(), day0 = AL.berlinToUTC(n.y, n.mo, n.d, 0, 0), now = Date.now(), di = Math.round((Date.UTC(n.y, n.mo - 1, n.d) - Date.parse(FA.base)) / 864e5);
    const liveOk = vbbOk && FZ.stand && now - FZ.stand < 100000 && FZ.liveN > 0, want = new Set();
    if (!liveOk) FA.trips.forEach((tr, ti) => {
      for (const k of [0, 1]) { // heute und gestern (Fahrten über Mitternacht)
        const idx = di - k, st = tr[3]; if (idx < 0 || FA.svc[tr[2]][idx] !== '1') continue;
        const t0 = day0 + (st[0][3] - k * 86400) * 1000, t1 = day0 + (st[st.length - 1][2] - k * 86400) * 1000;
        if (now < t0 - 2000 || now > t1 + 2000) continue;
        const id = 'sim:' + ti + ':' + k; want.add(id);
        if (FZ.list.has(id)) continue;
        const r = FA.routes[tr[0]], kind = r[1] === 'bus' || r[1] === 'sev' ? 'bus' : /ODEG|Ostdeutsche/i.test(r[2]) ? 'odeg' : 'db';
        const pts = st.map((q) => ({ x: q[0], z: q[1], a: day0 + (q[2] - k * 86400) * 1000, d: day0 + (q[3] - k * 86400) * 1000 }));
        const x = pts[0].x, z = pts[0].z, g = fzModel(kind); g.visible = false; FZ.group.add(g);
        const m = addMarker('veh', '<b>' + esc(r[0]) + '</b>', x, 8, z, () => { const c = FZ.list.get(id); if (c) fzShow(c); }, null);
        m.el.classList.add('vehicle', kind, 'sim'); m.el.title = r[0] + ' nach ' + (FA.heads[tr[1]] || '?') + ' (Fahrplan)';
        const v = { id, kind, g, m, x, z, ox: 0, oz: 0, miss: 0, segs: [], sim: true, pts, t0: now, line: r[0], dir: FA.heads[tr[1]] || '', op: r[2] };
        if (kind === 'bus') v.segs = fzSegs(v); else { v.legs = fzLegsFor(v); const l0 = v.legs[0]; if (l0) { const q = fzLegAt(l0, 0); v.x = q.x; v.z = q.z; } }
        FZ.list.set(id, v);
      }
    });
    FZ.list.forEach((v, id) => { if (v.sim && !want.has(id)) { fzRemove(v); FZ.list.delete(id); } });
    if (!liveOk) { const ns = [...FZ.list.values()].filter((v) => v.sim).length; fzSetState('Fahrplan (simuliert), ' + ns + ' Fahrzeuge' + (vbbOk || !VBB_HOSTS.length ? '' : ', Live nach Einwilligung unter „Aktuell“')); }
  }
  function fzStart() {
    if (!S.L.fahrzeuge) return;
    if (!FZ.simTimer) { fzSimSync(); FZ.simTimer = setInterval(fzSimSync, 10000); }
    if (vbbOk && !FZ.timer) { fzSetState('Live wird geladen …'); fzPoll(); FZ.timer = setInterval(fzPoll, 30000); }
  }
  function fzStop() { clearInterval(FZ.timer); FZ.timer = 0; clearInterval(FZ.simTimer); FZ.simTimer = 0; FZ.liveN = 0; FZ.stand = 0; FZ.list.forEach(fzRemove); FZ.list.clear(); FZ.trail = []; FZ.sel = null; FZ.follow = null; fzSetState('ausgeblendet'); S.dirty = true; }

  function renderStop() {
    const s = STOPS[S.card.i], g = s.g >= 0 ? FPG[s.g] : null, n = nowB(), sd = S.stopDay || (S.stopDay = { y: n.y, mo: n.mo, d: n.d }); // eigener Tag der Haltestelle, nicht der Tag des Sonnenstands
    const isToday = sd.y === n.y && sd.mo === n.mo && sd.d === n.d, nowMin = n.h * 60 + n.mi;
    let html = '<h3>' + esc(s.n) + '</h3><p class="sub">' + (s.k === 'rail' ? 'Bahnhof / Haltepunkt' : 'Bushaltestelle') + (whereOf(s) ? ' · ' + esc(whereOf(s)) : '') + '</p>';
    const planStart = html.length;
    if (!g) html += '<p class="note">Zu dieser Haltestelle wurde im Fahrplan keine passende Haltestelle gefunden (Lage oder Name weichen ab).</p>';
    else {
      const RAIL_T = ['bahn', 'sbahn', 'ubahn', 'sev'], modeOk = (ri) => !s.mode || (RAIL_T.indexOf(FP.routes[ri][1]) >= 0) === (s.mode === 'rail');
      const r = fpDeps(g); if (r.list) r.list = r.list.filter(([m, ri]) => modeOk(ri));
      if (r.list && isToday) { // heute: nur die nächsten 24 Stunden ab jetzt (Rest von heute plus die frühen Abfahrten von morgen), nichts Vergangenes
        const tm = new Date(Date.UTC(n.y, n.mo - 1, n.d + 1)), rt = fpDeps(g, { y: tm.getUTCFullYear(), mo: tm.getUTCMonth() + 1, d: tm.getUTCDate() });
        r.list = r.list.filter(([m, ri]) => m >= nowMin || (m >= nowMin - 60 && ['bahn', 'sbahn', 'ubahn'].indexOf(FP.routes[ri][1]) >= 0)).concat(rt.list ? rt.list.filter(([m, ri]) => m < nowMin && modeOk(ri)).map((x) => [x[0], x[1], x[2], 1]) : []);
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
            + esc(FP.heads[hi]) + '<span class="s">' + esc(opShortK(rt[2])) + '</span></span></div>';
        }).join('') + '</div>' + (sev ? '<p class="note">Grau-gelbe Linien: Bus unter einer Bahnliniennummer, vermutlich Schienenersatzverkehr (Schlussfolgerung aus den Daten).</p>' : '');
      }
      html += '<p class="note">Sollfahrplan ohne Echtzeit, ohne Gewähr. Abweichungen, Baustellen und Ausfälle sind nicht enthalten.</p>';
    }
    // Zwei Reiter statt zwei langer Listen untereinander: Live (nächste 3 Stunden) und Plan (Sollfahrplan der nächsten 24 Stunden bzw. des gewählten Tages)
    const plan = html.slice(planStart); html = html.slice(0, planStart);
    const hasLive = VBB_HOSTS.length > 0; // ohne Live-Dienste (ort.json: fahrplan.live_aus) gibt es nur den Plan
    const tab = hasLive ? (S.stopTab || (vbbOk ? 'live' : 'plan')) : 'plan';
    html += '<div class="chips tabs" role="tablist"' + (hasLive ? '' : ' hidden') + '>' + [['live', 'Live'], ['plan', 'Plan']].map(([k, l]) => '<button class="chip" role="tab" data-tab="' + k + '">' + l + '</button>').join('') + '</div>'
      + '<div id="tabLive" role="tabpanel"><div id="liveBox"></div></div><div id="tabPlan" role="tabpanel" hidden>' + plan + '</div>';
    html += sourceLine('Fahrplan: ' + (ORT.betreiberKurz || '') + ' (' + (ORT.lizenz || '') + '), Stand ' + (FP ? fmtYmd(FP.stand.replace(/-/g, '')) : '–') + '; Lage: OpenStreetMap', ORT.lizenzUrl || '#');
    openCard(html); S.card = { type: 'stop', i: s.i };
    let liveDone = false;
    const showTab = (t) => {
      S.stopTab = t;
      $$('[data-tab]', cardBody).forEach((b) => { const on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      $('#tabLive', cardBody).hidden = t !== 'live'; $('#tabPlan', cardBody).hidden = t !== 'plan';
      if (t === 'live' && !liveDone) { liveDone = true; liveFill(s, $('#liveBox', cardBody)); }
      if (t === 'plan') { const nx = $('.dep.next', cardBody), box = $('#deps', cardBody); if (nx && box) box.scrollTop = Math.max(0, nx.offsetTop - box.offsetTop - 6); }
    };
    $$('[data-tab]', cardBody).forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
    showTab(tab);
    $$('[data-d]', cardBody).forEach((b) => { b.onclick = () => {
      const k = +b.dataset.d, t = new Date(k === 0 ? Date.UTC(n.y, n.mo - 1, n.d) : Date.UTC(sd.y, sd.mo - 1, sd.d + k));
      S.stopDay = { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
      renderStop();
    }; });
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
    const pl = placeOf(e), head = '<h3>' + esc(e.title) + '</h3><p class="sub">' + (e.dummy ? '<span class="tag unknown">Beispieldaten</span> ' : '') + esc(dateFmt.format(new Date(e.t))) + ', ' + esc(e.from) + (e.to ? '–' + esc(e.to) : '') + ' Uhr</p>', body = '<dl>'
      + '<dt>Ort</dt><dd>' + esc(e.place || 'unbekannt') + (e.placeNote ? '<span class="s">' + esc(e.placeNote) + '</span>' : '') + '</dd><dt>Kategorie</dt><dd>' + esc(e.cat || '–') + '</dd></dl>'
      + (e.desc ? '<p>' + esc(e.desc) + '</p>' : '') + (e.url && !e.dummy ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">Zur Veranstaltung beim Veranstalter →</a>' : '')
      + sourceLine(e.dummy ? 'Platzhalter, keine echte Veranstaltung' : (e.source || 'unbekannt'), e.url);
    if (pl) {
      const mk = pl.marker && pl.marker.el; // Markierung bleibt am Termin, der Ort wird im zweiten Reiter gezeigt
      tabbed(head, [{ k: 'termin', label: 'Veranstaltung', html: body }, { k: 'ort', label: 'Ort: ' + esc(pl.name.length > 22 ? pl.name.slice(0, 21) + '…' : pl.name), html: placeHead(pl) + placePane(pl) }], 'termin');
      if (mk) mk.classList.add('sel');
    } else openCard(head + body);
    flyTo({ tx: e.x, tz: e.z, dist: Math.min(view.dist, 300), phi: Math.min(view.phi, 1.1) }, 900);
  }
  function showEventsAt(list) {
    const pl = placeOf(list[0]), head = '<h3>' + esc(list[0].place || 'Veranstaltungen') + '</h3><p class="sub">' + list.length + ' Veranstaltung(en)</p>';
    if (pl) tabbed(head, [{ k: 'termine', label: 'Termine (' + list.length + ')', html: list.map(evItem).join('') }, { k: 'ort', label: 'Ort', html: placePane(pl) }], 'termine');
    else {
      openCard(head + list.map(evItem).join(''));
      $$('[data-ev]', cardBody).forEach((b) => { b.onclick = () => showEvent(EV[+b.dataset.ev]); });
    }
  }
  const GESCH = window.AL_GESCHICHTE && window.AL_GESCHICHTE.orte;
  function geschichteHtml(name) { // Wikipedia-Text (CC BY-SA 4.0) mit Urhebernennung
    const g = GESCH && GESCH[name]; if (!g) return '';
    const txt = g.geschichte || g.text, vers = g.version ? ' (Version vom ' + g.version.slice(8, 10) + '.' + g.version.slice(5, 7) + '.' + g.version.slice(0, 4) + ')' : '';
    return '<h4 class="ge-h">' + (g.geschichte ? 'Ortsgeschichte' : 'Kurzbeschreibung') + '</h4><p class="ge">' + esc(txt).replace(/\n+/g, '</p><p class="ge">') + '</p>'
      + '<p class="note">Text aus dem Wikipedia-Artikel <a href="' + esc(g.url) + '" target="_blank" rel="noopener">„' + esc(g.titel) + '“</a>' + vers + ', Autoren siehe <a href="' + esc(g.hist) + '" target="_blank" rel="noopener">Versionsgeschichte</a>, Lizenz <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.de" target="_blank" rel="noopener">CC BY-SA 4.0</a> (gekürzt).</p>';
  }
  function goOrtsteil(i) {
    const o = OT[i], nA = ROWS.filter((r) => r[4] === i).length, rail = STOPS.filter((s) => s.o === i && s.k === 'rail'), bus = STOPS.filter((s) => s.o === i && s.k === 'bus').length;
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); o.marker.el.classList.add('sel');
    const ew = ewText(o), inf = o.info || {};
    openCard('<h3>' + esc(o.n) + '</h3><p class="sub">Ortsteil: ' + esc(ART) + ' ' + esc(ORT_NAME) + '</p><dl>'
      + '<dt>Einwohner</dt><dd>' + (ew ? esc(ew) + '<span class="s">Angabe im Ortsporträt der Gemeinde</span>' : 'keine Angabe der Gemeinde') + '</dd>'
      + '<dt>Fläche</dt><dd>' + km2(o) + ' km²<span class="s">nach der Grenze in OpenStreetMap</span></dd>' + (o.hn != null ? '<dt>Höhe</dt><dd>' + nfH(o.hn) + ' m über NHN<span class="s">in der Ortsmitte, Geländemodell</span></dd>' : '')
      + (inf.erstwaehnung ? '<dt>Erwähnt seit</dt><dd>' + inf.erstwaehnung + '</dd>' : '')
      + (inf.sehenswert && inf.sehenswert.length ? '<dt>Sehenswert</dt><dd>' + inf.sehenswert.map(esc).join(', ') + '<span class="s">laut Ortsporträt der Gemeinde</span></dd>' : '')
      + '<dt>Adressen</dt><dd>' + nA + '</dd><dt>Gebäude</dt><dd>' + o.nB + '</dd><dt>Bahnhof</dt><dd>' + (rail.length ? esc(rail[0].n) + ' (DB)' : 'keiner') + '</dd>'
      + '<dt>Bushaltepunkte</dt><dd>' + bus + '</dd><dt>Orte</dt><dd>' + PLACES.filter((p) => p.o === i).length + '</dd>'
      + (BRW && BRW_Z.some((q) => q.o === i) ? '<dt>Bodenrichtwert</dt><dd>' + BRW_Z.filter((q) => q.o === i).map((q) => '<b>' + esc(fmtW(q.w)) + '</b> <span class="s">' + esc(q.artDe) + '</span>').join('') + '<span class="s">Stichtag ' + esc(fmtIso(BRW.stichtag)) + ', Bauland</span></dd>' : '') + '</dl>'
      + geschichteHtml(o.n) + (ORTSTEILE_SEITE ? '<a href="' + ORTSTEILE_SEITE + '" target="_blank" rel="noopener">Ortsporträt auf der Website von ' + esc(ORT_NAME) + ' →</a>' : '')
      + sourceLine('Ortsporträts: Website der Gemeinde' + (M.ortsteilInfo && M.ortsteilInfo.gelesen ? ' (gelesen ' + fmtIso(M.ortsteilInfo.gelesen) + ')' : '') + '; Grenzen: OpenStreetMap; Adressen und Gebäude: ' + GEO.kurz, ORTSTEILE_SEITE));
    flyTo({ tx: o.x, tz: o.z, dist: 1500, phi: 0.95 }, 1600);
  }

  function openPanel(name, keep) {
    if (name === 'sources') { const d = $('#sources'); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); return; }
    S.panel = (S.panel === name && !keep) ? null : name;
    $$('.panel').forEach((p) => { p.hidden = p.id !== 'panel-' + S.panel; });
    $$('.pill[data-panel]').forEach((b) => b.classList.toggle('on', b.dataset.panel === S.panel));
    document.body.classList.toggle('has-panel', !!S.panel);
    if (S.panel === 'sun') { applySun(); if (S.spot) scheduleSpot(); }
    if (S.panel === 'traffic') {
      trafficFill();
      if (window.ALL && ORT.baustellen) window.ALL.baustellen($('#bauBox'));
      if (window.ALL && ORT.muell && !$('#muellBox').dataset.on) { $('#muellBox').dataset.on = '1'; window.ALL.muell($('#muellBox')); }
    }
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
    else { clearSel(); openCard('<h3>' + esc(STREETS[r[0]] + ' ' + r[1]) + '</h3><p class="sub">' + esc(otName(r[4])) + '</p><p class="note">Zu dieser Adresse gibt es kein Gebäudemodell in der Nähe.</p>' + sourceLine(GEO.kurz + (ADDR_OSM ? ' und OpenStreetMap' : '') + ', Adressen (' + GEO.lizenz + ')', GEO.url)); }
  }
  qIn.addEventListener('input', () => { if (!qIn.value.trim()) qOt = -1; searchRun(); });
  qIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && qItems[0]) { e.preventDefault(); qItems[0].a(); } if (e.key === 'Escape') { qRes.hidden = true; } });
  qIn.addEventListener('focus', () => { if (qIn.value.trim().length >= 2) searchRun(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search')) qRes.hidden = true; });

  // ------------------------------------------------------------------ Menues
  if ($('#otCount')) $('#otCount').textContent = OT.length + ' Ortsteile';
  if (!BRW) { // ohne Bodenrichtwerte (z. B. Bayern): Schalter ausblenden
    $$('input[name=colormode][value=brw], input[data-layer=brw]').forEach((el) => { const l = el.closest('label'); if (l) l.style.display = 'none'; });
  }
  $$('input[name=colormode]').forEach((r) => { r.onchange = () => { S.colorMode = r.value; for (const k in T) recolorTile(T[k]); updateLegend(); }; });
  const otSel = $('#otSel');
  OT.forEach((o, i) => { const op = document.createElement('option'); op.value = i; op.textContent = o.n; otSel.appendChild(op); });
  if (M.nb && M.nb.x != null) { const op = document.createElement('option'); op.value = 'nb'; op.textContent = M.nb.n + ' (Nachbarort)'; otSel.appendChild(op); }
  otSel.onchange = () => {
    if (otSel.value === 'nb') flyTo({ tx: M.nb.x, tz: M.nb.z, dist: 2400, phi: 0.9 }, 1200);
    else if (otSel.value !== '') goOrtsteil(+otSel.value);
    otSel.value = '';
  };
  // ---- Landwirtschaft und Sicherheit: Löschwasser, Sirenen, Anlagen, Flugplätze (OpenStreetMap, data/notfall.js)
  const NFT = { // Art: Name, Zeichen, Farbe, Gruppe, Hinweis
    H: ['Hydrant', 'H', '#d04a4a', 'notfall'], B: ['Löschbrunnen', 'B', '#3a8fe0', 'notfall'], T: ['Löschwasserbehälter', 'T', '#3a8fe0', 'notfall'], P: ['Löschteich', 'P', '#3a8fe0', 'notfall'], S: ['Saugstelle', 'S', '#3a8fe0', 'notfall'],
    I: ['Sirene', '📢', '#d9a21b', 'sirenen'], W: ['Windrad', '🌀', '#2c8ea0', 'energie'], G: ['Biogas- oder Biomasseanlage', '♨', '#4aa84a', 'energie'], O: ['Solarpark', '☀', '#c9892a', 'energie'], F: ['Flugplatz', '✈', '#5a6fd0', 'flug'],
    k: ['Spielplatz', '🎠', '#d86fa0', 'freizeit'], q: ['Sportanlage', '⚽', '#4aa84a', 'freizeit'], a: ['Aussichts- oder Rastplatz', '🔭', '#6a8fd0', 'freizeit'], i: ['Informationstafel/Wegweiser', 'ℹ', '#2c8ea0', 'freizeit'], d: ['Denkmal/Geschichtsort', '🏛', '#a07a4a', 'freizeit'],
    b: ['Sitzbank', '💺', '#8a8f98', 'alltag'], u: ['Unterstand', '⛺', '#8a8f98', 'alltag'], w: ['Trinkwasser', '🚰', '#3a8fe0', 'alltag'], t: ['Toilette', '🚻', '#8a8f98', 'alltag'], l: ['Ladesäule', '🔌', '#4aa84a', 'alltag'], r: ['Fahrradständer', '🚲', '#8a8f98', 'alltag'], v: ['Verkaufsautomat', '🛒', '#c9892a', 'alltag'],
    L: ['Straßenlampe', '💡', '#d9c24a', 'lampen'],
  };
  const NF = window.AL_NOTFALL;
  const NFHINT = {
    notfall: 'Löschwasserangaben stammen von Mitwirkenden bei OpenStreetMap und können unvollständig oder veraltet sein. Ob und wie viel Löschwasser an dieser Stelle verfügbar ist, bestätigt nur die Feuerwehr oder der Wasserversorger.',
    sirenen: 'Sirenenstandort laut OpenStreetMap, keine amtliche Liste. Ob die Sirene in Betrieb ist, ist nicht belegt.',
    energie: 'Anlage laut OpenStreetMap, ohne Gewähr. Leistung und Betreiber stehen nur, wenn sie dort eingetragen sind.',
    freizeit: 'Eintrag aus OpenStreetMap, ohne Gewähr. Öffnungszeiten, Zustand und Nutzungsbedingungen bitte beim Betreiber oder vor Ort erfragen.',
    alltag: 'Eintrag aus OpenStreetMap, ohne Gewähr. Ob die Einrichtung vorhanden und nutzbar ist, kann abweichen.',
    lampen: 'Straßenlampe laut OpenStreetMap, nicht vollständig.' + (ORT.meldeportal ? ' <b>Defekt oder dunkel?</b> Meldung im <a href="' + esc(ORT.meldeportal.url) + '" target="_blank" rel="noopener">' + esc(ORT.meldeportal.name) + '</a>: Straße und Hausnummer oder diese Lampe (Nummer, falls am Mast zu lesen) nennen.' : ''),
    flug: 'Rund um Flugplätze gelten für Drohnen Beschränkungen. Die amtlichen Zonen zeigt die <a href="' + (window.ALA ? window.ALA.DIPUL : 'https://maptool-dipul.dfs.de/?language=de') + '" target="_blank" rel="noopener">Karte der Deutschen Flugsicherung (dipul)</a>. Bitte vor jedem Flug dort nachsehen. Der Eintrag hier stammt aus OpenStreetMap.',
  };
  function showNf(it, mk) {
    const t = NFT[it[0]];
    $$('.mk.sel').forEach((m) => m.classList.remove('sel')); mk.el.classList.add('sel');
    openCard('<h3>' + esc(t[0]) + '</h3><p class="sub">' + esc(it[3] || 'ohne weitere Angaben') + '</p><p class="note">' + NFHINT[t[3]] + '</p>'
      + sourceLine('OpenStreetMap, Objekt ' + it[4], 'https://www.openstreetmap.org/' + it[4]));
    flyTo({ tx: it[1], tz: it[2], dist: Math.min(view.dist, it[0] === 'W' || it[0] === 'F' ? 900 : 260), phi: Math.min(view.phi, 1.1) }, 900);
  }
  if (NF && NF.items) NF.items.forEach((it) => {
    const t = NFT[it[0]]; if (!t) return;
    const mk = addMarker('nf', t[1], it[1], it[0] === 'W' ? 60 : it[0] === 'F' ? 30 : 8, it[2], () => showNf(it, mk), null);
    mk.grp = t[3]; mk.el.style.setProperty('--c', t[2]); mk.el.title = t[0] + (it[3] ? ': ' + it[3] : '');
    if (/[^\x00-\x7f]/.test(t[1])) mk.el.classList.add('big');
  });
  function showAgrar() {
    $$('.mk.sel').forEach((m) => m.classList.remove('sel'));
    openCard('<h3>Bodenfeuchte und Agrarwetter</h3><p class="sub">Für Felder und Gärten, Modellrechnung des DWD</p><div id="agrCard"></div>');
    if (window.ALA) window.ALA.mountBoden($('#agrCard'));
  }
  const oa = $('#openAgrar'); if (oa) oa.onclick = () => showAgrar();
  (function agrAktuell() { // Waldbrandstufe, Drohnenhinweis und Maerker im Bereich "Aktuell"
    const A = window.ALA, el = $('#agrAktuell'); if (!A || !el) return;
    el.innerHTML = (ORT.waldbrand ? '<div class="lg">' + A.brandHtml() + '</div>' : '') + (ORT.meldeportal ? '<div class="lg">' + A.maerkerHtml() + '</div>' : '') + (ORT.drohne ? '<div class="lg">' + A.drohneHtml() + '</div>' : '');
  })();

  // ---- Touren (Rad, Wandern, Inline-Skaten aus OpenStreetMap, data/touren.js): Bänder auf dem Boden, Breite wächst mit der Entfernung
  const TRCOL = { 'Inline-Skaten': [1, 0.35, 0.65], Rad: [0.23, 0.63, 1], Wandern: [0.5, 0.84, 0.31], Mountainbike: [0.91, 0.53, 0.23] };
  function buildTouren() {
    const T = window.AL_TOUREN; if (TR.built || !T || !T.routen) return; TR.built = true;
    const pos = [], off = [], col = [], idx = [];
    T.routen.forEach((r, ri) => {
      const y = 0.6 + ri * 0.05, c = TRCOL[r.art] || [1, 1, 1], w = r.art === 'Inline-Skaten' ? 1.25 : 1;
      r.lines.forEach((f) => {
        const n = f.length / 2; if (n < 2) return;
        for (let i = 0; i < n; i++) {
          const x = f[i * 2], z = f[i * 2 + 1], a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
          let dx = f[b * 2] - f[a * 2], dz = f[b * 2 + 1] - f[a * 2 + 1]; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
          const k = pos.length / 3;
          pos.push(x, y, z, x, y, z); off.push(-dz * w, 0, dx * w, dz * w, 0, -dx * w); col.push(c[0], c[1], c[2], c[0], c[1], c[2]);
          if (i > 0) idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        }
      });
    });
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('off', new THREE.Float32BufferAttribute(off, 3)); g.setAttribute('col', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    TR.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, uniforms: { uW: { value: 4 } },
      vertexShader: 'attribute vec3 off; attribute vec3 col; uniform float uW; varying vec3 vC; void main(){ vC = col; gl_Position = projectionMatrix * modelViewMatrix * vec4(position + off * uW, 1.0); }',
      fragmentShader: 'varying vec3 vC; void main(){ gl_FragColor = vec4(vC, 0.93); }',
    });
    TR.mesh = new THREE.Mesh(g, TR.mat); TR.mesh.frustumCulled = false; TR.mesh.renderOrder = 6; scene.add(TR.mesh); S.dirty = true;
  }
  function applyLayers() {
    ground.visible = S.L.photo; flat.visible = !S.L.photo; if (!S.L.photo) ensureAreas();
    for (const k in T) { const t = T[k]; if (t.bld && t.bld.mesh) t.bld.mesh.visible = S.L.buildings; if (t.trees && t.trees.mesh) t.trees.mesh.visible = S.L.trees; }
    FZ.group.visible = S.L.fahrzeuge; if (S.L.fahrzeuge) fzStart(); else fzStop();
    if (CL.mesh) CL.mesh.visible = S.L.wolken && CL.ok;
    if (S.L.touren) buildTouren();
    if (TR.mesh) TR.mesh.visible = S.L.touren;
    OVL.forEach((o) => { // Bildebenen aus dem Geländemodell: werden erst beim Einschalten geladen
      if (S.L[o.k] && !o.mesh && !o.busy) {
        o.busy = true;
        new THREE.TextureLoader().load('img/' + o.k + '.png?v=' + (window.AL_TV || ''), (t) => {
          t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
          const m = new THREE.Mesh(planeGeo(W, H), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: o.k === 'hang' ? 0.75 : 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -o.o, polygonOffsetUnits: -o.o }));
          m.position.set(CX, 0.05 + o.o * 0.03, CZ); m.renderOrder = o.o; m.visible = S.L[o.k]; scene.add(m); o.mesh = m; S.dirty = true;
        });
      }
      if (o.mesh) o.mesh.visible = S.L[o.k];
    });
    borders.visible = S.L.borders; brwGroup.visible = S.L.brw; updateLegend(); $('#sunShadows').checked = S.L.shadows; applySun(); S.moved = true; S.dirty = true;
  }
  if (!ORT.gelaende) { const rl = $('[data-layer=relief]'); if (rl && rl.closest('label')) rl.closest('label').hidden = true; } // Relief nur mit DGM (ort.json: bausteine.gelaende)
  $$('[data-layer]').forEach((c) => {
    c.onchange = () => {
      S.L[c.dataset.layer] = c.checked;
      if (c.dataset.layer === 'photo' && !c.checked) { S.L.roads = true; $('[data-layer=roads]').checked = true; }
      applyLayers();
    };
  });
  $('#sourcesBody').innerHTML = '<ul>'
    + '<li><b>Luftbild, Gebäude (3D, LoD2), Adressen:</b> ' + esc(GEO.text) + ', <a href="' + esc(GEO.url) + '" target="_blank" rel="noopener">' + esc(GEO.lizenz) + '</a>.' + (ADDR_OSM ? ' Adressen aus den Gebäudedaten, ergänzt um Hausnummern aus OpenStreetMap (ODbL), daher nicht vollständig.' : '') + ' ' + M.nBuildings + ' Gebäude, ' + M.nAddr + ' Adressen, Stand ' + esc(M.stand) + '. Das Luftbild ist ein Abzug mit 1 bis 2 m je Bildpunkt, nicht das Original mit 20 cm.</li>'
    + '<li><b>Straßen, Orte, Haltestellen, Flächen, Grenzen, Öffnungszeiten:</b> © OpenStreetMap-Mitwirkende, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ODbL</a>. Öffnungszeiten stammen aus OSM und können veraltet sein.</li>'
    + (BRW ? '<li><b>Bodenrichtwerte:</b> BORIS Brandenburg (Gutachterausschuss, bereitgestellt vom LGB), © GeoBasis-DE/LGB, <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2-0</a> (Daten geändert), Stichtag ' + esc(fmtIso(BRW.stichtag)) + '. Zone und Werte wie veröffentlicht, nur Euro je m². Ein Bodenrichtwert ist ein durchschnittlicher Lagewert und kein Verkehrswert. Maßgeblich ist die amtliche Auskunft (<a href="https://boris.brandenburg.de" target="_blank" rel="noopener">BORIS Brandenburg</a>).</li>' : '')
    + '<li><b>Bäume:</b> symbolisch. Sie werden in Waldflächen zufällig verteilt und zeigen keine echten Einzelbäume.</li>'
    + (ORT.gelaende ? '<li><b>Geländehöhen und Relief:</b> Digitales Geländemodell (DGM) der LGB, © GeoBasis-DE/LGB, <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2-0</a> (Daten geändert), auf 10 m gemittelt. Die Höhen (Meter über NHN) gelten für die Mitte des Gebäudes, Ortes oder Ortsteils. Das Relief ist stark überhöht (Faktor 6) und nur eine Schummerung auf dem Luftbild, das Gelände selbst bleibt flach.</li>' : '')
    + '<li><b>Dachfarbe und Solar-Eignung:</b> Die Dachfarbe ist der mittlere Farbton des Dachs im Luftbild (' + esc(GEO.fuss || GEO.text) + '). Schatten, Bäume und die Schrägsicht des Luftbilds verfälschen einzelne Dächer. Die Solar-Eignung rechnet aus Neigung und Ausrichtung der LoD2-Dachflächen die Strahlung relativ zur besten Lage (Süd, 35 Grad). Nutzbar sind 75 % einer geneigten und 50 % einer flachen Fläche bei 0,21 kWp je m², ' + SOL_KWH + ' kWh je kWp und Jahr bei bester Ausrichtung. Keine Verschattung, keine Statik, kein Denkmalschutz, keine Anlagenplanung: grobe Schätzung ohne Gewähr.</li>'
    + (window.AL_GESCHICHTE ? '<li><b>Ortsgeschichte:</b> Texte aus der <a href="https://de.wikipedia.org/" target="_blank" rel="noopener">deutschsprachigen Wikipedia</a> (Artikel der Ortsteile, Abschnitt Geschichte, gekürzt), <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.de" target="_blank" rel="noopener">CC BY-SA 4.0</a>. Autoren und Version stehen bei jedem Text. Gelesen am ' + esc(fmtIso(window.AL_GESCHICHTE.stand)) + '. Wikipedia kann sich ändern, maßgeblich ist der Artikel.</li>' : '')
    + (ORT.touren ? '<li><b>Touren:</b> Routen aus OpenStreetMap (© OpenStreetMap-Mitwirkende, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ODbL</a>)' + (window.AL_TOUREN && window.AL_TOUREN.wikivoyage ? ', Beschreibung aus <a href="' + esc(window.AL_TOUREN.wikivoyage.url) + '" target="_blank" rel="noopener">Wikivoyage</a> (CC BY-SA 4.0, mit Urhebernennung auf der Touren-Seite)' : '') + '. Zustand und Sperrungen vor Ort können abweichen.</li>' : '')
    + (ORT.gelaende ? '<li><b>Hangneigung und Geländesenken:</b> Eigene Auswertung des Geländemodells der LGB (© GeoBasis-DE/LGB, dl-de/by-2-0, Daten geändert): Neigung aus dem 10-m-Raster, Senken durch Füllen auf einem 20-m-Raster. Eine Geländeanalyse, keine Gefahrenkarte: Teiche, Kiesgruben, Gräben und Dämme erscheinen mit. Keine Aussage zu Starkregen oder Überschwemmung.</li>' : '')
    + (ORT.notfall ? '<li><b>Löschwasser, Sirenen, Windräder, Biogas- und Solaranlagen, Flugplätze, Freizeit- und Alltagseinrichtungen (Spielplätze, Sport, Denkmale, Tafeln, Bänke, Unterstände, Automaten), Straßenlampen:</b> © OpenStreetMap-Mitwirkende, <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">ODbL</a>' + (NF && NF.stand ? ', Stand ' + esc(fmtIso(NF.stand)) : '') + '. Von Mitwirkenden eingetragen, daher möglicherweise unvollständig oder veraltet. Maßgeblich sind Feuerwehr, Wasserversorger und Betreiber. Die Flugplätze ersetzen keine amtliche Auskunft zu Drohnen-Beschränkungen (<a href="https://maptool-dipul.dfs.de/?language=de" target="_blank" rel="noopener">dipul der Deutschen Flugsicherung</a>).</li>' : '')
    + (ORT.landwirt && window.AL_LANDW ? '<li><b>Bodenfeuchte und Agrarwetter:</b> Deutscher Wetterdienst (DWD), agrarmeteorologische Berechnungen (AMBAV, AMBETI) für die Station ' + esc(window.AL_LANDW.station.name) + ', <a href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html" target="_blank" rel="noopener">CC BY 4.0</a>. Modellrechnung für typische Böden, keine Messung auf dem Acker, Stand ' + esc(fmtIso(window.AL_LANDW.stand)) + '.</li>' : '')
    + (ORT.waldbrand ? '<li><b>Waldbrandgefahrenstufe:</b> ' + esc((window.AL_WALDBRAND && window.AL_WALDBRAND.quelle) || ORT.waldbrand.quelle || 'Landesbehörde') + ', <a href="' + esc((window.AL_WALDBRAND && window.AL_WALDBRAND.url) || ORT.waldbrand.url || '#') + '" target="_blank" rel="noopener">amtliche Seite</a>. Die Stufe wird täglich gelesen und nur angezeigt, wenn sie frisch ist. Maßgeblich ist die amtliche Seite.</li>' : '')
    + (ORT.meldeportal ? '<li><b>Mängel melden:</b> Verweis auf <a href="' + esc(ORT.meldeportal.url) + '" target="_blank" rel="noopener">' + esc(ORT.meldeportal.name) + '</a>' + (ORT.meldeportal.betreiber ? ' (' + esc(ORT.meldeportal.betreiber) + ')' : '') + '. Die Meldung geschieht dort, nicht auf dieser Seite.</li>' : '')
    + '<li><b>Besonnung und Schatten:</b> Schätzung ohne Gewähr. Berücksichtigt nur Gebäude aus LoD2, keine Bäume, kein Gelände.</li>'
    + '<li><b>Fahrpläne (Bus und Bahn):</b> Sollfahrplan: ' + esc(ORT.betreiber || '') + ', <a href="' + esc(ORT.lizenzUrl || '#') + '" target="_blank" rel="noopener">' + esc(ORT.lizenz || '') + '</a>, ' + (FP ? 'Stand ' + esc(FP.stand) + ', gültig ' + esc(fmtYmd(FP.feedFrom)) + ' bis ' + esc(fmtYmd(FP.feedTo)) : 'nicht geladen') + '. Auf die Haltestellen des Gebiets gefiltert (Daten geändert). Ohne Gewähr.</li>'
    + '<li><b>Veranstaltungen:</b> ' + (((window.AL_EVENTS_AUTO || {}).quellen || []).length ? esc(window.AL_EVENTS_AUTO.quellen.join(', ')) : 'von Hand gepflegt (events.js)') + ((window.AL_EVENTS_AUTO || {}).stand ? ' (gelesen am ' + esc(fmtIso(window.AL_EVENTS_AUTO.stand)) + ')' : '') + '. Übernommen werden nur Titel, Datum, Uhrzeit und Ort mit Link zur Originalseite.</li>'
    + '<li><b>Öffnungszeiten und Kontakt der Orte:</b> aus OpenStreetMap, ergänzt durch den Wortlaut der eigenen Webseite des Ortes, wo dort maschinell lesbar vorhanden (mit Lesedatum und Link in der Ortskarte). Ohne Angabe steht „nicht verifiziert“. Zeiten ändern sich, bitte beim Betrieb nachfragen.</li>'
    + '<li><b>Schriften:</b> Sora und JetBrains Mono, SIL Open Font License 1.1, lokal eingebunden.</li>'
    + '<li><b>Wetter (nur auf Wunsch):</b> Deutscher Wetterdienst (DWD, offene Daten nach GeoNutzV) über die freie Schnittstelle <a href="https://brightsky.dev" target="_blank" rel="noopener">Bright Sky</a>. Der Browser ruft die Daten erst nach Ihrer Zustimmung direkt dort ab. Dazu gehören die amtlichen Wetterwarnungen des DWD und die Wettervorhersage für die nächsten Tage.' + (ORT.webcam ? ' Die Webcam-Vorschau (' + esc(ORT.webcam.name) + (ORT.webcam.entfernung_km ? ', rund ' + esc(ORT.webcam.entfernung_km) + ' km entfernt' : '') + ') lädt der Browser nach Ihrer Zustimmung von <a href="' + esc(ORT.webcam.url) + '" target="_blank" rel="noopener">' + esc(String(ORT.webcam.url).replace(/^https?:\/\//, '').split('/')[0]) + '</a>, Quelle Deutscher Wetterdienst, <a href="https://www.dwd.de/DE/service/rechtliche_hinweise/rechtliche_hinweise_node.html" target="_blank" rel="noopener">CC BY 4.0</a>.' : '') + ' Die Wolkenebene auf der Karte ist eine Veranschaulichung: Sie folgt dem gemeldeten Bedeckungsgrad und der Windrichtung, zieht im Zeitraffer und zeigt keine echten Wolkenformen.</li>'
    + '<li><b>Luftqualität (nur auf Wunsch):</b> Modelldaten des Copernicus-Dienstes CAMS über <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noopener">Open-Meteo</a>, CC BY 4.0, keine Messung vor Ort. Abruf erst nach Ihrer Zustimmung direkt aus dem Browser.</li>'
    + (BRW_LIVE ? '<li><b>Bodenrichtwerte (nur auf Wunsch):</b> ' + esc(BRW_LIVE.kurz) + ', Dienst ' + esc(BRW_LIVE.host) + ', <a href="' + esc(BRW_LIVE.info) + '" target="_blank" rel="noopener">BORIS-Bayern</a>. Abfrage erst nach Ihrer Zustimmung direkt aus dem Browser für die angeklickte Stelle, die Karte speichert keine Werte. Keine amtliche Auskunft.</li>' : '')
    + (ORT.baustellen === 'mobilithek' ? '<li><b>Baustellen und Sperrungen:</b> Baustellenmeldungen in Bayern der Zentralstelle Verkehrsmanagement, über die <a href="https://mobilithek.info/" target="_blank" rel="noopener">Mobilithek</a>, Lizenz GeoNutzV. Vom Betreiber abgerufen und mit der Seite ausgeliefert, Ihr Browser verbindet sich dafür mit keinem fremden Dienst.</li>' : '')
    + (ORT.baustellen === 'bb' ? '<li><b>Baustellen und Sperrungen (nur auf Wunsch):</b> © Landesbetrieb Straßenwesen Brandenburg, <a href="https://www.govdata.de/dl-de/by-2-0" target="_blank" rel="noopener">dl-de/by-2.0</a>, über den Geodienst isk.geobasis-bb.de. Abruf erst nach Ihrer Zustimmung direkt aus dem Browser.</li>' : '')
    + (VBB_HOSTS.length ? '<li><b>Live-Abfahrten und Meldungen Bahn und Bus (nur auf Wunsch):</b> Echtzeitdaten (Abfahrten, Meldungen, Fahrzeugpositionen für die bewegten Fahrzeugmodelle; die Modelle sind Miniaturen nach Betreiber, die Wagenzahl ist angenommen) über die freien, inoffiziellen Schnittstellen ' + esc(VBB_HOSTS.map((h) => h.replace('https://', '')).join(' und ')) + ' (<a href="https://github.com/public-transport/transport.rest" target="_blank" rel="noopener">transport.rest</a>). Abruf erst nach Ihrer Zustimmung direkt aus dem Browser. Ohne Gewähr.</li>' : '')
    + (ORT.muell ? '<li><b>Müllabfuhr (nur auf Wunsch):</b> eingebettete Abfuhrabfrage: <a href="' + esc(ORT.muell.seite || ORT.muell.url) + '" target="_blank" rel="noopener">' + esc(ORT.muell.name) + '</a>. Die Termine stammen von dort und werden hier nicht gespeichert.' + (ORT.muell.hinweis ? ' ' + esc(ORT.muell.hinweis) : '') + '</li>' : '')
    + '<li><b>Aktualisierung:</b> Orte, Haltestellen und Fahrplan wöchentlich' + (NEWS.stand ? ' (letzter Lauf ' + esc(fmtIso(NEWS.stand)) + ')' : '') + ', Gebäude und Adressen vierteljährlich, Bodenrichtwerte jährlich.</li>'
    + (ORTSTEILE_SEITE ? '<li><b>Ortsinformationen (Einwohnerzahl, Ersterwähnung, Sehenswertes):</b> Ortsporträts auf der <a href="' + ORTSTEILE_SEITE + '" target="_blank" rel="noopener">Website: ' + esc(ORT_NAME) + '</a>' + (M.ortsteilInfo && M.ortsteilInfo.gelesen ? ' (gelesen am ' + esc(fmtIso(M.ortsteilInfo.gelesen)) + ')' : '') + '. Übernommen werden nur einzelne Angaben, keine Texte und keine Personen. Einwohnerzahlen sind Angaben aus den Texten ohne einheitlichen Stand, bei ' + OT.filter((o) => !ewText(o)).length + ' von ' + OT.length + ' Ortsteilen fehlt sie. Fläche, Adress- und Gebäudezahl stammen aus eigenen Daten (Grenze: OpenStreetMap, Adressen und Gebäude: ' + esc(GEO.kurz) + ').</li>' : '')
    + '<li><b>3D-Darstellung:</b> three.js (MIT-Lizenz), läuft lokal im Browser, es werden keine Daten an Dritte gesendet.</li></ul><p class="note">Keine Gewähr für Richtigkeit und Vollständigkeit.</p>';

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
    if (FZ.list.size && S.L.fahrzeuge) { fzTick(); S.dirty = true; } // Fahrzeuge bewegen sich: jedes Bild neu zeichnen
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
    el.title = 'Orte und Haltestellen ' + fmtIso(st.osm) + ' · Fahrplan gültig ' + fmtIso(st.fahrplan.von) + ' bis ' + fmtIso(st.fahrplan.bis) + ' · Termine ' + fmtIso(st.termine.stand) + ' · Gebäude und Adressen (' + GEO.kurz + ') abgerufen ' + fmtIso(st.lgb);
  })();
  (function sprungZumOrtsteil() { // Links der Startseite: karte.html#ortsteil=<Nummer>
    const m = /ortsteil=(\d+)/.exec(location.hash);
    if (m && OT[+m[1]]) setTimeout(() => goOrtsteil(+m[1]), 700);
  })();
  // ---- Wolken über der Karte: nach dem Bedeckungsgrad des DWD (cloud_cover) und der Windrichtung, nur mit eingeblendeten Wetterdaten.
  // Eine halbtransparente Ebene mit zufälligem, nahtlos kachelbarem Wolkenmuster; zieht im Zeitraffer mit dem Wind und blendet aus, wenn man nah herangeht.
  (function wolken() {
    if (!window.ALW || !THREE.CanvasTexture) return;
    window.ALW.ready(function (A) {
      const Wt = A && A.fresh && A.data;
      if (!Wt || Wt.wolken == null || Wt.wolken < 8) return;
      const cover = Math.min(0.82, Math.min(100, Wt.wolken) / 100), PW = W + 36000, PH = H + 36000;
      // Wolkenmuster aus Rauschen (fbm mit Domänenverzerrung), in der Grafikkarte aus Weltkoordinaten gerechnet: keine Kachelung, kein sich wiederholendes Muster
      const dayN = Math.floor(Date.now() / 864e5), mat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uOff: { value: new THREE.Vector2((dayN * 7919) % 90000, (dayN * 104729) % 90000) }, uCover: { value: cover }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(1, 1, 1) } },
        vertexShader: 'varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: 'precision highp float; uniform vec2 uOff; uniform float uCover, uOpacity; uniform vec3 uColor; varying vec2 vP;'
          + 'float h(vec2 p){ vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }'
          + 'float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); return mix(mix(h(i), h(i + vec2(1., 0.)), f.x), mix(h(i + vec2(0., 1.)), h(i + vec2(1., 1.)), f.x), f.y); }'
          + 'float fbm(vec2 p){ float v = 0., a = .5; mat2 r = mat2(.8, -.6, .6, .8); for(int i = 0; i < 6; i++){ v += a * n(p); p = r * p * 2.03 + 17.; a *= .5; } return v; }'
          + 'void main(){ vec2 p = (vP - uOff) / 8000.; vec2 q = vec2(fbm(p * .6 + 3.1), fbm(p * .6 - 5.4));'
          + ' float d = fbm(p + (q - .5) * 2.2) * .75 + fbm(p * 3.7 + q * 2.) * .25;'
          + ' float thr = .5 + (.5 - uCover) * .42; float a = smoothstep(thr, thr + .13, d); float s = smoothstep(thr, thr + .3, d);'
          + ' gl_FragColor = vec4(mix(uColor * .8, uColor, s), a * uOpacity); }'
      });
      const mesh = new THREE.Mesh(planeGeo(PW, PH), mat);
      mesh.position.set(CX, 1900, CZ); mesh.renderOrder = 5; mesh.frustumCulled = false;
      scene.add(mesh); CL.mesh = mesh; CL.ok = true;
      const row = $('#wolkenRow'); if (row) row.hidden = false;
      const dirDeg = Wt.windrichtung != null ? Wt.windrichtung : 270, ms = Math.max(2, (Wt.wind || 10) / 3.6), ZEITRAFFER = 15;
      const vE = -Math.sin(dirDeg * Math.PI / 180) * ms * ZEITRAFFER, vN = -Math.cos(dirDeg * Math.PI / 180) * ms * ZEITRAFFER; // Richtung, in die der Wind weht (m/s im Zeitraffer)
      const nightCol = new THREE.Color(0x35435c), dayCol = new THREE.Color(0xffffff);
      let t0 = performance.now();
      function tick() {
        const now = performance.now(), dt = (now - t0) / 1000; t0 = now;
        const fade = Math.max(0, Math.min(1, (camera.position.y - 2300) / 3200)), on = S.L.wolken && fade > 0.01;
        mesh.visible = S.L.wolken;
        if (!on) { if (mat.uniforms.uOpacity.value !== 0) { mat.uniforms.uOpacity.value = 0; S.dirty = true; } return; }
        mat.uniforms.uOff.value.x += vE * dt; mat.uniforms.uOff.value.y -= vN * dt; // z zeigt nach Süden, vN ist die Nordkomponente
        mat.uniforms.uOpacity.value = 0.46 * fade * (0.6 + 0.4 * cover);
        mat.uniforms.uColor.value.copy(nightCol).lerp(dayCol, Math.max(0, Math.min(1, (sunDir.y + 0.08) / 0.3)));
        S.dirty = true;
      }
      setInterval(tick, 250); tick();
      applyLayers();
    });
  })();
  // ---- Link zum Teilen: Kamera, Ebenen, Einfärbung, Sonnenstand (nur wenn verstellt) und gewählter Ort stehen im Adressteil (#k=…); nichts davon verlässt den Browser
  const LKEYS = ['photo', 'buildings', 'trees', 'places', 'stops', 'fahrzeuge', 'events', 'labels', 'borders', 'roads', 'shadows', 'brw', 'wolken', 'relief', 'hang', 'senken', 'notfall', 'sirenen', 'energie', 'flug', 'freizeit', 'alltag', 'lampen', 'touren'];
  function toast(t) { const el = $('#toast'); if (!el) return; el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { el.hidden = true; }, 2600); }
  function shareHash() {
    const r = (v, n) => +v.toFixed(n), n = nowB();
    const q = ['k=' + [r(view.tx, 0), r(view.tz, 0), r(view.theta, 3), r(view.phi, 3), r(view.dist, 0)].join(',')];
    q.push('l=' + LKEYS.filter((k) => S.L[k]).join('.'));
    if (S.colorMode !== 'nutzung') q.push('c=' + S.colorMode);
    if (S.sun.y !== n.y || S.sun.mo !== n.mo || S.sun.d !== n.d || Math.abs(S.sun.min - (n.h * 60 + n.mi)) > 30) q.push('s=' + [S.sun.y, S.sun.mo, S.sun.d, S.sun.min].join('-'));
    if (S.card && S.card.type === 'stop' && STOPS[S.card.i]) q.push('h=' + encodeURIComponent(STOPS[S.card.i].name || ''));
    else { const p = PLACES.find((x) => x.marker && x.marker.el.classList.contains('sel')); if (p && p.osm) q.push('o=' + encodeURIComponent(p.osm)); }
    return q.join('&');
  }
  function shareLink() { return location.origin + location.pathname + '#' + shareHash(); }
  $('#bShare').onclick = () => {
    const u = shareLink();
    try { history.replaceState(null, '', '#' + shareHash()); } catch (e) { /* egal */ }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(u).then(() => toast('Link kopiert'), () => { toast('Kopieren nicht möglich, Adresse oben im Browser nutzen'); });
    else toast('Adresse oben im Browser kopieren');
  };
  (function ansichtAusLink() {
    const h = location.hash.replace(/^#/, ''); if (!h || /(^|&)ortsteil=/.test(h)) return;
    const get = (k) => { const m = new RegExp('(?:^|&)' + k + '=([^&]*)').exec(h); return m ? decodeURIComponent(m[1]) : null; };
    const k = get('k'), l = get('l'), c = get('c'), s = get('s'), o = get('o'), hs = get('h');
    if (l !== null) {
      const on = new Set(l.split('.'));
      LKEYS.forEach((key) => { S.L[key] = on.has(key); const el = $('[data-layer=' + key + ']'); if (el) el.checked = S.L[key]; });
      applyLayers();
    }
    if (c && ['nutzung', 'hoehe', 'brw', 'dach', 'solar', 'einheitlich'].indexOf(c) >= 0) { const r = $('input[name=colormode][value=' + c + ']'); if (r) { r.checked = true; r.onchange(); } }
    if (s && /^\d{4}-\d{1,2}-\d{1,2}-\d{1,4}$/.test(s)) { const a = s.split('-').map(Number); setSun({ y: a[0], mo: a[1], d: a[2], min: Math.min(1439, a[3]) }); }
    if (o) { const i = PLACES.findIndex((p) => p.osm === o); if (i >= 0) showPlace(i, false); }
    else if (hs) { const i = STOPS.findIndex((p) => p.name === hs); if (i >= 0) showStop(i); }
    if (k && /^-?[\d.]+(,-?[\d.]+){4}$/.test(k)) {
      const a = k.split(',').map(Number); anim = null;
      Object.assign(view, { tx: a[0], tz: a[1], theta: a[2], phi: a[3], dist: a[4] }); applyView();
    }
  })();
  if (matchMedia('(max-width: 900px)').matches) $('#colorpanel').open = false; // auf kleinen Bildschirmen zugeklappt starten
  requestAnimationFrame(frame);
  setTimeout(hideLoading, 8000);
  window.AL_DEBUG = { FZ, fzAtLegs, RG, BRW, brwAt, showBrw, STOPS, FP, setSun, showStop, S, view, T, CELLS, scene, camera, renderer, applyView, flyTo, occluded, selectBuilding, goAddress, ROWS, STREETS, OT };
})();
