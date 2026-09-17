# Plan 1 — opening attack, walking NPCs, and the missing night attackers

Answers `ai/prompt_1.md`. Nothing below is implemented yet.

---

## 0. What I found before planning

I ran the game (`?autoplay`, default world, tier high), started nights 1–3 the normal way (the **N** key path: dusk, then night), and logged every attacker every 3 s from `window.game`.

### 0.1 Most attackers are invisible (the main cause of prompt item 3)

| Check | Result |
|---|---|
| Night 3, alive attackers with a loaded model | 9 |
| …of those, meshes actually in the render list (`scene._selectionOctree.dynamicContent`) | **2** (one per model type) |
| Default defenders (2 swordsmen, 2 archers) | only the **first instance of each model** rendered. The others showed just a shadow disc, or a floating bow. |
| `archer1.mesh.metadata === archer2.mesh.metadata` | **true** |

**Root cause.** `CharacterInstance._attachModel` (`src/characters/library.js:177`) clones the model with `instantiateModelsToScene`. Babylon copies `mesh.metadata` **by reference**, so all clones of one GLB share one metadata object. noa stores its own bookkeeping flags in `mesh.metadata` (`noa_added_to_scene` in `vendor/noa/src/lib/rendering.js`; `noa_in_dynamic_list` / `noa_in_octree_block` in `vendor/noa/src/lib/sceneOctreeManager.js`). When the second clone reaches `addMeshToScene`, the flag already says "added", so noa returns early and the mesh never enters the render list. When the first clone is disposed, the shared flag is cleared, so at most about one unit per model is visible at any time.

The simulation itself works: attackers spawn, path to the town, and fight. They just aren't drawn.

**Verified:** in the running page (no files changed), giving each hidden mesh its own `metadata = {}` and calling `addMeshToScene` again made the missing defenders render (2 → 4).

**Consequence for next_0:** the night benchmark (~54 fps desktop / ~58 fps mobile emulation) was measured while most characters **weren't drawn**. Those numbers are optimistic and must be re-measured (§1.4).

### 0.2 Even when visible, the attack never reaches the base

Timeline of night 1 on the default world (17 grunts, 2 sub-waves):

| Time into night | What happened |
|---|---|
| 0 s | 9 grunts spawn **73–102 blocks** from the Town Center, spread over all 4 island edges at random |
| ~20 s | first grunts reach tower range (arrow towers: range 18, at the wall corners) |
| 23–60 s | 4 arrow towers + 2 archers kill every grunt at 9–21 blocks from the center. **No wall block was attacked** (`attackBlock` was never set). |
| 57 s | night over. **Town Center HP stayed 2500/2500.** |

Night 2 lasted under 40 s. Night 3 was similar. Other things that make the attack hard to see:
- The aerial camera starts at zoom 38 over the town, which frames only the ~30×30 walled area. Attackers are off screen until they reach the wall, and that's where they die.
- At night the fog starts at ~50 blocks, and attackers spawn 73–102 blocks out.
- The dusk role picker is a modal that covers the view.
- There's no direction indicator. The only sign of an attack is the "Attackers: N" counter.

### 0.3 Small bugs found along the way
- Defenders that survive a night keep their lost HP the next day. Only dead defenders are respawned at dawn (`session.js`, `phase === 'day'`).
- After a night, the builder's body stays hidden if you're in aerial view by day. `setVisible(false)` at night is only undone by `enterBuild()`.

### 0.4 Current NPC movement (prompt item 2)
- Defenders stand still at their post. They only move to chase an enemy within their leash, then walk back in a **straight line** (no pathing, even though plan_0 promised a local A*).
- Attackers exist only at night (or during daytime skirmish, which is off by default).
- So by day nothing moves.

---

## 1. Night attackers: visible, and actually attacking the base

Done first, because items 1 and 2 can't be judged while most characters are invisible.

### 1.1 Rendering fix (root cause)
- **Patch vendored noa**: replace the metadata flags with module-level `WeakSet` / `WeakMap` keyed by mesh:
  - `rendering.js`: `addedToScene`
  - `sceneOctreeManager.js`: `inDynamicList`, `inOctreeBlock`, and `mesh → octreeBlock`

  Behaviour stays the same, but clones can no longer share state. This fixes the whole class of bug (character clones, future external-avatar clones, any `mesh.clone()`), not just `CharacterInstance`.
- Mark the change `[block patch]` and add a row to `vendor/noa/UPSTREAM.md`.
- **Unit test** (`tests/render.test.js`, Babylon `NullEngine` in Node): put a mesh in an `AssetContainer`, instantiate it 3 times, add each clone through `SceneOctreeManager`, and expect all 3 in `dynamicContent`. Then dispose one and expect the other 2 to remain.

