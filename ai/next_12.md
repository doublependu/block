# next_12: where iteration 12 got to

Answers `ai/prompt_12.md`, following `ai/plan_12.md` (take 3: the 6,000-block palace, late nights
tried, unlimited lives). The prompt has no answers added, so every default in plan §9 stands.
You committed parts 1 and 2 as `a137ac6` ("itr 12, part 1"); part 3 is in the working tree, not
committed.

**Part 1** (§1–10) stopped at the palace preview for your OK. You said "keep going", which I took
as an OK with my recommended defaults. **Part 2** (§11) covers what followed: the frost counter, a
smaller floor, the palace bot, and the first recorded runs. **Part 3** (§12) follows your answer
"default is good, except I want a white floor in the castle. Let's finish the rest … set it up so
that it can start from where it's stopped": the white floor, a game that carries on from where it
stopped, the recorded game, the video and the export.

`npm run check` passes (362 tests; types clean; all ten GLBs valid), and so do the build budgets.

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| Feature 1: the version, `v.<4 characters of the commit>`, in an unused corner | **done** (§2) |
| Feature 2: an enemy that blasts a fireball and destroys a volume of blocks, after dp-sakura-crossing's fireball | **done** (§3): the fire mage, from night 7 |
| Feature 3: the ice arrow: freezes, and a frozen target takes more | **done** (§4): the frost bow and the frost tower; ×1.5 measured |
| Feature 4: ice blocks that freeze attackers on touch, defenders immune | **done** (§5): snow brick, blue ice, ice, ice spikes |
| From the chat: unlimited lives | **done** (§6) |
| Late nights (plan §5.4, "try your best") | **done** (§7) |
| Recording 1–5: the 30-minute video of the white frozen castle, and its export | **done** (§12): `recordings/palace12/palace.mp4` (30:07) and `ice-palace.world.json`. The palace isn't "very safe": 25 of 41 nights lost (§12.8) |

---

## 2. The version tag

- **`v.1693`** today (HEAD `16934ca`), in the bottom right: on the menu and in the game, 11 px and
  dim. The full hash and the build date are on hover.
- The commit comes from Cloudflare's own git builds first (`WORKERS_CI_COMMIT_SHA`, then
  `CF_PAGES_COMMIT_SHA`), then `git rev-parse HEAD` (`npm run deploy` builds on your machine).
  Without one: `v.dev`.
- **Checked** (`tools/autoplay/hud-check.mjs`, pictures in `recordings/hud12/`): on a desktop
  window, a phone upright and a phone sideways, on the menu and in a game, the label overlaps
  nothing: 6 of 6.
- **Fixed on the way (plan §9 q13):** on a phone held sideways, the hotbar covered the health chip.
  Between 641 and 979 px wide, the chip (and the touch stick) now sit above the hotbar. The same
  check fails if they overlap again.
- **Your dev server on port 5173** was started before `vite.config.js` defined the commit, so it
  shows `v.dev` until it's restarted. (Without a guard, the menu would have stopped working on
  that server: there is one now.)

## 3. The fire mage

- **Who:** a hooded robe in ember orange and soot, coal eyes, a staff with an iron cage holding a
  coal (`attacker_pyro.glb` and `fire_staff`, both from `make_characters.py`; the other models are
  byte-identical). One new clip, `cast`: the staff up over its head while the ball gathers, then
  thrust forward. Every other model falls back to `shoot` (`docs/character-contract.md`).
- **Rules** (`FIREBALL`, `UNITS.pyro`): 70 HP, range 14, a 1.2 s wind-up (kill or freeze it then,
  and the cast is lost), 7 s between casts, from night 7 (one a night, 0.35 more each night after),
  never in the opening raid.
  - **What it throws at, in order:** a defender or the builder within 5; the nearest tower it can
    reach; a built block in its way (on its path, or on its line to the Town Center); only then
    the Town Center.
  - **A lob has no floor on its reach** (`lobReach`): a target more than its range above it is
    out of reach, so a tower up high is safe from it, and outranges it.
- **The blast** (`siege.js` `blastCells`, `Demolition.fireball`): every breakable block within
  1.7 is blown out, built or natural (a crater), and ice within 2.5 melts. Bedrock, the plaza and
  the Town Center can't be. All of it is night damage: dawn rebuilds it. 45 damage to defenders
  and the builder within 3, 60 to the Town Center within 4, none to attackers.
- **The effect** (`src/game/fireball.js`): dp-sakura-crossing's Cinder Fall, ported as its
  choreography and its numbers, in this game's blocky style. The sheet is
  `recordings/lab12/sheet-fireball.jpg`: the ball gathering at the staff, the lob with its trail
  of flame tongues, the head swelling late, three offset lumps (red, orange, cream) growing fast
  and holding, the shock ring, the crater with its chips in the blocks' own colours, embers on a
  four-stop ramp, the scorch fading.
  - Four draw calls (lumps, tongues, ring, scorch), thin instances, no lights, no transparency.
  - **On a phone** (390 × 844, CPU 4× slower), three mages throwing for 14 s: frame times p50
    16.7 ms, p95 16.8 ms, max 49.9 ms, the same max as without them (50.1 ms)
    (`recordings/lab12/volley.json`).
- **Sounds:** the wind-up crackle, the throw, the blast, levelled by `sound-check.mjs`.
- **Changed from the plan after the map** (§7): blast radius 2.0 → 1.7, ice 3.0 → 2.5, a mage
  costs the wave 6 points, not 5; and the Town Center comes last in its targets, at 60 damage, not
  150. With the plan's version, one mage on the default world's `t8-high` lobbed a fireball over
  the walls at the Town Center every 7 s, unanswered, and lost a night iteration 10 won twice.

## 4. The ice arrow and freezing

- **Freezing** (`src/game/frost.js`, `FROST`): an attacker is frozen 2 s, then can't be frozen
  again for 3 s (frozen at most 40% of the time). Frozen, it can't move, strike or cast (a cast
  in progress is lost); a sapper's lit fuse keeps burning. It turns to pale ice with its pose
  held, glints, and shatters free. **Defenders and the builder are never frozen.**
- **Frozen takes ×1.5 from every blow** (plan §9 q4, the default reading). Measured on a brute:
  an arrow-tower hit does 4.8, on the frozen brute 7.3. Hits on a frozen attacker show in blue.
