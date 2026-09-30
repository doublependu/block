# Plan 10: a sword that stays put, towers that like high ground, and a castle on a rock

Answers `ai/prompt_10.md`. Nothing below is implemented yet.

The prompt asks for three things:

1. **issue 1**: the wooden sword is 90° off again. Check the other weapons too, and make sure it
   can't happen again
2. **feature 1**: archery towers up high should shoot farther and hit harder, based roughly on real
   physics
3. **recording**: a 30-minute video of the player building a castle like `ref/castle.jpg` in
   survival mode, with the boring parts sped up and archery towers around the castle and up high.
   Then export the final world with the game's own export

The recording depends on the other two. It uses the height rule from feature 1, and the sword is in
every shot. It also needs one balance fix first (§0.3.2): as the rules stand, a castle would bring
on nights full of sappers.

---

## 0. What I found before planning

### 0.1 The wooden sword: the paths I can check from the code look right

What I checked:

- **The meshes.** In `items.glb` the troops' `sword`, `wood_sword`, `stone_sword` and `iron_sword`
  all follow one convention. The grip is at the origin, the blade runs along +Y, the edges face ±X
  and the flats face ±Z. I read this from the accessor bounds, and `make_characters.py` builds all
  four the same way.
- **The poses.** In first person (`viewModel.js:255`), the three tiers are within 0.04 rad of each
  other. In third person (`library.js:32`), every sword uses the same pose.
- **The pictures.** Iteration 9's contact sheets are current: they were rendered after the last
  change to `viewModel.js` and `items.glb`. `recordings/showcase9/sheet-swords.jpg` shows first
  person at rest and through the swing, and `sheet-trail.jpg` shows third person. In both, the
  wooden sword sits like the stone and iron ones.
- **The deployed build.** `dist/` carries the same pose table.

So the bug is somewhere those sheets don't look. The candidates:

- **the live frames around a swing:** the equip motion, and the hand-back from the pickaxe after
  digging. The sheets only pose the motion; they don't play it
- **a troop you control** (possess), and troops seen in third person
- **the aerial view**
- **the blade trail** drawn across the blade instead of along it

§1 starts by sweeping every one of these in the running game. **If you remember where you saw it**
(first or third person, during a swing, after digging, on a phone), write it in the prompt. That
takes me straight to it.

It has happened before. The pickaxe was a quarter turn off (your commit `a659d8c`). Before that,
next_4 recorded that the first-person poses were ignored, because glTF hands Babylon a
`rotationQuaternion`. Nothing checks orientation, so any change to a mesh, a pose, the loader or a
motion can turn an item without anything failing. §1.3 adds that check.

### 0.2 Towers: today, height makes the reach shorter

- **Towers** (`towers.js:173`) pick targets inside a **sphere** around the firing point. That is
  backwards from physics. A tower 10 blocks above an attacker reaches only √(16² − 10²) ≈ 12.5
  blocks sideways, instead of 16.
- **Troops and raiders** (`units.js:1029`) use flat distance and allow up to 30 blocks of height
  difference. Height neither helps nor hurts them.
- **The player's bow** already follows real physics, because arrows leave at a fixed speed
  (`effects.fireDir`). It shoots farther from a height, but it doesn't hit harder.
- **Tower shots** (`effects.fire`) set the flight time to distance ÷ speed and pick the launch speed
  that hits. The shot always lands, so the arcs look right, but range isn't a ballistic limit
  anywhere.

### 0.3 The castle: survival mode decides how big it can be

#### 0.3.1 Rates and limits

- **You can only edit by day** (`canEdit`: phase `day`). A day lasts 8 minutes, so gathering and
  building share at most 8 minutes per cycle. A full cycle (day, dusk and night) takes about
  13 minutes.
- **Mining**: stone has hardness 1.1 and one stone gives one cobble. The bot gets about 12 cobble in
  31 s (next_7), and a tuned straight tunnel should get about 40–45 per minute. That comes to
  roughly **200–280 cobble per day**.
- **Building from the aerial view has no reach limit**: `aerialPlace` picks along the camera ray.
  That is how a person would build a castle, and it's fast (several blocks a second). **Nothing can
  be built at y ≥ 70.**
- **The Town Center** always stands at (0, plaza + 1, 0). The plaza's height is clamped to 4–14,
  and the terrain blends into it from 13 to 29 blocks out. A castle has to enclose the Town Center,
  which means its courtyard is the plaza.
