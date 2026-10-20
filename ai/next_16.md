# next_16: where iteration 16 got to

Answers `ai/prompt_16.md`, following `ai/plan_16.md` with every default in its §7. Nothing is
committed: it's all in the working tree, on `main`.

`npm run check` passes (552 tests, 7 of them new; types clean; all ten models valid), and so do the
build budgets. Every check passes: `touch-check` 23 of 23, `target-check` 165 of 165 (156 of them
new), and the room check 86 of 86 with `--all`. Load time and frame rate are measured against the
last commit's build in §6.

**Look at these first** (`recordings/` is git-ignored):

- `recordings/faces16/sheet-faces-before.jpg` beside `sheet-faces.jpg`: spikes and gates on a
  chunk's last row, and spikes in front of gates, each from both sides. The first is the last
  commit's build, the second today's.
- `recordings/room16/shirts-on-foot.jpg` and `shirts-from-above.jpg`: the host's view of two friends,
  in their shirts, with their names
- `recordings/touch16/`: what the phones built in the touch check

**Nobody has played it by hand yet,** and the touch fix has been tried only in Chrome's touch
emulation, not on a real phone (§7).

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| Issue 1: ice spikes seen from one side only (and iron, steel) | **fixed** (§2): a noa bug at chunk edges, which hit every spike and every gate |
| Issue 2: spikes and gates hide each other | **fixed** (§2): noa now draws both faces where two different see-through blocks meet |
| Issue 3: on mobile, a touch anywhere attacks | **fixed** (§3): a touch never presses a key binding; ⛏ attacks |
| Feature 1: a shirt colour for each player | **done** (§4): eight colours, picked on every page alike, kept by the room |
| Feature 2: bigger, easier name tags | **done** (§5): 16 px bold (14 on a phone), ringed in the shirt's colour, and shown from above |

---

## 2. Spikes and gates (issues 1 and 2)

Both are fixed in `vendor/noa`, marked `[block patch]`, with a row each in `vendor/noa/UPSTREAM.md`.

- **`chunk.js`, `Chunk.set`:** an edit on a chunk's last row, in x, y or z, now re-meshes the next
  chunk along that axis, whatever the block.
  - That chunk draws the face between the two. Upstream re-meshed it only when solidity or opacity
    changed, and air to spikes or a gate changes neither.
  - The same fix covers two other things, both seen failing on the last commit's build: a spike or
    gate mined on an edge row left its face behind, and an upgrade on an edge row (spikes to iron
    spikes, an arrow tower to a crossbow tower) kept the old picture on that side.
- **`terrainMesher.js`, `constructMeshMask`:** where two different see-through blocks meet, the
  first pass now draws the first block's face and counts such pairs. When there are any, a second
  pass over the same plane draws the other block's face.
  - That covers a spike kind in front of a gate, two kinds of spikes side by side, two kinds of gate,
    and water or leaves against a gate.
- **As before:** two blocks of the same kind side by side have no face between them (choice 5). A
  bed of ice spikes two deep shows one layer from each side.

## 3. Touch (issue 3)

- **`control.js`:** `inputs.filterEvents` drops any event whose `pointerType` is `touch`, so a
  finger never presses a key binding. A mouse and a pen click as before. `filterEvents` is
  `game-inputs`' own hook, so `node_modules` is untouched.
- **On a phone now:** looking round and walking don't swing, dig or pick troops up. ⛏ digs and
  attacks, ▣ places, and taps from above build and select, as before.

## 4. Shirts (feature 1)

