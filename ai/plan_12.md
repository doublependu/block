# Plan 12: a version tag, fire mages, ice, and an ice palace

Answers `ai/prompt_12.md`. Nothing below is implemented yet.

*Updated after your answer in the chat:*

- *The palace is about twice iteration 10's castle: ~6,160 blocks against 3,036 (§6.2)*
- *Both floors have very high ceilings: 12 clear on each, and up to 25 under the roof (§6.2)*
- *The staircase is built in detail (new §6.3)*
- *6,000 blocks take about 23 days in survival, and nights past 15 can't be held as the game is
  balanced today (§0.6). So the plan now changes late nights (new §5.4), and that is the first
  question for you (§9)*
- *How the bot builds twice as much at a faster pace is in the new §6.7. With a run of over 5
  hours, I now stop for your OK on the preview before recording (§9)*

The prompt asks for five things:

1. **feature 1**: the game's version, `v.<first 4 characters of the deployed commit>`, in an unused
   corner
2. **feature 2**: a new attacker that throws a fireball and blows up a volume of blocks, with the
   fireball from `~/Repos/dp-sakura-crossing` as the reference
3. **feature 3**: a new attack, the ice arrow. It freezes its target for a while, and a frozen
   target takes more damage
4. **feature 4**: a few ice blocks that freeze attackers who touch them. Defenders are immune
5. **recording**: a 30-minute survival video on a Large (256) map. The player builds a white
   frozen castle like `ref/castle_2.png` and `ref/castle_2_1.png`:
   - two levels, joined by a double curved staircase
   - archers on the second level, shooting from openings in the walls
   - every defence in the game around the castle and up high, so it feels very safe
   - the boring parts sped up, with building shown in first person, third person and from the air
   - the final world exported with the game's own Export world

The recording depends on features 2–4: the castle is built from the ice blocks, and its defenders
use ice arrows against fire mages. So the game changes come first, then the balance check, then the
video.

---

## 0. What I found before planning

### 0.1 The corners (feature 1)

I took screenshots of the running game (`recordings/plan12/`):

| Screen | Top left | Top right | Bottom left | Bottom right |
|---|---|---|---|---|
| desktop, 1280×720 | view mode | View, Role, menu | your health | **free** |
| phone, landscape 844×390 | view mode | View, Role, menu | stick, health | touch buttons, with a **free** strip below them |
| phone, portrait 390×844 | view mode, buttons | buttons | stick, health | touch buttons, with a **free** strip between the jump button and the hotbar |
| menu | | | | **free** |

Bottom right is the only corner that is free on every screen. On phones, the label has to sit in
the strip below the touch buttons.

**Found along the way:** in landscape on a phone, the hotbar covers most of the health chip
("Builder (autopilot) · Wo…" in `phone-land-game.png`). This is an existing bug, and the fix is
small (§9, question 13).

**The commit at build time:** `npm run deploy` builds on your machine, so `git rev-parse HEAD` sees
the checkout. Cloudflare's own git builds set `WORKERS_CI_COMMIT_SHA` (Workers) or
`CF_PAGES_COMMIT_SHA` (Pages) instead. The build should read those first.

### 0.2 Explosions today (feature 2)

- `Demolition.explode` (`siege.js:233`) only destroys **built** blocks, the edits. It's used by
  sapper kegs and the opening raid's finale.
- Everything it destroys goes into the night damage overlay, which dawn rebuilds.
- It hurts units on both sides.
- Sappers already dig natural terrain at night, so the nav already copes with the ground changing
  during a night.

### 0.3 The fireball reference

`dp-sakura-crossing/src/world/cinderfall.js` is three.js and cel-shaded, and this game is Babylon
and voxel. So the port takes its **choreography and numbers**, not its code. The reference has
seven beats:

1. **launch**
2. **arc:** a lob 3.4 m high at mid-span, with a flight time of at least 0.95 s
3. **an arrival you see coming:** the ball heats up late, swelling from 1.15× to 2.1× its radius
4. **the fireball:** three offset lumps in red, orange and cream. They grow fast (ease-out
   1 − (1 − f)^2.6), hold, then go
5. **a shock ring**
6. **debris**
7. **a scorch mark that fades over 8 s**

Embers walk a four-stop colour ramp. The reference deliberately leaves out a dynamic light: adding
a light recompiles every material. That's just as true in Babylon.

### 0.4 Freezing and touching (features 3 and 4)

- **Every hit already goes through one place,** `UnitManager.damage` (`units.js:284`). A "frozen
  takes more" multiplier fits there.
- **Spikes are the model for touch.** Spikes check the block a unit stands in
  (`_contactDamage`). A solid ice block can't be stood in, so "touch" has to mean standing on it,
  pressing against it, or hitting it.
- **The hit flash** already swaps one shared material onto a character (`library.js:106`). A frost
  material can work the same way.

### 0.5 Archers at wall openings (recording)

**Line of sight.** An archer checks line of sight from its eye, 1.5 above its feet.

