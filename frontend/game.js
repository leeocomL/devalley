import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { OUT, lamps, worldStats, getTerrainHeight, isWalkable } from './world.js';
import { createMascotMesh, disposeObject } from './mascots.js';

// Altura do chão (Y mundial) em (x, z) — usada por jogadores/mascotes e exposta para outros módulos.
export { getTerrainHeight };

// =====================================================================
//  DOM / ESTADO
// =====================================================================
const $ = (id) => document.getElementById(id);
const container = $('canvas-container');
const terminalEl = $('terminal');
const logEl = $('term-log');
const inputEl = $('term-input');
const statusDot = $('status-dot-ok');
const statusDevs = $('status-devs');
const statusPos = $('status-pos');

const myPlayerId = 'dev_' + Math.random().toString(36).substring(2, 7);
const SPECIES = ['penguin', 'duck', 'python', 'octocat'];
const SPECIES_ALIAS = { tux: 'penguin', penguin: 'penguin', duck: 'duck', python: 'python', octocat: 'octocat' };
const HEADSET_COLORS = ['#89b4fa', '#a6e3a1', '#f9e2af', '#f38ba8', '#cba6f7'];
const MASCOT_SCALE = 0.9;

let mySpecies = localStorage.getItem('devalley_species');
if (!SPECIES.includes(mySpecies)) mySpecies = null;
let myColor = localStorage.getItem('devalley_color') || null;
let myNick = localStorage.getItem('devalley_nick') || null;
let socket = null;

const players = new Map();
const keys = { w: false, a: false, s: false, d: false, ArrowUp: false, ArrowLeft: false, ArrowDown: false, ArrowRight: false };

// =====================================================================
//  RENDERER + CENA (Golden Hour)
// =====================================================================
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2b3640, 0.008);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 700);
camera.position.set(20, 15, 24);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.target.set(0, 1.5, 0);
controls.minDistance = 6;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI / 2.1;

// ---- Iluminação
const sun = new THREE.DirectionalLight(0xff9d47, 3.2);
sun.position.set(-45, 18, 25);
sun.castShadow = true;
sun.shadow.camera.left = -35;
sun.shadow.camera.right = 35;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xffd194, 0x263847, 0.65);
scene.add(hemi);

// ---- Post-processing: RenderPass + UnrealBloom (+ OutputPass p/ tone mapping)
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.32, 0.55, 0.82);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// =====================================================================
//  CÉU + AMBIENTE (reflexo do mar) + PRESETS DE HORÁRIO
// =====================================================================
const SKY = {
  sunset: { stops: [[0, '#2f3560'], [0.3, '#8a5a86'], [0.45, '#e58a7a'], [0.5, '#ffb06e'], [0.52, '#3a4350'], [1, '#2b3640']], stars: false },
  noon: { stops: [[0, '#3f78c0'], [0.3, '#7db4e6'], [0.48, '#cfe8f6'], [0.5, '#d6ecf7'], [0.52, '#7aa0b0'], [1, '#6f98a8']], stars: false },
  night: { stops: [[0, '#03050d'], [0.3, '#0a1030'], [0.48, '#1a2444'], [0.5, '#1e2a4c'], [0.52, '#0a0f18'], [1, '#080c14']], stars: true },
};

