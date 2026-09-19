# Next 6: implementation summary and what's next

Implements `ai/plan_6.md` (answering `ai/prompt_6.md`, with its answer to the stop rule: play on
through lost nights, cap the video at 1 hour). Nothing is committed.

## What was built

**A bot that plays the game** (`tools/autoplay/`, `npm run autoplay`)

- **It plays fairly.** It runs inside the page and acts only through input:
  - key and mouse events on the same targets the browser uses, so they go through the game's own bindings
  - mouse movement for looking, with a capped, eased turn speed
  - clicks on HUD buttons (recipes, hotbar, role picker, cards)
- **It can't change the game.** It sees the game through a read-only view (`bot/readonly.js`):
  any write throws, and only an allowlist of read methods can be called. The recorded game logged
  **0 blocked writes**.
- **The harness** (`run.mjs`) does what the page can't do by itself:
  - the trusted clicks (Play, taking pointer lock back after a panel)
  - recording, logging, and stopping at the cap
- **It plays the production build,** served like a static host (`tools/serve-dist.mjs`, now
  shared with `tools/perf`).
- **Skills** (`bot/skills.js`, `bot/nav.js`):
  - **Walking:** A* over standing cells, allowed to dig through natural blocks (never built ones),
    so it digs a staircase to reach underground stone. The search is spread over frames (≤ 4 ms a
    frame) with a block cache. It steers toward the farthest waypoint it can reach in a straight
    line, brakes only where it has to stop, and recovers when stuck.
  - **Aiming and digging:** turns until the game's own targeted block is the one it wants; digs
    what's in the way first.
  - **Placing,** including at the top of a jump for the tower on its 2-high column. If it's standing
    in the cell it backs off, and if a troop is in the way it waits for it.
  - **Crafting and the hotbar,** through the Build panel.
- **Strategy** (`bot/play.js`, `bot/town.js`). The town's layout is worked out from the world, not
  hard-coded.
  - **Day:**
    - weapons first: stone sword, then a bow, iron sword and musket
    - arrow towers on 2-high columns inside the wall: an outer ring, then an inner one, keeping the gate lanes clear
    - archers with gold
    - a one-block step up to the wall top beside each gate
    - gathering for the next build: trees; a quarry outside the wall that tunnels sideways once stone shows; iron ore
    - then it walks home and starts the night itself (N)
  - **Night:**
    - attackers inside the wall or at a gate: the sword
    - otherwise: the bow (later the musket) from the wall top by the biggest group
    - it never leaves the town
  - **Dusk:** a few seconds' look from above. **Dawn:** watches the rebuild.
- **Idle baseline** (`--strategy=idle`): builds nothing, starts each night at once, watches from
  above.
- **Lab** (`--lab=…`, `lab.mjs`, never recorded): development shortcuts for testing skills and
  nights in minutes. `skills:all` runs 15 pass/fail skill tests.

**Recording** (`bot/capture.js`, `video.mjs`)

