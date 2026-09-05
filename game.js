// =====================================================
//  game.js — Train Runner 🚂
//  First-Person Endless Runner · Three.js r128
// =====================================================
"use strict";

// ─── RENDERER ────────────────────────────────────────
const CANVAS   = document.getElementById('c');
const RENDERER = new THREE.WebGLRenderer({ canvas: CANVAS, antialias: true });
RENDERER.setPixelRatio(Math.min(devicePixelRatio, 2));
RENDERER.setSize(innerWidth, innerHeight);
RENDERER.shadowMap.enabled = true;

// ─── SCENE ───────────────────────────────────────────
const SCENE = new THREE.Scene();
SCENE.background = new THREE.Color(0x05050f);
SCENE.fog = new THREE.FogExp2(0x05050f, 0.028);

// ─── CAMERA (= the player) ───────────────────────────
const CAM = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.1, 300);
CAM.position.set(0, 1.8, 0);
CAM.rotation.x = -0.04;

// ─── LIGHTS ──────────────────────────────────────────
SCENE.add(new THREE.AmbientLight(0x223366, 1.0));

const sun = new THREE.DirectionalLight(0x9999cc, 0.45);
sun.position.set(0, 30, -20);
SCENE.add(sun);

const neonL = new THREE.PointLight(0x00ffff, 2.2, 20);
const neonR = new THREE.PointLight(0xff00cc, 2.2, 20);
SCENE.add(neonL, neonR);

// ─── CONSTANTS ───────────────────────────────────────
const LANES      = [-2.2, 0, 2.2];   // lane X positions
const ROAD_W     = 8;                 // road width (world units)
const TILE_LEN   = 14;               // ground tile length
const TILE_N     = 14;               // # of recycled tiles
const EYE_H      = 1.8;              // camera Y on ground
const JUMP_VEL   = 7.2;             // initial jump speed (m/s)
const GRAVITY    = -21;             // gravity (m/s²)
const SPAWN_Z    = -75;             // spawn distance ahead
const DESPAWN_Z  = 7;               // remove when N units behind

// ─── MATERIALS ───────────────────────────────────────
const MAT = {
  ground:    new THREE.MeshLambertMaterial({ color: 0x888888 }),
  groundAlt: new THREE.MeshLambertMaterial({ color: 0x777777 }),
  line:      new THREE.MeshBasicMaterial ({ color: 0xffffff  }),
  rail:      new THREE.MeshLambertMaterial({ color: 0xaaaaaa }),
  tie:       new THREE.MeshLambertMaterial({ color: 0x5a3e28 }),
  bldg: [
    new THREE.MeshLambertMaterial({ color: 0x0a0a20 }),
    new THREE.MeshLambertMaterial({ color: 0x0d1520 }),
    new THREE.MeshLambertMaterial({ color: 0x15100a }),
    new THREE.MeshLambertMaterial({ color: 0x0a1510 }),
  ],
  win:  new THREE.MeshBasicMaterial({ color: 0xffdd88 }),
  winB: new THREE.MeshBasicMaterial({ color: 0x88aaff }),
};

// ─── GAME STATE ──────────────────────────────────────
const G = {
  running: false,
  score:   0,
  lives:   3,
  lane:    1,        // 0=left  1=center  2=right
  targetX: 0,
  speed:   10,       // m/s forward
  camZ:    0,
  camY:    EYE_H,
  velY:    0,
  jumping: false,
  hitCD:   0,        // hit cooldown seconds
  spawnT:  0,
  spawnR:  2.3,      // spawn interval
  time:    0,
  best:    getBest(),
};

function getBest() {
  try { return +(localStorage.getItem('trBest') || 0); } catch { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem('trBest', v); } catch {}
}

// ─── GROUND TILES  (recycled) ────────────────────────
const tiles = [];