- **The colours** (`src/characters/shirt.js`, `SHIRTS`):

  | # | | # | |
  |---|---|---|---|
  | 0 | blue `#3d8fd6` (the builder's own; alone, and the host) | 4 | lime `#93d13d` |
  | 1 | yellow `#e6c02a` | 5 | violet `#8e63e6` |
  | 2 | pink `#e35d9f` | 6 | white `#eef1f4` |
  | 3 | teal `#1aa89a` | 7 | red `#d93a3a` |

- **Who wears what** (`pickShirt`, worked out on every page alike):
  - you get the colour the room kept for you, unless somebody who joined before you is wearing it
  - otherwise you get the first colour nobody here is wearing
  - a ninth player shares a colour
  - the host, first in, is blue
- **Kept:** your colour goes into your value in the room (`me.shirt`) with your things, so it's
  the same after a reload and when you come back.
- **Sent:** presence carries it as a 13th field. A presence without one counts as blue.
- **How it's drawn:**
  - `CharacterLibrary.shirtMaterial` reads the body's texture back once and repaints the shirt's
    blue in the new colour, keeping each pixel's shade. It makes one material per colour.
  - `CharacterInstance.setShirt` puts it on, and it's also what the hit flash returns to
  - no new draw calls, and the model is unchanged
  - your own arms in first person are in your colour too
- **A custom avatar** (`?avatar=`) has no shirt blue, so it looks as it always did. Its name tag is
  still ringed in its colour.

## 5. Name tags (feature 2)

- **Bigger:** 16 px bold, white with a shadow, on a darker chip, with a 2 px ring in the friend's
  shirt colour (`.name-tag` in `hud.css`). On a phone it's 14 px.
- **Shown further:** within 80 m on foot (it was 40), and every friend on the screen from above.
- **Placed just over the health bar,** which grows with distance (`barScale`, now exported from
  `healthBars.js`). That's a change from the plan's fixed height: at 16 px, the tag sat on the bar.

## 6. Load and frame rate (spec)

The last commit's build against today's, both built the same way outside the repo (`.temp/p16/head`,
`.temp/p16/now`), with `tools/perf/load-test.mjs --headless`. Two pairs, the second run in the
other order, then three more raids each (`.temp/p16/perf*.log`):

| | last commit | today |
|---|---|---|
| desktop: menu interactive (median) | 0.11 s | 0.10 s |
| desktop: first playable frame, two pairs (medians of 5) | 1.01 / 1.01 s | 1.05 / 0.98 s |
| mobile (4× CPU): first playable frame, two pairs (medians of 5) | 1.51 / 1.55 s | 1.56 / 1.58 s |
| the night benchmark (4 runs each) | 59.9–60.0 fps | 60.0 fps |
| the opening raid, average (7 runs each) | 59.8–60.0 fps | 59.4–60.1 fps |
| the opening raid, longest frame (7 runs each) | 33 ms ×4, 50 ms ×3 | 33 ms ×2, 50 ms ×4, 100 ms ×1 |

- **First playable frame:** the differences go both ways, and are smaller than what the last
  commit's own build moved between its two runs (1.51 → 1.55 s on mobile). The spec's 2.5 s is far
  off. Loading doesn't touch the changes: a world's edits are written into each chunk as it's made,
  not through `Chunk.set`, and the mesher's second pass only runs where two different see-through
  blocks meet.
- **One frame of 100 ms** in one of today's seven raids. That run's minimum was 48 fps; every other
  run, on either build, stayed at 55 fps or better.
  - I don't think the edge fix caused it. One chunk re-meshes in 0.5–1.2 ms on the desktop profile
    (2.3–5 ms with the CPU 4× slower; `.temp/p16/remesh-time.mjs`), and noa meshes on a time budget
    each frame and each tick.
  - But one frame in seven minutes of raid proves nothing either way. If walls coming down ever
    hitch, this is the first thing to look at.
- **Budgets:** the menu is 7.9 → 7.9 KB of 30. The game code is 361.1 → 362.3 KB of 550, built
  outside the repo; built in place, as `npm run build` does, it's 371.4 KB (iteration 15's was 370.2).
  - The first try was 3.3 KB more: importing Babylon's `Constants` pulled a 3.2 KB chunk that only
    loads later into the first load. `Engine.TEXTUREFORMAT_RGBA`, already loaded, does the same
    job.