- **The palette** has grey stone-wall brick, cobble, plated iron and steel walls, planks and logs.
  There is no white stone, dark slate, green copper, red brick or glass, which are the colours that
  make the photo read as *that* castle.

A Neuschwanstein at 1 block ≈ 1 m would be tens of thousands of blocks, which is weeks of in-game
days. What survival allows in about 12–15 days is **roughly 2,500–3,000 blocks**. That is the
castle at about half scale: its outline, proportions, towers, spires and roofs, simplified.

#### 0.3.2 The blocker: a castle brings on a huge night

Every built block counts toward the night's defence value (`BLOCK_VALUE`: a stone wall is worth 0.4
and cobble 0.2). Above `WAVE_ADAPTIVE.free` = 226, each point buys the night extra attackers, up to
0.4 per point from night 10 on, and **walls are answered with sappers**.

A 2,500-block castle is worth about 500–1,000 points. That is roughly **110–310 extra budget points
of sappers every night**, for roof tiles and spires that no attacker has to get through. The castle
would be blown open every night, which is the opposite of "very safe", and it would be for the
wrong reason. §3.1 fixes the count first.

#### 0.3.3 Export

`session.exportWorld()` downloads `<slug>.world.json`: seed, edits, units, player, day, night level
and lives. The harness can catch that download.

The file stores the compacted edits, which includes every quarry hole. I expect about 5,000–7,000
edits, around 150–200 KB raw. `check-budget.mjs` allows 50 KB compressed for a **default** world
only, and `tests/worldfile.test.js:64` requires `worlds/default.world.json` to match
`make-default-world.mjs`. Both matter only if your branch makes the castle the default world (§3.8).

---

## 1. Issue 1: the sword, and a check that stops it coming back

### 1.1 Find it

In the running game, screenshot every combination of **holder**, **item** and **moment**:

| Holder | Items |
|---|---|
| you, first person | none (pickaxe), the three swords, the three bows, musket, block |
| you, third person / aerial | the same |
| a possessed troop, first person | swordsman `sword`, archer `bow`, gunner `gun` |
| troops and attackers, third person | each model with its own item, e.g. the sapper's `crude_pickaxe` and the raider's bow |
| projectiles in flight | arrow, bolt, bullet |

| Moments |
|---|
| at rest · the equip motion · the pickaxe handing back to the sword after digging · the swing's wind-up, impact and recovery · walking and running · the blade trail during the slash |

Each combination is compared with its siblings, for example the wooden sword against the stone and
iron ones in the same holder and moment. The odd one out is the bug.

### 1.2 Fix it

I'll fix it at the source: a mesh axis, a pose, a motion, or a code path that skips the pose. Then
I'll re-render the sweep. next_10 will say exactly what turned it, and why it came back.

### 1.3 Make it fail loudly next time

- **A pose audit in the browser** (`node tools/autoplay/showcase.mjs --audit`, also `npm run
  check:poses`, about 1 minute). For every combination in §1.1, it reads the item's world matrix
  and works out two things in the holder's own frame (the camera for first person, the body for
  third person):
  - where the item's **long axis** points (blade, haft, stave, barrel)
  - where its **working face** points (a blade's edge, the pickaxe head's plane, a bow's string
    side)

  These are compared with a checked-in golden table (`tools/autoplay/poses.golden.json`) with a
  ±15° tolerance. A quarter turn fails by 75°. Two rules also hold without the table:
  - at the impact point of a swing, the blade's **edge leads**: the tip moves within 45° of the
    edge direction, not the flat
  - in flight, an arrow points within 10° of its velocity

  The audit also saves one contact sheet of everything, so you can see what "golden" means.
- **Unit tests** (in `npm run check`):
  - every node in `items.glb` has an **explicit** pose in both pose tables. Today a missing entry
    silently falls back to the plain sword's or bow's pose, which is how a new item can end up
    turned without anyone noticing
  - tiers of a family are posed within 0.1 rad of each other in both tables
  - the mesh convention (long axis +Y, edges ±X) holds in `items.glb`, read from the GLB, so a
    rebuilt mesh that comes out turned fails the test
- **The ritual.** The audit runs every iteration, like `npm run check`, and next_N reports it. I
  won't add it to `npm run check`, because it needs a browser and a build.

---

## 2. Feature 1: high ground for archery

### 2.1 The rule: physics-shaped, set to "slightly"

