# Plan 10: a sword that stays put, towers that like high ground, and a castle on a rock

Answers `ai/prompt_10.md`. Nothing below is implemented yet.

*Updated after your Q&A in the prompt:*

- *"always 90° off" pinned the sword down: §0.1 and §1 are rewritten with the cause, measured*
- *"one world export, the castle as the starting point" changed §3.9 and §6*

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

### 0.1 The sword: the flat of the blade leads the swing, in every tier

"Always" means it's the pose, not a passing frame. I rebuilt the view model's chain of transforms
(the item's pose, then the hand, the arm and the swing's offsets) with Babylon's maths in Node.
Then I measured which way the blade's tip moves during each slash, against the blade's edge and
its flat:

| Sword (motion) | tip's motion vs. the edge (should be ~0°) | vs. the flat's normal (should be ~90°) |
|---|---|---|
| wooden (`swing`) | 51–70° | 37–42° |
| stone (`swing_heavy`) | 69–72° | 25–43° |
| iron (`swing_flourish`) | 63–81° | 33–40° |

At rest, the flat faces you: its normal is 14° off the view direction. Every slash is mostly a
chop forward and down, so **the flat of the blade leads**, like a slap. Each sword needs a quarter
turn about its own length.

It affects all three tiers, and the troops' `sword` when you control a swordsman. The wooden one is
simply the sword you hold most.

**Why it came back.** It's the pickaxe's fault again. In your commit `a659d8c`, the pickaxe head lay
across the swing, and you rolled it a quarter turn about its shaft. In iteration 8, I chose the
sword poses for how the blade looks at rest ("canted across the view, so you see the blade"). That
turns the flat toward you, and nothing checked the pose against the direction of the swing. The
showcase sheets I checked first couldn't catch it either: a still frame doesn't show which face
leads.

**The other weapons, measured the same way:**

- **Pickaxe**: its chop moves 65° off the head's side normal, so it swings mostly within the head's
  plane, as your fix intended. The point leads within 46–58°. That's acceptable, and the check in
  §1.3 will hold it there.
- **Bows**: the string sits on the **far** side of the stave, farther from your eye than the
  grip, and the draw moves it farther still. The bow looks held back to front: a half turn, not a
  quarter. It's thin, so it's easy to miss (`sheet-bows.jpg` shows the string beside the stave). I'll
  confirm it in the browser before changing it.
- **Musket**: the barrel runs along the view. Fine.
- **Third person**: in `sheet-trail.jpg`, the blade is edge-on from behind during a forward chop,
  which is right. The browser check measures it (§1.3).

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
`make-default-world.mjs`. Both matter, because your branch makes the castle the starting point (§3.9).

---

## 1. Issue 1: the sword, and a check that stops it coming back

### 1.1 Turn the swords

- **A roll about the blade's own axis.** Each sword pose gets a `roll`, applied before the pose's
  tilt. A plain `ry`, as the pickaxe pose uses, would turn about the wrong axis once the pose
  already has an x or z tilt.
- **The target.** At the impact point of each tier's slash, the tip moves **within 20° of the
  edge**.
- **At rest, a three-quarter view** (a roll of 60–90°, set from the contact sheet), so the blade
  doesn't read as a stick. If that isn't enough on its own, the wind-up turns the wrist the rest of
  the way, which is what a real swing does.
- **What rides on the blade:**
  - the iron sword's mirrored backhand leads with the other edge, which is correct
  - the gleam is parented to the blade, so it rolls with it; I'll check it still lands on a face
    you can see
  - the trail is built along the blade's axis, so the roll doesn't change it
- **The troops' `sword`** gets the same roll, for when you control a swordsman. The third-person
  pose stays as it is unless the check says otherwise.

### 1.2 The rest of the weapons

- **Bows**: I'll confirm the half turn in the browser, then fix it so the string is between the
  stave and your eye and the draw pulls toward you. The nocked arrow must point along your aim.
  This applies to all three tiers.
- **Pickaxe and musket**: no change. Their current poses become the reference.
- **A sweep sheet** showing every holder with its items, at rest and at each motion's key moments:
  - you, in first person, third person and the aerial view
  - a troop you control
  - troops and attackers in third person
  - arrows, bolts and bullets in flight

  You get one picture of everything, before and after.

### 1.3 Make it fail loudly next time

- **A unit test in `npm run check`**, with no browser needed:
  - The pose tables and motion curves move out of `viewModel.js` into a pure module,
    `src/game/handPose.js`, which the view model imports.
  - The test repeats the calculation above for every weapon: a sword's edge leads its slash within
    20°, the pickaxe chops within its head's plane, a bow's string sits between the stave and the
    eye, and the musket's barrel points along the view.
  - **Today's swords fail it by 30–60°**, so it provably catches this bug.
- **Unit tests on the tables and meshes:**
  - every node in `items.glb` has an **explicit** pose in both pose tables. Today, a missing entry
    silently falls back to the plain sword's or bow's pose
  - tiers of a family are posed within 0.1 rad of each other
  - the mesh convention (long axis +Y, edges ±X, bow string +Z) holds in `items.glb`, read from the
    GLB, so a rebuilt mesh that comes out turned fails
