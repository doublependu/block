# Plan 11: a sword that points where you look

Answers `ai/prompt_11.md`. Nothing below is implemented yet.

The prompt has one issue: in first person, the sword is still held at 90° (`ref/sword-90.png`).

---

## 0. What I found before planning

### 0.1 What "held at 90" is

I measured the wooden sword's rest pose with the maths the view model draws with
(`src/game/handPose.js`). The numbers match your screenshot: the tip sits level with the crosshair,
24° to its right.

- The blade points **84° away from where you look**. It stands up out of the fist and leans
  outward to the right, so it lies across the screen instead of reaching ahead into the scene.
- On screen, the blade runs **69° away** from the line toward the crosshair. It also crosses the
  forearm at about a right angle.
- Every tier is posed the same way (within 0.04 rad), and so is the troop's `sword` when you
  control a swordsman.

### 0.2 Why iteration 10 didn't fix it

- **Iteration 8 laid the blade across the view on purpose.** The pose comment says "canted across
  the view, so you see the blade instead of the end of it". The tilt `rz = −0.42` leans the blade
  outward, to the right. That is the 90°.
- **Iteration 10 read "90° off" as a different fault:** the flat of the blade leading the cut. It
  rolled each blade about its own length: −0.35 at rest, plus a wrist roll during the swing. A roll
  about the blade's length doesn't change where the blade points, so at rest it looks almost the
  same as before. The slash fix is real, but it wasn't the fault you reported.
- **The tests passed on the pose in your screenshot.** The iteration 10 tests check which face of
  the blade leads the cut. They also fix the rest pose at "three quarters of the flat shows"
  (`tests/handPose.test.js:65`). Nothing checks where the blade points, so `npm run check` passed
  on exactly this pose.

None of the sword's poses so far has pointed ahead:

| When | Pose (`rot`, roll) | Blade vs. where you look |
|---|---|---|
| iterations 0–4 | `[-1.1, 0.25, 0.15]` | 167°: back toward you |
| your `a659d8c` | `[0, 0, 0]` | 107°: straight up out of the fist |
| iteration 8 | `[0.3, 0, -0.42]` | 84°: up, leaning out to the right |
| iteration 10 | the same, roll −0.35 | 84°: unchanged |

### 0.3 Four candidates, rendered

I made these with the current build, at your screenshot's window size (1195×806). Only the
sword's rotation was set in the running game; no code was changed. Two pictures:

- **`recordings/plan11/candidates.jpg`**: today's pose and the four candidates
- **`recordings/plan11/phone.jpg`**: today's pose and A on a phone (390×844)

The full frames are in `recordings/plan11/frames/`.

| | What it looks like | Blade vs. where you look | On screen vs. the line to the crosshair | Tip from the aim |
|---|---|---|---|---|
| **now** | your screenshot | 84° | 69° | 24°, to the right |
| **A ahead** (recommended) | reaches ahead and up toward the crosshair, in line with the forearm, like Minecraft's held sword | 41° | 10° | 8–11°, below right |
| **B ahead, upright** | between A and today: more upright, still leaning in | 57° | 24° | 10–12° |
| **C leaned in** | today's pose leaned the other way, still lying across the view | 90° | 24° | |
| **D your `a659d8c`** | straight up, for reference | 107° | 58° | |

- **In A and B**, the flats face sideways and the lower edge faces down. A forward-down slash then
  leads with the edge by itself.
- **In C**, you see the whole flat, as now.

---

## 1. The fix

### 1.1 A new rest pose for the swords (A unless you pick another)

- **Which poses:** `ITEM_POSE.sword`, `wood_sword`, `stone_sword` and `iron_sword`. Each gets new
  `rot` and `roll` values that give A's direction:
  - in camera space, the blade points along (−0.35, 0.55, 0.76): ahead, up, and in toward the
    crosshair
  - the flats face sideways, turned 0.5 rad toward you, so some of the inner flat shows
  - the tier scales stay as they are
