// ─── Constants ───────────────────────────────────────────────────────────────
let HEX_RADIUS = 3;  // hex grid radius (configurable) — edge length = R+1
const TILE_EMPTY     = 0;
const TILE_WALL      = 1;
const TILE_HILL      = 2; // range 4  (low)
const TILE_HILL_MED  = 3; // range 6  (medium)
const TILE_HILL_TALL = 4; // range 8  (tall)

const OWNER_NONE = 0;
const NUM_PLAYERS = 6;
const PLAYERS = [1, 2, 3, 4, 5, 6];

// Player color theme: tint, stroke, badge, CSS label, short name
const PLAYER_COLORS = {
  1: { tint:'rgba(60,110,230,0.22)',  stroke:'rgba(80,150,255,0.55)',  badge:'#1840a0', css:'#3b82f6', name:'Blue' },
  2: { tint:'rgba(220,50,50,0.22)',   stroke:'rgba(255,80,80,0.55)',   badge:'#961818', css:'#ef4444', name:'Red' },
  3: { tint:'rgba(40,180,80,0.22)',   stroke:'rgba(60,220,100,0.55)',  badge:'#167034', css:'#22c55e', name:'Green' },
  4: { tint:'rgba(220,200,40,0.22)',  stroke:'rgba(250,230,60,0.55)',  badge:'#8a7a10', css:'#eab308', name:'Yellow' },
  5: { tint:'rgba(160,60,220,0.22)',  stroke:'rgba(190,100,250,0.55)', badge:'#6a2890', css:'#a855f7', name:'Purple' },
  6: { tint:'rgba(240,140,40,0.22)',  stroke:'rgba(255,170,60,0.55)',  badge:'#a06010', css:'#f97316', name:'Orange' },
};

const BASE_RANGE = 2;
const isHillType     = t => t === TILE_HILL || t === TILE_HILL_MED || t === TILE_HILL_TALL;
const hillRange      = t => t === TILE_HILL_TALL ? 8 : t === TILE_HILL_MED ? 6 : 4;
const hillVisibility = t => t === TILE_HILL_TALL ? 3 : t === TILE_HILL_MED ? 2 : 1;
const getTileRange   = tile => isHillType(tile.type) ? hillRange(tile.type) : BASE_RANGE;
const MAX_TROOPS              = 10;
const FORTIFICATION_MISS_CHANCE = 0.5;
const SPAWN_TURNS             = 3;
const STORM_DAMAGE            = 2;
const ZOOM_MIN  = 0.3;
const ZOOM_MAX  = 6;
const ZOOM_STEP = 0.15;
const HEX_DIRS = [[0,-1],[1,-1],[1,0],[0,1],[-1,1],[-1,0]];

// ─── State ────────────────────────────────────────────────────────────────────
let tiles         = new Map();
let plans         = {};
let phase         = 'p1';
let turnNum       = 1;
let selected      = null;
let pendingAction = null;
let eventLog      = [];
let validMoveTiles = new Set();
let validAtkTiles  = new Set();
let tooltipTile   = null;
let zoomLevel     = 1;

// Per-player AI difficulty: 'human' | 'easy' | 'medium' | 'hard' | 'off'
let aiDifficulties = { 1:'human', 2:'human', 3:'off', 4:'off', 5:'off', 6:'off' };
let aiVsAiPaused   = false;
let aiVsAiTimerId  = null;
const AI_VS_AI_DELAY = 900;

let cursor        = null;
let preResolveTroops = {};
let panX = 0, panY = 0;
let revealedTiles = {};
let turnOrder     = [];
let planIndex     = 0;
let gameJustStarted = true;

let canvas, ctx, hexSize;
let audioCtx = null;

// ─── Player helpers ───────────────────────────────────────────────────────────
function phaseOwner()           { return parseInt(phase.slice(1)); }
function ownerPhase(o)          { return 'p' + o; }
function isPlayerActive(p)      { return aiDifficulties[p] !== 'off'; }
function isPlayerAI(p)          { return isPlayerActive(p) && aiDifficulties[p] !== 'human'; }
function isPlayerHuman(p)       { return aiDifficulties[p] === 'human'; }
function isPlayerAlive(p) {
  if (!isPlayerActive(p)) return false;
  for (const tile of tiles.values())
    if (tile.owner === p && tile.troops > 0) return true;
  return false;
}
function getActivePlayers()     { return PLAYERS.filter(isPlayerActive); }
function getAlivePlayers()      { return PLAYERS.filter(isPlayerAlive); }
function isSpectateMode() {
  const alive = getAlivePlayers();
  return alive.length === 0 || alive.every(p => isPlayerAI(p));
}
function resetPlans()           { plans = {}; PLAYERS.forEach(p => plans[p] = []); }
function resetRevealedTiles()   { revealedTiles = {}; PLAYERS.forEach(p => revealedTiles[p] = new Set()); }

// ─── Audio ────────────────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playSound(type) {
  try {
    const ac   = getAudioCtx();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    if (type === 'select') {
      osc.frequency.setValueAtTime(660, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ac.currentTime + 0.08);
      gain.gain.setValueAtTime(0.1, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.12);
      osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.12);
    } else if (type === 'attack') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(55, ac.currentTime + 0.22);
      gain.gain.setValueAtTime(0.25, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);
      osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.28);
    } else if (type === 'move') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(330, ac.currentTime);
      osc.frequency.linearRampToValueAtTime(500, ac.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
      osc.start(ac.currentTime); osc.stop(ac.currentTime + 0.15);
    }
  } catch (_e) { /* audio unavailable */ }
}

// ─── Hex Geometry ─────────────────────────────────────────────────────────────
function hexKey(q, r)  { return `${q},${r}`; }
function decodeKey(k)  { const [q, r] = k.split(',').map(Number); return { q, r }; }

function allHexes() {
  const res = [];
  for (let q = -HEX_RADIUS; q <= HEX_RADIUS; q++)
    for (let r = Math.max(-HEX_RADIUS, -q - HEX_RADIUS); r <= Math.min(HEX_RADIUS, -q + HEX_RADIUS); r++)
      res.push([q, r]);
  return res;
}

function hexDist(q1, r1, q2, r2) {
  return Math.max(Math.abs(q1 - q2), Math.abs(r1 - r2), Math.abs((q1 + r1) - (q2 + r2)));
}

function hexNeighbors(q, r) {
  return HEX_DIRS.map(([dq, dr]) => [q + dq, r + dr]).filter(([nq, nr]) => tiles.has(hexKey(nq, nr)));
}
function hexNeighborsAll(q, r) {
  return HEX_DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

function hexToPixel(q, r) {
  return {
    x: hexSize * (3 / 2) * q,
    y: hexSize * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r),
  };
}

function pixelToHex(px, py) {
  const q = (2 / 3 * px) / hexSize;
  const r = (-1 / 3 * px + Math.sqrt(3) / 3 * py) / hexSize;
  return hexRound(q, r);
}

function hexRound(fq, fr) {
  const fs = -fq - fr;
  let q = Math.round(fq), r = Math.round(fr), s = Math.round(fs);
  const dq = Math.abs(q - fq), dr = Math.abs(r - fr), ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds)        r = -q - s;
  return { q, r };
}

function hexPath(cx, cy, s) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i;
    const x = cx + s * Math.cos(angle);
    const y = cy + s * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  buildPlayerHUD();
  buildAIControls();

  window.addEventListener('resize', () => { resizeCanvas(); render(); });
  canvas.addEventListener('pointerdown', onCanvasClick);
  canvas.addEventListener('mousemove',   onCanvasHover);
  canvas.addEventListener('mouseleave',  onCanvasLeave);
  canvas.addEventListener('wheel',       onCanvasWheel, { passive: false });
  initTouchZoom();
  initMousePan();
  initMobileUI();
  document.getElementById('btn-move').addEventListener('click',   onBtnMove);
  document.getElementById('btn-attack').addEventListener('click', onBtnAttack);
  document.getElementById('btn-cancel').addEventListener('click', onBtnCancel);
  document.getElementById('btn-undo').addEventListener('click',   onBtnUndo);
  document.getElementById('btn-done').addEventListener('click',   onBtnDone);
  document.getElementById('pass-btn').addEventListener('click',   onPassReady);
  document.getElementById('new-game-btn').addEventListener('click',     newGame);
  document.getElementById('new-game-win-btn').addEventListener('click', newGame);
  document.getElementById('ai-vs-ai-pause').addEventListener('click', toggleAiVsAiPause);

  const mapSlider = document.getElementById('map-size-slider');
  const mapLabel  = document.getElementById('map-size-value');
  mapSlider.addEventListener('input', () => { mapLabel.textContent = mapSlider.value; });
  mapSlider.addEventListener('change', () => {
    const edgeLen = parseInt(mapSlider.value, 10);
    HEX_RADIUS = edgeLen - 1;
    newGame();
  });

  document.addEventListener('keydown', onKeyDown);

  newGame();
}

function buildPlayerHUD() {
  const container = document.getElementById('player-hud');
  container.innerHTML = '';
  for (const p of PLAYERS) {
    const div = document.createElement('div');
    div.className = 'phud-item';
    div.id = `phud-${p}`;
    div.innerHTML =
      `<span class="phud-dot" style="background:${PLAYER_COLORS[p].css}"></span>` +
      `<span class="phud-name" style="color:${PLAYER_COLORS[p].css}">P${p}</span>` +
      `<span class="phud-tiles" id="phud-tiles-${p}">0</span>`;
    container.appendChild(div);
  }
}

function buildAIControls() {
  const container = document.getElementById('ai-difficulty-control');
  container.innerHTML = '';
  for (const p of PLAYERS) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ai-ctrl-row';
    const label = document.createElement('label');
    label.setAttribute('for', `ai-select-${p}`);
    label.className = 'ai-ctrl-label';
    label.style.color = PLAYER_COLORS[p].css;
    label.textContent = `P${p}`;
    const select = document.createElement('select');
    select.id = `ai-select-${p}`;
    select.className = 'ai-ctrl-select';
    const options = [
      { value: 'human',  text: 'Human' },
      { value: 'easy',   text: 'AI Easy' },
      { value: 'medium', text: 'AI Medium' },
      { value: 'hard',   text: 'AI Hard' },
      { value: 'off',    text: 'Off' },
    ];
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.text;
      if (opt.value === aiDifficulties[p]) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener('change', (e) => {
      aiDifficulties[p] = e.target.value;
      clearTimeout(aiVsAiTimerId);
      updatePhaseLabel();
      updateHUD();
    });
    wrapper.appendChild(label);
    wrapper.appendChild(select);
    container.appendChild(wrapper);
  }
}

