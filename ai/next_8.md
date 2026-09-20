# next_8: where iteration 8 got to

Answers `ai/prompt_8.md`, following `ai/plan_8.md`. Everything below is in the
working tree and `npm run check` passes (193 tests, all nine models validate).

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| Issue 1 — the builder is always running | **done**: walks at 2.8 m/s, runs at 9.0 on Shift |
| Feature 1 — the action plays on the press, hit or not | **done**: a swing or a chop starts on the button, at thin air too |
| Feature 2 — cooler swords, a swing per tier | **done**: three meshes, three first-person swings, two new body clips |
| Feature 3 — three levels of every defence, gameplay tuned | **built, not tuned**: all fifteen structures exist and can be upgraded in place; the numbers are still the ones planned on paper (see §4) |
| Feature 4 — three bows, a cool shot | **done**: three bows, a nocked arrow on a string that pulls back, a piercing bolt |

---

## 2. What changed

### The assets (the step everything else waited on)

The gait clips were re-cut in `tools/blender/make_characters.py`, which the live
Blender at `/home/rx/Downloads/blender-5.2.1-linux-x64/blender` builds in about
two seconds a model:

| Clip | Stride | Stance | Cycle | Ground speed | Slide |
|---|---|---|---|---|---|
| walk, before | 0.52 m | 0.60 | 0.67 s | 1.31 m/s | 5% |
| **walk, now** | 0.60 m | 0.58 | 0.60 s | **1.73 m/s** | **6%** |
| run, before | 0.68 m | 0.36 | 0.53 s | 3.56 m/s | 9% |
| **run, now** | 0.80 m | 0.35 | 0.53 s | **4.31 m/s** | **3%** |

Two problems had to be solved to get there, and both are now written down in
`docs/character-contract.md` so the next stride change doesn't rediscover them:

- **The planted foot sank between keys.** The legs are posed with IK and
  exported as plain bone rotations, so a longer stride means the ankle cuts the
  chord instead of following the arc. Fixed by keying the run every half frame
  (`frange`) and rolling the foot over heel and toe across at least two keys.
- **The exporter's tangents let fast limbs leave their path.** `smoothLoopSeam`
  became `retangentLoop` (`src/characters/animFix.js`): every key of a looping
  base clip now gets the clamped Catmull-Rom tangent that only the seam used to
  get. That alone took the run's slide from 7% to 3% and the walk's from 9% to
  6% — both gaits are now measurably better planted than before this iteration.

`items.glb` gained nine nodes: `wood_sword`, `stone_sword`, `iron_sword`,
`recurve_bow`, `war_bow` and a `_string` for each bow (its own node so a draw
can pull it back without moving the stave). `player.glb` gained three clips —
`attack_heavy`, `attack_flourish`, `shoot_draw` — gated to the player spec, so
the other seven models didn't grow. `validate-glb` now measures the **gzipped**
size, which is what ships: player.glb is 23 KB of its 150 KB budget.

### Walking and running (§2)

`PLAYER_GAIT = { walk: 2.8, run: 9 }`. Shift runs, a double-tapped W latches it,
the touch stick runs past 76% of its travel (the knob lights up), and an
`alwaysRun` setting in the pause panel flips Shift to mean walk. The view
widens 5% while running and eases back.

**One plan number had to move.** The plan's 3.1 m/s walk sits inside the
run→walk hysteresis band (`RUN_OFF × 1.73 = 2.94` to `RUN_ON × 1.73 = 3.37`):
letting go of Shift would have left the builder in the *run* clip playing at
three quarters speed — the exact complaint the prompt is about. 2.8 m/s sits
below the band. There is a test for it now.

No NPC changes gait (the sapper keeps 5% of margin above its run threshold, as
the plan predicted). One thing does change: defenders on night patrol move at
3.0 m/s, which used to be over the old run threshold and is now under the new
one, so they walk their patrol instead of jogging it.

### The action always plays (§3)

`pressAction(...)` in `placing.js` is a pure rule with an answer for every
combination, and both the press and the hold go through it. `_firePressed` now
runs it with `dt = 0`, so the motion starts on the frame you clicked instead of
up to a tick later. A chop at thin air loops the mining motion; a swing at thin
air costs the weapon's cooldown and gets a quieter swoosh. Nothing makes dust or
damage unless a blow actually lands.

Checked in the running game: with the pickaxe aimed at the sky, a character
action and `chopping` are set within 2 ms of the press (before: nothing at all).

### Swords and bows (§4, §5)

Three sword meshes, each a different silhouette (short plain wood, thick chipped
stone, long fullered iron with a pommel stone), held higher and canted across
the view so you see the blade. Three swings in `MOTIONS`: a quick slash, a heavy
chop that holds a beat where it lands, and a wide flourish that **mirrors on
every second swing** so a held button reads as a combo. The blade trail is now
per tier (span, width, colour) and follows whichever curve is playing. A landed
blow from the stone and iron swords shakes the view and strikes chips.

Three bows — shortbow, recurve, war bow — with the string as its own node, an
arrow that appears on it when the draw starts and comes back with it, and three
draws (0.32 / 0.42 / 0.55 s), each inside its weapon's cooldown. The war bow
fires a `bolt`: faster, flatter, brighter, and **not in `ARMOUR`**, so brutes
take it in full.