- **Where the grip sits:** in A the grip runs along the fist, so the pommel shows as a dark stub
  at the wrist (you can see it in the picture). I'll shift `pos` so the crossguard sits just in
  front of the fist and the pommel is hidden inside it.
- **Keep the aim clear:** no tier's tip comes within 6° of the crosshair. The iron sword is the
  longest, and its tip is at 8.4° now. On a phone, the hand moves in toward the middle; I'll check
  the tips there too.
- **The comment:** I'll delete "canted across the view, so you see the blade instead of the end of
  it" and write the rule in its place: the blade points ahead, toward where you look.

### 1.2 Re-fit the three slashes

- **The wrist rolls.** The swing curves move the arm, so the blade follows its new rest pose. But
  the wrist rolls (−0.7, −0.84, and −0.79/−1.22 for iron) were chosen to turn a blade that showed
  its flat until its edge led. With A's pose they would turn the edge away. I'll solve them again,
  probably close to 0, using the existing edge-leads tests as the check.
- **Each tier keeps its own stroke:**
  - wooden: a quick diagonal from the upper right, through the crosshair, to the lower left
  - stone: a higher wind-up, straight down, and a beat where it lands
  - iron: a wide flourish, with every second stroke a backhand

  The blade now starts ahead instead of upright, so the wind-up and end points may need small
  changes. I'll judge them on the contact sheet.
- **The trail and the iron sword's glint** are attached to the blade, so they move with it. I'll
  check both on the sheet.

### 1.3 Make sure it can't come back

New tests in `tests/handPose.test.js`, under "swords point where you look", for all four swords at
rest:

1. The blade is within 55° of the view direction. Today it is 84°, so this fails.
2. On screen, the blade heads toward the crosshair, within 30°. Today it is 69°, so this fails.
3. The tip stays at least 6° off the aim, so the sword never hides what you're aiming at.
4. The tests catch the old fault: run on iteration 10's pose, checks 1 and 2 fail. This mirrors
   the existing quarter-turn test.

Changes to the existing tests:

- "At rest, three quarters of the flat shows" is replaced by a looser check that some of the flat
  shows. That way a blade seen exactly edge-on, as a thin stick, still fails.
- The new tests' comment names `ref/sword-90.png` as the wrong pose, and the numbers it measures.
- The edge-leads tests stay as they are.

### 1.4 Pictures to check it by

- **`recordings/showcase11/sheet-swords.jpg`**: every tier at rest and through its slash. The
  showcase's `--only=hands` part makes it.
- **`recordings/showcase11/sword-before-after.jpg`**: your screenshot's view at 1195×806, with
  the old pose next to the new one, on desktop and on a phone.

---

## 2. What doesn't change

- **Third person** (`library.js`): the swords there lead with the edge (measured in iteration 10),
  and no one has reported a problem. They stay as they are.
- **The pickaxe, bows and musket in first person** stay as they are. The pickaxe's haft also stands
  straight up out of the fist, like your `a659d8c` sword. You fixed the pickaxe yourself and
  haven't raised it since, so I'll leave it. Say if you want it to point ahead too.
- **Balance, worlds, load time and frame rate** don't change: the meshes are the same, only their
  rotation changes.

---

## 3. Order of work

1. Write the rest-pose tests (§1.3) and confirm they fail on today's pose.
2. Set the new pose (§1.1). The rest-pose tests pass.
3. Solve the wrist rolls and the slash curves again until the edge-leads tests pass (§1.2). Then
   look at the slashes on the sheet.
4. Render the sheet and the before-and-after picture (§1.4), on desktop and on a phone.
5. Run `npm run check` and the build budgets. Write `next_11.md` and `itr_11.md`.

---

## 4. Your choice

Which look do you want? See `recordings/plan11/candidates.jpg`.

- **A, ahead** (the default): the blade reaches ahead toward the crosshair, in line with the
  forearm
- **B, ahead and more upright**
- **C, leaned in**: but still lying across the view
- **something else:** if none of these is what you mean by "held at 90", a screenshot or sketch of
  how you want it held (from a game you like, say) would settle it
