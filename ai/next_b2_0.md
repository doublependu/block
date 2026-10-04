# next_b2_0: where this iteration got to

Answers `ai/prompt_b2_0.md`, following `ai/plan_b2_0.md`. You said "let's implement this", so every
default in plan §7 stands: the castle fills most of the screen with land round it, regular dawns
stay in first person, the build view zooms out to 1.25 × the whole-castle view, and frame rate
wins over framing. Nothing is committed.

`npm run typecheck` passes, and so do 373 of 377 tests (15 new), the GLB check and the build
budgets. **The 4 failing tests fail on HEAD too** (§5): they predate this change.

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| Morning rebuild: the default view shows only part of the castle | **done**: the dawn orbit circles the whole palace (§2) |
| First attack: the default view shows only part of the castle | **done**: the opening frames the whole palace, facing the raid's front |
| Attack: by default, the full castle with quite a bit of land round it | **done**: every wave, and entering the aerial view at dusk or night |
| Build: allow zooming out further | **done**: the limit is 1.25 × the whole-castle view (about 190 back on desktop, 230 on a portrait phone; it was 70) |

Screenshots: `recordings/framingb2/sheet-{desktop,landscape,portrait}.jpg` (rows: low, med, high;
columns: opening, dawn, close aerial, build zoomed out, first person, wave). For comparison, the
code before the change: `recordings/framingb2-before/`. The starter world: `recordings/framingb2-starter/`.

---

## 2. What changed

**The framing is worked out from the town** (`aerialCam.js`: `townShape`, `fitZoom`, `fitZoomAround`):

- The town is its built blocks (the `built` flag: walls, towers, ice…; not trees, ore or earth)
  within 64 blocks of the town center.
- The camera looks at the town's middle height, not the ground, at a pitch of 1.0. It sits exactly
  as far back as it needs for the town to fill 75% of the screen's height or 85% of its width,
  whichever binds first. That's worked out for the screen it's on.
- Measured: the palace is framed from about 125–130 back on desktop and landscape phones, and
  about 160 on portrait phones. The starter valley keeps about 60 (it was 58).
- `Control`: `frameFront` (opening and waves), `orbitTown` (the dawn after the opening),
  `enterAerial` at dusk or night (it glides out to the town), and `maxZoom()` for the build limit.
  The town's shape is cached until an edit changes it (`WorldState.editsVersion`).

**The land round the town fades out instead of ending: ground fog.** This replaces the plan's
fog-by-distance (§3.2). The first screenshots showed that fog measured from a camera 130 blocks
away can't hide where loaded land ends without also fogging the town. The palace sat on a floating
island with hard edges and its stone underside showing. Now:

- New `src/engine/groundFog.js`: a Babylon material plugin on every standard and PBR material. In
  the aerial view it measures the fog across the ground from what the camera looks at, so the land
  fades out in a ring round the town, however far back the camera is.
- **Where the fog starts and ends** (`groundFogRange`): it starts just past the town and ends
  where loaded land is sure to end. That's either the pinned box below or noa's ring round the
  camera target (`ringReach`), whichever reaches further.

**Chunk loading** (`vendor/noa`, a new `[block patch]`, recorded in `UPSTREAM.md`):

- `world.pinnedChunks`: a box of chunks that stays loaded from any view, requested only after
  everything near the camera. It holds the town, plus 8 blocks of land from the ground or 24 from
  above.
- In the aerial view, chunks load at least 3 chunks round the target. Low and med load 2–2.5
  from the ground; high is unchanged.
- **This fixes a bug that was already there**, measured on HEAD: on low and medium quality, the
  palace's top row of chunks (y ≥ 48, the spire and roofs) never loaded, in any view. Every tier
  now loads all 20 of the palace's chunks in every shot.

**Distances that used to count from the camera** now count from what the aerial camera looks at:

- unit animation: units over 60 blocks from the camera used to freeze in place
- health bars: they hid past 32 or 48 blocks from the camera, and now keep the same size on screen
  however far away the camera is
- sound: the listener comes down the line of sight, to at most 40 blocks from the focus

