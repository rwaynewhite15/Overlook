// ─── Constants ───────────────────────────────────────────────────────────────
const HEX_RADIUS = 3;  // hex grid radius → 37 hexes total
const TILE_EMPTY     = 0;
const TILE_WALL      = 1;
const TILE_HILL      = 2; // range 4  (low)
const TILE_HILL_MED  = 3; // range 6  (medium)
const TILE_HILL_TALL = 4; // range 8  (tall)

const OWNER_NONE = 0;
const OWNER_P1   = 1;
const OWNER_P2   = 2;

const PHASE_P1   = 'p1';
const PHASE_P2   = 'p2';

const BASE_RANGE = 2;

// Hill helpers (defined after tile constants so they can be const arrows)
const isHillType     = t => t === TILE_HILL || t === TILE_HILL_MED || t === TILE_HILL_TALL;
const hillRange      = t => t === TILE_HILL_TALL ? 8 : t === TILE_HILL_MED ? 6 : 4;
const hillVisibility = t => t === TILE_HILL_TALL ? 3 : t === TILE_HILL_MED ? 2 : 1;
const getTileRange   = tile => isHillType(tile.type) ? hillRange(tile.type) : BASE_RANGE;
const MAX_TROOPS              = 10;
const FORTIFICATION_MISS_CHANCE = 0.5;
const SPAWN_TURNS             = 3;

// Storm: shrinking safe zone forces engagement
const STORM_START_TURN     = 10;  // storm first strikes after this turn
const STORM_SHRINK_INTERVAL = 4;  // shrinks every N turns after start
const STORM_DAMAGE          = 2;  // damage per turn to troops in storm

const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 4;
const ZOOM_STEP = 0.15;

// Flat-top hex cube directions [dq, dr]
// Keys:  T=NW  Y=NE  H=E  B=SE  V=SW  F=W
const HEX_DIRS = [[0,-1],[1,-1],[1,0],[0,1],[-1,1],[-1,0]];

// ─── State ────────────────────────────────────────────────────────────────────
let tiles         = new Map(); // hexKey(q,r) → {type, owner, troops, ownedTurns}
let plans         = { [OWNER_P1]: [], [OWNER_P2]: [] };
let phase         = PHASE_P1;
let turnNum       = 1;
let selected      = null;      // {q, r}
let pendingAction = null;
let eventLog      = [];
let validMoveTiles = new Set();
let validAtkTiles  = new Set();
let tooltipTile   = null;      // {q, r}
let zoomLevel     = 1;
let aiDifficulty   = 'off';
let aiDifficultyP1 = 'off';
let aiVsAiPaused   = false;
let aiVsAiTimerId  = null;
const AI_VS_AI_DELAY = 900;
let cursor        = null;      // {q, r}
let preResolveTroops = { p1: 0, p2: 0 }; // snapshot for tiebreaker

// Fog of War: tracks which enemy tiles each player can see
// revealedTiles[OWNER_P1] = set of hexKeys that P1 can see (enemy tiles revealed to P1)
let revealedTiles = { [OWNER_P1]: new Set(), [OWNER_P2]: new Set() };

// Canvas
let canvas, ctx, hexSize;

// Audio
let audioCtx = null;

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

// Neighbours that exist in the current map
function hexNeighbors(q, r) {
  return HEX_DIRS.map(([dq, dr]) => [q + dq, r + dr]).filter(([nq, nr]) => tiles.has(hexKey(nq, nr)));
}
// All 6 geometric neighbours (may be outside map)
function hexNeighborsAll(q, r) {
  return HEX_DIRS.map(([dq, dr]) => [q + dq, r + dr]);
}

// Flat-top pixel centre for axial (q, r)
function hexToPixel(q, r) {
  return {
    x: hexSize * (3 / 2) * q,
    y: hexSize * (Math.sqrt(3) / 2 * q + Math.sqrt(3) * r),
  };
}

// Pixel (relative to canvas centre) → nearest hex axial coords
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

// Draw a flat-top hex outline path (no fill/stroke called here)
function hexPath(cx, cy, s) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 3 * i; // 0°, 60°, … (flat-top vertices)
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

  generateMap();
  phase          = PHASE_P1;
  turnNum        = 1;
  plans          = { [OWNER_P1]: [], [OWNER_P2]: [] };
  selected       = null;
  pendingAction  = null;
  eventLog       = [];
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  tooltipTile    = null;
  cursor         = null;

  resizeCanvas();
  render();
  updateHUD();
  updatePhaseLabel();
  clearLog();

  window.addEventListener('resize', () => { resizeCanvas(); render(); });
  canvas.addEventListener('pointerdown', onCanvasClick);
  canvas.addEventListener('mousemove',   onCanvasHover);
  canvas.addEventListener('mouseleave',  onCanvasLeave);
  canvas.addEventListener('wheel',       onCanvasWheel, { passive: false });
  initTouchZoom();
  initMobileUI();
  document.getElementById('btn-move').addEventListener('click',   onBtnMove);
  document.getElementById('btn-attack').addEventListener('click', onBtnAttack);
  document.getElementById('btn-cancel').addEventListener('click', onBtnCancel);
  document.getElementById('btn-undo').addEventListener('click',   onBtnUndo);
  document.getElementById('btn-done').addEventListener('click',   onBtnDone);
  document.getElementById('pass-btn').addEventListener('click',   onPassReady);
  document.getElementById('new-game-btn').addEventListener('click',     newGame);
  document.getElementById('new-game-win-btn').addEventListener('click', newGame);
  document.getElementById('ai-difficulty').addEventListener('change', e => {
    aiDifficulty = e.target.value;
    clearTimeout(aiVsAiTimerId);
    updatePhaseLabel();
  });
  document.getElementById('ai-difficulty-p1').addEventListener('change', e => {
    aiDifficultyP1 = e.target.value;
    clearTimeout(aiVsAiTimerId);
    updatePhaseLabel();
  });
  document.getElementById('ai-vs-ai-pause').addEventListener('click', toggleAiVsAiPause);
  document.addEventListener('keydown', onKeyDown);
}