function drawSkyTexture(name) {
  const def = SKY[name];
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  def.stops.forEach(([p, col]) => grad.addColorStop(p, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 512);
  if (def.stars) {
    for (let i = 0; i < 380; i++) {
      g.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.65})`;
      const s = Math.random() < 0.9 ? 1 : 2;
      g.fillRect(Math.random() * 1024, Math.random() * 230, s, s);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const domeGeo = new THREE.SphereGeometry(300, 40, 24);
const domeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, fog: false, depthWrite: false });
const dome = new THREE.Mesh(domeGeo, domeMat);
dome.renderOrder = -10;
scene.add(dome);

const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;

function setSky(name) {
  domeMat.map?.dispose();
  domeMat.map = drawSkyTexture(name);
  domeMat.needsUpdate = true;
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(domeGeo, domeMat));
  const next = pmrem.fromScene(envScene, 0, 1, 1000);
  waterMat.envMap = next.texture;
  waterMat.needsUpdate = true;
  envRT?.dispose();
  envRT = next;
}

const TIME_PRESETS = {
  sunset: { sunColor: 0xff9d47, sunI: 3.2, sunPos: [-45, 18, 25], hemiSky: 0xffd194, hemiGround: 0x263847, hemiI: 0.65, fog: 0x2b3640, fogD: 0.008, lamp: 1.0, win: 2.0, exposure: 1.15 },
  noon: { sunColor: 0xfff1d8, sunI: 3.8, sunPos: [16, 52, 12], hemiSky: 0xbfdfff, hemiGround: 0x6b7a58, hemiI: 1.0, fog: 0x7aa0b0, fogD: 0.004, lamp: 0.08, win: 0.35, exposure: 1.0 },
  night: { sunColor: 0x7f9bd6, sunI: 0.7, sunPos: [24, 34, -22], hemiSky: 0x24335e, hemiGround: 0x080c14, hemiI: 0.35, fog: 0x080c14, fogD: 0.01, lamp: 1.9, win: 3.2, exposure: 1.25 },
};
function loadPreset(p) {
  return {
    sunColor: new THREE.Color(p.sunColor), sunI: p.sunI, sunPos: new THREE.Vector3(...p.sunPos),
    hemiSky: new THREE.Color(p.hemiSky), hemiGround: new THREE.Color(p.hemiGround), hemiI: p.hemiI,
    fog: new THREE.Color(p.fog), fogD: p.fogD, lamp: p.lamp, win: p.win, exposure: p.exposure,
  };
}
const cur = loadPreset(TIME_PRESETS.sunset);
const tgt = loadPreset(TIME_PRESETS.sunset);
let timeName = 'sunset';

function setTime(name) {
  if (!TIME_PRESETS[name]) return false;
  Object.assign(tgt, loadPreset(TIME_PRESETS[name]));
  timeName = name;
  setSky(name);
  return true;
}

// =====================================================================
//  MAR (PlaneGeometry 200x200, PBR, ondulação animada)
// =====================================================================
function makeWaveTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const TAU = Math.PI * 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let h = 0.5
        + 0.22 * Math.sin(TAU * (3 * u + 0.6 * Math.sin(TAU * 2 * v)))
        + 0.18 * Math.sin(TAU * (5 * v + 0.5 * Math.sin(TAU * 3 * u)))
        + 0.1 * Math.sin(TAU * (9 * u + 7 * v));
      h = Math.max(0, Math.min(1, h));
      const o = (y * S + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = h * 255;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(36, 36);
  return t;
}
const waveTex = makeWaveTexture();
const waterMat = new THREE.MeshStandardMaterial({
  color: 0x1e3842,
  roughness: 0.15,
  metalness: 0.7,
  bumpMap: waveTex,
  bumpScale: 0.6,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), waterMat);
water.rotation.x = -Math.PI / 2;
water.position.y = 0.0;
water.receiveShadow = true;
scene.add(water);

// =====================================================================
//  VOXELS -> THREE.InstancedMesh (1 draw call por material)
// =====================================================================
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const glow = (color, emissive, intensity, extra = {}) =>
  new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: intensity, roughness: 0.45, ...extra });
const MATS = {
  solid: new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0 }),
  window: glow(0xffaa33, 0xff8811, 2.0),
  scr_cyan: glow(0x00f5d4, 0x00f5d4, 1.5),
  scr_green: glow(0xa6e3a1, 0xa6e3a1, 1.5),
  lamp: glow(0xffd9a0, 0xff9933, 2.4),
  led_green: glow(0x00ff66, 0x00ff66, 2.0),
  led_red: glow(0xff8800, 0xff8800, 2.0),
};

const voxelGroup = new THREE.Group();
scene.add(voxelGroup);
(function buildInstancedWorld() {
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (const [key, list] of Object.entries(OUT)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(boxGeo, MATS[key], list.length);
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      dummy.position.set(v.x, v.y, v.z);
      dummy.rotation.set(0, v.ry || 0, 0);
      dummy.scale.set(v.sx, v.sy, v.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (key === 'solid') {
        color.setHex(v.hex).multiplyScalar(v.lum); // variação orgânica de +/-5% por instância
        mesh.setColorAt(i, color);
      }
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'voxels_' + key;
    voxelGroup.add(mesh);
  }
})();

// Postes de acampamento (r = 6.8): PointLights reais
const lampLights = lamps.map((l) => {
  const light = new THREE.PointLight(0xff9933, 2.5, 10);
  light.position.set(l.x, l.y, l.z);
  scene.add(light);
  return light;
});

// =====================================================================
//  NÚCLEO CENTRAL ("DATA FIREPIT" + HOLOGRAMA + SPRITE) & 6 ESTAÇÕES
// =====================================================================
const FONT = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const DEFAULT_PROMPT_TEXT = '[ 📎 Arraste arquivos ou Ctrl+V aqui ]';
const DEFAULT_PROMPT_COLOR = '#a6e3a1';

const fireCubes = [];
const fireDataParticles = [];
let fireLight = null;
let fireBoostUntil = 0; // timestamp (performance.now()) até quando o pico térmico de 8.0 fica ativo
let promptSprite = null;
let promptResetTimer = null;
let holoGroup = null;
let holoRingX = null;
let holoRingY = null;
const STATIONS = []; // { index, x, z, ry, particleGroup, particles }
let fileHoloGroup = null;
let fileHoloLight = null;
let currentTotemFile = null; // { file_id, filename, fileType, owner, nick }
const clientFileCache = new Map(); // file_id -> { file_id, filename, fileType, base64, owner, nick }

/**
 * Gera um THREE.Sprite com fundo translúcido escuro (rgba(17, 17, 27, 0.8)),
 * cantos retos e texto nítido em fonte monospace.
 */
function createFloatingText(text, color = DEFAULT_PROMPT_COLOR) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ transparent: true, depthWrite: false })
  );
  updateFloatingText(sprite, text, color);
  return sprite;
}

function updateFloatingText(sprite, text, color = DEFAULT_PROMPT_COLOR) {
  if (!sprite) return;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const fontSpec = `bold 26px ${FONT}`;
  g.font = fontSpec;
  const w = Math.ceil(g.measureText(text).width) + 32;
  const h = 46;
  c.width = w;
  c.height = h;
  g.font = fontSpec;
  g.fillStyle = 'rgba(17, 17, 27, 0.8)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);

  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;

  sprite.material.map?.dispose();
  sprite.material.map = tex;
  sprite.material.needsUpdate = true;
  sprite.scale.set(w * 0.0048, h * 0.0048, 1);
}

function triggerThermalUploadBurst() {
  fireBoostUntil = performance.now() + 500;
  if (fireLight) fireLight.intensity = 8.0;
}

function setPromptStatus(text, color, revertAfterMs = 0) {
  if (promptResetTimer) {
    clearTimeout(promptResetTimer);
    promptResetTimer = null;
  }
  updateFloatingText(promptSprite, text, color);
  if (revertAfterMs > 0) {
    promptResetTimer = setTimeout(() => {
      updateFloatingText(promptSprite, DEFAULT_PROMPT_TEXT, DEFAULT_PROMPT_COLOR);
      promptResetTimer = null;
    }, revertAfterMs);
  }
}

(function buildRetrotechCoreAndStations() {
  const stdMat = (hex, rough = 0.8, metal = 0.05) =>
    new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });

  const coreGroup = new THREE.Group();
  coreGroup.position.set(0, 1.0, 0);
  scene.add(coreGroup);

  // ---- 1. "Data Firepit": Anel do Servidor em (X=0, Z=0, Y=1.0), raio = 0.9
  const heatsinkMat = new THREE.MeshStandardMaterial({
    color: 0x2b303b,
    metalness: 0.8,
    roughness: 0.4,
  });
  const finDarkMat = new THREE.MeshStandardMaterial({
    color: 0x1e222a,
    metalness: 0.85,
    roughness: 0.35,
  });
  const sinkGeo = new THREE.BoxGeometry(0.38, 0.28, 0.3);
  const finSliceGeo = new THREE.BoxGeometry(0.42, 0.04, 0.34);
  const sinkLedGeo = new THREE.BoxGeometry(0.06, 0.035, 0.02);

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const blockGrp = new THREE.Group();
    blockGrp.position.set(Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9);
    blockGrp.rotation.y = -a + Math.PI / 2;

    const mainBlock = new THREE.Mesh(sinkGeo, heatsinkMat);
    mainBlock.position.y = 0.14;
    mainBlock.castShadow = true;
    mainBlock.receiveShadow = true;
    blockGrp.add(mainBlock);

    // Aletas de dissipador metálico
    for (const fy of [0.08, 0.16, 0.24]) {
      const fin = new THREE.Mesh(finSliceGeo, finDarkMat);
      fin.position.y = fy;
      fin.castShadow = true;
      blockGrp.add(fin);
    }

    // Pequeno LED de status voltado para fora no anel de servidor
    const led = new THREE.Mesh(sinkLedGeo, i % 2 === 0 ? MATS.led_green : MATS.led_red);
    led.position.set(0, 0.2, 0.17);
    blockGrp.add(led);

    coreGroup.add(blockGrp);
  }

  // Base escura da fornalha de dados no centro (0, 0, 0)
  const emberBed = new THREE.Mesh(
    new THREE.CylinderGeometry(0.76, 0.8, 0.06, 16),
    stdMat(0x181b22, 0.9, 0.3)
  );
  emberBed.position.set(0, 0.03, 0);
  emberBed.receiveShadow = true;
  coreGroup.add(emberBed);

  // 4 toras / barras condutoras cruzadas no centro (#4d311e)
  const logMat = stdMat(0x4d311e, 0.85);
  const logGeo = new THREE.BoxGeometry(0.95, 0.16, 0.18);
  for (let i = 0; i < 4; i++) {
    const lg = new THREE.Mesh(logGeo, logMat);
    const a = (i * Math.PI) / 4 + 0.2;
    lg.position.set(Math.cos(a) * 0.08, 0.11 + (i % 2) * 0.07, Math.sin(a) * 0.08);
    lg.rotation.y = a;
    lg.rotation.z = (i % 2 ? 1 : -1) * 0.12;
    lg.castShadow = true;
    lg.receiveShadow = true;
    coreGroup.add(lg);
  }

  // 6 cubos de fogo (#ff6600, #ffaa00, #ffee55 com emissiveIntensity: 2.5)
  const fireColors = [0xff6600, 0xffaa00, 0xffee55, 0xff6600, 0xffaa00, 0xffee55];
  const fireOffsets = [
    [0.0, 0.28, 0.0, 0.34],
    [-0.16, 0.24, 0.12, 0.26],
    [0.16, 0.25, 0.1, 0.25],
    [-0.12, 0.26, -0.14, 0.24],
    [0.14, 0.23, -0.12, 0.27],
    [0.0, 0.48, 0.02, 0.22],
  ];
  for (let i = 0; i < 6; i++) {
    const [ox, oy, oz, sz] = fireOffsets[i];
    const fcMat = glow(fireColors[i], fireColors[i], 2.5);
    const fc = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz), fcMat);
    fc.position.set(ox, oy, oz);
    fc.rotation.y = i * 0.7;
    fc.userData = { baseY: oy, phase: i * 1.05 };
    coreGroup.add(fc);
    fireCubes.push(fc);
  }

  // Partículas de código ("dados" ciano #00f5d4 e verde #a6e3a1 evaporando do fogo até Y=2.5 no mundo)
  const dataGeo = new THREE.BoxGeometry(0.055, 0.055, 0.055);
  for (let i = 0; i < 18; i++) {
    const dp = new THREE.Mesh(dataGeo, i % 2 === 0 ? MATS.scr_cyan : MATS.scr_green);
    const angle = (i / 18) * Math.PI * 2;
    const radius = 0.08 + (i % 4) * 0.09;
    dp.userData = {
      phase: i / 18,
      speed: 0.42 + (i % 5) * 0.08,
      angle,
      radius,
    };
    coreGroup.add(dp);
    fireDataParticles.push(dp);
  }

  // PointLight(0xff7711, 4.0, 14, 1.5) centralizada sobre a fogueira em (0, 2.2, 0)
  fireLight = new THREE.PointLight(0xff7711, 4.0, 14, 1.5);
  fireLight.position.set(0, 2.2, 0);
  scene.add(fireLight);

  // ---- 2. Sinalização Intuitiva: Sprite Text 3D Flutuante em (0, 2.3, 0)
  promptSprite = createFloatingText(DEFAULT_PROMPT_TEXT, DEFAULT_PROMPT_COLOR);
  promptSprite.position.set(0, 2.3, 0);
  scene.add(promptSprite);

  // ---- 3. Holograma Wireframe do Vale Flutuando em (0, 3.5, 0) (y = 2.5 no coreGroup)
  holoGroup = new THREE.Group();
  holoGroup.position.set(0, 2.5, 0);
  coreGroup.add(holoGroup);

  const holoMat = new THREE.MeshBasicMaterial({
    color: 0x00f5d4,
    wireframe: true,
    transparent: true,
    opacity: 0.75,
  });
  const holoCore = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), holoMat);
  holoGroup.add(holoCore);

  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x00f5d4,
    transparent: true,
    opacity: 0.65,
  });
  const ringGeo = new THREE.TorusGeometry(0.7, 0.015, 8, 32);
  holoRingX = new THREE.Mesh(ringGeo, ringMat);
  holoRingY = new THREE.Mesh(ringGeo, ringMat);
  holoRingY.rotation.x = Math.PI / 2;
  holoGroup.add(holoRingX, holoRingY);

  const holoLight = new THREE.PointLight(0x00f5d4, 2.0, 6);
  holoLight.position.set(0, 0, 0);
  holoGroup.add(holoLight);

  // ---- 4. Estações de Trabalho em Roda (6 Bancos Dev em R = 4.2) + Cabos até a borda do anel (R = 1.0)
  const barkMat = stdMat(0x5c3d28, 0.88);
  const topWoodMat = stdMat(0xa68059, 0.78);
  const deskWoodMat = stdMat(0x785135, 0.82);
  const laptopBodyMat = stdMat(0x2b303c, 0.4, 0.5);
  const mugColors = [0xd94b36, 0xe89923, 0xf2d049, 0x89b4fa, 0xa6e3a1, 0xcba6f7];
  const cableMat = stdMat(0x161920, 0.55, 0.4);

  for (let i = 0; i < 6; i++) {
    const theta = (i * 60 * Math.PI) / 180;
    const sx = Math.cos(theta) * 4.2;
    const sz = Math.sin(theta) * 4.2;

    const stationGroup = new THREE.Group();
    stationGroup.position.set(sx, 1.0, sz);
    stationGroup.lookAt(0, 1.0, 0); // +Z local aponta diretamente para o centro (0, 1.0, 0)
    scene.add(stationGroup);

    // 1) Banco de Tronco Rústico (BoxGeometry(1.3, 0.45, 0.5))
    const logBench = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 0.5), barkMat);
    logBench.position.set(0, 0.225, 0);
    logBench.castShadow = true;
    logBench.receiveShadow = true;
    stationGroup.add(logBench);

    const logTop = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.04, 0.44), topWoodMat);
    logTop.position.set(0, 0.46, 0);
    logTop.castShadow = true;
    logTop.receiveShadow = true;
    stationGroup.add(logTop);

    // 2) Bancada/Mesa de Apoio (0.7 unidades à frente do banco, em direção ao centro -> z = +0.7)
    const tableZ = 0.7;
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.55), deskWoodMat);
    tableTop.position.set(0, 0.74, tableZ);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    stationGroup.add(tableTop);

    const stakeGeo = new THREE.BoxGeometry(0.1, 0.72, 0.1);
    for (const side of [-0.42, 0.42]) {
      const stake = new THREE.Mesh(stakeGeo, barkMat);
      stake.position.set(side, 0.36, tableZ);
      stake.castShadow = true;
      stake.receiveShadow = true;
      stationGroup.add(stake);
    }

    // 3) Setup Dev em cima da bancada: notebook aberto + caneca + case de hardware
    const lapBase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.28), laptopBodyMat);
    lapBase.position.set(0, 0.79, tableZ - 0.02);
    lapBase.castShadow = true;
    stationGroup.add(lapBase);

    const lidPivot = new THREE.Group();
    lidPivot.position.set(0, 0.8, tableZ + 0.11);
    lidPivot.rotation.x = -0.28; // inclinado para trás, tela voltada para o banco (-Z local)
    const lidBack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.02), laptopBodyMat);
    lidBack.position.set(0, 0.14, 0);
    lidBack.castShadow = true;
    const scrMat = i % 2 === 0 ? MATS.scr_cyan : MATS.scr_green;
    const lidScreen = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.23, 0.012), scrMat);
    lidScreen.position.set(0, 0.14, -0.012); // face -Z olhando para o banco
    lidPivot.add(lidBack, lidScreen);
    stationGroup.add(lidPivot);

    // Caneca de café ao lado direito
    const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.11, 10), stdMat(mugColors[i], 0.5));
    mug.position.set(0.34, 0.835, tableZ - 0.04);
    mug.castShadow = true;
    stationGroup.add(mug);

    // Pequeno case de hardware ao lado esquerdo
    const hwCase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.28), laptopBodyMat);
    hwCase.position.set(-0.36, 0.85, tableZ);
    hwCase.castShadow = true;
    const hwLed = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), i % 2 ? MATS.led_green : MATS.led_red);
    hwLed.position.set(-0.3, 0.88, tableZ - 0.145);
    stationGroup.add(hwCase, hwLed);

    // 4) Cabo de Dados no Chão (y = 1.02) apontando para (0, 1.0, 0) e terminando na borda do anel (R = 1.0)
    const deskBaseWorld = new THREE.Vector3(
      sx - Math.cos(theta) * tableZ,
      1.02,
      sz - Math.sin(theta) * tableZ
    );
    const ringEdgeWorld = new THREE.Vector3(
      Math.cos(theta) * 1.0,
      1.02,
      Math.sin(theta) * 1.0
    );
    const deltaVec = new THREE.Vector3().subVectors(ringEdgeWorld, deskBaseWorld);
    const len = deltaVec.length();
    const mid = new THREE.Vector3().addVectors(deskBaseWorld, ringEdgeWorld).multiplyScalar(0.5);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, len, 8), cableMat);
    cable.position.copy(mid);
    cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), deltaVec.clone().normalize());
    cable.receiveShadow = true;
    scene.add(cable);

    // 5) Fluxo sutil de partículas verdes subindo do notebook (ativo quando alguém está sentado aqui)
    const particleGroup = new THREE.Group();
    particleGroup.position.set(0, 0.92, tableZ - 0.02);
    particleGroup.visible = false;
    const particles = [];
    const pGeo = new THREE.BoxGeometry(0.036, 0.036, 0.036);
    for (let k = 0; k < 7; k++) {
      const pm = new THREE.Mesh(pGeo, k % 2 === 0 ? MATS.scr_green : MATS.scr_cyan);
      pm.userData = {
        phase: (k / 7) * Math.PI * 2,
        speed: 0.45 + (k % 3) * 0.12,
        ox: ((k % 3) - 1) * 0.08,
        oz: ((k % 2) - 0.5) * 0.05,
      };
      particleGroup.add(pm);
      particles.push(pm);
    }
    stationGroup.add(particleGroup);

    STATIONS.push({
      index: i,
      theta,
      x: sx,
      z: sz,
      ry: Math.atan2(-sx, -sz), // olhando para o centro (0, 1, 0)
      particleGroup,
      particles,
    });
  }
})();

// =====================================================================
//  TAGS 3D (nametag + balão de chat estilo terminal)
// =====================================================================

function makeTagSprite(nick, color, isSitting = false) {
  const text = isSitting ? `[${nick} | 💻 CODING]` : `[${nick}]`;
  const borderCol = isSitting ? '#a6e3a1' : color;
  const textCol = isSitting ? '#a6e3a1' : '#cdd6f4';
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `bold 28px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + 28, h = 44;
  c.width = w; c.height = h;
  g.font = `bold 28px ${FONT}`;
  g.fillStyle = '#0d1117';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = borderCol;
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  g.fillStyle = textCol;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(w * 0.0055, h * 0.0055, 1);
  return sprite;
}

function makeFileTagSprite(filename, hexColor) {
  const text = `📄 ${filename}`;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `bold 24px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width) + 24, h = 38;
  c.width = w; c.height = h;
  g.font = `bold 24px ${FONT}`;
  g.fillStyle = '#0d1117';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = hexColor;
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  g.fillStyle = hexColor;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(w * 0.0046, h * 0.0046, 1);
  return sprite;
}

function spawnFileHologram(meta) {
  currentTotemFile = meta;
  if (fileHoloGroup) {
    scene.remove(fileHoloGroup);
    disposeObject(fileHoloGroup);
    fileHoloGroup = null;
    fileHoloLight = null;
  }
  if (!meta) return;

  const isImg = (meta.fileType || '').startsWith('image/');
  const hexNum = isImg ? 0xcba6f7 : 0xf9e2af;
  const hexStr = isImg ? '#cba6f7' : '#f9e2af';

  fileHoloGroup = new THREE.Group();
  fileHoloGroup.position.set(0, 4.5, 0); // Flutuando acima do Data Firepit e do Holograma do Vale em (0, 4.5, 0)

  const cardGroup = new THREE.Group();
  const cardCore = new THREE.Mesh(
    new THREE.BoxGeometry(0.56, 0.72, 0.035),
    new THREE.MeshStandardMaterial({
      color: hexNum,
      emissive: hexNum,
      emissiveIntensity: 1.6,
      transparent: true,
      opacity: 0.55,
      roughness: 0.25,
    })
  );
  const cardWire = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.78, 0.05),
    new THREE.MeshBasicMaterial({ color: hexNum, wireframe: true, transparent: true, opacity: 0.85 })
  );
  cardGroup.add(cardCore, cardWire);
  fileHoloGroup.add(cardGroup);
  fileHoloGroup.userData.cardGroup = cardGroup;

  fileHoloLight = new THREE.PointLight(hexNum, 2.2, 6);
  fileHoloLight.position.set(0, 0, 0.2);
  fileHoloGroup.add(fileHoloLight);

  const label = makeFileTagSprite(meta.filename, hexStr);
  label.position.set(0, 0.62, 0);
  fileHoloGroup.add(label);

  scene.add(fileHoloGroup);
}

function wrapText(text, n, maxLines) {
  const lines = [];
  let rest = text;
  while (rest.length && lines.length < maxLines) {
    if (rest.length <= n) { lines.push(rest); rest = ''; break; }
    let cut = rest.lastIndexOf(' ', n);
    if (cut < n * 0.5) cut = n;
    lines.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length) lines[lines.length - 1] = lines[lines.length - 1].slice(0, n - 1) + '…';
  return lines;
}

function makeBubbleSprite(text, color) {
  const lines = wrapText(text, 26, 3);
  lines[0] = '> ' + lines[0];
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const f = `22px ${FONT}`;
  g.font = f;
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 24;
  const lh = 30, h = lines.length * lh + 16;
  c.width = w; c.height = h;
  g.font = f;
  g.fillStyle = '#0d1117';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  g.fillStyle = '#a6e3a1';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, 12, 8 + lh * i + lh / 2));
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(w * 0.0048, h * 0.0048, 1);
  return sprite;
}

function disposeSprite(sprite) {
  sprite.material.map?.dispose();
  sprite.material.dispose();
}

// =====================================================================
//  JOGADORES
// =====================================================================
function refreshTag(player) {
  if (player.tag) { player.group.remove(player.tag); disposeSprite(player.tag); }
  player.tag = makeTagSprite(player.nick, player.color || '#89b4fa', !!player.isSitting);
  player.group.add(player.tag);
  positionTags(player);
}

function positionTags(player) {
  const h = (player.mascot ? player.mascot.userData.height : 1.4) * MASCOT_SCALE;
  if (player.tag) player.tag.position.y = h + 0.22;
  if (player.bubble) player.bubble.sprite.position.y = h + 0.22 + 0.3 + player.bubble.sprite.scale.y / 2;
}

function setPlayerMascot(player, species, color) {
  if (player.mascot && player.species === species) {
    if (player.color !== color) {
      player.mascot.userData.accentMat.color.set(color);
      player.mascot.userData.accentMat.emissive.set(color);
      player.color = color;
      refreshTag(player);
    }
    return;
  }
  const prevRy = player.mascot ? player.mascot.rotation.y : player.targetRy;
  if (player.mascot) { player.group.remove(player.mascot); disposeObject(player.mascot); }
  const mascot = createMascotMesh(species, color);
  mascot.scale.setScalar(MASCOT_SCALE);
  mascot.rotation.y = prevRy;
  player.group.add(mascot);
  player.mascot = mascot;
  player.species = species;
  const colorChanged = player.color !== color;
  player.color = color;
  if (colorChanged || !player.tag) refreshTag(player);
  else positionTags(player);
}

function nearestWalkable(x, z) {
  if (isWalkable(x, z)) return [x, z];
  for (let r = 0.5; r <= 8; r += 0.5)
    for (let a = 0; a < 16; a++) {
      const nx = x + Math.cos((a * Math.PI) / 8) * r, nz = z + Math.sin((a * Math.PI) / 8) * r;
      if (isWalkable(nx, nz)) return [nx, nz];
    }
  return [x, z];
}

function addOrUpdatePlayer(data, isLocal) {
  const { id } = data;
  const species = data.species || 'penguin';
  const color = data.color || '#89b4fa';
  const nick = data.nick || id;
  const isSitting = !!data.isSitting;
  const seatIndex = typeof data.seatIndex === 'number' ? data.seatIndex : null;

  if (players.has(id)) {
    const p = players.get(id);
    if (!p.isLocal) { p.targetX = data.x; p.targetZ = data.z; p.targetRy = data.ry || 0; }
    const sitChanged = p.isSitting !== isSitting;
    p.isSitting = isSitting;
    p.seatIndex = seatIndex;
    if (p.nick !== nick || sitChanged) { p.nick = nick; refreshTag(p); }
    setPlayerMascot(p, species, color);
    return p;
  }

  let x = data.x, z = data.z;
  if (isLocal && !isSitting) [x, z] = nearestWalkable(x, z);
  const group = new THREE.Group();
  const y = isSitting ? 1.32 : getTerrainHeight(x, z);
  group.position.set(x, y, z);
  scene.add(group);

  const p = {
    id, group, nick, mascot: null, tag: null, bubble: null,
    species: null, color: null,
    targetX: x, targetZ: z, targetRy: data.ry || 0,
    currentX: x, currentZ: z, baseY: y,
    isLocal, walkTimer: 0, moving: false,
    isSitting, seatIndex,
  };
  setPlayerMascot(p, species, color);
  players.set(id, p);
  return p;
}

function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  scene.remove(p.group);
  disposeObject(p.group);
  players.delete(id);
}

function showBubble(player, text) {
  if (player.bubble) { player.group.remove(player.bubble.sprite); disposeSprite(player.bubble.sprite); }
  const sprite = makeBubbleSprite(text, player.color || '#89b4fa');
  player.group.add(sprite);
  player.bubble = { sprite, expires: performance.now() + 5000 };
  positionTags(player);
}

function updatePlayerCounter() {
  statusDevs.textContent = String(players.size);
}

// =====================================================================
//  TERMINAL (UI)
// =====================================================================
function logLine(kind, tag, msg, nickHtml) {
  const div = document.createElement('div');
  div.className = 'ln ' + kind;
  const t = document.createElement('span');
  t.className = 'tag';
  t.textContent = tag + ' ';
  div.appendChild(t);
  if (nickHtml) {
    const n = document.createElement('span');
    n.className = 'nick';
    n.textContent = `<${nickHtml}> `;
    div.appendChild(n);
  }
  const m = document.createElement('span');
  m.className = 'msg';
  m.textContent = msg;
  div.appendChild(m);
  logEl.appendChild(div);
  while (logEl.childElementCount > 300) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
const logSys = (m) => logLine('sys', '[SYS]', m);
const logNet = (m) => logLine('net', '[NET]', m);
const logErr = (m) => logLine('err', '[ERR]', m);

function logFileShared(meta) {
  const div = document.createElement('div');
  div.className = 'ln file';
  const t = document.createElement('span');
  t.className = 'tag';
  t.textContent = '[FILE] ';
  div.appendChild(t);
  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = `${meta.nick} fez o upload de "${meta.filename}".`;
  div.appendChild(msg);
  const btn = document.createElement('button');
  btn.className = 'file-link';
  btn.textContent = '[Clique para inspecionar]';
  btn.addEventListener('click', () => openFileInspector(meta.file_id));
  div.appendChild(btn);
  logEl.appendChild(div);
  while (logEl.childElementCount > 300) logEl.firstChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

// =====================================================================
//  MODAL TUI & SISTEMA DE "FILE & PRINT DROP" (Drag & Drop + Ctrl+V)
// =====================================================================
const fileModalEl = $('file-modal');
const modalTitleEl = $('modal-title');
const modalInfoEl = $('modal-info');
const modalOwnerEl = $('modal-owner');
const modalContentEl = $('modal-content');
const modalDownloadBtn = $('modal-download');
const modalCloseBtn = $('modal-close');
const dropBannerEl = $('drop-banner');
const tooltipEl = $('tui-tooltip');

let activeModalFile = null;
let pendingInspectId = null;

const isModalOpen = () => fileModalEl.classList.contains('open');

function closeFileModal() {
  fileModalEl.classList.remove('open');
  activeModalFile = null;
  pendingInspectId = null;
}

function decodeDataUrlText(dataUrl) {
  try {
    const comma = dataUrl.indexOf(',');
    const raw = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    const bin = atob(raw);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '[Conteúdo binário — use o botão DOWNLOAD para salvar]';
  }
}

function renderFileModal(file) {
  activeModalFile = file;
  const headerCore = ` preview: ${file.filename} `;
  const barLen = Math.max(4, 62 - headerCore.length);
  modalTitleEl.textContent = `╔════${headerCore}${'═'.repeat(barLen)}╗`;
  modalInfoEl.textContent = `file: ${file.filename} (${file.fileType || 'text/plain'})`;
  modalOwnerEl.textContent = `uploaded by: <${file.nick || file.owner}>`;
  modalContentEl.innerHTML = '';

  const isImg =
    (file.fileType || '').startsWith('image/') ||
    (file.base64 || '').startsWith('data:image/');

  if (isImg) {
    const img = document.createElement('img');
    img.src = file.base64;
    img.alt = file.filename;
    modalContentEl.appendChild(img);
  } else {
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = decodeDataUrlText(file.base64 || '');
    pre.appendChild(code);
    modalContentEl.appendChild(pre);
  }
  fileModalEl.classList.add('open');
}

function openFileInspector(fileId) {
  if (!fileId) return;
  if (clientFileCache.has(fileId)) {
    renderFileModal(clientFileCache.get(fileId));
    return;
  }
  pendingInspectId = fileId;
  modalTitleEl.textContent = '╔════ preview: carregando do totem... ════════════════════════════╗';
  modalInfoEl.textContent = `id: ${fileId}`;
  modalOwnerEl.textContent = 'totem_cache';
  modalContentEl.innerHTML = '<pre><code>Buscando payload no Totem Central...</code></pre>';
  fileModalEl.classList.add('open');
  sendJSON({ type: 'request_file', file_id: fileId });
  fetch(`/api/files/${encodeURIComponent(fileId)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((entry) => {
      if (entry && entry.file_id) {
        clientFileCache.set(entry.file_id, entry);
        if (pendingInspectId === entry.file_id) renderFileModal(entry);
      }
    })
    .catch(() => {});
}

modalCloseBtn.addEventListener('click', closeFileModal);
fileModalEl.addEventListener('click', (e) => {
  if (e.target === fileModalEl) closeFileModal();
});
modalDownloadBtn.addEventListener('click', () => {
  if (!activeModalFile?.base64) return;
  const a = document.createElement('a');
  a.href = activeModalFile.base64;
  a.download = activeModalFile.filename || 'totem_file';
  document.body.appendChild(a);
  a.click();
  a.remove();
});

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB

function shareFileObject(file, customName) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    logErr(`arquivo excede o limite de 2MB (${(file.size / 1048576).toFixed(2)} MB)`);
    return;
  }
  const filename = customName || file.name || `print_${Date.now()}.png`;
  const fileType = file.type || 'text/plain';

  // Feedback visual reativo imediato na Data Firepit
  setPromptStatus('[ ⏳ Processando... ]', '#f9e2af');
  triggerThermalUploadBurst();

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = String(reader.result || '');
    sendJSON({
      type: 'file_shared',
      filename,
      fileType,
      base64,
      owner: myPlayerId,
    });
  };
  reader.onerror = () => {
    logErr('falha ao ler arquivo local');
    setPromptStatus(DEFAULT_PROMPT_TEXT, DEFAULT_PROMPT_COLOR);
  };
  reader.readAsDataURL(file);
}

