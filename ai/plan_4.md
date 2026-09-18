# Plan 4: clean health bars, a pickaxe you can pick, tool motions that stop, a real sword trail, a slower dawn rebuild, and first-day tips

Answers `ai/prompt_4.md`. Nothing below is implemented yet.

---

## 0. What I found before planning

I ran this repo's dev server (port 5199) and drove it with scripted Playwright sessions in headless Chrome, which ran on the real GPU (Intel RPL-P through ANGLE). I logged state from `window.game`. No project files were changed. The screenshots stayed in the session scratchpad.

### 0.1 Issue 1: the black pattern in the blue health bar is z-fighting

**What's drawn.** Each bar is three quads from one thin-instance pool:
- a dark back plate
- a pale "recent damage" chip
- the coloured fill

All three have the same position and rotation, so they are exactly coplanar. They're drawn with depth test and depth write on. The camera's near plane is 0.01 and its far plane 10 000, so depth precision is poor, and on some rows the back plate wins over the fill.

**Screenshots** (a swordsman at 60% hp, looked at head-on):

| Distance | What the bar shows |
|---|---|
| 2.5 m | a black band across the top of the fill and the chip |
| 6 m | the back plate covers about 80% of the fill; only a thin blue line is left at the top |
| 14 m | mostly clean, dark edges |

- The pattern moves with distance and view angle, which is what the user sees as a "strange black pattern".
- The red bars have the same fault. Defenders are what you see by day, so the blue bars are the ones you notice.

**Second fault: the colours are about 63% of what they should be.**
- The material turns lighting off but leaves emissive black. With lighting off, Babylon's standard shader outputs *scene ambient × colour*.
- By day the ambient is 0.62, so:
  - the blue `#3d8bff` renders as about `#2a55a8`
  - the chip, meant to be pale cream, renders grey
- At night the ambient drops, so the bars get darker exactly when they're needed most.

### 0.2 Issue 2: the pickaxe isn't an item

- `Control.render` picks what's in your hand from the selected slot:

  | Selected slot | In your hand |
  |---|---|
  | a weapon | the weapon |
  | a block | the block |
  | a troop | empty hand |
  | an empty slot | the pickaxe |

- **Day 1 on the default world:** the hotbar is log, cobblestone, planks, wooden sword, then 5 empty slots, and slot 1 (the log) is selected. The only way to hold the pickaxe is to select an empty slot, and the hotbar draws those as blank.
- **Dusk switches to your best weapon, and nothing switches back**, so every day after night 1 starts with the sword in hand.
- **Once 9 item types are on the hotbar there's no empty slot**, and so no pickaxe at all.
- Digging works with whatever is selected, at the same speed: you chop grass with a log in your hand.

### 0.3 Issue 3: the tool motion never stops (reproduced)

- **Repro:** by day, hold left click on grass for 1.2 s, then release. Sampled 0.75, 1.5, 2.25 and 3 s after release:
  - `control.mining` is null
  - the body's `mine` clip has ended
  - the first-person motion is still `mine`, and stays that way

  It's the same with a log, the wooden sword and the pickaxe (empty slot) in hand.
- **Cause:** `MOTIONS.mine` in `viewModel.js` is a looping motion, and `ViewModel.render` only ever ends non-looping ones. Nothing tells the view model that digging stopped. Only switching items ends it, because the equip motion replaces it.
- **Night:** a possessed sapper's attack plays the same motion, so it would loop forever at night too.

### 0.4 Issue 4: the rotating white bar is the slash arc

- It's the "slash arc" added in plan 3:
  - a flat white rectangle, 0.7 × 0.09 in view-model space (about a quarter of the screen width), near the middle of the view
  - it turns 1.7 rad over 0.16 s
- It doesn't follow the blade. A 6-frame sheet of a night swing shows a straight pale bar across the screen in the first frames, then the sword alone.
- It only shows at night because by day a left click on a block digs instead of swinging.

### 0.5 Feature 1: the dawn rebuild today

