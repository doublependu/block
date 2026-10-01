# next_11: where iteration 11 got to

Answers `ai/prompt_11.md`, following `ai/plan_11.md` with option A, as you chose in the chat: the
sword points ahead, toward the crosshair. Everything is in the working tree; nothing is committed.

`npm run check` passes (307 tests, 13 of them new; types clean; all nine GLBs valid), and so do the
build budgets.

---

## 1. The prompt

| Prompt | State |
|---|---|
| Issue 1: in first person, the sword is still held at 90° (`ref/sword-90.png`) | **fixed** (§2): all three tiers and the troop's sword now point ahead, toward the crosshair. Tests fail if the old pose comes back (§5) |

Pictures, at your screenshot's window size (1195×806):

- **`recordings/showcase11/sword-before-after.jpg`**: the wooden and iron swords, iteration 10 next
  to now
- **`recordings/showcase11/sword-before-after-phone.jpg`**: the same on a phone (390×844)
- **`recordings/showcase11/sheet-swords.jpg`**: every tier at rest and through its slash, plus the
  iron sword's glint and its backhand

`recordings/` is git-ignored, so these are only on this machine.

---

## 2. The new rest pose

What was wrong is in `plan_11.md` §0. In short: since iteration 8 the blade stood up out of the fist
and leant outward, lying across the screen. Iteration 10 only rolled it about its own length, which
doesn't change where it points.

Measured with the view model's own maths:

| | Iteration 10 (your screenshot) | Now |
|---|---|---|
| Blade vs. where you look | 84° | **41°** |
| Blade on screen vs. the line to the crosshair | 69° | **9°** |
| Tip from the aim | 24°, level with the crosshair, to its right | 11–13°, below and to the right |
| How much of the flat faces you (1 = full on) | 0.6 | 0.82 |

- **The pose** (`handPose.js` `ITEM_POSE`): `rot: [1.285, -0.158, 0]`, the same for every tier.
  - The pitch tips the blade forward out of the fist, and the yaw leans it in toward the crosshair.
  - The `roll` (1.016) turns the blade about its length so the flats face the sides. The inner
    flat turns toward you, the face the iron sword's glint runs up.
  - The tier scales are unchanged.
- **One change from the plan's picture:** `pos` is `[0, 0.03, 0]` rather than the picture's
  `[-0.02, 0.06, 0.02]`. With the picture's position the grip and pommel stuck out of the fist. Now
  the guard sits just over the fist, with the grip inside it.
- **The comment** that set iteration 8's pose ("canted across the view, so you see the blade") is
  gone. In its place, the rule: a sword points where you look.

---

## 3. The slashes, fitted again

With the blade along the forearm, turning the arm about its own length (`rz`) only spins the
blade. The old strokes relied on that turn to sweep the blade across the view. With the new pose
they chopped straight down on the right side, and the flat led again (cut angles of 60–89°).

**How I fitted them.** Each stroke is now built from `rx` (drop the tip) and `ry` (sweep it across).
`rz` is no longer used. I fitted each stroke so the tip passes three points on the screen: the
wind-up, the blow and the end of the slash. Then I solved the wrist `roll` so the edge leads.

Tip positions are given as screen fractions: 0 is the crosshair, ±1 the edge of the screen, and
negative y is below the crosshair.