### 1.2 Attack fronts instead of random edges (`src/game/waves.js`)
- Each sub-wave picks **one front**: a compass direction. Later nights use 2 fronts (night ≥ 6).
- Spawns cluster in a ±20° arc on a **spawn ring 45–60 blocks from the Town Center** (`SPAWN_RADIUS` in `balance.js`), not at the island edge. If a point is water, step inward along the ray until there's land.
- A group spawns within ~2 s so it arrives together. A concentrated group can't be picked off one at a time by the towers on the far side of town.
- `pickFront(rnd, level)` and `spawnRing(world, front, rnd)` are pure functions and get unit tests (points on land, within radius, inside the arc).

### 1.3 Seeing it happen
- **Banner** (a new non-modal HUD strip; §2 reuses it): "Attackers approaching from the north-east". It replaces the plain toast for sub-waves.
- **Off-screen marker**: an edge-of-screen arrow pointing at the centroid of each active front while its attackers are off screen. It's DOM only, updated in the existing 100 ms HUD tick.
- **Camera glide**: at night start and at each sub-wave, if the player is in aerial view and hasn't moved the camera for 5 s, ease the aerial camera (~1.5 s) so the frame covers both the front and the Town Center: heading from the front toward the town, zoom ~50. Raise `AERIAL_MAX_ZOOM` if 70 is too tight for that.
- **Dusk role picker** becomes a side panel instead of a modal, so the approaching sky and town stay visible.

### 1.4 Balance and performance gates
- **Balance target** (default world, no player help):

  | Night | Attackers reach the wall/gate and damage blocks | Town Center takes damage | Result | Night lasts |
  |---|---|---|---|---|
  | 1 | yes | some | survived | ≥ 90 s |
  | 3 | yes | clearly | usually survived | ≥ 90 s |

  Fronts (§1.2) are the main lever. After that, in `balance.js`: arrow tower range 18 → ~14, then tower damage, grunt HP, `SUBWAVE_INTERVAL`. Tune with scripted browser nights (5 runs per night level) that log Town Center HP, blocks damaged and duration. Record the numbers in `next_1.md`.
- **Re-measure performance** with every character actually drawn: `npm run perf` and `npm run perf:mobile`, plus the low tier (`?quality=low`) with 4× CPU throttle at its max wave.
  - Gate: ≥ 30 fps on low.
  - If it misses: first lower `maxAttackers` / `maxAnimated` in `quality.js`, and turn more budget into HP. Baked-vertex-animation crowds (deferred in next_0) only if that isn't enough.

### 1.5 Small fixes
- At dawn, restore the HP of living defenders too.
- Show the builder body again when entering aerial view by day.

---

## 2. Start the game with an attack (prompt item 1)

### 2.1 Design: "the first raid"
A short, scripted opening attack that shows the whole loop in about two minutes: raiders attack the Town Center, defences fight back, dawn rebuilds the damage, then day 1 starts with a clear instruction.

1. **When it plays**: a fresh survival game at day 1 / night level 1:
   - **Play** (default world)
   - a day-1 world from the world list
   - **New world** in survival

   It doesn't play on **Continue**, in creative mode, on worlds exported at day > 1, or with `?intro=0` (the perf scripts pass this). The decision is a pure function, `shouldPlayOpening(def, sourceId, params)`, with unit tests.
2. **Start**: the world becomes playable exactly as now; no extra blocking load. The game opens in **aerial view** (no pointer lock needed, works the same on touch), framing the town from the side the raid comes from. The sky is held at **late dusk** (orange, readable, "attack time").
3. **~1.5 s**: horn, then a banner: **"Raiders are attacking your Town Center — defend it!"** with the hint "Click or tap a defender to fight as it" and a **Skip** button.
4. **The raid** (`OPENING_RAID` in `balance.js`, fixed, not budget-based): 6 grunts + 1 brute from **one front**, spawning 30–36 blocks from the Town Center, so they arrive within ~10 s. The brute is there to visibly smash the gate.
5. **Always lost** (your call after the plan): the raid is sized to overwhelm the starting town, and if the defenders kill every raider anyway, reinforcements keep coming until the Town Center falls. The lesson is "the defences you start with aren't enough".
6. **End** (Town Center destroyed, or Skip): "The Town Center fell!" → the normal **dawn** rebuild effect → **Day 1** banner: "The raiders will return every night, stronger each time. Mine, build walls and towers, place troops. Press N (or tap Start night) when ready." Return to build mode. Desktop shows "Click to play" for pointer lock.
7. If the player possesses a unit and dies, the normal role picker appears.

### 2.2 Implementation
- `DayCycle`: `startOpening()` enters `night` directly with `activeLevel = 0`. `endNight` doesn't raise the night level for level 0. `skyTime` holds dusk for it.
- `WaveDirector.startOpeningRaid(front)`: uses the fixed list and §1.2's spawn ring with a smaller radius.
- `Session.init()`: decides whether to play the opening, then starts it ~1 s after the first playable frame. Autosave already only runs by day, so nothing is saved mid-raid. The world file format and exports are unchanged.
- **Load**: start fetching `attacker_grunt.glb` and `attacker_brute.glb` (~8 KB brotli each) as soon as **Play** is pressed. Today NPC models only start loading 1.5 s after the game starts. Until a model arrives, units show the existing placeholder box. The first-playable-frame path and the budget check are unchanged.