function newGame() {
  document.getElementById('win-overlay').classList.add('hidden');
  document.getElementById('pass-overlay').classList.add('hidden');
  generateMap();
  phase          = PHASE_P1;
  turnNum        = 1;
  plans          = { [OWNER_P1]: [], [OWNER_P2]: [] };
  selected       = null;
  pendingAction  = null;
  eventLog       = [];
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  tooltipTile    = null;
  zoomLevel      = 1;
  cursor         = null;
  aiVsAiPaused   = false;
  revealedTiles  = { [OWNER_P1]: new Set(), [OWNER_P2]: new Set() };
  clearTimeout(aiVsAiTimerId);
  render();
  updateHUD();
  updatePhaseLabel(); // calls scheduleAiTurnIfNeeded if needed
  clearLog();
  hideTileInfo();
}

// ─── Map Generation ───────────────────────────────────────────────────────────
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

  // Clear spawn corners and their immediate neighbours
  const clearAround = (q, r) => {
    const t = tiles.get(hexKey(q, r));
    if (t) t.type = TILE_EMPTY;
    for (const [nq, nr] of hexNeighbors(q, r)) tiles.get(hexKey(nq, nr)).type = TILE_EMPTY;
  };
  clearAround(-HEX_RADIUS, 0);
  clearAround( HEX_RADIUS, 0);

  // Starting troops: P1 on left, P2 on right
  const p1 = tiles.get(hexKey(-HEX_RADIUS, 0));
  const p2 = tiles.get(hexKey( HEX_RADIUS, 0));
  p1.owner = OWNER_P1; p1.troops = 1;
  p2.owner = OWNER_P2; p2.troops = 1;
}

// ─── Canvas resize ────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('grid-wrapper');
  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight, 600);
  // Bounding box in "size=1" units: width ≈ 3R+2.5, height ≈ sqrt(3)*(2R+1)
  const wUnits = 3 * HEX_RADIUS + 2.5;
  const hUnits = Math.sqrt(3) * (2 * HEX_RADIUS + 1);
  const base   = Math.floor(size / Math.max(wUnits, hUnits));
  hexSize = Math.max(6, Math.floor(base * zoomLevel));
  canvas.width  = Math.ceil(hexSize * wUnits * 1.06);
  canvas.height = Math.ceil(hexSize * hUnits * 1.06);
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(flashMoves, flashAttacks) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const originX = canvas.width  / 2;
  const originY = canvas.height / 2;

  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const currentPlans = plans[currentOwner];

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

  // Hex borders on top
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
  // Top sheen
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
    // ── Tall mountain: rocky grey with snow cap ──
    const bg = ctx.createRadialGradient(cx, cy, s * 0.05, cx, cy, s);
    bg.addColorStop(0,   '#a0a89a');
    bg.addColorStop(0.5, '#5a6450');
    bg.addColorStop(1,   '#2a3028');
    hexPath(cx, cy, s); ctx.fillStyle = bg; ctx.fill();
    // Snow cap
    const sg = ctx.createRadialGradient(cx - s * 0.08, cy - s * 0.18, 0, cx, cy, s * 0.42);
    sg.addColorStop(0,   'rgba(255,255,255,0.95)');
    sg.addColorStop(0.45,'rgba(220,232,245,0.55)');
    sg.addColorStop(1,   'rgba(180,195,210,0)');
    hexPath(cx, cy, s); ctx.fillStyle = sg; ctx.fill();
    // Three triangles
    ctx.fillStyle    = 'rgba(50,45,40,0.88)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.28))}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u25b2\u25b2\u25b2', cx, cy + s * 0.08);
    // Range badge
    ctx.fillStyle    = 'rgba(255,255,255,0.72)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.22))}px sans-serif`;
    ctx.fillText('8', cx, cy - s * 0.32);
  } else if (tileType === TILE_HILL_MED) {
    // ── Medium hill: deep green with rocky top hint ──
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
    // Rocky grey hint at peak
    const rg = ctx.createRadialGradient(cx, cy - s * 0.18, 0, cx, cy, s * 0.36);
    rg.addColorStop(0,   'rgba(155,145,115,0.42)');
    rg.addColorStop(1,   'rgba(155,145,115,0)');
    hexPath(cx, cy, s); ctx.fillStyle = rg; ctx.fill();
    // Two triangles
    ctx.fillStyle    = 'rgba(38,68,22,0.92)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.36))}px serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u25b2\u25b2', cx, cy + s * 0.06);
    // Range badge
    ctx.fillStyle    = 'rgba(200,245,145,0.78)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.22))}px sans-serif`;
    ctx.fillText('6', cx, cy - s * 0.3);
  } else {
    // ── Standard low hill (range 4) ──
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
    // Range badge
    ctx.fillStyle    = 'rgba(200,245,145,0.75)';
    ctx.font         = `bold ${Math.max(5, Math.floor(s * 0.22))}px sans-serif`;
    ctx.fillText('4', cx, cy - s * 0.3);
  }
}

// ─── Fog of War helpers ───────────────────────────────────────────────────────
function isTileHiddenForViewer(q, r, viewer) {
  if (isAiVsAi()) return false; // spectators see everything
  const tile = tiles.get(hexKey(q, r));
  if (!tile) return false;
  if (tile.owner === OWNER_NONE || tile.owner === viewer) return false;
  // Revealed by attacking
  if (revealedTiles[viewer].has(hexKey(q, r))) return false;
  // Hill vision: viewer's troops on hills can spot nearby enemies
  for (const [hq, hr] of allHexes()) {
    const ht = tiles.get(hexKey(hq, hr));
    if (!ht || ht.owner !== viewer || ht.troops <= 0) continue;
    if (!isHillType(ht.type)) continue;
    const vis = hillVisibility(ht.type);
    if (hexDist(hq, hr, q, r) <= vis) return false;
  }
  return true;
}