- **Who shoots ice arrows:**
  - **the frost bow** (planks 3, iron 2, gold 1): 14 damage every 0.9 s, range 30. A weapon of its
    own; in the hand, the recurve bow tinted ice-blue
  - **the frost tower** (planks 6, cobble 4, iron 2, gold 1): 6 damage every 1.4 s, range 16, high
    ground as every tower. **It shoots the attackers it can still freeze first**, so it spreads
    its freezes
- `recordings/lab12/sheet-frost.jpg`: grunts and a brute frozen against an ice wall, shattering
  free.

## 5. Ice blocks

| Block | Looks | Hardness | Recipe | Night value |
|---|---|---|---|---|
| snow brick | white bricks, faint blue joints | 0.6 | cobble 1 → 2 | 0.25 |
| blue ice | deep turquoise, pale streaks | 0.6 | cobble 1 → 2 | 0.25 |
| ice | clear pale blue, white cracks, a glint | 1.8 | cobble 2 + iron 1 → 2 | 0.6 |
| ice spikes | icicles, see-through | 0.9 | planks 1 + iron 1 → 2 | 0.6 |

- **Touch** (`touchesIce`, checked every 0.18 s per attacker): standing on one, standing in ice
  spikes, pressing against one at foot or head height, or striking one. Each freezes exactly like
  an ice arrow, immunity included.
- Painted in the atlas, opaque. A "Frost" row in the Build panel with the frost tower and bow.
- **They draw fire mages and grunts, half each** (`WAVE_COUNTERS.frost`, §11.1), and the dusk banner
  says "Your ice drew fire mages: fire melts ice."

## 6. Unlimited lives

- **Lives: 3 / Unlimited** on the New world panel and the panel for starting a listed world.
  **Play** is unchanged: survival, 3 lives.
- With unlimited lives, a lost night still loses the town, dawn still rebuilds it and the night
  comes again, but the game never ends. The lives chip shows **∞ · 2 lost**.
- A setting of the game: the save keeps it (`unlimitedLives`, `nightsLost`, only when set); a world
  export never holds it; old saves load with 3 lives (`docs/world-format.md`). An unlimited game
  never sets a best score.
- **Checked in the game:** a Large world started with unlimited lives lost four nights in a row,
  never ended, could still build, and the save kept `nightsLost: 4`.

## 7. Balance

### 7.1 The difficulty map (`recordings/map-12a`, `12b`, `12c`, `12d`)

