# Plan 14: one body for both views, one sword slash, the old pickaxe chop, attackers that break walls

Answers `ai/prompt_14.md`. Nothing below is implemented yet.

The prompt has five items. Items 2 and 3 are the same question: why does first person have arms of
its own, and wouldn't using the body itself fix every mismatch? It would, so that is the core of
this plan (§1, §2). The other three items fit around it. In brief:

| Prompt | What I found | What I'll do |
|---|---|---|
| 1: one slash, from up to down | Every sword swings two cuts: a forehand, then a backhand on every second swing (iteration 13) (§0.2) | One overhead slash, the same for every sword. The backhand and the combo go (§3) |
| 2: first-person arms like third-person arms | First person draws its own arm: a thin box in a sleeve colour from a table. It isn't the body's arm, and it moves by its own curves. The fire mage has no entry in the table, so it gets the builder's blue sleeve (§0.1) | First person shows the body itself (§2) |
| 3: why a separate model? | The reason is the camera's narrow view, not the model. Measured in §0.1 | Use the same body, with one difference: first person looks at it from a point a little behind your eye (§1) |
| 4: an attacker you play can't damage walls | Its blow lands on the air in front of the wall. This has been wrong since iteration 0 (§0.3) | The blow lands on the wall and goes through the same code as an AI attacker's (§4) |
| 5: the pickaxe swing got worse | Iteration 13 swapped the big overhead chop for a short chop from the elbow, to match first person (§0.4) | The old chop comes back, in both views (§5) |

---

## 0. What I found before planning

I read the code and measured the character models in node. I didn't run the game for this plan;
§0.3 comes from reading the code. The measuring scripts are in `.temp/p14/`, which git ignores. No
game code changed. HEAD is `9aed7da`.

### 0.1 Why first person has arms of its own (items 2 and 3)

**What's there today:**

- **First person** (`src/game/viewModel.js`) is a box arm, 0.1 by 0.34 and scaled down by 0.42,
  with a box fist and the item. Its colour comes from a table (`FP_ARM`,
  `src/characters/contract.js:167`). Its motions are curves in `src/game/handPose.js`.
- **Third person** is the character model, with the clips from `tools/blender/make_characters.py`.
- **Iteration 13 tied them together by angles:** the item within 22° at rest and 35° through a
  stroke. They're close, but they're still two things:
  - the arm differs in shape, size and look. The body's arm has a sleeve, a forearm and a hand;
    first person has a stick and a fist.
  - every motion exists twice, so changing one means refitting the other. That's what happened to
    the pickaxe (item 5).
  - the table misses the fire mage, so playing one shows the builder's blue sleeve.

**Why games give first person its own arm.** I posed the body as the game plays it and looked from
its own eye. The game's view is 46° from top to bottom (Babylon's default; the game doesn't change
it):

| The body seen from its own eye | Where it lands on screen (x, y: ±1 is the edge) |
|---|---|
| a sword at rest | the hand at (1.2, −2.6): 0.43 m below the eye, well below the screen. Only the top of the blade shows, rising from the bottom edge |
| the sword's blow (today's clip) | the hand still below the screen; the blade passes 8 cm from the eye and fills the view |
| today's first-person sword at rest, for comparison | the hand at (0.45, −0.81), the tip near the crosshair |

- So from the eye you'd see a blade with no arm, and a slash too close to read. A game's view is
  much narrower than ours (46° here; we see about 120°), so hands held where a body holds them are
  out of the picture. That's the whole reason for separate first-person arms.
- **Two smaller reasons:** an arm drawn in the world goes into a wall you stand against, and the body
  doesn't tilt when you look up or down, so the sword would leave the screen.

**Looking from a little behind the eye** fixes the first one without touching the body:

| The same body, seen from | the hand at rest | the iron sword's tip at rest | the arm's width on screen |
|---|---|---|---|
| the eye | (1.2, −2.6), off screen | (0.02, 0.20) | 27° |
| 0.5 m behind the eye | (0.55, −1.15), just off the bottom | (0.01, 0.14) | 12° |
| 0.7 m behind the eye | (0.45, −0.95), where today's hand is | (0.01, 0.13), on the crosshair | 10° |

- Today's first-person arm is about 5° wide. The body's arm will look chunkier: it's the real arm.
- The iron sword's tip sits on the crosshair at rest, because the body holds every sword alike and
  the iron blade is the longest. First person shrinks the longer blades to avoid that. With one body,
  the rest pose has to clear the crosshair itself (§2.3).

### 0.2 The sword today (item 1)

