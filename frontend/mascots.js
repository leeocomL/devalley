import * as THREE from 'three';

// --- UTILITÁRIOS DE CONSTRUÇÃO VOXEL ---
// Cada mascote olha para +Z (frente) por padrão; rotation.y = atan2(dx, dz) o vira para a direção do movimento.

function makeMaterialFactory() {
  const cache = new Map();
  return (color, opts = {}) => {
    const key = color + JSON.stringify(opts);
    if (!cache.has(key)) {
      cache.set(
        key,
        new THREE.MeshStandardMaterial({ color, roughness: 0.75, flatShading: true, ...opts })
      );
    }
    return cache.get(key);
  };
}

function addBox(parent, mat, w, h, d, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

/**
 * Headset gamer: concha nas laterais da cabeça, arco por cima e microfone.
 * (cx, cy, cz) = centro da cabeça; (hw, hh, hd) = meia-largura/altura/profundidade da cabeça.
 */
function addHeadset(parent, accentMat, darkMat, cx, cy, cz, hw, hh, hd) {
  const headset = new THREE.Group();

  // Conchas (cor de destaque) + tampa externa escura
  for (const side of [-1, 1]) {
    addBox(headset, accentMat, 0.08, 0.22, 0.22, cx + side * (hw + 0.04), cy, cz);
    addBox(headset, darkMat, 0.03, 0.14, 0.14, cx + side * (hw + 0.095), cy, cz);
    // Haste vertical ligando a concha ao arco
    const stemH = Math.max(hh - 0.06, 0.06);
    addBox(headset, darkMat, 0.05, stemH, 0.08, cx + side * (hw + 0.035), cy + 0.11 + stemH / 2 - 0.02, cz - 0.02);
  }

  // Arco superior
  addBox(headset, darkMat, hw * 2 + 0.12, 0.06, 0.1, cx, cy + hh + 0.03, cz - 0.02);
  // Almofada colorida no topo do arco
  addBox(headset, accentMat, hw * 1.1, 0.03, 0.08, cx, cy + hh + 0.07, cz - 0.02);

  // Microfone (lado direito do mascote = -X quando ele olha para +Z)
  const micSide = -1;
  addBox(headset, darkMat, 0.03, 0.03, hd * 0.95, cx + micSide * (hw + 0.06), cy - 0.08, cz + hd * 0.48);
  addBox(headset, accentMat, 0.07, 0.07, 0.07, cx + micSide * (hw + 0.02), cy - 0.08, cz + hd * 0.98);

  parent.add(headset);
  return headset;
}

// --- MASCOTES ---

function buildPenguin(body, feet, m, accentMat) {
  const black = m('#1b1f27');
  const white = m('#f8fafc');
  const orange = m('#f59e0b');
  const dark = m('#111827');

  // Patinhas
  feet.push(addBox(feet.parentGroup, orange, 0.22, 0.08, 0.3, -0.15, 0.04, 0.06));
  feet.push(addBox(feet.parentGroup, orange, 0.22, 0.08, 0.3, 0.15, 0.04, 0.06));

  // Corpo arredondado (camadas de blocos)
  addBox(body, black, 0.66, 0.72, 0.56, 0, 0.44, 0);
  addBox(body, black, 0.74, 0.5, 0.5, 0, 0.44, 0);
  addBox(body, black, 0.6, 0.6, 0.64, 0, 0.44, 0);
  // Barriga branca
  addBox(body, white, 0.46, 0.52, 0.04, 0, 0.42, 0.33);
  // Asinhas
  addBox(body, black, 0.1, 0.42, 0.3, -0.41, 0.48, 0);
  addBox(body, black, 0.1, 0.42, 0.3, 0.41, 0.48, 0);

  // Cabeça
  const hy = 1.04;
  addBox(body, black, 0.56, 0.48, 0.52, 0, hy, 0);
  addBox(body, white, 0.42, 0.28, 0.04, 0, hy - 0.04, 0.27);
  // Olhos
  addBox(body, dark, 0.08, 0.11, 0.02, -0.1, hy + 0.02, 0.295);
  addBox(body, dark, 0.08, 0.11, 0.02, 0.1, hy + 0.02, 0.295);
  addBox(body, white, 0.03, 0.03, 0.01, -0.08, hy + 0.05, 0.306);
  addBox(body, white, 0.03, 0.03, 0.01, 0.12, hy + 0.05, 0.306);
  // Bico
  addBox(body, orange, 0.18, 0.08, 0.16, 0, hy - 0.1, 0.33);

  addHeadset(body, accentMat, dark, 0, hy, 0, 0.28, 0.24, 0.26);
  return 1.4; // altura para a plaquinha de nome
}

function buildDuck(body, feet, m, accentMat) {
  const yellow = m('#facc15');
  const yellowDark = m('#eab308');
  const orange = m('#f97316');
  const dark = m('#111827');
  const white = m('#ffffff');

  feet.push(addBox(feet.parentGroup, orange, 0.24, 0.06, 0.3, -0.16, 0.03, 0.08));
  feet.push(addBox(feet.parentGroup, orange, 0.24, 0.06, 0.3, 0.16, 0.03, 0.08));

  // Corpo de patinho de borracha
  addBox(body, yellow, 0.72, 0.52, 0.78, 0, 0.34, -0.02);
  addBox(body, yellow, 0.62, 0.42, 0.88, 0, 0.36, -0.02);
  // Rabinho levantado
  addBox(body, yellow, 0.34, 0.2, 0.2, 0, 0.56, -0.48);
  // Asas
  addBox(body, yellowDark, 0.08, 0.28, 0.46, -0.39, 0.4, -0.04);
  addBox(body, yellowDark, 0.08, 0.28, 0.46, 0.39, 0.4, -0.04);

  // Cabeça
  const hy = 0.88, hz = 0.14;
  addBox(body, yellow, 0.5, 0.48, 0.48, 0, hy, hz);
  // Bico largo para frente
  addBox(body, orange, 0.42, 0.09, 0.26, 0, hy - 0.08, hz + 0.34);
  addBox(body, m('#ea580c'), 0.36, 0.05, 0.2, 0, hy - 0.15, hz + 0.31);
  // Olhos
  addBox(body, white, 0.1, 0.12, 0.02, -0.12, hy + 0.06, hz + 0.245);
  addBox(body, white, 0.1, 0.12, 0.02, 0.12, hy + 0.06, hz + 0.245);
  addBox(body, dark, 0.06, 0.08, 0.02, -0.12, hy + 0.05, hz + 0.255);
  addBox(body, dark, 0.06, 0.08, 0.02, 0.12, hy + 0.05, hz + 0.255);
  // Topete de blocos
  addBox(body, yellow, 0.1, 0.12, 0.1, 0, hy + 0.3, hz + 0.04);
  addBox(body, yellow, 0.08, 0.16, 0.08, -0.06, hy + 0.33, hz - 0.06);
  addBox(body, yellow, 0.07, 0.1, 0.07, 0.07, hy + 0.29, hz - 0.02);

  addHeadset(body, accentMat, dark, 0, hy, hz, 0.25, 0.24, 0.24);
  return 1.45;
}

function buildPython(body, feet, m, accentMat) {
  const blue = m('#3776ab');
  const yellow = m('#ffd43b');
  const dark = m('#111827');
  const white = m('#ffffff');

  // Espiral (anel em camadas alternando azul / amarelo)
  addBox(body, blue, 0.8, 0.2, 0.8, 0, 0.1, 0);
  addBox(body, yellow, 0.64, 0.2, 0.64, 0, 0.3, 0);
  addBox(body, blue, 0.48, 0.2, 0.48, 0, 0.5, 0);
  // Pescoço com barriga amarela
  addBox(body, blue, 0.3, 0.3, 0.28, 0, 0.72, 0.04);
  addBox(body, yellow, 0.2, 0.28, 0.03, 0, 0.72, 0.19);

  // Cauda baixa saindo por trás (anima como "pés")
  feet.push(addBox(feet.parentGroup, yellow, 0.18, 0.12, 0.3, 0.12, 0.06, -0.52));
  feet.push(addBox(feet.parentGroup, blue, 0.12, 0.09, 0.22, 0.2, 0.045, -0.74));

  // Cabeça carismática
  const hy = 1.0, hz = 0.1;
  addBox(body, blue, 0.6, 0.42, 0.56, 0, hy, hz);
  addBox(body, blue, 0.5, 0.12, 0.2, 0, hy - 0.12, hz + 0.32); // focinho
  // Óculos de dev (armação) + olhos expressivos
  for (const side of [-1, 1]) {
    addBox(body, dark, 0.22, 0.22, 0.02, side * 0.14, hy + 0.04, hz + 0.285);
    addBox(body, white, 0.16, 0.16, 0.02, side * 0.14, hy + 0.04, hz + 0.3);
    addBox(body, dark, 0.07, 0.1, 0.02, side * 0.12, hy + 0.03, hz + 0.315);
    addBox(body, white, 0.025, 0.025, 0.01, side * 0.1, hy + 0.07, hz + 0.327);
  }
  addBox(body, dark, 0.08, 0.03, 0.02, 0, hy + 0.06, hz + 0.29); // ponte dos óculos
  // Linguinha
  addBox(body, m('#ef4444'), 0.06, 0.02, 0.14, 0, hy - 0.15, hz + 0.47);

  addHeadset(body, accentMat, dark, 0, hy, hz, 0.3, 0.21, 0.28);
  return 1.45;
}

function buildOctocat(body, feet, m, accentMat) {
  const fur = m('#24292f');
  const face = m('#fde2c8');
  const dark = m('#0d1117');
  const pink = m('#f472b6');

  // Tentáculos na base (posicionados em leque)
  const tentacleAngles = [-0.9, -0.3, 0.3, 0.9, Math.PI];
  tentacleAngles.forEach((a) => {
    const pivot = new THREE.Group();
    pivot.rotation.y = a;
    addBox(pivot, fur, 0.12, 0.1, 0.3, 0, 0.05, 0.28);
    addBox(pivot, fur, 0.08, 0.08, 0.1, 0, 0.1, 0.44); // pontinha curvada
    feet.parentGroup.add(pivot);
    feet.push(pivot);
  });

  // Corpinho
  addBox(body, fur, 0.56, 0.42, 0.46, 0, 0.33, 0);
  // Cabeça grande
  const hy = 0.82;
  addBox(body, fur, 0.72, 0.56, 0.58, 0, hy, 0);
  // Orelhas pontudas
  for (const side of [-1, 1]) {
    addBox(body, fur, 0.2, 0.12, 0.16, side * 0.24, hy + 0.34, -0.02);
    addBox(body, fur, 0.1, 0.1, 0.1, side * 0.26, hy + 0.45, -0.02);
    addBox(body, pink, 0.08, 0.06, 0.02, side * 0.24, hy + 0.34, 0.065);
  }
  // Rosto claro
  addBox(body, face, 0.56, 0.34, 0.04, 0, hy - 0.05, 0.3);
  addBox(body, dark, 0.08, 0.13, 0.02, -0.13, hy - 0.01, 0.325);
  addBox(body, dark, 0.08, 0.13, 0.02, 0.13, hy - 0.01, 0.325);
  addBox(body, pink, 0.06, 0.04, 0.02, 0, hy - 0.11, 0.325);

  addHeadset(body, accentMat, dark, 0, hy, 0, 0.36, 0.28, 0.29);
  return 1.55;
}

const MASCOT_BUILDERS = {
  penguin: buildPenguin,
  duck: buildDuck,
  python: buildPython,
  octocat: buildOctocat,
};

/**
 * Constrói um mascote voxel. Retorna um THREE.Group com userData:
 *  - body: grupo que balança (waddle) e pula
 *  - feet: partes que alternam passos
 *  - accentMat: material do headset (troca de cor sem reconstruir)
 *  - height: altura aproximada (para posicionar a plaquinha)
 */
export function createMascotMesh(species, accentColor) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const m = makeMaterialFactory();
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.25,
    roughness: 0.4,
    flatShading: true,
  });

  const feet = [];
  feet.parentGroup = root;

  const builder = MASCOT_BUILDERS[species] || buildPenguin;
  const height = builder(body, feet, m, accentMat);

  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  root.userData = { body, feet, accentMat, height, species };
  return root;
}

export function disposeObject(obj) {
  obj.traverse((child) => {
    if (child.isMesh || child.isSprite) {
      child.geometry?.dispose();
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach((mat) => {
        mat?.map?.dispose();
        mat?.dispose();
      });
    }
  });
}