| Stroke | Wind-up | Blow | End | Edge vs. the cut (iteration 10's test allows 20°, 25° off the blow) |
|---|---|---|---|---|
| wooden, quick diagonal | upper right (0.67, 0.44) | at the crosshair (0.10, −0.06) | lower left (−0.35, −0.77) | 0–3° |
| stone, heavy chop | high on the right (0.59, 0.76) | (0.12, −0.10) | straight down (0.00, −0.76) | 0–1° |
| iron, forehand | right (0.74, 0.29) | (0.03, −0.01) | left (−0.66, −0.44) | 1–7° |
| iron, backhand | left (−0.37, 0.30) | (0.10, −0.11) | right (0.85, −0.38) | 1–5° |

- **The iron backhand now has its own keys** (`FLOURISH.back`). The plan didn't call for this.
  - It used to be the forehand mirrored. The hand rests on the right, so a mirrored sweep can't
    reach both sides of the screen: the backhand ran from the middle off the right edge.
  - `armPose`, `handMatrix`, `wristRoll` and `heldMatrix` no longer take a mirror flag, and
    `rollBack` is gone.
  - A motion's `f(p, back)` returns the backhand's offsets directly.
- **Unchanged:** the trail and the glint ride on the blade, so they follow it. The timings, reach,
  damage and sounds are as before.
- **Checked by eye**:
  - every tier at both window sizes, with the bench pictures I rendered
  - a real swing of each sword in the running game, with no page errors

---

## 4. Found along the way: the iron combo never alternated

- **The fault:** holding the button with the iron sword played the backhand every time (logged:
  `back back back back back`). Its cooldown (0.45 s) outlasts its stroke (0.40 s). `play()` asked
  whether the previous stroke was still playing, and it never was. So the combo, and the second
  swing sound `swing_iron_b`, never changed between swings. This dates from iteration 8.
- **Fixed in `viewModel.play`:** a stroke started within `COMBO_GAP` (0.7 s) of the last one is
  its backhand. After a pause, the next swing opens with the forehand.
- **Logged now:** `fore back fore back fore` while held, and separate clicks each play the
  forehand. The sound alternates with it, because it reads the same flag.

---

## 5. So it can't come back

New in `tests/handPose.test.js`, under "swords point where you look", for all four swords at rest:

- **Where the blade points:**
  - within 55° of where you look (now 41°; iteration 10's pose was 84°)
  - on the screen, within 30° of the line to the crosshair (now 9°; was 69°)
- **The aim stays clear:** the tip is at least 6° from the aim (now 11–13°).
- **It never reads as a stick:** some of the flat shows, between 0.3 and 0.9 (now 0.82). This
  replaces iteration 10's "three quarters of the flat shows" test, which held the old pose in place.
- **The check catches the old pose:** iteration 10's pose, the one in `ref/sword-90.png`, fails it.

The 8 rest-pose tests failed on the old pose before the fix, as planned. The edge-leads tests from
iteration 10 are unchanged, and pass on the new strokes.

---

## 6. Changes by file

- **`src/game/handPose.js`:**
  - the swords' rest pose
  - the three strokes' keys
  - the backhand's own keys
  - `slash(k)(p, back)`
  - the mirror flag removed from `armPose`, `handMatrix`, `wristRoll` and `heldMatrix`
- **`src/game/viewModel.js`:**
  - plays the backhand's keys
  - the combo alternates (`COMBO_GAP`)
  - `pose(name, p, mirror)` for the showcase
- **`tests/handPose.test.js`:** the rest-pose tests (§5), and the cut check moved to `f(p, back)`.
- **`tools/autoplay/showcase.mjs`:** the swords sheet now takes in more of the view, since the
  slashes cross the crosshair, and adds a row for the iron backhand.

---

## 7. What to do next

1. **Try it in the game.** If the angle needs a nudge:
   - The knobs are `rot` in `ITEM_POSE`: the pitch tips the blade forward or back, the yaw leans it
     in or out.
   - The tests allow up to 55° from where you look and 30° off the crosshair line, so small changes
     won't trip them.
   - After a change, re-run `node tools/autoplay/showcase.mjs --only=hands --out=recordings/showcase11`
     and `npm test`. The edge tests will say if a stroke's `roll` needs solving again.
2. **The pickaxe** still stands straight up out of the fist, like your `a659d8c` sword (`plan_11.md`
   §2). I left it as it is. Say if you want it to point ahead too.
3. **Third person** is unchanged.
4. **Still open from iteration 10** (`next_10.md` §8): the late-night balance decision, the
   castle's 64 gaps, and the source recordings' disk use.
