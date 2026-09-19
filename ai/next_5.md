# Next 5: implementation summary and what's next

Implements `ai/plan_5.md` (answering `ai/prompt_5.md`). Nothing is committed.

## What was built

**The aerial camera now holds its height** (`src/game/aerialCam.js`, new; `src/game/control.js`)

- **No more jumps.** noa pulled the camera in to its target whenever terrain was in between. The target sat 3 blocks above the ground and lagged behind when the ground rose, so it often ended up inside a roof, a tree or a hillside, and the camera fell tens of blocks in one frame.
  - A new flag on noa's camera, `keepOutOfTerrain` (a `[block patch]`, listed in `vendor/noa/UPSTREAM.md`), turns that off.
  - Aerial view turns it off; first person, third person and possession turn it back on, so third person still stops at walls.
- **The height stays fixed.** The point the camera looks at no longer follows the ground. Its height is set once, when you enter aerial view: at chest height of whoever you were, so they're in the middle of the screen.
  - Panning (WASD, the touch stick, click-to-pan) and turning (drag, Z/C) never change the height.
  - Zooming and tilting do, moving the camera along the line you're looking down.
- **Zoom, turn and tilt work around what's in the middle of the screen.** When one of them starts, the pivot slides along the line of sight onto the block in the middle (`reanchor`). The camera doesn't move. Zoom limits (12–70) now mean "blocks from what you're looking at", and they only stop your input, so they never move the camera by themselves.
- **Click to pan keeps the height:** the camera slides sideways until the clicked block is in the middle. Before, it kept the distance and changed the height.
- **Automatic moves** (framing a new wave, the circle over the town after the opening raid) first put the pivot on the town's level (nothing moves), so they frame the town the same way wherever you entered from. They're smooth.
- **Hills: the camera rises smoothly instead of going through them** (`liftFrame`).
  - It stays 5 blocks above the terrain within 4 blocks of it, and 2 above trees and buildings right under it. The tree and building check only runs when the camera is within 20 blocks of the ground.
  - It looks ahead along the path it's on (pan, turn and zoom rates): straight when panning, round the circle when turning. It looks up to 0.5 s and 35 blocks ahead, and halfway too.
  - The lift is a spring: it rises in about 0.35 s, settles back in about 1.2 s, and never moves faster than 40 blocks/s.
  - It's a straight-up offset, so turning still turns around the same spot.
- noa's own zoom easing is bypassed in aerial view (`currentZoom` is set each frame). Otherwise it would lag the pivot when re-anchoring and move the camera.

**The white square only shows where it means something** (`Control._updateHighlight`; `skipDefaultHighlighting` in `createEngine.js`)

| | Before | Now |
|---|---|---|
| Aerial view, night | at the screen centre, aimed from the camera's target point | hidden |
| Aerial view, day, mouse | at the screen centre | under the cursor: the face a right click builds on. Hidden while dragging to turn, and when the cursor leaves the canvas |
| Aerial view, day, touch | at the screen centre, from the target point | at the screen centre, aimed from the camera: where ▣ builds |
| First person, third person, possession | noa's default | the same (copied from `noa.targetedBlock`) |

- It's worked out every render frame from the aerial camera's own state, so it keeps up while panning. Before, noa updated it on its 30 Hz tick.
- It reuses noa's highlight mesh (no draw calls added), and the pick is cached until the cursor, the camera or a block changes.

**Found and fixed: right click never built anything from aerial view.**
- `aerialPlace` passed `b.adjacent` from `noa.pick`, which has no `adjacent` field, so `placeSelected` threw before placing.
- It now uses the same target as the square, so what the square shows is what gets built. Touch **▣** and tap-to-build had the same bug.
- Click-to-pan also aimed up to a block off (it used the hit point + 0.5); it now uses the block.

## How it was verified

