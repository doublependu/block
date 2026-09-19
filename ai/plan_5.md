# Plan 5: an aerial camera that holds its height, and a white square that means something

Answers `ai/prompt_5.md`. Nothing below is implemented yet.

---

## 0. What I found before planning

I ran this repo's dev server (port 5199) and drove it with scripted Playwright sessions in headless Chrome on the real GPU (Intel RPL-P through ANGLE). Setup: the default world, the opening raid skipped, night 2, aerial view at the default zoom (38) and tilt (0.9). Every frame I logged:
- the camera's world position
- the orbit point
- noa's zoom (asked for and actual)
- the highlighted block

No project files were changed, and the scripts and screenshots stayed in the session scratchpad.

### 0.1 How the aerial camera works today

- noa's camera is an orbit camera. It sits `zoom` blocks back from a target point, along the view direction.
- In aerial mode, `Control.render` (`src/game/control.js:672-716`) puts that orbit point at the pan position (x, z). Its height **follows the ground under it**: `a.y` eases toward *terrain height + 3* (`control.js:711-712`).
- So your suggestion is right. Today the camera keeps a fixed **distance** to a point near the ground, not a fixed **height**. Two things follow from that.

### 0.2 Cause 1 (the sudden jumps): noa pulls the camera in to the orbit point

- Each frame, noa sweeps a small box from the orbit point back toward the camera (`vendor/noa/src/lib/camera.js`, `cameraObstructionDistance`). If anything solid is in the way, it cuts the zoom to that distance **in one frame**. The zoom then eases back out at 20% a frame.
- This exists so a third-person camera doesn't go through walls. For a camera 30 blocks up, it goes wrong in two ways:
  - The orbit point rides only 3 blocks above the *terrain*, and it lags behind when the ground rises. So it ends up **inside** the Town Center, tree crowns and hillsides. The sweep then starts inside a solid block and returns 0: the camera drops from 38 blocks away to the orbit point.
  - Anything tall between the camera and the orbit point (a tree, a hill) also cuts the zoom.
- **Reproduced, panning north across the town with W:**
  - At 0.86 s the square lands on the Town Center roof (y 10.5), and the orbit point (y 10.53) is inside the roof block.
  - The next frame, the camera drops from y 40.3 to 11.6 (zoom 38 → 1.2), and the screen fills with the plaza floor and the builder's legs.
  - It takes about 0.3 s to pull back out.
- **It also happens with no input at all.** When a new wave arrives, the camera glides to frame the front (`frameFront`), and the glide from the north dropped the camera 29 blocks in one frame. The circle over the town after the opening raid (`orbitTown`) dips 11 blocks.

### 0.3 Cause 2 (the slower drift): the height follows the terrain

Even without a pull-in, the camera rises and falls with the ground under the orbit point:
- Across the town (ground 6 → 8 → 11), the camera climbed from 38.7 to 42.7.
- Over the western hills (ground 1 to 42), it climbed and fell by about 30 blocks.

### 0.4 Measurements

Night 2, 60 fps. Two columns:
- **Biggest 1-frame drop:** the largest one-frame change in the camera's height.
- **Pulled in:** frames where noa had cut the zoom by more than a block.

| Camera move | Frames | Camera height | Biggest 1-frame drop | Pulled in |
|---|---|---|---|---|
| Idle over the Town Center | 181 | 40.77 (steady) | 0 | 0 |
| Pan north across the town (W, 2.2 s) | 134 | 9.5 – 42.7 | **29.7** | 41 |
| Pan east at zoom 55 (D, 2.5 s) | 150 | 9.2 – 82.0 | **41.5** (zoom 52.8 → 0) | 91 |
| Pan west over the hills (W, 3 s) | 181 | 24.2 – 53.4 | **29.1** | 77 |
| Rotate in place by the south wall (Z, 4 s) | 241 | 40.75 – 40.77 | 0.001 | 0 |
| Click to pan toward the town (2 s) | 121 | 38.8 – 40.8 | 0.08 | 0 |
| New-wave glide from the north, no input | 181 | 11.4 – 43.2 | **29.3** | — |
| New-wave glides, the other 3 directions | 180 each | ~34 – 43 | ≤ 1.7 | — |
| Circle over the town (`orbitTown`, 6 s) | 360 | 29.8 – 40.8 | 0.9 | 66 |

