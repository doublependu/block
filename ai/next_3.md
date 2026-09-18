# Next 3 — implementation summary and what's next

Implements `ai/plan_3.md` (answering `ai/prompt_3.md`). Nothing is committed.

## What was built

**Issue 1: the "kicking" walk and run** — fixed, and both cycles were rebuilt

- **Cause (measured before the fix):** the rotation keys in every character GLB
  flipped quaternion sign from one key to the next. `q` and `-q` are the same
  rotation, but the clips are cubic-spline curves and Babylon blends their
  components, so each limb whipped through a wrong arc twice per cycle: the
  thigh jumped **65° in 1/30 s** while walking (authored swing: ±30°) and
  **122° in about 1/45 s** while running. It hit 13 of 208 rotation curves in
  all 8 models: both upper legs and both upper arms in `walk` and `run`, plus
  `jump` and `hit` (so units flailed their arms when hit, too).
  The exporter writes every key with `w >= 0`, and arms and legs rest at 180°,
  so any swing across that point flipped.
- **Fix, in three places:**
  - `src/characters/animFix.js` — `alignQuaternionKeys` puts every key in the
    same hemisphere as the one before it, and recomputes the tangents of any
    curve it touched (the exported ones were computed across the flip).
  - `tools/fix-glb-animations.mjs` runs it over the committed GLBs, as part of
    `npm run characters`. It also smooths looping clips at their seam, where the
    exporter leaves flat tangents (a small hitch every cycle).
  - The loader runs the same function on every model it loads, so GLBs you
    replace later — and external avatars — are repaired at load time.
  - `npm run validate-glb` now fails on a flipped curve.
- **New walk and run cycles** (`tools/blender/make_characters.py`): the legs are
  solved with 2-bone IK over a gait, instead of keyed by hand. The stance foot
  is planted and slides back at a constant speed, the swing foot lifts in an arc
  and lands moving backwards (no slap), the foot rolls over heel and toe, and
  the hips drop just enough for the leg to reach.
- **Feet no longer skate:** `walk` and `run` are played at
  `unit speed / clip ground speed` (`GROUND_SPEED` in `contract.js`, measured by
  the new `npm run anim-check`), with hysteresis on the idle/walk/run
  thresholds and a ~0.15 s cross-fade between them. Brutes now walk where
  grunts run, because the threshold scales with each model's own stride.
- **`hit` is an upper-body clip now**, so a unit that's hit keeps walking
  instead of freezing mid-stride.

**Issue 2: first person shows nothing in your hands** — added a view model

- `src/game/viewModel.js`: your arm (in the character's own sleeve and skin
  colours) and what you're holding, parented to the camera and drawn in
  rendering group 1 with the depth buffer cleared, so it never clips into a wall.
- Items: the `items.glb` sword (tinted per tier), pickaxe, bow and musket;
  blocks show their own texture from the terrain atlas; a possessed grunt or
  brute shows bare fists.
- Motions are procedural: swing, mining chop (loops while you dig), place,
  bow draw, musket recoil with a muzzle flash, equip, and a jolt when you're hit,
  plus idle sway and a walking bob.
- **You can see the hit land:** a slash arc on the swing, a hit-marker on the
  crosshair (red when it kills), and the damage over the target's head.
- **Projectiles leave the weapon:** in first person arrows and bullets start at
  the muzzle of the model you can see, not at the camera.
- The touch fire button shows what it will do (⛏ / ⚔ / 🏹 / ✷).

**Issue 3: units walked through each other** — they collide now

- They were meant to: there was a soft separation handler, but its push was
  about 7× weaker than the force a unit walks with, and it skipped whoever you
  were controlling. Measured before: units spent **16.8% of their time
  overlapping**, 289 of 409 overlapping pair-samples were more than half merged,
  and the closest pair was at 1% of their radius sum (the same spot).
- `src/game/crowd.js` (pure, unit-tested) resolves every tick: bodies in a
  spatial hash, overlapping pairs pushed apart along the line between them with
  the lighter one moving more, and each unit loses its own velocity into the
  other (no shoving: at 10 m/s you'd otherwise fire grunts across the plaza).
  Contacts are detected one step ahead, so a fast runner is stopped before it
  laps into someone.
- Pushes are applied as impulses through the physics body, so terrain, gates and
  walls still hold; resting bodies are woken (they sleep, and ignore direct
  velocity edits).
- Weights: brutes 2.5, a unit hitting a structure ×3 (it holds its spot at a
  wall), the unit you control ×4 (a crowd nudges you, you never walk through it).
- Around the collisions: units steer around an ally standing in the way, time
  spent blocked by other units doesn't count as "stuck" (no jump spam, no
  restarts for attackers queueing behind a breach), and a wrecker held up in a
  crowd hits whatever structure is in its reach.
