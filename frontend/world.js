// =====================================================================
//  DEVALLEY — Vale Natural Retrotech (motor procedural de micro-voxels)
//
//  Gera SÓ DADOS (sem Three.js): terreno em bacia côncava, vegetação, rochas,
//  flores e postes de acampamento. O game.js converte OUT em InstancedMesh.
//  O núcleo animado (fogueira / totem / holograma / estações) vive em core.js
//  e compartilha o layout (LAYOUT) exportado daqui.
//
//  Grid 80x80, voxel de terreno = 0.5, cobrindo -20..+20 em X e Z.
// =====================================================================

export const GRID = 80;
export const VS = 0.5;
export const HALF = GRID / 2;
export const WORLD_HALF = HALF * VS; // 20
export const MICRO = 0.25; // micro-voxels de árvores
export const FLAT_Y = 1.0; // clareira + gramado (planos)
export const WATER_Y = 0.0;

// Raios das zonas
export const R_A = 5.5; // clareira de terra batida
export const R_B = 9.0; // anel de gramado plano
export const R_C = 18.5; // encostas em terraços (além disso: falésia + mar)
const WALK_R = 17.7; // limite caminhável (borda do penhasco)

// Layout compartilhado com core.js
export const LAYOUT = {
  stationR: 4.2,
  stationAngles: [0, 60, 120, 180, 240, 300].map((d) => (d * Math.PI) / 180),
  tableDist: 0.7,
  fire: { x: 0, z: 0, ring: 0.9 },
  lampR: 6.8,
  lampAngles: [45, 135, 225, 315].map((d) => (d * Math.PI) / 180),
};

// ---------------------------------------------------------------------
//  RNG determinístico + ruído (pseudo-Perlin)
// ---------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261102);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hx = (s) => (typeof s === 'string' ? parseInt(s.slice(1), 16) : s);
const pick = (a) => a[Math.floor(rnd() * a.length)];

function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, z, seed = 0) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
/** noise(x, z) em [0,1] — suave, sem tiling visível. */
const noise = (x, z) => vnoise(x * 0.42 + 7, z * 0.42 + 3, 4) * 0.65 + vnoise(x * 1.1, z * 1.1, 9) * 0.35;

// ---------------------------------------------------------------------
//  Grid do terreno
// ---------------------------------------------------------------------
const NL = new Int8Array(GRID * GRID); // camadas de 0.5 por célula (0 = mar)
const ZONE = new Uint8Array(GRID * GRID); // 0 mar | 1 A | 2 B | 3 C
const BLOCK = new Uint8Array(GRID * GRID); // células ocupadas (colisão)

const idx = (i, j) => j * GRID + i;
const inGrid = (i, j) => i >= 0 && j >= 0 && i < GRID && j < GRID;
export const cellOf = (w) => Math.floor(w / VS + HALF);
const cellCenter = (i) => (i + 0.5 - HALF) * VS;

/**
 * surfaceY da célula (calculado no centro dela).
 * O ruído dos degraus só atua a partir de r > 9.4 (> raio + meia-diagonal da célula),
 * assim toda célula que toca r <= 9.0 fica cravada em 1.0.
 */
function cellSurface(x, z, r) {
  if (r <= R_B) return FLAT_Y; // zonas A e B
  if (r <= R_C) {
    const n = r > R_B + 0.4 ? Math.floor(noise(x, z) * 1.5) : 0;
    const step = Math.floor((r - R_B) / 2.2) + n;
    return FLAT_Y + clamp(step, 0, 5) * 0.5;
  }
  return WATER_Y; // ZONA D
}

for (let j = 0; j < GRID; j++) {
  for (let i = 0; i < GRID; i++) {
    const x = cellCenter(i), z = cellCenter(j), r = Math.hypot(x, z);
    const k = idx(i, j);
    if (r > R_C) { NL[k] = 0; ZONE[k] = 0; continue; }
    ZONE[k] = r <= R_A ? 1 : r <= R_B ? 2 : 3;
    NL[k] = Math.round(cellSurface(x, z, r) / VS);
  }
}