A shot leaving at speed *v* from height *h* above its target reaches, at best,
**R(h) = (v²/g) · √(1 + 2gh/v²)**.

The towers' ranges are gameplay numbers (arrow 16, crossbow 18, ballista 21), so I pin the shot's
speed to each tower's range. The launch speed is set so that the best flat-ground reach is
**twice** the tower's range. In other words, a tower's range is its useful reach, not the absolute
limit of the shot. With that, the formula becomes:

**reach(h) = R₀ · √(1 + h/R₀)**, capped at **1.5 × R₀**.

*h* is measured from **a tower standing on the ground on its two-block column** (firing point 3.5
above the target's feet). Every tower built on the ground plays exactly as it does today, and so do
the default world and the difficulty-map towns. The reach is measured flat. Line of sight stays as
it is, so a high tower still sees over walls.

| Tower (R₀) | on the ground | 4 blocks higher | 8 higher | 16 higher | cap (from 20, 22.5 and 26 higher) |
|---|---|---|---|---|---|
| arrow (16) | 16 | 17.9 | 19.6 | 22.6 | 24 |
| crossbow (18) | 18 | 19.9 | 21.6 | 24.7 | 27 |
| ballista (21) | 21 | 22.9 | 24.7 | 27.9 | 31.5 |

Below its target, a tower's reach shrinks by the same law. For example, an arrow tower 4 blocks
*below* its target reaches 13.9.

### 2.2 Harder hits

The same √(1 + h/R₀) is the gain in impact speed. Half of that gain becomes damage:
**damage × (1 + (√(1 + h/R₀) − 1) / 2)**, capped at +25% and floored at −10%.

- 4 blocks up: **+6%**
- 8 blocks up: **+11%**
- 16 blocks up: **+21%**
- 20 or more blocks up (arrow tower): **+25%**

### 2.3 Who gets it

The physics is the same for everyone. My default is **every tower (the arrow and cannon families),
defender archers and raiders, with the player's bow getting the damage part** (its range is already
physical). Raiders rarely stand above a castle, so in practice this favours the defender. You could
keep it to the arrow family only, which is exactly what the prompt names (§6).

### 2.4 Making it visible

- **A range ring.** While a tower is in hand, a thin ring shows the reach from the aimed cell,
  including the height bonus, in both first person and the aerial view. It is one line mesh, so it
  adds nothing to load and nothing measurable to the frame.
- The tower recipe cards gain "reach 16, up to 24 from high ground", and the help panel and README
  get one line each.

### 2.5 Balance: measured, not assumed

- **Height is not added to a tower's defence value.** Climbing costs the blocks under the tower and
  the time to build them, and that's what the prompt wants to reward. Note that after §3.1, blocks
  more than 3 above the ground don't draw sappers.
- **A new difficulty-map town, `t8-high`:** t1-towers' 27 arrow towers, each raised 6 blocks on
  stone pillars. Target: it holds **1–2 nights longer** than t1-towers. If it's more, I'll lower
  the scale or the caps.
- The other towns must match iteration 9's map cell for cell. That proves ground towers didn't
  change.

### 2.6 Tests

Unit tests cover `reach(h)`, `heightDamage(h)`, the baseline, the caps and the behaviour below the
target. A tower-targeting test checks that a high tower picks up an attacker at 20 blocks that a
ground tower ignores, and that a ground tower's pick is unchanged.

---

## 3. The castle recording

### 3.1 First, in the game: count only the blocks in the attackers' way

`defenceParts` counts a built non-tower block **only if it's within 3 blocks of the natural ground
under it**. Those are the blocks an attacker has to get through. Roofs, upper floors and spires
count nothing, and towers keep their full value wherever they stand.

Walls in the existing towns are no higher than 3, so every town on the map keeps its value. The map
rerun in §2.5 checks that as well. The rule is a pure function with a stubbed `getBlock`, tested
directly. It runs once per night plan, so it doesn't matter for performance.

### 3.2 The palette: your call

The photo reads as white stone, dark slate roofs, a few green copper turrets, and a red-brick
gatehouse. With today's blocks, the castle would be grey brick with plated iron roofs. It would
still be recognisable by its outline, but it wouldn't be *that* castle.

**My recommendation: add five decorative blocks.** They are painted in `atlas.js` like every other
tile, so there's nothing to download:

