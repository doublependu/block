# Plan 8: a walk, a swing that always plays, and three of everything

Answers `ai/prompt_8.md`. Nothing below is implemented yet.

The prompt has one bug and four features:

1. the builder is always running — there's no walking speed and no walk animation
2. the mine/hit animation should play the moment the left button goes down, hit or not
3. swords should look cooler in the hand, with a swing per tier, each cooler than the last
4. three levels of every defence structure, like the three swords, with the gameplay tuned for it
5. three levels of bow, with a bow and a shot that look cool

They split into two halves: **how it feels in the hand** (1–3, 5) and **what you can build** (4).
The second half is the one that needs measuring, and the iteration 7 harness (difficulty map, bot
games) does that.

---

## 0. What I found before planning

### 0.1 Why the builder is always running

- `PLAYER_SPEED = 10` (`balance.js:266`) is the builder's only speed. `returnToSelf` sets
  `mv.maxSpeed = PLAYER_SPEED` and nothing ever changes it.
- The gait is chosen from the body's actual speed (`contract.js:107 nextGait`, called from
  `CharacterInstance.locomote`): `run` from 2.55 m/s up. At 10 m/s the builder is always in `run`.
- The clips aren't the problem, the speed is. Each clip is played at the rate that keeps its feet
  on the ground (`GROUND_SPEED`, measured with `npm run anim-check`): the player's `walk` moves the
  ground at 1.31 m/s, `run` at 3.56 m/s, and `gaitRate` caps playback at 2× for walk and 2.8× for
  run. So **the walk clip is honest up to 2.6 m/s and the run clip up to 10 m/s** — the current
  speed is exactly the top of the run clip.
- That ceiling is a **clip parameter, not a fact**: the gait clips are generated from a table of
  stride, stance fraction and cycle length (`make_characters.py: GAITS`), and ground speed is
  `stride / (stance × cycle)`. The walk's 0.52 m stride over a 0.67 s cycle at 60% stance is what
  makes 1.31 m/s. Blender is available here (§0.3), so the stride is mine to change — which is what
  §2.1 does instead of accepting a 2.6 m/s walk.

### 0.2 Why nothing plays when you click at nothing

`Control._selfFire` (`control.js:605–680`) ends in four places without playing anything:

| Case | Line | What happens today |
|---|---|---|
| day, nothing targeted (sky, or out of reach) | `control.js:648` | `mining = null`, return |
| day, unbreakable block (bedrock, plaza, town core) | `control.js:655` | `mining = null`, return |
| melee with an enemy in reach but on cooldown | `control.js:628` | nothing until the cooldown ends |
| a block or unit selected (kind ≠ weapon) and nothing to mine | as above | nothing |

Only two paths animate: a hit that lands, and a swing at the air at night (`control.js:640`, which
exists because `canEdit` is false). Also, everything is decided in the **fixed tick**, so even a
landed hit waits up to a tick after the button goes down.

### 0.3 The asset pipeline is live (checked, not assumed)

Blender isn't on `PATH`, which is what `${BLENDER:-blender}` in `package.json` exists for. It is
installed:

