// ─── Constants ───────────────────────────────────────────────────────────────
const GRID = 16;
const TILE_EMPTY = 0;
const TILE_WALL  = 1;
const TILE_HILL  = 2;

const OWNER_NONE = 0;
const OWNER_P1   = 1;
const OWNER_P2   = 2;

const PHASE_P1   = 'p1';
const PHASE_P2   = 'p2';

const BASE_RANGE = 3;
const HILL_RANGE = 6;

// ─── State ────────────────────────────────────────────────────────────────────
let tiles   = [];   // [row][col] = { type, owner, troops }
let plans   = { [OWNER_P1]: [], [OWNER_P2]: [] };  // array of { kind:'move'|'attack', from:{r,c}, to:{r,c} }
let phase   = PHASE_P1;
let turnNum = 1;
let selected = null;  // {r,c} of selected tile
let pendingAction = null;  // 'move' | 'attack'
let eventLog = [];

// Canvas
let canvas, ctx, cellSize;

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  generateMap();
  phase   = PHASE_P1;
  turnNum = 1;
  plans   = { [OWNER_P1]: [], [OWNER_P2]: [] };
  selected = null;
  pendingAction = null;
  eventLog = [];

  resizeCanvas();
  render();
  updateHUD();
  updatePhaseLabel();
  clearLog();

  window.addEventListener('resize', () => { resizeCanvas(); render(); });
  canvas.addEventListener('pointerdown', onCanvasClick);
  document.getElementById('btn-move').addEventListener('click', onBtnMove);
  document.getElementById('btn-attack').addEventListener('click', onBtnAttack);
  document.getElementById('btn-cancel').addEventListener('click', onBtnCancel);
  document.getElementById('btn-done').addEventListener('click', onBtnDone);
  document.getElementById('pass-btn').addEventListener('click', onPassReady);
  document.getElementById('new-game-btn').addEventListener('click', newGame);
  document.getElementById('new-game-win-btn').addEventListener('click', newGame);
}

function newGame() {
  document.getElementById('win-overlay').classList.add('hidden');
  document.getElementById('pass-overlay').classList.add('hidden');
  generateMap();
  phase   = PHASE_P1;
  turnNum = 1;
  plans   = { [OWNER_P1]: [], [OWNER_P2]: [] };
  selected = null;
  pendingAction = null;
  eventLog = [];
  render();
  updateHUD();
  updatePhaseLabel();
  clearLog();
  hideTileInfo();
}

// ─── Map Generation ────────────────────────────────────────────────────────────
function generateMap() {
  tiles = [];
  for (let r = 0; r < GRID; r++) {
    tiles[r] = [];
    for (let c = 0; c < GRID; c++) {
      const rnd = Math.random();
      let type = TILE_EMPTY;
      if (rnd < 0.12) type = TILE_WALL;
      else if (rnd < 0.24) type = TILE_HILL;
      tiles[r][c] = { type, owner: OWNER_NONE, troops: 0 };
    }
  }

  // Clear 2x2 corners
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 2; c++)
      tiles[r][c].type = TILE_EMPTY;
  for (let r = GRID - 2; r < GRID; r++)
    for (let c = GRID - 2; c < GRID; c++)
      tiles[r][c].type = TILE_EMPTY;

  // Place starting troops
  tiles[0][0].owner  = OWNER_P1; tiles[0][0].troops  = 1;
  tiles[GRID-1][GRID-1].owner = OWNER_P2; tiles[GRID-1][GRID-1].troops = 1;
}

// ─── Canvas / Rendering ────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrapper = document.getElementById('grid-wrapper');
  const size = Math.min(wrapper.clientWidth, wrapper.clientHeight, 600);
  cellSize = Math.floor(size / GRID);
  canvas.width  = cellSize * GRID;
  canvas.height = cellSize * GRID;
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const currentPlans = plans[currentOwner];

  // Build highlight maps from current player's plans
  const moveFromSet  = new Set();
  const moveToSet    = new Set();
  const atkFromSet   = new Set();
  const atkToSet     = new Set();

  for (const p of currentPlans) {
    const fk = key(p.from.r, p.from.c);
    const tk = key(p.to.r, p.to.c);
    if (p.kind === 'move')   { moveFromSet.add(fk); moveToSet.add(tk); }
    if (p.kind === 'attack') { atkFromSet.add(fk);  atkToSet.add(tk);  }
  }

  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      drawCell(r, c, currentOwner, moveFromSet, moveToSet, atkFromSet, atkToSet);
    }
  }

  // Draw grid lines
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * cellSize); ctx.lineTo(canvas.width, i * cellSize); ctx.stroke();
  }
}