While the aerial view is on, the camera's near plane is 0.5 instead of 0.01, for depth precision
at a distance.

---

## 3. Measured: load time and frame rate (mobile profile: 4× CPU, 412 × 915)

| | Low, HEAD | Low, new | Med, HEAD | Med, new |
|---|---|---|---|---|
| first playable frame | 1.93 s | 2.06 s | 2.05–2.14 s | 1.69–2.12 s |
| opening raid, average fps | 59.3 | 59.0 | 58.2–58.9 | 57.5–58.1 |
| opening raid, lowest 1-s fps | 55 | 47 | 32–43 | 18–31 |
| busy night (whole crowd), average / lowest fps | 57.5 / 45.7 | 52.8 / 47.6 | 44.3 / 34.2 | 42.6 / 38.3 |

- **Load time doesn't change.** The pinned chunks wait until everything near the camera is loaded.
- **The lower minimum in the opening raid comes from the first 3.5 seconds.** That's the camera
  gliding out while 79 more chunks load (63 → 142). A few half-seconds run at 42–56 fps.
  Afterwards the frame rate matches HEAD at about 60. Tool: `tools/perf/raid-trace.mjs`
  (the frame rate every half second, with noa's chunk queues).
- **The busy night is a few fps lower on average on low** (the whole crowd now animates in view);
  its lowest second is slightly higher. The benchmark now measures the whole-town view the game
  shows (`load-test.mjs` calls `frameTown`); HEAD's figures are its own default view at zoom 45.

---

## 4. Files

| File | Change |
|---|---|
| `src/game/aerialCam.js` | `FRAME`; `townShape`, `fitZoom`, `fitZoomAround`, `ringReach`, `groundFogRange`, `pinnedBox`, `toView`; `zoomStep` takes the limit |
| `src/game/control.js` | `frameTown`, `townView`, `townShape`, `maxZoom`, `aerialFocus`; `frameFront`/`orbitTown`/`enterAerial`; `_aerialView`/`_groundView` (fog, near plane, chunk reach), `_pinTown`; the listener |
| `src/engine/groundFog.js` (new), `createEngine.js`, `sky.js` | ground fog; `Sky.setAerialFog(start, end, around)` / `clearAerialFog` in place of `setFogOffset` |
| `src/game/units.js`, `src/game/healthBars.js` | distances from the aerial focus; bars keep their size on screen past 60 blocks |
| `src/game/session.js` | the opening's framing drops its constants |
| `src/world/worldState.js` | `editsVersion` |
| `vendor/noa/src/lib/world.js`, `UPSTREAM.md` | `pinnedChunks` |
| `tests/framing.test.js` (new) | 15 tests: the shape, the fit, the limit, the pinned box, the fog |
| `tools/autoplay/framing.mjs` (new) | the screenshot sheets (`--world=starter` for another world) |
| `tools/perf/raid-trace.mjs` (new), `tools/perf/load-test.mjs` | as in §3 |
| `tools/autoplay/castle/studio.mjs` | follows the new `Sky` call |

---

## 5. Found, not fixed

- **4 tests fail on HEAD, before this change:** `worldfile.test.js` (3) and `nightCount.test.js`
  (1). They expect `worlds/default.world.json` to be the generated Default Valley. Commit 70c07d3
  ("ice palace deploy") made it the palace and moved the valley to `starter.world.json`. Either the
  tests follow the starter world, or the generator script writes the palace. That's your call:
  which world is "the default" in the tests?
- **Entering the aerial view by day inside the palace** opens at zoom 38 over the builder, which
  inside the hall means looking at a wall (the "close" column). It was the same before. A fix
  would open the build view over the palace's roofline, or on the town view.
- The long autoplay runs (`npm run autoplay`) weren't re-run. The bot builds from the aerial view
  by day, which this change only touches through the higher zoom limit.

## 6. What to work on next

1. Decide the default-world tests (§5).
2. If the first 3.5 s of the opening matter on low-end phones, load the aerial margin while the
   menu is up (the worker is already warming the spawn chunks) rather than when the raid starts.
3. The close build view inside the palace (§5).