| Block | Looks | Recipe | Hardness | Value |
|---|---|---|---|---|
| `ashlar` | pale limestone blocks | 1 cobble → 1 | as cobble (1.1) | as cobble |
| `slate` | dark blue-grey roof tiles | 1 cobble → 1 | as cobble | as cobble |
| `copper_roof` | verdigris green | 1 cobble + 1 iron → 4 | as cobble | as cobble |
| `brick` | red-orange brick | 1 cobble → 1 | as cobble | as cobble |
| `window` | dark glass in a pale frame | 1 cobble + 1 sand → 2 | as planks | as planks |

They are **weaker than a stone wall** (hardness 1.1 against 1.8), so they're never the better wall.
They sit in a "Decor" group in the Build panel. Players gain building variety, and the deployed
world looks like the photo.

The alternative is today's blocks only (§6).

### 3.3 The site: a seed with a rock under it

The plaza is clamped to height 4–14 and blends into the terrain around it. A castle "on a rock"
therefore needs a seed where the plaza is high and the land falls away around it.

`tools/autoplay/castle/seeds.mjs` scans a few thousand seeds with the generator in Node (it's pure
and deterministic). It scores each seed on:

- the plaza's height above the land 30–50 blocks out: the drop the photo has
- no taller mountain looming within 60 blocks
- stone and iron ore near the surface, 25–45 blocks out, for a quarry
- trees within 40 blocks
- dry land where the castle stands

The best three are rendered from the photo's angle, and I pick one. The world is size 192, like the
default, unless the site needs 256.

### 3.4 The blueprint: the photo, in parts

`tools/autoplay/castle/blueprint.js` is pure and unit-tested. It builds a voxel model from
parameterised parts, keyed to the photo from left to right:

| Part (photo) | In blocks (about half scale) | Blocks |
|---|---|---|
| **Palas**, the main hall: tall block, rows of arched windows, steep dark roof, stepped gable at the west end | 20 × 8, walls 14 high, gabled roof with dormers | ~950 |
| **The tall tower** at the back left: slim, round, a gallery near the top, a spire with a finial | ring r = 2, 28 high, gallery, spire | ~380 |
| **The stair tower** in front of the Palas, with a pointed dark spire | 3 × 3 ring, 20 high, spire | ~175 |
| **Palas corner turrets** with pointed roofs | 2, on the eaves | ~120 |
| **The connecting wing** in the middle: lower, with green-roofed turrets | 12 × 6, 9 high | ~350 |
| **The square tower** on the right: tall, arched belfry windows, crenellated gallery, pyramid roof, stair turret | 5 × 5, 22 high | ~390 |
| **Gatehouse** at the far right: red brick, round crenellated corner tower | 8 × 6, 7 high, tower r = 1.5 | ~300 |
| **Curtain wall** with battlements around the courtyard (the Town Center is inside), and the gate arch | ~60 blocks of wall, 5 high | ~330 |
| **The rock**: a retaining face of cobble on the downhill side | where the site needs it | ~150 |
| **Total** | | **~3,100** |

