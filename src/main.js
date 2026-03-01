// ─── Constants ───────────────────────────────────────────────────────────────
const GRID       = 5;
const TILE_EMPTY = 0;
const TILE_WALL  = 1;
const TILE_HILL  = 2;

const OWNER_NONE = 0;
const OWNER_P1   = 1;
const OWNER_P2   = 2;

const PHASE_P1   = 'p1';
const PHASE_P2   = 'p2';

const BASE_RANGE              = 2;
const HILL_RANGE              = 4;
const MAX_TROOPS              = 10;
const FORTIFICATION_MISS_CHANCE = 0.5;
const SPAWN_TURNS             = 3;

const ZOOM_MIN     = 0.5;
const ZOOM_MAX     = 4;
const ZOOM_STEP    = 0.15;
const MIN_CELL_SIZE = 8; // minimum pixels per cell for usability

// ─── State ────────────────────────────────────────────────────────────────────
let tiles         = [];
let plans         = { [OWNER_P1]: [], [OWNER_P2]: [] };
let phase         = PHASE_P1;
let turnNum       = 1;
let selected      = null;
let pendingAction = null;
let eventLog      = [];
let validMoveTiles = new Set();
let validAtkTiles  = new Set();
let tooltipTile    = null;
let zoomLevel      = 1;
let aiDifficulty  = 'off';

// Canvas
let canvas, ctx, cellSize;

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
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.12);
    } else if (type === 'attack') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, ac.currentTime);
      osc.frequency.exponentialRampToValueAtTime(55, ac.currentTime + 0.22);
      gain.gain.setValueAtTime(0.25, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.28);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.28);
    } else if (type === 'move') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(330, ac.currentTime);
      osc.frequency.linearRampToValueAtTime(500, ac.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ac.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.15);
      osc.start(ac.currentTime);
      osc.stop(ac.currentTime + 0.15);
    }
  } catch (_e) { /* audio unavailable */ }
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
    updatePhaseLabel();
  });
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
  render();
  updateHUD();
  updatePhaseLabel();
  clearLog();
  hideTileInfo();
}

// ─── Map Generation ───────────────────────────────────────────────────────────
function generateMap() {
  tiles = [];
  for (let r = 0; r < GRID; r++) {
    tiles[r] = [];
    for (let c = 0; c < GRID; c++) {
      const rnd = Math.random();
      let type = TILE_EMPTY;
      if (rnd < 0.12)      type = TILE_WALL;
      else if (rnd < 0.24) type = TILE_HILL;
      tiles[r][c] = { type, owner: OWNER_NONE, troops: 0, ownedTurns: 0 };
    }
  }
  // Clear 2×2 corners
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      tiles[r][c].type = TILE_EMPTY;
  for (let r = GRID - 2; r < GRID; r++)
    for (let c = GRID - 2; c < GRID; c++)
      tiles[r][c].type = TILE_EMPTY;
  // Starting troops
  tiles[0][0].owner            = OWNER_P1; tiles[0][0].troops            = 1;
  tiles[GRID-1][GRID-1].owner  = OWNER_P2; tiles[GRID-1][GRID-1].troops  = 1;
}

// ─── Canvas resize ────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('grid-wrapper');
  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight, 600);
  const base = Math.floor(size / GRID);
  cellSize = Math.max(MIN_CELL_SIZE, Math.floor(base * zoomLevel));
  canvas.width  = cellSize * GRID;
  canvas.height = cellSize * GRID;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render(flashMoves, flashAttacks) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const currentPlans = plans[currentOwner];

  const moveFromSet = new Set();
  const moveToSet   = new Set();
  const atkFromSet  = new Set();
  const atkToSet    = new Set();

  for (const p of currentPlans) {
    const fk = key(p.from.r, p.from.c);
    const tk = key(p.to.r,   p.to.c);
    if (p.kind === 'move')   { moveFromSet.add(fk); moveToSet.add(tk); }
    if (p.kind === 'attack') { atkFromSet.add(fk);  atkToSet.add(tk);  }
  }

  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      drawCell(r, c, moveFromSet, moveToSet, atkFromSet, atkToSet, flashMoves, flashAttacks);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.13)';
  ctx.lineWidth   = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * cellSize, 0);           ctx.lineTo(i * cellSize, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,            i * cellSize); ctx.lineTo(canvas.width, i * cellSize); ctx.stroke();
  }

  // Tooltip drawn on top of everything
  if (tooltipTile) drawTooltip();
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
function drawEmpty(x, y, cs) {
  const g = ctx.createLinearGradient(x, y, x + cs, y + cs);
  g.addColorStop(0, '#c8bd9e');
  g.addColorStop(1, '#b4a882');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, cs, cs);
}

