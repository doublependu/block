# Next 1 — implementation summary and what's next

Implements `ai/plan_1.md` (answering `ai/prompt_1.md`), with your change: **the opening raid is always lost**. Nothing is committed.

## What was built

**The missing night attackers (prompt item 3)**
- **Root cause fixed in vendored noa.** Babylon clones share their source mesh's `metadata` object, and noa kept its "added to scene" flags there. So only the first character per GLB was ever drawn: 2 of 9 attackers in the night I measured, and 2 of the 4 default defenders.
  - noa now keeps that bookkeeping in `WeakSet`/`WeakMap` (`sceneOctreeManager.js`, `rendering.js`, row added to `vendor/noa/UPSTREAM.md`).
  - `tests/render.test.js` (Babylon `NullEngine`) clones a model 3 times and checks every clone is in the render list. It fails without the patch.
- **Attack fronts** (`src/game/waves.js`):
  - Each sub-wave comes from one compass direction, or two from night 6 on. Consecutive fronts are at least 60° apart.
  - Attackers spawn in a ±20° arc on a ring 45–60 blocks from the Town Center. The old spawn was 73–102 blocks out, at random edges. Water spots step inward along the ray.
  - `compassName`, `pickFronts` and `spawnPoint` are pure and unit-tested.
- **Seeing it**:
  - A non-modal HUD **banner** ("8 attackers approaching from the west!").
  - **Edge-of-screen arrows** with a count for attacker groups that are off screen. They stay clear of the top bar, banner and hotbar.
  - A **camera glide** in aerial view that frames the front and the town. It's skipped if you moved the camera in the last 5 s.
- The **role picker** is now a side panel, so the battle stays visible.
- **In aerial view the fog is pushed out by the zoom distance.** On low/med tiers the town you were framing used to sit inside the fog.
- **Balance** (`balance.js`): arrow tower range 18 → 16, sub-wave interval 25 → 40 s.

**Opening raid (prompt item 1)** — `src/game/opening.js`, `DayCycle.startOpening`, `WaveDirector.startOpening`
- **When it plays:** fresh survival games at day 1 / night 1. It doesn't play on Continue, in creative mode, on later-day worlds, or with `?intro=0`.
- **Start:** it begins 0.7 s after the first playable frame. The camera is in aerial view at late dusk, framing the attack side, which is one of the 4 gate directions. A horn plays and a banner shows "Raiders are attacking your Town Center — defend it!" with **Skip**, plus a hint to tap a defender to fight as it.
- **Raid:** 2 brutes + 8 grunts at 1.5× HP from 36–42 blocks out.
- **Always lost:** when fewer than 4 raiders are left, or every 20 s, reinforcements arrive (3 grunts and a brute, plus one more brute each round). There's no night time limit, so it ends when the Town Center falls.
- **End:** a result panel ("The raiders destroyed your Town Center… Use the day to mine, craft walls, towers and troops (B)…") → the dawn rebuild → a Day 1 banner. It counts as neither a day nor a night level.
- **Load:** the grunt and brute GLBs start loading at the first playable frame, not before.

**Walking NPCs (prompt item 2)** — `src/ai/localPath.js`, `units.js`
- `localPath.js`: a breadth-first search over standing cells in a small window around the unit. It follows the flow field's movement rules (step up 1, drop 3, no corner cutting); gates are open to defenders, and water and spikes are avoided. It only reads loaded chunks and caches standable levels per column. Six unit tests.
- **Day:** defenders wander within 5 blocks of their post at 45% speed, pausing 2–6 s. A quarter of walks visit a nearby gate, tower or the Town Center.
- **Dusk:** they walk back to their post.
- **Night:** they patrol within 3 blocks at 60% speed and fight as before.
- Walking back after a chase now follows a path instead of a straight line.
- Wandering isn't an op (see `docs/protocol.md`).

**Small fixes found along the way**
- Living defenders are healed at dawn.
- The builder stays visible in aerial view by day.
- First person no longer starts staring at the ground after aerial view or possession (pitch reset).
- A quick tap inside the touch joystick zone (lower-left 40% of the screen) now counts as a tap. Before, units there couldn't be tapped.
- On phones the top HUD chips stacked into 3 rows (`left: 50%` shrink-to-fit). Fixed with `width: max-content`.
- Perf script: `--quality=` option, skips the opening, and fills the night benchmark to the tier's attacker cap around the town (tough units, town can't fall).

## How it was verified