// ─── New Game ─────────────────────────────────────────────────────────────────
function newGame() {
  document.getElementById('win-overlay').classList.add('hidden');
  document.getElementById('pass-overlay').classList.add('hidden');
  generateMap();
  turnNum        = 1;
  resetPlans();
  selected       = null;
  pendingAction  = null;
  eventLog       = [];
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  tooltipTile    = null;
  zoomLevel      = 1;
  panX           = 0;
  panY           = 0;
  cursor         = null;
  aiVsAiPaused   = false;
  gameJustStarted = true;
  resetRevealedTiles();
  clearTimeout(aiVsAiTimerId);

  // Set up planning order
  turnOrder = getAlivePlayers();
  planIndex = 0;

  if (isSpectateMode()) {
    phase = ownerPhase(turnOrder[0] || 1);
  } else {
    // Skip leading AIs (auto-plan them)
    while (planIndex < turnOrder.length && isPlayerAI(turnOrder[planIndex])) {
      makeAIPlansFor(turnOrder[planIndex], aiDifficulties[turnOrder[planIndex]]);
      planIndex++;
    }
    if (planIndex < turnOrder.length) {
      phase = ownerPhase(turnOrder[planIndex]);
    } else {
      phase = 'p1';
    }
  }

  resizeCanvas();
  render();
  updateHUD();
  updatePhaseLabel();
  clearLog();
  hideTileInfo();
}

// ─── Map Generation ───────────────────────────────────────────────────────────
function getSpawnPosition(playerNum) {
  const R = HEX_RADIUS;
  const positions = {
    1: { q: -R, r: 0 },          // west
    2: { q: R,  r: 0 },          // east
    3: { q: 0,  r: -R },         // north-west
    4: { q: 0,  r: R },          // south-east
    5: { q: R,  r: -R },         // north-east
    6: { q: -R, r: R },          // south-west
  };
  return positions[playerNum];
}

function generateMap() {
  tiles = new Map();
  for (const [q, r] of allHexes()) {
    const rnd = Math.random();
    let type = TILE_EMPTY;
    if      (rnd < 0.12) type = TILE_WALL;
    else if (rnd < 0.18) type = TILE_HILL;
    else if (rnd < 0.22) type = TILE_HILL_MED;
    else if (rnd < 0.24) type = TILE_HILL_TALL;
    tiles.set(hexKey(q, r), { type, owner: OWNER_NONE, troops: 0, ownedTurns: 0 });
  }

  const clearAround = (q, r) => {
    const t = tiles.get(hexKey(q, r));
    if (t) t.type = TILE_EMPTY;
    if (HEX_RADIUS >= 2) {
      for (const [nq, nr] of hexNeighbors(q, r)) {
        const nt = tiles.get(hexKey(nq, nr));
        if (nt) nt.type = TILE_EMPTY;
      }
    }
  };

  for (const p of PLAYERS) {
    if (!isPlayerActive(p)) continue;
    const sp = getSpawnPosition(p);
    clearAround(sp.q, sp.r);
    const tile = tiles.get(hexKey(sp.q, sp.r));
    if (tile) {
      tile.owner = p;
      tile.troops = 1;
    }
  }
}

// ─── Canvas resize ────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('grid-wrapper');
  const maxW = wrapper.clientWidth;
  const maxH = wrapper.clientHeight;
  const fitSize = Math.min(maxW, maxH);
  const wUnits = 3 * HEX_RADIUS + 2.5;
  const hUnits = Math.sqrt(3) * (2 * HEX_RADIUS + 1);
  const base   = Math.floor(fitSize / Math.max(wUnits, hUnits));
  hexSize = Math.max(4, Math.floor(base * zoomLevel));
  canvas.width  = Math.ceil(hexSize * wUnits * 1.06);
  canvas.height = Math.ceil(hexSize * hUnits * 1.06);
  clampPan();
}

function clampPan() {
  const wrapper = document.getElementById('grid-wrapper');
  const maxPanX = Math.max(0, (canvas.width  - wrapper.clientWidth)  / 2 + hexSize * 2);
  const maxPanY = Math.max(0, (canvas.height - wrapper.clientHeight) / 2 + hexSize * 2);
  panX = Math.max(-maxPanX, Math.min(maxPanX, panX));
  panY = Math.max(-maxPanY, Math.min(maxPanY, panY));
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(flashMoves, flashAttacks) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const originX = canvas.width  / 2 + panX;
  const originY = canvas.height / 2 + panY;

  const currentOwner = phaseOwner();
  const currentPlans = plans[currentOwner] || [];

  const moveFromSet = new Set(), moveToSet  = new Set();
  const atkFromSet  = new Set(), atkToSet   = new Set();

  for (const p of currentPlans) {
    const fk = hexKey(p.from.q, p.from.r);
    const tk = hexKey(p.to.q,   p.to.r);
    if (p.kind === 'move')   { moveFromSet.add(fk); moveToSet.add(tk); }
    if (p.kind === 'attack') { atkFromSet.add(fk);  atkToSet.add(tk);  }
  }

  for (const [q, r] of allHexes()) {
    const { x, y } = hexToPixel(q, r);
    drawHex(q, r, originX + x, originY + y,
            moveFromSet, moveToSet, atkFromSet, atkToSet, flashMoves, flashAttacks);
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth   = 0.8;
  for (const [q, r] of allHexes()) {
    const { x, y } = hexToPixel(q, r);
    hexPath(originX + x, originY + y, hexSize - 0.5);
    ctx.stroke();
  }

  if (tooltipTile) drawTooltip(originX, originY);
}

// ─── Path helper ──────────────────────────────────────────────────────────────
function pathRoundRect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,      y + h, x,       y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y,    x + r, y,       r);
  ctx.closePath();
}

// ─── Terrain drawing ──────────────────────────────────────────────────────────
function drawHexEmpty(cx, cy, s) {
  const g = ctx.createRadialGradient(cx - s * 0.2, cy - s * 0.2, 0, cx, cy, s);
  g.addColorStop(0, '#c8bd9e');
  g.addColorStop(1, '#b4a882');
  hexPath(cx, cy, s);
  ctx.fillStyle = g;
  ctx.fill();
}

function drawHexWall(cx, cy, s) {
  const g = ctx.createRadialGradient(cx - s * 0.15, cy - s * 0.15, s * 0.1, cx, cy, s);
  g.addColorStop(0, '#e2e2e2');
  g.addColorStop(0.4, '#a0a0a0');
  g.addColorStop(1, '#505050');
  hexPath(cx, cy, s);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  hexPath(cx, cy, s);
  ctx.clip();
  const sg = ctx.createLinearGradient(cx, cy - s, cx, cy);
  sg.addColorStop(0, 'rgba(255,255,255,0.30)');
  sg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(cx - s, cy - s, s * 2, s);
  ctx.restore();
}

function drawHexHillLevel(cx, cy, s, tileType) {
  if (tileType === TILE_HILL_TALL) {
    const bg = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s);
    bg.addColorStop(0,   '#a0a89a');
    bg.addColorStop(0.5, '#5a6450');
    bg.addColorStop(1,   '#2a3028');
    hexPath(cx, cy, s); ctx.fillStyle = bg; ctx.fill();
    const sg = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.18, 0, cx, cy, s * 0.42);
    sg.addColorStop(0,   'rgba(255,255,255,0.95)');
    sg.addColorStop(0.45,'rgba(220,232,245,0.55)');
    sg.addColorStop(1,   'rgba(180,195,210,0)');
    hexPath(cx, cy, s); ctx.fillStyle = sg; ctx.fill();
    ctx.fillStyle    = 'rgba(50,45,40,0.88)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.28))}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u25b2\u25b2\u25b2', cx, cy + s * 0.08);
    ctx.fillStyle    = 'rgba(255,255,255,0.72)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.22))}px sans-serif`;
    ctx.fillText('8', cx, cy - s * 0.32);
  } else if (tileType === TILE_HILL_MED) {
    const bg = ctx.createRadialGradient(cx, cy, s * 0.1, cx, cy, s);
    bg.addColorStop(0,   '#2d6025');
    bg.addColorStop(0.6, '#1a3d12');
    bg.addColorStop(1,   '#0e2208');
    hexPath(cx, cy, s); ctx.fillStyle = bg; ctx.fill();
    const mg = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.12, 0, cx, cy, s * 0.55);
    mg.addColorStop(0,   'rgba(175,220,95,0.8)');
    mg.addColorStop(0.5, 'rgba(75,135,50,0.45)');
    mg.addColorStop(1,   'rgba(20,55,10,0)');
    hexPath(cx, cy, s); ctx.fillStyle = mg; ctx.fill();
    const rg = ctx.createRadialGradient(cx, cy - s * 0.18, 0, cx, cy, s * 0.36);
    rg.addColorStop(0,   'rgba(155,145,115,0.42)');
    rg.addColorStop(1,   'rgba(155,145,115,0)');
    hexPath(cx, cy, s); ctx.fillStyle = rg; ctx.fill();
    ctx.fillStyle    = 'rgba(38,68,22,0.92)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.36))}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u25b2\u25b2', cx, cy + s * 0.06);
    ctx.fillStyle    = 'rgba(200,245,145,0.78)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.22))}px sans-serif`;
    ctx.fillText('6', cx, cy - s * 0.3);
  } else {
    const bg = ctx.createRadialGradient(cx, cy, s * 0.1, cx, cy, s);
    bg.addColorStop(0, '#3d7a30');
    bg.addColorStop(1, '#1e4016');
    hexPath(cx, cy, s); ctx.fillStyle = bg; ctx.fill();
    const mg = ctx.createRadialGradient(cx - s * 0.1, cy - s * 0.12, 0, cx, cy, s * 0.6);
    mg.addColorStop(0,   'rgba(210,250,150,0.85)');
    mg.addColorStop(0.5, 'rgba(120,190,75,0.5)');
    mg.addColorStop(1,   'rgba(25,70,15,0)');
    hexPath(cx, cy, s); ctx.fillStyle = mg; ctx.fill();
    ctx.fillStyle    = 'rgba(55,95,35,0.9)';
    ctx.font         = `${Math.max(7, Math.floor(s * 0.5))}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u25b2', cx, cy + s * 0.02);
    ctx.fillStyle    = 'rgba(200,245,145,0.75)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.22))}px sans-serif`;
    ctx.fillText('4', cx, cy - s * 0.3);
  }
}

