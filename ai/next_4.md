# Next 4 — implementation summary and what's next

Implements `ai/plan_4.md` (answering `ai/prompt_4.md`). Nothing is committed.

## What was built

**Issue 1: the black pattern in the blue health bar** — fixed

- **Cause:** each bar is three quads (dark back plate, damage chip, fill) in
  exactly the same plane, and they were depth-tested against each other. With
  the camera's near plane at 0.01 there isn't enough depth precision, so the back
  plate won on some rows. At 6 m it covered about 80% of the fill.
- **Fix** (`src/game/healthBars.js`):
  - The bars now draw in a new **overlay** rendering group, after the whole world.
    They still test against the world's depth (hills hide them) but write none.
  - Bars go far to near, and each one back plate → chip → fill, so a later quad
    simply covers an earlier one. Still one draw call.
  - `RENDER_GROUP` in `src/core/constants.js` names the groups: world 0,
    overlay 1, hands 2 (the view model moved from 1 to 2).
- **Also fixed: the bars were about 63% of their colour.** With lighting off,
  Babylon's shader outputs *scene ambient × colour*, so they got darker at
  night. Emissive white makes them exactly the colour set: blue `#3d8bff`, red
  `#e8412c`, and a cream damage chip (it was grey).

**Issue 2: no way to switch to the pickaxe** — it's a real item now

- The pickaxe is always owned and always on the hotbar, in slot 1. It can be
  moved in Build but not pushed off. It's never saved, so world files don't change.
- **Q** (or middle click) swaps between the pickaxe and the last item you held.
- Every day starts with the pickaxe in hand (dusk still takes out your best
  weapon).
- **You always dig with the pickaxe:** holding left click on a block with a log,
  a troop or a sword selected shows the pickaxe while you dig, and the item comes
  back 0.35 s after you stop. A sword still hits attackers first.
- Hotbar icon ⛏, label "Pickaxe"; placing with it says it digs with left click.
  Creative's hotbar is pickaxe + 8 (the gunner moved to the Build panel only).

**Issue 3: the tool motion played forever** — fixed

- **Cause:** the first-person mining chop is a looping motion, and nothing told
  the view model that digging had stopped (only switching items ended it).
- **Fix** (`src/game/viewModel.js`): a pure `stepMotion` loops the chop only while
  `Control` says you're digging; after that it finishes the chop it's in and
  stops. A possessed sapper's hit plays it once.
- **Nothing snaps back any more:** the swing, the chop and the bow draw now return to
  rest instead of jumping there. The swing has a recovery phase and is 0.36 s
  long (was 0.3 s).

**Issue 4: the rotating white bar** — replaced by a blade trail

- The bar was the "slash arc" from plan 3: a flat white 0.7 × 0.09 rectangle
  that turned across the middle of the view.
- **Now:** a thin, tapered streak behind the sword's tip during the down-stroke
  only (≈ 0.12 s). It fades toward the tail and is tinted by the sword (wood
  warm, stone grey, iron white).
- Its points are the blade tip at earlier moments of the same swing curve, so it's
  smooth at any frame rate and always ends at the blade.
- Swords only: yours, and a possessed swordsman's.

**Feature 1: a slower dawn rebuild you can watch**

- **Paced by time** (`DAWN` in `balance.js`, `dawnPlan` in `cycle.js`):

  | Night | Rebuild | Whole dawn |
  |---|---|---|
  | normal | 3 s + 0.1 s a block, clamped to 5–10 s | 1 s first light + rebuild + 1.5 s to look |
  | opening raid | 12 s | 14.5 s |
  | nothing broken | — | 4 s (as before) |

  The sky's dawn colours stretch over the same time.
- **In a readable order** (`restoreOrder` in `src/game/rebuild.js`): the Town
  Center first, then layer by layer from the bottom, each layer sweeping
  clockwise round the town from the north. Nothing comes back before the block
  under it.