| | Blocks to rebuild | Rate | Rebuild takes | Dawn lasts | What covers it |
|---|---|---|---|---|---|
| After the opening raid (measured) | 183 | 60 blocks/s | ~3 s | 4.0 s | the result panel ("The raiders destroyed your town"), centred over the Town Center while the camera circles |
| After a normal night (measured: 11 blocks; next_3 counted 12–28 on nights 1 and 3) | 11–28 | 300 blocks/s | ~0.1 s, on the first dawn tick | 4.1 s | the result panel ("Night 1 survived!") |

- **Order:** blocks come back in chunk storage order, so the walls reappear in scattered patches rather than growing back.
- **Effect:** each block simply pops in. 15% of them get a small sparkle.
- **Leftover panel:** after the raid, the day began with the result panel still open and the camera cut back to first person behind it.

### 0.6 Feature 2: what a new player is told today

**The only guidance a new player gets:**
- The opening raid's result text: "Use the day to mine, craft walls, towers, troops and weapons (B), and place them around the Town Center."
- The Day 1 banner.
- "Press H for controls".
- The Build panel's note.

Nothing says *where* anything is, and the "where" is not obvious (generator v1):

| Resource | Where it is | What it's for |
|---|---|---|
| log | trees, which only grow **30+ blocks from the Town Center**, outside the walls (radius 13) | planks (1 log → 4), gates, arrow towers, bow, wooden sword, archers |
| cobblestone | stone, which starts **4 blocks under the grass**. The surface is never stone, and the plaza can't be dug | stone walls, arrow and cannon towers, stone sword |
| iron | iron ore (stone with tan specks): 1.2% of stone **6+ blocks down** | iron walls, spikes, cannon towers, swordsman, gunner, iron sword, musket |
| gold | gold ore (yellow specks): 0.45% of stone **below y = 2**, about 7+ blocks under the town | every troop, musket |

- Surviving a night also pays gold and iron.
- The default world starts you with 12 cobble, 4 logs, 12 planks and a wooden sword. That's already enough for an arrow tower plus two stone walls, and nothing tells you so.
- **Defences:** the wall ring has four 3-wide wooden gates. A gate block has half the hp of a stone wall block (54 vs 108).

---

## 1. Issue 1: health bars without the black pattern

`src/game/healthBars.js`, `tests/feedback.test.js`

1. **Draw the layers in order instead of depth-testing them against each other:**
   - The bar material turns off depth **write**. Depth **test** stays on, so bars still hide behind hills.
   - The material goes in the alpha-blend pass (`transparencyMode = ALPHABLEND`, alpha 1), so it draws after terrain and units and tests against their depth.
   - Each frame, units are sorted far to near (at most 96, cheap), and each unit writes back plate → chip → fill. The GPU draws the instances of one draw call in order, so a later layer always covers an earlier one. Nothing depends on depth precision any more.
   - Still one draw call.
2. **True colours by day and night:**
   - Emissive white, so the output is exactly the per-instance colour (§0.1).
   - Blue `#3d8bff`, red `#e8412c` and the cream chip look as designed, and don't dim at night.
3. **Pure helper `barInstances(units, camPos)`:** the ordered list of (unit, layer, width fraction, colour) the pool is filled from. Unit tests cover:
   - far-to-near order
   - back → chip → fill for each unit
   - no chip when there's no recent damage
   - the flash colour

**Rejected:** nudging the fill toward the camera. It would work here, but it depends on depth precision (near plane 0.01, and some phone GPUs), so it could come back on other devices.

**Check:**
- A pixel test in the browser run: inside the fill rectangle, at least 99% of pixels are within ±12 of the expected colour, and there are no near-black rows.
- It runs at 2.5, 6, 14, 30 and 48 m, by day, at night and from the aerial camera, on both a blue and a red bar.
- A bar behind a hill is still hidden.

---

## 2. Issue 2: a pickaxe you can switch to

`src/game/balance.js`, `src/game/inventory.js`, `src/game/control.js`, `src/game/session.js`, `src/ui/hud.js`, `README.md`, `docs/world-format.md`