function makeTile(i) {
  const g = new THREE.Group();
  g.position.z = -i * TILE_LEN;

  // Base gray slab
  const base = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, TILE_LEN), MAT.ground);
  base.rotation.x = -Math.PI / 2;
  base.position.y = -0.02;
  g.add(base);

  // Alternating center strip for visual depth
  if (i % 2 === 0) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W * 0.38, TILE_LEN), MAT.groundAlt);
    strip.rotation.x = -Math.PI / 2;
    strip.position.y = -0.01;
    g.add(strip);
  }

  // Dashed lane dividers
  const DASHES = 6;
  [-1.1, 1.1].forEach(lx => {
    for (let d = 0; d < DASHES; d++) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 1.3), MAT.line);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(lx, 0.01, TILE_LEN / 2 - 1 - d * (TILE_LEN / DASHES));
      g.add(dash);
    }
  });

  // Edge solid lines
  [-ROAD_W / 2, ROAD_W / 2].forEach(ex => {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.11, TILE_LEN), MAT.line);
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(ex, 0.01, 0);
    g.add(edge);
  });

  // Rails (center)
  [-0.55, 0.55].forEach(rx => {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, TILE_LEN), MAT.rail);
    rail.position.set(rx, 0.05, 0);
    g.add(rail);
  });

  // Sleepers / ties
  for (let t = 0; t < 7; t++) {
    const tie = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.07, 0.13), MAT.tie);
    tie.position.set(0, 0.03, TILE_LEN / 2 - 1 - t * (TILE_LEN / 7));
    g.add(tie);
  }

  SCENE.add(g);
  tiles.push(g);
}

for (let i = 0; i < TILE_N; i++) makeTile(i);

// ─── CITY BUILDINGS ──────────────────────────────────
function makeBuilding(x, z, w, h, d) {
  const mat = MAT.bldg[Math.floor(Math.random() * MAT.bldg.length)];
  const bld = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  bld.position.set(x, h / 2, z);
  SCENE.add(bld);

  // Windows
  const wRows = Math.floor(h / 2.8);
  const wCols = Math.floor(w / 2);
  const fz    = x > 0 ? -(d / 2 + 0.01) : (d / 2 + 0.01);

  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      if (Math.random() < 0.55) {
        const wm  = Math.random() < 0.2 ? MAT.winB : MAT.win;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), wm);
        win.position.set(
          x + (c - wCols / 2 + 0.5) * 1.6,
          r * 2.5 + 1,
          z + fz
        );
        win.rotation.y = x > 0 ? 0 : Math.PI;
        SCENE.add(win);
      }
    }
  }
}

for (let i = 0; i < 55; i++) {
  const side = i % 2 === 0 ? 1 : -1;
  const h = 8 + Math.random() * 38;
  makeBuilding(
    side * (12 + Math.random() * 32),
    -4 - Math.random() * 190,
    4 + Math.random() * 10,
    h,
    4 + Math.random() * 9
  );
}

// ─── STARS ───────────────────────────────────────────
{
  const pos = new Float32Array(800 * 3);
  for (let i = 0; i < 800; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 550;
    pos[i * 3 + 1] = 20 + Math.random() * 90;
    pos[i * 3 + 2] = -Math.random() * 290;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  SCENE.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22 })));
}

// ─── OBSTACLES ───────────────────────────────────────
const obstacles = [];

const TRAIN_COLORS = [
  new THREE.MeshLambertMaterial({ color: 0x1a1a1a }),
  new THREE.MeshLambertMaterial({ color: 0x8B0000 }),
  new THREE.MeshLambertMaterial({ color: 0x003377 }),
  new THREE.MeshLambertMaterial({ color: 0x1a3300 }),
];
const WAGON_COLORS = [
  new THREE.MeshLambertMaterial({ color: 0xaa0000 }),
  new THREE.MeshLambertMaterial({ color: 0x005500 }),
  new THREE.MeshLambertMaterial({ color: 0x000099 }),
  new THREE.MeshLambertMaterial({ color: 0x995500 }),
];

