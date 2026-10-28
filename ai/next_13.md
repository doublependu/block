# next_13: where iteration 13 got to

Answers `ai/prompt_13.md`, following `ai/plan_13.md` (take 2, with your addition: one sword swing
for every kind of sword). You didn't answer plan §10, so every default there stands. Nothing is
committed: it's all in the working tree.

`npm run check` passes (498 tests, 136 of them new; types clean; all ten GLBs valid), the build
budgets pass, and so do load time and frame rate on both profiles (§8).

**Look at these first** (all in `recordings/`, which git ignores):

- `showcase13/sword-stroke.jpg`: the one sword stroke, forehand and backhand, first person next to
  third, a row per sword (wooden, stone, iron, the swordsman's)
- `showcase13/sheet-match.jpg`: every weapon at rest, wound up, at the blow and at the end, first
  person next to third, for the builder, each troop and each attacker
- `showcase13/cheer.jpg`: a lost creative night: the winners cheering at dawn, then gone
- `hud13/phone-build.png`: the Build panel on a phone, the hotbar row and the inventory under it
- `target13/spikes-from-above.png`: spikes with no top face; `target13/mined-*.png`

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| Issue 1: NPCs half underground | **fixed** (§2): 0 buried in every run of the new check; the game as it was had them, up to 3 blocks deep |
| Issue 2: arm, hand, weapons; first person vs third; the iron sword waving | **fixed** (§3): every item and every model within the plan's limits, held there by a new test |
| Your addition: the same swing for every kind of sword | **done** (§3.2): one stroke for wooden, stone, iron and the swordsman's, in both views |
| Issue 3: creative, attack won: attackers lying down instead of cheering | **fixed** (§4): they cheer for 4 s, then leave, in every mode |
| Issue 4: mining spikes mines the block behind; spikes can't be removed; their top face | **fixed** (§5): the crosshair lands on spikes and gates; no top face |
| Feature 1: fork me on GitHub | **done** (§6) |
| Feature 2: the version | was done in iteration 12; the pause panel now links it to its commit (§6) |
| Feature 3: moving items between inventory and hotbar | **done** (§7): the hotbar inside the Build panel, tap then tap, touch too; the arrangement is saved |

---

## 2. Issue 1: nobody stands in the ground

**The cause,** as plan §0.1 had it: `unstuckY` only lifted a unit with its feet and its head in
blocks, so one block deep it stayed buried until its next walk. Two ways in: a dawn rebuild
putting a block back under someone, and units sliding through terrain that isn't loaded at the
height of the step they were heading for.

**The fixes:**

- **Lifted at once** (§1.1): a unit whose feet are in a solid block (more than 5 cm: physics rests
  a body a hair into the block under it) goes up to the first place it fits. The test is one pure
  function, `buriedDepth` (`src/game/ground.js`), which the check below uses too.
- **The rebuild moves whoever is in the way** (§1.2, `standAside` in `rebuild.js`): beside the
  block on its own level if there's floor and room, nearest first; onto it otherwise. Also on
  Skip.
- **Sliding through unloaded terrain** (§1.3, `_slideY` in `units.js`): a unit takes its height
  from the column it's in (the world's own blocks: generator, edits and damage, once per column),
  and changes level only when it crosses into the next one. When the terrain loads under it, it's
  set on its column's ground.

**The check** (`tools/autoplay/buried-check.mjs`): every living unit on every tick, in loaded and
unloaded terrain, through the opening raid and its dawn, night 9 and its dawn, and night 5 with
its dawn skipped. A night still on after 150 s is lost on purpose (the Town Center knocked down),
so its dawn has winners cheering and a rebuild.

| | unit-ticks | in unloaded terrain | buried |
|---|---|---|---|
| **the game as it was** (before this iteration; low, default world) | 143,886 | 9,956 | **8,517**: 125 in loaded terrain, 8,392 not (84% of the time there); up to 3.0 blocks deep; 26 units |
| **now**, default world (192): low / medium / high | 154,798 / 179,430 / 169,209 | 4,670 / 2,919 / 0 | **0 / 0 / 0** |
| **now**, a Large world (256, seed `buried-13`): low / medium / high | 70,473 / 79,201 / 62,021 | 1,178 / 1,954 / 71 | **0 / 0 / 0** |

Every run went through every scene (the check prints each scene's ticks, phases and attackers;
`recordings/buried13/check-final.log`). The Large world's runs are shorter because its nights
fell sooner.

The first buried units in the old game were the starting troops, 9 cm into the plaza a third of a
second into the game, then attackers sliding through hills 1 to 2 blocks deep. So both ways in
were real; I didn't catch the rebuild one in the old game, but it is covered now.

---

## 3. Issue 2: one way to hold and swing each weapon

### 3.1 The rule, and the test that holds it