- **Standing one block behind a window** with a sill, the archer can only see a target whose drop
  is under a third of its distance. From the second floor (13 up, so the eye is about 14.5 up),
  that means **nothing closer than about 40 blocks**. The attackers at the foot of the wall are out
  of sight.
- **Standing *in* a floor-level opening**, the archer can see down as steep as 3:1. It can hit
  anything **more than about 4.5 blocks out**.

So the openings are floor-level gaps, and the archer stands in them.

**Wandering.** Placed defenders wander near their post: 5 blocks by day, 3 at night
(`DEFENDER_IDLE`). An archer on the second floor would wander off its opening, and could walk down
the stairs. Archers need to hold their post up there (§6.5).

### 0.6 What iteration 10 taught the recording

- **Late nights get out of hand, and the defence isn't the main reason.** Past the cap of 140
  attackers, the extra ones come back as HP *and* damage. I worked out each night's wave with the
  game's own functions (`streamCount`, `adaptiveBudget`) for iteration 10's castle (defence 905).
  They match next_10's lab figure for night 17 (×2.02):

  | Night | 12 | 15 | 17 | 20 | 22 | 24 |
  |---|---|---|---|---|---|---|
  | attackers | 170 | 231 | 291 | 425 | 556 | 738 |
  | HP and damage | ×1.21 | ×1.65 | ×2.08 | ×3.03 | ×3.97 | ×5.27 |

  - Most of it is the grunt stream, which grows ×1.18 every night. **With no defence at all,**
    night 20 is already ×2.6 and night 25 ×5.6.
  - The castle's defence adds only about 60 attackers.
  - So next_10 §8.1's options (lower `WAVE_ADAPTIVE.max`) would barely help. That section had the
    cause wrong.
- **What this means for 6,000 blocks:** iteration 10 built about 160 blocks a day. Even at a much
  faster pace (§6.7), 6,000 blocks take **about 23 days**, so the video runs to about night 24.
  - Iteration 10's nights at ×2 were already a coin flip. At ×3–5, I don't expect a castle to hold,
    or reloads to get through.
  - So "very safe" at 6,000 blocks **needs the late-night change in §5.4**. It's the first question
    in §9.
- **Gaps:** the aerial view left 64 cells it couldn't see a face of. This time, a final pass on foot
  fills them.
- **Reloads:** the video was stitched from saves after lost nights. The target this time is **no
  lives lost** (§6.8).
- **Map size:** the plaza is at height 7 on every seed. Snow only covers ground above 36
  (`terrain_v1.js:88`). So a "frozen" site means snowy peaks in the view, not a snowy plaza.

### 0.7 The references

Both images show Elsa's ice palace from Disney's *Frozen*: one a film still, the other a
merchandise model. A voxel castle inspired by them is fine. As in iteration 10, **the images stay
out of the video** and are used only in the local comparison picture. The world's name doesn't use
"Frozen" or "Elsa".

### 0.8 Budgets

The current build passes with plenty of room:

- game code: 353.9 KB of 550
- default world: 1.7 KB of 50
- 387.5 KB in all to the first playable frame

Character models are lazy-loaded per model (`library.js`), so a new attacker model costs nothing at
startup.

---

## 1. Feature 1: the version tag

- **At build time:** `vite.config.js` defines `__COMMIT__`. It reads, in order:
  1. `WORKERS_CI_COMMIT_SHA`
  2. `CF_PAGES_COMMIT_SHA`
  3. `git rev-parse HEAD`
  4. empty
- **The text:** `v.` and the first four characters of the commit, for example **`v.5ab6`** for
  today's HEAD. With no commit it shows `v.dev`. A tooltip (desktop) holds the full hash and the
  build date.
  - A build with uncommitted changes shows HEAD's hash. The template has no dirty mark, so I'm not
    adding one.
- **Where:** the bottom right, on the menu and in the game.
  - 11 px, dim, can't be clicked or selected
  - on touch screens, in the strip below the touch buttons (§0.1)
  - it's in the recorded video too
- **Checks:**
  - a unit test for the text
  - a check in the showcase that the label's box overlaps no visible HUD element, at all three
    screen sizes in §0.1
  - the menu's size budget (+~0.1 KB)

---

## 2. Feature 2: the fire mage

### 2.1 Who it is

| | Fire mage (`pyro`) |
|---|---|
| Looks | hooded robe in ember orange and soot, glowing eyes; holds a `fire_staff` |
| Model | `attacker_pyro.glb`, built by `make_characters.py` like the others; one new `cast` clip (staff raised over 1.2 s); `fire_staff` added to `items.glb` |
| HP / speed | 70 / 3.0 |
| Range | 14, flat. The high-ground rule (`reachAt`) works the other way for it: lobbing **uphill** cuts its reach. A target 14 above it is out of reach |
| Cast | 1.2 s wind-up: the staff glows and a ball gathers at its tip. Then the lob. 7 s between casts |
| Goes for | towers, then walls in its way to the Town Center, like a wrecker. It stops at range instead of walking up |
| Self-defence | if a defender or the builder comes within 5, it casts at them |
| First night | 7 (sappers come on 5) |
| Stream | 1 a night, plus 0.35 per night after (`WAVE_STREAMS`) |