- **In a room** (the room check's `--measure`):
  - from an invite link to playable on the phone profile: 2.27 s (median of 5, 1.92–2.42), against
    the target of 3 s
  - a night with three players and 47 attackers: 57, 57 and 56 fps
  - the host sends 9.05 KB a second, and each guest gets 9.5 KB
  - a shirt adds 4 bytes or less to a presence, and only when the presence is sent anyway

## 7. Testing

- **Unit tests:** 7 new in `tests/room.test.js` cover `pickShirt` (the host, newcomers, a kept
  colour, a clash, a ninth player), `ownThings` and `readHero` with a shirt, and `recolorShirt`. The
  existing presence test now expects the 13th field.
- **`tools/autoplay/touch-check.mjs` (new):**
  - it runs on a phone held upright and on its side, plus a desktop
  - a finger held 1.5 s on the look area, then on the stick, never presses fire, digs or swings
  - the stone under the crosshair stays, and the troop under it isn't picked up
  - ⛏ digs, ▣ places, and a tap from above builds
  - the mouse still digs on the desktop
  - on the last commit's build it fails 10 of those: a held finger dug the stone out, and a tap
    picked the troop up
- **`tools/autoplay/target-check.mjs`** has a new part, "seen from both sides" (`--only=faces`). It
  reads the page's terrain meshes for a face at a cell's side, and the tile on it. The cases:
  - every spike and gate kind on a last row in x, y and z, and on a first row
  - mined there, and upgraded there
  - spikes in front of gates, two kinds of spikes, two kinds of gate
  - a lone spike
  - results: 156 pass on today's build. On the last commit's build 41 fail: edge faces missing,
    faces left behind after mining, old pictures after an upgrade, and both faces missing between
    pairs.
  - `--dist=<build>` runs it on another build; `touch-check` takes it too.
- **`tools/autoplay/room-check.mjs`:**
  - a new part, "shirts": three players in three colours with the host in blue, the same on every
    page on the body and on the name's ring, names at 16 px, and every name shown from above
  - a reload keeps the colour
  - coming back to a taken colour: Ken joined while Grace was away, took her yellow, and kept it.
    Grace came back in pink.
  - the phones see 14 px names that fit on screen
  - the run with `--all` passed 86 of 86 (`.temp/p16/room-check-all.log`). It was before the last
    change, the `Constants` import in §6, so it ran again on the final build with `--phone`: 78 of
    78 (`.temp/p16/room-check-final.log`). `touch-check` and `target-check` ran again on the final
    build too.
- **Not tried:**
  - a real phone. The check uses Chrome's touch emulation, which sends the same pointer and touch
    events a phone does, but Safari on an iPhone hasn't seen it.
  - playing by hand, in two browsers (next_15 §8 says how)

## 8. What's next

- **Play it by hand**, two browsers side by side, and on a real phone: the touch fix and the shirts
  are the things to look at.
- **Then, from next_15:**
  - friends' builders get a body in the host's physics, so attackers stop at them
  - iteration 13's leftover: attackers walk through walls in terrain that isn't loaded
- **The palette** is one line in `shirt.js`, if any colour reads badly at night.

## 9. Changes by file

- **New:** `src/characters/shirt.js`, `tools/autoplay/touch-check.mjs`
- **Issues 1 and 2:** `vendor/noa/src/lib/chunk.js`, `vendor/noa/src/lib/terrainMesher.js`,
  `vendor/noa/UPSTREAM.md`
- **Issue 3:** `src/game/control.js`
- **Shirts:** `src/characters/library.js` (`shirtMaterial`, `_pixels`, `setShirt`),
  `src/net/replica.js` (presence field 13, `_chooseShirt`, `list()`), `src/net/room.js`
  (`ownThings`, `keep`)
- **Name tags:** `src/ui/hud.js` (`setColor`, `shown`), `src/ui/hud.css`, `src/net/replica.js`
  (range, from above, over the bar), `src/game/healthBars.js` (`barScale`)
- **Tests and tools:** `tests/room.test.js`, `tools/autoplay/target-check.mjs`,
  `tools/autoplay/room-check.mjs` (pictures now go to `recordings/room16`)
- **Docs:** `docs/protocol.md` (presence field 13, `me.shirt`, who picks a colour), `README.md` (the
  intro, the two checks)
- **Scratch, git-ignored:** `.temp/p16/`: the first look scripts, the logs, the last commit's
  build (`head`) and today's built the same way (`now`)
