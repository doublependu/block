# Plan 0 — voxel tower-defence game on noa

Answers `ai/prompt_0.md` (and `ai/prompt_0_ext.md`). Nothing below is implemented yet.

---

## 0. What I found before planning

Facts that shape the plan (checked on 2026-09-16):

| Thing | Finding | Consequence |
|---|---|---|
| `noa-engine` | Latest npm `0.33.0` (May 2023). `develop` branch is 4 commits ahead (Jul 2023: two Chrome pointer-lock fixes, getter cleanups). No activity since. ~6.4k LOC, MIT. | Treat noa as **vendored, unmaintained code** we own and patch, not as an upstream dependency. |
| noa ↔ Babylon | peerDep `@babylonjs/core ^6.1.0`. Current Babylon is `9.26.x`. noa uses `MaterialPluginBase`, `RawTexture2DArray` (WebGL2 only), `Octree`, `StandardMaterial`. | Need a spike on whether noa runs on Babylon 9. If not, fall back to the last Babylon 6.x. WebGL2 is required, which is fine for devices from the last 3 years. |
| noa input | Keyboard/mouse + pointer lock only. Pointer lock gets turned off after any `touchmove`. `receivesInputs` reads one global boolean `noa.inputs.state` and applies it to every entity that has the component. | We have to build touch controls ourselves. Possession (playing as an NPC) = move `receivesInputs`/`movement` onto that entity and retarget `noa.camera.cameraTarget`'s `followsEntity`. |
| noa world API | `worldDataNeeded(id, ndarray, x,y,z, worldName)` → `world.setChunkData(id, arr, userData, fillVoxelID)` (can be async). Changing `noa.worldName` reloads every chunk. Blocks: `Uint16` IDs, `solid/opaque/fluid`, `blockMesh` object blocks, `onSet/onUnset/onLoad/onUnload` handlers. Meshing runs on the main thread. | Worldgen goes in a Web Worker. Switching worlds works without a page reload. Turret bases can be object blocks. Chunk size matters for how long a remesh stalls the frame. |
| noa-examples | `hello-world` = bare minimum. `test/` = the "testbed" (worldgen queue, chunk store with `voxel-crunch`, shadows, entities). Its worldgen uses `Math.random()`, which isn't deterministic. Its Babylon chunk is about 1.1 MB minified. | Start from `hello-world`'s structure and borrow the testbed's queue and registration patterns. Rewrite worldgen so it's deterministic. |
| Tooling | Node 24.20, npm 11.19. Blender 5.2.1 is running (`~/Downloads/blender-5.2.1-linux-x64/blender`) but isn't on `PATH`. The Blender MCP is available. Vite is at 8.3. | Characters: Python scripts in the repo, run through the MCP or headless with that binary. Blender 5.x uses the slotted-actions API, so check calls with `bpy_api_lookup`. |
| Repo | Only `README.md`, `CLAUDE.md`, `LICENSE`, `.gitignore`, `ai/`. `.gitignore` ignores `*.seed`, `dist`, and `ref/`. | **World exports must not use the `.seed` extension** (git would ignore them). `ref/` is where upstream clones can go for reference. |
| README | Setup is `npm create vite@latest . -- --template vanilla`. | Running that in this non-empty dir offers "remove existing files". **Scaffold in a temp dir and copy the files in** so `ai/` and `CLAUDE.md` can't be wiped. |

---

## 1. Goals and non-goals for this iteration

**Goals**
1. A static, single-player web game: voxel world + tower defence day/night loop, playable on desktop and touch devices.
2. Worlds: generate from a seed, load from a world list (a default world behind **Play**), export as `seed + edits` in a git-friendly file.
3. Roles at night: aerial spectator, possess a defender, or possess an attacker. On death, pick again.
4. Survival mode (mine, collect, build, place troops) and Creative mode (always day, unlimited blocks, pick the attack strength).
5. Placeholder character GLBs from Blender (rig + textures + named animation clips), loaded through a **character contract** so external GLBs can replace them later.
6. Seams for the future generic servers (identity/assets and realtime sync), with local fallbacks. **No servers get built.**
7. Meet the CLAUDE.md load and perf spec, and measure it.

**Non-goals (from the prompt)**: importing a world, saving into the world list from the app, building the servers, real multiplayer.

---

## 2. Key architecture decisions

