# next_12: where iteration 12 got to

Answers `ai/prompt_12.md`, following `ai/plan_12.md` (take 3: the 6,000-block palace, late nights
tried, unlimited lives). The prompt has no answers added, so every default in plan §9 stands.
Everything is in the working tree; nothing is committed.

**Part 1** (§1–10) stopped at the palace preview for your OK. You said "keep going", which I took
as an OK with my recommended defaults. **Part 2** (§11) covers what followed: the frost counter, a
smaller floor, the palace bot, and the recorded run.

`npm run check` passes (352 tests, 45 of them new; types clean; all ten GLBs valid), and so do the
build budgets.

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
| Recording 1–5: the 30-minute video of the white frozen castle, and its export | **in progress** (§11): the bot is done; the recorded run is playing |

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

**Run 3** (`recordings/palace12-rec3`): playing.