function isOwnTileSpotted(q, r, owner) {
  if (isAiVsAi()) return false;
  const enemy = owner === OWNER_P1 ? OWNER_P2 : OWNER_P1;
  // Spotted if you attacked (revealed to enemy)
  if (revealedTiles[enemy].has(hexKey(q, r))) return true;
  // Spotted if enemy has a hill with vision on you
  for (const [hq, hr] of allHexes()) {
    const ht = tiles.get(hexKey(hq, hr));
    if (!ht || ht.owner !== enemy || ht.troops <= 0) continue;
    if (!isHillType(ht.type)) continue;
    if (hexDist(hq, hr, q, r) <= hillVisibility(ht.type)) return true;
  }
  return false;
}

// ─── Hex cell drawing ─────────────────────────────────────────────────────────
function drawHex(q, r, cx, cy, moveFromSet, moveToSet, atkFromSet, atkToSet, flashMoves, flashAttacks) {
  const tile = tiles.get(hexKey(q, r));
  if (!tile) return;
  const s = hexSize;
  const k = hexKey(q, r);

  // Fog of War: determine visibility
  const currentViewer = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
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

  // 3. Ownership tint + border (hidden in fog of war)
  if (tile.type !== TILE_WALL && !hidden) {
    if (tile.owner === OWNER_P1) {
      hexPath(cx, cy, s); ctx.fillStyle   = 'rgba(60,110,230,0.22)'; ctx.fill();
      hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(80,150,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    } else if (tile.owner === OWNER_P2) {
      hexPath(cx, cy, s); ctx.fillStyle   = 'rgba(220,50,50,0.22)'; ctx.fill();
      hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(255,80,80,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }

  // 4. Flash animation overlays
  if (flashMoves   && flashMoves.has(k))   { hexPath(cx, cy, s); ctx.fillStyle = 'rgba(80,160,255,0.55)'; ctx.fill(); }
  if (flashAttacks && flashAttacks.has(k)) { hexPath(cx, cy, s); ctx.fillStyle = 'rgba(255,60,60,0.55)';  ctx.fill(); }

  // 5. Range highlights
  if (validMoveTiles.has(k) && tile.type !== TILE_WALL) {
    hexPath(cx, cy, s); ctx.fillStyle   = 'rgba(80,160,255,0.28)';   ctx.fill();
    hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(100,180,255,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  if (validAtkTiles.has(k)) {
    hexPath(cx, cy, s); ctx.fillStyle   = 'rgba(255,60,60,0.28)';    ctx.fill();
    hexPath(cx, cy, s); ctx.strokeStyle = 'rgba(255,100,100,0.75)'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // 6. Selected glow (double ring)
  if (selected && selected.q === q && selected.r === r) {
    hexPath(cx, cy, s);
    ctx.strokeStyle = 'rgba(255,220,0,0.95)'; ctx.lineWidth = 3; ctx.stroke();
    hexPath(cx, cy, s * 0.78);
    ctx.strokeStyle = 'rgba(255,200,0,0.35)'; ctx.lineWidth = 5; ctx.stroke();
  }

  // 6b. Keyboard cursor (cyan dashed ring)
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

  // 8. Troop badge (hidden in fog of war)
  if (tile.type !== TILE_WALL && tile.troops > 0 && !hidden)
    drawTroopBadge(cx, cy, s, tile.troops, tile.owner);

  // 9. Spawn counter dots (hidden in fog of war)
  if (tile.type !== TILE_WALL && tile.owner !== OWNER_NONE && tile.troops > 0 && !hidden)
    drawSpawnCounter(cx, cy, s, tile.ownedTurns);

  // 9b. "Spotted" indicator — own tile visible to enemy
  if (tile.owner === currentViewer && tile.troops > 0 && isOwnTileSpotted(q, r, currentViewer)) {
    const ey = cy - s * 0.58;
    const er = Math.max(3, Math.floor(s * 0.15));
    // orange diamond
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
    // eye icon
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
  if (turnNum >= STORM_START_TURN && distCenter > safeRadius) {
    // Active storm — purple haze
    hexPath(cx, cy, s);
    ctx.fillStyle = 'rgba(100, 20, 140, 0.38)';
    ctx.fill();
    // Swirl marks
    ctx.save();
    hexPath(cx, cy, s); ctx.clip();
    ctx.globalAlpha = 0.18;
    ctx.font = `${Math.max(6, Math.floor(s * 0.4))}px serif`;
    ctx.fillStyle = '#e2b0ff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u26a1', cx, cy);
    ctx.globalAlpha = 1;
    ctx.restore();
  } else if (turnNum >= STORM_START_TURN - 2 && distCenter === safeRadius + 1 && distCenter <= HEX_RADIUS) {
    // Warning zone — this ring will be storm in the next shrink
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

  ctx.fillStyle = owner === OWNER_P1 ? '#1840a0' : owner === OWNER_P2 ? '#961818' : '#383838';
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
  const currentViewer = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const hidden = isTileHiddenForViewer(q, r, currentViewer);
  const typeStr  = TILE_TYPE_LABELS[tile.type] ?? 'Unknown';
  const ownerStr = hidden ? '???' : tile.owner === OWNER_P1 ? 'P1' : tile.owner === OWNER_P2 ? 'P2' : 'None';
  const range    = getTileRange(tile);
  const inStorm  = hexDist(0, 0, q, r) > getStormRadius() && turnNum >= STORM_START_TURN;
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
  let p1c = 0, p2c = 0;
  for (const tile of tiles.values()) {
    if (tile.owner === OWNER_P1) p1c++;
    if (tile.owner === OWNER_P2) p2c++;
  }
  document.getElementById('p1-tiles').textContent = `Tiles: ${p1c}`;
  document.getElementById('p2-tiles').textContent = `Tiles: ${p2c}`;
  document.getElementById('turn-num').textContent  = turnNum;

  // Storm HUD
  const stormEl = document.getElementById('storm-info');
  const safeR   = getStormRadius();
  if (turnNum < STORM_START_TURN) {
    const turnsLeft = STORM_START_TURN - turnNum;
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

// ─── AI vs AI helpers ───────────────────────────────────────────────────────
function isAiVsAi() { return aiDifficultyP1 !== 'off' && aiDifficulty !== 'off'; }

function toggleAiVsAiPause() {
  aiVsAiPaused = !aiVsAiPaused;
  const btn = document.getElementById('ai-vs-ai-pause');
  btn.textContent = aiVsAiPaused ? '▶ Resume' : '⏸ Pause';
  if (!aiVsAiPaused) scheduleAiTurnIfNeeded();
  const p1IsAi = aiDifficultyP1 !== 'off';
  const p2IsAi = aiDifficulty   !== 'off';
  const status = aiVsAiPaused ? '⏸ Paused' : '▶ Running';
  if (p1IsAi && p2IsAi)
    document.getElementById('phase-label').textContent = `AI vs AI — Turn ${turnNum}  [${status}]`;
}

function scheduleAiTurnIfNeeded() {
  clearTimeout(aiVsAiTimerId);
  aiVsAiTimerId = null;
  if (aiVsAiPaused) return;
  const p1IsAi = aiDifficultyP1 !== 'off';
  const p2IsAi = aiDifficulty   !== 'off';
  const currentIsAi = (phase === PHASE_P1 && p1IsAi) || (phase === PHASE_P2 && p2IsAi);
  if (!currentIsAi) return;
  aiVsAiTimerId = setTimeout(doAiTurn, AI_VS_AI_DELAY);
}

function doAiTurn() {
  aiVsAiTimerId = null;
  if (phase === PHASE_P1 && aiDifficultyP1 !== 'off') {
    makeAIPlansFor(OWNER_P1, aiDifficultyP1);
    onBtnDone();
  } else if (phase === PHASE_P2 && aiDifficulty !== 'off') {
    makeAIPlansFor(OWNER_P2, aiDifficulty);
    animateAndResolveTurn();
  }
}

function updatePhaseLabel() {
  const p1IsAi = aiDifficultyP1 !== 'off';
  const p2IsAi = aiDifficulty   !== 'off';
  const ai2ai  = p1IsAi && p2IsAi;

  document.getElementById('ai-vs-ai-pause').classList.toggle('hidden', !ai2ai);

  let label;
  if (ai2ai) {
    const status = aiVsAiPaused ? '⏸ Paused' : '▶ Running';
    label = `AI vs AI — Turn ${turnNum}  [${status}]`;
  } else if (phase === PHASE_P1) {
    label = p1IsAi
      ? `AI P1 (${aiDifficultyP1}) is planning…`
      : "Player 1's Turn — Select a tile";
  } else {
    label = p2IsAi
      ? `AI P2 (${aiDifficulty}) is planning…`
      : "Player 2's Turn — Select a tile";
  }
  document.getElementById('phase-label').textContent = label;
  updatePlanCounter();
  updateMobileBar();
  scheduleAiTurnIfNeeded();
}

function showTileInfo(q, r) {
  const tile = tiles.get(hexKey(q, r));
  if (!tile) return;
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const hidden = isTileHiddenForViewer(q, r, currentOwner);
  const typeStr  = TILE_TYPE_LABELS[tile.type] ?? 'Unknown';
  const ownerStr = hidden ? '???' : tile.owner === OWNER_P1 ? 'Player 1' : tile.owner === OWNER_P2 ? 'Player 2' : 'None';
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
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const currentPlans = plans[currentOwner];
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
  if (eventLog.length > 10) eventLog.pop();
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
  const px = (e.clientX - rect.left) * (canvas.width  / rect.width)  - canvas.width  / 2;
  const py = (e.clientY - rect.top)  * (canvas.height / rect.height) - canvas.height / 2;
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
  const px = (e.clientX - rect.left) * (canvas.width  / rect.width)  - canvas.width  / 2;
  const py = (e.clientY - rect.top)  * (canvas.height / rect.height) - canvas.height / 2;
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
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  if (plans[currentOwner].length === 0) return;
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

  // ── Flat-top hex navigation: T Y H B V F ─────────────────────────────────
  // T=NW(0,-1)  Y=NE(+1,-1)  H=E(+1,0)  B=SE(0,+1)  V=SW(-1,+1)  F=W(-1,0)
  const hexKeyMap = { t:[0,-1], y:[1,-1], h:[1,0], b:[0,1], v:[-1,1], f:[-1,0] };
  const lk = e.key.toLowerCase();
  if (lk in hexKeyMap) {
    e.preventDefault();
    moveCursor(...hexKeyMap[lk]);
    return;
  }

  // ── Arrow keys: 4 of the 6 hex directions ────────────────────────────────
  const arrowMap = { ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1] };
  if (e.key in arrowMap) {
    e.preventDefault();
    moveCursor(...arrowMap[e.key]);
    return;
  }

  // ── Enter / Space ─────────────────────────────────────────────────────────
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    const passOverlay = document.getElementById('pass-overlay');
    if (!passOverlay.classList.contains('hidden')) { onPassReady(); return; }
    if (cursor) {
      playSound('select');
      handleTileClick(cursor.q, cursor.r);
    } else {
      onBtnDone();
    }
    return;
  }

  // ── Letter shortcuts ──────────────────────────────────────────────────────
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
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
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
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const result = new Set();
  for (const [tq, tr] of allHexes()) {
    const t = tiles.get(hexKey(tq, tr));
    if (!t || t.owner === OWNER_NONE || t.owner === currentOwner) continue;
    // Fog of War: can only target revealed enemies (AI bypasses this via own logic)
    if (isTileHiddenForViewer(tq, tr, currentOwner)) continue;
    if (canAttack(q, r, tq, tr)) result.add(hexKey(tq, tr));
  }
  return result;
}

// ─── Planning ─────────────────────────────────────────────────────────────────
function tryPlanMove(q, r) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
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
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
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

// ─── Turn / Done ──────────────────────────────────────────────────────────────
function onBtnDone() {
  if (phase === PHASE_P1) {
    selected       = null;
    pendingAction  = null;
    validMoveTiles = new Set();
    validAtkTiles  = new Set();
    render();
    hideTileInfo();
    if (aiDifficulty !== 'off') {
      // P2 is AI — plan and resolve immediately (covers AI vs AI and human P1 vs AI P2)
      makeAIPlans();
      animateAndResolveTurn();
    } else {
      // P2 is human — show pass overlay
      document.getElementById('pass-title').textContent = 'Pass to Player 2';
      document.getElementById('pass-msg').textContent   = 'Player 1 has finished planning. Hand the device to Player 2.';
      document.getElementById('resolution-summary').classList.add('hidden');
      document.getElementById('pass-overlay').classList.remove('hidden');
      document.getElementById('ai-difficulty').disabled = true;
      phase = PHASE_P2;
    }
  } else {
    document.getElementById('pass-overlay').classList.add('hidden');
    animateAndResolveTurn();
  }
}

function onPassReady() {
  document.getElementById('pass-overlay').classList.add('hidden');
  document.getElementById('ai-difficulty').disabled = false;
  selected       = null;
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  hideTileInfo();
  updatePhaseLabel();
}

// ─── Animated turn resolution ─────────────────────────────────────────────────
function animateAndResolveTurn() {
  const flashMoveSet = new Set();
  const flashAtkSet  = new Set();
  for (const owner of [OWNER_P1, OWNER_P2]) {
    for (const p of plans[owner]) {
      if (p.kind === 'move')   flashMoveSet.add(hexKey(p.to.q, p.to.r));
      if (p.kind === 'attack') flashAtkSet.add(hexKey(p.to.q,  p.to.r));
    }
  }
  render(flashMoveSet, flashAtkSet);
  setTimeout(resolveTurn, 500);
}

// ─── Turn Resolution ──────────────────────────────────────────────────────────
function resolveTurn() {
  const summary = { moves: 0, attacks: 0, kills: 0, mutual: 0 };

  // Snapshot troop totals for draw tiebreaker
  preResolveTroops = { p1: 0, p2: 0 };
  for (const tile of tiles.values()) {
    if (tile.owner === OWNER_P1) preResolveTroops.p1 += tile.troops;
    if (tile.owner === OWNER_P2) preResolveTroops.p2 += tile.troops;
  }

  // Clear previous fog-of-war reveals (new ones set in resolveAttacks)
  revealedTiles[OWNER_P1] = new Set();
  revealedTiles[OWNER_P2] = new Set();

  resolveMovement(summary);
  resolveAttacks(summary);
  resolveSpawn();
  resolveStorm(summary);

  turnNum++;
  plans          = { [OWNER_P1]: [], [OWNER_P2]: [] };
  phase          = PHASE_P1;
  selected       = null;
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();

  render();
  updateHUD();
  hideTileInfo();

  if (isAiVsAi()) {
    // Spectate mode: skip pass overlay, log summary, auto-continue
    addLog(`Turn ${turnNum - 1} \u2014 ${summary.moves} mv, ${summary.attacks} atk, ${summary.kills} kills`);
    checkWin();
    if (document.getElementById('win-overlay').classList.contains('hidden')) {
      updatePhaseLabel(); // updates label + schedules next AI turn
    }
  } else {
    document.getElementById('pass-title').textContent = `Turn ${turnNum} \u2014 Player 1's Planning Phase`;
    document.getElementById('pass-msg').textContent   = "Results resolved! Now it is Player 1's turn to plan.";
    document.getElementById('ai-difficulty').disabled = false;

    const summaryEl = document.getElementById('resolution-summary');
    summaryEl.classList.remove('hidden');
    document.getElementById('summary-moves').textContent   = summary.moves;
    document.getElementById('summary-attacks').textContent = summary.attacks;
    document.getElementById('summary-kills').textContent   = summary.kills;
    document.getElementById('summary-mutual').textContent  = summary.mutual;

    document.getElementById('pass-overlay').classList.remove('hidden');
    checkWin();
    updatePhaseLabel();
  }
}

function resolveMovement(summary) {
  const moves = [];
  for (const owner of [OWNER_P1, OWNER_P2])
    for (const p of plans[owner]) {
      if (p.kind !== 'move') continue;
      const ft = tiles.get(hexKey(p.from.q, p.from.r));
      if (!ft || ft.owner !== owner || ft.troops === 0) continue;
      moves.push({ owner, from: p.from, to: p.to });
    }

  const destOwners = {};
  for (const mv of moves) {
    const k = hexKey(mv.to.q, mv.to.r);
    if (!destOwners[k]) destOwners[k] = [];
    if (!destOwners[k].includes(mv.owner)) destOwners[k].push(mv.owner);
  }
  const contestedKeys = new Set();
  for (const k in destOwners) {
    const dest = tiles.get(k);
    if (destOwners[k].length >= 2 && dest && dest.owner === OWNER_NONE) {
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
  for (const owner of [OWNER_P1, OWNER_P2])
    for (const p of plans[owner]) {
      if (p.kind !== 'attack') continue;
      const ft = tiles.get(hexKey(p.from.q, p.from.r));
      if (!ft || ft.owner !== owner || ft.troops === 0) continue;
      attacks.push({ owner, from: p.from, to: p.to });
    }

  // Fog of War: every attacker becomes visible to the opponent
  for (const atk of attacks) {
    const enemy = atk.owner === OWNER_P1 ? OWNER_P2 : OWNER_P1;
    revealedTiles[enemy].add(hexKey(atk.from.q, atk.from.r));
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
function getStormRadius() {
  if (turnNum < STORM_START_TURN) return HEX_RADIUS;
  const shrinks = 1 + Math.floor((turnNum - STORM_START_TURN) / STORM_SHRINK_INTERVAL);
  return Math.max(-1, HEX_RADIUS - shrinks);
}

function resolveStorm(summary) {
  const safeR = getStormRadius();
  if (safeR >= HEX_RADIUS) return; // no storm yet
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
function makeAIPlans() { makeAIPlansFor(OWNER_P2, aiDifficulty); }

function makeAIPlansFor(myOwner, difficulty) {
  if      (difficulty === 'easy')   makeAIPlansEasyFor(myOwner);
  else if (difficulty === 'medium') makeAIPlansMediumFor(myOwner);
  else if (difficulty === 'hard')   makeAIPlansHardFor(myOwner);
}

// Fog of War for AI: can this AI player see the given tile?
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

function getUncontrolledHills(myOwner) {
  const hills = [];
  for (const [q, r] of allHexes()) {
    const t = tiles.get(hexKey(q, r));
    if (isHillType(t.type) && t.owner !== myOwner) hills.push({ q, r });
  }
  return hills;
}

function makeAIPlansEasyFor(myOwner) {
  // Pure aggression: always attack weakest enemy in range; always charge nearest enemy.
  const enemyOwner = myOwner === OWNER_P1 ? OWNER_P2 : OWNER_P1;
  plans[myOwner] = [];

  // Strongest units act first so they lead the assault
  const myTileList = [];
  for (const [q, r] of allHexes()) {
    const t = tiles.get(hexKey(q, r));
    if (t.owner === myOwner && t.troops > 0) myTileList.push({ q, r, troops: t.troops });
  }
  myTileList.sort((a, b) => b.troops - a.troops);

  for (const { q, r } of myTileList) {
    if (plans[myOwner].some(p => p.from.q === q && p.from.r === r)) continue;

    // Attack: pick weakest visible enemy in range
    const atkTargets = [];
    for (const [tq, tr] of allHexes()) {
      const t = tiles.get(hexKey(tq, tr));
      if (t.owner === enemyOwner && aiCanSee(tq, tr, myOwner) && canAttack(q, r, tq, tr))
        atkTargets.push({ q: tq, r: tr, troops: t.troops });
    }
    if (atkTargets.length > 0) {
      atkTargets.sort((a, b) => a.troops - b.troops);
      const t = atkTargets[0];
      plans[myOwner].push({ kind: 'attack', from: { q, r }, to: { q: t.q, r: t.r } });
      addLog(`AI P${myOwner} attacks (${q},${r})\u2192(${t.q},${t.r})`, 'log-attack');
      continue;
    }

    // Move: charge nearest visible enemy; if none visible, seek hills for vision
    const moveable = getAIMoveOptionsFor(q, r, myOwner);
    if (moveable.length === 0) continue;
    const enemyTiles = getOwnerTiles(enemyOwner).filter(e => aiCanSee(e.q, e.r, myOwner));
    const safeR = getStormRadius();
    const inStorm = hexDist(0, 0, q, r) > safeR;
    let best = moveable[0], bestScore = -Infinity;
    for (const mt of moveable) {
      const mtStorm = hexDist(0, 0, mt.q, mt.r) > safeR;
      let score = 0;
      if (enemyTiles.length > 0) {
        score = -Math.min(...enemyTiles.map(pt => hexDist(mt.q, mt.r, pt.q, pt.r))) * 2;
      } else {
        // No visible enemies: prefer hills (for vision) and move toward center
        score = -hexDist(0, 0, mt.q, mt.r);
        const destType = tiles.get(hexKey(mt.q, mt.r)).type;
        if (isHillType(destType)) score += 5 + hillVisibility(destType) * 3;
      }
      if (mtStorm) score -= 20;
      if (score > bestScore) { bestScore = score; best = mt; }
    }
    plans[myOwner].push({ kind: 'move', from: { q, r }, to: best });
    addLog(`AI P${myOwner} moves (${q},${r})\u2192(${best.q},${best.r})`, 'log-move');
  }
}

function makeAIPlansMediumFor(myOwner) {
  // Coordinated focus fire + aggressive scored movement. Never idles.
  const enemyOwner = myOwner === OWNER_P1 ? OWNER_P2 : OWNER_P1;
  plans[myOwner] = [];

  // Track damage committed to each target this turn so units can pile on for kills
  const pendingDmg = {};

  const myTileList = [];
  for (const [q, r] of allHexes()) {
    const t = tiles.get(hexKey(q, r));
    if (t.owner === myOwner && t.troops > 0) myTileList.push({ q, r, troops: t.troops });
  }
  // Strongest + hill units act first (most impact up front)
  myTileList.sort((a, b) => {
    const aHill = hillRange(tiles.get(hexKey(a.q, a.r)).type);
    const bHill = hillRange(tiles.get(hexKey(b.q, b.r)).type);
    return bHill - aHill || b.troops - a.troops;
  });

  for (const { q, r } of myTileList) {
    if (plans[myOwner].some(p => p.from.q === q && p.from.r === r)) continue;

    // Build attack options with focus-fire awareness (fog-limited)
    const atkTargets = [];
    for (const [tq, tr] of allHexes()) {
      const t = tiles.get(hexKey(tq, tr));
      if (t.owner !== enemyOwner || !aiCanSee(tq, tr, myOwner) || !canAttack(q, r, tq, tr)) continue;
      const k = hexKey(tq, tr);
      const remainingHP = t.troops - (pendingDmg[k] || 0);
      atkTargets.push({ q: tq, r: tr, troops: t.troops, remainingHP, k });
    }
    if (atkTargets.length > 0) {
      // Kill shots first, then pile onto already-damaged targets, then weakest
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

    // Move: scored by hill value, attack coverage, enemy adjacency, distance
    const moveable = getAIMoveOptionsFor(q, r, myOwner);
    if (moveable.length === 0) continue;
    const enemyTiles = getOwnerTiles(enemyOwner).filter(e => aiCanSee(e.q, e.r, myOwner));

    let best = moveable[0], bestScore = -Infinity;
    for (const mt of moveable) {
      const destType = tiles.get(hexKey(mt.q, mt.r)).type;
      let score = 0;

      if (enemyTiles.length > 0) {
        const distToEnemy = Math.min(...enemyTiles.map(pt => hexDist(mt.q, mt.r, pt.q, pt.r)));
        score = -distToEnemy * 2;

        // Bonus for being adjacent to an enemy (can attack next turn)
        if (enemyTiles.some(pt => hexDist(mt.q, mt.r, pt.q, pt.r) === 1)) score += 5;

        // Bonus for how many enemies we could fire on from this spot
        const range = getTileRange(tiles.get(hexKey(mt.q, mt.r)));
        const coverage = enemyTiles.filter(pt => hexDist(mt.q, mt.r, pt.q, pt.r) <= range).length;
        score += coverage * 3;
      } else {
        // No visible enemies: seek hills for vision, move toward center
        score = -hexDist(0, 0, mt.q, mt.r);
      }

      if (isHillType(destType)) score += 4 + hillRange(destType) + hillVisibility(destType) * 2;

      // Storm avoidance
      const safeR = getStormRadius();
      if (hexDist(0, 0, mt.q, mt.r) > safeR) score -= 15;
      else if (hexDist(0, 0, mt.q, mt.r) === safeR && turnNum >= STORM_START_TURN - 2) score -= 5;

      if (score > bestScore) { bestScore = score; best = mt; }
    }
    plans[myOwner].push({ kind: 'move', from: { q, r }, to: best });
    addLog(`AI P${myOwner} moves (${q},${r})\u2192(${best.q},${best.r})`, 'log-move');
  }
}

function makeAIPlansHardFor(myOwner) {
  // Phase 1: Identify guaranteed kills and assign minimum attackers to secure them.
  // Phase 2: Remaining units attack with focus-fire or move with scored positioning.
  // Blitz mode when dominating: maximum aggression, ignore defensive positioning.
  const enemyOwner  = myOwner === OWNER_P1 ? OWNER_P2 : OWNER_P1;
  plans[myOwner]    = [];

  const enemyTilesAll = getOwnerTiles(enemyOwner)
    .filter(e => aiCanSee(e.q, e.r, myOwner))
    .map(({ q, r }) => ({
      q, r, k: hexKey(q, r),
      troops: tiles.get(hexKey(q, r)).troops,
      type:   tiles.get(hexKey(q, r)).type,
    }));
  const myTilesAll = getOwnerTiles(myOwner).map(({ q, r }) => ({
    q, r, k: hexKey(q, r),
    troops: tiles.get(hexKey(q, r)).troops,
    type:   tiles.get(hexKey(q, r)).type,
  }));

  if (myTilesAll.length === 0) return;

  const pendingDmg = {}; // hexKey → total damage committed this turn
  const assigned   = new Set(); // unit keys that already have a plan

  // ── Phase 1: Kill planning (only if enemies visible) ───────────────────────
  if (enemyTilesAll.length > 0) {
  // For each enemy, collect all friendly units that can attack it.
  // If attackers ≥ enemy.troops, this is a guaranteed kill — commit the minimum.
  const killTargets = enemyTilesAll
    .map(enemy => ({
      enemy,
      attackers: myTilesAll.filter(u => canAttack(u.q, u.r, enemy.q, enemy.r)),
    }))
    .filter(({ enemy, attackers }) => attackers.length >= enemy.troops)
    .sort((a, b) =>
      // Prioritise cheapest kills (fewer troops), then those needing fewest of our units
      a.enemy.troops - b.enemy.troops || a.attackers.length - b.attackers.length
    );

  for (const { enemy, attackers } of killTargets) {
    pendingDmg[enemy.k] = pendingDmg[enemy.k] || 0;
    const alreadyDmg = pendingDmg[enemy.k];
    const stillNeed  = enemy.troops - alreadyDmg;
    if (stillNeed <= 0) continue; // another kill already covered this

    // Choose 'stillNeed' unassigned attackers; prefer units with fewest attack options
    // (save versatile units for other targets)
    const avail = attackers
      .filter(u => !assigned.has(u.k))
      .sort((a, b) => {
        const aOpts = enemyTilesAll.filter(e => canAttack(a.q, a.r, e.q, e.r)).length;
        const bOpts = enemyTilesAll.filter(e => canAttack(b.q, b.r, e.q, e.r)).length;
        return aOpts - bOpts;
      });

    if (avail.length < stillNeed) continue; // can't secure kill without already-assigned units

    for (let i = 0; i < stillNeed; i++) {
      const u = avail[i];
      assigned.add(u.k);
      pendingDmg[enemy.k]++;
      plans[myOwner].push({ kind: 'attack', from: { q: u.q, r: u.r }, to: { q: enemy.q, r: enemy.r } });
      addLog(`AI P${myOwner} KO (${u.q},${u.r})\u2192(${enemy.q},${enemy.r})`, 'log-attack');
    }
  }
  } // end Phase 1 visibility gate

  // ── Phase 2: Remaining units ───────────────────────────────────────────────
  const myTroops    = myTilesAll.reduce((s, t) => s + t.troops, 0);
  const enemyTroops = enemyTilesAll.reduce((s, t) => s + t.troops, 0);
  const blitz       = enemyTroops > 0 && myTroops >= enemyTroops * 1.4;

  // Enemy cluster centroid (troop-weighted) for directional pressure
  // When no enemies visible, default to map center (0,0)
  let ecx = 0, ecy = 0;
  if (enemyTroops > 0) {
    for (const e of enemyTilesAll) { ecx += e.q * e.troops; ecy += e.r * e.troops; }
    ecx /= enemyTroops; ecy /= enemyTroops;
  }

  // Hill units first (wider range = best attackers), then strongest
  myTilesAll.sort((a, b) => {
    const ah = hillRange(a.type);
    const bh = hillRange(b.type);
    return bh - ah || b.troops - a.troops;
  });

  for (const { q, r, k } of myTilesAll) {
    if (assigned.has(k)) continue;

    // A: Attack — prefer targets already taking damage (finish them), then weakest
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

    // B: Move — score each option
    const moveable = getAIMoveOptionsFor(q, r, myOwner);
    if (moveable.length === 0) continue;

    let best = moveable[0], bestScore = -Infinity;
    for (const mt of moveable) {
      const destType = tiles.get(hexKey(mt.q, mt.r)).type;
      const destRange = getTileRange(tiles.get(hexKey(mt.q, mt.r)));
      let score = 0;

      // Hill control: valuable fire + vision platform
      if (isHillType(destType)) score += 4 + hillRange(destType) + hillVisibility(destType) * 2;

      if (enemyTilesAll.length > 0) {
        // How many enemy tiles we can fire on from this position next turn
        const coverage = enemyTilesAll.filter(e => hexDist(mt.q, mt.r, e.q, e.r) <= destRange).length;
        score += coverage * 4;

        // Adjacent to enemy = immediate threat / can attack next turn regardless of range
        const adjEnemy = enemyTilesAll.some(e => hexDist(mt.q, mt.r, e.q, e.r) === 1);
        if (adjEnemy) score += 6;

        // Progress toward enemy cluster center
        const curDist  = Math.sqrt((q - ecx) ** 2 + (r - ecy) ** 2);
        const newDist  = Math.sqrt((mt.q - ecx) ** 2 + (mt.r - ecy) ** 2);
        score += (curDist - newDist) * 3;
      } else {
        // No visible enemies: seek hills and center for vision
        score += -hexDist(0, 0, mt.q, mt.r);
      }

      // In blitz mode, heavily reward closing the nearest gap
      if (blitz) {
        const nearestGap = Math.min(...enemyTilesAll.map(e => hexDist(mt.q, mt.r, e.q, e.r)));
        score += (HEX_RADIUS * 2 - nearestGap) * 3;
      }

      // Storm avoidance
      const safeR = getStormRadius();
      if (hexDist(0, 0, mt.q, mt.r) > safeR) score -= 20;
      else if (hexDist(0, 0, mt.q, mt.r) === safeR && turnNum >= STORM_START_TURN - 2) score -= 6;

      if (score > bestScore) { bestScore = score; best = mt; }
    }
    plans[myOwner].push({ kind: 'move', from: { q, r }, to: best });
    addLog(`AI P${myOwner} moves (${q},${r})\u2192(${best.q},${best.r})`, 'log-move');
  }
}

// ─── Win condition ────────────────────────────────────────────────────────────
function checkWin() {
  let p1c = 0, p2c = 0, p1t = 0, p2t = 0;
  for (const tile of tiles.values()) {
    if (tile.owner === OWNER_P1) { p1c++; p1t += tile.troops; }
    if (tile.owner === OWNER_P2) { p2c++; p2t += tile.troops; }
  }
  updateHUD();

  if (p1c === 0 && p2c === 0) {
    // Tiebreaker: whoever had more troops before this turn's resolution wins
    if (preResolveTroops.p1 > preResolveTroops.p2)      showWin('Player 1 Wins! (Last standing)');
    else if (preResolveTroops.p2 > preResolveTroops.p1) showWin('Player 2 Wins! (Last standing)');
    else                                                 showWin('Draw!');
  }
  else if (p1c === 0)              showWin('Player 2 Wins!');
  else if (p2c === 0)              showWin('Player 1 Wins!');
  // Timeout: if storm has consumed the entire map, most tiles/troops wins
  else if (getStormRadius() < 0) {
    if      (p1c > p2c) showWin('Player 1 Wins! (Territory)');
    else if (p2c > p1c) showWin('Player 2 Wins! (Territory)');
    else if (p1t > p2t) showWin('Player 1 Wins! (Troops)');
    else if (p2t > p1t) showWin('Player 2 Wins! (Troops)');
    else                showWin('Draw!');
  }
}

function showWin(msg) {
  document.getElementById('pass-overlay').classList.add('hidden');
  document.getElementById('win-title').textContent = msg;
  document.getElementById('win-overlay').classList.remove('hidden');
}

// ─── Mobile / Touch ───────────────────────────────────────────────────────────
function isMobile() { return window.innerWidth <= 700; }

function initMobileUI() {
  const toggle = document.getElementById('sidebar-toggle');
  const sidebar = document.getElementById('sidebar');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
  });

  // Close sidebar when tapping outside on mobile
  document.addEventListener('pointerdown', (e) => {
    if (sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        e.target !== toggle) {
      sidebar.classList.remove('open');
    }
  });

  // Mobile bar button wiring
  const mMove   = document.getElementById('m-btn-move');
  const mAttack = document.getElementById('m-btn-attack');
  const mUndo   = document.getElementById('m-btn-undo');
  const mDone   = document.getElementById('m-btn-done');

  mMove.addEventListener('click',   onBtnMove);
  mAttack.addEventListener('click', onBtnAttack);
  mUndo.addEventListener('click',   onBtnUndo);
  mDone.addEventListener('click',   onBtnDone);
}

function updateMobileBar() {
  if (!isMobile()) return;
  const mPhase = document.getElementById('mobile-phase');
  const mMove  = document.getElementById('m-btn-move');
  const mAtk   = document.getElementById('m-btn-attack');
  const mUndo  = document.getElementById('m-btn-undo');

  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const pNum = currentOwner === OWNER_P1 ? 1 : 2;

  if (pendingAction === 'move') {
    mPhase.textContent = `P${pNum}: Tap a tile to move to`;
  } else if (pendingAction === 'attack') {
    mPhase.textContent = `P${pNum}: Tap a target to attack`;
  } else if (selected) {
    const tile = tiles.get(hexKey(selected.q, selected.r));
    const hasMoved    = plans[currentOwner].some(p => p.kind === 'move'   && p.from.q === selected.q && p.from.r === selected.r);
    const hasAttacked = plans[currentOwner].some(p => p.kind === 'attack' && p.from.q === selected.q && p.from.r === selected.r);
    mMove.disabled  = hasMoved    || tile.owner !== currentOwner || tile.troops === 0;
    mAtk.disabled   = hasAttacked || tile.owner !== currentOwner || tile.troops === 0;
    mPhase.textContent = `P${pNum}: (${selected.q},${selected.r}) selected`;
  } else {
    mPhase.textContent = `P${pNum}'s Turn — Tap a tile`;
    mMove.disabled  = true;
    mAtk.disabled   = true;
  }
  mUndo.disabled = plans[currentOwner].length === 0;
}

function initTouchZoom() {
  let lastPinchDist = 0;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist = Math.hypot(dx, dy);
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
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
    }
  }, { passive: false });

  canvas.addEventListener('touchend', () => {
    lastPinchDist = 0;
  }, { passive: true });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