let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    dragDepth++;
    dropBannerEl.classList.add('active');
  }
});
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropBannerEl.classList.remove('active');
});
window.addEventListener('drop', (e) => {
  dragDepth = 0;
  dropBannerEl.classList.remove('active');
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  shareFileObject(e.dataTransfer.files[0]);
});

window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '');
        const defaultName = file.name && file.name !== 'image.png' ? file.name : `print_${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.${ext}`;
        shareFileObject(file, defaultName);
        return;
      }
    }
  }
});

// =====================================================================
//  SISTEMA DE SENTAR NOS BANCOS (Tecla E / ESC)
// =====================================================================
let nearestBenchIndex = null;
let nearTotem = false;

function toggleSit(wantSit, benchIdx = null) {
  const local = players.get(myPlayerId);
  if (!local) return;

  if (wantSit) {
    const st = STATIONS[benchIdx];
    if (!st) return;
    local.isSitting = true;
    local.seatIndex = st.index;
    local.moving = false;
    local.targetX = st.x;
    local.targetZ = st.z;
    local.targetRy = st.ry;
    Object.keys(keys).forEach((k) => (keys[k] = false));
    refreshTag(local);
    sendJSON({
      type: 'player_status_change',
      isSitting: true,
      seatIndex: st.index,
      x: st.x,
      z: st.z,
      ry: st.ry,
    });
  } else {
    const st = STATIONS[local.seatIndex ?? 0] || STATIONS[0];
    const exitR = 4.82; // atrás do tronco (fora da colisão do banco)
    const exitX = Math.cos(st.theta) * exitR;
    const exitZ = Math.sin(st.theta) * exitR;
    local.isSitting = false;
    local.seatIndex = null;
    local.currentX = exitX;
    local.currentZ = exitZ;
    local.targetX = exitX;
    local.targetZ = exitZ;
    local.baseY = 1.0;
    refreshTag(local);
    sendJSON({
      type: 'player_status_change',
      isSitting: false,
      seatIndex: null,
      x: exitX,
      z: exitZ,
      ry: local.targetRy,
    });
  }
}