1. **The pickaxe becomes a real item:**
   - `ITEMS.pickaxe = { kind: 'tool' }`.
   - Always owned (count ∞, in survival too), never crafted or used up.
   - Not written to world files or the autosave, so the format and existing exports don't change.
   - It sits in **hotbar slot 1** in every game, new or loaded, and other items fill slots 2–9 as now. The hotbar isn't saved, so old saves get it too.
   - Creative's default hotbar becomes pickaxe + 8 items (the gunner drops off; it's still in the Build panel).
   - It can be moved to another slot in the Build panel, but it can't be removed from the hotbar (assigning over it swaps).
   - It gets a ⛏ badge icon and the label "Pickaxe".
2. **Switching:**
   - **1** / wheel / tap the slot, as for any item.
   - **Q** (or the middle mouse button) swaps between the pickaxe and the last other item you held. Both are noa's unused "mid-fire" bindings.
   - The Controls panel, the touch help line and the README list it.
3. **Each day starts with the pickaxe selected.** Dusk still switches to your best weapon.
4. **Digging always shows the pickaxe:**
   - Holding left click on a block with a block or a troop selected digs as today, but your hand switches to the pickaxe while you dig and back when you stop.
   - With a sword selected by day, left click still hits attackers first. On a block, you dig with the pickaxe.
   - Digging speed is unchanged.
5. **At night** the pickaxe slot fights with your best weapon, the same rule as any non-weapon item today.
6. `placeSelected` with the pickaxe in hand gives the toast "The pickaxe digs with left click".

**Tests** (`tests/game.test.js`):
- The pickaxe is in slot 0 for new, loaded and creative inventories.
- `count` is ∞ and `toJSON` leaves it out.
- `assign` can't push it off the hotbar.
- Q-swap goes back and forth between the pickaxe and the last item.
- `selfWeapon` with the pickaxe: `none` by day, the best weapon at night.

---

## 3. Issue 3: tool motions that stop when you let go

`src/game/viewModel.js`, `src/game/control.js`, `tests/feedback.test.js`