- Rotating never changes the height; only moving the orbit point over the ground does.
- The glide numbers include the zoom easing to the glide's own zoom (38 → 50), so I only compare the one-frame drops there.

### 0.5 The white square

- **What it is:** noa's built-in block highlight: a 20% white square with a white outline, which stands out at night (`vendor/noa/src/lib/rendering.js:441`).
- **In aerial mode it still aims from the orbit point,** along the view direction, with the first-person reach (6 blocks). So it always sits at the **exact screen centre**, on whatever lies 0.5–3 blocks past the orbit point. Measured on screen: (0.50, 0.51) over the Town Center and (0.50, 0.49) over grass.
- **Why it seems tied to the camera:** it starts from the same orbit point as the pull-in. When the square lands on something tall, the orbit point is at or inside that thing, and noa pulls the camera in (§0.2).
- **Why it moves when you pan:**
  - It's pinned to the screen centre, so it crosses the world as the camera moves.
  - noa updates it on its 30 Hz tick, so it moves in steps: 61 moves in 134 frames while panning at 60 fps.
  - Over valleys and water nothing is within reach, so it blinks off and on.
- **It marks nothing you can use.** In aerial view:
  - right click places under the **mouse cursor** (`aerialPlace`), not at the square
  - at night you can't build at all (`canEdit` is day only)

---

## 1. A camera that holds its height

**The rule:** in aerial view the camera flies at a fixed height.
- **Pan** (WASD, the touch joystick, click-to-pan) and **rotate** (drag, Z/C) never change it.
- It changes only when:
  - **you** zoom (wheel, pinch) or tilt (drag up or down), and it moves along the line you're looking down
  - an automatic move (framing a new wave, the circle over the town) glides it there smoothly
  - a hill would otherwise come up through it (§1.4), and then it rises smoothly

### 1.1 No more pull-in (vendor patch)

- Add a flag to noa's camera, `keepOutOfTerrain`, on by default. When it's off, `updateAfterEntityRenderSystems` skips the clamp.
- **Aerial mode turns it off** (`enterAerial`), and first person, third person and possession turn it back on (`returnToSelf`, `possess`). So walls still stop the third-person camera.
- Marked `[block patch]`, with a row in `vendor/noa/UPSTREAM.md`.
- **The orbit point stays noa's camera target.** Chunk loading centres on it (an existing patch in `world.js`), so terrain still loads where you're looking.
- This alone removes every jump in §0.4.

### 1.2 The orbit point stops following the ground

- `a.y` is no longer eased toward *terrain + 3* every frame. Those two lines go.
- **Entering aerial view:** `a.y` is set once, to the height of whoever you were controlling (feet + 1), or to the Town Center's floor. What you were standing on is in the middle of the screen, as today.
- **Camera height** is then `a.y + zoom × sin(tilt)` (plus the hill lift, §1.4). Panning moves only x and z, so it can't change.

### 1.3 Zoom, rotate and tilt around what you're looking at

With a fixed height, the orbit point on its flat plane can sit well above or below the ground in the middle of the screen (for example, over a hill). So rotating around it would make the hill swing sideways. The fix costs nothing in camera movement:

- **Re-anchor, then act.** When a zoom, rotate or tilt input starts, cast the centre ray from the camera (≤ 200 blocks) and move the orbit point **along that same ray** to the ground it hits. Zoom becomes the new distance.
  - The camera itself doesn't move at all: the orbit point just slides along the line of sight.
  - Then:
    - rotating turns around what's in the middle of the screen, at the same height
    - zooming moves toward it
    - tilting pivots on it
  - If the ray hits nothing (sky, world edge), keep the current orbit point.