---

## 3. NPCs walk around day and night (prompt item 2)

### 3.1 Defender behaviour (`src/game/units.js`, `_thinkDefender`)
Priority order: **fight** (as now) → **return** (beyond the leash) → **idle movement**:

| Phase | Idle movement |
|---|---|
| Day | **Wander** within 5 blocks of the post at walking speed (~45% of max), pausing 2–6 s between moves. About 25% of the time, walk to a nearby point of interest within 12 blocks instead (the closest gate, tower base, or Town Center plaza), then drift back. |
| Dusk | Walk back to the post, so everyone is in position when the night starts. |
| Night | **Patrol** within 3 blocks of the post with short pauses. Switch to fighting as soon as an enemy is in range (ranged units stop to shoot). |

- Movement speed: add `u.moveSpeed` so `_act` stops forcing `maxSpeed = def.speed`. The existing velocity-based animation then plays `walk` instead of `run`.
- A unit's post stays its placement position. Wandering is temporary simulation state, **not an op**: exports and the op log don't change. For future multiplayer this is host-simulated NPC state, as `docs/protocol.md` already describes.
- Picking up a unit (click/tap) and possession work unchanged on a moving unit.
- Attackers already walk at night. No attackers by day unless Skirmish is on. No new villager NPCs.

### 3.2 Local pathing (`src/ai/localPath.js`, new, pure)
- Grid search over the voxels in a (2R+1)² window around the post, with the same standing rules as `navCore.js`: solid floor, 2 cells of headroom, step up ≤ 1, drop ≤ 3, no cutting diagonal corners, avoid spikes, gates passable for defenders.
- Returns a list of waypoints. It's used to pick a random reachable wander target and to walk back to the post, replacing today's straight-line return that gets stuck on walls.
- Cost: at most a few hundred cells per search, run only when a unit picks a new target, and spread across the existing staggered think timers.
- Unit tests with a fake `getBlock`: goes around a wall, goes through a gate, refuses a 2-block step up, never leaves the radius, returns null when boxed in.

---

## 4. Order of work

1. **§1.1 rendering fix + test, then re-measure performance (§1.4).** This comes first because the performance result may change tier caps.
2. **§1.2–1.5**: fronts, spawn ring, banner/marker/camera glide, side-panel role picker, small fixes, balance pass.
3. **§2**: opening raid (reuses the banner, fronts and camera glide).
4. **§3**: local pathing, then defender wander/patrol.
5. **Verify (§5)**, then write `ai/next_1.md`.

---

## 5. Verification

- **`npm run check`**: type check, all old tests, plus the new ones: render clones (§1.1), `pickFront` / `spawnRing` (§1.2), `shouldPlayOpening` and the opening night not raising the level (§2), `localPath` (§3.2).
- **Scripted browser runs** (Playwright, as in next_0):
  - Nights 1–3, including after deaths and dawn respawns: every alive, loaded unit's meshes are in the render list. Screenshots at night show the attacking group.
  - Default world, night 1 and night 3, 5 runs each: the balance table in §1.4 holds. Record the numbers.
  - Fresh **Play**: the raid starts ≤ 2 s after the first playable frame; raiders are in the aerial frame (screenshot); the Town Center falls; the raid ends → dawn → day 1 banner. **Continue**, creative and `?intro=0` all skip it. Skip works.
  - By day, over 30 s: every defender moves > 2 blocks, stays inside its radius, and none is stuck > 3 s. At dusk all are within 1 block of their post. At night they patrol and still fight.
  - Touch emulation: the Skip button and banner are reachable, and tapping a defender during the raid possesses it.
- **Performance**: `npm run build` budget passes. Menu interactive and first playable frame stay within ±0.2 s of next_0 (desktop 1.4 s warm, mobile 1.3–1.8 s). Night benchmark re-measured with all units drawn, ≥ 30 fps on low (§1.4).

---

## 6. Choices I made that you may want to override

1. **The opening attack is a short dusk "night 0"** using the night machinery, so dawn's rebuild is shown too. The alternative is a daylight raid before day 1.
2. **The opening raid is always lost** (reinforcements until the Town Center falls). *Changed after review: originally it couldn't be lost.*
3. **The opening raid is fixed** (6 grunts + 1 brute, one side), not built from the wave budget.
4. **Only fresh day-1 survival games** get the opening raid. Continue, creative and later-day worlds don't.
5. **Each sub-wave comes from one front** (two on later nights), not from all edges at random.
6. **Attackers spawn 45–60 blocks from the Town Center**, not at the island edge (73–102). That means less empty walking, and they arrive inside the fog range.
7. **Only defenders wander by day.** No daytime attackers unless Skirmish is on, and no new villager/worker NPCs.
8. **The rendering fix goes into vendored noa** (WeakMap/WeakSet), rather than a one-line `metadata = {}` reset in the character library.
