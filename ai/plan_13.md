# Plan 13: buried NPCs, weapons that match in both views, spikes, and three small features

Answers `ai/prompt_13.md`. Nothing below is implemented yet.

The prompt has four issues and three features. One of the features (the version tag) is already
in the game. In brief:

| Prompt | What I found | What I'll do |
|---|---|---|
| Issue 1: NPCs half underground | A unit one block deep in the ground is never lifted out; it jumps out at its next walk. Two ways in. Not reproduced in ordinary play (§0.1) | Lift any buried unit at once, close both ways in, and add a check that catches it (§1) |
| Issue 2: weapons, first vs third person | Swords are 66° apart between the two views at rest. Third person carries the iron sword upright and sideways (§0.2) | First person is the reference. Third person is rebuilt to show the same thing, and a test holds them together (§2) |
| Issue 3: winners lying down | Dawn kills every attacker, whoever won (§0.3) | After a lost night they cheer for 4 s, then leave (§3) |
| Issue 4: spikes | The crosshair passes through anything you can walk through: spikes and gates (§0.4) | The crosshair lands on everything you can build. No top face on spikes (§4) |
| Feature 1: fork me on GitHub | The repo is public | A link on the menu card and the pause panel (§5) |
| Feature 2: version tag | Done in iteration 12; shows `v.9b1d` today | Nothing to build. One question for you (§6) |
| Feature 3: inventory and hotbar | The Build panel covers the hotbar it asks you to tap | Hotbar inside the Build panel, tap-then-tap moves (§7) |

---

## 0. What I found before planning

I ran the game on your dev server (port 5173, HEAD `9b1d2d6`) in a headless browser and measured
it. No code was changed. The pictures are in `recordings/plan13/`.

### 0.1 Issue 1: half underground

**What it is.** `recordings/plan13/half-underground.jpg`: an archer standing one block lower than
the ground around it, buried to the waist. I made it by taking away the block under a standing
archer and putting it back.

- It stays buried for as long as it stands still. Nothing lifts it.
- When it gets its next walk, it jumps out: feet from 7.0 to 8.8 in 0.5 s, then it walks off.
  That is what you describe.
- **Why nothing lifts it:** `unstuckY` (`src/game/units.js:1564`) only acts when the feet and the
  head are both inside solid blocks. One block deep, the head is free.

**How a unit gets there.** I found two ways in the code:

1. **The dawn rebuild puts a block back where someone stands.** A block waits 3 s for the spot to
   clear, then comes back anyway (`rebuild.js:157`). Skip (N) puts everything back at once. The
   holes a unit can be standing in at dawn:
   - soft ground broken by an attacker that got stuck (any night)
   - ground dug by sappers (from night 5)
   - fireball craters (from night 7)
2. **Terrain that isn't loaded.** A unit there has no physics. It slides along the path, and its
   height is set to the *next* step's height (`units.js:1328`), so on every step down it is one
   block inside the ground. When the terrain loads under it, it is wherever it was.
   - Terrain loads this far from the camera: 48 blocks on low quality, 60 on medium, 84 on high.
     Attackers start 45 to 60 out.
   - Measured on low quality, night 9, default world: 17 of 38 attackers started in terrain that
     wasn't loaded. While there, their feet were in the ground 23% of the time, up to one block
     deep.

**What I could not do** is see it happen in ordinary play. On high quality, in the default world,
I watched every unit on every tick through the opening raid, its dawn, a day, and 45 s of night 1.
No unit's feet were in a block at any time, and 400 of 400 attacker start points were clear. On
low quality, 15 attackers crossed into loaded terrain and none was buried at that moment. So I
don't know which of the two ways you are seeing. The fix closes both, and §1.4 adds a check that
will show which it was. A question for you is in §10.

### 0.2 Issue 2: first person against third person

The two views are two separate pieces of work. First person is drawn from curves in
`src/game/handPose.js`. Third person plays clips made in Blender
(`tools/blender/make_characters.py`), with the item fixed to the hand by a second table in
`src/characters/library.js`. Nothing compares them.

I compared them: where the item points, and which way its tip travels at the blow. First person is
measured in the camera's frame and third person in the body's frame. The third-person numbers are
from iteration 10's `poses.json`; that code hasn't changed since.