function drawCell(r, c, currentOwner, moveFromSet, moveToSet, atkFromSet, atkToSet) {
  const tile = tiles[r][c];
  const x = c * cellSize, y = r * cellSize;
  const cs = cellSize;
  const k = key(r, c);

  // Base background color
  let bg;
  if (tile.type === TILE_WALL)       bg = '#888';
  else if (tile.type === TILE_HILL)  bg = '#2d6a2d';
  else                               bg = '#d4c9a8';

  ctx.fillStyle = bg;
  ctx.fillRect(x, y, cs, cs);

  // Ownership tint (semi-transparent overlay)
  if (tile.owner === OWNER_P1) {
    ctx.fillStyle = 'rgba(60,100,200,0.45)';
    ctx.fillRect(x, y, cs, cs);
  } else if (tile.owner === OWNER_P2) {
    ctx.fillStyle = 'rgba(200,50,50,0.45)';
    ctx.fillRect(x, y, cs, cs);
  }

  // Plan highlights (drawn over base but under text)
  if (selected && selected.r === r && selected.c === c) {
    ctx.fillStyle = 'rgba(255,255,0,0.55)';
    ctx.fillRect(x, y, cs, cs);
  }
  if (moveToSet.has(k)) {
    ctx.fillStyle = 'rgba(80,160,255,0.55)';
    ctx.fillRect(x, y, cs, cs);
  }
  if (atkToSet.has(k)) {
    ctx.fillStyle = 'rgba(255,80,80,0.55)';
    ctx.fillRect(x, y, cs, cs);
  }
  if (moveFromSet.has(k) || atkFromSet.has(k)) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
  }

  // Hill icon
  if (tile.type === TILE_HILL) {
    ctx.fillStyle = '#8fbc8f';
    ctx.font = `${Math.max(8, cs * 0.45)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▲', x + cs / 2, y + cs / 2 - cs * 0.1);
  }

  // Troop count
  if (tile.troops > 0) {
    const fontSize = Math.max(8, Math.floor(cs * 0.38));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(tile.troops, x + cs / 2 + 1, y + cs / 2 + cs * 0.18 + 1);

    ctx.fillStyle = troopCountColor(tile.owner);
    ctx.fillText(tile.troops, x + cs / 2, y + cs / 2 + cs * 0.18);
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function key(r, c) { return r * GRID + c; }
function decodeKey(k) { return { r: Math.floor(k / GRID), c: k % GRID }; }

const TILE_TYPE_LABELS = { [TILE_EMPTY]: 'Empty', [TILE_WALL]: 'Wall', [TILE_HILL]: 'Hill' };

function troopCountColor(owner) {
  if (owner === OWNER_P1) return '#ddeeff';
  if (owner === OWNER_P2) return '#ffdddd';
  return '#fff';
}

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
  const label = document.getElementById('phase-label');
  if (phase === PHASE_P1)
    label.textContent = "Player 1's Turn — Select a tile";
  else
    label.textContent = "Player 2's Turn — Select a tile";
}

function showTileInfo(r, c) {
  const tile = tiles[r][c];
  const detail = document.getElementById('tile-detail');
  const typeStr = TILE_TYPE_LABELS[tile.type] ?? 'Unknown';
  const ownerStr = tile.owner === OWNER_P1 ? 'Player 1' : tile.owner === OWNER_P2 ? 'Player 2' : 'None';
  detail.textContent = `(${r},${c}) ${typeStr} | Owner: ${ownerStr} | Troops: ${tile.troops}`;
  document.getElementById('tile-info').classList.remove('hidden');

  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const hasMoved   = plans[currentOwner].some(p => p.kind === 'move'   && p.from.r === r && p.from.c === c);
  const hasAttacked= plans[currentOwner].some(p => p.kind === 'attack' && p.from.r === r && p.from.c === c);
  document.getElementById('btn-move').disabled   = hasMoved   || tile.owner !== currentOwner || tile.troops === 0;
  document.getElementById('btn-attack').disabled = hasAttacked|| tile.owner !== currentOwner || tile.troops === 0;
}

function hideTileInfo() {
  document.getElementById('tile-info').classList.add('hidden');
  document.getElementById('tile-detail').textContent = '';
}

function clearLog() {
  eventLog = [];
  document.getElementById('event-log').innerHTML = '';
}

function addLog(msg) {
  eventLog.unshift(msg);
  if (eventLog.length > 10) eventLog.pop();
  const ul = document.getElementById('event-log');
  ul.innerHTML = '';
  for (const m of eventLog) {
    const li = document.createElement('li');
    li.textContent = m;
    ul.appendChild(li);
  }
}

// ─── Interaction ──────────────────────────────────────────────────────────────
function onCanvasClick(e) {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top)  * (canvas.height / rect.height);
  const c = Math.floor(x / cellSize);
  const r = Math.floor(y / cellSize);
  if (r < 0 || r >= GRID || c < 0 || c >= GRID) return;

  handleTileClick(r, c);
}

function handleTileClick(r, c) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;

  if (pendingAction === 'move') {
    tryPlanMove(r, c);
    return;
  }
  if (pendingAction === 'attack') {
    tryPlanAttack(r, c);
    return;
  }

  // Normal selection
  selected = { r, c };
  pendingAction = null;
  render();
  showTileInfo(r, c);
}

function onBtnMove() {
  if (!selected) return;
  pendingAction = 'move';
  document.getElementById('phase-label').textContent = 'Click an adjacent empty tile to move to';
  render();
}

function onBtnAttack() {
  if (!selected) return;
  pendingAction = 'attack';
  document.getElementById('phase-label').textContent = 'Click an enemy tile to attack';
  render();
}

function onBtnCancel() {
  pendingAction = null;
  selected = null;
  render();
  hideTileInfo();
  updatePhaseLabel();
}

function tryPlanMove(r, c) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const from = selected;

  if (!isAdjacent(from.r, from.c, r, c)) {
    addLog('Move: must be adjacent.');
    pendingAction = null;
    updatePhaseLabel();
    return;
  }
  if (tiles[r][c].type === TILE_WALL) {
    addLog('Move: cannot move onto a wall.');
    pendingAction = null;
    updatePhaseLabel();
    return;
  }
  // Can move onto an empty tile OR a friendly tile
  // Cannot move onto an enemy tile
  if (tiles[r][c].owner !== OWNER_NONE && tiles[r][c].owner !== currentOwner) {
    addLog('Move: cannot move onto an enemy tile.');
    pendingAction = null;
    updatePhaseLabel();
    return;
  }

  // Remove any existing move plan from this tile
  plans[currentOwner] = plans[currentOwner].filter(p => !(p.kind === 'move' && p.from.r === from.r && p.from.c === from.c));
  plans[currentOwner].push({ kind: 'move', from: { r: from.r, c: from.c }, to: { r, c } });

  pendingAction = null;
  selected = null;
  hideTileInfo();
  render();
  updatePhaseLabel();
  addLog(`P${currentOwner} plans move (${from.r},${from.c})→(${r},${c})`);
}

function tryPlanAttack(r, c) {
  const currentOwner = phase === PHASE_P1 ? OWNER_P1 : OWNER_P2;
  const from = selected;

  if (tiles[r][c].owner === currentOwner) {
    addLog('Attack: cannot attack own tile.');
    pendingAction = null;
    updatePhaseLabel();
    return;
  }
  if (tiles[r][c].owner === OWNER_NONE) {
    addLog('Attack: no enemy troops there.');
    pendingAction = null;
    updatePhaseLabel();
    return;
  }

  if (!canAttack(from.r, from.c, r, c)) {
    addLog('Attack: target out of range or blocked by wall.');
    pendingAction = null;
    updatePhaseLabel();
    return;
  }

  // Remove existing attack from this tile
  plans[currentOwner] = plans[currentOwner].filter(p => !(p.kind === 'attack' && p.from.r === from.r && p.from.c === from.c));
  plans[currentOwner].push({ kind: 'attack', from: { r: from.r, c: from.c }, to: { r, c } });

  pendingAction = null;
  selected = null;
  hideTileInfo();
  render();
  updatePhaseLabel();
  addLog(`P${currentOwner} plans attack (${from.r},${from.c})→(${r},${c})`);
}

// ─── Attack range / LOS ────────────────────────────────────────────────────────
function manhattan(r1, c1, r2, c2) {
  return Math.abs(r1 - r2) + Math.abs(c1 - c2);
}

function isAdjacent(r1, c1, r2, c2) {
  return manhattan(r1, c1, r2, c2) === 1;
}

function canAttack(fr, fc, tr, tc) {
  const tile = tiles[fr][fc];
  const isHill = tile.type === TILE_HILL;
  const range = isHill ? HILL_RANGE : BASE_RANGE;

  if (manhattan(fr, fc, tr, tc) > range) return false;
  if (isHill) return true; // Hills shoot over walls

  // Check wall blocking: a wall adjacent to shooter in direction of target blocks
  return !wallBlocksShot(fr, fc, tr, tc);
}

function wallBlocksShot(fr, fc, tr, tc) {
  // Direction vector (normalized to sign)
  const dr = tr - fr;
  const dc = tc - fc;

  // The wall must be directly adjacent to the shooter AND roughly in direction of target
  const adjacents = [
    { r: fr - 1, c: fc },
    { r: fr + 1, c: fc },
    { r: fr,     c: fc - 1 },
    { r: fr,     c: fc + 1 },
  ];

  for (const adj of adjacents) {
    if (adj.r < 0 || adj.r >= GRID || adj.c < 0 || adj.c >= GRID) continue;
    if (tiles[adj.r][adj.c].type !== TILE_WALL) continue;

    // Is this wall in roughly the direction of the target?
    const adr = adj.r - fr;
    const adc = adj.c - fc;

    // Dot product sign: positive means same general direction
    const dot = adr * dr + adc * dc;
    if (dot > 0) return true;
  }
  return false;
}

// ─── Turn / Done handling ─────────────────────────────────────────────────────
function onBtnDone() {
  if (phase === PHASE_P1) {
    // Show pass screen
    selected = null;
    pendingAction = null;
    render();
    hideTileInfo();
    document.getElementById('pass-title').textContent = 'Pass to Player 2';
    document.getElementById('pass-msg').textContent   = 'Player 1 has finished planning. Hand the device to Player 2.';
    document.getElementById('pass-overlay').classList.remove('hidden');
    phase = PHASE_P2;
  } else {
    // P2 done — resolve turn
    document.getElementById('pass-overlay').classList.add('hidden');
    resolveTurn();
  }
}

function onPassReady() {
  document.getElementById('pass-overlay').classList.add('hidden');
  selected = null;
  pendingAction = null;
  render();
  hideTileInfo();
  updatePhaseLabel();
}

// ─── Turn Resolution ──────────────────────────────────────────────────────────
function resolveTurn() {
  // 1. Movement phase
  resolveMovement();

  // 2. Attack phase
  resolveAttacks();

  // 3. Spawn phase
  resolveSpawn();

  // Advance turn
  turnNum++;
  plans = { [OWNER_P1]: [], [OWNER_P2]: [] };
  phase = PHASE_P1;
  selected = null;
  pendingAction = null;

  render();
  updateHUD();
  updatePhaseLabel();
  hideTileInfo();

  // Show pass screen for next turn's P1 setup
  document.getElementById('pass-title').textContent = `Turn ${turnNum} — Player 1's Planning Phase`;
  document.getElementById('pass-msg').textContent   = 'Results resolved! Now it is Player 1\'s turn to plan.';
  document.getElementById('pass-overlay').classList.remove('hidden');

  checkWin();
}