// ─── Fog of War helpers ───────────────────────────────────────────────────────
function isTileHiddenForViewer(q, r, viewer) {
  if (isSpectateMode()) return false;
  if (!isPlayerAlive(viewer)) return false;
  const tile = tiles.get(hexKey(q, r));
  if (!tile) return false;
  if (tile.owner === OWNER_NONE || tile.owner === viewer) return false;
  if (revealedTiles[viewer] && revealedTiles[viewer].has(hexKey(q, r))) return false;
  for (const [hq, hr] of allHexes()) {
    const ht = tiles.get(hexKey(hq, hr));
    if (!ht || ht.owner !== viewer || ht.troops <= 0) continue;
    if (!isHillType(ht.type)) continue;
    if (hexDist(hq, hr, q, r) <= hillVisibility(ht.type)) return false;
  }
  return true;
}

function isOwnTileSpotted(q, r, owner) {
  if (isSpectateMode()) return false;
  if (!isPlayerAlive(owner)) return false;
  for (const enemy of PLAYERS) {
    if (enemy === owner || !isPlayerActive(enemy)) continue;
    if (revealedTiles[enemy] && revealedTiles[enemy].has(hexKey(q, r))) return true;
    for (const [hq, hr] of allHexes()) {
      const ht = tiles.get(hexKey(hq, hr));
      if (!ht || ht.owner !== enemy || ht.troops <= 0) continue;
      if (!isHillType(ht.type)) continue;
      if (hexDist(hq, hr, q, r) <= hillVisibility(ht.type)) return true;
    }
  }
  return false;
}