- **`npm run check`**: type check clean, **130 tests pass** (105 before). The new `tests/aerial.test.js` (25 tests) covers:
  - panning and turning never change the height
  - re-anchoring never moves the camera, and keeps the pivot on the line of sight
  - after a re-anchor, turning keeps the same ground point in the middle
  - click-pan keeps the height to within 0.01 for blocks 20 higher or lower, and centres them
  - zoom limits, the world edge, and screen rays
  - the lift over a 60-high ridge at full pan speed: never more than 0.67 blocks a frame, never inside, back to 0 after
  - turning next to a hill doesn't move the pivot, and turning inside a ring of hills it never flies over doesn't lift it
  - `smoothDamp`
- **`npm run build`**: budget passes. Game code **335.4 KB** brotli (333.8 KB in next_4, +1.6 KB); total to first playable frame 357.2 KB.
- **Browser runs** (dev server, headless Chrome on the Intel RPL-P iGPU; night 2, default zoom 38 and tilt 0.9; the same moves as plan 5 §0.4). "Biggest 1-frame change" is in the camera's height.

  | Camera move | Height before | Height now | Biggest 1-frame change before → now |
  |---|---|---|---|
  | Pan north across the town (W) | 9.5 – 42.7 | **38.77, constant** | 29.7 → **0** |
  | Pan east at zoom 55 (D) | 9.2 – 82.0 | **52.08, constant** | 41.5 → **0** |
  | Pan west over the hills (up to 42) | 24.2 – 53.4 | 38.8 – 49.9 (the lift, up to 11) | 29.1 → 0.93 (the lift: capped at 40 blocks/s, so a slow frame takes a bigger step) |
  | Click-pan toward the town | 38.8 – 40.8 | **38.77, constant** | 0.08 → **0** |
  | New-wave glide from the north, no input | 11.4 – 43.2 | 38.7 – 41.2 | 29.3 → 0.09 |
  | The other 3 glides | ~34 – 43 | 38.7 – 51.1 | ≤ 1.7 → ≤ 0.96 |
  | Circle over the town (dawn after the opening raid) | 29.8 – 40.8 (66 frames pulled in) | 31.7 – 51.0 (the lift over the western hill) | 0.9 → 0.50 |
  | Pan over the highest hill near the town (46) | — | 38.8 – 50.9, never closer than 4.8 to the ground | 0.81 |

  - **The camera was never pulled in** in any run. The only "distance" changes are re-anchors, which move the pivot, not the camera.
  - **Pan screenshots** at the Town Center show the whole town. Before, the same frame showed the builder's legs.
  - **Entering aerial view** from the builder on the plaza and on the 46-high hilltop: where you stood is **0 px** from the screen centre.
  - **A full turn with Z/C:** the centre point moved **0.00 blocks** (by the south wall, and on the hilltop).
  - **Wheel zoom:** the centre point moved 0.00 blocks.
  - **White square:**
    - Aerial view at night: shown in **0 of 301 frames** while panning with the mouse over the canvas.
    - By day, mouse: 4–12 px from the cursor (the middle of the face under it).
    - Touch (412×915): at the centre (206, 448).
    - Hidden while dragging to turn.
    - First person: on the block being aimed at.
  - **Building from aerial view:** right click placed planks where the square was (12 → 11), and ▣ on touch did the same.
  - **Third person after aerial view:** against the Town Center the camera stops at it (0.1 of the 5 it wants).
  - **At 4× CPU** every row, the entry framing, the full turn and the night check give the same results. Costs are under Performance.