1. **`Control.render` tells the view model whether you're digging:** `view.setDigging(!!this.mining)`.
2. **The `mine` motion loops only while digging.**
   - When you stop, it finishes the chop it's in (≤ 0.42 s, returning to rest) and ends.
   - Started without digging (a possessed sapper's hit), it plays once.
3. **The motion step is a pure function:** `stepMotion(action, dt, keepLooping)` → the new action or null. This is so no future looping motion can get stuck the same way. Unit tests:
   - `mine` keeps going while digging and ends within one cycle after release.
   - It restarts when you dig again.
   - `swing`, `place`, `draw`, `recoil`, `equip` and `hit` end after their own time.

**Check:** the §0.3 repro, run again. Within 0.45 s of releasing, the motion is null with the pickaxe, the sword and a block in hand. A possessed sapper chops once per attack.

---

## 4. Issue 4: a blade trail instead of the white bar

`src/game/viewModel.js`

1. **Remove the flat `vm-arc` plane.**
2. **Add a blade trail**, a thin streak that follows the tip of the sword through the slash and fades behind it:
   - **Built from the swing curve itself.** The motion is analytic, so each frame of the down-stroke it samples the last ~0.08 s of the curve at 10 points. For each point it computes the blade tip and a point 45% down the blade, in view-model space. The trail is smooth at any frame rate, and it's always attached to the blade.
   - **Tapered:** full width at the blade, a point at the tail.
   - **Faded:** vertex alpha goes from 0.4 at the blade to 0 at the tail.
   - **Tinted by the weapon:** warm for wood, grey for stone, cool white for iron.
   - **Only on the down-stroke,** not the wind-up: about 0.12 s per swing.
   - **Cost:** one updatable 22-vertex ribbon in rendering group 1 with the rest of the view model, drawn only while it's visible.
3. **Swords only** (yours and a possessed swordsman). Fists, the pickaxe and the bow get no trail.
4. **Confirming a landed swing** is still the crosshair hit-marker, the target's flash and the damage number.

**Check:** frame sheets of a night swing at 60 fps and at about 20 fps (CPU throttle). Pass criteria:
- no straight bar in any frame
- the streak stays on the blade tip
- it's gone within 0.15 s of the stroke

---

## 5. Feature 1: a slower dawn rebuild you can actually watch

`src/game/balance.js`, `src/game/cycle.js`, `src/world/worldState.js`, `src/game/session.js`, `src/game/rebuild.js` (new), `src/ui/hud.js`/`hud.css`

### 5.1 Paced by time, not a fixed rate

- **At dawn start, the rebuild gets a duration from how much is broken:**

  | Night | Rebuild | Whole dawn (1 s first light + rebuild + 1.5 s to look at it) | Today |
  |---|---|---|---|
  | normal night | `3 s + 0.1 s per block`, clamped to 5–10 s. 11 blocks → 5 s, 28 → 5.8 s, 60 → 9 s | 7.5–12.5 s | 4 s, rebuild ~0.1 s |
  | opening raid (183 blocks) | 12 s (≈15 blocks/s) | 14.5 s | 4 s, rebuild ~3 s |
  | nothing broken | — | 4 s, as today | 4 s |

- The numbers go in a `DAWN` table in `balance.js`, replacing `DAWN_RESTORE_RATE` and `OPENING_RAID.dawnRestoreRate`.
- `DayCycle` gets the dawn length from the session. The sky's dawn colours stretch over the same time.
- **Skip button:** the dawn banner has one. It restores the rest at once and moves on to the 1.5 s look.

### 5.2 In an order you can follow

- **Pure `restoreOrder(blocks, townCenter)`**, unit tested:
  1. The Town Center first, bottom-up.
  2. Then everything else layer by layer (by height), each layer sweeping around the town clockwise from the north.
- Walls visibly grow back side by side, towers rise with them, and nothing appears before the block under it.
- `WorldState.restoreDamage` takes blocks from that queue instead of storage order.

### 5.3 Each block visibly comes back

`src/game/rebuild.js`:
- A pale gold "ghost" cube grows up from the block's base over 0.25 s. The real block appears under it, and the ghost fades out.
- The ghost cubes are one thin-instance pool (as in `cracks.js`): one draw call, at most 64 at once, only during dawn.
- A sparkle on every 4th block, and a soft, throttled sound tick.

### 5.4 Nothing covers it

- **The night result becomes a side card during dawn**, in the role picker's style. It sits at the right, so the town stays in view. **Continue** still closes it.
- **Dawn banner:**
  - Text: "Dawn: your town rebuilds itself after every night".
  - It's worded for the first three dawns only, then shortened.
  - It has the **Skip** button from §5.1.
- **Phase chip:** a progress bar, "Rebuilding 34 / 183".
- **Camera:**
  - After the opening raid, the orbit now lasts for the whole rebuild.
  - After a normal night, the camera stays yours. If the part being rebuilt is off screen, a gold edge arrow points at it (the alert markers, in a friendly colour).
- **Leftover panel fixed:** the day never starts with the result card still open over first person. It closes itself at day start if you didn't close it.

**Tests:**
- the `dawnPlan(blocks, opening)` durations
- `restoreOrder`: the Town Center first, heights never decreasing after it, the sweep order within a layer
- `DayCycle` waits for the rebuild before day
- Skip

---

## 6. Feature 2: tips for a slow first few days

`src/game/guide.js` (new: step logic, pure and tested, plus a small driver), `src/ui/hud.js`/`hud.css`, `src/game/session.js`, `src/core/settings.js`

### 6.1 When a tip shows

- **Where it applies:** survival only, days 1–3, by day only.
  - Never during the raid, dusk or night, or while a panel is open.
  - Never over the Day 1 banner.
- **Only when you're slow:** a tip shows when the current step has had no progress for a while.
  - Day 1: 25 s after the Day 1 banner goes.
  - Every later step: 40 s without progress on it.
  - Progress means gaining that step's item, crafting, or placing something. A player who's already busy never sees a tip.
- **When it goes away:**
  - A tip hides as soon as its step is done, with a short ✓.
  - The next tip waits for its own timer.
  - Steps you've already done are skipped. For example, you already have iron from a night reward.
- **Turning tips off:**
  - A **Tips** checkbox in the pause menu, on by default. Turning it back on starts the tips over.
  - A **Hide tips** button on the card.
  - `?tips=0` for test and perf runs.
- **Saved** in settings (`localStorage`, guarded), so a returning player doesn't get them again.

### 6.2 The steps

Wording is shown for desktop. On touch, "left click" becomes the ⛏ button, "right click" becomes ▣, and "B" becomes the Build button.

| # | Tip | Where it points | Done when |
|---|---|---|---|
| 1 | **Wood.** "Trees grow outside the walls. Hold left click on a trunk to chop logs. Build (B) turns 1 log into 4 planks." | a marker on the nearest tree trunk, with its distance | a log is gained |
| 2 | **Stone.** "Stone is 4 blocks under the grass. Pick the pickaxe (1), look down and dig. Stone drops cobblestone. The plaza can't be dug." | a marker on a dig spot near you, just off the path | cobblestone is gained |
| 3 | **Craft.** "You can craft now: B → …". Lists up to 3 useful recipes you can afford right now, e.g. "Arrow tower (6 planks, 4 cobble), Stone wall ×2 (3 cobble), Gate (4 planks)". | the Build button pulses, and those recipes are highlighted in the panel | anything is crafted |
| 4 | **Defend.** "Right click places the selected item. Gates are the weak spots (half a stone wall's hp): back them with stone walls, put arrow towers just inside the wall, and place troops near the gates. Attackers can come from any side." | markers on the four gates and the tower corners | a wall, tower, gate, spikes or troop is placed |
| 5 | **Iron and gold** (after 1–4, or from day 2). "Iron ore (tan specks) is 6+ blocks down; gold (yellow specks) is deeper, below height 2. Troops need gold; iron walls and cannon towers need iron. Surviving a night also pays both." | a marker on the ground above the nearest iron ore, e.g. "Iron · 7 down" | iron or gold is gained |
| 6 | **Night prep** (once a day, days 1–3, 60 s before night). "Night in 1:00. You fight with your best weapon; R lets you play a troop or watch from above; N starts the night early." | — | shown once |

`suggestCrafts(inventory)` is pure and tested. It prefers the arrow tower, then stone walls, gate, archer, iron wall and cannon tower.

### 6.3 Finding "where"

- **Trees:** the nearest `log` block within 40 blocks.
- **Iron and gold:** the nearest ore within 20 blocks, at the right depth.
- **Both scans read loaded chunks only**, in slices of at most 1 ms per frame, and only while that tip is up. The generator isn't touched (it's frozen).
- **The dig spot:** the nearest grass or dirt cell outside the plaza and path.
- **Gates and tower corners:** taken from the world's edits.
- **Markers:** a new "guide" kind of the existing alert marker.
  - a ring and label on screen, or an arrow at the edge when off screen
  - gold with an icon (🌲 ⛏ ◆), and the distance in blocks
  - they last while the tip is shown