// ─── Hex cell drawing ─────────────────────────────────────────────────────────
function drawHex(q, r, cx, cy, moveFromSet, moveToSet, atkFromSet, atkToSet, flashMoves, flashAttacks) {
  const tile = tiles.get(hexKey(q, r));
  if (!tile) return;
  const s = hexSize;
  const k = hexKey(q, r);

  const currentViewer = phaseOwner();
  const hidden = isTileHiddenForViewer(q, r, currentViewer);

  // 1. Base terrain
  if      (tile.type === TILE_WALL)    drawHexWall(cx, cy, s);
  else if (isHillType(tile.type))      drawHexHillLevel(cx, cy, s, tile.type);
  else                                 drawHexEmpty(cx, cy, s);

  // 2. Shadow from adjacent walls
  if (tile.type !== TILE_WALL) {
    let shadow = 0;
    for (const [nq, nr] of hexNeighbors(q, r))
      if (tiles.get(hexKey(nq, nr)).type === TILE_WALL) shadow += 0.1;
    if (shadow > 0) {
      hexPath(cx, cy, s);
      ctx.fillStyle = `rgba(0,0,0,${Math.min(shadow, 0.28)})`;
      ctx.fill();
    }
  }

  // 3. Ownership tint + border (6 player colors, hidden in fog)
  if (tile.type !== TILE_WALL && !hidden && tile.owner !== OWNER_NONE) {
    const pc = PLAYER_COLORS[tile.owner];
    if (pc) {
      hexPath(cx, cy, s); ctx.fillStyle   = pc.tint;   ctx.fill();
      hexPath(cx, cy, s); ctx.strokeStyle = pc.stroke;  ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // 4. Flash animation overlays (respect fog)
  if (flashMoves   && flashMoves.has(k)   && !hidden) { hexPath(cx, cy, s); ctx.fillStyle = 'rgba(80,160,255,0.55)'; ctx.fill(); }
  if (flashAttacks && flashAttacks.has(k) && !hidden) { hexPath(cx, cy, s); ctx.fillStyle = 'rgba(255,60,60,0.55)';  ctx.fill(); }

  // 5. Range highlights
  if (validMoveTiles.has(k) && tile.type !== TILE_WALL) {
    hexPath(cx, cy, s); ctx.fillStyle   = 'rgba(80,160,255,0.28)';   ctx.fill();
    hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(100,180,255,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (validAtkTiles.has(k)) {
    hexPath(cx, cy, s); ctx.fillStyle   = 'rgba(255,60,60,0.28)';    ctx.fill();
    hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(255,100,100,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // 6. Selected glow
  if (selected && selected.q === q && selected.r === r) {
    hexPath(cx, cy, s);
    ctx.strokeStyle = 'rgba(255,220,0,0.95)'; ctx.lineWidth = 3; ctx.stroke();
    hexPath(cx, cy, s * 0.78);
    ctx.strokeStyle = 'rgba(255,200,0,0.35)'; ctx.lineWidth = 5; ctx.stroke();
  }

  // 6b. Keyboard cursor
  if (cursor && cursor.q === q && cursor.r === r) {
    ctx.save();
    hexPath(cx, cy, s);
    ctx.strokeStyle = 'rgba(0,230,220,0.92)'; ctx.lineWidth = 2.5;
    ctx.setLineDash([4, 3]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // 7. Plan destination/source overlays
  if (moveToSet.has(k)) {
    hexPath(cx, cy, s); ctx.fillStyle = 'rgba(80,160,255,0.48)'; ctx.fill();
    hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(130,200,255,0.9)'; ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (atkToSet.has(k)) {
    hexPath(cx, cy, s); ctx.fillStyle = 'rgba(255,60,60,0.48)'; ctx.fill();
    hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(255,130,130,0.9)'; ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
  }
  if (moveFromSet.has(k) || atkFromSet.has(k)) {
    hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 2; ctx.stroke();
  }

  // 8. Troop badge (hidden in fog)
  if (tile.type !== TILE_WALL && tile.troops > 0 && !hidden)
    drawTroopBadge(cx, cy, s, tile.troops, tile.owner);

  // 9. Spawn counter dots
  if (tile.type !== TILE_WALL && tile.owner !== OWNER_NONE && tile.troops > 0 && !hidden)
    drawSpawnCounter(cx, cy, s, tile.ownedTurns);

  // 9b. "Spotted" indicator
  if (tile.owner === currentViewer && tile.troops > 0 && isOwnTileSpotted(q, r, currentViewer)) {
    const ey = cy - s * 0.58;
    const er = Math.max(3, Math.floor(s * 0.15));
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx, ey - er);
    ctx.lineTo(cx + er, ey);
    ctx.lineTo(cx, ey + er);
    ctx.lineTo(cx - er, ey);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,160,30,0.92)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(180,80,0,0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(5, Math.floor(s * 0.16))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F441}', cx, ey);
    ctx.restore();
  }

  // 10. Storm overlay
  const safeRadius = getStormRadius();
  const distCenter = hexDist(0, 0, q, r);
  if (turnNum >= stormStartTurn() && distCenter > safeRadius) {
    hexPath(cx, cy, s);
    ctx.fillStyle = 'rgba(100, 20, 140, 0.38)';
    ctx.fill();
    ctx.save();
    hexPath(cx, cy, s); ctx.clip();
    ctx.globalAlpha = 0.18;
    ctx.font = `${Math.max(6, Math.floor(s * 0.4))}px serif`;
    ctx.fillStyle = '#e2b0ff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u26a1', cx, cy);
    ctx.globalAlpha = 1;
    ctx.restore();
  } else if (turnNum >= stormStartTurn() - 2 && distCenter === safeRadius + 1 && distCenter <= HEX_RADIUS) {
    hexPath(cx, cy, s);
    ctx.fillStyle = 'rgba(255, 160, 40, 0.18)';
    ctx.fill();
    hexPath(cx, cy, s);
    ctx.strokeStyle = 'rgba(255, 140, 30, 0.5)'; ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
}

function drawTroopBadge(cx, cy, s, troops, owner) {
  const bw = Math.max(13, Math.floor(s * 0.65));
  const bh = Math.max(9,  Math.floor(s * 0.36));
  const bx = cx - bw * 0.5;
  const by = cy + s * 0.3;
  const rx = Math.max(2, Math.floor(bh * 0.44));

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  pathRoundRect(bx + 1.5, by + 1.5, bw, bh, rx); ctx.fill();

  const pc = PLAYER_COLORS[owner];
  ctx.fillStyle = pc ? pc.badge : '#383838';
  pathRoundRect(bx, by, bw, bh, rx); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  pathRoundRect(bx, by, bw, bh * 0.52, rx); ctx.fill();

  ctx.fillStyle    = '#ffffff';
  ctx.font         = `bold ${Math.max(7, Math.floor(s * 0.3))}px sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(troops.toString(), cx, by + bh * 0.5);
}

function drawSpawnCounter(cx, cy, s, ownedTurns) {
  const dotR  = Math.max(2, Math.floor(s * 0.09));
  const gap   = dotR * 2.8;
  const total = SPAWN_TURNS - 1;
  const filled = ownedTurns % SPAWN_TURNS;
  const totalW = total * gap - gap * 0.4;
  const dx  = cx - totalW * 0.5;
  const dy  = cy - s * 0.64;
  for (let i = 0; i < total; i++) {
    ctx.beginPath();
    ctx.arc(dx + i * gap, dy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = i < filled ? 'rgba(255,220,80,0.92)' : 'rgba(255,255,255,0.28)';
    ctx.fill();
  }
}

function drawTooltip(originX, originY) {
  const { q, r } = tooltipTile;
  const tile = tiles.get(hexKey(q, r));
  if (!tile) return;
  const currentViewer = phaseOwner();
  const hidden = isTileHiddenForViewer(q, r, currentViewer);
  const typeStr  = TILE_TYPE_LABELS[tile.type] ?? 'Unknown';
  const ownerStr = hidden ? '???' : tile.owner === OWNER_NONE ? 'None' : `P${tile.owner}`;
  const range    = getTileRange(tile);
  const inStorm  = hexDist(0, 0, q, r) > getStormRadius() && turnNum >= stormStartTurn();
  const lines    = [
    `(${q},${r}) ${typeStr}`,
    hidden ? 'Owner: ???  Troops: ???' : `Owner: ${ownerStr}  Troops: ${tile.troops}`,
    `Range: ${range}`,
  ];
  if (inStorm) lines.push(`\u26a1 STORM (-${STORM_DAMAGE}/turn)`);

  const { x, y } = hexToPixel(q, r);
  const hx = originX + x, hy = originY + y;
  const lineH = 13, pad = 6, tw = 120, th = lines.length * lineH + pad * 2;
  let tx = hx + hexSize + 3;
  let ty = hy - th / 2;
  if (tx + tw > canvas.width)  tx = hx - hexSize - tw - 3;
  if (ty + th > canvas.height) ty = canvas.height - th - 2;
  if (ty < 0) ty = 2;

  ctx.fillStyle = 'rgba(10,18,36,0.93)';
  pathRoundRect(tx, ty, tw, th, 4); ctx.fill();
  ctx.strokeStyle = 'rgba(226,176,74,0.65)'; ctx.lineWidth = 1;
  pathRoundRect(tx, ty, tw, th, 4); ctx.stroke();

  ctx.fillStyle    = '#e0e0e0';
  ctx.font         = `${Math.floor(lineH * 0.88)}px sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++)
    ctx.fillText(lines[i], tx + pad, ty + pad + i * lineH);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
const TILE_TYPE_LABELS = {
  [TILE_EMPTY]:     'Empty',
  [TILE_WALL]:      'Wall',
  [TILE_HILL]:      'Hill (4)',
  [TILE_HILL_MED]:  'Hill (6)',
  [TILE_HILL_TALL]: 'Hill (8)',
};

function updateHUD() {
  const counts = {};
  PLAYERS.forEach(p => counts[p] = 0);
  for (const tile of tiles.values()) {
    if (tile.owner !== OWNER_NONE) counts[tile.owner]++;
  }
  for (const p of PLAYERS) {
    const el   = document.getElementById(`phud-tiles-${p}`);
    const item = document.getElementById(`phud-${p}`);
    if (el) el.textContent = counts[p];
    if (item) {
      if (!isPlayerActive(p)) {
        item.classList.add('off');
        item.classList.remove('dead');
      } else if (!isPlayerAlive(p) && turnNum > 1) {
        item.classList.add('dead');
        item.classList.remove('off');
      } else {
        item.classList.remove('dead', 'off');
      }
    }
  }
  document.getElementById('turn-num').textContent = turnNum;

  const stormEl = document.getElementById('storm-info');
  const safeR   = getStormRadius();
  if (turnNum < stormStartTurn()) {
    const turnsLeft = stormStartTurn() - turnNum;
    stormEl.textContent = `\u26a1 Storm in ${turnsLeft} turn${turnsLeft > 1 ? 's' : ''}`;
    stormEl.style.color = '#a78bfa';
  } else if (safeR >= 0) {
    stormEl.textContent = `\u26a1 Storm active  \u2014  Safe zone: ${safeR}`;
    stormEl.style.color = '#f472b6';
  } else {
    stormEl.textContent = '\u26a1 Storm covers ALL tiles!';
    stormEl.style.color = '#ef4444';
  }
}

// ─── Spectate / AI helpers ────────────────────────────────────────────────────
function toggleAiVsAiPause() {
  aiVsAiPaused = !aiVsAiPaused;
  const btn = document.getElementById('ai-vs-ai-pause');
  btn.textContent = aiVsAiPaused ? '\u25b6 Resume' : '\u23f8 Pause';
  if (!aiVsAiPaused) scheduleAiTurnIfNeeded();
  if (isSpectateMode()) {
    const status = aiVsAiPaused ? '\u23f8 Paused' : '\u25b6 Running';
    document.getElementById('phase-label').textContent = `All AI \u2014 Turn ${turnNum}  [${status}]`;
  }
}

function scheduleAiTurnIfNeeded() {
  clearTimeout(aiVsAiTimerId);
  aiVsAiTimerId = null;
  if (aiVsAiPaused) return;
  if (!isSpectateMode()) return;
  aiVsAiTimerId = setTimeout(doAllAiTurn, AI_VS_AI_DELAY);
}

function doAllAiTurn() {
  aiVsAiTimerId = null;
  const alive = getAlivePlayers();
  for (const p of alive) {
    makeAIPlansFor(p, aiDifficulties[p]);
  }
  animateAndResolveTurn();
}

function updatePhaseLabel() {
  const spectate = isSpectateMode();
  document.getElementById('ai-vs-ai-pause').classList.toggle('hidden', !spectate);

  let label;
  if (spectate) {
    const status = aiVsAiPaused ? '\u23f8 Paused' : '\u25b6 Running';
    label = `All AI \u2014 Turn ${turnNum}  [${status}]`;
  } else {
    const owner = phaseOwner();
    if (isPlayerAI(owner)) {
      label = `AI P${owner} (${aiDifficulties[owner]}) is planning\u2026`;
    } else {
      label = `Player ${owner}'s Turn \u2014 Select a tile`;
    }
  }
  document.getElementById('phase-label').textContent = label;
  updatePlanCounter();
  updateMobileBar();
  if (spectate) scheduleAiTurnIfNeeded();
}

function showTileInfo(q, r) {
  const tile = tiles.get(hexKey(q, r));
  if (!tile) return;
  const currentOwner = phaseOwner();
  const hidden = isTileHiddenForViewer(q, r, currentOwner);
  const typeStr  = TILE_TYPE_LABELS[tile.type] ?? 'Unknown';
  const ownerStr = hidden ? '???' : tile.owner === OWNER_NONE ? 'None' : `Player ${tile.owner}`;
  const troopStr = hidden ? '???' : tile.troops;
  document.getElementById('tile-detail').textContent =
    `(${q},${r}) ${typeStr} | Owner: ${ownerStr} | Troops: ${troopStr}`;
  document.getElementById('tile-info').classList.remove('hidden');

  const hasMoved    = plans[currentOwner].some(p => p.kind === 'move'   && p.from.q === q && p.from.r === r);
  const hasAttacked = plans[currentOwner].some(p => p.kind === 'attack' && p.from.q === q && p.from.r === r);
  document.getElementById('btn-move').disabled   = hasMoved    || tile.owner !== currentOwner || tile.troops === 0;
  document.getElementById('btn-attack').disabled = hasAttacked || tile.owner !== currentOwner || tile.troops === 0;
  document.getElementById('btn-undo').disabled   = plans[currentOwner].length === 0;
  updateMobileBar();
}

function hideTileInfo() {
  document.getElementById('tile-info').classList.add('hidden');
  document.getElementById('tile-detail').textContent = '';
  updateMobileBar();
}

function clearLog() {
  eventLog = [];
  document.getElementById('event-log').innerHTML = '';
}

function updatePlanCounter() {
  const currentOwner = phaseOwner();
  const currentPlans = plans[currentOwner] || [];
  const moves   = currentPlans.filter(p => p.kind === 'move').length;
  const attacks = currentPlans.filter(p => p.kind === 'attack').length;
  const el = document.getElementById('plan-counter');
  if (moves === 0 && attacks === 0) {
    el.classList.add('hidden');
  } else {
    el.classList.remove('hidden');
    el.textContent = `Plans: ${moves} move(s), ${attacks} attack(s)`;
  }
}

function addLog(msg, cssClass) {
  eventLog.unshift({ msg, cssClass: cssClass || '' });
  if (eventLog.length > 20) eventLog.pop();
  const ul = document.getElementById('event-log');
  ul.innerHTML = '';
  for (const entry of eventLog) {
    const li = document.createElement('li');
    li.textContent = entry.msg;
    if (entry.cssClass) li.className = entry.cssClass;
    ul.appendChild(li);
  }
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function onCanvasHover(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width  / rect.width)  - canvas.width  / 2 - panX;
  const py = (e.clientY - rect.top)  * (canvas.height / rect.height) - canvas.height / 2 - panY;
  const { q, r } = pixelToHex(px, py);
  tooltipTile = tiles.has(hexKey(q, r)) ? { q, r } : null;
  render();
}

function onCanvasLeave() {
  tooltipTile = null;
  render();
}

function onCanvasWheel(e) {
  e.preventDefault();
  const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
  zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomLevel + delta));
  resizeCanvas();
  render();
}

function onCanvasClick(e) {
  if (!e.isPrimary) return;
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (canvas.width  / rect.width)  - canvas.width  / 2 - panX;
  const py = (e.clientY - rect.top)  * (canvas.height / rect.height) - canvas.height / 2 - panY;
  const { q, r } = pixelToHex(px, py);
  if (!tiles.has(hexKey(q, r))) return;
  playSound('select');
  handleTileClick(q, r);
}

function handleTileClick(q, r) {
  if (pendingAction === 'move') {
    tryPlanMove(q, r);
    return;
  }
  if (pendingAction === 'attack') {
    tryPlanAttack(q, r);
    return;
  }
  selected       = { q, r };
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  showTileInfo(q, r);
}

function onBtnMove() {
  if (!selected) return;
  pendingAction  = 'move';
  validMoveTiles = getValidMoveTiles(selected.q, selected.r);
  validAtkTiles  = new Set();
  document.getElementById('phase-label').textContent = 'Navigate to a highlighted tile, then press Space';
  render();
  updateMobileBar();
}

function onBtnAttack() {
  if (!selected) return;
  pendingAction  = 'attack';
  validAtkTiles  = getValidAtkTiles(selected.q, selected.r);
  validMoveTiles = new Set();
  document.getElementById('phase-label').textContent = 'Navigate to a highlighted enemy tile, then press Space';
  render();
  updateMobileBar();
}

function onBtnCancel() {
  pendingAction  = null;
  selected       = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  hideTileInfo();
  updatePhaseLabel();
}

function onBtnUndo() {
  const currentOwner = phaseOwner();
  if (!plans[currentOwner] || plans[currentOwner].length === 0) return;
  const removed = plans[currentOwner].pop();
  addLog(`Undo: removed ${removed.kind} plan from (${removed.from.q},${removed.from.r})`);
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  if (selected) showTileInfo(selected.q, selected.r);
  else document.getElementById('btn-undo').disabled = plans[currentOwner].length === 0;
  updatePhaseLabel();
}

// ─── Keyboard handler ─────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (e.target.matches('input, select, textarea')) return;

  const hexKeyMap = { t:[0,-1], y:[1,-1], h:[1,0], b:[0,1], v:[-1,1], f:[-1,0] };
  const lk = e.key.toLowerCase();
  if (lk in hexKeyMap) { e.preventDefault(); moveCursor(...hexKeyMap[lk]); return; }

  const arrowMap = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
  if (e.key in arrowMap) { e.preventDefault(); moveCursor(...arrowMap[e.key]); return; }

  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const passOverlay = document.getElementById('pass-overlay');
    if (!passOverlay.classList.contains('hidden')) { onPassReady(); return; }
    if (cursor) { playSound('select'); handleTileClick(cursor.q, cursor.r); }
    else { onBtnDone(); }
    return;
  }

  const k = e.key.toUpperCase();
  if (k === 'M') {
    const btn = document.getElementById('btn-move');
    if (!btn.disabled) onBtnMove();
  } else if (k === 'A') {
    const btn = document.getElementById('btn-attack');
    if (!btn.disabled) onBtnAttack();
  } else if (e.key === 'Escape') {
    cursor = null;
    onBtnCancel();
  } else if (k === 'U') {
    const btn = document.getElementById('btn-undo');
    if (!btn.disabled) onBtnUndo();
  } else if (k === 'D') {
    onBtnDone();
  }
}

function moveCursor(dq, dr) {
  if (!cursor) {
    cursor = selected ? { q: selected.q, r: selected.r } : { q: -HEX_RADIUS, r: 0 };
  } else {
    const nq = cursor.q + dq, nr = cursor.r + dr;
    if (tiles.has(hexKey(nq, nr))) cursor = { q: nq, r: nr };
  }
  tooltipTile = { q: cursor.q, r: cursor.r };
  render();
}

// ─── Valid target sets ────────────────────────────────────────────────────────
function getValidMoveTiles(q, r) {
  const currentOwner = phaseOwner();
  const result = new Set();
  for (const [nq, nr] of hexNeighbors(q, r)) {
    const t = tiles.get(hexKey(nq, nr));
    if (!t || t.type === TILE_WALL) continue;
    if (t.owner !== OWNER_NONE && t.owner !== currentOwner) continue;
    result.add(hexKey(nq, nr));
  }
  return result;
}

function getValidAtkTiles(q, r) {
  const currentOwner = phaseOwner();
  const result = new Set();
  for (const [tq, tr] of allHexes()) {
    const t = tiles.get(hexKey(tq, tr));
    if (!t || t.owner === OWNER_NONE || t.owner === currentOwner) continue;
    if (isTileHiddenForViewer(tq, tr, currentOwner)) continue;
    if (canAttack(q, r, tq, tr)) result.add(hexKey(tq, tr));
  }
  return result;
}

// ─── Planning ─────────────────────────────────────────────────────────────────
function tryPlanMove(q, r) {
  const currentOwner = phaseOwner();
  const from = selected;
  const tile = tiles.get(hexKey(q, r));
  if (hexDist(from.q, from.r, q, r) !== 1) {
    addLog('Move: must be adjacent.');
  } else if (tile.type === TILE_WALL) {
    addLog('Move: cannot move onto a wall.');
  } else if (tile.owner !== OWNER_NONE && tile.owner !== currentOwner) {
    addLog('Move: cannot move onto an enemy tile.');
  } else {
    plans[currentOwner] = plans[currentOwner].filter(
      p => !(p.kind === 'move' && p.from.q === from.q && p.from.r === from.r));
    plans[currentOwner].push({ kind: 'move', from: { q: from.q, r: from.r }, to: { q, r } });
    addLog(`P${currentOwner} plans move (${from.q},${from.r})\u2192(${q},${r})`, 'log-move');
    playSound('move');
    selected = null;
    hideTileInfo();
  }
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  updatePhaseLabel();
}

function tryPlanAttack(q, r) {
  const currentOwner = phaseOwner();
  const from = selected;
  const tile = tiles.get(hexKey(q, r));
  if (isTileHiddenForViewer(q, r, currentOwner)) {
    addLog('Attack: no visible enemy there.');
  } else if (tile.owner === currentOwner) {
    addLog('Attack: cannot attack own tile.');
  } else if (tile.owner === OWNER_NONE) {
    addLog('Attack: no enemy troops there.');
  } else if (!canAttack(from.q, from.r, q, r)) {
    addLog('Attack: target out of range or blocked by wall.');
  } else {
    plans[currentOwner] = plans[currentOwner].filter(
      p => !(p.kind === 'attack' && p.from.q === from.q && p.from.r === from.r));
    plans[currentOwner].push({ kind: 'attack', from: { q: from.q, r: from.r }, to: { q, r } });
    addLog(`P${currentOwner} plans attack (${from.q},${from.r})\u2192(${q},${r})`, 'log-attack');
    playSound('attack');
    selected = null;
    hideTileInfo();
  }
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  updatePhaseLabel();
}

// ─── Attack range / LOS ───────────────────────────────────────────────────────
function isAdjacent(q1, r1, q2, r2) { return hexDist(q1, r1, q2, r2) === 1; }

function canAttack(fq, fr, tq, tr) {
  const tile   = tiles.get(hexKey(fq, fr));
  const isHill = isHillType(tile.type);
  const range  = getTileRange(tile);
  if (hexDist(fq, fr, tq, tr) > range) return false;
  if (isHill) return true;
  return !wallBlocksShot(fq, fr, tq, tr);
}

function wallBlocksShot(fq, fr, tq, tr) {
  const dq = tq - fq, dr = tr - fr;
  for (const [nq, nr] of hexNeighborsAll(fq, fr)) {
    const t = tiles.get(hexKey(nq, nr));
    if (!t || t.type !== TILE_WALL) continue;
    if ((nq - fq) * dq + (nr - fr) * dr > 0) return true;
  }
  return false;
}

// ─── Turn / Done (6-player phase cycling) ─────────────────────────────────────
function onBtnDone() {
  selected       = null;
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  hideTileInfo();
  planIndex++;
  advancePlanning();
}

function advancePlanning() {
  // Skip AI players — auto-plan them
  while (planIndex < turnOrder.length) {
    const owner = turnOrder[planIndex];
    if (isPlayerAI(owner)) {
      makeAIPlansFor(owner, aiDifficulties[owner]);
      planIndex++;
      continue;
    }
    // Human player
    phase = ownerPhase(owner);
    if (gameJustStarted) {
      gameJustStarted = false;
      updatePhaseLabel();
      render();
      updateHUD();
    } else {
      showPassOverlayForPlayer(owner);
    }
    return;
  }
  // All have planned → resolve
  animateAndResolveTurn();
}

function showPassOverlayForPlayer(owner, summary) {
  const pc = PLAYER_COLORS[owner];
  if (summary) {
    document.getElementById('pass-title').textContent = `Turn ${turnNum} \u2014 Player ${owner}'s Planning Phase`;
    document.getElementById('pass-msg').textContent   = 'Results resolved! Review the summary, then plan your moves.';
    const summaryEl = document.getElementById('resolution-summary');
    summaryEl.classList.remove('hidden');
    document.getElementById('summary-moves').textContent   = summary.moves;
    document.getElementById('summary-attacks').textContent = summary.attacks;
    document.getElementById('summary-kills').textContent   = summary.kills;
    document.getElementById('summary-mutual').textContent  = summary.mutual;
  } else {
    document.getElementById('pass-title').textContent = `Pass to Player ${owner}`;
    document.getElementById('pass-msg').textContent   = `Hand the device to Player ${owner} (${pc ? pc.name : ''}).`;
    document.getElementById('resolution-summary').classList.add('hidden');
  }
  document.getElementById('pass-overlay').classList.remove('hidden');
}

function onPassReady() {
  document.getElementById('pass-overlay').classList.add('hidden');
  selected       = null;
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  hideTileInfo();
  updatePhaseLabel();
  updateHUD();
}

// ─── Animated turn resolution ─────────────────────────────────────────────────
function animateAndResolveTurn() {
  const flashMoveSet = new Set();
  const flashAtkSet  = new Set();
  for (const p of PLAYERS) {
    if (!plans[p]) continue;
    for (const plan of plans[p]) {
      if (plan.kind === 'move')   flashMoveSet.add(hexKey(plan.to.q, plan.to.r));
      if (plan.kind === 'attack') flashAtkSet.add(hexKey(plan.to.q,  plan.to.r));
    }
  }
  render(flashMoveSet, flashAtkSet);
  setTimeout(resolveTurn, 500);
}

// ─── Turn Resolution ──────────────────────────────────────────────────────────
function resolveTurn() {
  const summary = { moves: 0, attacks: 0, kills: 0, mutual: 0 };

  // Snapshot troop totals for tiebreaker
  preResolveTroops = {};
  for (const p of PLAYERS) preResolveTroops[p] = 0;
  for (const tile of tiles.values()) {
    if (tile.owner !== OWNER_NONE) preResolveTroops[tile.owner] += tile.troops;
  }

  // Clear previous fog reveals
  resetRevealedTiles();

  resolveMovement(summary);
  resolveAttacks(summary);
  resolveSpawn();
  resolveStorm(summary);

  turnNum++;
  resetPlans();
  selected       = null;
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();

  document.getElementById('pass-overlay').classList.add('hidden');
  render();
  updateHUD();
  hideTileInfo();

  const winResult = checkWin();
  if (winResult) return;

  if (isSpectateMode()) {
    // All AI — spectate mode: log and auto-continue
    addLog(`Turn ${turnNum - 1} \u2014 ${summary.moves} mv, ${summary.attacks} atk, ${summary.kills} kills`);
    updatePhaseLabel(); // scheduleAiTurnIfNeeded is called
  } else {
    // Set up next turn planning
    turnOrder = getAlivePlayers();
    planIndex = 0;

    // Skip leading AIs (auto-plan them)
    while (planIndex < turnOrder.length && isPlayerAI(turnOrder[planIndex])) {
      makeAIPlansFor(turnOrder[planIndex], aiDifficulties[turnOrder[planIndex]]);
      planIndex++;
    }

    if (planIndex < turnOrder.length) {
      const nextHuman = turnOrder[planIndex];
      phase = ownerPhase(nextHuman);
      showPassOverlayForPlayer(nextHuman, summary);
    } else {
      // All remaining alive are AI (human just died) — spectate mode kicks in
      animateAndResolveTurn();
    }
  }
}

function resolveMovement(summary) {
  const moves = [];
  for (const owner of PLAYERS) {
    if (!plans[owner]) continue;
    for (const p of plans[owner]) {
      if (p.kind !== 'move') continue;
      const ft = tiles.get(hexKey(p.from.q, p.from.r));
      if (!ft || ft.owner !== owner || ft.troops === 0) continue;
      moves.push({ owner, from: p.from, to: p.to });
    }
  }

  const destOwners = {};
  for (const mv of moves) {
    const k = hexKey(mv.to.q, mv.to.r);
    if (!destOwners[k]) destOwners[k] = new Set();
    destOwners[k].add(mv.owner);
  }
  const contestedKeys = new Set();
  for (const k in destOwners) {
    const dest = tiles.get(k);
    if (destOwners[k].size >= 2 && dest && dest.owner === OWNER_NONE) {
      contestedKeys.add(k);
      const { q, r } = decodeKey(k);
      addLog(`Contested move to (${q},${r})! Neither move succeeds.`);
    }
  }

  const arrivals = {};
  for (const mv of moves) {
    const toTile = tiles.get(hexKey(mv.to.q, mv.to.r));
    if (!toTile || toTile.type === TILE_WALL) continue;
    if (toTile.owner !== OWNER_NONE && toTile.owner !== mv.owner) continue;
    const k = hexKey(mv.to.q, mv.to.r);
    if (contestedKeys.has(k)) continue;

    const fromTile = tiles.get(hexKey(mv.from.q, mv.from.r));
    fromTile.troops = Math.max(0, fromTile.troops - 1);
    if (fromTile.troops === 0) { fromTile.owner = OWNER_NONE; fromTile.ownedTurns = 0; }

    if (!arrivals[k]) arrivals[k] = { owner: mv.owner, q: mv.to.q, r: mv.to.r, count: 0 };
    arrivals[k].count++;
    addLog(`P${mv.owner} moved (${mv.from.q},${mv.from.r})\u2192(${mv.to.q},${mv.to.r})`, 'log-move');
    summary.moves++;
  }

  for (const k in arrivals) {
    const { owner, q, r, count } = arrivals[k];
    const tile = tiles.get(hexKey(q, r));
    if (tile.owner === OWNER_NONE) { tile.owner = owner; tile.troops = count; tile.ownedTurns = 0; }
    else if (tile.owner === owner) { tile.troops += count; }
  }
}

function resolveAttacks(summary) {
  const attacks = [];
  for (const owner of PLAYERS) {
    if (!plans[owner]) continue;
    for (const p of plans[owner]) {
      if (p.kind !== 'attack') continue;
      const ft = tiles.get(hexKey(p.from.q, p.from.r));
      if (!ft || ft.owner !== owner || ft.troops === 0) continue;
      attacks.push({ owner, from: p.from, to: p.to });
    }
  }

  // Fog: attacker revealed to the DEFENDER
  for (const atk of attacks) {
    const targetTile = tiles.get(hexKey(atk.to.q, atk.to.r));
    if (targetTile && targetTile.owner !== OWNER_NONE && targetTile.owner !== atk.owner) {
      revealedTiles[targetTile.owner].add(hexKey(atk.from.q, atk.from.r));
    }
  }

  const attackMap = {};
  for (const atk of attacks) {
    const k = hexKey(atk.to.q, atk.to.r);
    if (!attackMap[k]) attackMap[k] = [];
    attackMap[k].push(atk);
  }
  const penaltyTiles = new Set();
  for (const k in attackMap) {
    if (attackMap[k].length >= 2) {
      for (const atk of attackMap[k]) {
        penaltyTiles.add(hexKey(atk.from.q, atk.from.r));
        addLog(`Mutual strike on (${atk.to.q},${atk.to.r})! Attacker at (${atk.from.q},${atk.from.r}) loses 1.`, 'log-mutual');
        summary.mutual++;
      }
    }
  }

  const damage = {};
  for (const atk of attacks) {
    const targetTile = tiles.get(hexKey(atk.to.q, atk.to.r));
    if (isHillType(targetTile.type) && targetTile.troops >= 3 && Math.random() < FORTIFICATION_MISS_CHANCE) {
      addLog(`Fortification! Attack on (${atk.to.q},${atk.to.r}) missed!`, 'log-spawn');
      continue;
    }
    const k = hexKey(atk.to.q, atk.to.r);
    damage[k] = (damage[k] || 0) + 1;
    addLog(`P${atk.owner} attacks (${atk.from.q},${atk.from.r})\u2192(${atk.to.q},${atk.to.r})`, 'log-attack');
    summary.attacks++;
  }

  for (const k in damage) {
    const tile = tiles.get(k);
    if (!tile) continue;
    const prev     = tile.troops;
    tile.troops    = Math.max(0, tile.troops - damage[k]);
    summary.kills += prev - tile.troops;
    if (tile.troops === 0) { tile.owner = OWNER_NONE; tile.ownedTurns = 0; }
  }

  for (const k of penaltyTiles) {
    const tile = tiles.get(k);
    if (!tile) continue;
    const prev     = tile.troops;
    tile.troops    = Math.max(0, tile.troops - 1);
    summary.kills += prev - tile.troops;
    if (tile.troops === 0) { tile.owner = OWNER_NONE; tile.ownedTurns = 0; }
  }
}

function resolveSpawn() {
  for (const tile of tiles.values()) {
    if (tile.owner !== OWNER_NONE && tile.troops > 0) {
      tile.ownedTurns++;
      if (tile.ownedTurns >= SPAWN_TURNS) {
        tile.troops = Math.min(MAX_TROOPS, tile.troops + 1);
        tile.ownedTurns = 0;
      }
    }
  }
}

// ─── Storm ────────────────────────────────────────────────────────────────────
function stormStartTurn()     { return Math.max(10, 6 + HEX_RADIUS * 2); }
function stormShrinkInterval(){ return Math.max(2, Math.floor(2 + HEX_RADIUS * 0.5)); }

function getStormRadius() {
  const start    = stormStartTurn();
  const interval = stormShrinkInterval();
  if (turnNum < start) return HEX_RADIUS;
  const shrinks = 1 + Math.floor((turnNum - start) / interval);
  return Math.max(-1, HEX_RADIUS - shrinks);
}

function resolveStorm(summary) {
  const safeR = getStormRadius();
  if (safeR >= HEX_RADIUS) return;
  for (const [q, r] of allHexes()) {
    if (hexDist(0, 0, q, r) <= safeR) continue;
    const tile = tiles.get(hexKey(q, r));
    if (tile.owner === OWNER_NONE || tile.troops <= 0) continue;
    const prev = tile.troops;
    tile.troops = Math.max(0, tile.troops - STORM_DAMAGE);
    const lost = prev - tile.troops;
    if (lost > 0) {
      summary.kills += lost;
      addLog(`\u26a1 Storm hits (${q},${r}): -${lost}`, 'log-mutual');
    }
    if (tile.troops === 0) {
      tile.owner = OWNER_NONE;
      tile.ownedTurns = 0;
    }
  }
}

// ─── AI Opponent ──────────────────────────────────────────────────────────────
// Shared AI helpers
function stormUrgency() {
  const turnsToStorm = stormStartTurn() - turnNum;
  if (turnsToStorm > 4) return 0;
  if (turnsToStorm > 0) return 1;
  return 2 + Math.floor((turnNum - stormStartTurn()) / Math.max(1, stormShrinkInterval()));
}

function stormPenalty(tq, tr) {
  const safeR   = getStormRadius();
  const dist    = hexDist(0, 0, tq, tr);
  const urgency = stormUrgency();
  if (dist > safeR) return -30 - urgency * 15;
  if (dist === safeR && urgency >= 1) return -10 - urgency * 5;
  if (dist === safeR - 1 && urgency >= 2) return -4 - urgency * 2;
  if (urgency >= 1) return Math.max(0, (safeR - dist)) * urgency * 0.5;
  return 0;
}

function flankBonus(mq, mr, enemyTiles, myOwner) {
  if (enemyTiles.length === 0) return 0;
  const myTiles = getOwnerTiles(myOwner);
  if (myTiles.length <= 1) return 0;
  let bonus = 0;
  for (const enemy of enemyTiles) {
    const dq1 = mq - enemy.q, dr1 = mr - enemy.r;
    for (const ally of myTiles) {
      if (ally.q === mq && ally.r === mr) continue;
      const dq2 = ally.q - enemy.q, dr2 = ally.r - enemy.r;
      const dot = dq1 * dq2 + dr1 * dr2;
      if (dot < 0 && hexDist(mq, mr, enemy.q, enemy.r) <= 3) {
        bonus += 4;
        break;
      }
    }
  }
  return bonus;
}

function makeAIPlansFor(myOwner, difficulty) {
  if      (difficulty === 'easy')   makeAIPlansEasyFor(myOwner);
  else if (difficulty === 'medium') makeAIPlansMediumFor(myOwner);
  else if (difficulty === 'hard')   makeAIPlansHardFor(myOwner);
}

function aiCanSee(q, r, myOwner) {
  return !isTileHiddenForViewer(q, r, myOwner);
}

function getAIMoveOptionsFor(q, r, myOwner) {
  const moveable = [];
  for (const [nq, nr] of hexNeighbors(q, r)) {
    const t = tiles.get(hexKey(nq, nr));
    if (!t || t.type === TILE_WALL) continue;
    if (t.owner !== OWNER_NONE && t.owner !== myOwner) continue;
    moveable.push({ q: nq, r: nr });
  }
  return moveable;
}

function getOwnerTiles(owner) {
  const result = [];
  for (const [q, r] of allHexes())
    if (tiles.get(hexKey(q, r)).owner === owner) result.push({ q, r });
  return result;
}

function getVisibleEnemyTiles(myOwner) {
  const result = [];
  for (const [q, r] of allHexes()) {
    const t = tiles.get(hexKey(q, r));
    if (t.owner !== OWNER_NONE && t.owner !== myOwner && t.troops > 0 && aiCanSee(q, r, myOwner))
      result.push({ q, r, troops: t.troops, owner: t.owner });
  }
  return result;
}

function getUncontrolledHills(myOwner) {
  const hills = [];
  for (const [q, r] of allHexes()) {
    const t = tiles.get(hexKey(q, r));
    if (isHillType(t.type) && t.owner !== myOwner) hills.push({ q, r });
  }
  return hills;
}

// ── Easy AI ─────────────────────────────────────────────────────────────────
function makeAIPlansEasyFor(myOwner) {
  plans[myOwner] = [];
  const myTileList = [];
  for (const [q, r] of allHexes()) {
    const t = tiles.get(hexKey(q, r));
    if (t.owner === myOwner && t.troops > 0) myTileList.push({ q, r, troops: t.troops });
  }
  myTileList.sort((a, b) => b.troops - a.troops);

  for (const { q, r } of myTileList) {
    if (plans[myOwner].some(p => p.from.q === q && p.from.r === r)) continue;

    // Attack: weakest visible enemy in range (any opponent)
    const atkTargets = [];
    for (const [tq, tr] of allHexes()) {
      const t = tiles.get(hexKey(tq, tr));
      if (t.owner !== OWNER_NONE && t.owner !== myOwner && t.troops > 0 && aiCanSee(tq, tr, myOwner) && canAttack(q, r, tq, tr))
        atkTargets.push({ q: tq, r: tr, troops: t.troops });
    }
    if (atkTargets.length > 0) {
      atkTargets.sort((a, b) => a.troops - b.troops);
      const t = atkTargets[0];
      plans[myOwner].push({ kind: 'attack', from: { q, r }, to: { q: t.q, r: t.r } });
      addLog(`AI P${myOwner} attacks (${q},${r})\u2192(${t.q},${t.r})`, 'log-attack');
      continue;
    }

    // Move
    const moveable = getAIMoveOptionsFor(q, r, myOwner);
    const enemyTiles = getVisibleEnemyTiles(myOwner);
    const curTile = tiles.get(hexKey(q, r));

    let stayScore = 0;
    const spawnProgress = curTile.ownedTurns || 0;
    stayScore += spawnProgress * 3;
    if (spawnProgress === SPAWN_TURNS - 1) stayScore += 6;
    if (curTile.troops < MAX_TROOPS) stayScore += 2;
    if (isHillType(curTile.type)) stayScore += 3 + hillVisibility(curTile.type) * 2;
    if (enemyTiles.length === 0) stayScore += 3;
    stayScore += stormPenalty(q, r);

    let best = null, bestScore = stayScore;
    for (const mt of moveable) {
      let score = 0;
      if (enemyTiles.length > 0) {
        score = -Math.min(...enemyTiles.map(pt => hexDist(mt.q, mt.r, pt.q, pt.r))) * 2;
        score += flankBonus(mt.q, mt.r, enemyTiles, myOwner);
      } else {
        score = -hexDist(0, 0, mt.q, mt.r);
        const destType = tiles.get(hexKey(mt.q, mt.r)).type;
        if (isHillType(destType)) score += 5 + hillVisibility(destType) * 3;
      }
      score += stormPenalty(mt.q, mt.r);
      if (score > bestScore) { bestScore = score; best = mt; }
    }
    if (best) {
      plans[myOwner].push({ kind: 'move', from: { q, r }, to: best });
      addLog(`AI P${myOwner} moves (${q},${r})\u2192(${best.q},${best.r})`, 'log-move');
    }
  }
}

// ── Medium AI ────────────────────────────────────────────────────────────────
function makeAIPlansMediumFor(myOwner) {
  plans[myOwner] = [];
  const pendingDmg = {};
  const myTileList = [];
  for (const [q, r] of allHexes()) {
    const t = tiles.get(hexKey(q, r));
    if (t.owner === myOwner && t.troops > 0) myTileList.push({ q, r, troops: t.troops });
  }
  myTileList.sort((a, b) => {
    const aHill = hillRange(tiles.get(hexKey(a.q, a.r)).type);
    const bHill = hillRange(tiles.get(hexKey(b.q, b.r)).type);
    return bHill - aHill || b.troops - a.troops;
  });

  for (const { q, r } of myTileList) {
    if (plans[myOwner].some(p => p.from.q === q && p.from.r === r)) continue;

    const atkTargets = [];
    for (const [tq, tr] of allHexes()) {
      const t = tiles.get(hexKey(tq, tr));
      if (t.owner === OWNER_NONE || t.owner === myOwner || !aiCanSee(tq, tr, myOwner) || !canAttack(q, r, tq, tr)) continue;
      const k = hexKey(tq, tr);
      const remainingHP = t.troops - (pendingDmg[k] || 0);
      atkTargets.push({ q: tq, r: tr, troops: t.troops, remainingHP, k });
    }
    if (atkTargets.length > 0) {
      atkTargets.sort((a, b) => {
        const aKill = a.remainingHP <= 1 ? 0 : 1;
        const bKill = b.remainingHP <= 1 ? 0 : 1;
        const aDmg  = (pendingDmg[a.k] || 0);
        const bDmg  = (pendingDmg[b.k] || 0);
        return aKill - bKill || bDmg - aDmg || a.remainingHP - b.remainingHP;
      });
      const t = atkTargets[0];
      pendingDmg[t.k] = (pendingDmg[t.k] || 0) + 1;
      plans[myOwner].push({ kind: 'attack', from: { q, r }, to: { q: t.q, r: t.r } });
      addLog(`AI P${myOwner} attacks (${q},${r})\u2192(${t.q},${t.r})`, 'log-attack');
      continue;
    }

    const moveable = getAIMoveOptionsFor(q, r, myOwner);
    const enemyTiles = getVisibleEnemyTiles(myOwner);
    const curTile = tiles.get(hexKey(q, r));
    const curRange = getTileRange(curTile);

    let stayScore = 0;
    const spawnProgress = curTile.ownedTurns || 0;
    stayScore += spawnProgress * 3;
    if (spawnProgress === SPAWN_TURNS - 1) stayScore += 8;
    if (curTile.troops < MAX_TROOPS) stayScore += 2;
    if (isHillType(curTile.type)) stayScore += 4 + hillRange(curTile.type) + hillVisibility(curTile.type) * 2;
    if (enemyTiles.length > 0) {
      const curCoverage = enemyTiles.filter(pt => hexDist(q, r, pt.q, pt.r) <= curRange).length;
      stayScore += curCoverage * 3;
      if (enemyTiles.some(pt => hexDist(q, r, pt.q, pt.r) === 1)) stayScore += 5;
      stayScore += flankBonus(q, r, enemyTiles, myOwner);
    } else {
      stayScore += 3;
    }
    stayScore += stormPenalty(q, r);

    let best = null, bestScore = stayScore;
    for (const mt of moveable) {
      const destType = tiles.get(hexKey(mt.q, mt.r)).type;
      let score = 0;
      if (enemyTiles.length > 0) {
        const distToEnemy = Math.min(...enemyTiles.map(pt => hexDist(mt.q, mt.r, pt.q, pt.r)));
        score = -distToEnemy * 2;
        if (enemyTiles.some(pt => hexDist(mt.q, mt.r, pt.q, pt.r) === 1)) score += 5;
        const range = getTileRange(tiles.get(hexKey(mt.q, mt.r)));
        const coverage = enemyTiles.filter(pt => hexDist(mt.q, mt.r, pt.q, pt.r) <= range).length;
        score += coverage * 3;
        score += flankBonus(mt.q, mt.r, enemyTiles, myOwner);
      } else {
        score = -hexDist(0, 0, mt.q, mt.r);
      }
      if (isHillType(destType)) score += 4 + hillRange(destType) + hillVisibility(destType) * 2;
      score += stormPenalty(mt.q, mt.r);
      if (score > bestScore) { bestScore = score; best = mt; }
    }
    if (best) {
      plans[myOwner].push({ kind: 'move', from: { q, r }, to: best });
      addLog(`AI P${myOwner} moves (${q},${r})\u2192(${best.q},${best.r})`, 'log-move');
    }
  }
}

// ── Hard AI ─────────────────────────────────────────────────────────────────
function makeAIPlansHardFor(myOwner) {
  plans[myOwner] = [];

  const enemyTilesAll = getVisibleEnemyTiles(myOwner).map(e => ({
    ...e,
    k:    hexKey(e.q, e.r),
    type: tiles.get(hexKey(e.q, e.r)).type,
  }));
  const myTilesAll = getOwnerTiles(myOwner).map(({ q, r }) => ({
    q, r,
    k:      hexKey(q, r),
    troops: tiles.get(hexKey(q, r)).troops,
    type:   tiles.get(hexKey(q, r)).type,
  }));

  if (myTilesAll.length === 0) return;

  const pendingDmg = {};
  const assigned   = new Set();

  // ── Phase 1: Kill planning ────────────────────────────────────────────────
  if (enemyTilesAll.length > 0) {
    const killTargets = enemyTilesAll
      .map(enemy => ({
        enemy,
        attackers: myTilesAll.filter(u => canAttack(u.q, u.r, enemy.q, enemy.r)),
      }))
      .filter(({ enemy, attackers }) => attackers.length >= enemy.troops)
      .sort((a, b) =>
        a.enemy.troops - b.enemy.troops || a.attackers.length - b.attackers.length
      );

    for (const { enemy, attackers } of killTargets) {
      pendingDmg[enemy.k] = pendingDmg[enemy.k] || 0;
      const alreadyDmg = pendingDmg[enemy.k];
      const stillNeed  = enemy.troops - alreadyDmg;
      if (stillNeed <= 0) continue;

      const avail = attackers
        .filter(u => !assigned.has(u.k))
        .sort((a, b) => {
          const aOpts = enemyTilesAll.filter(e => canAttack(a.q, a.r, e.q, e.r)).length;
          const bOpts = enemyTilesAll.filter(e => canAttack(b.q, b.r, e.q, e.r)).length;
          return aOpts - bOpts;
        });

      if (avail.length < stillNeed) continue;

      for (let i = 0; i < stillNeed; i++) {
        const u = avail[i];
        assigned.add(u.k);
        pendingDmg[enemy.k]++;
        plans[myOwner].push({ kind: 'attack', from: { q: u.q, r: u.r }, to: { q: enemy.q, r: enemy.r } });
        addLog(`AI P${myOwner} KO (${u.q},${u.r})\u2192(${enemy.q},${enemy.r})`, 'log-attack');
      }
    }
  }

  // ── Phase 2: Remaining units ──────────────────────────────────────────────
  const myTroops    = myTilesAll.reduce((s, t) => s + t.troops, 0);
  const enemyTroops = enemyTilesAll.reduce((s, t) => s + t.troops, 0);
  const blitz       = enemyTroops > 0 && myTroops >= enemyTroops * 1.4;

  let ecx = 0, ecy = 0;
  if (enemyTroops > 0) {
    for (const e of enemyTilesAll) { ecx += e.q * e.troops; ecy += e.r * e.troops; }
    ecx /= enemyTroops; ecy /= enemyTroops;
  }

  myTilesAll.sort((a, b) => {
    const ah = hillRange(a.type);
    const bh = hillRange(b.type);
    return bh - ah || b.troops - a.troops;
  });

  for (const { q, r, k } of myTilesAll) {
    if (assigned.has(k)) continue;

    // Attack remaining — prefer targets already taking damage
    const atkTargets = [];
    for (const enemy of enemyTilesAll) {
      if (!canAttack(q, r, enemy.q, enemy.r)) continue;
      const dmg = pendingDmg[enemy.k] || 0;
      atkTargets.push({ ...enemy, remainingHP: enemy.troops - dmg });
    }
    if (atkTargets.length > 0) {
      atkTargets.sort((a, b) => {
        const aFocused = (pendingDmg[a.k] || 0) > 0 ? 0 : 1;
        const bFocused = (pendingDmg[b.k] || 0) > 0 ? 0 : 1;
        return aFocused - bFocused || a.remainingHP - b.remainingHP;
      });
      const t = atkTargets[0];
      pendingDmg[t.k] = (pendingDmg[t.k] || 0) + 1;
      assigned.add(k);
      plans[myOwner].push({ kind: 'attack', from: { q, r }, to: { q: t.q, r: t.r } });
      addLog(`AI P${myOwner} attacks (${q},${r})\u2192(${t.q},${t.r})`, 'log-attack');
      continue;
    }

    // Move — scored positioning
    const moveable = getAIMoveOptionsFor(q, r, myOwner);
    const curTile  = tiles.get(hexKey(q, r));
    const curRange = getTileRange(curTile);

    let stayScore = 0;
    const spawnProg = curTile.ownedTurns || 0;
    stayScore += spawnProg * 4;
    if (spawnProg === SPAWN_TURNS - 1) stayScore += 10;
    if (curTile.troops < MAX_TROOPS) stayScore += 3;
    if (isHillType(curTile.type)) stayScore += 4 + hillRange(curTile.type) + hillVisibility(curTile.type) * 2;
    if (enemyTilesAll.length > 0) {
      const curCoverage = enemyTilesAll.filter(e => hexDist(q, r, e.q, e.r) <= curRange).length;
      stayScore += curCoverage * 4;
      if (enemyTilesAll.some(e => hexDist(q, r, e.q, e.r) === 1)) stayScore += 6;
      stayScore += flankBonus(q, r, enemyTilesAll, myOwner);
    } else {
      stayScore += 4;
    }
    stayScore += stormPenalty(q, r);
    if (blitz) stayScore -= 5;

    let best = null, bestScore = stayScore;
    for (const mt of moveable) {
      const destType  = tiles.get(hexKey(mt.q, mt.r)).type;
      const destRange = getTileRange(tiles.get(hexKey(mt.q, mt.r)));
      let score = 0;

      if (isHillType(destType)) score += 4 + hillRange(destType) + hillVisibility(destType) * 2;

      if (enemyTilesAll.length > 0) {
        const coverage = enemyTilesAll.filter(e => hexDist(mt.q, mt.r, e.q, e.r) <= destRange).length;
        score += coverage * 4;
        const adjEnemy = enemyTilesAll.some(e => hexDist(mt.q, mt.r, e.q, e.r) === 1);
        if (adjEnemy) score += 6;
        const curDist  = Math.sqrt((q - ecx) ** 2 + (r - ecy) ** 2);
        const newDist  = Math.sqrt((mt.q - ecx) ** 2 + (mt.r - ecy) ** 2);
        score += (curDist - newDist) * 3;
        score += flankBonus(mt.q, mt.r, enemyTilesAll, myOwner);
      } else {
        score += -hexDist(0, 0, mt.q, mt.r);
      }

      if (blitz) {
        const nearestGap = Math.min(...enemyTilesAll.map(e => hexDist(mt.q, mt.r, e.q, e.r)));
        score += (HEX_RADIUS * 2 - nearestGap) * 3;
      }

      score += stormPenalty(mt.q, mt.r);

      if (score > bestScore) { bestScore = score; best = mt; }
    }
    if (best) {
      plans[myOwner].push({ kind: 'move', from: { q, r }, to: best });
      addLog(`AI P${myOwner} moves (${q},${r})\u2192(${best.q},${best.r})`, 'log-move');
    }
  }
}

// ─── Win condition ────────────────────────────────────────────────────────────
function checkWin() {
  const alive = getAlivePlayers();
  updateHUD();

  if (alive.length === 0) {
    // All eliminated simultaneously — tiebreaker by pre-resolve troops
    let best = null, bestTroops = -1;
    for (const p of getActivePlayers()) {
      const troops = preResolveTroops[p] || 0;
      if (troops > bestTroops) { bestTroops = troops; best = p; }
    }
    if (best !== null && bestTroops > 0) showWin(`Player ${best} Wins! (Last standing)`);
    else showWin('Draw!');
    return true;
  }

  if (alive.length === 1) {
    showWin(`Player ${alive[0]} Wins!`);
    return true;
  }

  // Storm timeout
  if (getStormRadius() < 0) {
    let bestP = null, bestTiles = -1, bestTroops = -1;
    for (const p of alive) {
      let tc = 0, tt = 0;
      for (const tile of tiles.values()) {
        if (tile.owner === p) { tc++; tt += tile.troops; }
      }
      if (tc > bestTiles || (tc === bestTiles && tt > bestTroops)) {
        bestP = p; bestTiles = tc; bestTroops = tt;
      }
    }
    if (bestP !== null) showWin(`Player ${bestP} Wins! (Territory)`);
    else showWin('Draw!');
    return true;
  }

  return false;
}

function showWin(msg) {
  document.getElementById('pass-overlay').classList.add('hidden');
  document.getElementById('win-title').textContent = msg;
  document.getElementById('win-overlay').classList.remove('hidden');
}

// ─── Mobile / Touch ───────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 700; }

function initMobileUI() {
  const toggle  = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  toggle.addEventListener('click', () => { sidebar.classList.toggle('open'); });

  document.addEventListener('pointerdown', (e) => {
    if (sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== toggle) {
      sidebar.classList.remove('open');
    }
  });

  document.getElementById('m-btn-move').addEventListener('click',   onBtnMove);
  document.getElementById('m-btn-attack').addEventListener('click', onBtnAttack);
  document.getElementById('m-btn-undo').addEventListener('click',   onBtnUndo);
  document.getElementById('m-btn-done').addEventListener('click',   onBtnDone);
}

function updateMobileBar() {
  if (!isMobile()) return;
  const mPhase = document.getElementById('mobile-phase');
  const mMove  = document.getElementById('m-btn-move');
  const mAtk   = document.getElementById('m-btn-attack');
  const mUndo  = document.getElementById('m-btn-undo');

  const currentOwner = phaseOwner();

  if (pendingAction === 'move') {
    mPhase.textContent = `P${currentOwner}: Tap a tile to move to`;
  } else if (pendingAction === 'attack') {
    mPhase.textContent = `P${currentOwner}: Tap a target to attack`;
  } else if (selected) {
    const tile = tiles.get(hexKey(selected.q, selected.r));
    const hasMoved    = plans[currentOwner].some(p => p.kind === 'move'   && p.from.q === selected.q && p.from.r === selected.r);
    const hasAttacked = plans[currentOwner].some(p => p.kind === 'attack' && p.from.q === selected.q && p.from.r === selected.r);
    mMove.disabled  = hasMoved    || tile.owner !== currentOwner || tile.troops === 0;
    mAtk.disabled   = hasAttacked || tile.owner !== currentOwner || tile.troops === 0;
    mPhase.textContent = `P${currentOwner}: (${selected.q},${selected.r}) selected`;
  } else {
    mPhase.textContent = `P${currentOwner}'s Turn \u2014 Tap a tile`;
    mMove.disabled  = true;
    mAtk.disabled   = true;
  }
  mUndo.disabled = !plans[currentOwner] || plans[currentOwner].length === 0;
}

function initTouchZoom() {
  let lastPinchDist = 0;
  let lastTouchX = 0, lastTouchY = 0;
  let isPanning = false;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      isPanning = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist = Math.hypot(dx, dy);
    } else if (e.touches.length === 1) {
      isPanning = true;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      isPanning = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastPinchDist > 0) {
        const scale = dist / lastPinchDist;
        const newZoom = zoomLevel * scale;
        zoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
        resizeCanvas();
        render();
      }
      lastPinchDist = dist;
    } else if (e.touches.length === 1 && isPanning) {
      e.preventDefault();
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      const scaleX = canvas.width  / canvas.getBoundingClientRect().width;
      const scaleY = canvas.height / canvas.getBoundingClientRect().height;
      panX += dx * scaleX;
      panY += dy * scaleY;
      clampPan();
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      render();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    lastPinchDist = 0;
    isPanning = false;
  }, { passive: true });
}

function initMousePan() {
  let dragging = false, lastMX = 0, lastMY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2) {
      dragging = true; lastMX = e.clientX; lastMY = e.clientY;
      e.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const scaleX = canvas.width  / canvas.getBoundingClientRect().width;
    const scaleY = canvas.height / canvas.getBoundingClientRect().height;
    panX += (e.clientX - lastMX) * scaleX;
    panY += (e.clientY - lastMY) * scaleY;
    clampPan();
    lastMX = e.clientX; lastMY = e.clientY;
    render();
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button === 1 || e.button === 2) dragging = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