- **Each block grows back** out of a pale gold ghost cube: one thin-instance
  pool in the overlay group, drawn only while something is being rebuilt.
  Every 4th block sparkles, and there's a soft, throttled sound.
- **Nothing covers it:**
  - The night result is now a side card, below the banner when there is one.
  - The banner reads "Dawn: your town rebuilds itself after every night"
    (shortened after day 3), with **Skip (N)**. N at dawn skips too.
  - The phase chip shows "rebuilding 34 / 183" with a bar.
  - After the opening raid the camera circles for the whole rebuild.
  - After a normal night, a gold "rebuilding" arrow points at the work when it's
    off screen.
  - The day never starts with the result card still open.
- **A block waits (up to 3 s) if someone is standing in its spot**, so the
  slower rebuild doesn't trap the builder or a unit in a wall.
- **Found and fixed:** cracks on blocks that were damaged but not destroyed were
  never cleared at dawn (`cracks.clearAll()` was never called). They're cleared
  when the rebuild starts, and those blocks get their hp back.

**Feature 2: tips for a slow start** (`src/game/guide.js`)

- **When:** survival, days 1–3, by day, only after no progress for a while:
  - 25 s for the first tip of the game, 40 s after that.
  - "Progress" is mining anything, crafting or placing, so a busy player never
    sees a tip.
  - Never over a banner or an open panel, or while you're not your builder.
- **The steps**, each with a marker on where to do it. A step's tip goes away
  with a ✓ as soon as it's done, and done steps are skipped.

  | Tip | Marker | Done when |
  |---|---|---|
  | Gather wood | the nearest tree trunk (scanned) | a log is gained |
  | Dig for stone | "Dig here" on plain ground off the plaza | cobblestone gained |
  | Craft defences: names up to 3 recipes you can afford, e.g. "Arrow tower (6 planks, 4 cobblestone)" | the Build button pulses; those recipes are outlined in Build | anything crafted |
  | Build up your defences: gates are the weak spots, towers inside the wall, troops by the gates | the four gates | a wall, tower, gate, spikes or troop placed |
  | Find iron and gold (from day 2, or after the four basics) | above the nearest iron ore: "Iron · 7 down" | iron or gold gained |
  | Night is coming (once a day, 60 s before night) | — | — |

- **Wording:** desktop names keys; touch names ⛏, ▣ and Build. A phone counts as
  touch even before its first touch.
- **Markers:** a new "guide" kind of the alert marker, in gold with a label.
  Edge arrows (these and the attacker arrows) now stay clear of the top bar and
  the hotbar, and labels at the sides hang inward.
- **Scans:** read loaded chunks only (`WorldState.peekLoaded`, so they never
  generate terrain), in slices of about 0.8 ms a frame, and only while that tip is up.
- **Turning them off:** a **Tips** checkbox in the pause menu (turning it back on
  starts over), **Hide tips** on the card, and `?tips=0`. Done steps are saved in
  settings (`localStorage`), so a returning player isn't told again.

## How it was verified

- **`npm run check`**: type check clean, **105 tests pass** (79 before):
  - motions (5) and bar order (4)
  - pickaxe inventory rules (4)
  - dawn timing, Skip and rebuild order (3)
  - tips (9) and tip settings (1)
- **`npm run build`**: budget passes. Game code **333.8 KB** brotli (327.9 KB in
  next_3, +5.9 KB); total to first playable frame 355.6 KB.
- **Health bars**, pixel test in the browser. Each fill quad's matrix and colour
  are read from the instance buffers and projected to the screen, and the
  screenshot is measured inside the fill.

  | | Before | After |
  |---|---|---|
  | 2.5 m | black band across the fill | 100% of fill pixels at the exact colour, 0 dark rows |
  | 6 m | ~80% of the fill black | 100%, 0 dark rows |
  | 14 m, 30 m, aerial | dark edges / mostly clean | 100%, 0 dark rows |
  | colour (day) | blue `(42, 85, 168)`, chip grey | blue `(61, 140, 255)`, red `(232, 64, 43)`, day and night |

  The only misses were bars partly hidden behind a unit, a gate or the edge of a
  hill, which is correct.
