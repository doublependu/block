# Plan 3: walks without kicks, seeing your own attacks, units that bump into each other, health bars, and clearer hits

Answers `ai/prompt_3.md`. Nothing below is implemented yet.

---

## 0. What I found before planning

I ran this repo's dev server (port 5199, because 5173 was serving another project) with scripted Playwright sessions, logged state from `window.game`, and read the exported GLBs directly. No project files were changed. The one screenshot kept is `.playwright-mcp/p3-walk-sheet.png` (git-ignored).

### 0.1 Issue 1: the "kicking" walk is a broken animation curve

**What it looks like.** I filmed a grunt walking at 3.57 m/s (12 frames). Mid-cycle frames show a near-horizontal front kick and a back kick with the heel above the knee. A swordsman wandering past did the same.

**What the engine actually plays.** I sampled `upper_leg.L` from the loaded animation groups, at Babylon's 60 frames per second:

| Clip | Authored swing | What plays |
|---|---|---|
| walk (0.8 s) | ±30° | smooth 30° → 0°, then a jump at frame 14, then **−39° → +26° between frames 28 and 30** (65° in 1/30 s) |
| run (0.53 s) | ±55° | **−73° → +49° in 1.3 frames** (122° in about 1/45 s) |

**Root cause: quaternion sign flips in the GLBs.**
- Leg and arm bones point down, so relative to their parent their rest rotation is 180° about X. A ±30° swing crosses 180°.
- The exporter wrote every key with w ≥ 0. So the `walk` keys for `upper_leg.L` are `(0.966,0,0,0.259)` → `(1,0,0,0)` → `(−0.966,0,0,0.259)`. The third key is the same rotation as `(0.966,0,0,−0.259)`, but it's in the opposite hemisphere (dot product −0.966 with its neighbour).
- The channels are `CUBICSPLINE`. Babylon interpolates those component by component (Hermite, then normalises), so the in-between values pass close to a zero quaternion and the limb whips through a wrong arc. The tangents Blender wrote were also computed across the flip.
- (`LINEAR` channels would be fine: Babylon's slerp takes the short way.)

**How widespread** (script over `public/models/*.glb`):

| GLBs | Rotation channels with a sign flip | Clips and bones |
|---|---|---|
| all 8 characters | 13 of 208 each | `walk`, `run`: both upper legs and both upper arms. `jump`: both upper arms and the left upper leg. `hit`: both upper arms (so every unit that gets hit flails its arms too) |

**Also wrong, but secondary** (it shows once the flip is fixed):
- **Feet skate.**
  - The walk clip covers roughly 1.9 m/s of ground at speed ratio 1. A grunt walks at 3.6 m/s and plays it at ratio 1.03.
  - The run clip covers roughly 4.5 m/s at ratio 1. The builder runs at 10 m/s and plays it at ratio 1.43, which covers about 6.5 m/s.
  - These are hand estimates from leg length and swing angle.
- **The swinging leg stays straight through the passing position.** The knee bends only while the leg is behind, and the foot never rolls, so the toe points up at the front.
- **Clips switch abruptly.** idle / walk / run change at fixed thresholds (0.5 and 5.5 m/s), with no hysteresis and no cross-fade.

### 0.2 Issue 2: first person shows nothing in your hands

- **Nothing is drawn in your hands.** `Control.render` hides the whole controlled character when the camera zoom is under 1.2, and that includes the held item mesh. There's no first-person view model. My first-person screenshot, with a log selected, shows empty hands.
- **Attack animations play only on the hidden body.** Swings, mining and shooting all run there. What you get instead:
  - a sound
  - the target's blood burst: 5 cubes × the tier's particle scale, so about 4 on med and 2 on low
- **Projectiles start at 0.8 × body height, just under the camera.** Arrows appear already some distance away instead of leaving the bow.

### 0.3 Issue 3: units walk through each other

**Collision was intended but is far too weak.**
- `UnitManager` has a "soft separation" handler on noa's `collideEntities`. Each tick, it gives each unit of an overlapping pair an impulse of 2.5 × 0.05 = 0.125. That's about 4 m/s², roughly 7× weaker than the force a unit walks with (`moveForce` 28).
- It **never pushes a unit that's being controlled**: your builder in self mode, or the unit you're playing. So you walk through everyone, and they walk through you.

**Measured**: night 1, default world, med tier, no input, sampled every 0.25 s for 60 s, 14.2 living units on average:

| Measure | Result |
|---|---|
| Unit-time spent overlapping another unit | **16.8%** |
| Overlapping pair samples | 409 |
| … of those, more than half merged (distance < 50% of the radius sum) | **289** |
| Closest pair | 0.01 × radius sum (the same spot) |
| By side | attacker–attacker 407 (stacks at walls and gates), attacker–defender 2 (melee range stops them just before touching) |

**Things a real fix has to handle:**
- **Jump spam.** A unit blocked by a crowd builds up `stuckTime` and starts jumping after 0.35 s.
- **Restarts from the queue.** An attacker queued behind others at a wall for 25 s triggers the "stuck" restart and is sent back to its front.

### 0.4 Features: what exists today

- **No health bars on units.**
- **Settings aren't saved.** The HUD has Quality, Mute and Show FPS in the pause menu; nothing is saved across reloads.
- **Hit feedback today:**
  - **Unit hit:** a tiny burst, a full-body `hit` clip (with the arm flail from §0.1, and the unit's legs freeze for 0.33 s), and a sound.
  - **Block hit:** 3 grey cubes and a dig sound. `worldState` emits `blockDamaged` with the hp fraction, but nothing draws it.
  - **Town Center hit:** 4 cubes, a sound, and the top HUD bar.
  - **You get hit:** nothing on screen apart from the HP chip width.

---

## 1. Issue 1: walks and runs without kicks

`tools/blender/make_characters.py`, `src/characters/library.js`, `src/characters/animFix.js` (new), `tools/validate-glb.mjs`, `tools/anim-check.mjs` (new), `src/game/units.js`

### 1.1 Fix the curves (bundled and external models)

1. **Pure `alignQuaternionKeys(channel)`** in `src/characters/animFix.js`:
   - Walks a rotation channel's keys. When a key's dot product with the previous key is negative, it negates the key (and its tangents).
   - If anything was flipped in a `CUBICSPLINE` channel, it recomputes that channel's tangents from the aligned neighbours: Catmull-Rom, with wrap-around for looping clips.
   - This gives zero slope at the swing extremes and a smooth pass through the middle, like Blender's auto handles.
2. **Build step:** `tools/fix-glb-rotations.mjs` applies it to the glTF data, and `npm run characters` runs it right after Blender. The committed GLBs are clean, whatever the exporter does.
   - Blender is at `~/Downloads/blender-5.2.1-linux-x64/blender`, so the script runs with `BLENDER=… npm run characters`.
3. **Runtime guard:** `CharacterLibrary._prepareContainer` runs the same function on every quaternion animation of a loaded container. External avatars (`?avatar=`) and GLBs you replace later get fixed too. It costs well under a millisecond per model (≈200 channels × ≤ 5 keys).
4. **Validator:** `npm run validate-glb` fails on any rotation channel with a sign flip between consecutive keys.

### 1.2 Better walk and run cycles (same script, contract names and lengths unchanged)

- **walk:**
  - Contact: thigh +25°, knee −5°, foot rolled flat.
  - Passing: swing knee −45°, foot ≥ 6 cm off the ground.
  - Push-off: thigh −20°, knee −10°, toe down.
  - Arms ±18° with a 10° elbow. The hips dip at contact and rise at passing.
- **run:**
  - Passing: swing knee −95° (heel toward the hip).
  - Landing: thigh +40°, knee −20°.
  - Push-off: thigh −35°.
  - Upper body: 10° forward lean, elbows at 80°, arms ±40°.
- **`hit` becomes an upper-body flinch** (spine, head, arms only; `contract.js` moves it from `FULL_ACTIONS` to `UPPER_ACTIONS`). A unit that gets hit keeps walking instead of freezing mid-stride.
- **`docs/character-contract.md`:**
  - Rotation keys should be hemisphere-continuous (the loader fixes them either way).
  - `hit` is upper body.

### 1.3 Playback that matches the ground

- **`tools/anim-check.mjs`** (Node): forward kinematics of the leg chain in the side plane, straight from a GLB. Per model × clip it prints:
  - the ground speed the stride covers at speed ratio 1
  - swing-foot clearance
  - stance-foot slide
  - the largest per-frame limb rotation
- **Stride-matched playback:** its walk and run ground speeds go into `contract.js` as `CLIP_GROUND_SPEED`, and `UnitManager.render` sets `speedRatio = speed / (CLIP_GROUND_SPEED[clip] × height / 1.75)`, clamped to 0.5–2.2. External GLBs use the same numbers, scaled by height.
- **Hysteresis:** walk on at ≥ 0.7 m/s and off at ≤ 0.35; run on at ≥ 6 and off at ≤ 5.
- **Cross-fade:** a ~0.1 s cross-fade between base clips (`AnimationGroup.enableBlending`), kept only if the night benchmark stays within 1 fps (§6.4).

**Targets:**
- 0 flipped channels in all GLBs.
- Largest thigh change between 60-fps frames: ≤ 8° walking and ≤ 12° running (today 65° and 122°).
- Stance-foot slide ≤ 15% of the unit's speed for grunt, brute, swordsman and builder speeds.
- A new contact sheet with no kick in any frame.

---

## 2. Issue 2: see what you hold and the attack you make in first person

`src/game/viewModel.js` (new), `src/game/control.js`, `src/characters/contract.js`, `src/ui/hud.js`/`hud.css`, `src/input/touch.js`

### 2.1 The view model

**What's in view:**
- **Your right arm:** a sleeve box and a hand box, in the character's colours. A `FP_ARM` table in `contract.js` has sleeve and skin colours per bundled model, matching the Blender specs; external avatars use the player's.
- **The held item:**

  | Selected | Shown |
  |---|---|
  | pickaxe, swords (tier tint), bow, musket | the `items.glb` mesh, as on the body today |
  | a block | a small cube textured with that block's atlas tiles |
  | a troop item | empty hand |

- **Playing a unit:** its own item (swordsman sword, archer or raider bow, gunner gun, sapper pickaxe). Grunts and brutes show two fists.

**How it renders:**
- Meshes are parented to noa's Babylon camera (`noa.rendering.camera`, as noa's own underwater screen is).
- They sit in rendering group 1 with depth cleared, so they never clip into walls or units.
- They're lit by the scene light, so they darken at night, with no fog.
- 3–5 meshes, drawn only in first person.
- Hidden in third person, aerial view, and while the controlled unit is dead.

### 2.2 Motions (procedural, in code)

| Action | Motion | Length |
|---|---|---|
| idle | slow breathing sway | loop |
| walking / running | bob and sway driven by distance travelled | loop |
| melee (sword, fists, pickaxe on a unit) | wind-up to the upper right → diagonal slash to the lower left, plus a white slash-arc ribbon fading over 0.15 s | 0.3 s |
| mining | repeated chop while `control.mining` is set | loop |
| place a block or troop | quick push forward | 0.2 s |
| bow | draw back, release snap | 0.25 s |
| musket / gunner | recoil kick + muzzle flash (a few bright particles) | 0.3 s |
| change slot | lower and raise | 0.2 s |
| you get hit | jolt down | 0.15 s |

- One helper, `Control._playAction(unit, name)`, plays the body clip (for third person and other players) and the view model motion (first person). It replaces the five direct `playAction` calls in `control.js` and the one in `session.js`.

### 2.3 Seeing that it landed

- **Crosshair hit-marker:** four ticks flash for 150 ms when your melee or projectile hits a unit. They're red on a kill.
- **At the target:** sparks, plus the §5 flash and knockback.
- **Projectiles leave the weapon:** in first person, projectiles start at the view model's muzzle (converted to world space) and aim at the crosshair point, so you see the arrow leave the bow.
- **Touch fire button:** its glyph follows the action: ⛏ mine, ⚔ melee, 🏹 bow, 💥 musket or gun.

---

## 3. Issue 3: units collide with each other

**Answer:** yes, they were meant to (see §0.3). The pushing was far too weak, and it skipped whoever you control.

`src/game/crowd.js` (new, pure solver + tests), `src/game/units.js`, `docs/protocol.md`

### 3.1 Separation solver (every tick)

- **Where in the tick:** after brains and movement, before the gate barrier.
- **Which units:** alive, active units in loaded chunks, in a 2 m spatial hash (O(n)).
- **The push:** for each pair that overlaps vertically and is closer than the sum of their radii, both are pushed apart along the line between them. The push is the overlap split by mass (the lighter unit moves more), 2 iterations, at most 0.15 m per unit per tick (no popping).
- **Masses:**

  | Unit | Mass |
  |---|---|
  | grunt, raider, sapper, defenders | 1 |
  | brute | 2.5 |
  | a unit busy hitting a block or the Town Center | ×3 (holds its spot at a wall) |
  | your builder and any unit you control | ×4 (a crowd can nudge you, you can't walk through it) |

- **Terrain-safe:** a push on an axis is applied only if the unit's box stays out of solid blocks. Attackers are never pushed into a gate cell. The gate barrier still runs after it.
- **Velocity:** the part of each unit's velocity that points into the other unit is removed. Units stop running in place and play idle or walk correctly.
- **Removed:** noa's `collideEntities` component on units and the old impulse handler (one less box-intersect pass per tick).
- **Excluded:** corpses and a knocked-out builder.
- **Multiplayer note:** in `docs/protocol.md`, other players' builders (presence) are fixed obstacles for local units.

### 3.2 Crowd behaviour

- **Steer around:** when an ally is standing or slower within 1.2 m ahead, the unit steers ±40° around it for 0.5 s (the side is fixed per unit id). If both sides are blocked, it waits instead of pushing.
- **No jump spam:** time blocked by units doesn't count toward `stuckTime`.
- **No restart from a queue:** the 25 s restart is skipped while the attacker is within 6 blocks of an ally that's hitting a structure or the Town Center.
- **Wreckers re-target:** a wrecker that can't get within reach of its structure target for 3 s picks another wall block in reach of its siege goal, excluding blocks already being hit.
- **Blocking is real:** defenders and your builder can now physically hold a gate or a breach.

**Targets** (same 60 s night 1 log as §0.3):
- 0 pair samples more than half merged.
- Overlap deeper than 10% of the radius sum ≤ 2% of unit-time.
- You, walking into a standing swordsman or grunt, stop at ≥ 0.9 × radius sum.
- 0 units inside solid blocks, and 0 attackers inside gate cells.
- Stuck restarts per night no higher than today.

---

## 4. Feature 1: health bars over attackers and defenders

`src/game/healthBars.js` (new), `src/core/settings.js` (new), `src/ui/hud.js`, `src/game/session.js`

### 4.1 Drawing

- **One draw call:** a single thin-instance pool of unlit, fog-free quads with per-instance colour. Each unit gets 3 instances: a dark backing, a light "recent damage" chip, and the side-coloured fill.
- **Colours:**
  - **Defenders** (troops and your builder): blue `#3d8bff`.
  - **Attackers:** red `#e8412c`.
  - Blue and red stay distinct for red–green colour blindness. The dark backing keeps both readable by day and at night.
- **Placement:** 0.35 above the head, facing the camera.
  - Size 0.9 × 0.12 m (brute 1.2 m).
  - In aerial view they scale with distance (×1 at 15 m up to ×2.5 at 60 m), so they stay readable from above.
- **Shown for** alive, active units within 48 blocks (32 on the low tier).
- **Hidden:**
  - behind terrain (depth-tested, so no seeing attackers through hills)
  - on the unit you control in first person (the HP chip covers it)
  - on corpses and a knocked-out builder
- **On a hit:** the fill flashes white for 0.1 s. The recent-damage chip stays 0.4 s and then shrinks, so you see how big the hit was.

### 4.2 The option

- **Where:** pause menu → Settings → **Health bars** checkbox, on by default.
- **Saved** in `localStorage` through `src/core/settings.js` (all access in try/catch, defaults when storage is blocked). Mute and Show FPS are saved the same way while I'm there.
- **Off** disables the pool: no draw call and no per-frame work.
- **`?hpbars=0`** turns it off for perf comparisons.
- The Controls panel mentions where the option is.
- Nothing is sent over the network; this is local rendering only.

---

## 5. Feature 2: clearer cues when something or someone is attacked

`src/characters/library.js`, `src/game/units.js`, `src/game/effects.js`, `src/game/cracks.js` (new), `src/ui/hud.js`/`hud.css`, `src/game/session.js`

All of these scale with the tier's particle setting and add no downloads.

### 5.1 Units

1. **Hit flash:** the character's body meshes switch to one shared white-red flash material for 0.12 s. It's compiled at session start, so the first hit doesn't stutter.
2. **Directional impact:** particles spray away from the attacker, 8 at full tier (was 5 in random directions), plus one quick white pop.
3. **Knockback:** a small push away from the attacker through physics velocity, so terrain, gates and §3 still hold. It doesn't interrupt attacks.
   - melee 1.2 m/s
   - brute 3 m/s
   - cannon splash 4 m/s
4. **Flinch** (from §1): a clean upper-body `hit` without flailing arms or frozen legs.
5. **Health bar** flash and recent-damage chip (§4).
6. **Damage numbers for your hits:** a small number rises over the target for 0.7 s for damage dealt by your builder or the unit you play.
   - At most 12 on screen, as pooled DOM elements.
   - Positioned every frame from `session.render`, not the 100 ms HUD tick.
   - `units.damage` gets an optional direction or source position so §5.1 and §5.2 know where a hit came from.

### 5.2 You

7. **Damage vignette:** red screen edges, stronger for bigger hits (damage / max HP), with a brighter wedge on the side the hit came from, fading over 0.5 s. One DOM element, in first and third person.
8. **Camera punch:** a small one through `control.shake`, capped low, and not in aerial view.
9. **HP chip:** flashes red.

### 5.3 Structures

10. **Cracks on damaged blocks:**
    - Four stages: below 100%, 75%, 50% and 25% hp.
    - Drawn as a slightly larger cube over the block. The crack texture is drawn once on a 64×16 canvas at startup.
    - One thin-instance pool per stage, drawn only when used: ≤ 4 draw calls and ≤ 256 cracked blocks.
    - Driven by `blockDamaged`, `blockDestroyed` and `blockRestored`, and cleared at dawn.
11. **Block chips:** in the block's own colour (the average of its atlas tile), sprayed toward the attacker. Today they're 3 grey cubes.
12. **Town Center hits:**
    - The HUD town bar pulses red on every hit.
    - If the Town Center is off screen (or you're facing away in first person): a "The Town Center is under attack!" toast at most every 10 s, and a pulsing red edge marker pointing at it for 3 s.
13. **Towers, gates and breaches:**
    - The first hit on a tower or gate in 15 s puts an edge marker with an icon on it for 3 s.
    - The first wall or gate block destroyed on each side per night shows "The north wall is breached!" and a marker for 4 s.
    - Markers reuse the existing edge-arrow system (a new "alert" kind: an icon, no count). When the spot is on screen, they show a pulsing ring there instead.

---

## 6. Order of work, and verification

### 6.1 Order

1. **§1.1 quaternion fix:** `animFix.js`, post-export fix, runtime guard, validator rule. Contact sheet before and after. Small, and the most visible win.
2. **§1.2–1.3:** new walk and run keys, upper-body `hit`, `anim-check`, stride-matched playback, hysteresis, cross-fade (if cheap).
3. **§3 collisions:** solver, steering, stuck rules. The overlap log, then balance re-runs, because this changes how sieges play.
4. **§4 health bars** + settings.
5. **§2 view model**, hit-marker, projectile origin, touch glyph.
6. **§5 cues:** flash, knockback, bursts, vignette, damage numbers, cracks, alerts.
7. **Balance and performance passes**, then `ai/next_3.md`.

### 6.2 Unit tests (`npm run check`)

- **Animation:**
  - `alignQuaternionKeys`: a synthetic 5-key channel with a flip samples within 1° of the intended rotation, and a clean channel is left untouched.
  - The validator fails on the old GLBs' channels.
- **Crowd:**
  - Two overlapping units end ≥ the radius sum apart within a few ticks.
  - Mass split (the builder moves less than a grunt).
  - No push into a solid block, no attacker pushed into a gate cell.
  - Max push per tick.
  - Corpses are ignored.
- **Stride playback:** speed ratio from `CLIP_GROUND_SPEED`, and the hysteresis thresholds.
- **Health bars:** layout from hp, max hp and recent damage (fill and chip widths), and distance scaling.
- **Cracks:** `crackStage(hpFraction)`.
- **Settings:** load and save with working storage, and with storage that throws.
- **Vignette:** hit-direction wedge from source position and camera heading.

### 6.3 Scripted browser runs (Playwright)

- **Walk and run:**
  - Contact sheets for grunt, brute, swordsman and builder.
  - In-engine per-frame thigh and upper-arm rotation within the §1.3 targets, for all 8 models.
  - `anim-check` stance slide ≤ 15%.
- **First person:**
  - Screenshots for pickaxe mining, each sword swinging, bow, musket, a block placed, a possessed grunt's fists, and an archer's bow.
  - Facing a wall at 0.3 m: no clipping.
  - A hit shows the hit-marker, and the arrow is visible leaving the bow.
  - Touch (412×915): the fire glyph changes, and swinging works.
- **Collisions:**
  - The §0.3 night 1 log, 3 runs, meeting the §3.2 targets.
  - Walking into a swordsman and into a grunt.
  - A crowd at a gate: 0 inside gates or solid blocks, jumps per attacker per minute compared with today, stuck restarts.
- **Balance re-runs** (collision, knockback and flinch changes):
  - **Opening raid**, 3 runs: the plan 2 contract (walls ≥ 70% destroyed, 4/4 towers, Town Center gone, 60–100 s).
  - **Nights 1 and 3**, 3 runs each with the builder on autopilot, compared with the next_2 table.
  - Tuning knobs: `SIEGE`, wave budget.
- **Health bars:**
  - Screenshots in aerial view at night and in first person by day.
  - Toggling off shows no bars and survives a reload.
  - Mobile layout.
- **Cues:** screenshots of a hit flash, all 4 crack stages, the vignette with its wedge, the Town Center alert off screen, and a breach marker.

### 6.4 Performance

- **Build:** `npm run build` budget passes. Game code grows ≤ 15 KB brotli (from 319.1 KB). Each GLB stays under the validator's 150 KB.
- **Load:** menu interactive and first playable frame within ±0.2 s of next_2, alternating old and new builds as last time, since desktop load times vary a lot on this machine.
- **Night benchmark** (`perf`, `perf:mobile`, `--quality=low`) with health bars on:
  - ≥ 55 fps on each profile (this Chrome caps at 60).
  - Bars on vs off within 2 fps.
  - The cross-fade stays only if it costs ≤ 1 fps.
- **Opening raid on low tier with 4× CPU throttle:** longest frame ≤ 50 ms, 0 frames over 50 ms (next_2: 34 ms).
- **Crowd solver time per tick** (logged): ≤ 0.5 ms with 70 attackers on desktop, ≤ 2 ms at 4× CPU throttle.
- **Draw calls added:** health bars 1, cracks ≤ 4, view model ≤ 5 (first person only).

---

## 7. Choices I made that you may want to override

1. **Health bars on every unit, all the time**, day and night. Alternative: only when damaged or during a fight.
2. **Your builder's bar uses the defender blue.** No third colour. The unit you control in first person shows no bar.
3. **Health bars are hidden behind terrain**, so attackers behind a hill stay hidden.
4. **Everyone collides with everyone, both sides, including you.** Defenders and your builder can block a gate or a breach. Brutes are heavier.
5. **Units are pushed apart, not made fully solid.** A big crowd can nudge you a little.
6. **The first-person arm is a simple box arm** in each character's colours, in the same placeholder style.
7. **Damage numbers only for damage you deal**, not for every hit in the battle.
8. **Knockback is small** and never interrupts attacks. It may shift balance a little; the re-runs in §6.3 check that.
9. **`hit` becomes an upper-body flinch.** Units keep walking when hit.
10. **Walk and run are re-keyed**, not only flip-fixed: knee bend, foot roll, smaller arm swing. The GLBs are regenerated from the script. As far as git shows, they haven't been edited by hand since iteration 0.
11. **Health bars, Mute and Show FPS are saved** in `localStorage`.
12. **Structure alerts** (Town Center, towers, breaches) show as toasts plus edge markers in every view, rate-limited.