### 6.4 The card

- **Desktop:** a card at the left under the mode chip, at most 3 lines, with **Hide tips**.
- **Phone:** a 2-line strip above the hotbar.
- It never takes pointer lock or pauses the game.

**Tests** (`guide.js` pure step logic):
- no tip before its delay, and a tip after it
- progress resets the timer
- hidden at dusk and night, while a panel is open, and in creative
- steps already done are skipped
- nothing after day 3
- the night prep tip fires once per day
- saved progress survives a settings reload, including storage that throws

---

## 7. Order of work, and verification

### 7.1 Order

1. **§3 tool motions:** small, and the most annoying bug.
2. **§1 health bars:** order, depth write and colours, plus the pixel check.
3. **§4 blade trail.**
4. **§2 pickaxe item:** Q swap, digging shows the pickaxe, day-start selection.
5. **§5 dawn:** plan and order, then ghosts, then side card, banner and Skip.
6. **§6 tips:** step logic, then scans and markers, then card, settings and wording.
7. **Performance pass**, then `ai/next_4.md`.

### 7.2 Unit tests (`npm run check`)

The ones listed in each section:
- bar instance order
- pickaxe inventory rules
- `stepMotion`
- `dawnPlan` and `restoreOrder`
- tip step logic and `suggestCrafts`
- settings with the new keys