Two runs per cell, builder on autopilot (W held / **L** lost, with the Town Center's lowest).

| Town | Night 4 | Night 6 | Night 8 | Night 10 | Night 12 | Night 14 |
|---|---|---|---|---|---|---|
| default | W W | **L L** | **L L** | **L L** | | |
| t1-towers | W W | W W | **L L** | **L L** | | |
| t8-high | W (one run failed) | W W | 5 of 8 held (W 71%, 9%, 81%…) | 1 of 4 | | |
| t2-mixed | W W | W W | W W | W W | W W | **L L** |
| t9-frost | W W | W W | W W | W W | W W | **L L** |

- **Every existing town is within a night of iteration 10** (`map-10a`): `default` and
  `t1-towers` lose the same nights. `t8-high` held night 8 twice in iteration 10, marginally (67%
  and 27%); now it holds it 5 times in 8. That night is lost to brutes: the log now records the
  Town Center's damage by attacker, and every point of it came from brutes, with the fire mages
  casting 0–2 times.
- **The first map caught a fault in the fire mage**: it lobbed fireballs over `t8-high`'s walls
  at the Town Center, 150 a hit, and lost a night alone. Its targets and damage were fixed (§3).
- **`t9-frost` is not 1–2 nights better than `t2-mixed`, as planned: it's even with it.** At
  first it was worse (night 12 held 1 in 2): ice draws fire mages (8–10 a night against `t2`'s 3),
  and each one blew out a lot of the ice. After one round of tuning on the mage (§3), it holds
  night 12 twice and loses 14, like `t2`. Your call: §10.

### 7.2 Late nights (plan §5.4)

Iteration 10's castle as it stood on day 18 (no ice, no frost towers, no palace archers):

| Night | Iteration 10 (from next_10) | Now |
|---|---|---|
| 17 | a coin flip: W, W, **L** (HP and blows ×2.08) | **held twice** (72%, 30%): HP ×1.76, blows ×1.25 |
| 20 | (not run: HP and blows ×3) | held **1 in 5** (53%) |
| 24 | (×5.3) | held 1 in 2 (59%) |

- **The default town at nights 15 and 20 still falls**, both, in under a minute.
- **Nights 1–12 are exactly as before** (a test compares every night's grunts with the old
  formula).
- **Against plan §5.4's target**: night 17 held every time ✓; night 20 "more often than not" ✗.
  As the plan says, I'm reporting it rather than pushing the knobs further. The palace has what
  that castle didn't (the freeze, frost towers, 14 archers up high, every tower on high ground),
  and unlimited lives keeps the recording going either way. The rehearsal will say how it holds.

### 7.3 Archers hold high posts (plan §6.5)

A ranged defender placed 3 or more above the natural ground holds its post: no wandering, no
patrol, back to it if pushed off. The palace's archers stay in their openings; a town's archers on
a wall walk stay on it.

---

## 8. The ice palace (preview)

**The site:** `ice-palace-3618`, a Large world. `seeds.mjs --frost` rated 4,000 seeds for snowy
peaks on one side, a level footprint and trees and sand in reach; I rendered the best three with
the palace in them (`recordings/palace12/sites.jpg`). The peaks are 60–120 blocks out, past where
the game's fog starts (~50), so **none of the three shows its snow from the palace**: the frozen
look has to come from the palace itself.

**The design** (`tools/autoplay/castle/palace.js`, 11 tests in `tests/palace.test.js`):

| Part | Blocks |
|---|---|
| the floor (a white floor over the grass, and fill) | 368 |
| level 1: the great hall, 29 × 25, **12 clear** | 1,387 |
| the double curved staircase | 542 |
| level 2's floor round the well | 342 |
| level 2: **12 clear** at the walls, up to 25 under the roof; 24 openings | 1,176 |
| the roof | 772 |
| four corner towers with balconies at 30 up | 1,078 |
| the great spire, to 64 (the limit is 70) | 203 |
| gables on every face, crystal needles | 198 |
| the snowflake on the hall floor | 20 |
| the curtain, its gates and bastions | 584 |
| defences (gates, spike bands) | 70 |
| **total** | **6,740** |

- **The staircase:** two flights of 13 treads round the crystal, each one block up from the last,
  blue ice with clear-ice nosings on snow-brick risers, flared bottom treads, newels with crystal
  finials, rails of blue-ice posts and icicles, a landing at the back over a pointed arch, at least
  3 blocks of headroom over every tread. The game's own path search walks up **each flight alone**
  from the door to level 2 (a test).
- **The archers:** 24 openings at level 2's floor; a test checks each has room to stand, a floor,
  a drop outside, and a clear line to the ground 5 out from the wall. 14 archers stand in them.
- **Every defence the game has is placed** (a test): every wall, gate and spike tier, ice spikes,
  all six towers, eight frost towers, archers, swordsmen and gunners. The arrow family is on the
  corner balconies (30 up) and at the spire's foot.
- **Buildable by hand, in order:** every block has a face to be set against when its turn comes
  (a test). That took a hidden support per roof course, gates after their lintels, and a 2-high
  door gate.
- **Materials:** about 3,600 cobble, 220 iron, 180 planks, 85 sand, 50 gold. Clear ice costs iron,
  so it's kept to the door, the tread nosings and the finials (142 blocks); the trims are blue ice
  and the windows dark glass. The curtain stands on a grey stone plinth (as hard as ice, no iron).

**Pictures** (local only; the references stay out of anything shared):

- `recordings/palace12/palace.jpg`: front, the references' angle, above, back
- `recordings/palace12/compare.jpg`: `castle_2.png` and `castle_2_1.png` next to the palace
- `recordings/palace12/interior.jpg`: the hall from the door and looking up, a flight from the
  hall's corner, both flights round the crystal from level 2, the right flight across the well,
  level 2 along an archers' wall, out of an opening onto the curtain

---

## 9. Changes by file

- **The game:**
  - `src/boot/version.js` (new), `src/boot/main.js`, `index.html`, `vite.config.js`, `src/env.d.ts`: the version tag
  - `src/game/frost.js` (new): freezing, immunity, ×1.5, touching ice (pure)
  - `src/game/fireball.js` (new): the fireball's flight and its effect
  - `src/game/balance.js`: `FROST`, `FIREBALL`, `lobReach`, `WAVE_OVERFLOW`, the grunts' `linearFrom`,
    the fire mage, the frost bow, the frost tower, `ice_arrow`, the ice blocks' recipes and values,
    the `frost` counter
  - `src/game/units.js`: freezing (and frozen units holding still), the fire mage's brain and
    casts, `defenderAt`, `holdsPost`
  - `src/game/siege.js`: `blastCells`, `Demolition.fireball`; debris in the blocks' own colours
  - `src/game/towers.js`: the frost tower's head, and `towerTarget`'s preference for what it can freeze
  - `src/game/waves.js`: the `frost` part, late nights, `overflowMults`, the banner's fire mages
  - `src/game/cycle.js`, `src/world/worldFile.js`, `src/game/session.js`: unlimited lives
  - `src/game/effects.js`: the ice arrow and its frost trail; embers that walk a colour ramp
  - `src/characters/library.js`, `contract.js`: the frost material, frozen clips, the staff's pose,
    the `cast` clip
  - `src/world/blocks.js`, `atlas.js`: the four ice blocks and the frost tower, painted
  - `src/audio/sounds.js`, `levels.json`: ten new sounds
  - `src/ui/hud.js`, `hud.css`: the Frost row, labels and notes, blue numbers on a frozen
    attacker, the lives chip, the landscape fix, the help line
  - `public/models/attacker_pyro.glb` (new), `items.glb` (the staff), from `tools/blender/make_characters.py`
- **Tests:** `version`, `frost`, `lateNights`, `lives`, `palace` (new); `game` (the overflow now caps
  blows at ×1.25) and `sound` (the bank's budget is 4.5 MB; the two ice twangs and the throw play
  live, not banked)
- **Tools:**
  - `tools/autoplay/castle/palace.js` (new): the palace
  - `castle/seeds.mjs --frost`, `castle/preview.mjs --palace`
  - `fx12.mjs` (new): the fireball and frost sheets, the phone volley
  - `hud-check.mjs` (new): the version label against the HUD
  - `make-towns.mjs`: `t9-frost` (`towns/t9-frost.world.json`, new)
  - `run.mjs --size --lives`; `showcase.mjs` poses include the staff (13 of 13 pass)
  - `sound-check.mjs`: targets for the new sounds
- **Docs:** `README.md`, `docs/character-contract.md` (`cast`), `docs/world-format.md` (unlimited lives)

## 10. For you

1. **The palace: your OK on the design** (`recordings/palace12/compare.jpg`, `palace.jpg`,
   `interior.jpg`), before I build the bot for it and record. It reads as a white palace with
   turquoise ice roofs, needle spires and pointed gables; it's boxier and more solid than the
   film's crystal mountain, and inside it's a tall white hall with the stairs round the crystal.
   Say what to change while it's still cheap: taller and slimmer, more spires, more clear ice
   (each block costs half an iron), a different staircase, anything.
2. **Its size: 6,740 blocks**, 2.2× iteration 10's 3,036 (you asked for ~6,000). It's over because
   of the white floor laid over the grass inside the hall (310) and the spikier silhouette. I can
   drop the floor (the hall's floor stays grass and dirt round the plaza) and shorten the corner
   towers to come down to about 6,200. My default: keep it.
3. **The frost town's balance** (§7.1): even with a stone town of the same cost, not 1–2 nights
   better. Options:
   - **(recommended) ice draws half fire mages, half grunts** (`WAVE_COUNTERS.frost`): the mages
     are what undo the freeze
   - a stronger freeze: immune for 2 s after a thaw instead of 3 (frozen up to half the time)
   - leave it: frost as a different way to defend, not a better one
4. **Late nights** (§7.2): the change helps (night 17 now holds) but night 20 is still beyond
   iteration 10's castle. I'll go on with it as it is, and show you the rehearsal's numbers before
   recording if the palace loses many nights (plan §6.9).
5. **The snow:** the snowy peaks are past where the fog starts, so they don't show from the
   palace on any of the three sites. The frozen look is the palace's own. Say if you want me to
   look for a site with snow closer in (the plaza is at height 7 on every seed, and snow starts at
   37, so it will always be a backdrop).

**After your OK** (plan §7 steps 10–13): the bot in three views (first person indoors, third
person on the walls, the aerial view up high) with part labs and its pace measured, a rehearsal
(about 5 hours), the recording (about 5 hours), the 30-minute edit, the export and the deploy
test. About 20–25 hours of machine time.

**Your dev server on port 5173**: restart it (`npm run dev`) to see the version label; until then
it shows `v.dev`.

**Load and frame rate** (spec): first playable frame 1.08 s on desktop and 1.54 s on mobile
(median of 5; 2–3 s, 4 s at most), 60 fps in the opening raid and at night on both. The game code
grew 7.5 KB (361 of 550 KB).

---

## 11. Part 2: after "keep going"

### 11.1 The choices in §10, as taken

1. **The design:** as previewed.
2. **The size: 6,430 blocks**, 2.1× iteration 10's 3,036. **This isn't the default I gave you
   ("keep it")**: the first lab showed what the white floor over the hall's grass cost. Each of
   its 310 cells was a dig and then a block, many of them in one-block pits. So the floor is left
   as it is: the plaza, with grass and the dirt path round the crystal (an indoor garden). The
   floor part is now 58 blocks of fill, against 368. `RELAY_FLOOR` in `castle/palace.js` puts it
   back.
3. **The frost town: ice draws half fire mages, half grunts** (`WAVE_COUNTERS.frost`, my
   recommendation). `recordings/map-12g`, two runs a cell:

   | Town | Night 12 | Night 14 | Night 16 |
   |---|---|---|---|
   | t9-frost | W 100%, W 100% | W 73%, **L** | **L L** |
   | t2-mixed | **L**, W 87% | W 21%, **L** | **L**, W 53% |

   Ice now holds night 12 cleanly where stone flips a coin, and at night 14 it holds at 73%
   against stone's 21%. By night 16 both fall. With two runs a cell that's a lean, not a proof:
   frost is a little better earlier and no better late.
4. **Late nights:** as in §7.2.
5. **The snow:** the site is unchanged.

### 11.2 The palace bot (`tools/autoplay/bot/palace.js`)

- **Three views** (plan §6.6):
  - **First person:** the floor, the staircase, level 2's floor, the snowflake, the troops.
  - **Third person:** the curtain, the defences, and level 1's first five courses.
  - **The aerial view:** the rest, in tiles 20 blocks wide and 8 courses high.
  - Each building trip's chapter names its view ("Day 9 · the staircase · first person").
- **Loads of 400 blocks** a trip, mined and crafted first. Iron and gold go to towers and troops
  only when they're affordable.
- **On foot, round the palace:** each part is built in order of its angle about the Town Center,
  so the builder works along a wall instead of back and forth across the site. Level 2's floor is
  built out from the landing.
- **The troops:** swordsmen and gunners go to their posts as those are built. The 14 archers go
  to their openings once level 2's wall stands round them.
- **Moments for the edit, at 1×** (plan §6.10): the two flights meeting at the landing; the first
  walk up to level 2; once the roof is on, a look up from the door at the hall's full height; at
  the end, a walk in through the door and up a flight before the turn round the palace.

**Fixed on the way** (labs `recordings/palace12-lab1` to `lab5`):

- **Aiming into a pit:** a block at the bottom of a one-block pit was retried over and over ("no
  aim": the eye's line to the middle of the face below clipped the pit's rim). The bot now aims
  at a point on the face it can see, and walks to a spot where it can see one. Day 1 of the first
  lab built 65 blocks with 62 failed placements. The third lab built about 650, with 50 failed.
- **Archers** were walked to openings that weren't openings yet (level 2's wall wasn't up).

**Pace in the labs,** with the materials handed over (no mining), per minute of play (nights
included):

| Lab | What | Blocks | Minutes | A minute |
|---|---|---|---|---|
| `lab3` | the floor, the curtain, level 1 (first and third person) | 922 | 16 | 58 |
| `lab4` | the staircase, level 2's floor (first person) | 650 | 12 | 54 |
| `lab5` | level 2, the roof, the corner towers (from the air) | 1,936 | 14 | 138 |

On foot is about 2.5× slower than from the air, which is why the plan keeps on-foot work to the
parts the camera needs to see from inside. The real pace, with the quarry, comes from the run
(§11.5).

### 11.3 The edit (`edit.mjs`)

- **Speeds:** building up to 24×, mining and walking up to 80× (iteration 10: 12× and 40×). A
  palace game is about twice as long.
- **On-foot building counts as building:** the bot's `placing` was sped up like walking.
- **Building time on screen is reported by view,** to check each gets at least a fifth (plan
  §6.10). A test covers both.

### 11.4 The deploy test (`deploy-test.mjs --palace`)

- **Frame rate from five camera positions,** measured by day after the raid
  (`load-test.mjs --views`):
  - the hall from the door
  - the hall looking up
  - both flights from level 2
  - the palace from the air
  - the palace from above
- Tried on the current default world with two test views: 60 fps.

### 11.5 The runs

**Each run is recorded,** with unlimited lives and dawn checkpoints. If one meets plan §6.8, it's
the recording, which saves about 6 hours over a separate rehearsal. If not, it was a rehearsal.

**Run 1** (`recordings/palace12-rec1`, stopped on day 5): a rehearsal.

- **It lost nights 1 and 3.**
  - Night 1: one swordsman out, at the front gate (26 blocks from the Town Center), and the
    kit's archer still in the pack. Three swordsmen crafted in the day waited for the next
    morning. With all four out, the replay of night 1 left the Town Center untouched.
  - Night 3: 26 grunts, 4 raiders and a brute against four swordsmen at the gates and the
    builder. Nothing by the Town Center: it fell in 40 s. **No tower was up by day 4.** Every
    tower in the design needs iron (the quarry gives about 10 a day) or stands on a high part
    built late.
- **The pace:** a day of gathering for each day of building. Days 1 and 3 placed nothing; days 2
  and 4 placed 332 and 390. That's about 180 a day, so about 32 days. Days are 8 minutes of light
  and 1–2 of night, not the 13 minutes the plan assumed, so it's still about 5.5 hours. The quarry
  sets it: 33 stone a minute, and the palace needs about 3,000 cobble. There are no better
  pickaxes to make it faster.
- **Your laptop slept from 04:46 to 05:47 (lid closed).** The game paused cleanly (its clock
  skipped 1 s), but the video has an hour's gap. Closing the lid stops a run; it's on mains with
  idle suspend off, so the lid is the only thing that does.

**Fixed for run 2:**

- **The crystal's guard:** four arrow towers round the Town Center, in the well behind it (planks
  and cobble, no iron), the bot's first load on day 1. A test checks they're clear of every
  palace block and that each flight can still be walked.
- **Troops out before the night:** when troops are crafted and ready, the day's work stops 100 s
  before dusk to take them to their posts.
- **The kit's swordsman and archer guard the Town Center** from day 1, as iteration 10's did.

**Run 2** (`recordings/palace12-rec2`, stopped on day 6): a rehearsal.

- **Nights 1–3 held**, the Town Center untouched (2,500, 2,500, 2,493). The crystal's guard got
  26 kills on night 4.
- **Nights 4 and 5 held, but only just:** the Town Center fell to 52% and then 38%, nearly all of
  it to brutes. Arrows do half damage to a brute, and the night answers arrow towers with brutes
  (`WAVE_COUNTERS.arrow`). Iteration 10's castle held those nights on ballistas: 18–78 kills a
  night.
- One frame for all four guard towers left two off screen. They went up later, the last on day 2.

**Fixed for run 3:**

- **The guard is upgraded, arrow → crossbow → ballista,** first thing each day, from above while
  the hall has no roof. It takes 5 iron and 1 gold a tower. Until all four are ballistas, that
  iron is kept back from troops, other towers and ice.
- **Each ground tower is framed on its own.**

**Runs 3 to 5** never got past day 2 (the session that started them ended there):

- Run 3 left nothing on disk. Run 4 stopped 7 minutes in.
- Run 5 (`recordings/palace12-rec5`) placed three of the four guard towers one cell off, and
  three more next to them, then opened and closed the Build panel for the rest of day 1 and all
  of day 2 ("build-stuck", 353 times). §12.1 has the cause.

---

## 12. Part 3: after "default is good, except I want a white floor … finish the rest … start from where it's stopped"

### 12.1 What stopped runs 4 and 5

- **One right click built twice from above.** The browser grants pointer lock a moment after the
  click that asks for it. The harness clicks for the lock while the bot is on foot; when the bot
  switched to the aerial view in that moment, the lock arrived in the aerial view. Locked, a right
  click was taken twice: as the build key (on press) and as the aerial click (on release). The
  first built the tower on its column; that moved the camera's lift, so the second hit the
  column's side and built a second tower in the next cell.
  - **Fixed in the game** (`src/game/control.js`): a lock that arrives in the aerial view, or with
    a panel open, is given straight back. A player who clicks and presses M quickly could hit the
    same thing.
  - **And in the bot** (`bot/aerial.js`): it waits for the lock to be gone before it clicks.
- **The loop.** With the towers doubled, the bot was 2 planks short for the next one. A load counts
  as "in stock" at 80%, so it tried to build, crafted nothing, and tried again, all day. Now a
  build that puts nothing up fetches what's short (`bot/castle.js`).

### 12.2 The white floor

- `RELAY_FLOOR` is on again: the grass and the dirt path inside the hall are dug out and relaid in
  snow brick (368 blocks, 312 of them dug first). The plaza's paving round the crystal stays (it
  can't be dug). The palace is back to **6,740 blocks**.
- **Dug on foot, laid from above.** Laying it on foot was the slow part (the bot stood in the pit
  it had just dug: 54 blocks a minute and failed placements). Digging the whole floor first
  (48 cells a minute, in first person) and laying the bricks from above (303 in 55 s) takes about
  8 minutes of daylight in all.
- **A bug it would have hit:** a floor cell that had been dug and relaid still counted as "to
  dig", so the bot walked back to it and failed, 12 times a load. A cell with something built in it
  is now dug (`dugOut`).

### 12.3 A game that carries on from where it stopped

`tools/autoplay/long-run.mjs` plays the game in parts (`<dir>/part-01`, `part-02`, …):

- **Every dawn** `run.mjs --checkpoint` saves the game, and next to it what the bot has to remember
  that the save doesn't hold (`day-N.bot.json`: nights won and lost, the moments already shown, the
  day the last block went in). The troops out are read back from the game's own list.
- **When a part ends before the game is finished,** the next part continues from the newest dawn:
  the page died, the page stopped answering, a file of the game failed to load, the laptop slept
  (a jump of 45 s in the harness's clock), or you stopped it.
- **Run the same command again** and it carries on. `--status` shows the nights, the days and the
  build; `touch <dir>/STOP` (or Ctrl-C) stops it cleanly.
- **`--part-minutes=55`** ends a part at the first dawn after 55 minutes and starts the next from
  that dawn, so nothing is played twice. Each finished part is encoded in the background while the
  next one plays.
- **The cut** (`edit.mjs`) already joined parts at their checkpoints; `long-run.mjs` lists which
  parts it keeps (`parts.json`). A part that was replayed whole is left out.
- 7 tests (`tests/autoplay.test.js`): which checkpoint to continue from, where each part ends, and
  that a part's log past its cut isn't used.

Tested on the real game: I killed the browser a minute into day 2, and three seconds later the
next part was playing day 2 with its inventory, its night count and the bot's memory.

### 12.4 Fire mages, open gateways and iron: what the first nights taught

The recorded game is the first that got past day 6, so it found what the design and the bot had
wrong. Each fix was loaded at a dawn (a restart from that dawn's save: nothing replayed).

- **Night 7 was lost with the Town Center at 0%.** Fire mages come from night 7. Four of them
  threw 14 fireballs, none lost, and blew up every tower on the ground: the crystal's four
  ballistas and the two frost towers. Brutes then took the Town Center.
- **The six towers meant to be out of the mages' reach could never have been placed.** The four
  balcony towers were drawn on the balconies' corner cells, which the round balcony doesn't have,
  and the two at the great spire's foot hung in the air above the roof. The "finished palace" lab
  wrote them straight into the world, which hid it. Now each balcony has **two** towers, on the
  middles of its outer edges (8 in all, 30 up), the spire's two stand on the roof, and a test
  fails if a tower off the ground has no block under it.
- **What holds night 7** (sieges against the day-8 save, two each; `--lab=siege:<save>:7`):

  | The day-8 town, plus | Night 7 |
  |---|---|
  | nothing (as played) | **lost** (0%) |
  | all four corner towers, 8 towers up high | **lost, lost** (0%, 0%): 104 attackers, brutes |
  | the curtain finished, its four gates in | held, held (96%, 65%) |
  | and the hall's first level and door | held, held (100%, 100%) |
  | and the corner towers too | held (49%): 115 attackers |

  An open gateway is no wall, and the gates were the last thing in the build order. More towers
  alone draw a bigger wave (the attack grows with the defence) and lose.
- **So the order changed:** the floor, the curtain, **its gates**, level 1, **the hall's door**,
  **the corner towers**, the staircase, level 2's floor, level 2, the roof, the spires, the
  snowflake, the spike bands. The gates and the door are parts of their own.
- **Iron was the real limit.** A lost night pays nothing, and the quarry's rows turned up about 3
  iron a day. The steel and iron gates, the clear ice round the door and the ballistas up high
  take about 60 before the rings are closed and the first towers are up. Three changes:
  - **Iron goes in order:** the crystal's guard, then what closes the rings (the hall's door
    portal, the curtain's gates), then the towers up high, then troops, towers on the ground and
    the rest of the clear ice. Before, three gunners took 12 iron the morning the gates were due.
  - **The quarry digs for ore it can see** (the ore tip shows a player where it is): a run of up
    to three minutes each morning while iron or gold is short, straight from ore to ore in the
    rock round the hall, and ore within 6 of the face while it mines its rows.
  - **Less iron in the design:** the door is a wooden gate (it was iron), the two pillars beside it
    are blue ice (they were clear ice, 13 iron), and the gate flanks are grey stone with one cap of
    steel or iron (they were steel and iron all the way up, 12 iron). Every tier of wall and gate
    is still placed.

### 12.5 Other fixes in the bot

- **Gunners** stand on the bastions' decks, four up with no way up on foot: the bot could never
  place them. They're set down from the aerial view now (troops can be placed from above).
- **The aerial view couldn't reach a balcony from the ground.** A click puts the view's pivot on
  the block without moving the camera, so a block far above the camera was never on screen. It
  now climbs: click the highest block of the tower that's on screen, zoom back out, again. In a lab
  all 8 balcony towers went up from the ground in 20 s.
- **The builder ended a day on top of the hall's wall,** four up, with no path anywhere (the path
  search stepped off edges 2 down at most). There's no fall damage, so it steps off a wall of any
  height now.
- **The last tenth of a part went to the back of the queue** (iteration 10's rule for blocks that
  are hard to reach). That left 65 cells of the floor open and the front gate's lintel unbuilt.
  Now only what has failed before goes last.
- **Towers and the floor are built first each trip,** from above, in seconds. Before, the day's
  on-foot work never left time for them: two frost towers sat in the pack for three days.
- **The guard's upgrades fetch their own wood.** On day 2 the guard stayed arrow towers with 10
  iron in the pack and no planks.
- **The ending is bounded.** Finished means every block in, every tower up and every troop out.
  Towers and troops wait for iron and gold; once the blocks are all in they get three more days
  (the bot digs for ore), then the palace is finished as it stands.
- **The walk through the palace** at the end didn't happen (two of its three walks failed
  silently and it looked at the floor). It now walks to the front of the door and looks up the
  facade, goes in and looks up the hall, climbs a flight to the landing's rail and looks down at
  the crystal and across the well to the archers.
- **A file of the game that fails to load** (seen twice with two Chromes starting together:
  `ERR_CERT_VERIFIER_CHANGED`) now stops that part at once, and the next one starts.

### 12.6 The cut (`edit.mjs`)

- **A sped-up stretch too short to read is never played out at 1×.** It used to be folded into
  the moment before it: at 80×, three minutes of mining between two moments are 2 s, and folded
  they were three minutes. The first try at a 5-minute cut of the palace's first hour came out at
  18. It goes into a sped-up neighbour now, or is cut out when it's under a second.
- **The speed limits rise together when the game is too long for them,** as far as it takes to
  reach the target.
- **Each night gets 6 + 6 s at 1×** (its first attackers, its busiest moment), not 10 + 8: a
  palace game has over thirty nights.
- **A first moment is shown once in the whole cut,** not once in each part (the first fire mage,
  the first freeze, a bot's milestone, "wood for gates and towers").

### 12.7 The recorded game

`recordings/palace12-test2/` (16 parts; it kept the folder name of the test it started as: the
test was a real game with the real settings and recorded cleanly, so I let it run on).

- **One game, 42 days, 7 h 04 min of play.** New world from seed `ice-palace-3618`, Large (256),
  survival, unlimited lives, played by input only. It ends with the export, the walk through the
  palace, a turn round it from above and one more night.
- **16 parts, joined at dawn saves.** Nothing was replayed for a better result: every night that
  was lost is in the game and in the video.
  - 3 parts end where I killed the browser on purpose (the resume test, then two restarts to load
    fixes), 9 where I stopped it at a dawn to load a bot fix, 3 at the 55-minute mark by
    themselves, and the last at the end of the game.
  - **A fix loaded at a dawn changes how the bot plays from that dawn on,** not what has
    happened. But it does mean the game wasn't played by one version of the bot: the order of
    the build changed on day 9 and day 11 (§12.4).
- **The palace: 6,592 blocks placed and 4,382 dug** (the quarry's 3,913 stone, the floor's 312),
  of the design's 6,720 (it lost 20 with the shorter spike bands).
- **What's missing:** 169 cells of the design are open (2.5%), given up after three tries. About
  100 of them are shut inside other blocks and don't show. The ones that do:
  - **The block over 7 of level 2's openings** (the pointed head of each). From above there's no
    face to set it against, and the bot never tried it from inside. Those openings are four high
    instead of three, and **the 7 archers meant for them were never placed**: the bot waits for
    an opening to be finished before it walks an archer to it. 7 archers stand in the other
    openings (and one by the crystal).
  - 14 blocks of the wall over the arch under the landing, left of the middle.
  - A column of 6 in the front-left corner tower's spire, 3 at the foot of two others, one arm of
    the great spire's snowflake.
  - Not seen: the hall's corner pillars inside the corner towers (level 1: 13, level 2: 48, the
    eaves' corners: 8), the lower layer of 24 stair treads (shut in when the treads above went in
    first), and about 30 roof and spire blocks under the great spire's foot.
- **Defences placed, every kind the game has:**
  - 26 towers: 12 ballistas (4 by the crystal, 6 on the balconies 30 up, 2 at the great spire's
    foot 35 up), an arrow and a crossbow tower on the balconies, 8 frost towers at the gates, a
    cannon, a mortar and 2 bombards on the bastions
  - 17 troops: 8 archers (7 in level 2's openings), 5 swordsmen (one at each gate, one by the
    crystal), 4 gunners on the bastions
  - gates: 14 wooden, 6 iron, 10 steel; walls: stone, iron and steel at the gate flanks; spikes,
    iron spikes, steel spikes and ice spikes outside the gates (5 each) and 14 icicles on the
    stair rails; snow brick, blue ice and clear ice everywhere
- **The pace:** about 160 blocks a day (the plan hoped for 280), so 42 days, not 23. A day of
  gathering for most days of building, as run 1 showed. Seven days put up fewer than 25 blocks:
  four were gathering days (1, 3, 12, 16), and three went to faults in the bot that were fixed at
  a later dawn (a load of roof with nothing under it yet on day 28, and my own morning ore run
  taking the day on days 32 and 33).
- **Iron:** 176 ore dug in all. From day 30 the quarry went straight for ore each morning it was
  short (4 to 8 a morning: by then the ore near the hall was gone and each took about ten blocks
  of tunnel).

### 12.8 "Very safe": it isn't

| Night | Tries | Won at | Town Center lowest, each try | Attackers | Defence value |
|---|---|---|---|---|---|
| 1–6 | 1 each | first | 100% | 14–65 | 105–424 |
| 7 | 2 | 2nd | 0%, 100% | 85–89 | 568 |
| 8 | 3 | 3rd | 0%, 0%, 94% | 105–117 | 690 |
| 9 | 5 | 5th | 0% ×4, 41% | 140 | 859 |
| 10 | 8 | 8th | 0% ×7, 26% | 70–140 | 957 |
| 11 | 9 | 9th | 0% ×8, 95% | 70–140 | 1,460 |
| 12 | 2 | 2nd | 0%, 97% | 140 | 1,506 |
| 13 | 1 | first | 68% | 140 | 1,562 |
| 14 | 1 | first | 51% | 140 | 1,563 |
| 15 | 1 | first | 25% | 140 | 1,573 |
| 16 | 3 | 3rd | 0%, 0%, 98% | 140 | 1,609 |

- **41 nights: 16 won, 25 lost.** With unlimited lives a lost night comes again, so the game
  stood at nights 9, 10 and 11 for 22 days while the palace went up.
- **Against plan §6.8:**
  - *No night lost:* ✗. 25 lost.
  - *From the night the curtain closes, the Town Center above 80% and no attacker in the hall:* ✗.
    The curtain's last gate went in on day 28. Of the 13 nights after it, 7 were lost, and 3 of
    the 6 won fell below 80%.
  - *Fire mages mostly frozen or killed before they throw:* ✗. 1,173 casts started, 1,130 thrown,
    36 lost.
  - *The archers in the openings get kills:* ✓. Archers killed 160 over the game (the log doesn't
    split them by opening).
- **Why.** Every lost night ended the same way: brutes at the Town Center (2,000 of its 2,500 on
  most of them). The attack grows with the defence, and by night 9 it's at the cap of 140 with
  extra HP. The ballistas did most of the killing (1,976 of the defence's 3,410 kills),
  and fire mages blew up the ones on the ground night after night. Days 35–38, with ten
  ballistas up, six of them out of the mages' reach, and both rings closed, are the best stretch:
  nights 12 to 15 won one after another, though the Town Center fell lower each time (97%, 68%,
  51%, 25%), and night 16 took three tries.
- **The finished palace at later nights** (the lab's finished palace, sieges, two each): night 16
  lost twice, 24 lost, 32 lost twice, every time with the Town Center at 0%. That palace had 6
  ballistas, not 12, and its high towers written in by hand; I didn't rerun it with the exported
  world.
- **A decision for you** (§12.11): the late nights are still a balance question, and the frost
  defence makes it harder, not easier: ice draws fire mages, and fire mages undo towers.

### 12.9 The video

**`recordings/palace12/palace.mp4`**: 30:07, 1920×1080, 30 fps, H.264 and AAC, 4.5 GB, 130
chapters (in the file and in `palace-chapters.txt`).

- `palace-share.mp4` is a 1.8 GB copy (CRF 25) for sharing. `sheets/` has contact sheets, a frame every 20 s.
- **What it shows:** the menu and the opening raid; the crystal's guard; the floor dug out and
  laid white; the curtain; the hall; the corner towers; the staircase going up step by step in
  first person, the two flights meeting and the first walk up; level 2 and its archers; the roof
  and the spires; all 41 nights; the export; the walk through the finished palace; a turn round
  it from above; the last night.
- **Speeds:** key moments at 1× (17.5 minutes of them), first-person building at 19×, other
  building at 33×, nights at 22×, mining and walking at 111×. Seven hours into thirty minutes
  needed higher speeds than the plan's 24× and 80×.
- **The three views:** of the building on screen, 66% is from above, 19% third person, 15% first
  person. The plan asked for a fifth each: first person is under it (the staircase and level 2's
  floor are all the palace has that's built from inside).
- **Lost nights** are each captioned ("Night 9 lost · rebuilt at dawn"), 25 times.
- **The version label** is in every frame, bottom right: `v.a137`.
- **The references** aren't in the video.

### 12.10 The export

**`recordings/palace12/ice-palace.world.json`**, written by the game's own Export world (the bot
pressed P and clicked it) on day 41, when the palace was finished and before the last night.

- **A world, not a save:** the name, the seed (Large), 10,974 edits (6,592 blocks placed, 4,382
  dug out), 17 troops, and the builder's pack as the starting kit. No game: it starts as
  survival, day 1, 3 lives, with the opening raid.
- The description was written in by hand, as in iteration 10 (the game has no field for it).
- **The kit** is what the builder held: 93 blue ice, 74 snow brick, 143 cobble, 55 gold, a few
  spare gates and spikes, 349 dirt. Edit `start.inventory` if you want a plainer start.
- **As the starting point,** in a scratch copy of the game (`recordings/palace12/deploy-test/`):

  | | Desktop | Mobile (CPU 4× slower) |
  |---|---|---|
  | first playable frame (median of 5; spec 2–3 s, 4 s at most) | **1.02 s** | **1.41 s** |
  | menu interactive | 0.10 s | 0.19 s |
  | the opening raid | 60 fps, longest frame 33 ms | 59 fps; three frames over 50 ms, the longest 250 ms |
  | a night (the benchmark's) | 60 fps | 54 fps, on the medium quality tier |
  | the hall from the door, looking up, both flights from level 2 | 60 fps | 60 fps |
  | the palace from the air, and from above | 60 and 58 fps | 60 fps |

  - 15.8 KB compressed, against the 50 KB budget for the default world; 409 KB in all to the
    first playable frame.
  - **The opening raid against it** (recorded: `deploy-test/raid/game.mp4`): held in 176 s with
    the Town Center untouched, 18 of 26 towers standing at the end. Night 1 after it: won, 100%.
- **Your branch needs,** to make it the starting world:
  1. Copy the file over `worlds/default.world.json`.
  2. In `tests/worldfile.test.js`, delete "committed default world matches its generator script"
     and the "the default world starts exactly as before" block: both describe the old default
     world.

### 12.11 For you

1. **The nights.** The palace is not "very safe" (§12.8), and I don't think a better build order
   alone gets it there. What the game showed:
   - Fire mages reach every tower less than 14 above them, and almost never lose a cast (36 of
     1,173). A frost defence draws them (`WAVE_COUNTERS.frost`), so the more ice, the more mages.
   - The attack grows with the defence's value, and the brutes it sends for arrow-family towers
     and troops are what take the Town Center.
   - Options, none of them tried: frost towers that shoot fire mages first (a cast is lost when
     its mage is frozen); a shorter reach or a longer wind-up for the mage; ice blocks counting
     less toward the night than they do; fewer brutes per point of ballista.
   - A cheap way to measure any of them: `--lab=siege:recordings/palace12/ice-palace.world.json:16`
     (the finished palace at night 16; the recorded game lost that night twice and won it once).
2. **The 7 missing archers, and the gaps** (§12.7). The bot can be taught to set the block over
   an opening from inside, and the game carried on from its last save to place them; the end of
   the video would then be cut again. Say if you want it.
3. **First person is 15% of the building on screen,** not the fifth the plan asked for. More of
   the palace would have to be built on foot to change that (level 2's walls from its floor, say).
4. **The video's joins.** The game is one game, but 12 of its 15 joins are where I restarted the
   bot at a dawn to load a fix, so the bot that finished it isn't the one that started it. A second
   run with the final bot would be a cleaner record (about 7 hours); the nights would go
   differently, probably better early on (gates and high towers from the start).
5. **Disk:** `recordings/palace12-test2/` is 87 GB; its `game.webm` files (44 GB) can go once
   you're happy with the cut. The earlier runs and tests (`palace12-rec1` to `rec5`,
   `palace12-test1`, `palace12-lab*`) are about 13 GB more.
6. **Still open from part 1:** the snow never shows from the palace (§10.5).

### 12.12 Changes by file (part 3)

- **The game:** `src/game/control.js`: a pointer lock that arrives in the aerial view, or with a
  panel open, is given back.
- **The harness:**
  - `tools/autoplay/long-run.mjs` (new): a long game in parts
  - `run.mjs`: the bot's memory saved with each checkpoint and handed back on `--resume`;
    `--part-minutes`, `--no-post`; stops on SIGINT/SIGTERM with its files closed, when the machine
    slept, when the page stops answering, when a file of the game fails to load; the first
    checkpoint waits for the day after the opening raid
  - `video.mjs`: `--preset`; `edit.mjs`: §12.6
  - `lab.mjs`: the finished-palace lab hands the bot what its troops cost
- **The bot:**
  - `bot/palace.js`: the order of iron, the ore runs, towers and floor first, gunners from above,
    only blocks with something to be set against, the bounded ending, the walk through the palace,
    state kept across a restart
  - `bot/castle.js`: a build that puts nothing up fetches what's short; `nearestOre`, `oreRun`
  - `bot/aerial.js`: climbing to a target above the camera, troops placed from above, never a
    click with the pointer locked
  - `bot/nav.js`, `bot/skills.js`: stepping off a wall of any height; a longer path search
  - `bot/bot.js`, `bot/index.js`: `saveState` / `restore`
- **The design** (`castle/palace.js`): the white floor back on; the gates and the door as parts of
  their own; the order; two towers on each balcony, on cells that exist; the spire's two towers on
  the roof; less iron (the door, its pillars, the gate flanks, the treads' edges, the spike bands)
- **Tests** (362, 10 new): `tests/autoplay.test.js` (the parts of a long run, the cut's folding and
  ceilings and captions, stepping off a wall), `tests/palace.test.js` (every tower off the ground
  stands on a block; ten of them 14 or more up)
- **Docs:** `README.md` (long-run.mjs)

### 12.13 Load and frame rate (spec)

With the current default world, median of 5 loads in a fresh browser:

| | Desktop | Mobile (CPU 4× slower) |
|---|---|---|
| menu interactive | 0.10 s | 0.19 s |
| first playable frame (2–3 s, 4 s at most) | **0.93 s** | **1.56 s** |
| opening raid | 60 fps | 60 fps |
| night benchmark | 60 fps | 60 fps (medium tier) |

The game code is unchanged in size (361 of 550 KB): part 3 changed one handler in `control.js`.