const speciesButtons = document.querySelectorAll('#mascot-row .opt');
const colorRow = $('color-row');
HEADSET_COLORS.forEach((c) => {
  const b = document.createElement('button');
  b.className = 'opt';
  b.dataset.color = c;
  b.style.color = c;
  b.textContent = `[${c}]`;
  b.addEventListener('click', () => chooseAppearance({ color: c }));
  colorRow.appendChild(b);
});
speciesButtons.forEach((b) => b.addEventListener('click', () => chooseAppearance({ species: b.dataset.species })));

function refreshPickerUI() {
  speciesButtons.forEach((b) => b.classList.toggle('active', b.dataset.species === mySpecies));
  colorRow.querySelectorAll('.opt').forEach((b) => {
    const on = myColor && b.dataset.color.toUpperCase() === myColor.toUpperCase();
    b.classList.toggle('active', !!on);
    b.style.color = on ? '#000' : b.dataset.color;
    b.style.background = on ? b.dataset.color : '';
  });
}

function sendJSON(obj) {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
}

function chooseAppearance({ species, color, nick }) {
  if (species) { mySpecies = species; localStorage.setItem('devalley_species', species); }
  if (color) { myColor = color; localStorage.setItem('devalley_color', color); }
  if (nick) { myNick = nick; localStorage.setItem('devalley_nick', nick); }
  const me = players.get(myPlayerId);
  if (me && (species || color)) setPlayerMascot(me, mySpecies || me.species, myColor || me.color);
  refreshPickerUI();
  sendJSON({ type: 'customize', species: mySpecies, color: myColor, nick: myNick });
  inputEl.blur();
  document.activeElement?.blur?.();
}