- **Performance** (production builds, `npm run perf -- --headless`, Intel RPL-P iGPU, 10 Mbps). next_4 is commit c6c51de, exported with `git archive` to the scratchpad and built there, then run alternately with this build.

  | Profile | Build | First playable frame | Opening raid (60 s) | Night benchmark (aerial view) |
  |---|---|---|---|---|
  | desktop | next_4 / new / next_4 / new | 1.23\* / 0.95 / 0.91 / 0.90 s | 59.9–60.0 fps, longest 33 ms, 0 over 50 ms | 60.0–60.1 fps, 71 units, high |
  | mobile (4× CPU), med | next_4 / new | 1.51 / 1.46 s | 60.0 fps, longest 33 ms, 0 over | 59.9 / 59.9 fps, 46 / 47 units |
  | mobile (4× CPU), low | next_4 / new | 1.45 / 1.48 s | 59.9 / 60.0 fps, longest 33 ms, 0 over | 60.1 / 59.9 fps, 28 / 29 units |

  - \*The first next_4 desktop run printed no result, and a re-run gave 1.23 s.
  - No measurable difference. Before my code changes were final, the new build also measured 0.89 s warm and 2.49 s cold on desktop, and 1.42–1.54 s on mobile.
  - Menu interactive: 0.10–0.13 s desktop, 0.19–0.20 s mobile (unchanged).
  - **Cost per call at 4× CPU** (real world lookups):
    - hill lift, every aerial frame: 29.9 µs
    - the square under the cursor, a new pick (by day, only when the cursor or camera moved): 56.3 µs
    - re-anchor, once per zoom/turn/tilt gesture: 68.0 µs

    At 1×: 7.7, 18.6 and 16.7 µs. `Control.render` as a whole in aerial view averages 0.1–0.2 ms.
  - Draw calls added: 0.

## Where it differs from the plan

- **Glides don't ease the pivot's height.** They re-anchor it onto the town's level at the start, which moves nothing and gives the same framing more simply.
- **The lift doesn't mark the pivot stale.** Doing that made each turn re-anchor on a slightly different point, and a full turn drifted 13 blocks. The lift is a vertical offset, so the pivot stays where it was anchored.
- **The look-ahead follows the rig's motion** (pan, turn and zoom rates) rather than a straight line from the camera's velocity. The straight line points off the circle when turning (about 7 blocks outside at 0.5 s), and too short during fast glides. It samples halfway too, up to 35 blocks.
- **The tree and building check scans only when the camera is within 20 blocks of the ground**, from 2 above the camera down to the ground, instead of "8 blocks deep" always.
- `currentZoom` is set directly in aerial view (not in the plan), for re-anchoring.
- **Added:** the aerial build fix, and the click-pan aim fix.

## Known issues / limits

- **A sheer cliff over ~60 blocks tall, at full pan speed, can still clip the camera in briefly.** In a unit test, a 70-block wall puts it 6.6 blocks inside. Real terrain is smooth: near the town it tops out at 46, and the closest the camera got was 4.8 above the ground.
- **The dawn circle after the opening raid now rises up to ~19 blocks** as it passes the western hill (smoothly). Before, it dipped through pull-ins. A wider or higher circle (`orbitTown`: zoom 34, tilt 0.72) would avoid most of it.
- **Turning past a hill taller than the flight height lifts the camera** (by 12 blocks by the south wall of the default town), because the hill is in its path. It's smooth and settles back after about 1.2 s. Zooming out avoids it.
- **Player-built towers more than 20 blocks above the terrain** aren't seen by the tree and building check when the camera is high, so the camera can pass through one.
- **Pan speed follows `zoom`, clamped to 12–70.** After a re-anchor onto something far away, panning is faster than before.
- **In first person at night the square still shows,** even though you can't dig (plan choice 7, unchanged).
- **The browser scripts must keep the night going.** A night ends when every attacker is dead, and at 4× CPU a long run crossed into dawn and first person. The scripts respawn attackers now; worth remembering for future runs.
- Still **not tested on a real phone.**

## What to work on next (suggested order)

1. **Play aerial view on a few nights** and tune `AERIAL` in `aerialCam.js` (clearances, reach, look-ahead, lift speed) and the dawn circle's zoom and tilt.
2. **Carried over from next_4:**
   - play the first days with a fresh profile and tune `TIPS`, `DAWN` and `TRAIL`
   - night balance (`SIEGE`, `WAVE_BASE_BUDGET`, `CROWD`)
   - first-person item poses (`ITEM_POSE`)
3. **Real phone and older laptop test,** then tune `TIERS`.
4. The rest of the earlier lists: armour tier, hit sounds per weapon, a hand-built default world, multiplayer groundwork.