### 2.1 Stack
- **Vite (vanilla template) + plain JS with JSDoc types**, checked by `tsc --checkJs --noEmit` (noa is written the same way). This follows the README's `--template vanilla`. Switching to TS later is cheap.
- **No UI framework.** The HUD and menus are vanilla DOM + CSS over the canvas, to keep the first load small.
- **Vendor noa** into `vendor/noa/` from the `develop` commit `8a74866` (keep the MIT license and record the commit in `vendor/noa/UPSTREAM.md`), aliased as `noa-engine` in `vite.config.js`. Reason: it's unmaintained, and we already know we must patch touch/pointer-lock handling, possession, and probably Babylon API drift.
- **Babylon**: spike on `@babylonjs/core@9` + `@babylonjs/loaders@9` first. If noa's terrain material plugin or octree breaks and the fix isn't small, pin `6.x` (latest 6 minor) for both. This is decided in M0, not now.
- **Noise**: `simplex-noise@4` seeded with our own PRNG (`alea`-style or `sfc32`, written inline). **Worldgen uses only `+ − × ÷ floor sqrt`**: `Math.sin/cos/exp/pow` can differ in the last bits between V8, SpiderMonkey and JavaScriptCore, which would make the same seed give different terrain in different browsers.
- **Audio**: a small Web Audio module of our own (positional `PannerNode`, pooled one-shots, music bus). No Howler: it's another dependency, and we only need a few features. It loads lazily after the first user gesture (autoplay policy requires one anyway).
- **Tests**: Vitest for pure logic (worldgen determinism, export round-trip, nav/flow field, waves, economy). Playwright scripts for load-time/FPS budgets and smoke screenshots.

### 2.2 One source of truth for world state: `seed + edits`
One idea serves save, export, and future multiplayer:

```
terrain(x,y,z) = generator[version](seed)(x,y,z)
world(x,y,z)   = nightDamage(x,y,z) ?? edits(x,y,z) ?? terrain(x,y,z)
```

- **EditStore** (main thread): `Map<chunkKey, Map<voxelIndex, blockName|air>>`, plus units (placed troops/turrets). It's authoritative and survives chunk unloads.
- A **chunk request** goes to the worker, which returns base terrain. The main thread overlays edits and damage, then calls `setChunkData`.
- **Every** permanent mutation is an `Op` (`setBlock`, `placeUnit`, `removeUnit`, `setTownCenter`, …). Ops go through `SyncService.submit(op)`, and state changes only when the op comes back via `onOp`. In single-player the local adapter echoes it back straight away. In multiplayer the generic server orders and rebroadcasts ops without understanding them. **So the game code path is the same in both modes.**
- **Night damage is not an edit.** Blocks destroyed at night go into a separate `nightDamage` overlay that gets reverted at dawn ("the town recovers automatically"). Exports and the op log stay clean.
- **Generator versioning**: every world stores `generator.version`. Old generators stay in the code (`src/world/gen/v1.js` …), and a golden-hash test per version fails if terrain drifts. Without this, a worldgen tweak would silently corrupt every committed world.
- **Block names, not IDs, in files.** Exports store a block-name palette, so reordering the registry can't break committed worlds.

### 2.3 World file format (committed to git)
File: `worlds/<slug>.world.json`. **Do not use `.seed`**, which is gitignored.

```jsonc
{
  "format": "block-world", "formatVersion": 1,
  "name": "Default Valley", "description": "…",
  "seed": "default-valley",
  "generator": { "id": "terrain", "version": 1 },
  "size": [256, 256],              // see 2.4
  "mode": "survival",              // survival | creative
  "day": 1,
  "townCenter": [0, 14, 0],
  "palette": ["air", "stone", "planks", "stone_wall", "arrow_tower"],
  "edits": [
    [12, 15, -3, 2],               // x, y, z, paletteIndex, one per line
    [12, 16, -3, 0]
  ],
  "units": [ { "type": "archer", "pos": [4, 15, 6], "yaw": 90 } ],
  "player": { "pos": [0, 16, 4], "inventory": { "stone": 40 } }
}
```