const HELP = [
  '/nick <nome>                  altera seu nick',
  '/avatar <tux|duck|python|octocat>  troca o mascote',
  '/time <sunset|night|noon>     muda a hora do dia (local)',
  '/clear                        limpa o terminal',
  'texto sem "/"                 envia mensagem no chat da sala',
];

function handleCommand(line) {
  const [cmdRaw, ...rest] = line.slice(1).trim().split(/\s+/);
  const cmd = (cmdRaw || '').toLowerCase();
  const arg = rest.join(' ').trim();
  switch (cmd) {
    case 'nick': {
      const nick = arg.replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 16);
      if (!nick) return logErr('uso: /nick <nome>  (letras, números, _ e -; máx. 16)');
      chooseAppearance({ nick });
      logSys(`nick -> ${nick}`);
      return;
    }
    case 'avatar': {
      const sp = SPECIES_ALIAS[arg.toLowerCase()];
      if (!sp) return logErr('uso: /avatar <tux|duck|python|octocat>');
      chooseAppearance({ species: sp });
      logSys(`avatar -> ${arg.toLowerCase()}`);
      return;
    }
    case 'time': {
      const t = arg.toLowerCase();
      if (!setTime(t)) return logErr('uso: /time <sunset|night|noon>');
      logSys(`time -> ${t}`);
      return;
    }
    case 'clear':
      logEl.innerHTML = '';
      return;
    case 'help':
      HELP.forEach((h) => logSys(h));
      return;
    default:
      logErr(`comando desconhecido: /${cmd}  (tente /help)`);
  }
}