- **`npm run check`**: type check clean, **36 tests pass** (23 before, plus render clones, local paths, fronts/spawn ring, opening rules and cycle), all GLBs valid.
- **`npm run build`**: budget passes. Game code 312.6 KB brotli (was 308.6), total to first playable frame 329.7 KB.
- **Performance** (production build, Chrome, HTTP/2 + brotli, 10 Mbps, Intel RPL-P iGPU), **now with every character actually drawn**:

  | Profile | Menu interactive | First playable frame | Night benchmark |
  |---|---|---|---|
  | desktop | 0.11 s | 0.73–0.78 s warm, 2.47 s cold GPU cache | 57.6 fps avg (54.2 min), 69 attackers, tier high |
  | mobile (4× CPU, touch, 412 px) | 0.19 s | 1.48 s | 57.4 fps avg (55.7 min), 44 attackers, tier med |
  | mobile, `--quality=low` | 0.20 s | 1.88 s | 58.1 fps avg (58.0 min), 28 attackers, tier low |

  This Chrome caps at ~60 fps, so these show there's no slowdown, not how much headroom is left.

- **Night balance** (scripted, default world, med tier, no player input, 5 runs each; final settings):

  | Night | Survived | Town Center hit | Lowest Town Center HP | Night length | Attackers |
  |---|---|---|---|---|---|
  | 1 | 5/5 | 5/5 | 83–99% | 64–76 s | 17 |
  | 3 | 5/5 | 3/5 | 17–98% | 57–95 s | 9–15 |

  Tuning history:
  - Range 18 / interval 25: night 1 lasted 48–60 s and night 3 barely touched the town.
  - Range 14: night 1 was lost in 3 of 4 runs.

- **Opening raid**, 3 fresh runs: lost 3/3 in 38–61 s, Town Center first hit at 18–20 s, 1–2 reinforcement rounds. Screenshots show the raiders approaching in frame, the result panel, and the Day 1 banner.
- **Wandering**, 4 default defenders:
  - Day, 30 s: each walked 22–28 blocks over 4–5 walks, stayed within 5–8 blocks of its post, and was never stuck more than 0.1 s.
  - Dusk: all were back within 0.2 blocks of their posts.
  - Night: they patrolled within 3.5 blocks.
- **Touch** (412×915 emulation, low tier): banner and Skip work by tap, tapping a defender during the raid possesses it, a quick tap in the joystick zone registers, and the top bar fits on one row.
- **Desktop night**: banner, camera glide, and an edge arrow with the group count when looking away.

## Where it differs from the plan

- **Opening raid is always lost** (your change): reinforcements replace the 35% Town Center HP floor.
- **Opening composition**: 2 brutes + 8 grunts at 1.5× HP from 36–42 blocks, instead of 6 grunts + 1 brute from 30–36. The first version was over in ~30 s.
- **Night length is ~60–95 s, not ≥ 90 s.** Getting there means longer lulls between waves, which felt like dead time. `SUBWAVE_INTERVAL` is the knob if you want longer nights.
- **The role picker is always a side panel**, not only at dusk.
- **Added beyond the plan:** aerial fog offset, the joystick-zone tap fix, and the phone top-bar fix. All were found while testing the opening raid on a phone-sized screen.

## Known issues / limits

- **Attackers rarely break walls on the default world.** In the balance runs only 0–2 blocks were destroyed per night. Where the hills outside are higher than the 2-block wall, the flow field walks them over it. The walls look like defences but mostly aren't. A taller wall on the hill sides, or a moat, would fix it in `defaultWorld.js`.
- Still **not tested on a real phone**. Mobile numbers are CPU-throttled emulation; the GPU isn't throttled.
- An attacker group that is on screen but hidden behind a hill gets no arrow (arrows are only for off-screen groups).
- When the aerial camera looks from behind a hill, noa's camera collision pulls it in close.
- The opening raid always attacks from a gate direction, but on hill sides raiders come over the wall instead of through the gate.
- Balance runs had no player input. A player possessing a unit, or building on day 1, shifts results a lot.
- Unchanged from next_0: no unit HP bars, no music, entity shadow discs render through walls.

## What to work on next (suggested order)

1. **Play it yourself** — the opening raid, day 1, then nights 1–3 — and tune `OPENING_RAID`, `SUBWAVE_INTERVAL`, `SPAWN_RADIUS` and tower stats in `balance.js`.
2. **Make walls matter on the default world**: raise the walls on the hill sides, or dig a ditch, so attackers have to break a gate or wall. Then check that brutes visibly smash through.
3. **Readability in combat**: unit HP bars, a Town Center hit flash, and arrows for groups hidden behind terrain.
4. **Real phone and older laptop test**, then tune `TIERS` (see next_0 item 1). Run the benchmark with vsync off to measure headroom.
5. **Day-1 guidance** after the opening raid: point at the build menu and suggest a first wall or tower, maybe as a short checklist in the banner.
6. The rest of next_0's list is still open: better placeholder art, a hand-built default world, multiplayer groundwork.