| | |
|---|---|
| binary | `/home/rx/Downloads/blender-5.2.1-linux-x64/blender` (5.2.1 LTS, and the generator's header says "Blender 5.x") |
| items rebuild | `ONLY=items blender -b --factory-startup -P tools/blender/make_characters.py -- <out>`, ~2 s |
| character rebuild | ~0.8 s each, 16 clips |
| reproducible | the rebuilt `items.glb` and (after `tools/fix-glb-animations.mjs`) `player.glb` are **byte-identical** to the committed files — same md5 |
| measured | `node tools/anim-check.mjs <file>` reports each gait's ground speed, slide, stance and clearance; `node tools/validate-glb.mjs` passes on all nine models |

A GUI Blender has also been running here since Sep 16; the generator runs `-b --factory-startup`, so
a headless rebuild never touches it.

So the assets are editable, and this plan uses that:

- the gait clips can be re-cut (§2.1), instead of choosing speeds around the old stride;
- each sword and bow tier can be **its own mesh** in `items.glb` (§4.1), instead of today's single
  mesh with a colour multiplier (`WEAPONS[*].tint`, `balance.js:290`);
- third person can have a **real swing per tier** (§4.3), not just the same clip played faster.

What it costs: `player.glb` is 126 KB raw / 16 KB gzipped, of which 55.7 KB is animation across 16
clips — about **3.5 KB raw (≈0.5 KB gzipped) per clip**, against a 150 KB model budget. Three or
four new clips are affordable; all eight characters share the rig, so extra clips are gated to the
models that need them.

### 0.4 What a new block costs, in files

Adding a block tier touches exactly these: `world/blocks.js` (id, hardness, drop, flags),
`world/atlas.js` (`TILE_NAMES`, a painter, `ITEM_TILE`), `blocks.js BLOCK_DUST`, `balance.js`
(`ITEMS`, `RECIPES`, `TOWERS`, `blockDefenceValue`), `ui/hud.js` (`LABEL`, `BADGE`, `RECIPE_NOTE`),
`game/guide.js` (`DEFENCES`, `CRAFT_PRIORITY`), `game/inventory.js` (creative defaults),
`audio/audio.js:226` (`soundMaterial`), `game/towers.js` (the head mesh), and the bot's
`full.js` (`PATCHABLE`, what it buys). Block **ids are append-only and world files store names**, so
old saves, `worlds/`, and the bot's towns keep loading unchanged.

### 0.5 The rule that makes an upgrade worth building

The night answers what you've built: every defence point above the starting town's 226 adds budget
(`WAVE_ADAPTIVE`, `waves.js: defenceParts`). So a tier is only worth its resources if it gives
**more power per defence point** than the tier below. That is the design rule for §6, and a unit
test can assert it for every family.

The second half of the rule: tiers cost **iron and gold**, which are scarce, and gold competes with
troops (a gunner is 2 gold). Towers also run out of places to stand (the bot filled every spot by
day 6 in iteration 7 runs), so upgrading is the only way to keep growing there. That is the sink
next_7 asked for.

### 0.6 Pieces I can reuse

- **The difficulty map** (`tools/autoplay/map.mjs --lab=siege:<town>:<night>`) and the saved towns:
  one night against a fixed town in 1–3 minutes.
- **The bot** (`--strategy=bot|towers|idle`) and its report (waves, lives, patches, day split).
- **`capture.js` / `video.mjs`** for screenshots and contact sheets — how "cooler" gets checked
  without a person watching (§8.3).
- **`towers.js:_makeHead`**: tower heads are already built from primitives per type, so a tier head
  is a few more boxes.
- **`placing.js`**: pure build rules with unit tests (`towerPlacement`, `canPatch`) — the upgrade
  rule (§6.4) goes next to them.
- **`viewModel.js`**: procedural motions with a curve each, plus the blade trail that samples the
  same curve. Per-tier swings are new entries in `MOTIONS`, not new assets.

---

## 1. Scope

| # | Change | Answers | In this iteration |
|---|---|---|---|
| 1 | Walk by default, run on Shift, for the builder and possessed units | issue 1 | yes |
| 2 | The action plays on the button press, whatever is in front of you | feature 1 | yes |
| 3 | A sword mesh per tier in `items.glb`; a first-person swing and a body swing per tier | feature 2 | yes |
| 3b | Assets re-cut in Blender: longer gait strides, per-tier attack and draw clips | issue 1, features 2 & 4 | yes |
| 4 | Three bows, with a nocked arrow and a per-tier draw | feature 4 | yes |
| 5 | Three levels of wall, gate, spikes, arrow tower and cannon tower | feature 3 | yes |
| 6 | Upgrading in place, hotbar and Build panel that group by family | feature 3 | yes |
| 7 | Tuning: values, costs, the wave's answer, the difficulty map and bot games | feature 3 | yes |
| 8 | Bot: sprint, tiers, upgrades; a showcase lab for the visuals | measuring | yes |
| — | New late-night attacker types, a shop after a loss, drag-to-build, rallying troops | next_7 §next | later |
| — | Real phone and old laptop, armour for the builder, multiplayer | carried over | later |

---

## 2. Walking and running

### 2.1 Speeds

**The clips are re-cut first,** so the speeds can be chosen for the game instead of for the old
stride (`GAITS` in `make_characters.py`; ground speed = stride / (stance × cycle)):

| Clip | Stride | Stance | Cycle | Ground speed |
|---|---|---|---|---|
| walk, today | 0.52 m | 0.60 | 0.67 s | 1.31 m/s |
| **walk, new** | 0.60 m | 0.58 | 0.60 s | **1.72 m/s** |
| run, today | 0.68 m | 0.36 | 0.53 s | 3.56 m/s |
| **run, new** | 0.80 m | 0.35 | 0.53 s | **4.29 m/s** |

Then the speeds:

| Who | Walk | Run | Clip rate |
|---|---|---|---|
| the builder | **3.1** | **9.0** | walk 1.80, run 2.10 |
| a possessed NPC | `def.speed × 0.55` | `def.speed × 1.25` (today) | matched |
| the autopilot builder | 5.5 (`HERO.speed`, unchanged) | — | run 1.28 |

- New `PLAYER_GAIT = { walk: 3.1, run: 9.0 }` in `balance.js`; `PLAYER_SPEED` becomes the run value
  so nothing else has to change its meaning.
- **Why these numbers:** 3.1 m/s is a brisk walk the re-cut clip carries honestly (1.8× playback,
  cap 2×), and 9.0 keeps travel within 10% of today's, so the day's pacing (already 48% walking,
  next_7) doesn't get worse. The longer run stride also fixes half the complaint on its own: today
  the run clip is played at 2.53× to keep up with 10 m/s, which is what makes the builder look
  frantic; at 4.29 m/s of stride it plays at 2.10×.
- **Knock-on for every NPC** (they share the rig, so their strides grow too, and `nextGait`'s
  threshold is 1.95 × the model's walk speed). I worked each one through: **no unit changes gait** —
  grunts, raiders, sappers and defenders still run, and brutes already walk today (2.6 m/s against a
  3.12 threshold). What changes is the playback rate: a grunt goes from 1.01× to 0.84×, a brute from
  1.63× to 1.24×, so the whole crowd stops looking sped-up. The closest call is the sapper (3.4 m/s
  against a new 3.23 threshold, 5% of margin); if the stride goes any longer, sappers start walking,
  so the unit test in §10 pins that. Nobody's `speed` in `UNITS` moves, so wave timings hold, but
  the difficulty map is re-run after the re-cut anyway (§7.2).
- `npm run anim-check` re-measures every model and `GROUND_SPEED` in `contract.js` is updated from
  its output; `docs/character-contract.md` gets the new table.

### 2.2 Controls

- **Hold Shift** (`ShiftLeft`/`ShiftRight`) to run. A new `sprint` binding in `control.js`, applied
  in `tick` as `mv.maxSpeed = sprinting ? run : walk` on whatever unit you control.
- **Double-tap W latches** the run until you stop or let go of W (a keyboard convenience; no stamina,
  no cost).
- **Touch:** push the stick past 76% of its travel (38 of 50 px, `touch.js:_move`) and you run; the
  knob brightens at that point. No new button.
- **A setting** `alwaysRun` (off by default, in the pause panel next to tips and health bars):
  with it on, you run by default and Shift walks.
- **Feedback:** the camera's field of view widens by 5% over 0.15 s while running, and the
  first-person hands drop a little further (the existing `_sway` bob, scaled by speed). Both ease
  back when you stop.
- **The help panel and the touch hint** get the line: "Shift — run (or push the stick all the way)".

### 2.3 What follows automatically

- The walk clip appears with no game-code work: `locomote` already picks from the body's speed
  (`units.js:1240`). A unit test pins the mapping (3.1 → `walk`, 9.0 → `run`, and no flicker at the
  hysteresis edges) against the re-measured `GROUND_SPEED`.
- Mining and building at walking pace no longer overshoot the block you aimed at.
- **The bot must hold Shift while travelling** (§8.1), or every measurement shifts under us.

---

## 3. The swing always plays

### 3.1 The rule

Pressing the left button (or the touch ⛏) **always** starts an action, chosen by what's in hand:

| In hand | Day | Night |
|---|---|---|
| pickaxe, or a block | `mine` — chop loop while held, on a block or at the air | `attack` (a swing) |
| a sword, or bare hands | `attack` if an enemy is in reach, else `mine` on a mineable block, else `attack` at the air | `attack` |
| bow or musket | `shoot` on the weapon's cooldown (today) | same |

- **It starts on the press**, in `_firePressed`, not on the next fixed tick, so the first rendered
  frame after the click already moves.
- **Pacing:** a swing at nothing takes the weapon's cooldown, so holding the button gives a steady
  rhythm rather than a blur. A chop at nothing loops with the mining motion, as digging does.
- **Sound:** a blade swings with the existing swoosh; a chop at the air gets a quieter version of it.
  Nothing spawns dust or damage numbers unless something was actually hit.
- **Picking up your own troops** (a click on a troop by day) still wins over the swing, as today.
- **Aerial mode** is unchanged: the click there places and picks, and the builder is on autopilot.

### 3.2 Where it lives

A pure `pressAction({ kind, attack, canEdit, enemyInReach, blockTargeted })` → `'mine' | 'attack' |
'shoot' | null` next to the other rules in `placing.js` (or a new `actions.js`), unit tested over
every combination. `_firePressed` and `_selfFire` both call it, so the press and the hold agree.

---

## 4. Weapons you can see

### 4.1 A mesh per weapon, modelled where the other art is

- **`build_items()` in `make_characters.py` gains the tiers:** `wood_sword`, `stone_sword`,
  `iron_sword`, `recurve_bow`, `war_bow`, and an `arrow_nocked` for the drawn arrow — same box lists
  as the existing items, so the art stays in one reproducible script.
- The bow's **string and limbs become their own nodes** (`bow_string`, exported beside the bow), so
  the draw can bend them at runtime instead of faking it with the arm alone.
- `items.glb` grows from 24.6 KB to an estimated ~40 KB raw (≈5 KB gzipped). It's fetched lazily on
  the first item shown, not in the first-load budget, and the old `sword`/`bow` nodes stay so
  nothing breaks mid-refactor.
- **`WEAPONS[*].item`** points at the tier's mesh instead of `'sword'` + a tint, so
  `CharacterInstance.setItem` and `ViewModel._buildItem` need no new machinery; `holdForItem`
  (`contract.js`) maps the new names to `hold_sword` / `hold_bow`.
- The per-item poses (`library.js:32`, `viewModel.js:146`) get a per-tier entry and are tuned so the
  blade actually sits in view — the carried-over "first-person item poses" job from next_7.
- **Tested** under Babylon's `NullEngine` (as `tests/render.test.js` already does): every item node
  is present in the GLB, the tiers differ, and each blade's tip sits at the end of its blade (the
  trail depends on it).

### 4.2 Three swords you can tell apart

| Tier | Look | Damage | Cooldown | DPS (today) |
|---|---|---|---|---|
| **wooden** | short plain blade, bound grip | 16 | 0.40 | 40 (35.6) |
| **stone** | thick chipped blade, notched stone guard | 28 | 0.50 | 56 (53.3) |
| **iron** | long blade with a fuller, steel crossguard, pommel stone | 36 | 0.45 | 80 (80) |

- Held **higher and angled across the view**, so the blade is actually visible instead of pointing
  away from the camera (today's pose is the GLB's "out of the fist" default).
- In third person the same three meshes hang at the hand socket (troops keep their own sword).

### 4.3 A swing per tier, each cooler than the last

**First person** is three curves in `MOTIONS` (`viewModel.js:71`) — no assets, smooth at any frame
rate.

| Tier | Swing | Trail | Extra |
|---|---|---|---|
| **wooden** | 0.34 s: short wind-up, diagonal slash | thin, 10 samples, short | — |
| **stone** | 0.46 s: high wind-up, heavy downward chop, a 50 ms hold at the bottom, slow recovery | wide and dull | a small camera shake on a landed hit (`control.shakeT`), dust chips at the point of impact, a lower-pitched swoosh |
| **iron** | 0.40 s: a wide flourish across the whole view, **mirrored on every second swing** so a held button reads as a combo | long (span 0.3), bright two-tone edge | sparks on a landed hit, a faint gleam that travels down the blade between swings, a brighter swoosh |

- The trail already samples the swing curve, so it follows each new motion for free; `TRAIL` gains
  per-tier width, span and colour.
- **Third person gets real clips, not just a speed ratio.** Two new upper-body clips on the player
  rig (about 0.5 KB gzipped each, §0.3): `attack_heavy` (the stone chop: high wind-up, whole-body
  drop, a beat at the bottom) and `attack_flourish` (the iron sweep, mirrored on the return). They
  join `CLIPS`, `UPPER_ACTIONS` and `FALLBACKS` in `contract.js`, falling back to `attack` so
  external models and the NPCs are unaffected — the swordsman keeps the plain swing, and only the
  builder carries the extra clips, so the other seven models don't grow.
- The builder (only the builder) also gets the blade trail in third person; NPCs don't, for the
  unit count.

---

## 5. Three bows

| Tier | Name | Damage | Cooldown | Range | Draw | Cost | Defence value |
|---|---|---|---|---|---|---|---|
| I | **shortbow** (`bow`) | 18 | 0.80 | 30 | 0.32 s | planks 3, log 1 | 5 |
| II | **recurve bow** (`recurve_bow`) | 30 | 0.90 | 36 | 0.42 s | planks 3, iron 2 | 9 |
| III | **war bow** (`war_bow`) | 46 | 1.05 | 44 | 0.55 s | planks 2, iron 3, gold 1 | 14 |

- DPS 22.5 / 33.3 / 43.8. The musket (42.9 DPS, 14 value) stays the flat, fast, expensive option;
  the war bow arcs, and **its bolts pierce** (§6.3), so the two answer different nights.
- `bow` keeps its name, so saves and the archers' held item don't change.
- **The shot:**
  - an **arrow appears on the string** when the draw starts and leaves when it fires — the single
    biggest change in how a bow reads;
  - the string pulls back with the draw (the bow's limb and string boxes are separate nodes now, so
    they can flex);
  - **tier II** pulls deeper, the limbs bend visibly, and the release snaps with a string shiver;
  - **tier III** pulls to the ear over half a second with the left hand visibly straining, the bolt
    glows faintly, the release kicks the view and leaves a bright bolt;
  - the draw always finishes within the weapon's cooldown, so it never lies about when you can
    shoot again.
- **Third person:** one new clip, `shoot_draw` (a full pull and release, longer than the existing
  `shoot`), on the player rig only, played at the tier's rate; it falls back to `shoot`, so archers
  and raiders are untouched.
- Raiders and archers keep the tier I bow.

---

## 6. Three levels of every defence

### 6.1 The families

Five families, tier I is what exists today (so every saved world keeps its blocks):

| Family | I | II | III |
|---|---|---|---|
| wall | `stone_wall` | `iron_wall` | `steel_wall` |
| gate | `gate` | `iron_gate` | `steel_gate` |
| spikes | `spikes` | `iron_spikes` | `steel_spikes` |
| arrow tower | `arrow_tower` | `crossbow_tower` | `ballista_tower` |
| cannon tower | `cannon_tower` | `mortar_tower` | `bombard_tower` |

Nine new blocks (ids 24–32), nine new atlas tiles, painted from the existing painters with more
metal and, at tier III, a gold band so a tier is readable across the town at a glance.

### 6.2 Numbers (starting values, to be tuned in §7)

**Towers**

| Tower | Range | Damage | Cooldown | DPS | Value | Cost |
|---|---|---|---|---|---|---|
| arrow I | 16 | 10 | 1.00 | 10.0 | 14 | planks 6, cobble 4 |
| crossbow II | 18 | 17 | 0.95 | 17.9 | 22 | planks 6, cobble 4, iron 2 |
| ballista III | 21 | 30 | 0.90 | 33.3 | 34 | planks 6, cobble 6, iron 3, gold 1 |
| cannon I | 22 | 45 | 3.20 | 14.1 (splash 2.5) | 24 | cobble 8, iron 4 |
| mortar II | 26 | 70 | 3.10 | 22.6 (splash 3.0) | 36 | cobble 8, iron 5, gold 1 |
| bombard III | 30 | 105 | 3.00 | 35.0 (splash 3.6) | 52 | cobble 10, iron 6, gold 3 |

DPS per defence point: arrows 0.71 → 0.81 → 0.98, cannons 0.59 → 0.63 → 0.67 (§0.5 holds).
Against brutes, who halve arrows, it's 0.36 → 0.41 → **0.98**, because a ballista fires bolts.

**Blocks**

| Block | Hardness | Night hp | Value | hp per point | Cost |
|---|---|---|---|---|---|
| stone wall I | 1.8 | 108 | 0.40 | 270 | cobble 3 → 2 |
| iron wall II | 2.6 | 156 | 0.55 | 284 | cobble 2, iron 1 → 2 |
| steel wall III | 3.8 | 228 | 0.75 | 304 | cobble 2, iron 2, gold 1 → 2 |
| gate I | 0.9 | 54 | 0.20 | 270 | planks 4 |
| iron gate II | 1.8 | 108 | 0.35 | 309 | planks 2, iron 2 |
| steel gate III | 2.8 | 168 | 0.50 | 336 | planks 2, iron 2, gold 1 |
| spikes I | 0.6 | 36 | 0.50 | 24 dps/pt | planks 1, iron 1 → 2 |
| iron spikes II | 0.9 | 54 | 0.80 | 27.5 | cobble 1, iron 2 → 2 |
| steel spikes III | 1.2 | 72 | 1.10 | 31 + a slow | iron 2, gold 1 → 2 |

Tower blocks themselves get hardness 1.6 / 2.2 / 2.8 (96 / 132 / 168 night hp), so a higher tower
also takes longer for a brute to knock down.

One existing number moves: the **iron wall's defence value 0.6 → 0.55**, so the three wall tiers sit
on one curve. The default town has no iron walls, so its 226 (§6.6) is unaffected.

**The gold squeeze.** Tier III always costs gold, and gold only comes from surviving a night
(`1 + ⌊night/2⌋`, `session.js:547`) and from the deep ore. Troops cost gold too, so every night's
reward is a choice: another gunner, or the tower you have becomes a ballista. To make tier II
reachable by day 3 without a mining grind, the default world's stone outcrop (added in iteration 7)
gets **3 gold ore at its base**; deep gold stays where it is.

### 6.3 Bolts

- A new attack kind, `bolt`, fired by the ballista tower and the war bow: faster and flatter than an
  arrow, a brighter projectile, and **not in `ARMOUR`**, so brutes take it in full.
- This is the second answer to brutes, next to cannons and muskets, and it's the reason to upgrade
  arrow towers rather than build more of them.
- `effects.js` gains a `bolt` pool (one more box instance pool, sized like the arrow one).

### 6.4 Upgrading in place

- **Place a higher tier of the same family onto a lower-tier block and it replaces it**, by day,
  for the cost of the new block (the old one isn't refunded).
- A tower keeps its column; the head is swapped, and the tower keeps firing.
- Anything else (a different family, the same or a lower tier, at night) is refused with the usual
  toast.
- A pure `upgradePlacement(getBlock, at, item)` beside `towerPlacement` in `placing.js`, unit tested
  for: same family higher tier, same tier, lower tier, different family, not-built blocks, night.
- **Why:** without it, upgrading means digging out a wall you built, and towers have nowhere new to
  stand anyway.

### 6.5 The UI, with 15 structures

- **The Build panel** groups by family: one card per family with three tier buttons (I / II / III),
  the cost of the selected tier, and what it's good against. Troops and weapons group the same way
  (sword ×3, bow ×3, musket). The panel gets shorter than it is today, not longer.
- **The hotbar** (still 9 slots) auto-slots the **highest tier you own of a family in the slot the
  family already has**, so crafting a ballista doesn't fill a new slot; the lower tiers stay
  craftable and can be placed by hand from the panel.
- **Labels and badges** for every new item (`hud.js`), each with a note: "bolts pierce brutes",
  "blast hits groups", "holds a gate lane", and so on.
- **The guide** learns the families: the craft tip still points at tier I, and a new tip fires the
  first night a brute survives a full volley — "your arrows bounce: upgrade a tower or build a
  cannon".

### 6.6 What doesn't change

- Block ids and the world-file version: names only, all appended.
- The default town, the opening raid, lives, patching, the dawn rebuild (a destroyed tier III block
  comes back as tier III, since the rebuild restores by name).
- `WAVE_ADAPTIVE.free = 226`: the starting town is still all tier I.

---

## 7. Tuning it

### 7.1 What the wave sees

`defenceParts` (`waves.js:32`) maps each block to a counter part by **family**, not by name: all
arrow-tower tiers count as `arrow` (draws brutes), cannon tiers as `cannon` (draws sappers), walls,
gates and spikes as `walls` (draws sappers), troops as `troops`, the builder's weapon as `weapon`.
So upgrading draws a stronger night, but less than the same power bought as tier I — which is
exactly the incentive §0.5 describes.

### 7.2 The loop

As in iteration 7: change numbers → the difficulty map → bot games → repeat. Each map cell is one
night against a fixed town, 1–3 minutes, two runs a cell, 2–3 in parallel.

**Towns:** `default`, `t1-towers` (27 tier-I arrow towers), `t2-mixed`, `t3-full` (all from
iteration 7, unchanged), plus two new ones built by `make-towns.mjs`:

- **`t6-tier2`:** `t1` with as many towers upgraded to tier II as its iron would have bought.
- **`t7-tier3`:** the same **defence value** as `t1`, spent on tier III towers (so: fewer towers).

**Nights:** 2, 4, 6, 8, 10, 12, as before, so the new rows sit next to iteration 7's.

### 7.3 Targets

| Check | Target |
|---|---|
| idle (builds nothing) | first loss night 5–6 — **unchanged** from iteration 7 |
| `--strategy=towers` (tier I only) | first loss night 8–9 — **unchanged**: tiers must not make tier I stronger or weaker |
| `--strategy=bot` (buys and upgrades) | first loss night 12–16, game over not before night 14 |
| `t7-tier3` vs `t1-towers`, same defence value | tier III holds at least 2 nights longer |
| `t6-tier2` vs `t1-towers` | between the two |
| brute nights (8+) on a ballista town | brutes die to towers without cannons, at a higher resource cost |
| iron and gold left at night 10, full bot | under 5 each (iteration 7: 13–15 iron, 10–15 gold unspent) |
| the day split, full bot | walking within 5 points of iteration 7's 48%, i.e. the Shift run really is used |

If a target can't be met in the tuning rounds, `next_8.md` says so and where it landed, as next_7
did.

---

## 8. Bot, tools and looking at it

### 8.1 Bot changes

- **Holds Shift while travelling** (`input.js setMoveKeys` gains `ShiftLeft`), releases it when it
  arrives, mines, builds or fights — otherwise the day gets 3× longer and nothing compares.
- **Buys the best tier it can afford** and, when the tower spots run out, **upgrades** the oldest
  towers instead. Keeps gold for tier III while spots remain, otherwise spends it on troops.
- **Patches with the tier it carries** (`PATCHABLE` becomes "any wall or gate family block"; the
  patch rule still needs the block that was destroyed, §6.6).
- **`--strategy=towers` stays tier I only**, as the fixed baseline.
- **Report additions:** what it upgraded and when, tier mix at each dusk, iron and gold left.

### 8.2 Skill tests

`--lab=skills:all` gains three: craft and place a tier II wall; upgrade a tower in place; a click at
the sky plays an action (a browser probe: the character's action and the view model's motion are
both non-null within 100 ms of the press).

### 8.3 Looking at the new visuals

**`--lab=showcase`** (new, headless, ~2 minutes): a creative sandbox where the bot

- equips each weapon tier in turn and holds, swings and shoots, capturing frames at fixed points of
  each motion (rest, wind-up, mid-swing, impact),
- places one of every defence tier in a row and orbits it,
- writes `recordings/showcase8/` with a contact sheet per family and a 20-second clip.

That's how "cooler" gets checked on every change without a person watching, and it's what I'd put in
front of you at the end.

---

## 9. Order of work

0. **The asset pass in Blender** (§0.3, §2.1, §4.1): re-cut the gait strides, add the tier meshes
   and the three new clips, run `fix-glb-animations`, `anim-check`, `validate-glb`, and update
   `GROUND_SPEED`. Everything else depends on it, and it's the step that needs
   `BLENDER=/home/rx/Downloads/blender-5.2.1-linux-x64/blender npm run characters` — I'll add that
   path to the README so it isn't rediscovered next time.
1. **Movement and the press** (§2, §3): small, self-contained, immediately playable; tests and the
   help text. Bot sprint at the same time, so measurements stay comparable.
2. **The swords** (§4.2–4.3): poses, first-person swings, the two body clips wired up.
3. **The bows** (§5), with the nocked arrow, the string pull and the bolt projectile.
4. **The defence tiers** (§6): blocks, tiles, recipes, tower heads, upgrading, the Build panel.
5. **Wiring and the first tuning pass** (§7): counter families, the map against the new towns.
6. **Bot tiers and upgrades** (§8.1), skill tests, the showcase lab; then full games and the
   remaining tuning rounds.
7. **Wrap-up:** the showcase sheet, the recorded hour if you want one (§11.10), and `next_8.md`
   with before/after on each of the five prompt items.

---

## 10. How I'll verify it

- **`npm run check`** (types + tests), with new tests:
  - **Gait:** 3.1 → `walk`, 9.0 → `run`, no flicker at the thresholds, possessed units scale from
    `def.speed`, and every unit's speed stays inside its clip's honest range (`GROUND_SPEED`) — the
    test reads the re-measured table, so a future stride change that breaks a unit fails here.
  - **Press:** `pressAction` over every combination of item kind, phase, enemy and block.
  - **Item meshes:** each one builds under `NullEngine`, the three swords differ, and each blade's
    tip is at the end of the blade.
  - **Tiers:** for every family, damage/hp/value/cost rise with tier, **power per defence point
    rises**, every tier has a tile, a dust colour, a label, a note and a sound material, and every
    tier is craftable from the tier below's resources plus iron or gold.
  - **Upgrading:** the six cases of §6.4.
  - **Waves:** each tier maps to the right counter part; the default town's defence value is still
    226; a ballista town draws brutes like an arrow town does.
  - **Bolts:** brutes take arrows at half and bolts in full.
  - **World file:** the nine new blocks round-trip; a file written before this iteration still loads.
  - **Inventory:** a higher tier takes the family's hotbar slot rather than a new one; ×5 and the
    log-for-planks rule still hold.
- **Assets:** `npm run validate-glb` passes on every model; `npm run anim-check` shows each gait's
  slide under 10% (the walk is 5% today) at its new stride; a rebuild is **reproducible** — running
  the generator twice gives the same bytes, as it does today.
- **`npm run build`:** budgets pass. Estimate: **+10–14 KB brotli** of game code (339.3 KB today,
  550 KB budget); `player.glb` grows by three clips (≈1.5 KB gzipped, budget 150 KB, 16 KB today)
  and `items.glb` by the tier meshes (≈5 KB gzipped, lazily loaded).
- **`npm run perf -- --headless`**, desktop and mobile profiles: menu and first playable frame
  unchanged within noise (spec: 2–3 s, 4 s max); the night benchmark holds 60 fps, run again with a
  **tier III town** since ballistas fire 3× as often as arrow towers (the projectile pools and the
  device cap are what this checks).
- **Bot:** `skills:all` passes three times running; the map and the games meet §7.3 or next_8 says
  where they didn't; 0 blocked writes in every run.
- **Showcase** sheets for every weapon tier and every defence tier (§8.3), plus screenshots of the
  Build panel's family cards and the hotbar.

---

## 11. Choices I made that you may want to override

1. **Walk 3.1, run 9.0 on Shift, with both gait clips re-cut to longer strides** (§2.1).
   Alternatives: (a) leave the clips alone and walk at 2.7, the most the current stride carries;
   (b) add a third clip and three gaits (walk / jog / sprint) on two modifiers; (c) run by default
   with Shift to walk — which is what the `alwaysRun` setting gives you either way. Re-cutting the
   strides also changes how every NPC moves (brutes start walking), so say if you'd rather I only
   touched the player.
2. **No stamina.** Running is free and unlimited.
3. **New meshes and clips go into the Blender generator** (§0.3, §4.1, §4.3) rather than being built
   in JavaScript at runtime: one place for the art, reproducible, byte-identical rebuilds. The cost
   is ~5 KB gzipped on `items.glb` and ~1.5 KB on `player.glb`. Alternative: procedural meshes in JS
   and drop `items.glb` entirely (one fewer request, −24.6 KB, but the art leaves the art tool).
4. **Sword stats move a little** (stone 24 → 28 damage, cooldowns 0.40 / 0.50 / 0.45) so each tier's
   swing has room to be its own weight. Say if you'd rather the numbers stayed put.
5. **Tier names**: `steel_wall`, `iron_gate`, `steel_gate`, `iron_spikes`, `steel_spikes`,
   `crossbow_tower`, `ballista_tower`, `mortar_tower`, `bombard_tower`. Alternative: plain
   `arrow_tower_2` / `_3` style names, or a single "upgrade kit" item used on any structure.
6. **Upgrading in place, no refund** (§6.4). Alternative: no upgrading (dig it out and rebuild), or
   a partial refund of the old block.
7. **Tier III pierces brute armour** (bolts, §6.3). It's the reward that makes upgrading towers an
   answer to brutes, next to cannons. Alternative: keep piercing for cannons only and make tier III
   just bigger numbers.
8. **Gold is the tier III currency**, and it competes with troops. Plus 3 gold ore in the outcrop so
   tier II–III isn't gated behind deep mining. Alternative: no gold in the outcrop (slower, more of
   a grind), or tier III on iron alone (then gold stays a troop currency only).
9. **The wave answers tiers by family** (§7.1), so an upgraded town draws a stronger night than an
   un-upgraded one of the same shape, but a weaker one than the same power bought as tier I.
10. **Video:** the showcase sheets and clips (§8.3) either way. A full recorded hour on the final
    code costs about 1.5 hours of wall clock and ~1.3 GB — worth it if you want to watch a game with
    tiers, skippable if the showcase is enough.
11. **Not in this iteration:** new late-night attacker types, a shop after a lost night,
    drag-to-build walls, rallying troops, an armour tier for the builder. They're next_7's list and
    they'd crowd out the tuning this one needs.

I'll re-read `ai/prompt_8.md` before implementing, in case you've answered any of these there.
