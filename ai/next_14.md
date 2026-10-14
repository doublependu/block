# next_14: where iteration 14 got to

Answers `ai/prompt_14.md`, following `ai/plan_14.md`. You didn't answer plan §8, so every default
there stands. Nothing is committed: it's all in the working tree.

`npm run check` passes (521 tests; types clean; all ten models valid), and so do the build budgets.
Load time and frame rate match the last commit's build, measured side by side (§7).

**Look at these first** (all in `recordings/`, which git ignores):

- `showcase14/sword-slash.jpg`: the slash at rest, wound up, at the blow and at the end, first person
  next to third, a row per sword (wooden, stone, iron, the swordsman's)
- `showcase14/sheet-match.jpg`: the same for every weapon, the builder, each troop and each attacker
- `showcase14/fp-screens.jpg`: first person at rest with each kind of item, on a desktop window, a
  phone held sideways and one held upright
- `showcase14/sheet-sparks.jpg`: first person digging, the old chop
- `possess14/`: a grunt, a brute and a sapper you play, at the wall they break

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| 1: one slash from up to down | **done** (§3): one slash for every sword; the backhand and the combo are gone |
| 2: first-person arms like third-person arms | **done** (§2): first person is the body |
| 3: why a separate model? | **done** (§2): one model, seen from a point behind your eye |
| 4: an attacker you play doesn't damage walls | **fixed** (§4): in the old game 2 of 10 wall tests broke the block; now 15 of 15 |
| 5: the pickaxe swing got worse | **done** (§5): the chop from before iteration 13, exactly, in both views |
| Found on the way: troops' arms hung whatever they held | **fixed** (§6): since iteration 0 |

---

## 2. Items 2 and 3: first person is the body

There is no first-person arm any more. Whoever you control is drawn by the camera: the same model,
clips and item as from outside. Nothing in first person moves on its own, so the two views can't
disagree. It covers your builder, every troop and every attacker you play.

**How** (`src/game/firstPerson.js`, `src/game/fpView.js`, `library.js` `setFirstPerson`):

- **The body hangs from the camera**, so it turns with your view, up and down too.
- **It's seen from the vantage:** 1 m behind your eye, 4 cm to the right, at the eye's height, scaled
  with the body (the brute's is higher and further back). The world is still seen from your eye.
  - The plan guessed 0.7 m. From there the raised hand of the slash filled a quarter of the screen,
    so I moved it back to 1 m and refitted the poses for it.
  - On a phone held upright it moves 4 cm more to the right and 70 cm further back, so the hand stays
    on screen and the slash still crosses the crosshair.
- **Only the forearms and hands are drawn,** with what they hold, over the world. The plan said the
  arms; from behind, the upper arms were big blocks in both bottom corners. It's still one mesh and one
  draw call: at load its triangles are sorted so the forearms' and hands' come last.
- **What you'll see:** your character's own arm, in its colours. Your hand at rest is about 6–7° across
  (today's arm was about 5°; the plan guessed 10°). The fire mage's ember sleeves, the brute's red
  fists, the skeleton archer's bones. (The table of first-person sleeve colours is gone, and with it the
  fire mage's blue sleeve.)

**What first person used to do on its own, now on the body** (so in both views):

- **The sword's trail:** third person's, from the blade itself; drawn with the body in first person.
  The swordsman you play leaves one too.
- **The arrow on the string** while a bow is drawn. Third person showed only the string.
- **The musket's flash,** now a small hexagon of light rather than a square, and every gunner has it.
- **The iron sword's glint** at rest, on the body you control.
- **The dig sound and chips** land when the body's chop lands, in either view. Third person used a
  timer.
- **Each bow's pace:** the one draw clip, at a speed per bow (`drawSpeed` in `balance.js`). The loose
  still comes at 0.22, 0.30 and 0.41 s.
- **A shot leaves the item you see.** That's about a metre ahead of your eye, so against a wall the
  start is pulled back to your side of it.
- **Changing item:** the whole body dips out of view and comes back up (a camera move, not a pose).

**Your arms at rest, in first person:** a block, the fire mage's staff and the fists were below the
screen. Now:

- `hold_item` is raised a little, so a block and the staff show.
- The block in your hand now has its own texture in both views.
- The grunt and the brute hold both fists up (`hold_fists`, new).

**The numbers** (`node --import ./tools/node-ext.mjs tools/fp-frame.mjs`, held by
`tests/fpFrame.test.js` on all three screens):

- **At rest:**
  - every hand and every item on screen, the hand in the lower part
  - nothing within 0.04 (tan) of the crosshair: twice the crosshair's own size
  - nothing within 25 cm of the vantage (the nearest is 0.71 m)
- **At the blow (or the loose):** what's held is on screen. The chop is the exception (§5).
- **Swords:** the hand at (0.37, −0.73) of the half-screen and the tip at least 0.22 from the
  crosshair; the slash's blade crosses it.

**Gone:** `viewModel.js`, `handPose.js`, `tools/hand-match.mjs` and its test. What still applied from
`tests/handPose.test.js` moved to the body, in `tests/fpFrame.test.js`: the edge leads, the string is on
the archer's side, the musket points ahead, every item has a pose, and the `items.glb` axes.

## 3. Item 1: one slash, from up to down

- **One clip, `attack`,** for wooden, stone and iron swords and the swordsman's. 0.37 s, wound up at
  0.10 s, the blow at 0.17 s. It fits inside the shortest cooldown (0.4 s).
  - It starts with the sword high above the right shoulder, the hand up in front of the head.
  - It comes down edge first and ends low in front.
- **Its plane is turned 40° to the left of straight ahead.** You see your body from behind its head,
  and a cut straight ahead is seen end on: the hand hides the blade. Turned, the blade comes in at the
  top of the screen, lies across the crosshair at the blow and leaves at the bottom. From outside it's
  an overhead cut from the right shoulder to the front left.
- **A cut, not a wave** (iteration 13's measures, now on the body's clip):

  | | limit | now |
  |---|---|---|
  | blade against the forearm at the blow | ≤ 40° | 36° |
  | tip travel against the hand's | ≥ 1.5× | 3.1–4.2× |
  | blade out of the plane it sweeps | ≤ 30° | 2–3° |
  | the tip's travel at the blow, downward | | 100% |
  | the edge leads | ≤ 15° | 8° |

- **Gone:** `attack_back`, the combo (`nextStroke`, `COMBO_GAP`) and the iron sword's backhand sound.
  A swordsman swings the same slash every time.
- **The sword at rest** stands up at the bottom right, a little in. It's clear of the crosshair even
  for the iron sword, the longest.

## 4. Item 4: an attacker you play breaks walls

**The cause** was worse than the plan said (`_unitAttack`, there since iteration 0):

- The engine's hit point sits 1 cm off the face, on your side. The code read the block there without
  rounding.
- The engine reads a fractional position by cutting off the fraction (toward zero). So it found the
  wall only when the wall's coordinates were negative and you faced one particular way. Everywhere
  else it found the air in front.
- Even then the damage was stored under that exact fractional point. It only added up if every blow
  hit the very same spot, so only a blow that breaks the block at once (the brute's on cobblestone)
  ever did anything.

**The fix:**

- The blow reads the block the way everything else does (`blockHit`, now in `placing.js` and tested).
- It goes through one function with the AI's blows (`strikeBlock` in `units.js`):
  - the same damage, with the night's multiplier, which your blows didn't have
  - the brute's splash, and freezing on ice
  - the bash and break sounds, the cracks, and the "wall breached" alert
- **Reach:** 3 blocks from your head. It had added the camera's distance, 7.5 blocks in third person.
  A sword's reach on attackers had the same fault: a wooden sword reached 8.7 blocks in third person
  against 3.7 in first. Both are now the same in either view (plan choice 7).

**The check** (`tools/autoplay/possess-check.mjs`, new). It runs in the game, by mouse, with the aim
wobbling a little between blows as a hand's does:

| | the last commit's build | now |
|---|---|---|
| grunt on cobblestone, facing either way | never cracked | broken after 7.2 s |
| brute on cobblestone | broken (one blow) | broken (one blow) |
| sapper on cobblestone | never cracked | broken after 2.9 s |
| grunt on a gate | never cracked | broken after 5.2 s |
| sapper on the ground / grunt on the ground | | dug / untouched |
| a skeleton archer's arrows on a wall | | cracked after 0.2 s |

All in first and third person: 2 of 10 wall tests passed before, 15 of 15 now. The check also asks each
attacker you play whether it holds its hold pose (§6): 3 of 3.

## 5. Item 5: the old pickaxe chop

- **The `mine` clip is as it was before iteration 13,** key for key: raised overhead, down in front
  with the chest leaning in (the blow at frame 8), and up again. It plays at 1.2×, half a second a
  chop. Every model has it, so the sapper's pick swings it too.
- **The pick sits in the hand as before:** the same pose, rolled 170° (the sapper's 140°).
- **At rest too, as before.** The pick and the sapper's pick have their old hold back (`hold_pick`,
  the sword's hold until iteration 13).
  - The plan's default was the swords' new rest pose. With that, the pick lay across the body pointing
    left and back.
  - A model without `hold_pick` falls back to `hold_sword`.
- **In first person:** the pick comes down from above the screen through the middle and lands below
  the crosshair. On its way back up, the raised head passes about 1 m in front of the vantage and
  covers part of the middle of the screen for a moment, once a chop (`sheet-sparks.jpg` at 320 ms).
  That's the old swing seen from behind your head. See §8.
- **Digging time doesn't change;** the dig sound and chips land at the chop's blow.

## 6. Found on the way: troops' arms hung whatever they held

- **What:** every troop and attacker played its hold pose, but the pose never reached its arms.
  Swordsmen and sappers held their swords and picks hanging at their sides.
  - I confirmed it on the last commit's build: a swordsman's upper arm sat at its rest rotation, not
    at the hold's.
  - Your builder was fine, because its item changes after it loads, which happened to let the hold win.
- **Why:** the masks that keep walking and standing off the arms were made disabled in iteration 0
  and never enabled. So the two clips fought over the arms, and the one that started first won.
- **Now** the masks work. A cheer and a fall take the arms back from a hold, so the winners still
  raise their arms at dawn: a grunt's arms follow the cheer while it plays, and its fists come back up
  after. `possess-check` checks that each attacker you play holds its pose. `showcase14/cheer.jpg`:
  14 of 14 cheering at dawn, gone by day.

## 7. Load and frame rate (spec)

Measured today, the last commit's build the same way, one after the other:

| | now | the last commit | iteration 13's note |
|---|---|---|---|
| desktop: menu interactive | 0.12 s | 0.12 s | 0.11 s |
| desktop: first playable frame (median of 5) | **0.94 s** | 1.00 s | 0.97 s |
| mobile (4× CPU): first playable frame (median of 5) | **1.50 s** | | 1.51 s |
| desktop: the opening raid | 143 fps, longest frame 49 ms | 143 fps, 42 ms | 58 fps |
| desktop: the night benchmark (high) | 143 fps | 144 fps | 58 fps |
| mobile: the opening raid / the night benchmark (medium) | 139 / 88 fps | | 58 / 57 fps |

- The frame rates today aren't held to the screen's 60 Hz as in iteration 13, so they only compare
  with the column beside them.
- The first load after a build was 2.5 s (shaders not yet cached); the medians are what the spec
  means.
- **The game code got 2.6 KB smaller** (364.3 → 361.7 KB of 550). The models are 22–23 KB each
  compressed (budget 150 KB). The player's model already loads before the first playable frame, so
  your arms are there from the start.

## 8. For you, and what's next

- **Look at the slash and the arms in play.** It's one table each in `make_characters.py`
  (`SWORD_SLASH`, `HOLD_SWORD`) and one in `fpView.js` (`VANTAGE`).
  - To change a pose, refit it with `tools/fp-frame.mjs` (the fitting scripts are in `.temp/p14/`,
    which git ignores), then `npm run characters` and `npm test`.
  - The vantage sets how big your arm looks: further back is smaller.
- **The chop's raised head passes before your eyes once a chop** (§5). If that bothers you while
  digging, two ways out, your call:
  - a lower raise for the pick, in both views
  - the old swing in third person and a smaller one in first, which would bring back two motions
- **What I'd do next:** iteration 13's leftover. In terrain that isn't loaded, attackers walk through
  walls, gates and spikes, because those checks ask the engine, which answers "air" there. Measure it
  in the lab first.
- **Smaller:** AI archers still loose without drawing (`shoot`, not `shoot_draw`). A drawn shot needs
  the arrow held back until the loose.

## 9. Changes by file

- **First person is the body:**
  - `src/game/firstPerson.js` and `src/game/fpView.js` (new)
  - `src/characters/library.js`: `setFirstPerson`, arms-only drawing, the held block, the arrow on
    the string, the musket's flash, the glint, counting chops, `muzzle`, the hold masks
  - `control.js`, `bladeTrail.js`, `itemPose.js` (`itemRotation` moved here, `NOCK`, `BLOCK_SIZE`),
    `contract.js` (`FP_BONES`, `reaches`, `hold_fists`, `hold_pick`, `CLIP_KEYS`), `balance.js`
    (`drawSpeed`), `constants.js`, `session.js`
  - removed: `src/game/viewModel.js`, `src/game/handPose.js`
- **The slash:** `make_characters.py`, `units.js`, `sounds.js`, `levels.json`; the nine models rebuilt.
- **Item 4:** `placing.js` (`blockHit`, `strikable`, `BLOCK_REACH`), `units.js` (`strikeBlock`),
  `control.js`; `tools/autoplay/possess-check.mjs` (new).
- **The chop:** `make_characters.py` (`CHOP`, `HOLD_PICK`), `itemPose.js` (`PICK`).
- **Tools and tests:**
  - new: `tools/fp-frame.mjs`, `tests/fpFrame.test.js`
  - changed: `tests/building.test.js`, `game.test.js`, `sound.test.js`, `feedback.test.js`
  - removed: `tools/hand-match.mjs`, `tests/handPose.test.js`, `tests/handMatch.test.js`
  - `showcase.mjs`: `match`, `slash` and `screens` sheets
  - `bot/tests.js` and `castle/preview.mjs` no longer use the old first-person view
- **Docs:** `docs/character-contract.md` (first person, layering, the clips).