// ---------------------------------------------------------------------
//  Consultas públicas
// ---------------------------------------------------------------------
/** Altura (Y mundial) da superfície em (x, z). Para r <= 9.0 é exatamente 1.0. */
export function getTerrainHeight(x, z) {
  if (Math.hypot(x, z) <= R_B) return FLAT_Y;
  const i = cellOf(x), j = cellOf(z);
  if (!inGrid(i, j)) return WATER_Y;
  return NL[idx(i, j)] * VS;
}
/** Terra firme, dentro do limite do penhasco e sem obstáculo? */
export function isWalkable(x, z) {
  if (Math.hypot(x, z) > WALK_R) return false;
  const i = cellOf(x), j = cellOf(z);
  return inGrid(i, j) && NL[idx(i, j)] > 0 && !BLOCK[idx(i, j)];
}
function markCell(x, z) {
  const i = cellOf(x), j = cellOf(z);
  if (inGrid(i, j)) BLOCK[idx(i, j)] = 1;
}
/** Bloqueia um retângulo no referencial local de uma estação (frente = f). */
function blockLocal(sx, sz, fx, fz, lx0, lx1, lz0, lz1) {
  const rx = fz, rz = -fx; // eixo X local de Object3D.lookAt (Y × Z)
  for (let a = lx0; a <= lx1 + 1e-6; a += 0.1)
    for (let b = lz0; b <= lz1 + 1e-6; b += 0.1) markCell(sx + rx * a + fx * b, sz + rz * a + fz * b);
}

// ---------------------------------------------------------------------
//  Saída de voxels
// ---------------------------------------------------------------------
export const OUT = { solid: [], lamp: [] };
export const lamps = []; // posições das lanternas (PointLights reais no game.js)
export const PLACED = { trees: [], rocks: [], tufts: [] }; // para validação

const jitter = () => 0.95 + rnd() * 0.1; // +/- 5% de luminosidade por instância

function emit(mat, x, y, z, sx, sy, sz, hex, lum = 1, ry = 0) {
  OUT[mat].push({ x, y, z, sx, sy, sz, hex: hx(hex), lum, ry });
}

class VB {
  constructor() { this.map = new Map(); }
  set(x, y, z, hex, mat = 'solid') { this.map.set(x + ',' + y + ',' + z, [x, y, z, hx(hex), mat]); }
  has(x, y, z) { return this.map.has(x + ',' + y + ',' + z); }
  box(x0, y0, z0, x1, y1, z1, hex, mat = 'solid') {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) this.set(x, y, z, typeof hex === 'function' ? hex(x, y, z) : hex, mat);
  }
  disc(cx, cz, y, r, hex, mat = 'solid') {
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if (Math.hypot(x - cx, z - cz) <= r) this.set(x, y, z, typeof hex === 'function' ? hex(x, z) : hex, mat);
  }
  arr() { return Array.from(this.map.values()); }
}

/**
 * Ergue uma estrutura a partir de voxels locais [x,y,z,hex,mat].
 * (originX, originY, originZ) = canto mínimo no mundo. Voxels totalmente
 * encobertos são descartados (poupa instâncias invisíveis).
 */
