# next_10: where iteration 10 got to

Answers `ai/prompt_10.md`, following `ai/plan_10.md` (take 4, with your answers in the chat: a
world export holds the world only; the opening raid always plays, and only a starter-strength town
is scripted to lose). Everything is in the working tree; nothing is committed.

`npm run check` passes (294 tests, types clean, all nine GLBs valid) and every build budget passes.

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| Issue 1: the wooden sword is 90° off, check the other weapons, make it not happen again | **fixed, with the cause measured**, plus three more weapons that were turned wrong (§2) |
| Feature 1: archery reaches farther and hits harder from high up, roughly physics | **done** (§3): reach √(1+h/R₀) capped at 1.5×, damage up to +25%; about 2 nights on the map |
| Recording 1–4: a 30-minute video of building the castle in survival, boring parts sped up, archery towers up high | **done, but not "very safe"** (§5): 29:47, days 1–19, 23 archery towers. Two lives were lost on the way, and nights 15–17 are a coin flip whatever the defence |
| Recording 5: export the final state with the game's export | **done** (§6): `recordings/castle10/castle-on-the-rock.world.json`, a world, not a save (§4). As the starting point it loads in 0.8 s on desktop and 1.7 s on mobile |

---

## 2. The sword, and every other weapon

**Cause.** The swords weren't turned wrong at rest; they hit with the **flat of the blade**. Every
slash is mostly a chop forward and down, and the poses from iteration 8 turned the flat toward you
(for the look at rest), so the flat led the cut: 51–81° off the edge, in every tier. The wooden one
is the sword you hold most. It's the same fault you fixed on the pickaxe in `a659d8c`: nothing
checked a pose against the direction the item moves.

The same check found three more:

| Item | What was wrong | Why |
|---|---|---|
| bows (first person) | the string on the far side of the stave, the draw pushing it away, the nocked arrow pointing **at you** | written as if the camera looked down −z (it looks down +z) |
| pickaxe (first person) | the head in the right plane, but the long point toward you and the chisel striking | the same −z assumption |
| bows, swords, pickaxe (third person) | swords flat-first in the chopping clips, bows string-out | the same kinds of turn |
| the sapper's `crude_pickaxe` (third person) | held like a spear | an item without a pose fell back to the *block's* pose |

**Fixed:**
- `src/game/handPose.js` now holds the pose tables and the motion curves, pure.
- **Swords:** a rest roll (a three-quarter view of the flat), plus a wrist roll through the stroke,
  so the **edge leads within 0–15° at impact** in every tier and in the iron backhand.
- **Bows:** turned round. The string is between the stave and your eye and is drawn toward you,
  and the arrow's head points ahead with its fletching on the string.
- **Pickaxe:** its long point now leads.
- **Third person (`library.js`):** every held item has a pose by name, each with a roll tuned to the
  clip it swings. Measured at the blow: wooden sword 0°, stone 1°, iron 2°, troop sword 1°, pick
  1°, sapper's pick 2°. A missing pose now warns.

**So it can't come back:**
- `tests/handPose.test.js` (32 tests in `npm run check`) repeats the measurement for every weapon.
  **22 of them fail on the iteration 9 poses.**