const cmdHistory = [];
let histPos = 0;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const line = inputEl.value.trim();
    inputEl.value = '';
    if (line) {
      cmdHistory.push(line);
      histPos = cmdHistory.length;
      if (line.startsWith('/')) handleCommand(line);
      else sendJSON({ type: 'chat', text: line });
    }
  } else if (e.key === 'Escape') {
    inputEl.blur();
  } else if (e.key === 'ArrowUp' && cmdHistory.length) {
    histPos = Math.max(0, histPos - 1);
    inputEl.value = cmdHistory[histPos];
    e.preventDefault();
  } else if (e.key === 'ArrowDown' && cmdHistory.length) {
    histPos = Math.min(cmdHistory.length, histPos + 1);
    inputEl.value = cmdHistory[histPos] ?? '';
    e.preventDefault();
  }
});
inputEl.addEventListener('focus', () => {
  Object.keys(keys).forEach((k) => (keys[k] = false)); // WASD totalmente bloqueado em foco
  terminalEl.classList.add('focused');
});
inputEl.addEventListener('blur', () => terminalEl.classList.remove('focused'));
$('term-min').addEventListener('click', () => terminalEl.classList.toggle('min'));
renderer.domElement.addEventListener('pointerdown', () => inputEl.blur());

// =====================================================================
//  WEBSOCKET
// =====================================================================
function setConn(state) {
  statusDot.className = state;
}

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const qs = new URLSearchParams();
  if (mySpecies) qs.set('species', mySpecies);
  if (myColor) qs.set('color', myColor);
  if (myNick) qs.set('nick', myNick);
  socket = new WebSocket(`${protocol}//${window.location.host}/ws/${myPlayerId}?${qs}`);

  socket.onopen = () => { setConn(''); logNet(`connected as ${myPlayerId}`); };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'init') {
      const me = data.players[myPlayerId];
      if (me) { mySpecies = me.species; myColor = me.color; myNick = me.nick; }
      refreshPickerUI();
      for (const id of [...players.keys()]) if (!data.players[id]) removePlayer(id);
      const hadLocal = players.has(myPlayerId);
      for (const [id, pData] of Object.entries(data.players)) addOrUpdatePlayer(pData, id === myPlayerId);
      const local = players.get(myPlayerId);
      if (local && !local.isSitting) sendMove(local.currentX, local.currentZ, local.targetRy, true); // corrige spawn / reconexão
      if (data.latest_file) spawnFileHologram(data.latest_file);
      updatePlayerCounter();
      if (!hadLocal) logNet(`${Object.keys(data.players).length} dev(s) in room`);
    } else if (data.type === 'player_joined') {
      addOrUpdatePlayer(data.player, false);
      updatePlayerCounter();
      logNet(`${data.player.nick} joined the node`);
    } else if (data.type === 'player_moved') {
      const p = players.get(data.id);
      if (p && !p.isLocal) { p.targetX = data.x; p.targetZ = data.z; p.targetRy = data.ry ?? p.targetRy; }
    } else if (data.type === 'player_status_change') {
      const p = players.get(data.id);
      if (p) {
        p.isSitting = !!data.isSitting;
        p.seatIndex = typeof data.seatIndex === 'number' ? data.seatIndex : null;
        if (typeof data.x === 'number') p.targetX = data.x;
        if (typeof data.z === 'number') p.targetZ = data.z;
        if (typeof data.ry === 'number') p.targetRy = data.ry;
        if (!p.isLocal && !p.isSitting && typeof data.x === 'number') {
          p.currentX = data.x;
          p.currentZ = data.z;
        }
        refreshTag(p);
      }
    } else if (data.type === 'player_updated') {
      const p = players.get(data.id);
      if (p) {
        if (p.nick !== data.nick) {
          if (data.id !== myPlayerId) logNet(`${p.nick} is now ${data.nick}`);
          p.nick = data.nick;
          refreshTag(p);
        }
        setPlayerMascot(p, data.species, data.color);
      }
      if (data.id === myPlayerId) { mySpecies = data.species; myColor = data.color; myNick = data.nick; refreshPickerUI(); }
    } else if (data.type === 'chat') {
      logLine('chat' + (data.id === myPlayerId ? ' me' : ''), '[CHAT]', data.text, data.nick);
      const p = players.get(data.id);
      if (p) showBubble(p, data.text);
    } else if (data.type === 'file_shared') {
      spawnFileHologram(data);
      logFileShared(data);
      triggerThermalUploadBurst();
      setPromptStatus('[ ✓ Arquivo Recebido ]', '#00f5d4', 4000);
    } else if (data.type === 'file_data') {
      const file = data.file;
      if (file?.file_id) {
        clientFileCache.set(file.file_id, file);
        if (pendingInspectId === file.file_id) renderFileModal(file);
      }
    } else if (data.type === 'player_left') {
      logNet(`${data.nick || data.id} left the node`);
      removePlayer(data.id);
      updatePlayerCounter();
    }
  };

  socket.onclose = () => {
    setConn('down');
    logErr('connection lost, retrying in 2s...');
    setTimeout(connectWebSocket, 2000);
  };
  setConn('wait');
}