export function buildVoxelStructure(voxelArray, originX, originY, originZ, voxelSize, cull = true) {
  const keys = new Set();
  if (cull) for (const v of voxelArray) keys.add(v[0] + ',' + v[1] + ',' + v[2]);
  let n = 0;
  for (const [x, y, z, hex, mat] of voxelArray) {
    if (
      cull &&
      keys.has(x + 1 + ',' + y + ',' + z) && keys.has(x - 1 + ',' + y + ',' + z) &&
      keys.has(x + ',' + (y + 1) + ',' + z) && keys.has(x + ',' + (y - 1) + ',' + z) &&
      keys.has(x + ',' + y + ',' + (z + 1)) && keys.has(x + ',' + y + ',' + (z - 1))
    ) continue;
    emit(
      mat,
      originX + (x + 0.5) * voxelSize, originY + (y + 0.5) * voxelSize, originZ + (z + 0.5) * voxelSize,
      voxelSize, voxelSize, voxelSize, hex, mat === 'solid' ? jitter() : 1
    );
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------
//  Paletas
// ---------------------------------------------------------------------
const PAL = {
  dirt: ['#7a5e47', '#6e533e', '#85684f'], // ZONA A
  lawn: ['#566b32', '#697d3d', '#4a5d29'], // ZONA B
  autumn: ['#697d3d', '#8a7943', '#7c8c46'], // ZONA C (topo)
  rock: ['#cbb597', '#b0997d'], // ZONA C (paredão) e falésia
  cypress: ['#2d401e', '#34491f'],
  pine: ['#3b5228', '#455e2e'],
  trunk: '#4b3322',
  stone: ['#7d8279', '#6d7269', '#8a8e84'],
  moss: ['#566b32', '#4a5d29'],
  flowers: ['#d94b36', '#e89923', '#f2d049'],
};

// ---------------------------------------------------------------------
//  1) Terreno micro-voxel
// ---------------------------------------------------------------------
function lawnColor(x, z) {
  const n = Math.sin(x * 1.5) * Math.cos(z * 1.5); // pseudo-noise pedido: -1..1
  return n < -0.35 ? PAL.lawn[2] : n < 0.3 ? PAL.lawn[0] : PAL.lawn[1];
}
function autumnColor(x, z) {
  const n = noise(x * 1.6 + 20, z * 1.6 - 5) + (rnd() - 0.5) * 0.25;
  return n < 0.4 ? PAL.autumn[0] : n < 0.62 ? PAL.autumn[2] : PAL.autumn[1];
}
function rockColor(layer) {
  // estratificação: camadas baixas mais escuras, altas mais claras, com salpicos
  let c = layer <= 3 ? 1 : 0;
  if (rnd() < 0.28) c = 1 - c;
  return PAL.rock[c];
}

function buildTerrain() {
  const CAP = 0.14; // "lábio" de grama sobre o paredão de rocha
  const layersAt = (i, j) => (inGrid(i, j) ? NL[idx(i, j)] : 0);
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = idx(i, j), n = NL[k];
      if (!n) continue;
      const x = cellCenter(i), z = cellCenter(j), r = Math.hypot(x, z), zone = ZONE[k];
      const nbMin = Math.min(layersAt(i + 1, j), layersAt(i - 1, j), layersAt(i, j + 1), layersAt(i, j - 1));
      for (let L = 1; L <= n; L++) {
        const top = L === n, exposed = nbMin < L;
        if (!top && !exposed) continue; // miolo invisível
        const cy = (L - 0.5) * VS;

        if (!top) { emit('solid', x, cy, z, VS, VS, VS, rockColor(L), jitter()); continue; }

        if (zone === 1) { emit('solid', x, cy, z, VS, VS, VS, pick(PAL.dirt), jitter()); continue; }
        if (zone === 2) {
          // transição orgânica terra -> grama junto à clareira
          const dirtP = 1 - (r - R_A) / 1.1;
          const hex = r - R_A < 1.1 && hash2(i, j, 31) < dirtP * 0.9 ? pick(PAL.dirt) : lawnColor(x, z);
          emit('solid', x, cy, z, VS, VS, VS, hex, jitter());
          continue;
        }
        // zona C
        if (exposed) {
          emit('solid', x, (L - 1) * VS + (VS - CAP) / 2, z, VS, VS - CAP, VS, rockColor(L), jitter());
          emit('solid', x, L * VS - CAP / 2, z, VS, CAP, VS, autumnColor(x, z), jitter());
        } else emit('solid', x, cy, z, VS, VS, VS, autumnColor(x, z), jitter());
      }
    }
  }
}