- **Every sword swings two cuts** (iteration 13): a forehand from high right to low left, and a
  backhand from low left to high right when the next swing starts within 0.9 s (`nextStroke`,
  `COMBO_GAP`). Swordsmen alternate the same way.
- Two body clips (`attack`, `attack_back`, `SWORD_CUTS` in `make_characters.py:780`) and two
  first-person curves (`STROKE` in `handPose.js`). The iron sword has a second sound for the backhand.

### 0.3 An attacker you play does no damage to walls (item 4)

- **The cause:** when you play an attacker, the blow on a block is in `_unitAttack`
  (`src/game/control.js:969`). It asks the engine what the crosshair hits. The engine returns the
  point it hit, moved 1 cm off the face toward you, so that it rounds down to the empty cell in
  front of the block. `blockHit()` in the same file (`control.js:64`) turns that into the block, and
  everything else uses it. `_unitAttack` uses the raw point. So it reads the empty cell in front of
  the wall, finds air, and does nothing. The swing and its sound play before that, which is what
  you saw.
- **Since iteration 0** (`f2cdab3`), and for every melee attacker you can play: grunt, brute and
  sapper. Archers and the fire mage hit blocks with what they shoot, which is a different path.
- **Even with that fixed, the blow wouldn't match an AI attacker's** (`units.js:1450`
  `_attackBlock`):
  - it leaves out the night's damage multiplier, so a night 9 grunt you play would hit like a
    night 1 grunt
  - no brute splash, no freezing on ice, no bash or break sound, no "wall breached" alert
- **Its reach** is 3 blocks plus the camera's distance behind you. In third person that's 7.5 blocks.

### 0.4 The pickaxe (item 5)

- **Before iteration 13** (`9b1d2d6`): `mine` was 18 frames. The arm was raised overhead (150°
  forward), came down to 35° in front with the chest leaning in, and went up again. The pickaxe sat in
  the hand on its own pose (`PICK`, rolled 170°; the sapper's pick 140°).
- **Iteration 13** fitted the body to first person's chop: a short chop from the elbow, the upper
  arm staying at about 30°. The pick's pose in the hand was refitted with it. That's the change you
  noticed.

---

## 1. The answer to item 3: yes, one body

First person will show **the body itself**: the same model, the same clips, the same item in the
same hand. First person has no motion of its own any more, so the two views can't drift apart. That
covers the player, every defender and every attacker, since whoever you play is drawn from their own
body.

Three things are done differently in first person. None of them changes the pose:

1. **Where it's seen from.** The world is seen from your eye, as now. Your own body is seen from a
   fixed point a little behind it (the *vantage*, about 0.7 m back; fitted in §2.3), so your arm
   and what it holds are in the picture.
   - The other way to get the hands in view is to widen the view to about 90°. The whole game would
     look fish-eyed, and it would draw much more terrain, which costs frame rate on phones.
2. **Only the arms and the item are drawn.** From behind, the head and shoulders would block the
   view.
3. **It turns with your view,** up and down as well, and it's drawn over the world as today's hands
   are. So it never goes into a wall, and looking up or down doesn't lose the sword.

**What you'll notice:** the arm you see is the body's arm, so it's chunkier than today's (about 10°
of the screen against 5°). It has the model's colours and pixels: the builder's blue sleeve and
bare forearm, the swordsman's steel, the skeleton archer's bones, the fire mage's ember sleeves.

---

## 2. First person is the body (items 2 and 3)

### 2.1 How it's drawn

- **In first person, the body of whoever you control** (`u.char`) is attached to the camera,
  offset by the vantage, and drawn in the hands' render group (over the world, after its own depth
  clear) instead of in the world. In third person and from above it's in the world, as now.
- **Only the arms:** when a model loads, its triangles are sorted so the arms' (by the bone they
  move with) come last. First person draws only that range. It's still one mesh and one draw call,
  so there's no second model.
- **The item** is the body's own item mesh. When it's yours it's a copy rather than an instance,
  because an instance can't be drawn in a different render group from its source.
- **The grey box** that stands in until a model loads isn't shown in first person.
- **Facing:** the body turns exactly with the camera. Today a controlled body eases toward the
  camera's heading, which would make the arms lag when you turn.

### 2.2 What first person did on its own, and where it goes

These move to the body, so both views get them:

| Today, first person only | From now on |
|---|---|
| the sword's trail, from the motion's curve | `BladeTrail` (third person's, taken from the blade itself), in both views; in first person it's drawn with the body |
| the arrow on the string while drawing | on the body's bow, in both views (third person shows only the string today) |
| the musket's flash | on the body's musket |
| the iron sword's glint at rest | on the body's sword |
| the dig sound, chips and sparks on each chop | at the chop's blow in the body's clip, in both views (third person used a 0.36 s timer) |
| three bow draws (0.32, 0.42, 0.55 s) | the one draw clip, played at each bow's speed (a number per bow in `WEAPONS`), so each tier keeps its pace |
| a shot leaves from the item you see | the same. Seen from the vantage, the bow appears about 1.2 m ahead of your eye, against a wall that could be the far side of the wall, so the start is pulled back to your side of any block in between |

These stay first person only. They move the whole body as a camera effect and never change the pose:

- the dip and rise when you change item (0.24 s)
- the wider view when running, and the shake

These go:

- the arm and its motions in `viewModel.js`
- most of `handPose.js`: `STROKE`, `CHOP`, `DRAW`, `PUNCH`, `CAST`, the first-person item poses,
  `NOCK`, `clipSpeed`
- `FP_ARM` and `armColors`
- `tests/handMatch.test.js` and `tools/hand-match.mjs`, replaced by §2.4

### 2.3 The vantage, fitted

- **One vantage for every model,** measured from its eye and scaled with its size (the brute is
  1.24×).
- **Fitted as numbers** on the model files, for every model and every item it holds, on three
  screens: a desktop window (16:9), a phone sideways (19.5:9) and a phone upright (9:19.5):
  - **at rest:** the hand and the item are on screen, the hand in the lower right where today's is,
    and nothing covers the crosshair
  - **at every strike's blow:** the item's working end is on screen; a sword's blade crosses the
    crosshair
  - **never close:** no part of the arm or item comes within 25 cm of the vantage (closer than that,
    it fills the screen)
- **A phone held upright** has a narrow view. The vantage moves toward the right shoulder there,
  as today's hand moves in.
- **The rest pose** can change to keep the crosshair clear (the iron sword covers it today, §0.1).
  It's one pose now, so it's chosen to look right from both sides.
- **My first estimate** from §0.1: about 0.7 m behind the eye, at eye height.

### 2.4 Tests and pictures

- **`tools/fp-frame.mjs`** prints, for every model, item and moment, where the hand and the item
  land on the three screens. **`tests/fpFrame.test.js`** holds the conditions in §2.3. Both reuse
  the posing code from `hand-match.mjs`.
- **In the running game,** with the `showcase.mjs` sheets:
  - `recordings/showcase14/fp-sheet.jpg`: every model with its item, at rest, wound up, at the
    blow and at the end, first person next to third. They should plainly be the same body.
  - `recordings/showcase14/fp-screens.jpg`: first person at rest with each item, on the three
    screens.

---

## 3. One slash, from up to down (item 1)

- **One clip, `attack`, for every sword** (wooden, stone, iron and the swordsman's):
  - it starts high above the right shoulder, the blade up and back
  - it comes down through the crosshair to low in front, edge first
  - then it goes back to rest
  - same length as now, 0.36 s with the blow half way, which fits the shortest sword cooldown (0.4 s)
- **Both views by construction** (§2): first person shows the body's slash, seen from the vantage.
  The blade comes in from the top of the screen and goes down through the crosshair.
- **These go:** `attack_back`, the combo (`nextStroke`, `COMBO_GAP`), and the iron sword's second
  sound. A swordsman swings the same slash every time.
- **What still tells the tiers apart** (as in iteration 13): the blade, its trail, its sound, the
  stone sword's shake and the iron sword's sparks on a hit, the iron glint, and damage, cooldown
  and range.
- **Tests:** iteration 13's "a cut, not a wave" measures, now on the body's clip:
  - the blade within 40° of the forearm at the blow
  - the tip travels at least 1.5 times as far as the hand
  - the blade within 30° of the plane it sweeps through

  Added: the tip moves down at the blow, and every sword names the one clip.

---

## 4. Attackers you play break walls (item 4)

- **The blow lands on the block:** the crosshair's hit is read through `blockHit()`, as everything
  else reads it.
- **One function for a blow on a block,** `strikeBlock(u, x, y, z)` in `units.js`. The AI's
  `_attackBlock` and your `_unitAttack` both call it. So your blow does what an AI attacker's does:
  - the same damage, with the night's multiplier
  - the brute's splash, and freezing when you hit ice
  - the bash and break sounds, the cracks, and the "wall breached" alerts
- **Reach:** 3 blocks from your head, in both views. The camera's distance is no longer added.
- **Which blocks:** as now. Grunts and brutes break anything built. Sappers dig the ground too.
- **Tests:**
  - unit tests for `blockHit`, and for `strikeBlock` doing the same for you and for the AI
  - in the running game, `tools/autoplay/possess-check.mjs`. At night it plays a grunt, a brute and
    a sapper next to a cobblestone wall and holds the button down. Pass: the block cracks and then
    breaks, in first person and in third. It repeats this against a gate, and has an archer shoot
    the wall.

---

## 5. The old pickaxe chop (item 5)

- **`mine` exactly as before iteration 13** (from `9b1d2d6`): raised overhead, down with the chest
  leaning in, 18 frames, played at 1.2× (0.5 s a chop). It applies to every model, so the sapper's
  pick swings it too.
- **The pick in the hand as before:** `PICK`, rolled 170° (the sapper's pick 140°).
- **In first person too** (§2): the pick comes down from above the screen onto the block you're
  digging.
- **The dig sound and chips** land at the clip's blow (frame 8) in both views.
- **How long a block takes to dig** doesn't change, only how the chop looks.
- **Test:** the clip's keys are the old ones, and the fp-frame conditions hold for it.

---

## 6. What doesn't change

- **Balance.** Damage, cooldowns, ranges and digging times all stay. Two things do change:
  - an attacker you play now damages blocks as an AI one does. Until now its blows on blocks did
    nothing.
  - its block reach in third person drops from 7.5 to 3 blocks
- **Load time.** Nothing new is fetched.
  - The models get a little smaller: `attack_back` goes from the builder and the swordsman.
  - The game code gets smaller: most of `viewModel.js` and `handPose.js` goes.
  - Your arms show once your model has loaded. Today's arm is there from the first frame. The world
    is playable before that, so it's progressive load, which the spec allows.
- **Frame rate.** First person draws your body's arm range and the item instead of four boxes and
  the item. That's about the same. I'll measure it with `perf` and `perf:mobile`.
- **Walking and running clips,** and the ground speeds measured from them.
- **Worlds and saves.**

---

## 7. Order of work

1. **Item 4** (§4): it's small and stands alone. The fix, `strikeBlock`, the tests and
   `possess-check`.
2. **The body in first person** (§2.1, §2.2), with today's clips: the arm range, attaching it to the
   camera, the render group, and moving the trail, arrow, flash, glint and chop timing to the body.
3. **The vantage** (§2.3): `fp-frame.mjs` and its test, fitted on the three screens.
4. **The slash** (§3) and **the old chop** (§5) in `make_characters.py`, and the rest pose,
   checked from the vantage.
5. **Delete the old first-person arm** and the code only it used.
6. **Rebuild the nine models** with `npm run characters` (Blender 5.2.1) and render the sheets.
7. **Checks and write-up:** `npm run check`, the build budgets, `npm run perf` and `perf:mobile`.
   Write `next_14.md` and `itr_14.md`.

---

## 8. Your choices

Each has a default. I'll go with the defaults for anything you don't answer.

1. **Where first person looks at your body from** (§1). *Default: a little behind your eye, arms
   only.* The other options:
   - exactly from the eye. Every rest pose would then hold the item up in front of the face, or it's
     off the screen (§0.1), and that looks stiff from outside.
   - keep separate first-person arms. You asked for the opposite, so I don't recommend it.
2. **The arm's size on screen.** *Default: what the vantage gives (about 10°), chunkier than today.*
   A smaller arm means a vantage farther back, which makes everything in the hand smaller too.
3. **The slash** (§3). *Default: from above the right shoulder, down through the crosshair.* The
   other option is a diagonal from high right to low left, like today's forehand but without the
   backhand.
4. **The pickaxe** (§5). *Default: the old chop exactly, in both views, with the swords' rest
   pose,* as before iteration 13.
5. **Grunts and brutes at rest.** They hold nothing, so their arms hang and first person shows
   nothing until they punch. *Default: fists raised at rest, in both views,* so you see them. The
   other option is arms down.
6. **The builder with nothing in hand** (a troop selected). *Default: nothing on screen,* as the
   body shows from outside. Today you'd see two fists.
7. **Sword reach in third person.** Your sword's hit test also adds the camera's distance
   (`control.js:890`): a wooden sword reaches 8.7 blocks in third person against 3.7 in first.
   *Default: fix it with the block reach in §4,* so both views reach the same.
8. **A look before the models are rebuilt.** I can stop once the vantage is fitted and send you the
   first-person pictures. *Default: no stop; the sheets come with the result.* This is the one
   iteration where a look early could save a redo, because the arm's look changes most.