- **Zoom limits (12–70) now mean "blocks from what you're looking at".** They're only enforced against your input, so a re-anchor never moves the camera to satisfy them.
- **Click to pan keeps the height:**
  - the camera slides until the clicked block is in the centre
  - the orbit point's height and the zoom ease together at the same rate, so the camera's height stays exactly the same while it moves
  - today the height changes instead of the distance
- **Automatic glides:**
  - Framing a new wave and the circle over the town also glide `a.y` to the Town Center's floor, eased with the rest of the glide. They frame the town the same way wherever you entered aerial view from.
  - They're automatic and smooth, so they're the one place the height moves without you. See choice 3 in §4.

### 1.4 Hills: rise smoothly instead of going through them

- Hills around the default town reach y 42–43. The camera at the default zoom over the plaza flies at about 40, so without a floor it would pass through them.
- **Floor:**
  - at least 5 blocks above the terrain within 6 blocks of the camera, sampled now and 0.5 s ahead along the pan
  - at least 2 blocks above any solid block right under it (trees and towers: 9 columns, 8 blocks deep, loaded chunks only)
- **Lift:**
  - When the camera is below the floor, the whole rig (orbit point and camera) is raised by a **lift**.
  - It follows the floor with a critically damped spring: rising takes about 0.35 s, settling back about 1.2 s, and the speed is capped at 40 blocks/s (0.67 a frame at 60 fps).
  - Over ground below the flight height, the lift is 0 and nothing moves.
- **Cost:**
  - about 18 terrain-height lookups a frame, measured at 0.27 µs each (≈ 5 µs a frame, ~20 µs at 4× CPU)
  - plus up to 72 block reads
  - no draw calls
- **Fog:** the fog push-out uses `zoom + lift`, so a lifted camera doesn't see fog closer in.

### 1.5 Where the code goes

- **`src/game/aerialCam.js` (new, pure, testable):**
  - the view direction from heading and tilt (same maths as noa)
  - camera position
  - `reanchor`
  - the click-pan target that keeps the height
  - the floor from a height function
  - the lift spring
- **`src/game/control.js`:**
  - the aerial part of `render`
  - `enterAerial`, `returnToSelf`, `possess` (the flag)
  - `lookDelta`, `zoomBy`, `aerialClick`
  - `frameFront`, `orbitTown` (glide height)
- **`vendor/noa/src/lib/camera.js`** and **`vendor/noa/UPSTREAM.md`:** the flag.
- **`tools/perf/load-test.mjs`:** sets `aerial` by hand for the night benchmark. Check that it still frames the town, and set `y` there too.

---

## 2. The white square

**Proposal:** the square shows only where it means something.

| Mode | Today | After |
|---|---|---|
| Aerial, night | at the screen centre, from the orbit point | **hidden** (nothing to place) |
| Aerial, day, mouse | at the screen centre | **under the mouse cursor**: the block face a right click would build on. Hidden while you drag to rotate, and when the cursor leaves the canvas |
| Aerial, day, touch | at the screen centre, from the orbit point | at the screen centre, but aimed from the **camera**: the block **▣** would build on (a tap builds where you tap) |
| First person, third person, possession | noa's default | unchanged |

- **How:**
  - `createEngine` passes `skipDefaultHighlighting: true`.
  - `Control` owns the highlight. Outside aerial view it copies `noa.targetedBlock` exactly as noa's default did. In aerial view it aims with the cursor or centre ray (≤ 200 blocks).
  - It's updated **every render frame**, not on the 30 Hz tick, so it stays glued to the cursor while the camera pans. It only calls `highlightBlockFace` when the block or face changes.
- **Reuses noa's highlight mesh:** no new draw calls. One voxel raycast a frame, and only in aerial view by day.

---

## 3. Order of work, and verification

### 3.1 Order