First person is the reference (plan §2.1). `tools/hand-match.mjs` poses both views at the same
moments and measures them in the same frame (x right, y up, z ahead): first person from
`handPose.js`, third person from the GLB itself, with the item on the hand socket as
`src/characters/itemPose.js` puts it (the item table moved out of `library.js` so a test can read
it). `tests/handMatch.test.js` runs it for every item and every model that holds it (20 strokes,
92 tests). `node --import ./tools/node-ext.mjs tools/hand-match.mjs` prints the table.

| | the limit | today, worst | before |
|---|---|---|---|
| at rest, where the item points | 25° | 22° (bows), swords 1°, picks 5° | swords 67°, the sapper's pick 67°, the staff 46° |
| at rest, the forearm | 35° | 31° (the fire mage) | |
| wind-up, blow, end: the item and the forearm | 35° | 24° (the musket at its wind-up) | swords up to 141° |
| the tip's travel at the blow | 35° | 31° (the grunt's fist) | the iron sword 152° |
| the blow lands together | 0.05 s | 0.02 s (digging) | the wooden sword 0.14 s against 0.20 s |

- **A bare fist** (the grunt, the brute) is held to first person only through its strike: at rest
  its arm hangs and there's nothing to point.
- **The blows land together** because the game now plays each clip at the speed that lands its
  blow with first person's (`clipSpeed` in `handPose.js`, from the clips' key frames,
  `CLIP_KEYS` in `contract.js`): swords 1.08×, the shortbow's draw 1.79×, the recurve's 1.32×,
  the war bow's 0.98×. The test also checks each speed is between 0.5 and 2.
- **How the clips were made:** I modelled the rig in JS from the exported GLB (it reproduces the
  exported bone rotations exactly), fitted the bone angles to first person there, with costs that
  keep the poses natural (the shoulder and elbow do the work; small wrist, chest and twist angles;
  smooth from key to key), and wrote them into `make_characters.py` as raw bone angles. Then
  `npm run characters` with Blender 5.2.1, and the test on the real files. The fitting scripts
  were one-off; they're in `.temp/p13/`, which git ignores.

### 3.2 One stroke for every sword (plan §2.3)

- **The stroke:** a forehand from high right to low left, and on every second swing a backhand
  from low left to high right. Each is a turn of the forearm about one axis, so the blade sweeps
  through a plane like a spoke: a cut, not a wave. 0.36 s, the blow half way.
- **First person changed too.** Today's wooden slash, the one I meant to keep, failed the plan's
  own "cut" rule: its blade stood 56° out of the plane its tip swept. So I fitted a new stroke
  (`STROKE` in `handPose.js`): the tip passes the upper right, the crosshair and the lower left;
  the edge leads within 7° (the backhand with the other edge, within 3°).
- **A cut, not a wave,** in both views, every sword, both cuts:

  | | limit | first person | third person |
  |---|---|---|---|
  | blade against the forearm at the blow | ≤ 40° | 19° | 14–16° |
  | tip travel against the hand's | ≥ 1.5× | 2.1–2.4× | 2.3–3.8× |
  | blade out of the plane it sweeps | ≤ 30° | 12° | 12–16° |

- **Third person:** `attack` is the forehand and `attack_back` the backhand, in the two models that
  hold a sword (the builder and the swordsman), keyed every frame from the wind-up to the end so
  the tip follows first person's arc. `attack_heavy` and `attack_flourish` are gone. One pose in
  the hand for all four swords; the blade runs on from the forearm (it stood straight up out of
  the fist).
- **The combo:** a stroke started within 0.9 s of the last is its backhand (was 0.7 s), so a
  swordsman, striking every 0.8 s, alternates as you do. It's one rule (`nextStroke`) for your
  hands, your body and the swordsmen's; it used to live in the first-person view only, so your
  body never played a backhand.
