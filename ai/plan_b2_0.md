# Plan b2_0: an aerial view that fits the castle

Answers `ai/prompt_b2_0.md`. Nothing below is implemented yet.

The prompt has one issue in four places. The default world is now the Ice Palace, which is much
bigger than the old walled town. The aerial camera's numbers were tuned for the old town, so it
shows only part of the palace:

1. **morning rebuild**: the dawn after the opening raid, when the camera circles the town
   (`orbitTown`)
2. **first attack**: the opening raid's framing (`frameFront(..., { ahead: 4, zoom: 58, pitch: 0.8 })`)
3. **attack**: the default zoom should show the full castle and quite a bit of the land around it
4. **build**: allow zooming out further

How I read "build": the aerial view during the day (M), where you place blocks from above. The
build panel (B) has no camera of its own. Regular dawns go back to first person today, so
"morning rebuild" can only mean the aerial dawn after the opening raid (`session.js:536`, `:545`).
§7 asks whether regular dawns should also show the rebuild from above.

---

## 0. What I found before planning

### 0.1 How big the palace is

`worlds/default.world.json` holds the palace ("Ice Palace", size 256, 10,974 edits):

- **footprint**: x and z from −29 to 29, a 59 × 59 square around the town center
- **height**: the floor is at y ≈ 7, most of the walls reach y ≈ 50, and the spire reaches y = 64.
  The palace's average block height is y ≈ 23

The old town (now `starter.world.json`, "Default Valley") is a wall ring of radius 13, 2 blocks
high. The palace covers about 20 times its area and stands about 25 times taller.

### 0.2 Where the aerial camera is framed today

| Situation | Code | Pivot | Zoom (blocks back) | Pitch |
|---|---|---|---|---|
| enter aerial (M, knocked out, "watch") | `Control.enterAerial` | your position, chest height | 38 | 0.9 |
| opening raid starts | `session.js:518` → `frameFront` | town center + 4 toward the front, at ground level | 58 | 0.8 |
| each later wave | `session.js:730` → `frameFront` | town center + 14 toward the front, at ground level | 50 | 0.7 |
| dawn after the opening | `session.js:545` → `orbitTown` | town center, at ground level | 34 | 0.72 |
| manual zoom limits | `AERIAL.minZoom / maxZoom` | | 12 … 70 | |

These numbers are hard-coded and don't depend on the world or the screen's shape.

### 0.3 How far back the camera has to be