### Three levels of every defence (§6)

Nine new blocks (ids 24–32, append-only; old saves load unchanged), nine painted
tiles, nine recipes, six tower heads:

| Family | I | II | III |
|---|---|---|---|
| wall | stone_wall | iron_wall | **steel_wall** |
| gate | gate | **iron_gate** | **steel_gate** |
| spikes | spikes | **iron_spikes** | **steel_spikes** (also slows) |
| arrow tower | arrow_tower | **crossbow_tower** | **ballista_tower** (bolts) |
| cannon tower | cannon_tower | **mortar_tower** | **bombard_tower** |

**Upgrading in place** works: build a higher tier of the same family onto a
lower one and it replaces it, keeping its place and a tower's column, for the
cost of the new block. `upgradePlacement` is pure and unit tested over all six
cases. Verified in the running game — an arrow tower became a ballista, kept its
spot, and its head, damage (10 → 30) and projectile (arrow → bolt) all changed.

The design rule the plan rests on is now a test: **every tier gives more power
per point of defence value than the tier below**, for all five families. So is
the rule that tier II costs iron and tier III costs gold. The waves count
defence by family, so an upgraded town draws a stronger night than an
un-upgraded one but a weaker one than the same firepower bought as tier I.

The Build panel groups the fifteen structures into seven family rows (I · II ·
III side by side) rather than a list fifteen long, and the hotbar gives a higher
tier the slot its family already holds. Three gold ore were added at the base of
the default world's outcrop, so tier II is reachable without a mining grind.

---

## 3. Verified

- `npm run check`: 193 tests pass (was 168); typecheck clean; all nine GLBs valid.
- `npm run build`: every budget passes — game code 343.4 KB brotli of 550 KB,
  player model 23.0 KB gzipped of 150 KB, 376.8 KB to the first playable frame.
- `npm run anim-check`: slide 3–6% on every model (before: 5–9%), stance
  symmetric, clearance 0.11–0.39 m.
- A rebuild is still reproducible: `items.glb` came back byte-identical before
  the new meshes were added.
- In the running game (Playwright): walk → run → walk on Shift with the right
  clip each time; the chop and the swing play at thin air; the Build panel's
  family rows; a tower upgraded in place.

---

## 4. What is **not** done

Be clear about this: **the tuning the prompt asks for ("tune the gameplay
accordingly") has not been run.** All fifteen structures exist and obey the
design rules, but the numbers are the ones planned on paper, not measured.

Specifically, from plan §7 and §8:

- **The difficulty map and the bot games (§7.2, §7.3).** The two new towns
  (`t6-tier2`, `t7-tier3`) were not built, the map was not re-run after the
  gait re-cut, and none of the targets were checked — first loss nights for
  idle / towers / bot, tier III vs tier I at equal defence value, brute nights
  against ballistas, iron and gold left at night 10, the day's walking share.
- **The bot doesn't buy or upgrade tiers (§8.1).** It sprints while travelling
  and patches any wall tier, but it still buys tier I only, so it can't measure
  the tiers. This is the first thing to do next, and the map runs depend on it.
- **The skill tests (§8.2) and the showcase lab (§8.3)** were not added, so
  "cooler" has been checked by eye in a few screenshots rather than by a
  contact sheet per family.
- Smaller carried-over bits of plan §4.3 and §5: the iron sword's gleam between
  swings, the string shiver on release, the builder's blade trail in third
  person, and a new tip when a brute survives a volley.

---

## 5. What to do next

1. **Teach the bot tiers** (`tools/autoplay/bot/full.js`): buy the best tier it
   can afford, and upgrade the oldest towers once the spots run out. It needs a
   new skill next to `place` that aims at an occupied cell, since `place`
   refuses a cell that isn't empty.
2. **Build `t6-tier2` and `t7-tier3`** with `make-towns.mjs` and run the
   difficulty map, then full bot games, against plan §7.3's targets. Expect the
   numbers in §6.2 of the plan to move: they were set on paper.
3. **The showcase lab** (`--lab=showcase`), so every weapon and defence tier
   gets a contact sheet on every change.
4. Then the polish listed in §4 above.

One note on the load benchmark, since it looks alarming until you repeat it.
`npm run perf` reported a first playable frame of **2.88–2.91 s** on this build,
against the project's own 2.5 s target (the spec's limit is 4 s). That is not a
regression from this iteration: a build of the previous commit (`ae25694`) in a
scratch worktree measured **0.96 s on one run and 3.08 s on the next**, with the
same 2.3 s sitting in `createEngine` both times. The measurement swings by 2 s
on this machine for identical code — GPU driver and shader cache, most likely —
so the number means nothing until the benchmark is made repeatable. Worth fixing
before it is used to judge anything: run it several times and take the median,
or use `--cold` consistently.

For what it is worth, the work this iteration cannot explain a 2 s difference:
the session constructor measured ~100 ms under throttling, the models grew by
about 2 KB gzipped, and the nine new tiles all share one terrain material (noa
keys terrain materials by texture URL, and the atlas is one image).