- **What still tells the tiers apart:** the blade, the trail (now by sword, not by motion), the
  sound (and the iron sword's second one on the backhand), the stone sword's shake and the iron
  sword's sparks on a hit, the iron glint, and damage, cooldown and range, which don't change. The
  stone sword's beat where it landed went with its stroke.

### 3.3 The rest

- **At rest** (`hold_sword`): the forearm raised ahead, the blade ahead and up and a little in. The
  pickaxe and the sapper's pick use the same hold, so their poses in the hand were refitted with
  it, and so was **the chop**: the old one, a big swing from over the head, was 45–60° off first
  person's at its moments, so it's now a chop from the elbow, as first person's is. The plan said
  the pickaxe already matched; by the plan's own measure it didn't.
- **Bows** (`shoot_draw`): the bow arm stays out and the other hand draws to the chin; the string
  comes back with it (7 cm, `library.js`), as in first person. Every bow you hold uses it now
  (the shortbow too), and so do the archer models when you play one. Archers on their own keep
  the quick `shoot`, or their arrows would leave before the loose. The musket is unchanged.
- **Attackers in first person** (§2.4): the sapper's pick has the pickaxe's pose and chops; the
  fire mage's staff stands upright (the coal at the top), and a `cast` motion goes up, holds and
  thrusts. **Playing a fire mage now casts** (1.2 s of wind-up, the fireball goes where you look,
  following your aim while it gathers); it used to throw an error. The grunt and brute strike
  with a fist that comes down the way the body's arm does (`punch`, taken from their clip).
- **The fire mage's cast in third person** changed too: raised, its staff pointed straight
  backward (held across the forearm). Now it stays upright over the head.
- **The models:** all nine rebuilt. Compressed, 22–23 KB each (budget 150 KB). Raw, the
  archers and the swordsman grew 5.8 KB (their new clips), the builder shrank 3.1 KB (two sword
  clips became one), the rest grew 0.5 KB. Walk and run are untouched: the ground speeds measure
  the same. `items.glb` came out byte-identical.

---

## 4. Issue 3: the winners cheer

- **When the Town Center falls,** every attacker stops, turns to it and cheers, for 4 s (`DAWN.cheer`;
  dawn's pause before the rebuild was 1 s). Then a puff of dust each and they're gone, and the
  rebuild starts. Skip (N) skips the cheer too.
- **In every mode:** creative, survival with lives left, unlimited lives. The game-over ending is
  unchanged (they cheer and stay). A night survived by the clock still ends as before: sunrise
  takes them, and they fall.
- **A fireball being gathered** when the town falls is dropped, and so is **a sapper's lit fuse**
  (not in the plan; it would have gone off in the middle of the rebuild in the same way).
- `showcase13/cheer.jpg`: 14 of 14 cheering at 0.6, 2.2 and 3.8 s into dawn, none fallen; gone by
  day. Tests: what attackers do at dawn by result (`attackersAtDawn`), and the dawn's timing after
  a lost night in all three modes.

## 5. Issue 4: spikes and gates

- **The crosshair lands on everything you can build** (`targetable` in `blocks.js`): every solid
  block and every built one, so the four spikes and the three gates. Water and air don't count.
  Mining, building and the aerial view's build target use it; arrows, sight lines, melee and the
  camera still go by solidity (through a gate). An attacker you play strikes the gate it looks at.
- **Standing in a gateway** or on spikes, the cell your eyes are in is skipped. That needed one
  small patch to the vendored engine: its pick passes the voxel's coordinates to the test
  (`vendor/noa/UPSTREAM.md`).
- **So:** spikes and gates can be mined and come back to you, spikes upgrade on a click and gates
  on a hold, and you can't mine or build through a gate any more.
- **No top face** (and no bottom one): from above you look down between the spikes at the ground.
  The engine skips a face with no material, so no blank tile was needed.
- **Checked in the running game, by mouse** (`tools/autoplay/target-check.mjs`): spikes with stone
  behind them, mined: the spikes go and come back to you, the stone stays. The same with a gate.
  Spikes upgraded to iron spikes with a click. 9 of 9.

## 6. Features 1 and 2: fork me on GitHub, and the version

- **The line** at the foot of the menu card and of the pause panel: the GitHub mark and "Fork me
  on GitHub", and under it "open source, GPL-3.0". It opens `github.com/doublependu/block` in a new
  tab. The address is in one place, `package.json`'s new `repository` (read at build time). The
  mark is inline; the menu grew 0.6 KB (5.4 → 6.0 KB) and nothing new is fetched.
- **The version:** in the pause panel the line ends with it, linked to its commit on GitHub. The
  corner tag is as iteration 12 left it.
- **Checked** (`hud-check.mjs`, `recordings/hud13/`): on a desktop window and a phone upright and
  sideways, both lines are on screen, the links are right, and the version keeps its corner.
- **Fixed on the way:** on a phone held sideways the pause panel stood 10 px taller than the
  screen, both ends cut off (its height limit didn't count its padding). Panels now size by their
  border box. That narrowed them a little and showed an older fault: a recipe's text ran under its
  ×5 button, because the space kept for the button was overruled by the HUD's button padding.
  It isn't any more.

## 7. Feature 3: the inventory and the hotbar

- **The Build panel** has the hotbar row at the top and, under it, the inventory: what you own
  that isn't on the hotbar, then empty cells to the end of the row. Both stay pinned while the
  recipes scroll. Iron and gold show greyed.
- **Tap, then tap**, as the plan's table (`move` in `inventory.js`): the line under the rows says
  "Where to put this?" with the item's name and a Cancel; tapping it again or Esc cancels. 1 to 9
  still works, and so does the hotbar at the foot of the screen. The pickaxe moves but never
  leaves the hotbar.
- **Not in the plan:** an item you take off the hotbar stays off when you get more of it (digging
  would have put cobblestone straight back). Putting it back on makes it ordinary again.
- **Esc** with a highlighted item lets go of it; the next Esc closes the panel. The game's own
  Esc (the pause key) used to see it first and open the pause panel over the Build panel, which
  dropped the item, so a panel's Esc now stops there. On the way, the game-over card no longer
  closes on Esc either, as its comment always said it shouldn't.
- **Touch:** taps only; every slot at least 44 px; on a narrow phone the hotbar row wraps to 5
  and 4.
- **Saved:** a save keeps the hotbar (nine names, `docs/world-format.md`); Continue brings it
  back, and what you'd left off stays off. An older save fills it by rule. An export never carries
  it.
- **Checked:** `tests/inventory.test.js` (every row of the table, the pickaxe, a full hotbar,
  resources, the saved hotbar read back), `tests/worldfile.test.js`, and `hud-check.mjs` on the
  three screens: both rows fully on screen, and a scripted put, swap and take-off (touch on the
  phones). 27 of 27.
- The Controls panel says how.

## 8. Load and frame rate (spec)

| | desktop | mobile (4× CPU) | iteration 12 |
|---|---|---|---|
| menu interactive | 0.11 s | 0.19 s | 0.10 / 0.19 s |
| first playable frame (median of 5; 2–3 s, 4 s at most) | **0.97 s** | **1.51 s** | 1.02 / 1.41 s |
| the opening raid | 58 fps, longest frame 39 ms | 58 fps, longest 48 ms | |
| the night benchmark | 58 fps (high) | 57 fps (medium) | |

The game code grew 2 KB compressed (362.3 → 364.3 KB of 550). The buried check costs nothing in
the game; the lift is one block lookup per unit per tick, which `unstuckY` already made.

## 9. Changes by file

- **Issue 1:** `src/game/ground.js` (new: `buriedDepth`, `unstuckY`, `standY`), `units.js`
  (sliding, landing), `rebuild.js` (`standAside`, `clear`), `session.js` (`_clearCell`);
  `tools/autoplay/buried-check.mjs` (new)
- **Issue 2:** `src/game/handPose.js` (the stroke, `punch`, `cast`, key moments, `nextStroke`,
  `clipSpeed`, poses for the pick and the staff), `src/characters/itemPose.js` (new, out of
  `library.js`), `contract.js` (clips, `CLIP_KEYS`), `library.js` (the string's pull),
  `control.js` (`_playAction`, playing a fire mage), `units.js` (the swordsmen's combo, `castAt`),
  `viewModel.js` (trail by sword, the combo from its caller), `bladeTrail.js`, `balance.js`;
  `tools/blender/make_characters.py` and the nine models; `tools/hand-match.mjs`,
  `tools/node-ext.mjs` (lets node run the game's modules) (new); `docs/character-contract.md`
- **Issue 3:** `cycle.js` (`attackersAtDawn`, `cheering`, the dawn's lead), `balance.js`
  (`DAWN.cheer`), `session.js`, `units.js` (`celebrate`)
- **Issue 4:** `blocks.js` (`targetable`, spikes' faces), `placing.js` (`targetTest`),
  `control.js`, `registerBlocks.js`, `vendor/noa/src/index.js`; `tools/autoplay/target-check.mjs`
  (new)
- **Features:** `src/ui/fork.js` (new), `index.html`, `main.js`, `hud.js`, `hud.css`,
  `package.json`, `vite.config.js`, `env.d.ts`; `inventory.js`, `worldFile.js`,
  `docs/world-format.md`, `README.md` (the Build row of the controls); `tools/autoplay/hud-check.mjs`
- **Tests:** `tests/handMatch.test.js` and `tests/inventory.test.js` (new); `handPose`, `game`,
  `building`, `worldfile`, `version`
- **The showcase** (`showcase.mjs`): `match`, `stroke` and `cheer` sheets; it now runs as
  `node --import ./tools/node-ext.mjs tools/autoplay/showcase.mjs`

## 10. For you, and what's next

- **Watch the new sword stroke in play.** The numbers say both views agree and it's a cut, but
  only you can say whether it feels right. It's one table in each place (`STROKE` in
  `handPose.js`, `SWORD_CUTS` in `make_characters.py`); changing it means fitting the other to it
  again.
- **What I'd do next:** the problem plan §8 left for its own iteration. In terrain that isn't
  loaded, attackers walk through walls, gates and spikes, because those checks ask the engine,
  which answers "air" there (`navClient.js`). On low and medium quality, with the camera away
  from part of the town, that's a hole in the defence. Fixing it changes how those nights play,
  so I'd measure it in the lab first.
- **Smaller:** archers on their own still loose without drawing in third person (a drawn shot
  would need the arrow held back until the loose). And your builder swings the pickaxe with the
  sword stroke when it has no sword, as it always has.