function drawWall(x, y, cs) {
  const d = Math.max(3, Math.floor(cs * 0.22));

  // Front face
  const fg = ctx.createLinearGradient(x, y + d, x, y + cs);
  fg.addColorStop(0, '#a8a8a8');
  fg.addColorStop(1, '#5a5a5a');
  ctx.fillStyle = fg;
  ctx.fillRect(x, y + d, cs - d, cs - d);

  // Top face (parallelogram)
  const tg = ctx.createLinearGradient(x, y, x + d, y + d);
  tg.addColorStop(0, '#e2e2e2');
  tg.addColorStop(1, '#adadad');
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(x,        y + d);
  ctx.lineTo(x + d,    y);
  ctx.lineTo(x + cs,   y);
  ctx.lineTo(x + cs - d, y + d);
  ctx.closePath();
  ctx.fill();

  // Right side face
  const sg = ctx.createLinearGradient(x + cs - d, 0, x + cs, 0);
  sg.addColorStop(0, '#7c7c7c');
  sg.addColorStop(1, '#464646');
  ctx.fillStyle = sg;
  ctx.beginPath();
  ctx.moveTo(x + cs - d, y + d);
  ctx.lineTo(x + cs,     y);
  ctx.lineTo(x + cs,     y + cs - d);
  ctx.lineTo(x + cs - d, y + cs);
  ctx.closePath();
  ctx.fill();
}

function drawHill(x, y, cs) {
  // Base ground
  const bg = ctx.createLinearGradient(x, y, x, y + cs);
  bg.addColorStop(0, '#3d7a30');
  bg.addColorStop(1, '#1e4016');
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, cs, cs);

  // Elevation mound
  const cx2 = x + cs * 0.5;
  const cy2 = y + cs * 0.52;
  const mg  = ctx.createRadialGradient(cx2 - cs * 0.1, cy2 - cs * 0.12, 0, cx2, cy2, cs * 0.44);
  mg.addColorStop(0,   'rgba(210,250,150,0.92)');
  mg.addColorStop(0.4, 'rgba(120,190,75,0.65)');
  mg.addColorStop(1,   'rgba(25,70,15,0)');
  ctx.fillStyle = mg;
  ctx.fillRect(x, y, cs, cs);

  // Hill icon
  ctx.fillStyle    = 'rgba(55,95,35,0.9)';
  ctx.font         = `${Math.max(8, Math.floor(cs * 0.42))}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▲', x + cs / 2, y + cs / 2 - cs * 0.05);
}

// ─── Cell drawing ─────────────────────────────────────────────────────────────
function drawCell(r, c, moveFromSet, moveToSet, atkFromSet, atkToSet, flashMoves, flashAttacks) {
  const tile = tiles[r][c];
  const x = c * cellSize, y = r * cellSize;
  const cs = cellSize;
  const k  = key(r, c);

  // 1. Base terrain
  if      (tile.type === TILE_WALL) drawWall(x, y, cs);
  else if (tile.type === TILE_HILL) drawHill(x, y, cs);
  else                              drawEmpty(x, y, cs);

  // 2. Shadow cast from walls onto adjacent non-wall tiles
  if (tile.type !== TILE_WALL) {
    let shadow = 0;
    if (r > 0      && tiles[r - 1][c].type === TILE_WALL) shadow += 0.2;
    if (c > 0      && tiles[r][c - 1].type === TILE_WALL) shadow += 0.2;
    if (shadow > 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.min(shadow, 0.28)})`;
      ctx.fillRect(x, y, cs, cs);
    }
  }

  // 3. Ownership tint + glow border
  if (tile.type !== TILE_WALL) {
    if (tile.owner === OWNER_P1) {
      ctx.fillStyle   = 'rgba(60,110,230,0.22)';
      ctx.fillRect(x, y, cs, cs);
      ctx.strokeStyle = 'rgba(80,150,255,0.55)';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, cs - 1.5, cs - 1.5);
    } else if (tile.owner === OWNER_P2) {
      ctx.fillStyle   = 'rgba(220,50,50,0.22)';
      ctx.fillRect(x, y, cs, cs);
      ctx.strokeStyle = 'rgba(255,80,80,0.55)';
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(x + 0.75, y + 0.75, cs - 1.5, cs - 1.5);
    }
  }

  // 4. Flash animation overlay (resolution preview)
  if (flashMoves   && flashMoves.has(k)) {
    ctx.fillStyle = 'rgba(80,160,255,0.55)';
    ctx.fillRect(x, y, cs, cs);
  }
  if (flashAttacks && flashAttacks.has(k)) {
    ctx.fillStyle = 'rgba(255,60,60,0.55)';
    ctx.fillRect(x, y, cs, cs);
  }

  // 5. Range highlights (valid move / attack targets during planning)
  if (validMoveTiles.has(k) && tile.type !== TILE_WALL) {
    ctx.fillStyle   = 'rgba(80,160,255,0.28)';
    ctx.fillRect(x, y, cs, cs);
    ctx.strokeStyle = 'rgba(100,180,255,0.75)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, cs - 1.5, cs - 1.5);
  }
  if (validAtkTiles.has(k)) {
    ctx.fillStyle   = 'rgba(255,60,60,0.28)';
    ctx.fillRect(x, y, cs, cs);
    ctx.strokeStyle = 'rgba(255,100,100,0.75)';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, cs - 1.5, cs - 1.5);
  }

  // 6. Selected tile glow (double-ring)
  if (selected && selected.r === r && selected.c === c) {
    ctx.strokeStyle = 'rgba(255,220,0,0.95)';
    ctx.lineWidth   = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, cs - 3, cs - 3);
    ctx.strokeStyle = 'rgba(255,200,0,0.35)';
    ctx.lineWidth   = 6;
    ctx.strokeRect(x + 3, y + 3, cs - 6, cs - 6);
  }

  // 7. Plan highlights (destinations = dashed, sources = white border)
  if (moveToSet.has(k)) {
    ctx.fillStyle   = 'rgba(80,160,255,0.48)';
    ctx.fillRect(x, y, cs, cs);
    ctx.strokeStyle = 'rgba(130,200,255,0.9)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
    ctx.setLineDash([]);
  }
  if (atkToSet.has(k)) {
    ctx.fillStyle   = 'rgba(255,60,60,0.48)';
    ctx.fillRect(x, y, cs, cs);
    ctx.strokeStyle = 'rgba(255,130,130,0.9)';
    ctx.lineWidth   = 2;
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
    ctx.setLineDash([]);
  }
  if (moveFromSet.has(k) || atkFromSet.has(k)) {
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
  }

  // 8. Troop badge
  if (tile.type !== TILE_WALL && tile.troops > 0)
    drawTroopBadge(x, y, cs, tile.troops, tile.owner);

  // 9. Spawn counter (dots near top of tile)
  if (tile.type !== TILE_WALL && tile.owner !== OWNER_NONE && tile.troops > 0)
    drawSpawnCounter(x, y, cs, tile.ownedTurns);
}