**Why these numbers:**

- 14 is under a ground arrow tower's 16, and well under a high tower's 22–24. So towers up high
  are safe from fire mages, and they outrange them. Iteration 10's high-ground rule does the work.
- The wind-up is the counterplay: kill or freeze the mage before it throws.
- It's not in the opening raid.

### 2.2 The blast

- **What it destroys:** every breakable block within **2.0** of the impact, about 33 cells at
  most: built blocks and natural ground (crater), but not the plaza, bedrock or the Town Center.
- **When it comes back:** the destroyed blocks go into the night damage overlay, so dawn rebuilds
  them like every other night's damage.
- **Ice melts:** ice blocks (§4) within 3.0 go too. Fire mages are the answer to ice (§5.1).
- **Damage:**
  - 45 to defenders and the builder within 3, less toward the edge
  - 150 to the Town Center within 4
  - attackers aren't hurt, since it's their spell (§9, question 3)
- **Where it goes off:** the ball flies along its arc and goes off at the first solid block or unit
  it touches. A wall in the way gets the blast.
- **Pacing:** it's applied through `Demolition`'s queue, 8 blocks a tick as now, so no frame
  remeshes a whole crater.
- **Shake:** the camera shakes by distance, through the existing `onExplosion`.

### 2.3 The effect: the reference's beats, in this game's blocky style

`src/game/fireball.js` keeps the reference's numbers in one table, `C`, as the reference does. A
cast stores rolls, not metres, so the effect can be tuned while it plays.