function resolveMovement() {
  // Process all moves simultaneously: collect movements, then apply
  const moves = [];
  for (const owner of [OWNER_P1, OWNER_P2]) {
    for (const p of plans[owner]) {
      if (p.kind !== 'move') continue;
      const fromTile = tiles[p.from.r][p.from.c];
      if (fromTile.owner !== owner || fromTile.troops === 0) continue;
      moves.push({ owner, from: p.from, to: p.to });
    }
  }

  // Apply moves: move 1 troop from each "from" to "to"
  // Collect destination increments to handle simultaneous arrival
  const arrivals = {}; // key -> { owner, count }
  for (const mv of moves) {
    const fromTile = tiles[mv.from.r][mv.from.c];
    // Validate destination is still valid
    const toTile = tiles[mv.to.r][mv.to.c];
    if (toTile.type === TILE_WALL) continue;
    // Can't move into enemy tile
    if (toTile.owner !== OWNER_NONE && toTile.owner !== mv.owner) continue;

    fromTile.troops = Math.max(0, fromTile.troops - 1);
    if (fromTile.troops === 0) fromTile.owner = OWNER_NONE;

    const k = key(mv.to.r, mv.to.c);
    if (!arrivals[k]) arrivals[k] = { owner: mv.owner, r: mv.to.r, c: mv.to.c, count: 0 };
    arrivals[k].count++;
    addLog(`P${mv.owner} moved (${mv.from.r},${mv.from.c})→(${mv.to.r},${mv.to.c})`);
  }

  for (const k in arrivals) {
    const { owner, r, c, count } = arrivals[k];
    const tile = tiles[r][c];
    if (tile.owner === OWNER_NONE) {
      tile.owner  = owner;
      tile.troops = count;
    } else if (tile.owner === owner) {
      tile.troops += count;
    }
    // enemy-occupied: movement validation above prevents this case
  }
}

