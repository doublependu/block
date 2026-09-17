# Plan 2: getting back to the builder, walls that hold, a devastating first raid, and the player in the night fight

Answers `ai/prompt_2.md`. Nothing below is implemented yet.

---

## 0. What I found before planning

I ran the dev build (default world, med/low tier) with scripted Playwright sessions and logged state from `window.game`. No files were changed.

### 0.1 Issue 1: stuck as a defender by day (reproduced)

Most paths work. In each of these, control **did** return to the builder at dawn, and mining worked afterwards:

- picking a role at dusk
- clicking a defender in aerial view during the opening raid
- the possessed defender dying, then closing the picker with ✕
- third person, plus Esc → Resume
- pressing M during the night
- carrying the defender 100 blocks away, so the chunks under the builder unload
- touch emulation

**The broken path: choosing a role during dawn.**

| Step | State |
|---|---|
| Night ends | `enterBuild()` runs at dawn, and the result panel opens |
| Close the result panel. The **Role** button is still shown (it's hidden only when `phase === 'day'`), and so is the R key. Pick a defender. | `mode: possess`, controlling an archer |
| Dawn → day | **still `possess`**, hotbar hidden, Role button now hidden, no way to build. The only way out is pressing M twice, which nothing tells you. |

**Root causes:**
- `openRolePicker()` refuses only when `phase === 'day'`, so it still works at dawn.
- `hud.update` shows the Role button in every phase except day.
- The `day` handler in `session.js` never returns control to the builder. Only the `dawn` handler does.

Dawn lasts at least 4 s plus rebuild time. Item 2 (a devastated town) will make dawn longer, so this path will get more common.

### 0.2 Gameplay 1: how attackers get past the walls today

Night 1, default world, med tier, no player input. I logged each attacker at the moment it entered the wall ring:

| Measure | Result |
|---|---|
| Attackers inside the ring before **any** block was destroyed | 11 (run 1). In run 2, all 12 logged entries got in without breaking anything. |
| First attacker inside | 12–14 s into the night |
| Wall/gate/tower blocks hit all night | **0** (run 1). The night was survived; the Town Center wasn't touched. |
| Way in #1 (1 of 12) | **Walked through a gate** on the east side. Gates are `solid: false` for everyone. The rule "a wall for attackers" is only enforced by nav, and this grunt never attacked the gate. |
| Way in #2 (11 of 12) | **Walked over the wall** on the west/north hill side. The ground outside is 1–3 blocks above the plaza, so the top of the 2-high wall is level with the hill. The flow field has standing nodes on wall tops, so it routes attackers across. |
| Attacker jump height (AI taps jump for one tick) | grunt **1.82**, brute **1.93** blocks: almost a 2-high wall. A possessed attacker holding Space keeps `jumpForce` on for 0.5 s. That's about 3 blocks by the numbers (not measured). |

### 0.3 Costs checked for the new work

- **Flow field build** (Node, default world 192², this machine's CPU): 16–21 ms per field once warm, 27–34 ms the first time. Adding a third field is affordable in the worker: about 70–85 ms per rebuild at 4× CPU throttle, off the main thread. Rebuilds happen at most every 0.7 s.
- **Town Center**: generator terrain (a 3×3×3 `town_core` plus a `town_crystal`), unbreakable, with an HP pool. The damage overlay can hold any block, so the Town Center can crumble visually and still come back at dawn.
  - However, the nav **goal** is "next to an `F_TOWN` block", so removing those blocks would erase the goal.
- **`items.glb`** already has `sword`, `bow`, `gun` and `pickaxe` meshes, and the rig has `hold_sword` / `hold_bow` / `hold_gun`. Weapons need no new assets.

---

## 1. Issue 1: always get your builder back

`src/game/control.js`, `src/game/session.js`, `src/ui/hud.js`

1. **Roles only at dusk and night.** Add a pure `canChooseRole(phase)`, true only for `dusk` and `night`.
   - `openRolePicker`, `chooseRole`, `aerialClick` and `touchTap` all check it.
   - The Role button is hidden unless it's true.
   - The picker closes itself at dawn.
2. **One idempotent `returnToSelf()`** (rename of `enterBuild`, see §4.1). Both the `dawn` and the `day` handlers call it.
   - Also a safety check in `Control.tick`: if the phase is `dawn` or `day` and the mode is `possess`, `dead` or `aerial` without the player asking for aerial, return to self.
   - It clears `pendingRole` and cancels the delayed possess timer from the `spawned` handler.
3. **A way back during the night:** "Fight as yourself" at the top of the role picker (§4.3). Mode label and help text say "R: change role / back to yourself".
4. **Regression test:** a Playwright scenario matrix covering the 8 paths in §0.1 (plus the new self/autopilot switches). At day start every path must show mode `self`, visible hotbar, `canEdit`, and a block actually mined.

---

## 2. Gameplay 1: attackers must break walls and towers, never hop over

### 2.1 Walls are real barriers

1. **No standing on defensive structures (nav):** `src/ai/navCore.js`.
   - A cell is **not standable for attackers** if its floor is:
     - a gate or tower block, or
     - a built block resting on another built block (a built stack ≥ 2 high = a wall).
   - A single built layer on natural ground (paths, floors) stays walkable.
   - The existing breakable ground-level node through a wall is unchanged, so the only way through is breaking it.
2. **Gates hold attackers back physically:** `units.js`, every tick, for AI **and** possessed attackers.
   - If the attacker's box overlaps a gate cell, move it back to its last position on that axis and zero that velocity component.
   - The AI marks the gate as `attackBlock`.
   - Defenders and the builder still walk through gates.
3. **Jump cap for attackers:** `jumpForce: 0` and `jumpImpulse ≈ 6.5`, for a **≤ 1.2 block** jump even when a player holds Space. `autoStep` still handles 1-block steps.
4. **Pushed onto a wall top anyway** (crowding): an attacker whose feet are on a non-standable top attacks the block under its feet instead of heading for the Town Center. Today it falls back to "walk straight at the town center", which drops it inside.
5. **Default world:** `src/world/defaultWorld.js`, then regenerate `worlds/default.world.json`.
   - Walls and gates rise to **max(plaza + 2, highest ground within 2 blocks outside + 2)**, so the hill-side walls are 3–5 high.
   - Corner tower columns rise to wall top + 1.
   - `tests/worldfile.test.js` keeps the script and the file in sync.

### 2.2 Towers and walls first (siege behaviour)

- **Attacker roles** (`balance.js`):
  - *Wreckers*: brute, sapper, and `WRECKER_SHARE` = 30% of grunts. They go for structures.
  - *Fighters*: grunt, raider archer. They fight defenders and the builder, and go through breaches to the Town Center.
- **Siege field** (a third flow field, `nav.worker.js`): a multi-source Dijkstra with seed costs as priorities.
  - **Tower goals**, cost 0: a standing node next to a tower column, with the tower block within reach (0–3 above the feet).
  - **Wall goals**, cost +200, only while `siegeMode = 'walls'` (opening raid, §3).
  - **Town Center goals**, cost +600. With these, a wrecker can always follow the siege field alone: to a tower within about 60 blocks of detour, otherwise straight at the Town Center, breaking walls on the way.
  - It isn't computed when there are no towers and no wall goals.
- **Town Center goal by footprint:** nodes next to the 3×3 Town Center footprint, taken from the world def (sent at init), not from `F_TOWN` blocks. The goal survives the Town Center crumbling (§3.2).
- **Wrecker brain** (`units.js`), in priority order:
  1. Fight back only against an enemy within 2.5 blocks.
  2. Keep attacking the current structure target.
  3. Follow the siege field. At a goal, attack the adjacent tower block, else the wall block, else the Town Center.
- **Wider breaches:**
  - After a wrecker destroys a wall block, with `WIDEN_CHANCE` (0.35 on normal nights, 1.0 in the opening raid) it attacks the next wall block along the same wall line, up to 3 blocks.
  - A brute hit on a built block also deals 50% to the built blocks left and right of it.
- **Collapse (night only):** when a built block is destroyed, built blocks directly above it with nothing under them fall too (debris burst, column only, at most 8). Towers fall when their column is cut. All of it goes into the damage overlay, so it's restored at dawn.
- Fighters are unchanged, except that they now path through real breaches (§2.1).

### 2.3 Balance targets for regular nights (default world, builder on autopilot with a wooden sword, 5 runs each)

| Night | Attackers inside before any breach | Blocks destroyed | Towers destroyed | Town Center hit | Survived |
|---|---|---|---|---|---|
| 1 | **0** | ≥ 6 | ≥ 1 damaged | some | ≥ 4/5 |
| 3 | **0** | ≥ 15 | ≥ 1 destroyed | clearly | ≥ 3/5 |

Tuning order: `HP_PER_HARDNESS`, `WIDEN_CHANCE`, `WRECKER_SHARE`, then wave budget. Collapse makes walls weaker; wall HP compensates.

---

## 3. Gameplay 2: the first raid leaves the village in ruins

"The first attack of the first night" is the **opening raid** that starts a new game (§6, choice 1).

### 3.1 End state when the raid ends (the contract)

| Structure | Target |
|---|---|
| Walls and gates | ≥ 70% of blocks destroyed |
| Arrow towers | 4 of 4 destroyed |
| Town Center | all 28 blocks gone, HP 0 |
| Duration | 60–100 s |
| Outcome | always lost, even when the player fights well |

### 3.2 New mechanics (all nights, stronger in the raid)

1. **Town Center crumbles:** `src/game/siege.js` (new) and `worldState.demolish()`.
   - Pure `townRuinStage(hpFraction)` returns which Town Center blocks are gone at each stage: crystal at 80%, then top layer, middle layer, bottom corners, then everything at 0%.
   - Blocks go into the damage overlay, with a dust burst per block, a big burst and a ~6 s smoke plume at 0.
   - Dawn restores them like any night damage.
   - This also gives regular nights a readable Town Center health display (a next_1 item).
2. **Sapper charges:**
   - A sapper that reaches a siege goal plants a keg: a box primitive with one shared material and a flashing emissive color.
   - After a 2.5 s fuse it explodes. Built blocks within radius 2.5 are demolished, units within 3 take 60 damage (both sides), and it deals 400 to the Town Center if within 4.
   - Explosion sound, a big burst, and a small camera shake when within 25 blocks.
   - Sappers still unlock at night 5 for regular waves. The raid brings them from the start.
3. **Demolition spread over ticks:** blocks from explosions and collapses are queued and applied ≤ 8 per tick, so one explosion doesn't remesh several chunks in the same frame.

### 3.3 Opening raid script

`opening.js`, `waves.js`, `balance.js` `OPENING_RAID`

- **Four fronts**, one per gate side, staggered 3 / 10 / 17 / 24 s. Each group: 1 brute + 1 sapper + 3 grunts at 1.5× HP.
- **`siegeMode = 'walls'` and a Town Center lock:**
  - Attackers don't hit the Town Center until all towers are down and wall blocks are ≤ 40% of the start.
  - Then the lock lifts, everyone pushes the Town Center, and a banner says "The walls are down — they're going for the Town Center!".
- **Reinforcements** as in itr 1: 1 brute + 1 sapper + 2 grunts per round, on the front with the most structure left.
- **Guaranteed finale:** at 110 s, if the contract in §3.1 isn't met, the raiders "light the powder stores".
  - Remaining towers explode one by one.
  - Wall stretches collapse in waves.
  - The Town Center goes through its last stages over ~6 s.
  - The simulation should normally get there on its own; balance runs report how often the finale was needed (target ≤ 1 in 5).
- **Aftermath (~6 s):**
  - Raiders play `cheer` and fade out.
  - The aerial camera slowly orbits the ruins while smoke rises from the Town Center and a few breach spots.
  - Then the result panel → dawn.
- **Dawn after the raid** rebuilds at ~60 blocks/s instead of 300, so the town visibly comes back over ~5 s. Then the Day 1 banner.

---

## 4. Gameplay 3: the player fights at night

### 4.1 The builder is in the fight

- **The builder is no longer benched at night.** It stays active, visible, has a shadow, can be targeted and hurt.
- The `build` mode is renamed **`self`** (you control your builder, day or night).
  - By day it mines and builds as now.
  - At night mining and placing are off, and left click / the fire button uses the equipped weapon.
- **Dusk** no longer opens the role picker on its own. Instead, a banner: "Night 2 is coming — you'll fight as yourself." with a **Change role (R)** button.
  - The best weapon in the hotbar is selected automatically, if one exists.
- **Knocked out at night:**
  - The builder drops, with a 12 s respawn countdown on the HP chip, and respawns at the Town Center with full HP.
  - Meanwhile the role picker opens so you can take over a unit or watch.
  - At dawn a downed builder revives at once.

### 4.2 Weapons worth crafting

Item kind `weapon`, defined in `balance.js` `WEAPONS`. Tiers share the `items.glb` mesh with a tint: wood brown, stone grey, iron silver.

| Weapon | Recipe | Attack | Damage | Cooldown (s) | Range | DPS |
|---|---|---|---|---|---|---|
| (none / pickaxe) | — | melee | 10 | 0.5 | 2.2 | 20 |
| Wooden sword | 4 planks | melee | 16 | 0.45 | 2.4 | 36 |
| Stone sword | 3 cobble, 1 planks | melee | 24 | 0.45 | 2.4 | 53 |
| Iron sword | 3 iron, 1 planks | melee | 36 | 0.45 | 2.6 | 80 |
| Bow | 3 planks, 1 log | arrow | 18 | 0.8 | 30 | 22 (safe) |
| Musket | 4 iron, 2 gold | bullet | 60 | 1.4 | 40 | 43 (long range) |

- **Aiming:** melee uses the existing ray plus cone hit test. Ranged weapons fire along the camera like a possessed archer or gunner (`effects.fireDir`).
- **By day:** a sword still mines. A bow or musket shoots instead of mining.
- `STARTING_INVENTORY` gains a **wooden sword**, so the system is visible from the start and in the opening raid.
- **Wave growth:** the best weapon adds to `defenceValue` (`WEAPONS[x].value`), so nights keep up with a well-armed player.

### 4.3 Leaving the builder to an algorithm

- **Autopilot rule:** at night, whenever you aren't controlling your builder (aerial view, playing another unit, or knocked out and respawned), the builder runs a **hero brain** (`units.js` `_thinkHero`).
- **Role picker, "You" section:**
  - **Fight as yourself**
  - **Watch from above** (your builder fights on its own)
  - Defence and attack units as before, with the note "your builder fights on its own"
  - The mode chip shows "Builder: autopilot".
- **Hero brain:**
  - Leash 20 blocks around the Town Center, so it covers the walls and corner towers.
  - Target priority: attackers hitting the Town Center > attackers hitting a tower or wall > nearest attacker within 14 blocks.
  - Melee weapons chase. Ranged weapons keep 6–10 blocks away and need line of sight.
  - It walks with `localPath` (window radius 20 around the Town Center, run only when it picks a new target) and uses the best weapon in the inventory.
  - When idle it walks back to the Town Center plaza.
- **Multiplayer note** (`docs/protocol.md`): each player's builder autopilot is simulated by that player's client and sent as presence, not by the host.

### 4.4 Balance targets

Scripted runs with the autopilot as a stand-in for the player:
- **Wooden sword:** the builder gets ≥ 10% of kills on night 1.
- **Iron sword:** 25–35% of kills on night 3, and dies at most once.
- Without the builder, the §2.3 results should be clearly worse. That's the "worth crafting" check.

---

## 5. Order of work, and verification

### 5.1 Order

1. **§1 issue 1** + scenario matrix. Small; do it first.
2. **§2.1 barriers**: nav no-stand rule, gate barrier, jump cap, wall-top fallback, default world walls. Re-run the §0.2 crossing log: 0 crossings before a breach.
3. **§3.2 Town Center footprint goal and crumbling**, `demolish`, collapse, demolition queue.
4. **§2.2 siege**: siege field, wrecker brain, wider breaches, brute splash.
5. **§4 builder at night**: `self` mode, weapons and recipes, knockout flow, hero autopilot, role picker.
6. **§3.3 opening raid**: sappers, four fronts, Town Center lock, finale, aftermath, slow dawn.
7. **Balance passes** (§2.3, §3.1, §4.4), performance, then `ai/next_2.md`.

### 5.2 Unit tests (`npm run check`)

- `canChooseRole` for each phase.
- **Nav:**
  - An attacker path over a hill-side wall has to break the wall.
  - No standable node on a 2-stack top, a gate or a tower; a 1-layer floor is still standable.
  - The Town Center goal still exists after the Town Center blocks are removed.
  - The siege field leads to a tower and falls back to the Town Center.
  - Wall goals appear only in `walls` mode.
- **Siege rules:** `townRuinStage` thresholds, and the collapse column rule (stops at natural or supported blocks, capped at 8).
- **Weapons:** `WEAPONS` / recipes, `Inventory.bestWeapon`, `defenceValue` including the weapon.
- **Opening rules:** four fronts, lock release condition, finale trigger.

### 5.3 Scripted browser runs (Playwright)

- **Issue 1:** the matrix from §1.4 passes, including the dawn Role path.
- **Walls:** nights 1 and 3, 5 runs each, crossing and siege log.
  - Zero attackers inside before a breach, zero standing on a wall top, zero inside a gate cell.
  - Fill in the §2.3 table.
- **Possessed attacker:** holding Space against a 2-high wall doesn't get over it; walking into a gate is blocked.
- **Opening raid:** 5 runs with no input.
  - Fill in the §3.1 table: wall %, towers, Town Center blocks left, duration, finale needed y/n.
  - Screenshots: breach, explosion, ruins orbit, rebuild, Day 1 banner.
- **Builder at night:**
  - In self mode: visible, takes damage, kills with a crafted weapon (damage matches the table).
  - Knockout → countdown → picker → respawn.
  - Switching to aerial or another unit turns the autopilot on; it fights within its leash.
  - Dawn always returns to self.
- **Touch** (412×915): "Fight as yourself" and roles by tap, the fire button swings and shoots, and the banner action works.

### 5.4 Performance

- `npm run build` budget passes. No new downloads: weapons reuse `items.glb`, and the keg and smoke are primitives and particles.
- Menu interactive and first playable frame stay within ±0.2 s of next_1 (desktop 0.73–0.78 s warm, mobile 1.48 s).
- **Night benchmark** (`perf`, `perf:mobile`, `--quality=low`) with the siege field and the active builder: ≥ 30 fps on low.
- **Opening raid** on low tier with 4× CPU throttle:
  - average ≥ 30 fps
  - **longest frame during explosions/collapse ≤ 100 ms**
  - log the siege field rebuild time in the worker
  - If it misses, first lower demolition per tick, then particle and smoke caps per tier.

---

## 6. Choices I made that you may want to override

1. **"First attack of the first night" = the opening raid**, not the regular night 1 after day 1. Night 1 stays survivable.
2. **The ruins are repaired at dawn**, as with every night ("the town recovers automatically", prompt_0), but slowly and visibly after the raid.
   - The alternative: walls and towers stay broken into day 1 (only the Town Center is rebuilt), and rebuilding is day 1's job.
3. **Sappers carry explosive kegs** (in the raid from the start, in regular waves from night 5). That's the main way to get "devastated" within about 90 s.
4. **A scripted finale** at 110 s guarantees the ruined end state if the simulation falls short (for example when the player fights well).
5. **The Town Center visibly crumbles on every night**, not just the raid.
6. **The builder is always in the night fight**: controlled by you, or on autopilot when you watch or play another unit. There's no option to keep the builder out.
7. **Dusk doesn't auto-open the role picker** any more; you fight as yourself unless you change role.
8. **Weapons only, no armor.** Tiers reuse the same meshes with a tint. A wooden sword is added to the starting inventory.
9. **Night collapse rule:** built blocks directly above a destroyed built block fall. Walls get weaker, and wall HP is tuned to compensate.
10. **Hill-side walls in the default world are raised** to 2 above the outside ground, instead of digging a ditch.
11. **Gates stay open to defenders and the builder.** Attackers are held back per unit, rather than making gates solid and opening them for defenders.
12. **Attacker jumps are capped at ~1.2 blocks**, including when you play as an attacker.
13. **Mode `build` is renamed `self`.**