function drawTroopBadge(x, y, cs, troops, owner) {
  const bw = Math.max(13, Math.floor(cs * 0.52));
  const bh = Math.max(9,  Math.floor(cs * 0.29));
  const bx = x + cs * 0.5 - bw * 0.5;
  const by = y + cs - bh - Math.max(2, Math.floor(cs * 0.07));
  const rx = Math.max(2, Math.floor(bh * 0.44));

  // Drop shadow
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  pathRoundRect(bx + 1.5, by + 1.5, bw, bh, rx);
  ctx.fill();

  // Badge body
  ctx.fillStyle = owner === OWNER_P1 ? '#1840a0' : owner === OWNER_P2 ? '#961818' : '#383838';
  pathRoundRect(bx, by, bw, bh, rx);
  ctx.fill();

  // Top-half sheen
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  pathRoundRect(bx, by, bw, bh * 0.52, rx);
  ctx.fill();

  // Count text
  ctx.fillStyle    = '#ffffff';
  ctx.font         = `bold ${Math.max(7, Math.floor(cs * 0.25))}px sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(troops.toString(), x + cs * 0.5, by + bh * 0.5);
}

function drawSpawnCounter(x, y, cs, ownedTurns) {
  const dotR  = Math.max(2, Math.floor(cs * 0.07));
  const gap   = dotR * 2.8;
  const total = SPAWN_TURNS - 1;
  const filled = ownedTurns % SPAWN_TURNS;
  const totalW = total * gap - gap * 0.4;
  let dx = x + cs * 0.5 - totalW * 0.5;
  const dy = y + dotR + Math.max(2, Math.floor(cs * 0.06));
  for (let i = 0; i < total; i++) {
    ctx.beginPath();
    ctx.arc(dx + i * gap, dy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = i < filled ? 'rgba(255,220,80,0.92)' : 'rgba(255,255,255,0.28)';
    ctx.fill();
  }
}


function drawTooltip() {
  const { r, c } = tooltipTile;
  if (r < 0 || r >= GRID || c < 0 || c >= GRID) return;
  const tile     = tiles[r][c];
  const typeStr  = TILE_TYPE_LABELS[tile.type] ?? 'Unknown';
  const ownerStr = tile.owner === OWNER_P1 ? 'P1' : tile.owner === OWNER_P2 ? 'P2' : 'None';
  const range    = tile.type === TILE_HILL ? HILL_RANGE : BASE_RANGE;
  const lines    = [
    `(${r},${c}) ${typeStr}`,
    `Owner: ${ownerStr}  Troops: ${tile.troops}`,
    `Range: ${range}`,
  ];

  const lineH = 13, pad = 6, tw = 114, th = lines.length * lineH + pad * 2;
  let tx = c * cellSize + cellSize + 3;
  let ty = r * cellSize + 2;
  if (tx + tw > canvas.width)  tx = c * cellSize - tw - 3;
  if (ty + th > canvas.height) ty = canvas.height - th - 2;

  ctx.fillStyle = 'rgba(10,18,36,0.93)';
  pathRoundRect(tx, ty, tw, th, 4);
  ctx.fill();

  ctx.strokeStyle = 'rgba(226,176,74,0.65)';
  ctx.lineWidth   = 1;
  pathRoundRect(tx, ty, tw, th, 4);
  ctx.stroke();

  ctx.fillStyle    = '#e0e0e0';
  ctx.font         = `${Math.floor(lineH * 0.88)}px sans-serif`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++)
    ctx.fillText(lines[i], tx + pad, ty + pad + i * lineH);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function key(r, c)    { return r * GRID + c; }
function decodeKey(k) { return { r: Math.floor(k / GRID), c: k % GRID }; }

const TILE_TYPE_LABELS = { [TILE_EMPTY]: 'Empty', [TILE_WALL]: 'Wall', [TILE_HILL]: 'Hill' };

function updateHUD() {
  let p1c = 0, p2c = 0;
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      if (tiles[r][c].owner === OWNER_P1) p1c++;
      if (tiles[r][c].owner === OWNER_P2) p2c++;
    }
  document.getElementById('p1-tiles').textContent = `Tiles: ${p1c}`;
  document.getElementById('p2-tiles').textContent = `Tiles: ${p2c}`;
  document.getElementById('turn-num').textContent  = turnNum;
}

function updatePhaseLabel() {
  if (phase === PHASE_P1) {
    document.getElementById('phase-label').textContent = "Player 1's Turn — Select a tile";
  } else {
    const diffLabel = aiDifficulty !== 'off'
      ? `AI (${aiDifficulty.charAt(0).toUpperCase() + aiDifficulty.slice(1)}) is planning…`
      : "Player 2's Turn — Select a tile";
    document.getElementById('phase-label').textContent = diffLabel;
  }
  updatePlanCounter();
}

function showTileInfo(r, c) {
  const tile     = tiles[r][c];
  const typeStr  = TILE_TYPE_LABELS[tile.type] ?? 'Unknown';
  const ownerStr = tile.owner === OWNER_P1 ? 'Player 1' : tile.owner === OWNER_P2 ? 'Player 2' : 'None';
  document.getElementById('tile-detail').textContent =
    `(${r},${c}) ${typeStr} | Owner: ${ownerStr} | Troops: ${tile.troops}`;
  document.getElementById('tile-info').classList.remove('hidden');

  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const hasMoved    = plans[currentOwner].some(p => p.kind === 'move'   && p.from.r === r && p.from.c === c);
  const hasAttacked = plans[currentOwner].some(p => p.kind === 'attack' && p.from.r === r && p.from.c === c);
  document.getElementById('btn-move').disabled   = hasMoved    || tile.owner !== currentOwner || tile.troops === 0;
  document.getElementById('btn-attack').disabled = hasAttacked || tile.owner !== currentOwner || tile.troops === 0;
  document.getElementById('btn-undo').disabled   = plans[currentOwner].length === 0;
}

function hideTileInfo() {
  document.getElementById('tile-info').classList.add('hidden');
  document.getElementById('tile-detail').textContent = '';
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
  const x = (e.clientX - rect.left) * (canvas.width  / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
  const c = Math.floor(x / cellSize);
  const r = Math.floor(y / cellSize);
  tooltipTile = (r >= 0 && r < GRID && c >= 0 && c < GRID) ? { r, c } : null;
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
  const x = (e.clientX - rect.left) * (canvas.width  / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
  const c = Math.floor(x / cellSize);
  const r = Math.floor(y / cellSize);
  if (r < 0 || r >= GRID || c < 0 || c >= GRID) return;
  playSound('select');
  handleTileClick(r, c);
}

function handleTileClick(r, c) {
  if (pendingAction === 'move') {
    tryPlanMove(r, c);
    return;
  }
  if (pendingAction === 'attack') {
    tryPlanAttack(r, c);
    return;
  }
  selected       = { r, c };
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  showTileInfo(r, c);
}

function onBtnMove() {
  if (!selected) return;
  pendingAction  = 'move';
  validMoveTiles = getValidMoveTiles(selected.r, selected.c);
  validAtkTiles  = new Set();
  document.getElementById('phase-label').textContent = 'Click a highlighted tile to move to';
  render();
}

function onBtnAttack() {
  if (!selected) return;
  pendingAction  = 'attack';
  validAtkTiles  = getValidAtkTiles(selected.r, selected.c);
  validMoveTiles = new Set();
  document.getElementById('phase-label').textContent = 'Click a highlighted enemy tile to attack';
  render();
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
  addLog(`Undo: removed ${removed.kind} plan from (${removed.from.r},${removed.from.c})`);
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  if (selected) showTileInfo(selected.r, selected.c);
  else document.getElementById('btn-undo').disabled = plans[currentOwner].length === 0;
  updatePhaseLabel();
}

function onKeyDown(e) {
  // Don't trigger shortcuts when typing in input elements
  if (e.target.matches('input, select, textarea')) return;
  const key = e.key.toUpperCase();
  if (key === 'M') {
    const btn = document.getElementById('btn-move');
    if (!btn.disabled) onBtnMove();
  } else if (key === 'A') {
    const btn = document.getElementById('btn-attack');
    if (!btn.disabled) onBtnAttack();
  } else if (e.key === 'Escape') {
    onBtnCancel();
  } else if (key === 'U') {
    const btn = document.getElementById('btn-undo');
    if (!btn.disabled) onBtnUndo();
  } else if (e.key === 'Enter' || key === 'D') {
    onBtnDone();
  }
}

function getValidMoveTiles(r, c) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const result = new Set();
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
    if (tiles[nr][nc].type === TILE_WALL) continue;
    if (tiles[nr][nc].owner !== OWNER_NONE && tiles[nr][nc].owner !== currentOwner) continue;
    result.add(key(nr, nc));
  }
  return result;
}

function getValidAtkTiles(r, c) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const result = new Set();
  for (let tr = 0; tr < GRID; tr++)
    for (let tc = 0; tc < GRID; tc++) {
      if (tiles[tr][tc].owner === OWNER_NONE || tiles[tr][tc].owner === currentOwner) continue;
      if (canAttack(r, c, tr, tc)) result.add(key(tr, tc));
    }
  return result;
}

function tryPlanMove(r, c) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const from = selected;

  if (!isAdjacent(from.r, from.c, r, c)) {
    addLog('Move: must be adjacent.');
  } else if (tiles[r][c].type === TILE_WALL) {
    addLog('Move: cannot move onto a wall.');
  } else if (tiles[r][c].owner !== OWNER_NONE && tiles[r][c].owner !== currentOwner) {
    addLog('Move: cannot move onto an enemy tile.');
  } else {
    plans[currentOwner] = plans[currentOwner].filter(p => !(p.kind === 'move' && p.from.r === from.r && p.from.c === from.c));
    plans[currentOwner].push({ kind: 'move', from: { r: from.r, c: from.c }, to: { r, c } });
    addLog(`P${currentOwner} plans move (${from.r},${from.c})→(${r},${c})`, 'log-move');
    playSound('move');
    selected       = null;
    hideTileInfo();
  }
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  updatePhaseLabel();
}

function tryPlanAttack(r, c) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const from = selected;

  if (tiles[r][c].owner === currentOwner) {
    addLog('Attack: cannot attack own tile.');
  } else if (tiles[r][c].owner === OWNER_NONE) {
    addLog('Attack: no enemy troops there.');
  } else if (!canAttack(from.r, from.c, r, c)) {
    addLog('Attack: target out of range or blocked by wall.');
  } else {
    plans[currentOwner] = plans[currentOwner].filter(p => !(p.kind === 'attack' && p.from.r === from.r && p.from.c === from.c));
    plans[currentOwner].push({ kind: 'attack', from: { r: from.r, c: from.c }, to: { r, c } });
    addLog(`P${currentOwner} plans attack (${from.r},${from.c})→(${r},${c})`, 'log-attack');
    playSound('attack');
    selected       = null;
    hideTileInfo();
  }
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();
  render();
  updatePhaseLabel();
}

// ─── Attack range / LOS ───────────────────────────────────────────────────────
function manhattan(r1, c1, r2, c2) { return Math.abs(r1 - r2) + Math.abs(c1 - c2); }
function isAdjacent(r1, c1, r2, c2) { return manhattan(r1, c1, r2, c2) === 1; }

function canAttack(fr, fc, tr, tc) {
  const tile   = tiles[fr][fc];
  const isHill = tile.type === TILE_HILL;
  const range  = isHill ? HILL_RANGE : BASE_RANGE;
  if (manhattan(fr, fc, tr, tc) > range) return false;
  if (isHill) return true;
  return !wallBlocksShot(fr, fc, tr, tc);
}

function wallBlocksShot(fr, fc, tr, tc) {
  const dr = tr - fr, dc = tc - fc;
  for (const adj of [{ r: fr-1, c: fc }, { r: fr+1, c: fc }, { r: fr, c: fc-1 }, { r: fr, c: fc+1 }]) {
    if (adj.r < 0 || adj.r >= GRID || adj.c < 0 || adj.c >= GRID) continue;
    if (tiles[adj.r][adj.c].type !== TILE_WALL) continue;
    if ((adj.r - fr) * dr + (adj.c - fc) * dc > 0) return true;
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
      makeAIPlans();
      animateAndResolveTurn();
    } else {
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
      if (p.kind === 'move')   flashMoveSet.add(key(p.to.r, p.to.c));
      if (p.kind === 'attack') flashAtkSet.add(key(p.to.r,  p.to.c));
    }
  }
  render(flashMoveSet, flashAtkSet);
  setTimeout(resolveTurn, 500);
}

// ─── Turn Resolution ──────────────────────────────────────────────────────────
function resolveTurn() {
  const summary = { moves: 0, attacks: 0, kills: 0, mutual: 0 };

  resolveMovement(summary);
  resolveAttacks(summary);
  resolveSpawn();

  turnNum++;
  plans          = { [OWNER_P1]: [], [OWNER_P2]: [] };
  phase          = PHASE_P1;
  selected       = null;
  pendingAction  = null;
  validMoveTiles = new Set();
  validAtkTiles  = new Set();

  render();
  updateHUD();
  updatePhaseLabel();
  hideTileInfo();

  document.getElementById('pass-title').textContent = `Turn ${turnNum} — Player 1's Planning Phase`;
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
}