let lastSendTime = 0;
function sendMove(x, z, ry, force = false) {
  const now = performance.now();
  if (force || now - lastSendTime > 33) {
    sendJSON({ type: 'move', x, z, ry });
    lastSendTime = now;
  }
}

// =====================================================================
//  INPUT (WASD bloqueado enquanto o input do terminal estiver em foco)
// =====================================================================
const isTyping = () => document.activeElement === inputEl;
const normKey = (e) => (e.key.length === 1 ? e.key.toLowerCase() : e.key);

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isModalOpen()) {
      e.preventDefault();
      closeFileModal();
      return;
    }
    const local = players.get(myPlayerId);
    if (!isTyping() && local?.isSitting) {
      e.preventDefault();
      toggleSit(false);
      return;
    }
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (isTyping()) inputEl.blur();
    else { terminalEl.classList.remove('min'); inputEl.focus(); }
    return;
  }
  if (isTyping() || isModalOpen()) return;
  if (e.key === 'Enter') { terminalEl.classList.remove('min'); inputEl.focus(); e.preventDefault(); return; }

  const k = normKey(e);
  if (k === 'e' && !e.repeat) {
    const local = players.get(myPlayerId);
    if (local?.isSitting) toggleSit(false);
    else if (nearestBenchIndex !== null) toggleSit(true, nearestBenchIndex);
    return;
  }
  if (k === 'f' && !e.repeat) {
    if (nearTotem && currentTotemFile?.file_id) {
      openFileInspector(currentTotemFile.file_id);
    }
    return;
  }

  if (keys[k] !== undefined) {
    keys[k] = true;
    if (k.startsWith('Arrow')) e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  const k = normKey(e);
  if (keys[k] !== undefined) keys[k] = false;
});
window.addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
//  ANIMAÇÃO
// =====================================================================
function lerpAngle(a, b, t) {
  return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
}

function animateMascot(player, delta, elapsed) {
  const mascot = player.mascot;
  if (!mascot) return;
  const { body, feet } = mascot.userData;
  mascot.rotation.y = lerpAngle(mascot.rotation.y, player.targetRy, 1 - Math.exp(-12 * delta));

  if (player.moving) {
    player.walkTimer += delta * 11;
    const t = player.walkTimer;
    body.position.y = Math.abs(Math.sin(t)) * 0.1; // pulinho
    body.rotation.z = Math.sin(t) * 0.14; // waddle
    body.rotation.x = 0.06;
    body.scale.y = 1;
    feet.forEach((f, i) => {
      const phase = i % 2 === 0 ? Math.sin(t) : -Math.sin(t);
      f.position.y = Math.max(0, phase) * 0.07;
      f.rotation.x = phase * 0.25;
    });
  } else {
    const k = 1 - Math.exp(-10 * delta);
    body.position.y = THREE.MathUtils.lerp(body.position.y, 0, k);
    body.rotation.z = THREE.MathUtils.lerp(body.rotation.z, 0, k);
    body.rotation.x = THREE.MathUtils.lerp(body.rotation.x, 0, k);
    body.scale.y = 1 + Math.sin(elapsed * 2.2 + player.currentX) * 0.015;
    feet.forEach((f) => {
      f.position.y = THREE.MathUtils.lerp(f.position.y, 0, k);
      f.rotation.x = THREE.MathUtils.lerp(f.rotation.x, 0, k);
    });
  }
}

/** Move o jogador local respeitando terreno, obstáculos e degraus de no máx. 1 camada. */
function moveLocal(p, dx, dz) {
  const nx = p.currentX + dx, nz = p.currentZ + dz;
  if (!isWalkable(p.currentX, p.currentZ)) { // preso (ex.: reconexão): só sai para terreno válido
    if (isWalkable(nx, nz)) { p.currentX = nx; p.currentZ = nz; }
    return;
  }
  const fromH = getTerrainHeight(p.currentX, p.currentZ);
  const ok = (x, z) => isWalkable(x, z) && Math.abs(getTerrainHeight(x, z) - fromH) <= 0.55;
  if (ok(nx, nz)) { p.currentX = nx; p.currentZ = nz; }
  else if (ok(nx, p.currentZ)) p.currentX = nx;
  else if (ok(p.currentX, nz)) p.currentZ = nz;
}

function stepTime(dt) {
  const k = 1 - Math.exp(-2.5 * dt);
  cur.sunColor.lerp(tgt.sunColor, k);
  cur.sunPos.lerp(tgt.sunPos, k);
  cur.hemiSky.lerp(tgt.hemiSky, k);
  cur.hemiGround.lerp(tgt.hemiGround, k);
  cur.fog.lerp(tgt.fog, k);
  for (const key of ['sunI', 'hemiI', 'fogD', 'lamp', 'win', 'exposure']) cur[key] += (tgt[key] - cur[key]) * k;

  sun.color.copy(cur.sunColor);
  sun.intensity = cur.sunI;
  sun.position.copy(cur.sunPos);
  hemi.color.copy(cur.hemiSky);
  hemi.groundColor.copy(cur.hemiGround);
  hemi.intensity = cur.hemiI;
  scene.fog.color.copy(cur.fog);
  scene.fog.density = cur.fogD;
  renderer.toneMappingExposure = cur.exposure;
  MATS.window.emissiveIntensity = cur.win;
  MATS.lamp.emissiveIntensity = 0.4 + 2.0 * Math.min(cur.lamp, 1.2);
  for (const l of lampLights) l.intensity = 2.5 * cur.lamp;
}