| Beat | Reference | Here |
|---|---|---|
| wind-up | the dragon's mouth | a ball gathers at the staff's tip for 1.2 s |
| arc | lob 3.4 m at mid-span, flattened top (0.85); at least 0.95 s in flight; 13 m/s | the same numbers |
| heating up | two shells round the cinder swell from 1.15× to 2.1× radius, late (curve 1.6) | the same: two lumpy low-poly shells round a dark core |
| trail | 34 flame "tongues" over 7 m, on one instanced quad | the same, over about 4 m (the shots are shorter), one draw call |
| **fireball** | 3 lumps, offset rather than nested: red 0.22→0.94 over 0.9 s, orange 0.18→0.80 over 0.66 s, cream 0.12→0.52 over 0.4 s; hold, then go; lifted 0.28 × size into a dome | the same lumps, timings, offsets and colours (the colours are already the game's fire); size scaled to the 2.0 blast |
| tongues | 16 thrown flat out of the crater | the same |
| ring | 7 m over 0.6 s | a flat ring on the ground, scaled to the blast |
| debris | 10 chunks, lie for 1.8 s, then sink | the destroyed blocks thrown as cubes in their own colours (`BLOCK_DUST`) |
| embers | 190 in the burst, four-stop ramp, rising | the existing particle pool with the same ramp, about 120 (scaled by the quality tier) |
| mark | a scorch disc, fading over 8 s | the same, on the crater floor |
| airburst | when there's no ground: no ring, mark or chunks | a ball that hits a unit or a wall high up |
| left out | the dynamic light, volumetric trail, PBR rock | left out for the same reasons. The glow is drawn: unlit flat colours |

**Cost:**

- All shells share one lumpy-sphere mesh with thin instances and per-instance colour. Tongues,
  ring and marks are one draw call each. That's **at most four new draw calls**, with frozen unlit
  materials and no lights.
- It's measured on the mobile profile (4× CPU throttle) during a volley of three fireballs. Target:
  no frame over 33 ms caused by it.

**Sound:** new synth recipes (`sounds.js`) for the wind-up crackle, the whoosh in flight and the
blast (a heavier `explosion`). Each is levelled by `sound-check.mjs`, and the sounds test requires
every new event to have one.

### 2.4 In the game

- The HUD's attacker names: "Fire mage".
- The night briefing (`waves.js`): "Your ice drew fire mages: fire melts ice."
- One help line.
- A pose for `fire_staff` in both pose tables. The pose tests already fail on an item without one.

---

## 3. Feature 3: the ice arrow

### 3.1 Freezing

All of these numbers live in one `FROST` table in `balance.js`.

| | |
|---|---|
| Frozen for | 2.0 s |
| Then immune for | 3.0 s: no frozen-forever. A target can be frozen at most 40% of the time |
| While frozen | no moving, attacking or casting. A cast in progress is lost. A sapper's lit fuse keeps burning |
| Looks | animation stops; a frost material, pale blue, swapped on like the hit flash; ice glints; a shatter of white-blue cubes when it thaws |
| **Frozen takes more** | **×1.5 from every attack**, applied in `UnitManager.damage` (§9, question 4 has the other reading) |
| Shows as | blue damage numbers on a frozen target |
| Who | attackers only. Defenders and the builder are never frozen |

### 3.2 Who shoots ice arrows

- **The frost bow** (the builder's weapon, `frost_bow`). It's a weapon of its own, like the
  musket, not a fourth tier of the bow family.
  - attack `ice_arrow`, damage 14, every 0.9 s, range 30
  - costs planks 3, iron 2 and gold 1
  - in the hand, the recurve bow tinted ice-blue (`WEAPONS.tint`), so it needs no new mesh
- **The frost tower** (a new tower block, `frost_tower`). Also on its own, not a family.
  - ice arrows: range 16, damage 6, every 1.4 s
  - it picks targets that **aren't frozen or immune** first, so a frost tower spreads its freezes
  - it gets the high-ground rule like every tower
  - costs planks 6, cobble 4, iron 2 and gold 1; worth 20 to the night
  - its tile is painted in the atlas
- **The `ice_arrow` projectile:** an arrow's speed and drop, pale blue, with a short trail of frost
  sparkles. Brutes' armour treats it as an arrow (half damage), but the freeze isn't halved.
- **Sounds:** a glassy twang, an icy crack on a freeze, and a tinkle when it thaws.

Troop archers keep plain arrows (§9, question 5).

---

## 4. Feature 4: ice blocks

### 4.1 The blocks

| Block | Looks | Solid | Hardness | Recipe | Worth to the night |
|---|---|---|---|---|---|
| `snow_brick` | white packed-snow bricks, faint blue joints | yes | 0.6 | cobble 1 → 2 | 0.25 |
| `blue_ice` | deep turquoise packed ice (the references' roofs and spires) | yes | 0.6 | cobble 1 → 2 | 0.25 |
| `ice` | clear pale-blue ice with white cracks and a glassy highlight | yes | 1.8 | cobble 2 + iron 1 → 2 | 0.6 |
| `ice_spikes` | icicles from the floor, see-through like spikes | no | 0.9 | planks 1 + iron 1 → 2 | 0.6 |

- **Rendered opaque.** A see-through ice block (`alpha`) would also draw the faces between
  neighbouring ice blocks. A castle of it would multiply faces and overdraw on a phone. The ice
  *looks* glassy because of how it's painted.
- **Per cobble,** `snow_brick` and `blue_ice` hold like a stone wall (1.2 hardness a cobble), as
  iteration 10's decor blocks do. The freeze is what they add, and the night value is what it
  costs: twice a stone wall's, per cobble.
- **Where they go:** a "Frost" row in the Build panel, the item icons and the dust colours.

### 4.2 Touch

An attacker touching any of the four is frozen, exactly as by an ice arrow, immunity included. Touch
means:

- **standing on** a solid ice block, or **in** ice spikes
- **pressing against** one: the body within 0.1 of its side, at foot or head height
- **hitting** one: a melee blow or a wrecker's blow on the block

**Cost:** one table lookup by block id over at most 10 cells, per attacker, every think tick
(0.18 s). That's nothing next to the pathing. Defenders and the builder walk on ice like stone, with
no sliding.

---

## 5. Balance: measured, not assumed

### 5.1 What answers what (`WAVE_COUNTERS`)

- **A new part of the defence, `frost`**: ice blocks and frost towers. It draws **fire mages**.
- The other parts stay as they are: arrows draw brutes, cannons and walls draw sappers.
- A frost block counts toward the night by iteration 10's rule: only within 3 of the ground.

### 5.2 The map

I'll rerun iteration 10's difficulty map (`map.mjs`, every town, nights as before):

- **Existing towns:** each within **one night** of `map-10a`. The fire mage's stream (from night 7)
  makes every town's late nights harder. If a town loses more than a night, I'll thin the stream
  before anything else.
- **A new town, `t9-frost`:** `t2-mixed` with its walls rebuilt in ice and snow brick, plus two
  frost towers, at about the same cost. Target: it holds **1–2 nights longer than `t2-mixed`**. If
  it's more, I'll lower the freeze time, raise the immunity, or raise the value, in that order.
- **Lab clips** (`recordings/lab12/`):
  - a fire mage blasting a wall
  - a frozen sapper blowing up short of the wall
  - an ice-arrowed brute taking ×1.5
  - a high tower outranging a fire mage

### 5.3 Tests

- **Pure rules,** unit-tested:
  - freeze, immunity and the ×1.5
  - touch on each face, and none for defenders
  - the blast's cells: sphere, unbreakable blocks skipped, the ice radius
  - a fire mage's reach uphill
  - a frost tower's choice of target
  - the new counter
- **Data:** the new blocks, items, recipes and sounds pass the existing data tests (every item has
  a sound, an icon, a pose).

### 5.4 Late nights: needed for a 6,000-block palace (your call, §9 question 1)

**The change, in two parts:**

1. **The grunt stream** compounds up to night 12, as now. After that, it grows by night 12's step,
   about **+13 a night**, instead of ×1.18 a night.
2. **Past the cap of 140,** the extra attackers still come back as **HP**, but their **damage**
   rises at most **×1.25**.

For iteration 10's castle (defence 905), including the fire mages' stream:

| Night | 12 | 15 | 17 | 20 | 22 | 24 |
|---|---|---|---|---|---|---|
| today: HP and damage | ×1.21 | ×1.65 | ×2.08 | ×3.03 | ×3.97 | ×5.27 |
| proposed: HP | ×1.21 | ×1.54 | ×1.76 | ×2.08 | ×2.30 | ×2.52 |
| proposed: damage | ×1.21 | ×1.25 | ×1.25 | ×1.25 | ×1.25 | ×1.25 |

- **Nothing changes up to night 12.** A test checks that `planWave` is the same for nights 1–12.
  The difficulty map (to night 10), the default world and every start play as now.
- **Nights still get harder every night.** A weak town still falls. A strong castle can now hold.
  That's the "build early, then the attack catches up" design, without the wall at night 15.
- **Measured** with `--lab=siege:<save>:<night>`:
  - **iteration 10's castle** (its day-18 save, no ice) at nights 17, 20 and 24. Target: it holds
    17 every time and 20 more often than not
  - **an undefended town** at nights 15 and 20. Target: it still falls
  - **the rehearsal's palace saves** at the nights it will actually meet
- **The knobs** are the step after night 12 and the damage cap.
- **It changes the game for everyone from night 13 on,** so it's your decision. Without it, the
  plan can't promise a safe 6,000-block palace. §9 has the alternatives.

---

## 6. The recording: an ice palace

### 6.1 The site

- **A new world from seed, Large (256), survival**, started from the menu like a player.
  `run.mjs --seed` gains `--size`.
- **Choosing the seed:** `castle/seeds.mjs` gets a `--frost` rating:
  - snowy peaks (ground above 36) filling one side of the view, 60–120 blocks out, like the cliff
    behind the palace in `castle_2.png`
  - a flat footprint 34 around the plaza (the curtain stands at 26)
  - stone near the surface for a quarry
  - trees and sand in reach
- I render the best three from the approach and pick one.

### 6.2 The palace (`castle/palace.js`, pure and tested like `blueprint.js`)

**About 6,160 blocks, twice iteration 10's 3,036.** Heights are counted from the hall floor, the
first air above the plaza. The game builds nothing at y ≥ 70, which leaves 61; the great spire's
tip is at 58.

**The Town Center stands in the middle of the great hall**, its crystal the centrepiece. To reach
it, attackers have to get into the palace.

| Part | In blocks | Material | ~Blocks |
|---|---|---|---|
| **Level 1, the great hall** | 29 × 25 outside. Walls 13 high: **12 clear inside**. The main door is a gate 5 wide and 8 high, on the spawn side. Tall windows, 1 × 6 | snow brick, ice pillars at the corners and either side of the door | 1,330 |
| **The double curved staircase** | two flights of 13 steps, 4 wide, curving round the Town Center to a landing 13 up (§6.3) | ice treads, snow-brick risers, blue-ice rails | 480 |
| **A snowflake on the hall floor** | six arms of blue ice round the crystal, one block high, clear of the spawn cell and the path to the door | blue ice | 60 |
| **Level 2's floor** | 13 up: a ring 5 wide round a well, open over the crystal and the stairs | snow brick, ice edge | 430 |
| **Level 2's walls** | 12 high: **12 clear at the walls**, rising into the roof to about 25 at its peak. **24 openings** for archers, each 1 wide and 3 high with a pointed top, at floor level (§0.5) | snow brick, ice trim | 1,200 |
| **The roof** | a hip roof at 45° from 25 up, with a 1-block overhang | blue ice, white ridges | 840 |
| **The great spire** | 5 × 5, tapering from the roof's peak (about 38 up) to 58, with a snowflake finial | blue ice, ice | 230 |
| **Four corner towers** | round (radius 1.5), sharing the hall's corners, to 30 up (5 above the eaves). A balcony there holds a defence tower; spires rise to about 40 | snow brick, blue-ice spires | 1,080 |
| **Crystal spires** | slim needles on the roof's hips and over the door | ice, blue ice | 60 |
| **The curtain** | a ring about 26 out, 3 high, four gates, four bastions | an ice base course, snow brick above | 450 |
| **Total** | | | **~6,160** |

**The high ceilings, seen from inside:**

- On the hall floor, the ceiling is 12 up at the walls. Over the well, you look up past level 2
  into the roof: **about 38 from the floor to the peak**, with the crystal standing in that space.
- On level 2, the ceiling is 12 at the walls and rises to 25 under the peak.

**Rules the blueprint keeps, with a test for each:**

- **No floating blocks:** every block can be placed against one built before it, in build order.
- **The spawn cell stays open,** with a clear path from it to the door, as in iteration 10.
- **The stairs and floors are walkable** with the game's own nav (§6.3).

**Size stays at about 6,000.** The plan doesn't shrink the palace to save days. If the pace in §6.7
falls short, it takes more days.

**Preview before any gameplay:** a lab writes the palace straight into the chosen world and renders
two pictures, locally only (§0.7):

- **`recordings/palace12/compare.jpg`:** the palace from the references' angle, next to them
- **`recordings/palace12/interior.jpg`:**
  - the hall from the door, looking up
  - the staircase from below and from the landing
  - level 2 along an archers' wall

### 6.3 The staircase, in detail

**Its shape: a horseshoe, two arms round the crystal.** Two mirrored flights start either side of
the door, about 30° off its axis, at 6 to 10 out from the Town Center. They sweep 150° round it,
left and right, and meet at a landing above the back of the hall.

| Element | Detail |
|---|---|
| **Flights** | 13 treads each, one block of rise per tread. That's the step the builder and every unit already climb without jumping (autostep). Each flight is 4 wide, from 6 to 10 out from the centre; treads are about 1.6 deep along the middle |
| **Treads and risers** | treads in **ice**, each one's leading edge picked out in **blue ice**. Each tread sits on a **snow-brick riser** one block down, and the next riser stands beside the tread before it. From below, each flight is a ribbon two blocks thick, curving up through the hall with nothing under it. The bottom three treads stand on the floor |
| **Curtail** | the bottom two treads flare to 6 wide and round off at the outer end, like the first step of a grand staircase |
| **Newels** | at the foot of each flight, an ice post 3 high with a blue-ice crystal finial |
| **Rails** | on the outer edge, a blue-ice post every second tread, with ice spikes between them (see-through icicles). On the inner edge, a post every fourth tread, so you look in at the crystal as you climb |
| **Landing** | a half-round landing 9 wide and 4 deep, 13 up, joined to level 2's floor along the back wall, with a rail facing the hall |
| **Under the landing** | an arch 5 wide and 6 high, framing a passage to the back of the hall |
| **Clearance** | the floor of level 2 is cut away wherever a flight rises beneath it, leaving **at least 3 blocks of headroom over every tread** |
| **~Blocks** | 480 in all: flights ~340, landing and arch ~90, newels and rails ~50 |

**As a defence:** attackers inside the hall that climb toward the archers walk on ice and get
frozen. Defenders and the builder climb it like stone.

**Tests in `palace.js`:**

- the game's nav walks from the door to the landing up each flight
- every tread is within one block of rise of the one before it
- headroom is at least 3 everywhere on the stairs
- every block can be placed against a block built before it
- the spawn cell and the path to the door stay open

**In the video:** the stairs are built in first person, from the bottom tread up. The builder
stands on each new tread to place the next ones. Shown at 1×:

- the first tread
- the two flights meeting at the landing
- the first walk up from the hall to level 2

### 6.4 Every defence, around it and up high

| Defence | Where |
|---|---|
| arrow, crossbow, ballista towers | the four corner-tower balconies (30 up) and two at the great spire's foot (about 38 up). All at the height cap: reach 1.5× (an arrow tower 24, a ballista 31.5), +25% damage |
| cannon, mortar, bombard towers | the curtain's bastions, covering the gates |
| frost towers | either side of each gate |
| stone, iron, steel walls | the gate flanks and the bastions' cores, where grey reads as gatehouse stone |
| wooden, iron, steel gates | the curtain's four gates (steel at the main one), and the hall's door |
| spikes, iron spikes, steel spikes, ice spikes | bands on the four approaches, outside the gates; ice spikes also in the stair rails |
| ice, snow brick, blue ice | the palace and the curtain |
| archers | **12–16 of the 24 openings on level 2**. Troops count double toward the night, so not all 24. From 13 up they reach about 21.6 and hit 17% harder |
| swordsmen, gunners | swordsmen inside the gates; gunners on the curtain's bastions |
| the builder | at night, on level 2 with the frost bow |

Every defence item the game has is placed at least once. The log counts them, and next_12 lists
them.

### 6.5 One game change for it: archers hold high posts

**The rule:** a ranged defender whose post is **3 or more above the natural ground** holds its post.
It doesn't wander by day or patrol at night. It still turns and shoots.

- An archer placed in a wall opening stays in it.
- The same goes for archers on a town's wall walk, which is better for players too.

**Safety:** the cell outside an opening has no floor, so the idle walk could never pick it anyway.
A test covers both.

### 6.6 The bot: three views

`bot/palace.js` builds on iteration 10's `castle.js`: the day plan, the quarry hall, crafting and
the patching stock. What's new is that **each part is built from the view that suits it**:

| View | Builds | Why |
|---|---|---|
| **first person** | the staircase step by step, the snowflake, level 2's floor out from the landing, level 2's lower courses standing on that floor, the openings, placing each archer | indoors and close; the reach of 6 is enough |
| **third person** (`V`) | the curtain, its gates, the spike bands, the hall's lowest 5 courses from outside | long walls: you see the builder walk along laying blocks |
| **aerial** | the hall's walls above 5, level 2's walls above its lower courses, the roof, the spires, the corner towers, the towers up high | no reach limit up high |
| **on foot, last** | every cell the aerial view couldn't see a face of | no gaps this time (§0.6) |

- **Third person:** the pick ray starts at the builder's eye in both person views (noa's
  `targetedBlock`), so the first-person aiming code holds. A lab confirms it before the rehearsal.
- **Third person stays outdoors:** indoors, the camera boom would clip through the walls.

### 6.7 The pace, and how many days

**What it takes:**

| | |
|---|---|
| Blocks to place | ~6,160 palace + ~350 defences (towers, spikes, gates, walls) |
| Cobble | ~3,300 (snow brick and blue ice are two to a cobble) |
| Iron | ~280: ice (~350 blocks, ~175 iron), towers, frost towers, troops. Nights pay `ceil(night/2)` iron, about 155 over 24 nights; the rest comes from ore in the quarry |
| Gold | ~60 for tier III towers and troops. Nights pay about 165 over 24 nights |

**Days:**

- At iteration 10's pace (about 160 blocks a day), this would take about 40 days.
- **The target is 280 or more a day: about 23 days**, so about 24 nights.

**Measures to get there:**

1. **Bigger loads:** mine and craft for about 400 blocks before each building trip, against 140 in
   iteration 10. That means fewer walks and fewer camera set-ups.
2. **Low courses on foot, in third person:** walking along a wall is faster than setting up the
   aerial camera, and it suits about a third of the blocks.
3. **Bigger aerial tiles:** the palace's walls are long and straight, so one camera position covers
   8 courses and 20 blocks of wall, against 6 and 14.
4. **The quarry at its planned 40+ cobble a minute.** I'll measure iteration 10's actual rate first.
5. **Gaps filled on foot at the end,** not retried from the air for days.

**Checks:** each part lab reports blocks a day. If the pace falls short, the palace still gets
all ~6,000 blocks; it takes more days. Each 20 blocks a day less adds about 1.5 days. The
late-night change (§5.4) is what makes the extra nights holdable.

### 6.8 "Very safe", as a number

- **No lives lost.**
- **From the night the curtain closes:** the Town Center above 80%, and no attacker inside the
  hall.
- **From night 7:** fire mages mostly frozen or killed before they throw. The log counts casts
  started against casts thrown.
- **The archers** in the openings get kills, counted per archer.

### 6.9 Rehearse, then record

1. **The game changes, the map, and the late-night measurements** (§1–5).
2. **Labs for each part** from a saved dawn, until each part builds cleanly in its view and the
   pace is measured.
3. **The preview** (§6.2). **I stop here for your OK** on `compare.jpg` and `interior.jpg` (§9).
4. **One full rehearsal, not recorded.** It shows whether nights 7–24 meet §6.8.
   - **If a night is lost,** the palace gets stronger *earlier*: the curtain and frost towers sooner.
     It doesn't get smaller.
   - **If it still loses lives,** I'll stop and show you the numbers rather than stitch from reloads.
5. **The recorded run,** with dawn checkpoints as in iteration 10, for a crash, not for reloads.

**Time:**

- About 24 days of about 13 minutes each: **about 5.2 hours of play a run**, and about 30 GB of
  video a run.
- With the rehearsal, the labs and the late-night sieges, **about 20–25 hours of machine time**,
  mostly unattended.
- There are 337 GB free. Iteration 10's source recordings (about 60 GB) can go whenever you like.

### 6.10 The edit: 30 minutes

`edit.mjs`, as in iteration 10, with speeds solved to **30:00 ± 10 s**. That's 5+ hours into 30
minutes, so the speeds are higher than last time:

- **At 1×:**
  - the new world
  - the first seconds of each part
  - the staircase's first tread, the flights meeting, the first walk up to level 2
  - looking up from the hall floor into the roof
  - each archer taking its post
  - the first fire mage, the first freeze
  - the finished palace
- **Sped up:**
  - building: about 12–16×
  - mining and walking: 60× or more
- **The views mixed:** each of the three views gets at least a fifth of the building time on screen.
  Each chapter caption names its view ("Day 9 · the staircase · first person").
- **Kept from iteration 10:** the ▶▶ badge, chapter marks, `chapters.txt`, and real-time sound on
  sped-up stretches.
- **The ending:** a turn round the finished palace, a walk through the hall and up the stairs, then
  one night with its key moments at 1×:
  - fireballs falling short of the high towers
  - archers shooting from the openings
  - attackers frozen against the ice
- **Output:** `recordings/palace12/palace.mp4` (1920×1080, 30 fps), a smaller copy to share, and a
  contact sheet.

### 6.11 The export

- **How:** at the end, the bot presses P and clicks **Export world**, and the harness saves the
  download as `recordings/palace12/ice-palace.world.json`. It's format 2, a world, not a save: the
  name, seed (256), blocks mined and placed, troops, and a starting kit.
- **Size:** about 10,000 edits (about 6,500 placed and 3,500 dug). Iteration 10's 6,446 edits came
  to 9.4 KB brotli, so I expect about 15 KB, against the 50 KB budget.
- **Tried as the starting point,** in a scratch copy as before (`deploy-test.mjs`):
  - first playable frame on desktop and mobile (2–3 s, 4 at most). It's the first 256 world and the
    most edits tried as the default
  - frame rate on both profiles: in the opening raid, in a night, from the air with the whole
    palace in view, and inside the hall
  - the opening raid against the palace, recorded
- **next_12** lists what your branch needs, as next_10 did.

---

## 7. Order of work

1. **Version tag** (§1).
2. **Freeze, ice arrow, frost bow, frost tower** (§3).
3. **Ice blocks and touch** (§4).
4. **Fire mage:**
   - the rules and the blast
   - the model, clip and staff
   - the fireball effect
   - sounds and HUD text
5. **Balance** (§5.1–5.3): the map, `t9-frost`, the lab clips. Tune.
6. **Late nights** (§5.4), if you agree: the change, then the sieges on iteration 10's save.
7. **Archers hold high posts** (§6.5).
8. **Site, palace blueprint with the staircase, preview** (§6.1–6.3). **I stop for your OK.**
9. **The bot** in three views, with the part labs and the pace measured (§6.6–6.7).
10. **Rehearsal, then the recording** (§6.9).
11. **Edit, export, deploy test** (§6.10–6.11).
12. **Wrap-up:** `npm run check`, build budgets, load benchmark, then `next_12.md` and
    `itr_12.md`.

Steps 1–7 are the game and are useful on their own. Steps 8–11 are the video.

## 8. How I'll verify it

- **Version:**
  - the label reads `v.` plus four characters of HEAD
  - with each Cloudflare variable set, it uses that one
  - it overlaps nothing at the three screen sizes
- **Fire mage:**
  - unit tests (§5.3)
  - the lab clip: a crater in a wall, dawn rebuilds it
  - mobile frame times during a volley
  - a contact sheet of the fireball's beats next to the reference's
- **Ice:**
  - unit tests
  - lab clips of a freeze, the ×1.5 and a frozen sapper
  - defenders walk across ice unaffected
- **Balance:**
  - the map, existing towns within a night of iteration 10, and `t9-frost` 1–2 nights better
  - late nights: nights 1–12 unchanged (test), and the siege targets in §5.4
- **Palace:**
  - at least 6,000 blocks in the blueprint
  - 12 clear on both floors
  - the staircase tests in §6.3
  - all of it in the finished world (the log's count of placed against planned)
- **Video:**
  - 30:00 ± 10 s
  - all three views
  - the staircase and the archers at openings on screen
  - every defence placed
  - §6.8 met, with no lives lost
- **Export:**
  - a world, not a save
  - it loads as the starting point within spec
- **Tests:** `npm run check` stays green (307 tests now), and every build budget passes.

## 9. Choices I made that you may want to override

Answer in `ai/prompt_12.md`; I'll re-read it before starting.

1. **Late nights (§5.4): needed for the 6,000-block palace.** Default: from night 13, the grunt
   stream grows by a fixed step instead of ×1.18, and the damage of attackers over the cap rises at
   most ×1.25. Nothing changes up to night 12. The alternatives:
   - **Leave the balance.** The video then runs into nights at ×3–5 that I don't expect any castle
     to hold. It would show lost lives, or end in a game over before the palace is done.
   - **A smaller palace.** About 2,000 blocks fits in about 12 days, before late nights matter. That
     goes against your 6,000.
2. **The fireball digs craters** in natural ground too (§2.2), and dawn heals them. The alternative
   is built blocks only, like a sapper's keg.
3. **The fireball hurts only defenders.** The alternative is everyone near it, like a keg.
4. **"More damage from the same attacks"**: I read it as every attack hitting a frozen target
   ×1.5. The other reading is that only ice arrows hit a frozen target harder, as a combo. Say if
   you meant that.
5. **Who shoots ice arrows**: the builder's frost bow and a new frost tower. The alternatives:
   - the frost bow only
   - also the archer troops, which would put ice arrows in the palace's openings
6. **The ice blocks** (§4.1): white snow brick, blue ice, ice and ice spikes, with those costs.
   "Touch" includes standing on top. Say if you want fewer blocks, or standing on them not to
   count.
7. **The staircase is inside the great hall,** round the crystal (§6.3). The alternative is outside,
   up to a front terrace, like the film's bridge. That's grander from the air, but it's a ramp for
   attackers to the archers.
8. **"Very high"**: 12 clear on each floor, and about 38 from the hall floor to the roof's peak over
   the well. Say if you want them higher; level 2 can go to about 15 before the spire reaches the
   height limit, or higher with a shorter spire.
9. **"White"**: a white body (snow brick) with pale-ice trim and deep blue-ice roofs and spires, as
   the references' blues. Say if you want it all white.
10. **The fire mage's first night**: 7.
11. **The world's name**: "Ice Palace", unless you give me one.
12. **The starting kit** is the bot's inventory at the export, as last time. Say if I should trim
    it.
13. **The landscape hotbar covering the health chip** (§0.1): I'll fix it while I'm in the HUD,
    unless you'd rather I didn't.
14. **I stop for your OK on the preview** (`compare.jpg`, `interior.jpg`) before recording. This
    changed: a run is now over 5 hours, and the preview is where a change is cheap. Say if you'd
    rather I went straight on.