Windows are `window` blocks (or holes, if we use today's palette). Roofs step at 1:1. Spires are
square rings that shrink to a finial.

A `scale` knob shrinks everything together. I'll set it from the bill of materials, so that the
build fits in about **12–14 in-game days** (§3.6). If the numbers say 3,100 is too many, the
castle is scaled down, not simplified part by part.

**Preview before any gameplay.** A lab scenario writes the blueprint straight into the chosen world,
which only a lab can do, and screenshots it from the photo's viewpoint. The result is
`recordings/castle10/compare.jpg`, with the photo and the render side by side. I'll adjust the
proportions until the silhouette matches.

**The photo isn't in the video.** It's someone's photograph, so it's only used in that local
comparison image, unless you tell me you have the rights (§6).

### 3.5 Towers around the castle, and up high

There are about 20 archery towers, placed at blueprint-marked spots. Each is the best tier the
stock pays for, and the bot upgrades later, as in iteration 9's logic:

- the curtain wall's corners (4) and either side of the gate (2)
- the Palas eaves corners (4)
- the tall tower's gallery (2)
- the square tower's crenellated top (4)
- the gatehouse tower (1)
- the terrace on the downhill face (3)

Most of these stand 10–25 blocks above the approach, so the §2 bonus is close to its cap. A few
cannon or mortar towers go on the low bastions for brutes and sappers. Archers stand on the curtain
wall. At night, the bot itself fights with its best bow from the tall tower's gallery.

### 3.6 The castle bot (`tools/autoplay/bot/castle.js`, `--strategy=castle`)

It plays by input only, like every recorded game.

- **The day plan.** Each dawn it takes the blueprint's next parts in build order (below), works out
  what they cost, and then:
  1. gathers: quarry, trees, ore
  2. crafts
  3. builds, from the aerial view
  4. keeps a patching stock
- **The build order** is also the order a real castle goes up:
  1. the curtain wall and gate, with the first towers on it (defence first, since nights start on
     day 1)
  2. the Palas's lower storeys
  3. the towers
  4. the upper storeys
  5. the roofs and spires
  6. the remaining high towers

  Each part is a chapter in the video.
- **A new skill, `skills.aerialPlace(cell, item)`:**
  1. From Babylon's camera matrices, read through the read-only view, work out where on screen the
     centre of a supporting face is.
  2. Move the mouse there, wait a frame, and check that the game's highlighted face is the intended
     one.
  3. Click.

  If the face is hidden, it turns the aerial camera, and as a last resort falls back to first person
  (`goPlace`). Overhangs such as eaves and the gallery are built from side faces, which a pitch of
  about 45° shows. The pace is about 3 blocks a second, which looks human and keeps the log
  readable.
- **Camera.** Between batches, the aerial camera slowly orbits the part being built at about 35°
  pitch. Sped up, that is the time-lapse of the castle rising.
- **Gathering** reuses the quarry, tree and ore skills. The quarry tunnels into a hillside out of
  the castle's shot.
- **Nights** reuse FullStrategy: fight, patch breaches in the curtain wall, place troops with gold.
  The one difference is that the post is the tall tower's gallery.
- **Log.** Every activity is logged (`activity`: mining, walking, building:<part>, crafting,
  night-fight, night-quiet, placing-tower). The edit needs this.

**Checkpoints and resume.** The harness saves the world at each dawn (a generalised `--save-town`).
If Chrome crashes three hours in, `--resume=<dir>` starts from the last dawn and records a new
segment, which the edit joins across the gap.

**The budget.** Roughly 13–15 in-game days at about 13 minutes each, so **about 3–3.5 hours of
recorded play**, which is about 17–20 GB of WebM at the current 1080p settings. There are 405 GB
free.

### 3.7 Rehearse, then record

1. **Phase labs.** Each chapter runs from a saved dawn in a lab scenario (`castle:<part>`): 5–15
   minutes each, fixing the bot until each part builds cleanly.
2. **One full unrecorded rehearsal.** Nights stack up, so only a full game shows whether the castle
   survives nights 10–15 without losing a life. The target is **no lives lost**. Castle walls should
   make that easier than iteration 9's town, but it's measured, not assumed. If nights still break
   it, I'll size the castle down (fewer days) before touching the game's balance.
3. **The recorded run.**

That is **about 7–9 hours of machine time** in all, most of it unattended.

### 3.8 The edit: 30 minutes (`tools/autoplay/edit.mjs`)

This is a new script; `short.mjs` is yours and stays as it is.

- **A speed map from the log.** Each stretch of the recording gets a class:

  | Class | Examples | Speed |
  |---|---|---|
  | **interesting** | the new world, the first seconds of each new part, towers going up, the first attackers of each night, big volleys, sappers blowing, the finished castle, the last night | **1×** |
  | **boring** | mining, walking, crafting, long runs of wall, quiet stretches of night | **4×–32×** |

  The boring speeds are solved so the total comes to **30:00 ± 10 s**. The map is written to
  `edit.json`, which you can edit, so a re-cut is one command.
- **Sound on sped-up parts.** Pitch-corrected 16× audio sounds broken. Instead, a sped-up stretch
  plays real-time audio from within that stretch, with 0.3 s fades. You hear the actual hammer
  taps and ambience, not a chipmunk.
- **On screen:**
  - a small "▶▶ 8×" badge while a stretch is sped up
  - a caption at each chapter ("Day 4 · the Palas walls"), in the font `short.mjs` uses
  - chapter marks in the MP4, plus `chapters.txt`
- **The ending.** The bot flies an orbit around the finished castle at golden hour, then the last
  night plays at 1×: attackers cut down on the approach, and the curtain wall barely touched.
- **Output:** `recordings/<run>/castle.mp4`, 1920×1080, 30 fps, x264 `slow -crf 18 -tune animation`
  as in iteration 9, with a contact sheet.

### 3.9 The export, and the world you'll deploy

- **Export.** At the end, in daylight, the bot presses P and clicks **Export world**. By then dawn
  has restored all night damage, and night damage is never saved anyway. The harness catches the
  download as `recordings/<run>/castle.world.json`. I won't put it in `worlds/` or commit it; you
  said you'll commit it on a branch.
- **Checks on the file:**
  - it parses with `parseWorld`
  - it loads in the game, and screenshots match the video's last frame
  - I report its size raw and compressed
- **Because you'll deploy it**, I'll also run the load benchmark and the night benchmark with the
  castle world, on the desktop and mobile (4× CPU) profiles. Spec: first playable frame in 2–3 s,
  4 s at most; entry-level phones keep their frame rate.
- **If your branch makes it the *default* world**:
  - replace `worlds/default.world.json`
  - delete or change the test at `tests/worldfile.test.js:64`
  - check the 50 KB budget in `check-budget.mjs`

  I'll report whether it fits the budget. The exported file carries the game as it ended: day about
  14, night level about 14, and the bot's inventory. A new player would start there. You can also
  have a **fresh-start copy** (§6).

---

## 4. Order of work

1. **The sword** (§1): sweep, fix, audit and golden table, unit tests.
2. **Height** (§2): the rule, damage, targeting, the range ring, tests.
3. **The wall count** (§3.1), then **one map run** covering both: `t8-high` and the unchanged towns.
   Tune.
4. **Decorative blocks** (§3.2), if you want them.
5. **Site and blueprint** (§3.3–3.4): seed scan, blueprint, preview against the photo.
6. **The castle bot** (§3.5–3.6): `aerialPlace`, the day plan, phase labs.
7. **Full rehearsal**, then the **recorded run** (§3.7).
8. **The edit** (§3.8), **the export**, and the world checks (§3.9).
9. `npm run check`, `npm run build` budgets, load benchmark, next_10.

Steps 1–4 are the game changes and are useful on their own. Steps 5–8 are the video.

## 5. How I'll verify it

- **Sword**: the sweep sheets before and after the fix. The audit passes, and fails if I turn any
  item by 90° in a scratch edit, which proves the check can catch it.
- **Height**: unit tests, the map (`t8-high` +1–2 nights, other towns unchanged), and a lab clip of
  a high tower and a ground tower firing at the same approach.
- **Wall count**: a unit test, plus the defence value of the castle world before and after.
- **Video**: `castle.mp4` is 30:00 ± 10 s with no gaps, the castle is recognisable next to the photo
  in `compare.jpg`, and no lives are lost.
- **Export**: it parses, loads, matches the last frame, and passes the load and frame-rate spec on
  both profiles.
- `npm run check` stays green (210 tests now), and every build budget passes.

## 6. Choices I made that you may want to override

Answer in `ai/prompt_10.md`; I'll re-read it before starting.

1. **Where you saw the sword off** (§0.1), if you remember. It saves the sweep.
2. **Who gets the height bonus** (§2.3). Default: every tower, archers, raiders, and damage for the
   player's bow. Alternative: arrow-family towers only, as the prompt names.
3. **How strong** (§2.1–2.2). Default: reach √(1 + h/R₀) capped at 1.5×, damage up to +25%.
   Alternatives: full-strength physics (reach √(1 + 2h/R₀), so 8 blocks up is +41% instead of
   +22%), or gentler.
4. **The wall count** (§3.1): only blocks within 3 of the ground count toward the night. I think the
   castle needs this. Without it, the video would show sappers levelling the castle every night.
5. **Decorative blocks** (§3.2). Default: add the five, so the castle looks like the photo.
   Alternative: today's palette, a grey castle recognisable by its outline.
6. **Castle size**: about 3,000 blocks at about half scale, in 13–15 days (§3.4, §3.6). A bigger
   castle means more days and harder nights. At 25+ days, it would probably lose.
7. **The photo stays out of the video** (§3.4) unless you have the rights to it.
8. **The export** is the game as it ended, as you asked (§3.9). Default: I also make a
   **fresh-start copy** (day 1, night level 1, starting inventory, same castle), so a new player
   deployed into it isn't dropped into night 14. Say if you only want the one file.
9. **The world's name**: "Castle on the Rock", unless you give me one.
10. **I go straight from the blueprint preview to the recording**, without stopping for your OK on
    the design. If you'd rather approve `compare.jpg` first, say so. It adds a round trip, but it
    could save a 3-hour re-record.
