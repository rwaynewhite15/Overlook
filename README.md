# Overlook
Sniper based territory domination game.

## Gameplay Overview

Two players take turns planning moves and attacks on a 5×5 grid. Each turn, both players submit their plans simultaneously; then all actions resolve together.

### Tile Types
- **Empty** – standard ground, can be captured and held.
- **Hill** – extended attack range (6 tiles) and fortification bonus (50% miss chance when 3+ troops are present).
- **Wall** – impassable; blocks line-of-sight for non-hill attackers.

### Winning
Eliminate all enemy troops (reduce their tile count to zero) to win.

---

## Game Rules

### Troop Spawning
A tile must be **occupied for 3 consecutive turns** before a new troop spawns on it. Once the spawn happens the occupancy counter resets to zero, so the next troop takes another 3 turns. The counter also resets whenever:
- All troops leave the tile (it becomes empty).
- The last troop on the tile is killed.

### Moving Troops
A troop can move to any adjacent (non-wall) tile that is either unoccupied or already owned by the same player. When a troop moves, the **origin tile's troop count decreases by 1**. If the origin tile reaches 0 troops it reverts to unowned and its spawn counter resets.

### Attacking
Each troop can plan one attack per turn. Range depends on terrain:
- **Empty/Wall-adjacent tiles**: 3 tiles (Manhattan distance), blocked by adjacent walls.
- **Hill tiles**: 6 tiles, unobstructed (overwatch).

If two opposing players both attack each other in the same turn (mutual strike) the attacker also loses 1 troop.

---

## AI Opponent

Enable the **"AI plays Player 2"** checkbox in the sidebar before or during a game. When active:
- After Player 1 clicks **Done**, the AI automatically generates Player 2's plans and the turn resolves immediately (no device-passing needed).
- The AI **attacks** any reachable Player 1 tile first (random target selection among valid targets).
- If no attack is possible, it **moves** toward the nearest Player 1 tile (greedy heuristic).
- The AI follows the same rules as the human player: spawn counters, population decrements, wall blocking, etc.

Uncheck the toggle at any time to switch back to two-human play.