function resolveAttacks() {
  // Collect all attacks first, then apply damage simultaneously
  const attacks = [];
  for (const owner of [OWNER_P1, OWNER_P2]) {
    for (const p of plans[owner]) {
      if (p.kind !== 'attack') continue;
      const fromTile = tiles[p.from.r][p.from.c];
      if (fromTile.owner !== owner || fromTile.troops === 0) continue;
      attacks.push({ owner, from: p.from, to: p.to });
    }
  }

  // Check preemptive attack rule: if both players attack the same tile simultaneously,
  // both attacking troops lose 1 unit (mutual strike)
  const attackMap = {}; // key(to) -> [attack list]
  for (const atk of attacks) {
    const k = key(atk.to.r, atk.to.c);
    if (!attackMap[k]) attackMap[k] = [];
    attackMap[k].push(atk);
  }

  // Mutual strike: if P1 attacks tile X and P2 attacks tile Y, and P2 attacks from X simultaneously
  // i.e., if P1 attacks P2's tile A while P2 attacks P1's tile B that's the same — check per tile
  // The rule says: "both players attack the same tile simultaneously → both lose 1 troop"
  // Interpretation: if P1 attacks tile T and P2 ALSO attacks tile T at the same time, penalty on both attackers.

  const penaltyTiles = new Set(); // tiles of attackers that receive the mutual strike penalty
  for (const k in attackMap) {
    const list = attackMap[k];
    if (list.length >= 2) {
      // Both players attacked the same target
      for (const atk of list) {
        penaltyTiles.add(key(atk.from.r, atk.from.c));
        addLog(`Mutual strike on (${atk.to.r},${atk.to.c})! Attacker at (${atk.from.r},${atk.from.c}) loses 1.`);
      }
    }
  }

  // Apply damage to targets
  const damage = {}; // key -> amount
  for (const atk of attacks) {
    const k = key(atk.to.r, atk.to.c);
    damage[k] = (damage[k] || 0) + 1;
    addLog(`P${atk.owner} attacks (${atk.from.r},${atk.from.c})→(${atk.to.r},${atk.to.c})`);
  }

  for (const k in damage) {
    const { r, c } = decodeKey(Number(k));
    const tile = tiles[r][c];
    tile.troops = Math.max(0, tile.troops - damage[k]);
    if (tile.troops === 0) tile.owner = OWNER_NONE;
  }

  // Apply mutual strike penalties to attackers
  for (const k of penaltyTiles) {
    const { r, c } = decodeKey(k);
    const tile = tiles[r][c];
    tile.troops = Math.max(0, tile.troops - 1);
    if (tile.troops === 0) tile.owner = OWNER_NONE;
  }
}

function resolveSpawn() {
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const tile = tiles[r][c];
      if (tile.owner !== OWNER_NONE && tile.troops > 0) {
        tile.troops++;
      }
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
  if (p1c === 0 && p2c === 0) {
    showWin('Draw!');
  } else if (p1c === 0) {
    showWin('Player 2 Wins!');
  } else if (p2c === 0) {
    showWin('Player 1 Wins!');
  }
}

function showWin(msg) {
  document.getElementById('pass-overlay').classList.add('hidden');
  document.getElementById('win-title').textContent = msg;
  document.getElementById('win-overlay').classList.remove('hidden');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