- noa's own pairwise entity collision pass is no longer used for units.

**Feature 1: health bars** (on by default, switch in the pause menu)

- `src/game/healthBars.js`: one thin-instanced quad pool — one draw call for
  every bar on screen — facing the camera, with a dark backing.
- **Blue for defenders and your builder, red for attackers** (distinct for
  red-green colour blindness).
- They flash white on a hit and leave a pale chip where the health just went, so
  you can see how big the hit was; they scale up with distance so they stay
  readable from the aerial camera, and they're hidden behind terrain, on
  corpses, and on the unit you're playing in first person.
- **Settings are saved now** (`src/core/settings.js`, localStorage, guarded):
  health bars, mute and show-FPS. `?hpbars=0` turns the bars off for a test run.

**Feature 2: more cues when something is attacked**

- **Units:** a white-red flash, chips that spray away from the attacker, a small
  knockback (heavier from brutes and explosions), the health bar flash and chip,
  and damage numbers over anything **you** hit.
- **You:** red screen edges, brighter on the side the blow came from, a small
  camera punch, and the view model jolts.
- **Structures:** cracks that deepen in four stages on damaged blocks
  (`src/game/cracks.js`, generated texture, at most 4 draw calls), chips in the
  block's own colour, a pulse on the town bar, and alerts with a ring (or an
  edge arrow when off screen) for the Town Center, towers, gates and the first
  breach in a wall on each side.

## How it was verified

- **`npm run check`**: type check clean, **79 tests pass** (53 before, plus 10
  for the curve fix and gaits, 10 for the crowd solver, 6 for cracks, bar
  colours and settings), all GLBs valid.
- **`npm run build`**: budget passes. Game code 327.9 KB brotli (was 312.6 KB in
  next_1, 319.1 KB in next_2), total to first playable frame 349.6 KB. The models
  grew from 8.1 KB to 12.7 KB brotli each (denser walk/run keys).
- **Animation, measured with `npm run anim-check`** (all 8 models):

  | | Before | After |
  |---|---|---|
  | Flipped rotation curves | 13 per model | **0** |
  | Largest bone step between 60 fps frames (walk) | 713° | **10.5°** |
  | Largest bone step (run) | 647° | **22°** |
  | Stance foot slide (walk / run) | 44% / 100% (no real stance) | **5% / 9%** |
  | Swing foot clearance (walk) | 0.02 m | **0.12 m** |
  | Stance share of the cycle (walk) | 12% | 62% |

  Contact sheets: a grunt running, a swordsman walking and a brute walking all
  read as normal gaits, with no kick in any frame.
- **Collisions** (night 1, default world, med tier, no input, sampled every
  0.25 s for 60 s, ~14 living units):

  | Measure | Before | After |
  |---|---|---|
  | Unit-time overlapping by more than 10% of the radius sum | 16.8% | **0.1%** |
  | Pair-samples more than half merged | 289 | **0** |
  | Closest pair (fraction of the radius sum) | 0.01 | **0.78** |
  | Attackers inside a solid block / a gate cell | — | **0 / 0** |
  | Stuck restarts | — | **0** |

  Walking into someone: you now stop at 0.87× the radius sum from a grunt
  (0.31× before, i.e. straight through its middle) and 0.89× from a brute, and
  you nudge them along at about 0.5 m/s instead of passing through.
- **Opening raid**, 3 runs, no input:

  | Run | Walls destroyed | Towers left | Town Center blocks left | Town fell at | Duration | Finale needed | Kegs | Longest frame |
  |---|---|---|---|---|---|---|---|---|
  | 1 | 75% | 0 | 0 | 87 s | 93 s | no | 5 | 46 ms |
  | 2 | 95% | 0 | 0 | 108 s | 114 s | no | 7 | 52 ms |
  | 3 | 78% | 0 | 0 | 85 s | 91 s | no | 5 | 40 ms |

- **Night balance** (default world, med tier, builder on autopilot with the
  wooden sword, watched from above, 3 runs each):

  | Night | Survived | Length | Blocks destroyed | Tower blocks | Lowest Town Center hp | Builder's share of kills |
  |---|---|---|---|---|---|---|
  | 1 | 3/3 | 93–108 s | 16–27 | 2–3 | 99–100% | 10–38% |
  | 3 | 3/3 | 82–110 s | 12–28 | 2–3 | 100% | 19–31% |

  next_2 had night 1 at 82–97 s with 8–15 blocks and night 3 at 102–146 s with
  6–17. More of the wall comes down now, but the Town Center was never touched
  (it was hit in 1 of 3 runs before): a crowd that can't overlap gets stuck at
  the wall for longer. Nights are still on the easy side, as in next_2.