- **Tab capture in the page** (`getDisplayMedia` with Chrome's auto-accept flag): the 3D view and
  the HUD together, 1280×720, 30 fps, VP9 at ~4 Mbps. Each 1 s chunk goes straight to disk.
- **Sound:** headless Chrome has no audio output, so tab capture only recorded silence. The recorder
  makes its own audio track and taps the game's master sound output into it (listening only).
- **After the run:**
  - the gap check (frame timestamps)
  - `game.mp4` (H.264, constant 30 fps, a chapter for each phase)
  - `game-8x.mp4` for a quick watch
  - contact sheets (a frame every 30 s)
  - `report.md`: nights, kills by source, how days were spent, performance, errors

**Game bugs found and fixed**

| | Bug | How it showed | Fix |
|---|---|---|---|
| B1 | The pause menu threw on opening: `/** @type … */ (el)` at the start of a line was read as a call on the line before (`hud.js`) | P, Esc or losing pointer lock showed the menu but didn't pause the game, and clicks still reached it | cast moved into its own statement; `tests/source.test.js` fails on this pattern anywhere in `src/` |
| B2 | The role picker stayed open after the builder got up, with a disabled "Fight as yourself (knocked out)" button (`session.respawnPlayer`) | with the panel open the game ignores clicks: the builder stood still until the player closed it | closes when the game takes you back to the builder, refreshes if you're still choosing |
| B3 | Melee hit through walls: the builder's sword (3.7 blocks) and units' melee (grunt 1.8) had no line-of-sight check | the builder could kill attackers wrecking the wall from the other side | `meleeClear`: nothing solid between the two chests (open gateways still work); unit tested |
| B4 | After B3: an attacker in reach of a target behind a wall stood still. Standing still never counted as stuck | nights stalled until the 25 s stuck respawn, again and again | the attacker drops that target for 4 s and goes back to the wall |
| B5 | Wreckers that had broken through a wall kept choosing the next wall block along the ring (the siege field weights walls 40 blocks closer than the town) instead of going in | a night's last grunts spent 2+ minutes eating the west wall block by block (idle game) | a wrecker that breaks through goes for the town (it still widens its own breach); the opening raid is unchanged |
| B6 | The knocked-out builder's body sank through the ground and the world, and it got up **inside** the ground under the plaza | rehearsal hour, night 17: the bot was trapped for the rest of the night | safety net in `_keepInBounds`: a unit with feet and head in solid blocks is lifted to the first place it fits (`unstuckY`, unit tested); a body below y −40 is stopped. I couldn't reproduce the trigger (see Known issues) |
| B7 | **Memory leak: every unit left its skeleton and its bone-matrix texture (GPU) behind** when removed (`CharacterInstance.dispose` freed the nodes and named clips only) | the heap's floor grew ~2 MB a minute (52 → 170 MB over the recorded hour), in the idle game too; 100 units spawned and removed left 100 skeletons and 100 textures | the instance keeps its skeletons and all its animation groups and disposes them. After: 100 spawned and removed leave nothing, heap flat (browser probe + a 20-minute `--diag` run, below) |

## How it was verified

- **`npm run check`**: type check clean, **143 tests pass** (130 before). B7 is checked in the browser, not by a unit test:
  - source check: 2
  - melee through walls: 3
  - stuck in terrain: 2
  - the bot's read-only view and path finding: 6
- **`npm run build`**: budget passes. Game code **336.0 KB** brotli (335.4 KB in next_5; the fixes
  add 0.6 KB), 361.7 KB to the first playable frame. The bot isn't part of the game bundle.
- **Skill tests** (`--lab=skills:all`): 15/15, repeatedly:

  | Skill | Result |
  |---|---|
  | Looking | 0.5–0.7 s per turn |
  | Walking | 5 targets, including one through a gate |
  | Wood | 9–10 logs from two trees in ~31 s |
  | Stone | 12 cobble in ~33 s (was 65 s before tunnelling sideways) |
  | Crafting and the hotbar | passed |
  | A tower on its column | ~18 s from the quarry |

- **Full games:**

  | Run | Build | Length | Nights |
  |---|---|---|---|
  | **Recorded game** (`recordings/final/`) | B1–B6 | 60 min | **18/18 won**, Town Center 100% every night; night 19 was being fought at the cap. 816 kills: towers 51%, bot 27%, troops 18% |
  | Rehearsal hour (`recordings/rehearsal-1h/`) | B1–B3 | 60 min | 18/18 won, Town Center never below 99% |
  | Idle baseline (`recordings/idle-final/`) | B1–B5 | 35 min | 1–9 won; 10 and 11 lost once each, won on the retry |
  | Earlier bot games | older bot | 25 + 20 min | 6/6 and 2/2 won |

- **The recorded video:**
  - **59:53, one file, no cuts:** 107,792 frames, the largest gap between frames 0.077 s, none over 0.25 s
  - the game's sound, and 79 chapters (menu, raid, each day, dusk, night and dawn)
  - `game.mp4` is 1.2 GB, `game-8x.mp4` 152 MB
  - the bot's view: first person, with a look from above at each dusk
- **Performance during the recorded game:** 59.9 fps on average, 1% low 57.4, lowest second 55.2, and 3 frames over 50 ms in the hour (quality tier high, up to 40 units and 30 attackers alive at once).
  - The capture itself costs no measurable frame rate: the rehearsal hour averaged 59.8 fps
    recording, and unrecorded runs 59.9–60.0 fps.
  - The bot's own work is ~8 ms a second on average.
  - Path searches used to stall frames for up to 499 ms. Now they're sliced, and the only bot-side
    frame over 50 ms is the tree scan when a game starts.
- **Memory (B7):** the idle game with `--diag` (a forced garbage collection every 30 s):

  | | Before (old build, 5 min) | After (fixed build, 20 min) |
  |---|---|---|
  | Skeletons | 25 → 96, while units came and went | equal to the number of units, every sample |
  | Textures | 39 → 110 | units + 14 |
  | Retained heap | rising | 73–108 MB, going up and down with the fighting, no trend |

  A browser probe that spawns and removes 100 units now leaves nothing behind (it left 100
  skeletons and 100 textures before).
- **`npm run perf -- --headless`** (final build, Intel RPL-P iGPU, 10 Mbps): unchanged from next_5.

  | Profile | Menu interactive | First playable frame | Opening raid (60 s) | Night benchmark |
  |---|---|---|---|---|
  | desktop | 0.10 s | 0.96 s warm, 2.62 s cold shader cache (next_5: 0.90 / 2.49) | 60.0 fps, longest frame 67 ms, 1 over 50 ms | 60.0 fps, 72 units, high |
  | mobile (4× CPU) | 0.19 s | 1.48 s (next_5: 1.46–1.51) | 60.0 fps, longest frame 33 ms, 0 over 50 ms | 60.0 fps, 47 units, med |

## Where it differs from the plan

- **Stop rule** (prompt update): the game carries on through lost nights, and the video is capped at
  60:00. It's measured from the first frame and stops 1.5 s early for the last chunk.
- **No time cap on days beyond the plan's:** the bot starts the night itself once it has spent
  its budget (330 s on day 1, 250 s later) or has nothing left to build. From about day 4 every tower
  spot is taken, so it starts the night within seconds, and the hour holds ~18 nights instead
  of the 6–8 planned.
- **Night tactics grew a bow on the wall top** (steps beside each gate). Melee alone got the bot
  0–4 kills a night, since a sword can't reach attackers until they break in. With the bow it gets
  about a quarter of all kills.
- **Sound** needed the tap into the game's output (tab audio is silent in headless Chrome).
- **Recording twice more:** the first "final" hour became the rehearsal (it found B6), and a second
  start was dropped after 5 minutes when B6 was fixed. The delivered video has B1–B6.
  - **B7 was found from the video run's own telemetry and fixed afterwards.** It's memory only, and
    the frame rate held for the whole hour, so nothing in the video changes. I didn't record a third
    hour for it; say if you want one.
- **A `--diag` mode** (forced garbage collection every 30 s, retained heap and scene object counts)
  was added to find B7.
- **The assessment's lab comparisons** (melee vs ranged, tower placements) were done in lab runs
  and full games as the bot was built, rather than as a separate A/B table.
- **Added:** `--shots`, the 8× copy, contact sheets, and a unit-test file for the bot.

## Known issues / limits

- **B6's trigger isn't found.** The knocked-out builder's body sank into the ground about 2.5 s
  after it went down, outside the south gate, just after the wall there was breached. It looks like
  a block ended up in its body: the physics then stops colliding it with terrain. The safety net
  covers the symptom for every living unit (lift to where it fits) and stops a falling body; the
  cause is worth finding.
- **The bot sees through walls** (it reads positions from the game). Its actions are fair, its
  perception isn't entirely.
- **The bot plays one strategy, and doesn't spend late resources.**
  - It only spends gold on archers, which also need planks, and it stops gathering once the tower
    spots are full. It ended the hour with 92 gold and 83 iron unspent.
  - It never built swordsmen, gunners or cannons, never built spikes or extra walls, and never
    played as a unit.
  - It won every night anyway. For a harder game it should put rewards into troops and cannons.
- **Idle baseline results vary run to run** (the first idle game lost night 8, the final-code one
  first lost night 10): random fronts and wave make-up. One run per setup.
- **The bot's quarry leaves a pit** (up to 9×9 and 7 deep) north-east of the town, outside the
  wall and off the gate lines. I didn't check how attackers treat it, and it's there in the video.
- **Chapters in the MP4** are the phases, from the bot's own events. Some players show chapters
  in the seek bar, some don't.
- **Files:** a recorded hour is ~2.1 GB of WebM and ~1.2 GB of MP4 in `recordings/`
  (gitignored). The WebM can be deleted once the MP4 is checked.

## What to work on next (suggested order)

1. **Balance: make nights a threat,** per the assessment (`ai/assessment_6.md`, "How to improve
   it"). It's the thing that decides whether the game is engaging. Use the bot and the idle
   baseline to measure each change: with the bot, a good first target is losing a night
   somewhere around night 8–12.
2. **Give a lost night a cost.**
3. **Find B6's trigger** (a lab scenario: knock the builder out beside a breach and log its body).
4. **Night job for the player:** make the wall walk a designed place (the bot found it on its
   own).
5. **Day tedium:** craft ×N, drag-to-build walls, towers with a base, keep dirt off the hotbar.
6. **Carried over:**
   - real phone and older laptop test, then tune `TIERS`
   - first-person item poses (`ITEM_POSE`)
   - armour tier, hit sounds per weapon, a hand-built default world, multiplayer groundwork