- **A browser check for what the pure test can't see** (`node tools/autoplay/showcase.mjs --audit`,
  also `npm run check:poses`, about 1 minute). This covers third person, where poses depend on the
  skeleton's hand, and arrows in flight (within 10° of their velocity). It compares the results
  with a checked-in table (`tools/autoplay/poses.golden.json`) with a ±15° tolerance, and it runs
  every iteration, reported in next_N.

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

### 3.9 The export: one file, the castle as the starting point

- **One file, exactly as the game ended** (your Q&A). There's no fresh-start copy, and nothing in
  `worlds/` changes on main.
- **Where you'll spawn.** `player.pos` in the file is where a new player appears. So before the
  export, the bot walks to the courtyard beside the Town Center, and doesn't export from a quarry
  tunnel.
- **Export.** In daylight, the bot presses P and clicks **Export world**. By then, dawn has restored
  all night damage, and night damage is never saved anyway. The harness catches the download as
  `recordings/<run>/castle.world.json`, for you to commit on your branch.
- **Trying your deployment before you make it.** In a scratch copy of the repo, outside this
  checkout, the file replaces `worlds/default.world.json`. I then build it and check:
  - **Play** starts in the castle, and it looks like the video's last frame
  - the load benchmark (median of 5) on the desktop and mobile (4× CPU) profiles: first playable
    frame in 2–3 s, 4 s at most
  - the night benchmark inside the castle, on both profiles
  - `check-budget.mjs`: the default world is allowed 50 KB compressed. I expect the file to be
    close to that, and I'll report the exact size
- **What your branch needs:**
  1. Replace `worlds/default.world.json` with the file.
  2. Delete the test at `tests/worldfile.test.js:64`, which checks the default world against
     `make-default-world.mjs`, as `docs/world-format.md` says to.
  3. If the file is over 50 KB compressed, raise that line in `check-budget.mjs`. I'll say by how
     much.
- **What a player sees in that deployment:**
  - They start where the game ended: day ~14, the same night level and lives, and the bot's
    inventory.
  - **There's no opening raid.** It only plays on day 1 at night level 1 (`opening.js:28`), so the
    first dusk brings night ~14 against the castle.
  - An autosave of the old valley still continues the valley, because the save holds the whole
    world.
  - Best scores are kept under `default`, so a player's best from the valley carries over to the
    castle.

---

## 4. Order of work

1. **The sword** (§1): the pure pose module and its test (it fails first), roll the swords, confirm
   and fix the bows, the sweep sheet, the browser check.
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

- **Sword**: the pose test fails on today's poses and passes after. The browser check passes, and
  fails if I turn any item by 90° in a scratch edit. The sweep sheets before and after.
- **Height**: unit tests, the map (`t8-high` +1–2 nights, other towns unchanged), and a lab clip of
  a high tower and a ground tower firing at the same approach.
- **Wall count**: a unit test, plus the defence value of the castle world before and after.
- **Video**: `castle.mp4` is 30:00 ± 10 s with no gaps, the castle is recognisable next to the photo
  in `compare.jpg`, and no lives are lost.
- **Export**: it parses, and as the default world in a scratch build it loads into the castle and
  meets the load and frame-rate spec on both profiles.
- `npm run check` stays green (210 tests now), and every build budget passes.

## 6. Choices I made that you may want to override

Answer in `ai/prompt_10.md`; I'll re-read it before starting. The Q&A already settled where the
sword is off (always: §0.1) and the export (one file, as it ended: §3.9).

1. **Who gets the height bonus** (§2.3). Default: every tower, archers, raiders, and damage for the
   player's bow. Alternative: arrow-family towers only, as the prompt names.
2. **How strong** (§2.1–2.2). Default: reach √(1 + h/R₀) capped at 1.5×, damage up to +25%.
   Alternatives: full-strength physics (reach √(1 + 2h/R₀), so 8 blocks up is +41% instead of
   +22%), or gentler.
3. **The wall count** (§3.1): only blocks within 3 of the ground count toward the night. I think the
   castle needs this. Without it, the video would show sappers levelling the castle every night.
4. **Decorative blocks** (§3.2). Default: add the five, so the castle looks like the photo.
   Alternative: today's palette, a grey castle recognisable by its outline.
5. **Castle size**: about 3,000 blocks at about half scale, in 13–15 days (§3.4, §3.6). A bigger
   castle means more days and harder nights. At 25+ days, it would probably lose.
6. **The photo stays out of the video** (§3.4) unless you have the rights to it.
7. **The bows' half turn** (§0.1): I'll fix it once the browser confirms it. Say if you'd rather I
   left the bows alone this iteration.
8. **The world's name**: "Castle on the Rock", unless you give me one.
9. **I go straight from the blueprint preview to the recording**, without stopping for your OK on
    the design. If you'd rather approve `compare.jpg` first, say so. It adds a round trip, but it
    could save a 3-hour re-record.