- **Digging motion** (hold left click on grass for 1.2 s, then let go):

  | In hand | Before | After |
  |---|---|---|
  | log | still chopping 3 s later (forever) | ends 74 ms after release |
  | wooden sword | forever | 64 ms |
  | pickaxe | forever | ≤ 375 ms (finishes the chop it's in) |

- **Pickaxe:**
  - Day 1 starts on it.
  - Q goes log → pickaxe → log (through the real key binding).
  - Digging with the log selected shows the pickaxe, and the log comes back
    0.36 s after release.
  - Dusk switches to the sword, and the next day starts on the pickaxe again.
  - Phone: slot 1 shows ⛏.
- **Blade trail:** frame sheets of a night swing, at full speed and at 4× CPU
  throttle. No bar in any frame, and a streak on the blade tip mid-slash, gone
  the next frame.
- **Dawn:**

  | | Before | After |
  |---|---|---|
  | Opening raid: blocks | 183 in ~3 s, under the centred result panel | 188 at a steady ~15/s over 12 s; Town Center first, then the walls round the town |
  | Opening raid: dawn | 4.0 s | 14.5 s; side card, banner and progress chip |
  | Normal night: blocks | 11 in ~0.1 s | 15 over 5 s |
  | Normal night: dawn | 4.1 s | 7.5 s; "rebuilding" arrow when facing away, gone when facing it |
  | Opening raid, second run | — | 190 blocks, dawn 14.5 s, nothing left |
  | Builder standing in a destroyed block's spot | block came back inside them | its ghost waits at full size; the block came back after the 3 s limit (5.1 s into dawn) |
  | Skip (button, and N) | — | everything back at once, day 1.6 s later; N at dawn doesn't start the next night |
  | Frames during the opening dawn, 4× CPU | — | avg 16.7 ms, longest 17 ms, 0 over 50 ms |

  At day start: no card, no banner, no marker, mode "self".
- **Tips** (fresh browser profiles):
  - The first tip came after **25.2 s** idle, with a "Tree" marker that is on a
    log block. A log → ✓ → gone 2.5 s later.
  - The stone marker is on dirt 12.5 blocks from the Town Center.
  - The craft tip listed arrow tower, stone walls ×2 and gate. Build pulsed, and
    those three recipes were outlined in the panel. The card hides while the
    panel is open.
  - The defend tip marked the 4 gates.
  - The ore marker read "Iron · 7 down", and the block 7 under that column is
    iron ore.
  - Done steps were saved and nothing showed after a reload. The night reminder
    came a minute before night.
  - A player who dug something every 10 s for 90 s saw **no tip**. Tips off hides
    the card.
  - Phone (412×915, touch): touch wording, the card sits under the top bar and
    pushes toasts down, and the arrow for a gate behind you sits above the hotbar.
- **Performance:** see below.

- **Performance** (production build, `npm run perf -- --headless` on the Intel
  RPL-P iGPU, HTTP/2 + brotli, 10 Mbps). New and next_3 builds were alternated:
  new → old → new.

  | Profile | Build | First playable frame | Opening raid (60 s) | Night benchmark |
  |---|---|---|---|---|
  | desktop | new (first run, cold shader cache) | 2.51 s | 60.0 fps, longest 50 ms, 0 over 50 ms | 60.0 fps, 71 units, high |
  | desktop | next_3 | 1.08 s | 60.0 fps, longest 50 ms, 0 over | 60.0 fps, 71 units, high |
  | desktop | new (again) | **0.71 s** | 59.9 fps, longest 50 ms, 0 over | 60.0 fps, 71 units, high |
  | mobile (4× CPU), med | new / next_3 / new | 1.45 / 1.47 / 1.47 s | 60.0 / 59.9 / 59.9 fps, longest 33 ms, 0 over | 59.9 / 60.0 / 60.1 fps, 46 units |
  | mobile (4× CPU), low | new / next_3 / new | 1.47 / 1.46 / 1.44 s | 60.0 fps, longest 17 / 33 / 17 ms, 0 over | 60.0 fps, 29–31 units |

  - Menu interactive: 0.11 s desktop, 0.19–0.20 s mobile, unchanged.
  - No measurable change anywhere. The 2.51 s is the first run on the GPU after
    the tool change below; desktop load times here swing with the shader cache
    (next_3 saw 0.86 s warm, 2.34 s cold).
  - Health bars with 93 units in view: `render()` takes 0.13 ms a frame on
    average (p95 0.30 ms), sorting included.
  - Tip scans at 4× CPU: the tree scan (the biggest) runs about 0.8–0.9 ms a
    frame, a few frames 1.2–1.3 ms, over ~17 frames. The dig-spot and ore scans
    finish in one step (≤ 0.5 ms).
  - Draw calls added: 0 for the bars (still one), 1 for the trail during a
    swing, 1 for the ghosts during dawn; the tips are DOM.

## Where it differs from the plan

- **Health bars use their own rendering group, not the alpha-blend pass.** The
  transparent pass sorts by mesh distance, so gates and leaves could have drawn
  over bars. A group drawn after the whole world avoids that. The view model
  moved to the group after it.
- `barLayers` + `farToNear` instead of `barInstances`: the same order, without
  allocating per frame.
- **The defend tip marks the gates only,** not the tower corners: the default
  town already has towers there.
- **The swing, chop and bow draw were reshaped to end at rest.** The swing's old
  snap back looked like part of the problem.
- **The rebuild marker is an edge arrow only**, not a ring: on screen, the gold
  ghosts already show where it's working.
- **Added:** a block waits for someone standing in its spot, cracks are cleared at
  dawn, and edge arrows keep clear of the HUD.
- **The scan budget is 0.75 ms, not 1 ms.** A step can run a column or two past
  its budget, and with 1 ms the steps took 1.1–1.5 ms at 4× CPU.
- **`npm run perf -- --headless` now renders on the GPU.** Headless Chrome fell
  back to SwiftShader before (20 fps, tier low), which made headless runs useless.
  The result's "gpu" line says which one ran.

## Known issues / limits

- **The first-person item poses in `ITEM_POSE` are ignored** for items from
  `items.glb`. Babylon's glTF loader gives every node a `rotationQuaternion`, and
  that overrides the Euler `rotation` the view model sets, so items point straight
  out of the fist. It looks fine and nobody has complained, so I left it; fixing it
  means clearing the quaternion and re-tuning the poses by eye.
- **Tip progress is per browser** (`localStorage`), not per world.
- **The ore marker points through the ground,** a deliberate "x-ray" for new
  players.
- **The scans only see loaded chunks.** If no tree is within 40 blocks, the wood
  tip has no marker (the text still says where trees grow).
- **The trail is deliberately faint** (alpha 0.45); it may want to be stronger
  after playing.
- **A tip-scan frame at 4× CPU sometimes takes 1.2–1.3 ms**, just over the 1 ms
  target (most take 0.8–0.9 ms). It only happens while a tip's marker is being
  found (~17 frames).
- **Skip puts blocks back at once** even where someone is standing, unlike the
  paced rebuild.
- Still **not tested on a real phone**; the mobile numbers are CPU-throttled
  emulation.

## What to work on next (suggested order)

1. **Play the first days** with a fresh profile and tune the numbers against how it
   feels: the tip delays (`TIPS`), the dawn lengths (`DAWN`), and the trail
   (`TRAIL`).
2. **Balance from next_3:** nights are easy now that units collide (`SIEGE`,
   `WAVE_BASE_BUDGET`, `CROWD`).
3. **First-person item poses:** clear the glTF quaternion and tune `ITEM_POSE`.
4. **Real phone and older laptop test**, then tune `TIERS`.
5. The rest of the earlier lists: armour tier, hit sounds per weapon, a hand-built
   default world, multiplayer groundwork.