- **Touch** (412×915, touch emulation): the HUD, joystick and buttons fit, the
  fire button follows what's in your hand (⛏ block → ⚔ sword), health bars and
  alerts show, and the view model stays in frame (its offset is scaled for
  portrait screens).
- **Settings**: turning health bars off drops the pool to nothing and survives a
  reload (`localStorage`); `?hpbars=0` forces them off for a run.
- **Performance** (production build, Chrome, HTTP/2 + brotli, 10 Mbps, Intel RPL-P iGPU):

  | Profile | First playable frame | Opening raid (60 s) | Night benchmark |
  |---|---|---|---|
  | desktop | 0.86 s warm, 2.34 s cold | 58.8 fps avg, longest 39 ms, 0 over 50 ms | 54.0–54.3 fps, 71–72 units, high |
  | mobile (4× CPU), med | 2.07 s | 57.8 fps avg, longest 50 ms, 0 over 50 ms | 58.0 fps, 46 units |
  | mobile (4× CPU), low | 1.47 s | 58.4 fps avg, longest 36 ms, 0 over 50 ms | 57.7 fps, 29 units |

  - Health bars on vs off (mobile, low): 57.7 vs 57.7 fps — no measurable cost.
  - The crowd solver takes **0.29 ms per tick on average** (worst 0.8 ms) with
    81 attackers packed around the town on desktop.
  - `npm run perf` takes `--params=hpbars=0` now, to compare settings.

## Where it differs from the plan

- **The walk and run clips were rebuilt with IK**, not re-keyed by hand: it's the
  only way the foot stays planted while the hips bob, and it gave the numbers
  above. Walk is 0.67 s (was 0.8 s) and stride-matched at playback.
- **Run starts at about 2.5 m/s**, not 6: the threshold is 1.95× the model's own
  walk stride speed, so grunts and troops run when they charge and brutes walk.
- **Pushes are impulses, not position fixes.** Positions would pop and could put
  a unit inside a wall; impulses keep noa's terrain collision in charge. Resting
  physics bodies had to be woken explicitly (they ignore velocity edits).
- **Each unit only loses its own velocity into the other**, instead of splitting
  the relative velocity by mass as planned. With momentum sharing the builder
  (10 m/s) shoved grunts across the plaza.
- The plan's "no push into a solid block / gate" checks live in the browser runs
  rather than the unit tests, because the physics engine enforces them now.
- **`hit` became an upper-body clip** (planned) and the `die` clip stayed
  full-body; `jump` is the only other full-body one-shot.

## Known issues / limits

- The opening raid runs 91–114 s (plan 2's contract said 60–100 s): with
  collisions, fewer raiders can reach a wall at once. It still always ends in
  ruins without the scripted finale.
- **Nights threaten the Town Center less than before** (never hit in 6 runs)
  for the same reason. `WAVE_BASE_BUDGET`, `SIEGE` and `CROWD.mass.busy` are the
  knobs; this needs a play session to tune rather than more scripted runs.
- Bars, cracks and numbers are all drawn at every quality tier; only the particle
  counts scale with the tier.
- Damage numbers show only for damage you deal, and only while it's on screen.
- The view model is a box arm in each character's colours — placeholder art, in
  the same style as the characters.
- A possessed unit standing against a wall still has the camera inside the wall
  (unchanged); the view model is drawn over it, so it now looks odd rather than
  empty.
- Cracks on a gate are drawn across its open gaps (one cube overlay per block).
- Still **not tested on a real phone**; the mobile numbers are CPU-throttled
  emulation.

## What to work on next (suggested order)

1. **Play it** — the raid, then nights 1–3, in first person and on autopilot —
   and tune the knobs in `balance.js` (`HIT_FX`, `SIEGE`, `CROWD` in `crowd.js`).
2. **Tune the crowd for sieges**: with real collisions, how many wreckers can
   reach a wall at once decides how fast it falls.
3. **Armour and weapon feel**: hit sounds per weapon, a musket reload, armour as
   the next crafting tier.
4. **Real phone and older laptop test**, then tune `TIERS`.
5. The rest of next_2's list: day-1 guidance, better placeholder art, a
   hand-built default world, multiplayer groundwork.