const clock = new THREE.Clock();
const UP = new THREE.Vector3(0, 1, 0);
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const followTarget = new THREE.Vector3();
let wasMoving = false;
let hudTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);
  const elapsed = clock.elapsedTime;

  stepTime(delta);

  // Mar ondulando + LEDs/telas piscando + Fogueira + Holograma
  waveTex.offset.x += delta * 0.006;
  waveTex.offset.y += delta * 0.0035;
  MATS.led_red.emissiveIntensity = Math.sin(elapsed * 9) > 0 ? 2.4 : 0.15;
  MATS.led_green.emissiveIntensity = Math.sin(elapsed * 9) > 0 ? 0.2 : 2.2;
  MATS.scr_cyan.emissiveIntensity = 1.5 + 0.15 * Math.sin(elapsed * 3.1);
  MATS.scr_green.emissiveIntensity = 1.5 + 0.15 * Math.sin(elapsed * 2.3 + 1);

  for (let i = 0; i < fireCubes.length; i++) {
    const fc = fireCubes[i];
    const w = Math.sin(elapsed * 8 + fc.userData.phase);
    fc.position.y = fc.userData.baseY + Math.max(0, w) * 0.12;
    const sY = 1.0 + 0.28 * Math.sin(elapsed * 8 + i * 1.3);
    const sXZ = 1.0 - 0.12 * Math.cos(elapsed * 8 + i * 0.9);
    fc.scale.set(sXZ, sY, sXZ);
    fc.rotation.y += delta * (1.2 + i * 0.2);
  }
  // Partículas de código ("dados" ciano/verde) evaporando do fogo até Y=2.5 no mundo (y=1.5 no coreGroup)
  for (let i = 0; i < fireDataParticles.length; i++) {
    const dp = fireDataParticles[i];
    const u = ((elapsed * dp.userData.speed + dp.userData.phase) % 1 + 1) % 1;
    const swirl = dp.userData.angle + elapsed * 1.35 + u * 2.2;
    const rad = dp.userData.radius * (0.45 + 0.85 * u);
    dp.position.set(
      Math.cos(swirl) * rad,
      0.24 + u * 1.26, // de Y=1.24 até Y=2.50 no mundo
      Math.sin(swirl) * rad
    );
    const pulse = Math.sin(u * Math.PI);
    dp.scale.setScalar(0.45 + 0.85 * pulse);
    dp.rotation.x = elapsed * 2.2 + i;
    dp.rotation.y = elapsed * 1.8 - i;
  }
  if (fireLight) {
    if (performance.now() < fireBoostUntil) {
      fireLight.intensity = 8.0;
    } else {
      fireLight.intensity = 4.0 + Math.sin(elapsed * 11) * 0.45 + Math.cos(elapsed * 17) * 0.25;
    }
  }
  if (promptSprite) {
    promptSprite.position.y = 2.3 + Math.sin(elapsed * 2.5) * 0.15;
  }
  if (holoGroup) {
    holoGroup.position.y = 2.5 + Math.sin(elapsed * 2) * 0.09; // mundo Y = 3.5
    holoGroup.rotation.y = elapsed * 0.55;
    if (holoRingX) holoRingX.rotation.x = elapsed * 1.1;
    if (holoRingY) holoRingY.rotation.y = -elapsed * 0.85;
  }
  if (fileHoloGroup) {
    fileHoloGroup.position.y = 4.5 + Math.sin(elapsed * 2.6) * 0.08;
    const cg = fileHoloGroup.userData.cardGroup;
    if (cg) cg.rotation.y = elapsed * 1.4;
    if (fileHoloLight) fileHoloLight.intensity = 1.8 + 0.6 * Math.sin(elapsed * 4.2);
  }

  // Anima partículas verdes subindo do notebook nas estações ocupadas
  for (let s = 0; s < STATIONS.length; s++) {
    const st = STATIONS[s];
    let occupied = false;
    players.forEach((p) => {
      if (p.isSitting && p.seatIndex === s) occupied = true;
    });
    st.particleGroup.visible = occupied;
    if (occupied) {
      for (let k = 0; k < st.particles.length; k++) {
        const pm = st.particles[k];
        const u = ((elapsed * pm.userData.speed + pm.userData.phase) % 1 + 1) % 1;
        pm.position.set(
          pm.userData.ox + Math.sin(elapsed * 3 + k) * 0.03,
          u * 0.65,
          pm.userData.oz + Math.cos(elapsed * 2.5 + k) * 0.02
        );
        const sc = Math.sin(u * Math.PI);
        pm.scale.setScalar(0.5 + 0.7 * sc);
        pm.rotation.y = elapsed * 2 + k;
      }
    }
  }

  const local = players.get(myPlayerId);

  // 1. Movimentação local (desativada enquanto sentado) & Proximity Triggers
  if (local) {
    if (local.isSitting) {
      local.moving = false;
      wasMoving = false;
    } else {
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, UP).normalize();

      let mx = 0, mz = 0;
      if (keys.w || keys.ArrowUp) { mx += forward.x; mz += forward.z; }
      if (keys.s || keys.ArrowDown) { mx -= forward.x; mz -= forward.z; }
      if (keys.d || keys.ArrowRight) { mx += right.x; mz += right.z; }
      if (keys.a || keys.ArrowLeft) { mx -= right.x; mz -= right.z; }

      const len = Math.hypot(mx, mz);
      let moved = false;
      if (len > 0.001) {
        const dirX = mx / len, dirZ = mz / len;
        const ox = local.currentX, oz = local.currentZ;
        moveLocal(local, dirX * 3.2 * delta, dirZ * 3.2 * delta);
        moved = Math.hypot(local.currentX - ox, local.currentZ - oz) > 0.0005;
        local.targetRy = Math.atan2(dirX, dirZ); // mascote olha para onde anda
        if (moved) sendMove(local.currentX, local.currentZ, local.targetRy);
      }
      local.moving = moved;
      if (!moved && wasMoving) sendMove(local.currentX, local.currentZ, local.targetRy, true);
      wasMoving = moved;
      local.group.position.x = local.currentX;
      local.group.position.z = local.currentZ;
    }

    // Cálculo de proximidade para os 6 bancos (< 1.5 unidades) e para o Totem Central
    let bestIdx = null;
    let bestDist = 1.5;
    for (let i = 0; i < STATIONS.length; i++) {
      const d = Math.hypot(local.currentX - STATIONS[i].x, local.currentZ - STATIONS[i].z);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    nearestBenchIndex = bestIdx;
    nearTotem = Math.hypot(local.currentX, local.currentZ) < 2.6;

    // Atualiza Tooltip TUI de proximidade
    const prompts = [];
    if (local.isSitting) {
      prompts.push('<span><span class="key">E</span><span class="key alt">ESC</span>Levantar da Estação</span>');
    } else if (nearestBenchIndex !== null) {
      prompts.push('<span><span class="key">E</span>Sentar na Estação</span>');
    }
    if (nearTotem && currentTotemFile) {
      prompts.push(`<span><span class="key alt">F</span>Inspecionar "${currentTotemFile.filename}"</span>`);
    }
    if (prompts.length && !isModalOpen()) {
      tooltipEl.innerHTML = prompts.join('');
      tooltipEl.classList.add('visible');
    } else {
      tooltipEl.classList.remove('visible');
    }
  }

  // 2. Interpolação de jogadores + pose sentada + altura do terreno + animação + balões
  const lerpK = 1 - Math.exp(-15 * delta);
  const yK = 1 - Math.exp(-16 * delta);
  const now = performance.now();
  players.forEach((p) => {
    if (p.isSitting) {
      const st = STATIONS[p.seatIndex ?? 0];
      const tx = st ? st.x : p.targetX;
      const tz = st ? st.z : p.targetZ;
      p.moving = false;
      p.currentX += (tx - p.currentX) * lerpK;
      p.currentZ += (tz - p.currentZ) * lerpK;
      if (st) p.targetRy = st.ry;
      p.baseY += (1.32 - p.baseY) * yK; // sentado sobre o tronco (altura 0.45)
      p.group.position.set(p.currentX, p.baseY, p.currentZ);
    } else {
      if (!p.isLocal) {
        const dx = p.targetX - p.currentX, dz = p.targetZ - p.currentZ;
        p.moving = Math.hypot(dx, dz) > 0.02;
        p.currentX += dx * lerpK;
        p.currentZ += dz * lerpK;
        p.group.position.x = p.currentX;
        p.group.position.z = p.currentZ;
      }
      // Na clareira e gramado (r <= 9.0) fica cravado em 1.0; nas encostas interpola suavemente
      const targetY = getTerrainHeight(p.currentX, p.currentZ);
      p.baseY = Math.hypot(p.currentX, p.currentZ) <= 9.0 ? 1.0 : p.baseY + (targetY - p.baseY) * yK;
      p.group.position.y = p.baseY;
    }
    animateMascot(p, delta, elapsed);

    if (p.bubble) {
      const left = p.bubble.expires - now;
      if (left <= 0) { p.group.remove(p.bubble.sprite); disposeSprite(p.bubble.sprite); p.bubble = null; }
      else p.bubble.sprite.material.opacity = Math.min(1, left / 400);
    }
  });

  // Câmera acompanha o jogador local suavemente (mantém o ângulo do usuário)
  if (local) {
    followTarget.set(local.currentX, local.baseY + 1.0, local.currentZ);
    const step = followTarget.sub(controls.target).multiplyScalar(1 - Math.exp(-4 * delta));
    controls.target.add(step);
    camera.position.add(step);
  }
  controls.update();

  hudTimer += delta;
  if (hudTimer > 0.1 && local) {
    hudTimer = 0;
    statusPos.textContent = `POS: (${local.currentX.toFixed(1)}, ${local.baseY.toFixed(1)}, ${local.currentZ.toFixed(1)})`;
  }

  composer.render();
}

// =====================================================================
//  BOOT
// =====================================================================
setSky('sunset');
refreshPickerUI();
logSys('DEVALLEY_OS v1.0 — mediterranean_node online');
logSys(`micro-voxels renderizados: ${worldStats.total.toLocaleString('pt-BR')} (InstancedMesh)`);
logSys('WASD mover | mouse girar/zoom | [TAB] terminal | /help');
connectWebSocket();
animate();

if (document.fonts?.load) {
  document.fonts
    .load(`bold 28px "JetBrains Mono"`)
    .then(() => {
      players.forEach(refreshTag);
      if (promptSprite && !promptResetTimer) {
        updateFloatingText(promptSprite, DEFAULT_PROMPT_TEXT, DEFAULT_PROMPT_COLOR);
      }
    })
    .catch(() => {});
}