- `npm run check:poses` (the showcase's `poses` part) measures every model holding every item in
  the running game and exits non-zero on a fault. It passes: 12 of 12.
- The whole showcase is in `recordings/showcase10/`: sheets of the swords, bows and pickaxe
  through their motions, sparks, trails, poses and defences.

## 3. High ground

- **The problem:** towers picked targets in a **sphere**, so height *shortened* their sideways
  reach. Troops weighted height 1.5× in their target search, so an archer on a wall couldn't even
  pick an attacker below it.
- **The rule** (`balance.js` `reachAt`, `heightDamage`): R₀ is taken as half the shot's best flat
  reach.
  - reach = R₀·√(1+h/R₀), up to 1.5×: an arrow tower 8 up reaches 19.6, 16 up 22.6, capped at 24
  - damage × (1 + ½(√(1+h/R₀) − 1)): +11% at 8 up, +21% at 16, +25% at most; −10% at worst uphill
  - h is measured from a tower on its column on the ground, so **every ground tower plays as
    before**
- **Who gets it:** towers (flat reach and damage, `towerTarget`), troops and raiders (target
  search and reach), and your own shots (damage; the range was already physics).
- **Shown in the game:** a tower in hand shows its reach as a ring on the ground (`rangeRing.js`),
  and the recipe cards say "reach 16, up to 24 from high ground".
- **The map** (`recordings/map-10a/map.md`): t8-high (t1's 27 arrow towers raised 6 blocks)
  **holds through night 8**, where t1 holds through night 6: about two nights, as planned. The
  ground towns match iteration 9. Two caveats:
  - t8's pillars are natural stone, so attackers never went for them (0 of 27 towers lost); a
    player's cobble pillars would be attacked
  - the default town's night-10 cells failed in that run (a format-2 file on an older build).
    Rerun in `recordings/map-10a-n10`: lost twice, as in iteration 9
- **Not done:** the plan's lab clip of a high tower and a ground tower firing at the same
  approach. The unit tests and the map cover the numbers; nothing shows it side by side.

## 4. A world export is a world

- **Export world** writes only the name, description, seed (with its generator version and size),
  blocks mined and placed, troops placed, and your inventory as the starting kit
  (`start.inventory`). Format 2.
- The game in progress (survival or creative, daytime skirmishes, day, night, lives, position,
  inventory) is only in the browser's save behind Continue (`serializeSave`). Version 1 files and
  old autosaves still load.
- Survival/creative and skirmishes are picked when you start a world from the list: a new start
  panel. **Play** is unchanged: survival, no skirmishes.
- A world with no kit, or an empty one, starts with the standard kit. This fixes the empty-handed
  start of a world with edits.
- **The opening raid always plays** on a fresh survival start. Up to `OPENING_RAID.scripted` (260;
  the default town is 222) it's scripted to be lost, as before. A stronger town gets a real fight:
  no finale, reinforcements stop at 110 s, and the raid ends "held" when the last raider falls.
- The default world was regenerated in the new format; its start is identical, and tests prove it.

## 5. The castle video

**`recordings/castle10/castle.mp4`**: 29:47, 1920×1080, 30 fps, H.264 and AAC, 5.5 GB.
- `castle-share.mp4` is a copy at 2.1 GB (CRF 25) for sharing.
- 55 chapters, in the file and in `castle-chapters.txt`.
- `compare-final.jpg` puts the photo next to the finished castle. It reads as that castle by its
  palette and parts, but from above, not the photo's side view, and the tall tower doesn't stand
  out the way it does in the photo.

- **What it shows.** One survival game on seed `swan-rock-2946`:
  - the opening raid, then 19 days of the builder mining a quarry hall behind the castle,
    crafting, and building the castle from the aerial view, part by part: base course, outline,
    curtain wall, gatehouse, Palas, stair towers, knights' wing, square tower, tall tower
  - "The castle is finished" on day 19, a turn round it from above, and night 17
  - the bot plays by input only: the cursor on a block face, then a click, after checking the
    game's own aim
- **How it's cut** (`tools/autoplay/edit.mjs`, speeds solved to the target):
  - at 1×: key moments, meaning the start, the first seconds of each new part, each tower, each
    night's arrival and its busiest moment, and the finished castle
  - building and nights: 9×; dawns: 13×; mining, walking and waiting: 35×
  - a "▶▶ 9×" badge while sped up; a caption at each day, part and night
  - the sound on a sped-up stretch is real-time sound from within it, not sped up
- **The castle:**
  - 3,088 blocks in the blueprint and 23 archery towers: 20 ballistas, 2 crossbows, 1 arrow tower
  - 4 guard towers on the ground in the courtyard, 12 on the walls 5–8 blocks up, and 7 on the
    high places 11–16 up (the tall tower's gallery, the Palas, the square tower)
  - 64 cells of the blueprint (2%) are still gaps. The aerial camera couldn't see a face to build
    them against from any of four sides, so the bot gave up on them. They're visible up close,
    not from above.

**It is not the "very safe" castle you asked for,** and not a single unbroken run. Here is exactly
what happened:

1. **Nights 1–14 were safe.**
   - Nights 1–11 were won, eight of them with the Town Center above 1,400 of 2,500.
   - Night 12 was lost with only 10 towers up (a life lost).
   - From then on the bot put its towers up with the walls, and nights 12–14 were won with the
     Town Center never below 1,988.
2. **Nights 15–17 are a coin flip for this castle, whatever its defence.** Tested in the lab on
   the day-18 save, night 17 against the town as it was, and with more or less defence:

   | Defence (value) | Wave's extra budget | Attacker HP/damage | Result |
   |---|---|---|---|
   | as built (905) | 272 | ×2.02 | won (Town Center at 232), won (2,317); lost in the recorded run |
   | + 12 archers on the walls, + 4 swordsmen (1,241) | 406 | ×2.34 | lost in 70 s |
   | + 8 ballistas (1,177) | 381 | ×2.16 | lost |
   | − 5 of the far towers (735) | 204 | ×1.94 | lost |
   | − 9 of the far towers (599) | 149 | ×1.86 | lost in 37 s |

   The wave's extra budget grows with the defence (`WAVE_ADAPTIVE`, 0.4 per point from night
   10). The attackers over the cap of 140 are folded into HP *and* damage. So by night 15 more
   towers don't make a castle safer, and fewer make it weaker. That works against your "very
   safe" and against high ground late in a game. It's in §8 as a question for you; I didn't
   change the balance.
3. **So the video is one game, stitched from saves,** like a player reloading. Each piece is the
   game resumed through Continue from the previous piece's dawn save (`run.mjs --resume`). When
   a try lost its last life, I went back to the last good dawn and played that day again. The
   joins are seamless, and `edit.mjs` cuts each earlier recording at the save the next one
   resumed from.

   | Recording | Days | |
   |---|---|---|
   | `castle10-rec` | 1–13 | lost night 12 (3 → 2 lives) |
   | `castle10-rec2` | 13–16 | won nights 12–14 |
   | `castle10-rec7b` | 16–18 | won night 15, lost night 16 (2 → 1) |
   | `castle10-rec8a` | 18–19 | won night 16 |
   | `castle10-rec9b` | 19 | finished the castle, exported, won night 17 (Town Center down to 151) |

   Ten other tries were thrown away:
   - six lost night 17: four before the castle was done, and two after finishing and exporting
     it
   - four lost night 15 or 16
   - `castle10-rec8a` ran on past the dawn it's cut at. With 60 blocks to go, the bot spent two
     days idle waiting for cells it couldn't see. It now gives up on those in minutes, not days
     (§7).

   The video shows both lives lost on the kept path, captioned ("Night 12 lost · 2 lives left").
4. **What changed from the plan to make it finish:**
   - the tall tower is slimmer (ring radius 2.5 → 1.6) and the square tower lower (15 → 9)
   - the castle came down from about 4,200 blocks to 3,088
   - the plan's golden-hour orbit and "a last night at 1×" became a turn round the castle from
     above, in daylight, and night 17 at 9×, with its arrival and busiest moment at 1×

## 6. The export, and trying it as the starting point

**`recordings/castle10/castle-on-the-rock.world.json`**: the bot pressed P and clicked **Export
world** the moment the castle was finished, and the harness saved the download. The game's own
file is in `recordings/castle10-rec9b/`. The one in `castle10/` is the same with a description
written in, since the game has no field to type one.

- **In it (format 2):**
  - name, description, seed `swan-rock-2946` (terrain generator v1, 192 blocks)
  - 6,446 edits: 3,946 blocks placed (ashlar 2,325, slate 714, brick 424, cobble 215, windows
    160, copper roof 69, gates 8, iron walls 8, and the 23 towers), and 2,500 cells dug out (the
    quarry hall behind the castle and its stair)
  - the 2 starting troops, by the Town Center
  - no game: it loads as survival, day 1, 3 lives
- **The starting kit is generous.** It's what the builder held at the end: ashlar 39, **6
  ballista towers**, brick 6, cobble 5, copper roof 7, dirt 23, gate 2, **gold 76**, **iron 17**,
  log 4, planks 2, slate 12, wooden sword. As you asked, I didn't trim it. Edit the
  `start.inventory` line if you want a harder start.
- **Size:** 150.6 KB raw, 16.6 KB gzip, 9.4 KB brotli (the default world's budget is 50 KB).
- **Tried as the starting point** (`tools/autoplay/castle/deploy-test.mjs`: a scratch copy
  outside this checkout, with the file as `worlds/default.world.json`, built and measured):

  | | Desktop | Mobile (4× CPU) | Spec |
  |---|---|---|---|
  | menu interactive | 0.10 s | 0.19 s | |
  | first playable frame (median of 5) | **0.77 s** | **1.73 s** | 2–3 s, 4 s at most |
  | opening raid | 59.9 fps, min 55 | 59.9 fps, min 56 | |
  | a night | 60.0 fps | 59.6 fps (tier med) | |

  - **The opening raid** is a real fight at the castle's strength. It was held in 137 s: the
    Town Center wasn't touched, ballistas killed 45 of the 55 raiders, and the 548 blocks knocked
    down were rebuilt at dawn. A player sees "The raid is beaten off".
  - The clip is `recordings/castle10/deploy-test/raid/game.mp4`.
  - In the first try one raider got stuck, and the raid ran to the 5-minute cap, the same cap
    every night has.
- **What your branch needs** (deploy-test prints it too):
  1. `cp recordings/castle10/castle-on-the-rock.world.json worlds/default.world.json`
  2. In `tests/worldfile.test.js`, delete the test "committed default world matches its
     generator script" and the "the default world starts exactly as before" block. Both describe
     the valley.
  3. No budget change is needed.

## 7. Other changes along the way

- **Night count:** only built blocks within 3 of the ground under them count toward the night
  (`countsTowardNight`, `groundUnder`), so a castle's roofs and spires don't draw sappers. A test
  shows the default town and every map town count exactly the same.
- **Decorative blocks:**
  - white stone (`ashlar`), `slate`, `copper_roof`, `brick`, `window`, in a Decor row of the Build
    panel
  - two to a cobble and half as hard (0.6), so per cobble they hold like a stone wall: a cheaper
    look, never a cheaper defence. The plan had 1:1; halving the stone was needed to build a
    castle in survival (§5)
  - windows need sand
- **Tools:**
  - `castle/seeds.mjs`: the plaza is always at height 7 for every seed, so no seed has a crag
  - `castle/blueprint.js` (tested: buildable in order, closed, standing on the ground, spawn open)
  - `castle/preview.mjs` (`recordings/castle10/compare.jpg`)
  - `castle/deploy-test.mjs`
  - `bot/aerial.js` (building from the aerial view by the cursor, checking the game's aim before
    each click)
  - `bot/castle.js`
  - `edit.mjs` (the 30-minute cut, tested)
  - `run.mjs --seed / --resume / --checkpoint` and download capture
  - `load-test.mjs --dist / --port` (the port reached the server but not the page's address:
    fixed)
  - `aerialCam.js screenPoint` (tested)
  - `lab.mjs`: `--lab=siege:<path>:<night>` takes any world or save file
- **The castle bot, after the long recording:**
  - It gives up on a cell after 3 failures, retried at 60 s then 120 s. It used to take 4
    failures and double 240 s each time, which is about three game days.
  - A part counts as finished with its given-up cells missing.
  - A tower spot filled by a rebuilt wall no longer counts as pending.
  - It waits for the next retry instead of going home early.
  - It exports the moment the castle is done, before the show night.
- **`edit.mjs`, for joined recordings** (a test covers it):
  - each castle part is introduced once across them all
  - the 1× ending only at the very end
  - "Night N lost · N lives left" captions, and the day named where a resumed recording starts
  - the speeds solved again for the stretches folded in at 1× (the first cut came out at 33:53)
  - the concat list relative to its own folder (the first render's join failed)
  - the finished moment keyed for 6 s, the turn round the castle for 60

## 8. What to do next

1. **Late-night balance: your call.**
   - From night 15, a stronger castle doesn't do better (§5's table). Each defence point draws
     0.4 of a budget point of attackers, and the attackers over the cap of 140 come back as
     extra HP *and* damage. So towers, troops and high ground stop paying.
   - That goes against "castle feels very safe", and against Feature 1 late in a game.
   - Options:
     - lower `WAVE_ADAPTIVE.max` (0.4)
     - fold the extra into HP only, not damage
     - leave it: the late game is meant to end you
   - `--lab=siege:<save path>:17` now takes any save, so each option can be measured on the
     castle's day-18 save (`recordings/castle10-rec2/checkpoints/day-18.save.json`) in three
     minutes a run.
2. **The castle's 64 gaps** (2% of the blueprint): cells the aerial camera couldn't see a face of.
   A player would walk up and place them. The bot could do that too, as a last pass on foot.
3. **The bot builds slowly up high:** 83–240 blocks a day, the slowest on the tall tower's upper
   courses (one camera move per six-course band, and many retries).
4. **Disk:** the five source recordings take about 60 GB, both the WebM and the MP4. Once you're
   happy with the cut, their `game.webm` files can go; the MP4s are all a re-cut needs
   (`edit.mjs … --from-json`).
5. **The small things:**
   - the plan's side-by-side clip of a high and a ground tower (§3)
   - a raider stuck in the opening raid holds it to the 5-minute cap
   - the capture stutters for about 1 s while the export's download runs (in the cut, at 1×)