function spawnTrain(forceLane) {
  const lane = forceLane !== undefined ? forceLane : Math.floor(Math.random() * 3);
  const grp  = new THREE.Group();

  // Locomotive body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.2, 3.3),
    TRAIN_COLORS[Math.floor(Math.random() * TRAIN_COLORS.length)]
  );
  grp.add(body);

  // Chimney
  const chim = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.15, 0.55, 8),
    new THREE.MeshLambertMaterial({ color: 0x111111 })
  );
  chim.position.set(-0.3, 1.38, -0.75);
  grp.add(chim);

  // Steam dome
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x333333 })
  );
  dome.position.set(0, 1.12, -0.2);
  grp.add(dome);

  // Wheels
  const wGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.1, 10);
  const wMat = new THREE.MeshLambertMaterial({ color: 0x222222 });
  [[-0.8, -0.85], [0.8, -0.85], [-0.8, 0.65], [0.8, 0.65]].forEach(([wx, wz]) => {
    const w = new THREE.Mesh(wGeo, wMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, -0.98, wz);
    grp.add(w);
  });

  // Headlights
  const hlGeo = new THREE.SphereGeometry(0.15, 8, 8);
  const hlMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
  [-0.44, 0.44].forEach(hx => {
    const hl = new THREE.Mesh(hlGeo, hlMat);
    hl.position.set(hx, -0.25, 1.65);
    grp.add(hl);
  });
  const hLight = new THREE.PointLight(0xffffaa, 4, 9);
  hLight.position.set(0, -0.25, 1.75);
  grp.add(hLight);

  // Wagon
  const wag = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 1.85, 2.6),
    WAGON_COLORS[Math.floor(Math.random() * WAGON_COLORS.length)]
  );
  wag.position.z = -3.6;
  grp.add(wag);

  // Wagon wheels
  [[-0.77, -3.2], [0.77, -3.2], [-0.77, -4.0], [0.77, -4.0]].forEach(([wx, wz]) => {
    const w = new THREE.Mesh(wGeo, wMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, -0.82, wz);
    grp.add(w);
  });

  grp.position.set(LANES[lane], 1.1, G.camZ + SPAWN_Z);
  grp.userData.lane = lane;
  SCENE.add(grp);
  obstacles.push(grp);
}

// ─── INPUT ───────────────────────────────────────────
let tx0 = 0, ty0 = 0;

window.addEventListener('keydown', e => {
  if (!G.running) return;
  if (e.code === 'ArrowLeft'  || e.code === 'KeyA') { shiftLane(-1); }
  if (e.code === 'ArrowRight' || e.code === 'KeyD') { shiftLane( 1); }
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
    doJump(); e.preventDefault();
  }
});

window.addEventListener('touchstart', e => {
  tx0 = e.touches[0].clientX;
  ty0 = e.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchend', e => {
  if (!G.running) return;
  const dx = e.changedTouches[0].clientX - tx0;
  const dy = e.changedTouches[0].clientY - ty0;
  if (Math.abs(dx) > Math.abs(dy)) {
    if (Math.abs(dx) > 22) shiftLane(dx > 0 ? 1 : -1);
  } else if (dy < -22) doJump();
}, { passive: true });

function shiftLane(dir) {
  const next = G.lane + dir;
  if (next >= 0 && next < 3) {
    G.lane    = next;
    G.targetX = LANES[next];
  }
}

function doJump() {
  if (!G.jumping) {
    G.jumping = true;
    G.velY    = JUMP_VEL;
  }
}

// ─── HUD REFS ────────────────────────────────────────
const $score  = document.getElementById('score');
const $hearts = document.querySelectorAll('#hearts span');
const $fill   = document.getElementById('speed-fill');
const $final  = document.getElementById('final-score');
const $best   = document.getElementById('best-score');

function refreshHUD() {
  $score.textContent = Math.floor(G.score);
  $hearts.forEach((h, i) => {
    h.style.opacity = i < G.lives ? '1' : '0.15';
    h.style.filter  = i < G.lives ? '' : 'grayscale(1)';
  });
  const pct = Math.min(100, ((G.speed - 10) / 22) * 100);
  $fill.style.width = Math.max(4, pct) + '%';
  document.body.classList.toggle('fast', G.speed > 22);
}

// ─── GAME EVENTS ─────────────────────────────────────
function onHit() {
  G.hitCD = 1.4;
  G.lives--;
  refreshHUD();
  document.body.classList.remove('hit');
  void document.body.offsetWidth; // reflow to restart animation
  document.body.classList.add('hit');
  if (G.lives <= 0) setTimeout(onGameOver, 420);
}