- `edits` holds the **compacted final diff against the generated terrain**, not the raw history. It gives the same world state, it's much smaller, and it's sorted (chunk, y, z, x) with one entry per line so git diffs stay small. (If you actually want the full ordered history, that's a flag on the exporter. See §9.)
- Export = a browser download (`<slug>.world.json`). You commit it under `worlds/`.
- **World list**: a small Vite plugin builds a manifest at build time (name, description, seed, mode, day, file URL) from `worlds/*.world.json`. It emits the world files as hashed assets that are fetched only when selected. `worlds/default.world.json` is the one **Play** loads.
- The default world is a hand-picked seed with the town center on a flat area near spawn and a few starter structures, made by playing and exporting once.

### 2.4 Bounded play area (recommended)
Terrain generation works for any coordinates, but **the world is a finite square (default 256×256, y −32…96) with a visible border**. Reasons: pathfinding and flow fields stay bounded, exports stay bounded, mobile memory stays predictable, and attackers have well-defined spawn edges. The size is a per-world field, so it can grow later.

### 2.5 Future servers: generic interfaces, local adapters now
`src/net/` defines interfaces the game uses today with local implementations. Servers only ever see opaque payloads plus `gameId`/`roomId`:

- **IdentityService**: `getSession()`, `login()`, `getProfile() → { id, displayName, avatar: { glbUrl } | null }`, `listAvatars()`. `LocalIdentity` = guest, with avatars from the bundled GLBs.
- **SyncService**: `join(roomId, { snapshot })`, `submit(op)`, `onOp(cb)` (ordered, reliable), `sendPresence(blob)` / `onPresence(cb)` (throttled, unreliable), `members()` (join order is used for host election: the earliest member runs the NPC sim). `LocalSync` = loopback.
- **Discovery**: an optional `config.json` with server URLs. It's probed **in the background after first render** with a short timeout. If unreachable, the game stays single-player. It never delays startup.
- Protocol and avatar contract documented in `docs/protocol.md` and `docs/character-contract.md`, so the generic servers can be built against them without knowing this game.

### 2.6 Character GLB contract (`docs/character-contract.md`)
Players can play any NPC, and later a server will supply arbitrary GLBs, so all characters follow one contract:
- 1 unit = 1 block, origin at feet, facing −Z (glTF forward), height ≈ 1.6–2.4.
- **Shared humanoid skeleton bone names**: `root, hips, spine, chest, neck, head, upper_arm.L/R, lower_arm.L/R, hand.L/R, upper_leg.L/R, lower_leg.L/R, foot.L/R`, plus an empty socket `hand.R_socket` for held items. Clips key **rotations only**, except `root`/`hips` translation. That way clips work across different body proportions (e.g. a brute).
- **Clip names** (snake_case; the loader also matches case-insensitive aliases like `"mine block"`, `"Mine"`):
  `idle, walk, run, jump, fall, mine, place, attack, shoot, hit, die, hold_item, hold_bow, hold_sword, hold_gun, cheer`.
- **Layering without Babylon masks**: `hold_*` clips animate only arm/hand bones, so they play on top of locomotion clips (which don't key arms while a hold is active). This works on Babylon 6 and 9.
- **Fallback chain** when a clip is missing: `run→walk→idle`, `mine/place/attack/shoot→attack→idle`, `die→` a procedural tip-over, `hold_*→` none. Only `idle` is required.
- Budgets: ≤ 3k tris, 1 texture ≤ 256² (placeholder: 64², nearest filtering), ≤ 150 KB per GLB, ≤ 4 bone influences (placeholders use 1: rigid blocky parts, cheapest skinning).
- A validator script (`tools/validate-glb.mjs`, uses `gltf-validator`) checks bones, clips, sizes and tris.

---

## 3. Game design (v1)

### 3.1 Loop
- **Day** (default 8 min, configurable; has a **"Ready — start night"** button): mine, collect, build structures, place troops. Setting **Peaceful** or **Skirmish** (small 1–3 attacker scout groups now and then).
- **Dusk** (10 s warning, horn, sky shifts): the player picks a role.
- **Night**: waves spawn at the border edges and push toward the **Town Center** (a special multi-block structure with HP). The night ends when all attackers are dead (survived), or the Town Center reaches 0 HP (lost), or a hard time limit runs out (counts as survived).
- **Dawn**: restore `nightDamage` progressively (a few hundred blocks/s with a rebuild effect), revive defenders, repair turrets, remove leftover attackers. Day counter +1.
- During the night the player **can't** make permanent edits. Roles are combat-only, so the op log only holds deliberate day building.

### 3.2 Roles and camera
- **Builder** (day): first/third-person noa player with a hotbar, mining and placement.
- **Aerial** (spectator): detach `cameraTarget` from the player and use an RTS-style orbit/pan/zoom (WASD/drag, wheel/pinch). Tap a unit to possess it. Also usable by day for placing troops and turrets, which is much easier on touch.
- **Defender/Attacker** (possession): pause that NPC's AI brain, move input components onto it, and have the camera follow it. It uses that character's GLB and ability set (melee/ranged).
- **On death**: a role picker overlay (Aerial / any living defender / any living attacker).

### 3.3 Content (placeholder set)
- **Resources/blocks**: grass, dirt, stone, sand, snow, wood log, leaves, iron ore, water (non-solid fluid), plus buildables: planks, cobblestone wall, iron-reinforced wall, gate (defenders pass, attackers don't), spikes, torch (emissive, no dynamic lights).
- **Structures** (object blocks + entity head): arrow tower, cannon tower.
- **Defender troops**: swordsman, archer, gunner.
- **Attackers**: grunt (melee), raider archer (ranged), brute (slow, high HP, breaks walls fast), sapper (digs through natural terrain).
- **Costs**: direct resource costs in a build menu, no crafting table in v1.
- **Survival economy**: mining gives the block/resource. Placing costs it. **Creative**: everything is free and instant-break, it's always day, and a **"Start night"** panel has a strength slider (maps to night number / wave budget).

### 3.4 Difficulty scaling
`waveBudget(n) = base · 1.18ⁿ`, blended with a small adaptive term `k · defenceValue` (the total cost of placed structures and troops), so "stronger each night" follows what the player actually built. The budget is spent on attacker types unlocked by night number (brutes from night 3, sappers from night 5, …), and it's split into 2–4 timed sub-waves. Creative sets `n` directly. All constants live in one `balance.js`.

### 3.5 AI and combat
- **NavGrid** over the play area: a cell is walkable if it's air with a solid block below and 2 air cells of headroom. Edges allow a 1-block step-up (noa `autoStep`) and drops of up to 3.
- **Attackers use a single flow field** (Dijkstra from the Town Center, bucket queue) computed **in a worker**, so hundreds of attackers cost one field, not hundreds of A* searches. Player-built blocks are *passable at a cost* (hardness ÷ typical attacker DPS), so attackers attack walls when going around is longer. The field is updated incrementally when blocks change (dirty region, then recompute). Sappers use their own field where natural blocks are also passable at a cost.
- **Defenders**: guard post + leash radius, target the nearest attacker in range, short local A* back to post.
- **Combat**: data-driven stats (hp, dmg, range, cooldown, speed). Projectiles are pooled thin instances and hit-test with a segment vs entity AABB plus `fast-voxel-raycast` for cover. Block HP is by hardness, with a crack overlay for damage.
- The sim runs on noa's fixed `tick` (30 Hz). Separate AI budgets: brains think at 5–10 Hz, staggered across ticks.

---

## 4. Rendering, load and performance strategy

### 4.1 Load (spec: 2–3 s, 1 s great, 4 s max)
- **Two-stage boot.** `index.html` inlines critical CSS plus a tiny menu script (≤ 30 KB brotli), so the menu is interactive in < 1 s. The engine chunk (Babylon + noa + game) is `modulepreload`ed straight away. The worldgen worker starts generating the default world's spawn chunks **while the menu is showing**, so **Play** is near-instant.
- **Budgets** (brotli, enforced by `tools/check-budget.mjs` in `npm run build`):

  | Asset | Budget |
  |---|---|
  | HTML + menu JS/CSS | ≤ 30 KB |
  | Engine + game chunk | ≤ 550 KB (target 450) |
  | Worldgen worker | ≤ 25 KB |
  | Block atlas (PNG/WebP, 16² tiles) | ≤ 60 KB |
  | Default world file | ≤ 50 KB |
  | Player GLB | ≤ 150 KB |
  | NPC GLBs, audio | **lazy**: after first frame / at dusk, not part of initial load |

- Tree-shake Babylon: deep imports only (`@babylonjs/core/...`), plus only the needed glTF loader extensions. No inspector in prod.
- The player first renders as a simple box/capsule and swaps to the GLB when it arrives. No blocking spinner.
- **Measure**: a Playwright script with a throttled network profile (e.g. 10 Mbps / 40 ms RTT, deliberately slower than typical current broadband and mobile medians) and 4× CPU throttling as the entry-level-phone stand-in. It records *menu interactive* and *first playable frame after Play from a cold load*. Targets: ≤ 1 s and ≤ 2.5 s. Hard fail above 4 s.

### 4.2 Runtime (integrated GPU PCs, entry-level phones)
- **Quality tiers** (`low/med/high`), picked at start from touch, `hardwareConcurrency`, `deviceMemory`, and the unmasked GPU renderer string. Then an **FPS governor** steps down if the average stays under ~45 fps for 5 s. Tiers control: `chunkAddDistance`, render scale (`hardwareScalingLevel`, DPR cap 1.5 on mobile), AO on/off, shadows (blob shadows only on low), max fully-animated NPCs, NPC LOD distance, particle count.
- **Chunks**: start at noa's default size 24 (a smaller remesh stall when mining/night damage hits a chunk). Confirm in M0 by timing remeshes on the throttled profile. Remeshes from night damage are batched per chunk per frame.
- **Crowds**: characters are instantiated from shared containers (`instantiateModelsToScene`) with shared materials. Near NPCs get full skeletal animation, capped per tier (e.g. 12/24/48). Far NPCs use **baked vertex animation + thin instances** (`VertexAnimationBaker` + `BakedVertexAnimationManager`, available on 6 and 9). Wave sizes are also capped per tier, with extra budget turned into tougher units instead of more units.
- **Lighting**: one directional light (noa's) + ambient + clear/fog colour lerped over the day cycle. Night is a readable moonlit blue, not pitch black. Torches are emissive blocks, not point lights.

---

## 5. Placeholder characters (Blender)

- `tools/blender/make_characters.py` is a **reproducible** script (run through the Blender MCP `execute_blender_code`, or headless: `blender -b -P tools/blender/make_characters.py`). It builds:
  1. One shared humanoid armature following the contract. Blocky box body parts, each 100% weighted to one bone.
  2. A procedurally painted 64² pixel texture per character (face, clothing colours, role markings). Nearest-filter friendly.
  3. Actions for every clip in §2.6 (keyframed rotations, looping clips seamless). Exported with `export_animation_mode='ACTIONS'` so each action becomes a named glTF animation.
- Output to `public/models/`:
  - `player.glb`: all clips.
  - `defender_swordsman.glb`, `defender_archer.glb`, `defender_gunner.glb`: locomotion, attack/shoot, their `hold_*`, hit, die.
  - `attacker_grunt.glb`, `attacker_archer.glb`, `attacker_brute.glb` (wider proportions, same bones), `attacker_sapper.glb`: locomotion, attack/mine, hit, die.
  - `items.glb`: pickaxe, sword, bow, gun, generic block. Attached to `hand.R_socket` at runtime.
- Since every character can be possessed, every character gets `idle/walk/run/jump/fall/attack/hit/die` at least. The fallback chain covers the rest.
- The Blender 5.x slotted-action API (`action.layers/strips/channelbags`) differs from older tutorials, so check calls with `bpy_api_lookup`. Screenshot each model in Blender, then again in-game, to confirm orientation, scale and clips.
- `tools/validate-glb.mjs` runs on all GLBs as part of `npm run check`.

---

## 6. Proposed layout

```
index.html                 menu shell (inline critical CSS)
vite.config.js             noa alias, worlds manifest plugin, babylon chunking
vendor/noa/                vendored engine + UPSTREAM.md + our patches noted
worlds/                    committed *.world.json (default.world.json = Play)
public/models/ textures/ audio/
src/
  boot/        menu, preload, quality tier detection, service probing
  engine/      noa setup, rendering/sky/day-night lighting, camera modes, governor
  world/       block registry+atlas, gen/ (versioned, worker), EditStore, NightDamage, export, world list
  game/        modes (survival/creative), day/night state machine, economy/inventory, balance.js, waves
  ai/          navgrid, flow field (worker), brains (attacker/defender), targeting
  units/       unit defs, spawning, combat, projectiles, town center, turrets
  characters/  GLB loading, contract/aliases, animation controller, item sockets, VAT crowds
  input/       desktop bindings, touch controls (joystick/look/buttons), possession
  ui/          HUD, hotbar, build menu, role picker, night results, creative night panel
  audio/       Web Audio engine, sound registry
  net/         IdentityService/SyncService interfaces, LocalIdentity, LocalSync, op types
tools/         blender/, validate-glb.mjs, check-budget.mjs, perf/load Playwright scripts
docs/          world-format.md, character-contract.md, protocol.md
tests/         vitest specs (+ golden terrain hashes)
```

---

## 7. Milestones (each ends playable and verified)

**M0 — Scaffold and spikes** (decides the risky unknowns)
1. Scaffold Vite vanilla in a temp dir, copy in, add scripts: `dev`, `build`, `preview`, `test`, `check` (types, GLB validation, budgets).
2. Vendor noa `develop@8a74866`. Get hello-world running on **Babylon 9**. If blocked, pin Babylon 6 and write down why.
3. Measure the baseline: bundle size (brotli), cold-load timing under throttling, FPS at chunk distance 2/3 on the throttled profile, remesh time for size 16/24/32.
4. Touch spike: joystick + drag-look driving `noa.inputs.state` and camera heading/pitch on a real phone or emulator.
- *Exit*: Babylon version picked, chunk size picked, budgets confirmed as realistic or revised in `next_0.md`.

**M1 — World and building**
Block registry + atlas, versioned deterministic worldgen in a worker (height, 3D-noise caves, biomes by height/humidity, trees, ores), EditStore overlay, mining/placing through ops + LocalSync, inventory + hotbar, desktop + touch controls, main menu (Play / New from seed [mode, skirmish] / World list), world manifest plugin, export download, first `default.world.json`, IndexedDB autosave with a **Continue** button.
- *Verify*: golden-hash determinism tests; export → load round-trip gives the same voxels; load budgets pass.

**M2 — Characters**
Blender script + 8 GLBs + items. Loader with contract/aliases/fallbacks, animation controller (locomotion from velocity, action one-shots, hold layers), player uses `player.glb` in third person, validator.
- *Verify*: Blender screenshots and in-game screenshots for each character, all clips cycle correctly, GLB validator passes.

**M3 — Tower defence core**
Town Center, day/night state machine + lighting/sky, build menu (walls, gate, spikes, towers), troop placement, navgrid + flow field worker, attacker/defender brains, combat/projectiles, block HP + night damage overlay, dawn recovery, wave budget scaling, night results screen.
- *Verify*: unit tests for flow field / waves / dawn restore; a scripted benchmark night (`?bench=night`) keeps ≥ 30 fps on the low tier with the tier's max wave under 4× CPU throttle.

**M4 — Roles and modes**
Aerial camera (+ aerial placement by day), possession of defenders/attackers (incl. touch), death → role picker, Creative mode (always day, free building, night strength slider), Skirmish daytime scouts.

**M5 — Audio, polish, perf hardening**
Web Audio engine with positional SFX (steps by block type, break/place, combat, horn, ambient/music), VAT crowd LOD, FPS governor tuning, final load/FPS verification runs, docs.

**M6 — Net seams finalised** (small, since interfaces exist from M1)
`config.json` probing with offline fallback, avatar-from-URL path through `IdentityService`, `docs/protocol.md` + `docs/character-contract.md` written for server authors.

After each milestone: write `ai/next_0.md` (summary + what's next), per CLAUDE.md. No commits or pushes from me.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| noa doesn't run on Babylon 9 | M0 spike; fall back to Babylon 6.x; vendored source lets us patch. |
| Main-thread meshing hitches on phones during night damage | Smaller chunks, batched remesh per frame, cap blocks destroyed per tick, lower tier chunk distance. |
| Skinned NPC hordes too slow on iGPU/phones | Tier caps + VAT thin-instance LOD; wave budget turns into tougher units, not more units. |
| Worldgen differs across browsers/versions | Arithmetic-only noise path, versioned generators, golden-hash tests. |
| Engine chunk misses the 2–3 s budget on low-end CPUs | Menu shell interactive first, preload + speculative spawn-chunk generation, strict tree-shaking, budget check in build. |
| Touch UX for a first-person builder is clumsy | Aerial placement mode by day; big tap targets; hold-to-mine. |
| Blender 5.x API changes break the script | `bpy_api_lookup` before writing; script is idempotent and re-runnable. |

---

## 9. Choices I made that you may want to override

1. **Plain JS + JSDoc** (following your README's `--template vanilla`) instead of TypeScript.
2. **Vendoring noa** instead of depending on npm `noa-engine@0.33.0`.
3. **Exports store the compacted final diff**, not the raw ordered history of every mine/place action. It's smaller, gives cleaner git diffs, and the world state is the same. Full history could be an exporter option.
4. **Finite 256×256 play area** with a border, instead of an infinite world.
5. **Night damage is temporary** and never exported. Player building is disabled at night (roles are combat-only).
6. **Losing a night** (Town Center destroyed) has no permanent penalty: dawn restores everything, and the next night's budget doesn't grow. The alternative is losing a share of stored resources.
7. **IndexedDB autosave + Continue** is included. It isn't "save to world list", but it stops a page refresh from losing progress.
8. Defaults: 8-min day with a "start night" button; noa chunk size 24 pending the M0 measurement.