function resolveMovement(summary) {
  const moves = [];
  for (const owner of [OWNER_P1, OWNER_P2])
    for (const p of plans[owner]) {
      if (p.kind !== 'move') continue;
      const ft = tiles[p.from.r][p.from.c];
      if (ft.owner !== owner || ft.troops === 0) continue;
      moves.push({ owner, from: p.from, to: p.to });
    }

  // Detect contested destinations (two different owners moving to same empty tile)
  const destOwners = {};
  for (const mv of moves) {
    const k = key(mv.to.r, mv.to.c);
    if (!destOwners[k]) destOwners[k] = [];
    if (!destOwners[k].includes(mv.owner)) destOwners[k].push(mv.owner);
  }
  const contestedKeys = new Set();
  for (const k in destOwners) {
    const numericKey = Number(k);
    const { r, c } = decodeKey(numericKey);
    if (destOwners[k].length >= 2 && tiles[r][c].owner === OWNER_NONE) {
      contestedKeys.add(numericKey);
      addLog(`Contested move to (${r},${c})! Neither move succeeds.`);
    }
  }

  const arrivals = {};
  for (const mv of moves) {
    const toTile = tiles[mv.to.r][mv.to.c];
    if (toTile.type === TILE_WALL) continue;
    if (toTile.owner !== OWNER_NONE && toTile.owner !== mv.owner) continue;
    const k = key(mv.to.r, mv.to.c);
    if (contestedKeys.has(k)) continue;

    const fromTile = tiles[mv.from.r][mv.from.c];
    fromTile.troops = Math.max(0, fromTile.troops - 1);
    if (fromTile.troops === 0) { fromTile.owner = OWNER_NONE; fromTile.ownedTurns = 0; }

    if (!arrivals[k]) arrivals[k] = { owner: mv.owner, r: mv.to.r, c: mv.to.c, count: 0 };
    arrivals[k].count++;
    addLog(`P${mv.owner} moved (${mv.from.r},${mv.from.c})→(${mv.to.r},${mv.to.c})`, 'log-move');
    summary.moves++;
  }

  for (const k in arrivals) {
    const { owner, r, c, count } = arrivals[k];
    const tile = tiles[r][c];
    if (tile.owner === OWNER_NONE) { tile.owner = owner; tile.troops = count; tile.ownedTurns = 0; }
    else if (tile.owner === owner) { tile.troops += count; }
  }
}