function onGameOver() {
  G.running = false;
  const sc = Math.floor(G.score);
  if (sc > G.best) { G.best = sc; saveBest(sc); }
  $final.textContent = sc;
  $best.textContent  = G.best;
  document.getElementById('gameover').classList.remove('hidden');
  document.getElementById('hud').classList.add('hidden');
}

function startGame() {
  Object.assign(G, {
    running: true, score: 0, lives: 3,
    lane: 1, targetX: LANES[1],
    speed: 10, camZ: 0, camY: EYE_H,
    velY: 0, jumping: false,
    hitCD: 0, spawnT: 0, spawnR: 2.3, time: 0,
  });
  CAM.position.set(0, EYE_H, 0);
  obstacles.forEach(o => SCENE.remove(o));
  obstacles.length = 0;
  document.getElementById('start').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  refreshHUD();
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-restart').addEventListener('click', startGame);

// ─── MAIN LOOP ───────────────────────────────────────
let prevT = 0;

function loop(ts) {
  requestAnimationFrame(loop);

  const dt = Math.min((ts - prevT) / 1000, 0.05);
  prevT = ts;

  if (!G.running) {
    RENDERER.render(SCENE, CAM);
    return;
  }

  G.time += dt;

  // ── Forward movement ──
  G.camZ -= G.speed * dt;
  CAM.position.z = G.camZ;

  // ── Lane change (smooth lerp) ──
  CAM.position.x += (G.targetX - CAM.position.x) * Math.min(1, 13 * dt);

  // ── Jump physics ──
  if (G.jumping) {
    G.velY  += GRAVITY * dt;
    G.camY  += G.velY * dt;
    if (G.camY <= EYE_H) {
      G.camY  = EYE_H;
      G.velY  = 0;
      G.jumping = false;
    }
  } else {
    // Running head-bob
    G.camY = EYE_H + Math.sin(G.time * 9) * 0.04;
  }
  CAM.position.y = G.camY;

  // ── Recycle ground tiles ──
  tiles.forEach(t => {
    if (t.position.z > G.camZ + TILE_LEN) {
      t.position.z -= TILE_N * TILE_LEN;
    }
  });

  // ── Spawn obstacles ──
  G.spawnT -= dt;
  if (G.spawnT <= 0) {
    // Occasionally spawn 2 lanes blocked (forces jump or tight dodge)
    if (Math.random() < 0.18 && G.time > 20) {
      const a = Math.floor(Math.random() * 3);
      const b = (a + 1) % 3;
      spawnTrain(a);
      spawnTrain(b);
    } else {
      spawnTrain();
    }
    G.spawnT  = G.spawnR;
    G.spawnR  = Math.max(0.82, G.spawnR - 0.022);
  }

  // ── Obstacle update & collision ──
  G.hitCD -= dt;

  for (let i = obstacles.length - 1; i >= 0; i--) {
    const obs = obstacles[i];

    if (obs.position.z > G.camZ + DESPAWN_Z) {
      SCENE.remove(obs);
      obstacles.splice(i, 1);
      continue;
    }

    if (G.hitCD <= 0) {
      const dx = Math.abs(obs.position.x - CAM.position.x);
      const dz = Math.abs(obs.position.z - G.camZ);
      // Allow jumping over (train top ≈ obs.y+1.1 = 2.2; max jump ≈ 2.9)
      const aboveTrain = CAM.position.y > obs.position.y + 1.3;
      if (dx < 1.05 && dz < 2.3 && !aboveTrain) {
        SCENE.remove(obs);
        obstacles.splice(i, 1);
        onHit();
      }
    }
  }

  // ── Score & speed ──
  G.score  += G.speed * dt;
  G.speed   = Math.min(32, 10 + G.time * 0.38);

  // ── Neon lights follow player ──
  neonL.position.set(G.targetX - 4, 2.5, G.camZ - 9);
  neonR.position.set(G.targetX + 4, 2.5, G.camZ - 9);

  refreshHUD();
  RENDERER.render(SCENE, CAM);
}

// ─── RESIZE ──────────────────────────────────────────
window.addEventListener('resize', () => {
  CAM.aspect = innerWidth / innerHeight;
  CAM.updateProjectionMatrix();
  RENDERER.setSize(innerWidth, innerHeight);
});

// ─── BOOT ────────────────────────────────────────────
requestAnimationFrame(loop);