1. **§1.1 flag and §1.2** (no pull-in, no terrain follow). The biggest fix; re-run the §0.4 table.
2. **§1.3 re-anchoring**, click-pan at the same height, and the glide height.
3. **§1.4 hill lift.**
4. **§2 highlight.**
5. **Tests, browser runs, performance,** then `ai/next_5.md`.

### 3.2 Unit tests (`npm run check`, new `tests/aerial.test.js`)

- **Camera height is unchanged by panning,** for random states and pans.
- **`reanchor` doesn't move the camera** (within 1e-9), and puts the orbit point on the centre ray at the ground height.
- **Rotating after a re-anchor** keeps the height and keeps the ground point in the centre.
- **Click-pan to a point 20 blocks higher or lower:** the height stays within 0.01 for the whole glide, and the point ends up in the centre.
- **Lift over a synthetic 30-block cliff at pan speed (34 blocks/s, 60 fps):**
  - never more than 0.67 blocks a frame
  - the camera is never below terrain + 2
  - back to 0 after the cliff
- **Zoom limits don't move the camera on a re-anchor.**

### 3.3 Scripted browser runs (Playwright, the §0 script)

- **The §0.4 table again:** every row, plus a pan over the highest hill near the town. Pass:
  - no frame where the camera's distance to the orbit point drops by more than 0.5
  - the biggest one-frame height change is ≤ 0.02 wherever the ground stays below the flight height (across the town: was 29.7), and ≤ 0.67 where the lift works
  - the camera height across the town at a fixed zoom varies by ≤ 0.01 (was 9.5 – 42.7)
  - the new-wave glides and the circle over the town have no one-frame drop above 0.67
- **Framing:**
  - entering aerial view from the builder (on the plaza and on a hilltop) puts the builder within 40 px of the screen centre
  - rotating 360° keeps the centre block within 1 block
- **Screenshot sheets:** 6 frames of the town pan before and after (the "builder's legs" frame must be gone).
- **White square:**
  - at night in aerial view it is never shown (logged every frame for 10 s of panning)
  - by day with a mouse, its screen position is under the cursor
  - on touch (412×915), at the centre
  - in first person, still on the block being dug
- **Leaving aerial view:** M swoops back to first person as today, and in third person (V) against a wall the camera still stops at the wall.

### 3.4 Performance

- **Build:** `npm run build` budget passes, with game code ≤ +2 KB brotli (from 333.8 KB). No new downloads.
- **Load:** first playable frame and menu interactive within ±0.2 s of next_4, alternating old and new builds.
- **Night benchmark** (`perf`, `perf:mobile`, `--quality=low`, headless on the GPU): within 1 fps of next_4. It runs in aerial view, so it covers the new per-frame work.
- **Per-frame cost of the aerial camera and highlight at 4× CPU:** ≤ 0.1 ms, logged.
- **Draw calls added:** 0.

---

## 4. Choices I made that you may want to override

1. **The height changes only when you zoom or tilt,** plus automatic glides and the hill lift. Alternative: zooming keeps the height too and only changes the angle. I think that feels odd, because the wheel would no longer bring you closer.
2. **Click to pan keeps the height,** so the clicked block is centred at a different distance. Today it keeps the distance and changes the height.
3. **The automatic glide when a new wave arrives stays.** It only happens if you haven't moved the camera for 5 s, and it becomes smooth. Alternatives: a setting to turn it off, or only a banner and an arrow.
4. **Hills lift the camera smoothly** (5 blocks clear of the terrain, 2 clear of trees and towers). The alternative is letting it fly through hills.
5. **Zoom, rotate and tilt work around what's in the middle of the screen,** not an invisible point on a flat plane.
6. **The white square:**
   - hidden in aerial view at night
   - by day it previews where a right click (or ▣ on touch) builds
   - the alternative is hiding it in aerial view all the time
7. **Not changed:** the square in first person at night, where you can't dig either. It could hide at night too; say if you want that.