function resolveAttacks(summary) {
  const attacks = [];
  for (const owner of [OWNER_P1, OWNER_P2])
    for (const p of plans[owner]) {
      if (p.kind !== 'attack') continue;
      const ft = tiles[p.from.r][p.from.c];
      if (ft.owner !== owner || ft.troops === 0) continue;
      attacks.push({ owner, from: p.from, to: p.to });
    }

  // Mutual strike detection
  const attackMap = {};
  for (const atk of attacks) {
    const k = key(atk.to.r, atk.to.c);
    if (!attackMap[k]) attackMap[k] = [];
    attackMap[k].push(atk);
  }
  const penaltyTiles = new Set();
  for (const k in attackMap) {
    if (attackMap[k].length >= 2) {
      for (const atk of attackMap[k]) {
        penaltyTiles.add(key(atk.from.r, atk.from.c));
        addLog(`Mutual strike on (${atk.to.r},${atk.to.c})! Attacker at (${atk.from.r},${atk.from.c}) loses 1.`, 'log-mutual');
        summary.mutual++;
      }
    }
  }

  // Apply damage
  const damage = {};
  for (const atk of attacks) {
    const targetTile = tiles[atk.to.r][atk.to.c];
    // Fortification bonus: Hill with 3+ troops has 50% miss chance
    if (targetTile.type === TILE_HILL && targetTile.troops >= 3 && Math.random() < FORTIFICATION_MISS_CHANCE) {
      addLog(`Fortification! Attack on (${atk.to.r},${atk.to.c}) missed!`, 'log-spawn');
      continue;
    }
    const k = key(atk.to.r, atk.to.c);
    damage[k] = (damage[k] || 0) + 1;
    addLog(`P${atk.owner} attacks (${atk.from.r},${atk.from.c})→(${atk.to.r},${atk.to.c})`, 'log-attack');
    summary.attacks++;
  }

  for (const k in damage) {
    const { r, c } = decodeKey(Number(k));
    const tile      = tiles[r][c];
    const prev      = tile.troops;
    tile.troops     = Math.max(0, tile.troops - damage[k]);
    summary.kills  += prev - tile.troops;
    if (tile.troops === 0) { tile.owner = OWNER_NONE; tile.ownedTurns = 0; }
  }

  // Mutual strike penalty on attackers
  for (const k of penaltyTiles) {
    const { r, c } = decodeKey(k);
    const tile      = tiles[r][c];
    const prev      = tile.troops;
    tile.troops     = Math.max(0, tile.troops - 1);
    summary.kills  += prev - tile.troops;
    if (tile.troops === 0) { tile.owner = OWNER_NONE; tile.ownedTurns = 0; }
  }
}