| Item | First person | Third person | Apart |
|---|---|---|---|
| Swords at rest (all four, the swordsman's too) | blade ahead and up, toward the crosshair | blade straight up out of the fist | 66° |
| Wooden sword, the blow | tip cuts across the view and down | tip chops forward | 54° or more |
| Stone sword, the blow | down and forward | forward | about 45° |
| Iron sword, the blow | a sideways sweep | a sideways sweep, the blade upright | same direction |
| Pickaxe | upright, chops down | the same | 14° at rest, about 20° at the blow |
| Musket | barrel ahead | the same | 15° |
| Bows at rest | stave upright | the same | 24° |
| Bows, the draw | the string comes back, the stave stays | the whole bow comes back with the drawing arm | |

- **The iron sword "waving".** In third person the blade stands upright (0.96 up) while the arm
  carries it across the body. An upright thing moved sideways is a wave. A cut has the blade laid
  out from the arm, with the tip travelling much farther than the hand.
- **Attackers have no first-person poses.** When you play a sapper, its pick is posed as a sword,
  66° from where its body holds it. The fire mage's staff is too. The test that every item has its
  own pose only looks at defenders (`tests/handPose.test.js:184`).
- **Found on the way (read from the code, not run):** a fire mage you play can't cast. The fire
  button sends its attack down the arrow path, where `fireball` has no entry
  (`effects.js:148`), so it would throw an error instead of a fireball.

### 0.3 Issue 3: the winners lie down

- At dawn, every attacker still alive is killed, whoever won the night (`session.js:527`). Being
  killed plays the fall, so they lie down.
- They only cheer when the game is over (the last life gone) and after the scripted opening raid.
- Creative has no lives, so it never gets there. Neither does a survival game with lives left, or
  one with unlimited lives. In all three, a lost night ends with the winners lying down.

### 0.4 Issue 4: spikes

- The engine picks the block under the crosshair by asking "is it solid?"
  (`vendor/noa/src/index.js:244`). Spikes aren't solid, so your troops can walk over them. The
  crosshair goes through them and lands on the block behind. That block gets mined.
- **The same is true of gates.** Seven blocks can't be removed once built: spikes, iron spikes,
  steel spikes, ice spikes, gate, iron gate, steel gate.
- Their upgrades can't be reached either. "Click a higher tier onto spikes" and "hold on a gate"
  both need the crosshair on the block.
- The aerial view picks the same way, so it has the same fault.
- **The top face:** a spike block is drawn as a cube with the spike picture on all six faces. On
  top, that is the same picture lying flat.

### 0.5 Features

- **GitHub:** your `origin` is `github.com/doublependu/block`, and its page is public.
- **Version:** the tag shows `v.9b1d` on the dev server, bottom right, on the menu and in the game
  (visible in both pictures). It comes from Cloudflare's build variables, then from git.
- **Hotbar:** the Build panel is centred and up to the full height of the window, so it covers the
  hotbar. You click an item, the game says "press 1-9 or tap a hotbar slot", and the slots are
  under the panel. A phone has no number keys, so there it can't be done at all.
  - There is no way to empty a slot.
  - The hotbar isn't saved. A save keeps what you own, and Continue fills the hotbar again by
    rule, so an arrangement is lost on reload.

---

## 1. Issue 1: no unit stays in the ground

### 1.1 Lift a buried unit at once

- `unstuckY` acts when the feet are in a solid block, whatever the head is in. The unit goes to
  the first level above where it fits (two free cells).
- It already runs for every unit on every tick (`session.js:815`), and after the rebuild in the
  same tick. So a block that comes back under a unit lifts it before the frame is drawn.
- Gates, spikes and water aren't solid, so standing in them changes nothing.
- This ends what you see, whichever way the unit got there.

### 1.2 The rebuild moves whoever is in the way

- When a block's wait runs out (or on Skip), a unit in that cell is moved first: beside the block
  if there's a free spot on its level, on top of it otherwise.
- Sideways first matters for walls. A swordsman standing in a breach would otherwise ride the
  wall up as it's rebuilt and end on top of it.

### 1.3 Units follow the ground where terrain isn't loaded

- A unit sliding through unloaded terrain takes its height from the column it is in, not from
  the step it is heading for. It changes level when it crosses into the next column.
- When terrain loads under a unit, it is set on the ground of its column before physics takes
  over.

### 1.4 A check that catches it

- One pure function, `buriedDepth`, says how deep a unit's feet are in solid ground. The fix and
  the check both use it.
- The autoplay harness counts, on every tick, every living unit with its feet in a block, and
  saves a picture of the first one.
- Runs: the opening raid and its dawn; night 9 (sappers and fire mages) and its dawn; a dawn
  ended with Skip. Each on low, medium and high quality, in the default world and a Large one.
- **Pass:** no unit is buried on any tick, loaded terrain or not.
- Unit tests for `unstuckY`: feet only; under an overhang; a gate; spikes; nothing wrong.

---

## 2. Issue 2: one way to hold and swing each weapon

### 2.1 The rule

- **First person is the reference.** You chose its sword pose in iteration 11, and it is what you
  aim with. Third person is rebuilt to show the same thing from outside.
- The one exception is the iron sword. Its stroke changes in both views (§2.3).
- "The same" as numbers, for every item and every model that holds it:
  - **at rest:** the item points within 25° of where it points in first person
  - **through the stroke** (wind-up, blow, end): within 35°, and the tip travels within 35° of
    the same direction at the blow
  - **the forearm** points within 35° of the first-person arm
  - **the blow lands at the same moment,** within 0.05 s. Today the wooden sword lands at about
    0.14 s in first person and 0.21 s in third.

### 2.2 Third person: poses and clips

All of this is in `make_characters.py` and the item table, and every model gets it.

- **Swords at rest:** the forearm is raised ahead, and the blade runs on from it, ahead and up
  and a little in. Today it stands up out of the fist.
- **Wooden sword and the swordsman's:** a diagonal cut from the upper right to the lower left,
  across the body. Today it is a forward chop.
- **Stone sword:** high over the shoulder, straight down, and the beat where it lands. Close to
  today's; the blade's direction is brought in line.
- **Bows:** the arm holding the bow stays out and the other hand draws. The string comes back
  with it, as in first person. Today the bow rides back on the drawing arm.
- **Pickaxe and musket** already match. They stay, and the test keeps them there.

### 2.3 The iron sword

- **Both views:** two wide cuts with the blade laid out from the arm. A forehand from high right
  to low left, and on every second swing a backhand from low left to high right.
- **A cut, not a wave, as numbers:**
  - at the blow the blade is within 40° of the forearm's line
  - the tip travels at least 1.5 times as far as the hand
  - the blade lies within 30° of the plane it sweeps through
- Today's third-person stroke fails all three. The edge-leads tests stay as they are.

### 2.4 Attackers in first person

- **Sapper:** its pick gets the pickaxe's pose and the chop.
- **Fire mage:** the staff gets a pose of its own (upright, the coal at the top) and a `cast`
  motion: up, hold, thrust. Playing one casts as the AI's does: 1.2 s of wind-up, then the
  fireball goes where you aim. This also fixes the error in §0.2.
- **Grunt and brute** hold nothing. The fist comes down the way the body's arm does.
- The "every item has its own pose" test covers attackers too.

### 2.5 The test that holds them together

- New `tests/handMatch.test.js`. It reads each model file, poses the skeleton at a clip's key
  moments, and compares the item and the forearm with first person, by the rule in §2.1.
  `tools/anim-check.mjs` already poses these skeletons for the walk check.
- The third-person item table moves out of `library.js` into a small file of its own, so the
  test can read it without loading the engine.
- It fails today (66° at rest). It passes when the work is done.

### 2.6 Pictures to check it by

- `recordings/showcase13/sheet-match.jpg`: every weapon at rest, wind-up, blow and end, first
  person next to third, for the builder, each defender and each attacker.
- `recordings/showcase13/iron-sword.jpg`: the new stroke in both views, forehand and backhand.

### 2.7 The models

- All nine character files are rebuilt with `npm run characters`. Blender 5.2.1 is in
  `~/Downloads`.
- Each stays under its 150 KB budget; the clips keep about the same number of keys.
- Walk and run don't change, so the measured ground speeds stay.

---

## 3. Issue 3: the winners cheer

- **When the Town Center falls,** every attacker stops, turns to it and cheers. This is the
  cheer the opening raid already has.
- **For 4 s.** Dawn's pause before the rebuild is 1 s today; after a lost night it becomes 4 s.
  Skip (N) skips it.
- **Then they leave:** a puff of dust and they're gone, as the opening raiders go. No fall, and
  no death cries.
- **In every mode:** creative, survival with lives left, unlimited lives. The game-over ending
  doesn't change: they cheer and stay.
- **A night you survive** by the clock, with attackers still out, ends as now: sunrise takes
  them. They lost.
- A fireball being gathered when the town falls is dropped. Otherwise it would land in the
  middle of the rebuild.
- **Tests:** what happens to attackers at dawn, by result and mode (cheer then leave; fall;
  leave); the dawn's timing after a lost night.
- **Picture:** `recordings/showcase13/cheer.jpg`, a lost creative night.

---

## 4. Issue 4: spikes

### 4.1 The crosshair lands on everything you can build

- One function says what the crosshair can land on: every solid block, and every built one. So
  spikes, ice spikes and gates count. Water and air don't.
- First person and the aerial view both use it for mining and building.
- Everything else keeps the solid test: arrows, sight lines and the camera still pass through a
  gate.
- **Standing in one:** you can stand in a gateway or on spikes. The cell your eyes are in is
  skipped, so a gate you stand in doesn't block the crosshair.
- **What changes with it:**
  - spikes and gates can be mined, and you get them back
  - spikes upgrade on a click and gates on a hold, as the Build panel says they do
  - you can't mine or build *through* a gate any more: you hit the gate

### 4.2 No top face

- The four spike blocks lose their top face. From above you look down between the spikes at the
  ground.
- The bottom face goes too: it has the same flat picture, seen when a spike is left hanging.
- First try: give those faces no material, which the engine should not draw. If that doesn't
  hold, a blank see-through tile at the end of the atlas.
- The hotbar icon and the block in your hand use the side picture, and don't change.

### 4.3 Tests

- Every block you can place can be targeted: anything you build, you can take back.
- In the running game: spikes with stone behind them, mined: the spikes go, the stone stays. The
  same with a gate. Spikes upgraded with a click.

---

## 5. Feature 1: fork me on GitHub

- **The menu:** a line at the foot of the card, under the buttons: the GitHub mark and "Fork me
  on GitHub". Under it, smaller: "open source, GPL-3.0".
- **The pause panel:** the same line at its foot.
- It opens `github.com/doublependu/block` in a new tab. In the pause panel the game is already
  paused and the mouse free.
- The address is kept in one place (`package.json`'s `repository`, read at build time).
- **Load time:** about 0.6 KB of markup inside `index.html`. The mark is an inline drawing: no
  image, no font, no request.
- `hud-check.mjs` checks it on a desktop window and a phone, upright and sideways: it overlaps
  nothing, and the version tag keeps its corner.

---

## 6. Feature 2: the version tag

- This is word for word feature 1 of `prompt_12.md`, and it was built in iteration 12
  (`next_12.md` §2). It is in the bottom right corner of the menu and of the game, and reads
  `v.9b1d` today.
- So there is nothing to build. If it isn't what you see, these are the likely reasons:
  - **the deployed site is older:** your last local build (`dist/`, 2 October) carries `v.a137`
  - **it's hard to see:** 11 px, and dim
- **One small addition:** the fork line in the pause panel also shows the version, linked to
  that commit on GitHub.

---

## 7. Feature 3: moving items between inventory and hotbar

### 7.1 The Build panel

- **A hotbar row at the top:** the nine slots, as they look at the bottom of the screen.
- **The inventory under it:** what you own that isn't on the hotbar. It always ends in empty
  cells, at least one.
- Both stay pinned while the recipes scroll, so they are on screen together on a phone.
- Iron and gold show greyed: they can't go on the hotbar.

### 7.2 Tap, then tap

- **Tap an item in either:** it is highlighted, and a line appears under the two rows: "Where to
  put this?" with the item's name and a Cancel. Tapping it again, or Esc, cancels.
- **Then tap in the other:**

| Highlighted | You tap | Result |
|---|---|---|
| an inventory item | a hotbar slot with something in it | it takes the slot; what was there goes back to the inventory |
| an inventory item | an empty hotbar slot | it goes there |
| a hotbar item | an inventory item | they swap |
| a hotbar item | an empty inventory cell | it comes off the hotbar; the slot is empty |
| a hotbar item | another hotbar slot | they swap (not asked for, but expected) |

- **The current method stays:** with an inventory item highlighted, 1 to 9 puts it in that slot.
- **The pickaxe** can change slots but can't leave the hotbar. The game says so, as it does now.
- Outside the Build panel the hotbar works as now: a tap selects.

### 7.3 Touch

- Taps only, the same on a mouse and a finger. No dragging.
- Every slot is at least 44 px. On a narrow phone the hotbar row in the panel wraps to two rows
  (5 and 4) to keep that size.

### 7.4 The arrangement is kept

- A save keeps the hotbar: nine names. Continue brings it back. An old save without it fills the
  hotbar by rule, as now.
- An exported world doesn't carry it: a world's kit is what you own.
- `docs/world-format.md` gets the new field.

### 7.5 Tests

- New `tests/inventory.test.js`, on a pure `move` function: every row of the table, the pickaxe
  rules, a full hotbar.
- `tests/worldfile.test.js`: the hotbar survives a save and a load; an old save still loads.
- `hud-check.mjs`: with the panel open, the hotbar row and the inventory are both fully on
  screen, on a desktop window and a phone, upright and sideways. A scripted run with touch
  events: place, swap, take off.

---

## 8. What doesn't change

- **Balance.** The only number that changes is dawn's pause after a lost night (1 s to 4 s).
- **Worlds and the world file format.** A save gains one optional field (§7.4).
- **Load time.** `index.html` grows by about 0.6 KB and the game code by a few KB. No new
  requests. The models stay the size they are.
- **Frame rate.** The buried check is one block lookup per unit per tick, which `unstuckY`
  already makes.

**Found on the way, and not in this plan:** in terrain that isn't loaded, attackers also walk
through walls, gates and spikes. Those checks ask the engine, which answers "air" for anything
not loaded (`navClient.js:137`). It matters on low and medium quality when the camera is away
from part of the town. Fixing it changes how such nights play, so I'd measure it in the lab
first, in an iteration of its own.

---

## 9. Order of work

1. **Issue 4** (§4): targeting, the faces, tests.
2. **Issue 3** (§3): the cheer, tests, picture.
3. **Issue 1** (§1): the check first, run as the game is today. Then the three fixes, and the
   check again on three quality levels and two worlds.
4. **Features 1 and 2** (§5, §6): the link, `hud-check`.
5. **Feature 3** (§7): the `move` function and its tests, the panel, the saved hotbar,
   `hud-check` with touch.
6. **Issue 2** (§2), the largest:
   1. write the match test and see it fail
   2. the attackers' first-person poses, and the fire mage's cast
   3. the third-person poses and clips, the iron sword in both views
   4. rebuild the nine models, render the sheets, pass the test
7. `npm run check`, the build budgets, `npm run perf` and `perf:mobile`. Write `next_13.md` and
   `itr_13.md`.

---

## 10. Your choices

Each has a default. I'll go with the defaults for anything you don't answer.

1. **Issue 1: where do you see it?** Does `recordings/plan13/half-underground.jpg` look like it?
   Is it your troops or the attackers, on a phone or a PC, and in which world? This tells me
   which of the two ways in it is. *Default: fix both.*
2. **Issue 2: which view is right?** *Default: first person, and third person follows.* Say if
   you'd rather it went the other way for any weapon.
3. **The iron sword's new stroke.** *Default: two wide cuts, forehand then backhand, blade laid
   out from the arm.* The other option keeps the sideways sweep and only lays the blade into it.
4. **A look before the models are rebuilt?** I can stop at the contact sheet for your OK.
   *Default: no stop; the sheets come with the result.*
5. **The cheer:** 4 s, then they leave. *Default.*
6. **The GitHub link:** a line at the foot of the menu card and the pause panel. *Default.* The
   other option is the classic ribbon across the top right corner of the menu.
7. **The version tag:** is anything wrong with what's there? *Default: leave it, and add the
   commit link in the pause panel.*
8. **The inventory shows only what isn't on the hotbar.** *Default,* because it's what makes
   "move between" and "empty space" mean something. The other option keeps it showing
   everything you own.
9. **Save the hotbar's arrangement.** *Default: yes.*
10. **Attackers walking through unloaded walls** (§8). *Default: not now; next iteration.*