I measured this with `screenPoint` from `aerialCam.js`, the same maths the game uses. The test:
every palace block on screen, at the worst of eight headings, with the camera's real field of view
(Babylon's default 0.8 rad, vertical). Scratch scripts, not in the repo:

| Pivot | Screen | Palace just fits | Palace fills 70% (the "surrounding" asked for) |
|---|---|---|---|
| at ground level (today) | 16:9 desktop, landscape phone | ~128 | ~160 |
| at ground level (today) | portrait phone (9:19.5) | ~156 | ~205 |
| at the palace's middle height | 16:9 | ~95 | ~135 |
| at the palace's middle height | portrait phone | ~150 | ~200 |

Three conclusions:

- **The zoom has to roughly double or triple.** The opening's zoom of 58 is less than half of what
  the palace needs just to fit, and the limit of 70 can't reach it either.
- **The pivot should sit at the castle's middle height, not on the ground.** With a ground-level
  pivot, the tall walls push off the top of the screen first. That costs about 30% more
  distance.
- **Portrait phones need about 1.5× more distance than landscape.** The vertical field of view is
  fixed, so a narrow screen sees less across. The distance has to be worked out for each screen,
  not fixed in a constant.

### 0.4 What else depends on how far away the camera is

A camera 130–200 blocks away crosses limits that were tuned for a camera 40–60 blocks away:

| What | Where | Limit | What happens zoomed out |
|---|---|---|---|
| **chunk loading** | `vendor/noa/src/lib/world.js:495` (our patch: around the camera target) | low `[2, 1.5]`, med `[2.5, 1.5]`, high `[3.5, 2]` chunks of 24 | see below: parts of the palace may never load on low and med |
| fog | `control.js:1041`, `sky.setFogOffset` | offset = min(zoom, 70) × 0.8 | at zoom 130 the palace is in the fog on low (fogEnd 52 + 56) |
| unit animation LOD | `units.js:1515` | units > 60 blocks (horizontally) **from the camera** freeze in idle | every unit in town stops animating and slides around in a pose |
| health bars | `healthBars.js:145` | hidden > 32 (low) / 48 blocks **from the camera** | no bars at all in the attack view (this is already true at zoom 50–58 on low) |
| sound | `audio.js:28`, listener at the camera (`control.js:1088`) | sounds > 70 blocks away are dropped | the battle goes silent |
| depth precision | `rendering.js:142` `minZ = 0.01` | at 200 blocks a depth step is ~0.25 block | crack overlays, rebuild ghosts and the highlight may flicker |
| pan speed | `control.js:1001` | min(zoom, 70) × 0.9 blocks/s | fine. It stays capped, so panning won't get faster |
| explosion shake | `session.js:115` | only within 40 blocks of the camera | no shake from far above, which is right |

**Chunk loading probably cuts off part of the palace on low and medium quality today, from any
camera.** I worked this out but haven't seen it on screen. Chunks load in a clipped sphere around
the camera target: `|dy| ≤ vertical` and `dx² + dy² + dz² ≤ horizontal²`, in chunk units. With the
pivot near the town center at ground level (chunk 0,0,0):

- **The spire (y ≥ 48) is in chunk row 2.** On low and med, the vertical limit of 1.5 allows only
  rows −1…1, so the top of the palace never loads from the ground, whether you're in first person
  or in the aerial view as it is today.
- **The palace's −x/−z corner (x, z ≤ −25) is in chunk column −2.** Chunks are aligned to 0, so the
  town center isn't in the middle of its chunk. On low, the corner chunk (−2, −2) and the side
  chunks (−2, ±1) fail the radius test, and on med the corner (−2, −2) does too. Part of the west
  and south walls would be missing.

High tier (desktop with 8+ cores and 8+ GB) loads everything, which would explain why this hasn't
been seen. Step 1 of the implementation checks it with a `?quality=low` screenshot before anything
is changed.

---

## 1. The idea: frame the town, worked out from the town itself

Instead of new constants, the camera works out how to show whatever town the world has. That
covers the palace, the starter valley, an exported player world, and the town as it grows during a
game.

### 1.1 The town's shape (`townShape`, pure, in `aerialCam.js`)

- Built blocks only: non-air edits that aren't natural (log, leaves, dirt, grass, stone, sand,
  ores). This leaves out the starter valley's grove and outcrop, so its framing stays about the
  wall ring.
- Only blocks within 64 blocks (horizontally) of the town center. A stray block far away, like a
  lone tower, doesn't change the town's size.
- The result is a column outline: for each (x, z), the lowest and highest built block. The palace
  has about 1,000 such columns. Working it out walks the edit overlay once (11k entries, well under
  a millisecond). It's cached and recomputed only at dawn and when the aerial view is framed after
  the town changed. `WorldState` already emits `blockChanged`, which marks the cache stale.
- If the town has fewer than 8 built blocks, the shape falls back to a box of radius 13 around the
  town center (the old default town), so an empty creative world still frames sensibly.

### 1.2 The distance that fits it (`fitZoom`, pure, in `aerialCam.js`)

`fitZoom(shape, heading, pitch, fov, aspect, fill)` returns the distance back from the pivot at
which the shape's corners fill a given fraction of the screen:

- **pivot**: the middle of the shape's bounding box, at the middle of its height (§0.3)
- **solve**: for each corner point, how far the camera has to be for it to land inside the screen
  (`screenPoint` inverted; the needed distance is linear in each point's offset). Take the largest.
  No search loop is needed.
- **`fill`**: 0.65 of the screen height, or 0.85 of its width, whichever binds first. On landscape
  screens the height binds, so you get the "quite a bit of surrounding" from the prompt. On
  portrait phones the width binds, and 85% keeps the palace from being tiny (it gives about 165
  instead of 205)
- **orbit**: for the dawn orbit, the largest value over 8 headings, so the zoom doesn't breathe as
  the camera turns
- uses the canvas's aspect ratio when it frames, not at startup

Expected values (to be confirmed by screenshots, §5): the palace about 130–140 on landscape and
about 165 on portrait. The starter valley stays close to today's 50–58.

### 1.3 Pitch

The whole-castle view uses a pitch of about 1.0 (today it's 0.7–0.8). A steeper view needs a little
less distance for a tall castle. It also makes the top of the screen land on ground about 150
blocks past the castle instead of 300, which matters for §3.2. I'll tune it with the screenshots.

---

## 2. Where the framing is used

| Situation | Change |
|---|---|
| **first attack** (opening raid starts) | `frameFront` gets `zoom: 'fit'`. The pivot is the town's middle; the heading still faces the attack front, as now, and is shifted toward it by about 15% of the town's radius (instead of the fixed 4) |
| **each later wave** | same: framed on the whole town, looking toward the front (instead of zoom 50, ahead 14) |
| **morning rebuild** (dawn after the opening) | `orbitTown` circles the town's middle at the fit for any heading (instead of zoom 34 at ground level) |
| **attack, entering aerial** at dusk/night (M, knocked out, "watch", waiting for a role) | `enterAerial` glides out to the town framing, as the opening does, instead of zoom 38 over where you stood |
| **build** (aerial view during the day) | still starts close (zoom 38 over you), which is better for placing blocks. **The zoom-out limit becomes `max(70, 1.25 × the whole-town fit)`**: about 170 for the palace on landscape and about 210 on portrait. The starter valley keeps about 70 |

`AERIAL.maxZoom` becomes a value worked out per world and screen (`Control._maxZoom()`).
`zoomStep` already takes its limits from one place, so the change stays small. The rule that a
re-anchored zoom outside the limits doesn't jump back still applies. The 5-second "you moved the
camera, don't take it from you" rule in `frameFront` stays.

---

## 3. Making the far view work

### 3.1 Keep the town loaded (vendor noa patch, small)

Add a "pinned" region to the chunk loader in the existing `[block patch]` in
`vendor/noa/src/lib/world.js`. The chunks covering the town's bounding box, plus 1 chunk around it,
are always requested and never removed, on every tier and in every view. It fixes the missing spire
and corners in first person too (§0.4), if step 1 confirms they're missing.

For the palace that's about 4 × 3 × 4 = 48 chunks. Most of them are already among the ~31 that the
low tier loads around the town center, so this adds about 25–35. They're meshed once, and their
draw cost shows up only when they're on screen. The cost is measured on low (§4) before this is
accepted.

### 3.2 Fog as the edge of the map

Loaded terrain ends about 48 (low) to 84 (high) blocks from the pivot, but a camera 130 blocks up
sees much further. Today `setFogOffset` keeps the fog off the pivot only. Instead, in the aerial
view:

- **fog start**: just past the far edge of the town as seen from the camera (camera distance +
  town radius)
- **fog end**: at the edge of the loaded chunks as seen from the camera

The fog colour is already the sky colour, so the town sits in a ring of land that fades into sky,
like a diorama, and the edge of the loaded chunks never shows. `Sky` gets
`setAerialFog(start, end) / clearAerialFog()` in place of the bare offset.

### 3.3 Distances measured from what you're looking at

In the aerial view, these measure from the aerial **focus** (the pivot) instead of from the camera:

- **unit animation LOD** (`units.js`): animate within 60 of the focus. The tier's `maxAnimated` cap
  still applies, nearest to the focus first
- **health bars** (`healthBars.js`): show within 32/48 of the focus. Their size grows with camera
  distance past `farDistance` (it's capped at 60 today), so they stay the same size on screen
- **sound** (`control.js:1088`): the listener sits on the line of sight, at most 40 blocks from the
  focus, like an RTS camera. Sounds from the town stay audible and keep their left/right placement

`Control` exposes `focus()`, which returns the pivot in the aerial view and the camera everywhere
else. The three systems call it instead of reading `noa.camera.getPosition()`. First person and
third person don't change.

### 3.4 Depth precision

While the aerial view is on, the camera's near plane goes from 0.01 to 0.5, and it's restored when
the view is left. The aerial camera always stays at least 2 blocks clear of anything
(`AERIAL.clearBlocks`), so nothing gets clipped. This makes depth about 50 times more precise at a
distance, so overlays don't flicker at 200 blocks.

---

## 4. The spec: load time and frame rate

- **Load time**: no new assets, and the code added is a few hundred lines. The pinned chunks are
  requested in the same distance order, after the ones around the spawn, so the first frame isn't
  delayed. Check with `npm run perf` and `npm run perf:mobile`; the numbers must stay within the
  budgets in `tools/check-budget.mjs`.
- **Frame rate**: zooming out puts more of the loaded chunks on screen at once, and the animation
  fix makes the town's units animate again (still capped by `maxAnimated`). Measure the FPS in the
  whole-town attack view on `?quality=low` and `?quality=med`, with the mobile profile's CPU
  throttling. The units are already capped by the tier's `maxAttackers`.
- **If low tier can't hold its frame rate**, in this order: pin only the town's bounding box
  without the 1-chunk margin, then use a slightly tighter fill on low.

---

## 5. Tests and how I'll check it

**Unit tests** (`tests/aerial.test.js`, extended):

- `fitZoom`: every corner of a shape is on screen at the returned distance and one block nearer
  fails; portrait needs more than landscape; a taller shape needs more with a ground pivot than
  with a middle pivot
- `townShape`: natural blocks and far-away blocks are left out; the fallback works for an empty
  town; for the palace the shape spans −29…29 and 4…64
- `zoomStep` with the per-world limit; the existing re-anchor tests still pass
- the pinned-chunk test in the noa patch: the palace's corner chunks and its spire's chunks are
  included on the low tier's distances

**Screenshots** (new `tools/autoplay/framing.mjs`, built like `fx12.mjs`): each of the four
situations (opening start, a later wave, dawn orbit, build zoomed all the way out), at three screen
shapes (1920×1080, phone landscape 844×390, phone portrait 390×844) and three tiers, into
`recordings/framingb2/` with a contact sheet. Step 1 is the same tool on the current code at
`?quality=low`, to confirm or rule out §0.4's missing chunks before any change.

`npm run check` and `npm run build` (budgets) pass at the end.

---

## 6. Files

| File | Change |
|---|---|
| `src/game/aerialCam.js` | `townShape`, `fitZoom`, `shapePivot`; `zoomStep` takes the limit |
| `src/game/control.js` | `frameTown()`, `frameFront`/`orbitTown`/`enterAerial` use it; `_maxZoom()`; `focus()`; aerial fog and near plane; listener placement |
| `src/game/session.js` | the opening and wave framings drop their constants; town shape cache invalidated at dawn |
| `src/engine/sky.js` | `setAerialFog` / `clearAerialFog` |
| `src/game/units.js`, `src/game/healthBars.js` | distances from `control.focus()` |
| `vendor/noa/src/lib/world.js` | pinned chunk region (in the existing `[block patch]`) |
| `tests/aerial.test.js` | the tests above |
| `tools/autoplay/framing.mjs` | the screenshot sheet |

---

## 7. Questions (my default if you don't answer)

1. **How much land around the castle?** Default: the castle fills about 65% of the screen height on
   landscape screens (85% of the width on portrait). I'll show the contact sheet, and the number is
   one constant to change.
2. **Regular dawns**: should the rebuild after every night also be watched from above (the same
   orbit), or go back to first person as today? Default: **as today**. Only the dawn after the
   opening is aerial.
3. **Build zoom-out**: is 1.25 × the whole-castle view enough as the limit (about 170 blocks back
   for the palace)? Default: **yes**.
4. **Keeping the town loaded on low tier**: if it costs low-tier phones frame rate, should the
   fallback (§4) trade some framing room for speed? Default: **yes, the frame rate wins**
   (CLAUDE.md spec 2).