### 7.3 Scripted browser runs (Playwright)

- **Health bars:** the §1 pixel check at 5 distances × day, night and aerial, for a blue bar and a red bar. Screenshots before and after.
- **Pickaxe:**
  - day 1 starts on slot 1 with the pickaxe
  - Q swaps back and forth
  - digging with a log selected shows the pickaxe, then the log again
  - after night 1, the day starts on the pickaxe
  - touch (412×915): slot 1 shows ⛏
- **Motions:** the §0.3 repro for the pickaxe, the sword and a block. Pass: null within 0.45 s of release.
- **Blade trail:** the 6-frame night swing sheet at 60 fps and throttled.
- **Dawn:**
  - Opening raid, 2 runs: a timeline of phase, blocks left and panel, and a rebuild sheet (4 frames). Pass: the result is a side card, the Town Center is visible, the rebuild takes ~12 s, and the day starts with no panel over first person.
  - A normal night: dawn 7.5–12.5 s.
  - Skip.
  - The longest frame during the rebuild at 4× CPU is ≤ 50 ms. Spreading the rebuild out means fewer chunk remeshes per frame than today.
- **Tips:**
  - A fresh profile idling on day 1: tip 1 at ~25 s, with a marker on a tree.
  - Chopping a log hides it.
  - Tips 2–5 each show when idle and hide when done.
  - A scripted busy player (digs within 10 s, crafts, places) sees none.
  - The night hides them.
  - A reload keeps done steps done, and Tips off hides everything.
  - Phone layout.

### 7.4 Performance

- **Build:** `npm run build` budget passes. Game code grows ≤ 12 KB brotli (from 327.9 KB; the budget is 550 KB). No new downloads.
- **Load:** menu interactive and first playable frame within ±0.2 s of next_3, alternating old and new builds as before.
- **Night benchmark** (`perf`, `perf:mobile`, `--quality=low`): within 1 fps of next_3. The bar sort adds ≤ 0.1 ms per frame with 96 units.
- **Tip scans:** ≤ 1 ms per frame, logged, at 4× CPU throttle.
- **Draw calls added:**
  - health bars: 0 (still 1)
  - blade trail: 1, only during a swing
  - rebuild ghosts: 1, only at dawn
  - tips: 0 (DOM)

---

## 8. Choices I made that you may want to override

1. **Health bars keep their look:** dark back plate, damage chip, flash. Only how they're drawn changes, plus the true colours.
2. **The pickaxe is a permanent item in slot 1.** It's always owned, can be moved but not removed, and isn't saved in world files.
3. **Digging always shows the pickaxe, whatever is selected.** Alternatives: dig with whatever is in hand (today), or only allow digging with the pickaxe selected.
4. **Each day starts with the pickaxe selected**, rather than with the slot you had before dusk.
5. **Q (and middle click) swaps between the pickaxe and your last item.**
6. **The slash arc becomes a blade trail on swords only.** The alternative is no trail at all.
7. **Dawn lengths:** the rebuild takes 5–10 s after a normal night and 12 s after the opening raid, with a **Skip** button.
8. **Rebuild order:** the Town Center first, then layer by layer, sweeping around the town.
9. **The night result is a side card during dawn**, instead of a centred panel.
10. **Tips:**
    - survival only, days 1–3
    - only when you're slow: 25 s on day 1, then 40 s without progress on a step
    - saved per browser
    - a Tips switch in the pause menu
11. **The iron and gold tips point through the ground** to the nearest ore. It's a small "x-ray" for new players. The alternative is text only.