function resolveSpawn() {
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      const tile = tiles[r][c];
      if (tile.owner !== OWNER_NONE && tile.troops > 0) {
        tile.ownedTurns++;
        if (tile.ownedTurns >= SPAWN_TURNS) {
          tile.troops = Math.min(MAX_TROOPS, tile.troops + 1);
          tile.ownedTurns = 0;
        }
      }
    }
}

// ─── AI Opponent ──────────────────────────────────────────────────────────────
function makeAIPlans() {
  if      (aiDifficulty === 'easy')   makeAIPlansEasy();
  else if (aiDifficulty === 'medium') makeAIPlansMedium();
  else if (aiDifficulty === 'hard')   makeAIPlansHard();
}

// Helper: collect moveable adjacent tiles for a P2 unit at (r,c)
function getAIMoveOptions(r, c) {
  const moveable = [];
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
    if (tiles[nr][nc].type === TILE_WALL) continue;
    if (tiles[nr][nc].owner !== OWNER_NONE && tiles[nr][nc].owner !== OWNER_P2) continue;
    moveable.push({ r: nr, c: nc });
  }
  return moveable;
}

// Helper: collect P1 tiles
function getP1Tiles() {
  const p1Tiles = [];
  for (let pr = 0; pr < GRID; pr++)
    for (let pc = 0; pc < GRID; pc++)
      if (tiles[pr][pc].owner === OWNER_P1) p1Tiles.push({ r: pr, c: pc });
  return p1Tiles;
}