// ---------------------------------------------------------------------
//  2) Vegetação, rochas, flores
// ---------------------------------------------------------------------
function cypressVB() {
  const b = new VB();
  const Hh = 14 + Math.floor(rnd() * 6);
  const br = 1.9 + rnd() * 0.8;
  for (let k = 0; k < Hh; k++) {
    if (k < 2) { b.set(0, k, 0, PAL.trunk); continue; }
    const u = (k - 2) / (Hh - 2);
    const rad = Math.max(0.5, br * Math.pow(1 - u, 0.8) * (u < 0.12 ? 0.75 : 1)) + (rnd() - 0.5) * 0.4;
    b.disc(0, 0, k, rad, () => pick(PAL.cypress));
  }
  return b;
}
function pineVB() {
  const b = new VB();
  const tiers = 4 + (rnd() < 0.5 ? 1 : 0);
  b.box(0, 0, 0, 0, 5, 0, PAL.trunk);
  for (let t = 0; t < tiers; t++) {
    const y0 = 3 + t * 3, rMax = 3.1 - t * 0.5 + rnd() * 0.3;
    for (let dy = 0; dy < 3; dy++) b.disc(0, 0, y0 + dy, Math.max(0.6, rMax - dy * 0.85), () => pick(PAL.pine));
  }
  const top = 3 + tiers * 3;
  b.set(0, top, 0, PAL.pine[0]); b.set(0, top + 1, 0, PAL.pine[1]);
  return b;
}
function rockVB() {
  const b = new VB();
  const rx = 2 + rnd() * 1.8, ry = 1.4 + rnd() * 1.1, rz = 2 + rnd() * 1.8;
  for (let y = 0; y < 4; y++) for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) {
    const d = (x / rx) ** 2 + ((y + 0.5) / ry) ** 2 + (z / rz) ** 2;
    if (d <= 1 + (rnd() - 0.5) * 0.3) b.set(x, y, z, pick(PAL.stone));
  }
  for (const v of b.arr()) if (!b.has(v[0], v[1] + 1, v[2]) && rnd() < 0.7) b.set(v[0], v[1], v[2], pick(PAL.moss));
  return b;
}
function tuftVB() {
  const b = new VB();
  const base = pick(PAL.flowers);
  for (let z = 0; z < 2; z++) for (let x = 0; x < 2; x++) {
    b.set(x, 0, z, '#3f5424');
    b.set(x, 1, z, rnd() < 0.75 ? (rnd() < 0.6 ? base : pick(PAL.flowers)) : '#566b32');
    if (rnd() < 0.35) b.set(x, 2, z, base);
  }
  return b;
}

/** Ponto aleatório (área uniforme) no anel [rMin, rMax], em célula livre. */
function ringSpot(rMin, rMax) {
  for (let n = 0; n < 60; n++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd() * (rMax * rMax - rMin * rMin) + rMin * rMin);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const i = cellOf(x), j = cellOf(z);
    if (!inGrid(i, j) || !NL[idx(i, j)] || BLOCK[idx(i, j)]) continue;
    return { x, z, r };
  }
  return null;
}

function buildVegetation() {
  // ---- Árvores: 20 ciprestes + 16 pinheiros, estritamente em 9.5 < r < 17.5
  const trees = [];
  const wanted = ['c', 'p'].flatMap((t) => Array(t === 'c' ? 20 : 16).fill(t));
  for (let i = wanted.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [wanted[i], wanted[j]] = [wanted[j], wanted[i]]; }
  for (const kind of wanted) {
    for (let t = 0; t < 400; t++) {
      const s = ringSpot(9.8, 17.2);
      if (!s || trees.some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 1.7)) continue;
      const g = getTerrainHeight(s.x, s.z);
      buildVoxelStructure((kind === 'c' ? cypressVB() : pineVB()).arr(), s.x - MICRO / 2, g - 0.05, s.z - MICRO / 2, MICRO);
      markCell(s.x, s.z);
      trees.push(s);
      PLACED.trees.push({ x: s.x, z: s.z, r: s.r, kind });
      break;
    }
  }

  // ---- Pedras musgosas (r >= 9.2: nada dentro de r < 8.5)
  const rocks = [];
  for (let n = 0; n < 26; n++) {
    for (let t = 0; t < 200; t++) {
      const s = ringSpot(9.2, 17.2);
      if (!s || [...trees, ...rocks].some((o) => Math.hypot(o.x - s.x, o.z - s.z) < 1.3)) continue;
      const g = getTerrainHeight(s.x, s.z);
      buildVoxelStructure(rockVB().arr(), s.x - 0.5, g - 0.04, s.z - 0.5, 0.2);
      markCell(s.x, s.z);
      rocks.push(s);
      PLACED.rocks.push({ x: s.x, z: s.z, r: s.r });
      break;
    }
  }

  // ---- Tufos de flores delicadas (voxel 0.15), só nas bordas da grama (r >= 8.8)
  let tufts = 0;
  for (let n = 0; n < 3000 && tufts < 80; n++) {
    const s = ringSpot(8.8, 15.5);
    if (!s) continue;
    const g = getTerrainHeight(s.x, s.z);
    buildVoxelStructure(tuftVB().arr(), s.x, g - 0.02, s.z, 0.15, false);
    PLACED.tufts.push({ x: s.x, z: s.z, r: s.r });
    tufts++;
  }
}