// Helper: collect hill tiles not owned by P2
function getHillTiles() {
  const hills = [];
  for (let hr = 0; hr < GRID; hr++)
    for (let hc = 0; hc < GRID; hc++)
      if (tiles[hr][hc].type === TILE_HILL && tiles[hr][hc].owner !== OWNER_P2)
        hills.push({ r: hr, c: hc });
  return hills;
}

function makeAIPlansEasy() {
  plans[OWNER_P2] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const tile = tiles[r][c];
      if (tile.owner !== OWNER_P2 || tile.troops === 0) continue;
      if (plans[OWNER_P2].some(p => p.from.r === r && p.from.c === c)) continue;

      // Prefer attacking P1 tiles within range (random selection)
      const atkTargets = [];
      for (let tr = 0; tr < GRID; tr++)
        for (let tc = 0; tc < GRID; tc++)
          if (tiles[tr][tc].owner === OWNER_P1 && canAttack(r, c, tr, tc))
            atkTargets.push({ r: tr, c: tc });
      if (atkTargets.length > 0) {
        const t = atkTargets[Math.floor(Math.random() * atkTargets.length)];
        plans[OWNER_P2].push({ kind: 'attack', from: { r, c }, to: t });
        addLog(`AI plans attack (${r},${c})→(${t.r},${t.c})`, 'log-attack');
        continue;
      }

      // Otherwise move toward the nearest P1 tile (greedy)
      const moveable = getAIMoveOptions(r, c);
      if (moveable.length === 0) continue;

      const p1Tiles = getP1Tiles();
      let best = moveable[Math.floor(Math.random() * moveable.length)];
      if (p1Tiles.length > 0) {
        let minDist = Infinity;
        for (const mt of moveable) {
          const dist = Math.min(...p1Tiles.map(pt => manhattan(mt.r, mt.c, pt.r, pt.c)));
          if (dist < minDist) { minDist = dist; best = mt; }
        }
      }
      plans[OWNER_P2].push({ kind: 'move', from: { r, c }, to: best });
      addLog(`AI plans move (${r},${c})→(${best.r},${best.c})`, 'log-move');
    }
  }
}

function makeAIPlansMedium() {
  plans[OWNER_P2] = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const tile = tiles[r][c];
      if (tile.owner !== OWNER_P2 || tile.troops === 0) continue;
      if (plans[OWNER_P2].some(p => p.from.r === r && p.from.c === c)) continue;

      // Occasionally hold position on tiles about to spawn
      if (tile.ownedTurns >= SPAWN_TURNS - 1 && Math.random() < 0.5) continue;

      // Prefer attacking weakest (fewest troops) P1 tile in range
      const atkTargets = [];
      for (let tr = 0; tr < GRID; tr++)
        for (let tc = 0; tc < GRID; tc++)
          if (tiles[tr][tc].owner === OWNER_P1 && canAttack(r, c, tr, tc))
            atkTargets.push({ r: tr, c: tc, troops: tiles[tr][tc].troops });
      if (atkTargets.length > 0) {
        // Shuffle first for random tie-breaking, then sort stably
        for (let i = atkTargets.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [atkTargets[i], atkTargets[j]] = [atkTargets[j], atkTargets[i]];
        }
        atkTargets.sort((a, b) => a.troops - b.troops);
        const t = atkTargets[0];
        plans[OWNER_P2].push({ kind: 'attack', from: { r, c }, to: { r: t.r, c: t.c } });
        addLog(`AI plans attack (${r},${c})→(${t.r},${t.c})`, 'log-attack');
        continue;
      }

      // Move: prefer hill tiles, otherwise toward nearest P1 tile
      const moveable = getAIMoveOptions(r, c);
      if (moveable.length === 0) continue;

      const hillTargets = moveable.filter(m => tiles[m.r][m.c].type === TILE_HILL);
      if (hillTargets.length > 0) {
        const best = hillTargets[Math.floor(Math.random() * hillTargets.length)];
        plans[OWNER_P2].push({ kind: 'move', from: { r, c }, to: best });
        addLog(`AI plans move (${r},${c})→(${best.r},${best.c})`, 'log-move');
        continue;
      }

      const p1Tiles = getP1Tiles();
      let best = moveable[Math.floor(Math.random() * moveable.length)];
      if (p1Tiles.length > 0) {
        let minDist = Infinity;
        for (const mt of moveable) {
          const dist = Math.min(...p1Tiles.map(pt => manhattan(mt.r, mt.c, pt.r, pt.c)));
          if (dist < minDist || (dist === minDist && Math.random() < 0.5)) { minDist = dist; best = mt; }
        }
      }
      plans[OWNER_P2].push({ kind: 'move', from: { r, c }, to: best });
      addLog(`AI plans move (${r},${c})→(${best.r},${best.c})`, 'log-move');
    }
  }
}

function makeAIPlansHard() {
  plans[OWNER_P2] = [];

  // Pre-compute attack targets count per P1 tile (for focus fire)
  const focusTargets = {};
  // First pass: find the best killable targets (troops === 1) and weakest targets
  const p1TilesAll = [];
  for (let tr = 0; tr < GRID; tr++)
    for (let tc = 0; tc < GRID; tc++)
      if (tiles[tr][tc].owner === OWNER_P1) p1TilesAll.push({ r: tr, c: tc, troops: tiles[tr][tc].troops });

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const tile = tiles[r][c];
      if (tile.owner !== OWNER_P2 || tile.troops === 0) continue;
      if (plans[OWNER_P2].some(p => p.from.r === r && p.from.c === c)) continue;

      // Spawn awareness: never move a unit off a tile with ownedTurns >= SPAWN_TURNS - 1
      const aboutToSpawn = tile.ownedTurns >= SPAWN_TURNS - 1;

      // Retreat logic: if this P2 tile has only 1 troop and is adjacent to a strong P1 tile (3+ troops)
      if (!aboutToSpawn && tile.troops === 1) {
        const strongAdjP1 = p1TilesAll.some(pt =>
          manhattan(r, c, pt.r, pt.c) === 1 && pt.troops >= 3
        );
        if (strongAdjP1) {
          // Move away from that P1 tile
          const moveable = getAIMoveOptions(r, c);
          if (moveable.length > 0) {
            // Move toward a hill if possible, otherwise away from P1 tiles
            const hillOpts = moveable.filter(m => tiles[m.r][m.c].type === TILE_HILL);
            const pool = hillOpts.length > 0 ? hillOpts : moveable;
            // Choose the option furthest from the nearest P1 tile
            let best = pool[0];
            let maxDist = -Infinity;
            for (const mt of pool) {
              const dist = p1TilesAll.length > 0
                ? Math.min(...p1TilesAll.map(pt => manhattan(mt.r, mt.c, pt.r, pt.c)))
                : 0;
              if (dist > maxDist) { maxDist = dist; best = mt; }
            }
            plans[OWNER_P2].push({ kind: 'move', from: { r, c }, to: best });
            addLog(`AI plans move (${r},${c})→(${best.r},${best.c})`, 'log-move');
            continue;
          }
        }
      }

      // Attack: focus fire on killable (troops===1) targets, then weakest
      const atkTargets = [];
      for (const pt of p1TilesAll)
        if (canAttack(r, c, pt.r, pt.c)) atkTargets.push(pt);

      if (atkTargets.length > 0) {
        // Prefer targets already being focused (most attacks planned on them)
        // Prioritize kill shots (troops===1) first
        const killable = atkTargets.filter(t => t.troops === 1);
        const pool = killable.length > 0 ? killable : atkTargets;
        // Shuffle for random tie-breaking, then sort stably by focus and troop count
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        pool.sort((a, b) => {
          const fa = focusTargets[key(a.r, a.c)] || 0;
          const fb = focusTargets[key(b.r, b.c)] || 0;
          return fb - fa || a.troops - b.troops;
        });
        const t = pool[0];
        const tk = key(t.r, t.c);
        focusTargets[tk] = (focusTargets[tk] || 0) + 1;
        plans[OWNER_P2].push({ kind: 'attack', from: { r, c }, to: { r: t.r, c: t.c } });
        addLog(`AI plans attack (${r},${c})→(${t.r},${t.c})`, 'log-attack');
        continue;
      }

      // If about to spawn, hold position
      if (aboutToSpawn) continue;

      // Move: strongly prefer capturing/holding hills; otherwise toward P1
      const moveable = getAIMoveOptions(r, c);
      if (moveable.length === 0) continue;

      // Prefer moving onto hill tiles first
      const hillOpts = moveable.filter(m => tiles[m.r][m.c].type === TILE_HILL);
      if (hillOpts.length > 0) {
        const best = hillOpts[Math.floor(Math.random() * hillOpts.length)];
        plans[OWNER_P2].push({ kind: 'move', from: { r, c }, to: best });
        addLog(`AI plans move (${r},${c})→(${best.r},${best.c})`, 'log-move');
        continue;
      }

      // Move toward hills (even if P1 tiles are closer) or toward P1 if no hills
      const allHills = getHillTiles();
      const targets = allHills.length > 0 ? allHills : p1TilesAll;
      let best = moveable[Math.floor(Math.random() * moveable.length)];
      if (targets.length > 0) {
        let minDist = Infinity;
        for (const mt of moveable) {
          const dist = Math.min(...targets.map(t => manhattan(mt.r, mt.c, t.r, t.c)));
          if (dist < minDist) { minDist = dist; best = mt; }
        }
      }
      plans[OWNER_P2].push({ kind: 'move', from: { r, c }, to: best });
      addLog(`AI plans move (${r},${c})→(${best.r},${best.c})`, 'log-move');
    }
  }
}


function checkWin() {
  let p1c = 0, p2c = 0;
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++) {
      if (tiles[r][c].owner === OWNER_P1) p1c++;
      if (tiles[r][c].owner === OWNER_P2) p2c++;
    }
  updateHUD();
  if      (p1c === 0 && p2c === 0) showWin('Draw!');
  else if (p1c === 0)              showWin('Player 2 Wins!');
  else if (p2c === 0)              showWin('Player 1 Wins!');
}

function showWin(msg) {
  document.getElementById('pass-overlay').classList.add('hidden');
  document.getElementById('win-title').textContent = msg;
  document.getElementById('win-overlay').classList.remove('hidden');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