// ---------------------------------------------------------------------
//  3) Postes de acampamento (4 em r = 6.8): madeira rústica + lanterna emissiva
// ---------------------------------------------------------------------
function buildCampLamps() {
  const POST_H = 3.2, POST_W = 0.12;
  for (const a of LAYOUT.lampAngles) {
    const c = Math.cos(a), s = Math.sin(a);
    const px = c * LAYOUT.lampR, pz = s * LAYOUT.lampR;
    const g = FLAT_Y;
    emit('solid', px, g + POST_H / 2, pz, POST_W, POST_H, POST_W, '#5a3a24', jitter());
    emit('solid', px, g + 0.12, pz, 0.26, 0.24, 0.26, '#4a4e54', jitter()); // base de pedra
    // braço curto apontando para a clareira
    const armLen = 0.55, ay = g + POST_H - 0.12;
    const ax = px - c * armLen / 2, az = pz - s * armLen / 2;
    const ry = Math.atan2(-s, c) * -1; // eixo X do box alinhado com (-c, -s)
    emit('solid', ax, ay, az, armLen, 0.08, 0.08, '#5a3a24', jitter(), -Math.atan2(-s, -c));
    emit('solid', px - c * armLen * 0.55, g + POST_H - 0.3, pz - s * armLen * 0.55, 0.05, 0.3, 0.05, '#1c1f24', 1); // corrente
    const lx = px - c * armLen, lz = pz - s * armLen, ly = g + POST_H - 0.62;
    emit('solid', lx, ly - 0.2, lz, 0.2, 0.05, 0.2, '#1c1f24', 1); // base da lanterna
    emit('solid', lx, ly + 0.2, lz, 0.26, 0.06, 0.26, '#1c1f24', 1); // chapéu
    emit('lamp', lx, ly, lz, 0.2, 0.34, 0.2, 0xffffff, 1);
    lamps.push({ x: lx, y: ly, z: lz });
    markCell(px, pz);
  }
}

// ---------------------------------------------------------------------
//  4) Colisão do núcleo (fogueira, totem, 6 estações)
// ---------------------------------------------------------------------
function blockCore() {
  const { fire } = LAYOUT;
  for (let x = -1.3; x <= 1.3; x += 0.1)
    for (let z = -1.3; z <= 1.3; z += 0.1)
      if (Math.hypot(x, z) <= fire.ring + 0.15) markCell(fire.x + x, fire.z + z);
  for (const th of LAYOUT.stationAngles) {
    const sx = Math.cos(th) * LAYOUT.stationR, sz = Math.sin(th) * LAYOUT.stationR;
    const fx = -Math.cos(th), fz = -Math.sin(th);
    blockLocal(sx, sz, fx, fz, -0.65, 0.65, -0.25, 0.25); // banco de tronco
    blockLocal(sx, sz, fx, fz, -0.55, 0.55, LAYOUT.tableDist - 0.275, LAYOUT.tableDist + 0.275); // bancada
  }
}

buildTerrain();
blockCore();
buildCampLamps();
buildVegetation();

export const worldStats = (() => {
  const counts = {};
  let total = 0;
  for (const k of Object.keys(OUT)) { counts[k] = OUT[k].length; total += OUT[k].length; }
  return { total, counts, trees: PLACED.trees.length, rocks: PLACED.rocks.length, tufts: PLACED.tufts.length, lamps: lamps.length };
})();

/** Mapa ASCII de depuração: A/B/C = zonas, X = bloqueado, ' ' = mar. */
export function asciiMap() {
  let s = '';
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = idx(i, j);
      s += BLOCK[k] ? 'X' : ' ABC'[ZONE[k]];
    }
    s += '\n';
  }
  return s;
}
