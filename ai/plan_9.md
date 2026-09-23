# Plan 9: a wall beside a wall, a sharper recording, a better pickaxe, and a game you can hear

Answers `ai/prompt_9.md`. Nothing below is implemented yet.

The prompt asks for five things:

1. **carry on with `next_8.md` §4 and §5**: teach the bot tiers, build the tier towns, run the
   difficulty map and the bot games, tune; the showcase lab; the leftover polish
2. **issue 1**: a stone wall can't be built next to a stone wall ("Already a stone wall")
3. **issue 2**: the one-hour recording from iteration 7 is blurry. Is it the resolution or ffmpeg?
4. **feature 1**: a cooler pickaxe
5. **feature 2**: better sound for every attack, mine, hit and build, and a night that sounds like
   an attack

Issue 1 goes first. It also breaks the bot's wall building (§0.1), so none of the tuning in item 1
can be trusted until it's fixed.

---

## 0. What I found before planning

### 0.1 Issue 1: an upgrade check is catching ordinary builds

The failing path is `session.js:259` → `upgradePlacement` (`placing.js:74`).

Right-clicking a wall's face passes two cells. `at` is the empty cell in front of the face.
`against` is the wall itself. Iteration 8's in-place upgrade runs **first**, on `against`, and it
has three ways to fail:

| Clicked block vs. item in hand | `upgradePlacement` returns | What happens |
|---|---|---|
| different family | `sameFamily: false` | falls through, builds in `at` ✔ |
| **same family, same tier** | `Already a stone wall`, `sameFamily: true` | **toast, nothing is built** ✘ |
| **same family, lower tier in hand** | `A better wall is already here`, `sameFamily: true` | **toast, nothing is built** ✘ |
| same family, higher tier in hand | `ok` | replaces the clicked block |

So you can't lengthen or stack a wall with the same block, or put a stone wall against an iron one.
The unit test (`building.test.js:250`) checks that those cases are "not an upgrade", which is true.
Nothing tested what the *session* does with that answer.

A second problem comes from the same rule: **a higher tier always replaces**. If you hold an iron
wall and right-click the top of a stone wall to build the wall higher, the stone block turns into
iron instead, and the wall doesn't get taller.

The bot hits this as well. `skills.place` aims at a support face, and next to a wall that support
is usually the previous wall block (`skills.js:346`). Every wall after the first in a run of the
same tier fails as `no aim` after four attempts. Iteration 8's runs were only smoke tests, so
nothing measured caught it. The wall stock and patches in any iteration 8 game are suspect.

### 0.2 Issue 2: mostly the capture, and ffmpeg makes it a bit worse

I measured `recordings/final7-rec/`:

| Stage | What it is |
|---|---|
| browser viewport | **1280×720 at device pixel ratio 1** (`run.mjs:102`) |
| game render | tier `high` the whole hour; `hardwareScaling = 1/DPR = 1`, so the canvas is 1280×720 |
| capture | `getDisplayMedia` asks for 1280×720 (`capture.js:27`); MediaRecorder VP9 at **4 Mbps** (`run.mjs:140`), realtime encoder |
| `game.webm` | 2.10 GB over 3595 s = **4.7 Mbps**; keyframes ~149 KB, P-frames 12–38 KB |
| `game.mp4` | re-encoded with `libx264 -preset veryfast -crf 23` (`video.mjs:98`): **2.8 Mbps** |

Frame 30:00 extracted from both files:

- **The WebM is already soft.** You can see it in the stone-brick mortar lines, the cobble plaza
  edges and the brute's outline.
- **The MP4 loses a bit more**: SSIM 0.948 and PSNR 37 dB against the WebM. It's a real second
  loss, but a smaller one.

The answer is **both, mainly the capture**:

1. **Resolution.** 720p shown full-screen on a 1080p monitor is scaled up 1.5×, and on a 1440p
   monitor 2×. The game's pixel-art textures are made of hard 1-pixel edges, and scaling blurs
   exactly those edges.
2. **The browser's realtime encoder at 4 Mbps.** MediaRecorder's VP9 is tuned for speed, like a
   video call. Blocky, high-contrast textures in motion are the hardest content for it.
3. **ffmpeg's second encode.** `veryfast` at CRF 23 is a "small file" setting applied to an input
   that is already lossy.

One thing I haven't measured yet: how sharp the game itself renders in headless Chrome (texture
filtering at grazing angles, anti-aliasing). §2 answers that with a lossless screenshot, so the fix
targets the stage that actually loses the detail.

### 0.3 The pickaxe

`make_characters.py:1010`: four boxes, a 0.6 m haft with a flat bar across it and a cube at each
end. It is the simplest mesh in `items.glb`, and it is on screen more than anything else in the
game (it's always on the hotbar, and it's in your hand all day). The sapper carries the same mesh
(`balance.js:230`). `item()` builds meshes from axis-aligned boxes only, so any curve has to be
stepped, which fits the rest of the art.

### 0.4 The sound

`src/audio/audio.js` (231 lines) synthesises everything: one filtered noise burst and/or one
oscillator per sound, 24 voices, no downloads. What exists:

| Event | Today |
|---|---|
| swing (player, any unit, any sword tier) | one noise sweep, the same for all |
| hit on any unit | one noise burst + one triangle blip, the same for flesh, bone and armour |
| dig / break | noise band per material (4 materials) |
| place / upgrade / tower build / patch | **one sound for all of them** |
| arrow, bolt, all six towers | `shoot(kind)`: `arrow` (default), `bullet`, `cannonball`. **Bolt, crossbow, ballista, mortar and bombard fall through to the arrow sound** |
| projectile impact | **silent** |
| footsteps | `step()` exists and **nothing calls it** |
| bow draw, string release | **silent** |
| unit hurt / death | one sawtooth drop for every type |
| night | the dusk horn, then **nothing but combat one-shots**: no ambience, drums or voices at all |
| mixing | no buses, no limiter, no variation (every dig sounds identical), no priority when 24 voices are busy |

### 0.5 Where next_8 left off (§4 and §5 of it)

Not done: the bot buying and upgrading tiers, the `t6-tier2` / `t7-tier3` towns, the difficulty
map and full games against plan_8 §7.3, the skill tests (plan_8 §8.2), the showcase lab
(plan_8 §8.3), four polish items, and a load benchmark whose result swings by 2 s on identical
code.

---

## 1. Scope

| # | Item | Section |
|---|---|---|
| 1 | Issue 1: build beside a wall; upgrading only when you mean it | §1a |
| 2 | Issue 2: a sharp recording, measured stage by stage | §2 |
| 3 | A cooler pickaxe | §3 |
| 4 | A sound pass over every action, and a night that sounds like a siege | §4 |
| 5 | next_8 §4–5: bot tiers, towns, map, games, tuning, showcase, polish, benchmark | §5 |

---

## 1a. Issue 1: build beside, build on top, upgrade on purpose

### The rule

| Holding | Right-click on | Result |
|---|---|---|
| any block | a block of another family | builds in front of the face (as now) |
| same family, **same or lower tier** | that family's block | **builds in front of the face** (fixes the bug) |
| a higher tier **tower** | a lower tier tower of its family | upgrades in place (as now: nobody wants a tower stacked on a tower) |
| a higher tier **spike** | lower tier spikes | upgrades in place (spikes are a floor layer, so there's nothing to stack) |
| a higher tier **wall or gate** | a lower wall / gate | **builds in front of the face**: stacking iron on stone works |
| the same, **right button held for 0.4 s** | a lower wall / gate | **upgrades in place**, with a fill ring on the crosshair while you hold |

Walls are the only family where "on top of" and "instead of" are both reasonable things to want,
so walls get an explicit gesture. On touch, the build button works the same way: tap to build, hold
to upgrade. When you hold a higher tier and aim at a lower wall, a hint appears once:
"Hold to upgrade".

### Changes

- `upgradePlacement` gains a `mode` argument (`'click' | 'hold'`). It only returns
  `sameFamily: true` (the "tell the player why" case) when the gesture **was** an upgrade attempt.
  Everything else falls through to an ordinary build. The night message stays
  ("Upgrades have to wait for daylight").
- `control._altFire` / touch: time the build press. A short press calls `placeSelected` as now; a
  hold on an upgradable wall calls it with `mode: 'hold'`.
- Tests: the whole table above, **at session level**, not only the pure function. That was the
  missing test, and it would have caught this bug.
- Bot: `skills.place` needs no change for ordinary builds. A new `skills.upgrade(cell, item)`
  aims at the occupied cell and holds for walls (§5.1).
- New skill test: build a five-block stone wall in a line and a second course on top, then upgrade
  the middle block with a hold.

---

## 2. Issue 2: a recording you can read

### 2.1 Measure each stage first (about 20 minutes)

A 60 s lab clip of a fixed scene (the default town at night 6, the bot standing still, then
turning) with a **lossless `page.screenshot` (PNG)** taken at set times during the recording. I
compare each setting's frame at those times against the PNG (SSIM and PSNR with ffmpeg; libvmaf
isn't in this build):

| Variant | Viewport / DPR | Capture bitrate | Final file |
|---|---|---|---|
| A (iteration 7) | 1280×720 / 1 | 4 Mbps | x264 veryfast CRF 23 |
| B | 1280×720 / 1 | 4 Mbps | x264 slow CRF 18 |
| C | 1280×720 / **1.5** → 1920×1080 | 12 Mbps | x264 slow CRF 18 |
| D | 1280×720 / 1.5 | 12 Mbps | **no re-encode**: VP9 copied into MKV/MP4 |

These answer your question with numbers: A→B shows the ffmpeg share, B→C the resolution and
capture share, and C→D the cost of the second encode. The PNG also shows whether the game itself is
soft. If it is (texture filtering, no MSAA on the canvas), that's a separate fix, and it would also
show up for real players.

### 2.2 What I expect to ship (confirmed or changed by §2.1)

- **DPR 1.5 at a 1280×720 viewport.** The HUD keeps exactly the layout it has in the 720p videos,
  but every pixel is 1.5× sharper. The `high` tier already renders at `1/DPR` scaling, so the canvas
  becomes 1920×1080. Capture asks for 1920×1080.
- **Capture at 12 Mbps VP9.**
- **Final MP4: `libx264 -preset slow -crf 18 -tune animation`** (flat colours, hard edges), or a
  stream copy if D wins by a clear margin.
- **Guard the frame rate:** capturing at 1080p costs the GPU more. The per-minute log already
  prints fps. I add the **quality tier** to that line and fail the run's report if the FPS governor
  stepped down during a recorded run. The `low` tier scales by 1.35 and would blur everything on
  its own.
- **Cost:** an hour at 1080p is ~5 GB of WebM plus ~2.5–3 GB of MP4 (iteration 7: 2.1 + 1.3 GB).
  `short.mjs` and the 8× preview are unchanged. Their inputs just get sharper.

I won't re-record the iteration 7 hour. The fix applies to the next recording (§5.5).

---

## 3. A cooler pickaxe

### 3.1 The mesh (`make_characters.py`, in `items.glb`)

Still made of boxes, but with a silhouette you can read from across the screen:

- **A curved head:** 5–7 stepped boxes that sweep down from the eye into a long **pick point** on
  one side and a broad **flat chisel** on the other, so it reads as a pickaxe rather than a T.
- **A steel collar** binding head to haft, plus two **rivets**.
- **A wrapped grip:** a leather section with two darker bands, and a **pommel cap** at the end.
- **Bright edge strips** (`steel` against a `steel_dark` body) along the point and the chisel, so
  it catches the light as it swings.
- A haft about 10% longer, so in first person the head sits higher in view.

The sapper keeps the old mesh, renamed `crude_pickaxe`. Their pick stays a crude tool, and yours
stays the good one. Estimated size: +~0.4 KB gzipped on `items.glb`.

### 3.2 In the hand

- A new first-person pose (`viewModel.js:225`), with the head turned so both ends are visible.
- The chop motion gets a clearer **wind-up → strike → small recoil**, with a 40 ms hold on impact,
  like the stone sword's heavy chop.
- **Sparks** on stone, ore and metal (a short bright `effects.spray`) as well as the chips that
  already fly. Dust on soft blocks and splinters on wood, from `dustColor` as now.
- It gets its own sound (§4).

Checked with a contact sheet in the showcase lab (§5.4): rest, wind-up, strike, and against each
material.

---

## 4. Sound

### 4.1 The engine (still no downloads)

The whole game stays procedural: no sound files, and nothing added to first load. What changes is
how each sound is made and mixed:

- **Layers.** Every sound becomes a small recipe of 2–4 layers: a **transient** (click or crack),
  a **body** (pitched or filtered tone), a **tail** (noise decay or debris rattle), and
  **sweetening** where it helps (ring, sub thump). Recipes live in a new `src/audio/sounds.js` as
  data, and `audio.js` plays them.
- **Variation.** Each recipe has 3–4 variants plus random pitch (±4–8%) and noise offset, so
  digging a tunnel doesn't sound like a loop.
- **A pre-rendered bank.** The heavier layered sounds (drums, voices, reverb tails, explosions) are
  rendered once with `OfflineAudioContext` into `AudioBuffer`s, in idle time **after the first
  playable frame**, a few per idle callback. This costs nothing at load and little per play on a
  weak phone. The budget is ≤4 MB of buffers at 22.05 kHz mono, measured. Light sounds stay live
  synthesis, as now.
- **Buses and a limiter.** `sfx`, `ambience` and `ui` buses go into a `DynamicsCompressor` on
  master, so a night with 50 attackers doesn't clip. Ambience **ducks** under heavy close-range
  combat.
- **A shared reverb send:** one `ConvolverNode` with a generated impulse, so distant sounds sit
  back in space. It's off on the `low` tier.
- **Voice priority** replaces the flat 24-voice counter. Your own actions come first, then things
  near you, then distant ones. Each sound also gets a **per-kind throttle** (30 archers firing
  together → a volley of a few overlapping voices, not 30 identical ones).
- **Settings:** effects volume and ambience volume sliders next to the existing mute.

### 4.2 Every action

| Event | New sound |
|---|---|
| **swing**: wood / stone / iron sword | light whoosh / heavy low whoosh / thin "shing" whoosh; the flourish's mirrored second swing is pitched differently |
| swing at air | as now, quieter |
| **hit**, by what's hit | flesh thud (grunt, sapper, archer), bone clack (skeleton), **armour clank** (brute), wooden knock on a defender's shield |
| hit, by what hits | a sword tier adds its own edge; stone and iron blows add a low thump (like the screen shake) |
| hit taken by you | a duller, closer thud and a short breath |
| **bow**: draw / release / arrow flight | a wood creak that lasts the draw (0.32 / 0.42 / 0.55 s) / a string twang (lower per tier) / a whoosh; the **bolt** is a heavy thrum |
| **mine**: per strike, per material | stone: clink with a pitched ping; ore: a brighter ping; wood: hollow thock; soft: crunch; metal: clang |
| **break** | a crumble with a debris-rattle tail, by material |
| **the pickaxe** | its own strike transient (steel on the material), plus the spark crackle (§3.2) |
| **build**: place | by material: stone clack, wood knock, metal clank (today it's the same for everything) |
| build a tower | the column rises as stacked clunks, then the head drops on with a metal/wood chord |
| upgrade in place | the material sound plus a rising "tier up" ring (a different ring for II and III) |
| patch at night | quick place and a short hammer tap |
| refused build | a dull short buzz (paired with the toast) |
| **towers**: arrow / crossbow / ballista | twang / snapping thwack / deep thrum with a wooden creak |
| cannon / mortar / bombard | boom / hollow thump and an **incoming whistle** / a huge boom with a rumble tail |
| **impacts** | arrow into wood, stone or a body; cannonball on the ground and on blocks; bolt through (**all silent today**) |
| attackers on your walls | wrecker bash thuds by wall material; blocks crack under repeated hits |
| **footsteps** | `step()` gets wired: by surface, at the gait clip's foot contacts, walk and run. Yours only, plus units near you (throttled) |
| jump / land | a small cloth rustle, and a thud on landing scaled by fall |
| unit hurt / death | a short formant "voice" per type: grunt, skeleton rattle, brute roar, sapper yelp, defenders |
| town center hit | a bell clang (an alarm), instead of the square-wave blip |

### 4.3 The night: it should sound like a siege

An ambience layer that runs all the time, by phase, driven by the game state (not by a timer):

| Phase | Bed | Driven by |
|---|---|---|
| day | light wind, occasional birds, the town (distant hammering when troops build) | time of day |
| dusk | crickets, wind rising; the existing horn, then **war drums fade in far away** | the dusk timer |
| **night** | a low drone and wind; **war drums** whose tempo and loudness rise with the number of attackers alive and closing in; **distant war cries** coming from the direction the wave spawns; **clashing metal** where fights are happening off-screen; **fire crackle** near burning or damaged blocks | attackers alive, their distance to the town, spawn directions, the town's hp |
| a wave arrives | a stinger: a horn blast from the attackers' side, drums hit harder | wave spawn |
| town under 25% hp | a heartbeat under everything, the drums faster | town hp |
| last attackers | drums thin out to a single beat, then stop | attackers alive |
| dawn | the existing chime, birds return | dawn |

It is all positional or directional, so on headphones you can hear which side is being hit before
you see it. The drums are synthesised toms (a pitched sine drop plus a noise skin) and the war cries
are formant-filtered noise, both pre-rendered into the bank (§4.1).

**One thing synthesis does badly: voices.** A crowd of war cries made from filtered noise will
sound like a crowd of filtered noise. See §7.1: the alternative is a small CC0 voice pack loaded
after the game is playable.

### 4.4 Checking sound I can't hear

I can't listen, so I'll build the checks that stand in for it, and **you are the final judge**:

- **A sound board**: `?lab=sounds`, a dev page listing every recipe and variant with a play
  button, plus a slider that fakes night intensity so you can hear the siege bed go from quiet to
  full.
- **Offline renders**: every sound rendered to WAV in the browser (Playwright), then an
  **EBU R128 loudness** and peak per sound (ffmpeg `ebur128`). Categories get loudness targets, so
  a footstep can't be louder than a cannon and nothing clips. Plus a **spectrogram contact sheet**
  (`showspectrumpic`) to catch two sounds that are accidentally the same.
- **A coverage test**: every `units.on(...)` event, every tower projectile, every weapon tier and
  every sound material maps to a recipe. The `bolt` / `ballista` falling back to the arrow sound is
  the kind of gap this catches.
- **A night recorded with sound** in the showcase (§5.4): 60 s of a night 8 siege with the
  improved capture, so you can listen to it in context.
- **Performance**: the night benchmark on the `low` tier and the mobile profile, with audio on:
  fps unchanged within noise, bank render done within 5 s after first playable, and no audio work
  before the first gesture (the autoplay rule, as now).

---

## 5. next_8 §4–5: tiers in play, measured

### 5.1 Teach the bot tiers (`tools/autoplay/bot/full.js`, `skills.js`)

- **Buys the best tier it can afford** for towers, walls and spikes, and holds gold for tier III
  while tower spots remain.
- **Upgrades** the oldest towers once the spots run out, and the wall ring's most-hit side once it
  has spare iron, with `skills.upgrade(cell, item)` (aims at the occupied cell; holds for walls,
  §1a).
- **`--strategy=towers` stays tier I only**, as the fixed baseline.
- **Report additions:** upgrades and when, the tier mix at each dusk, iron and gold left, and
  failed placements by reason (so a regression like §0.1 shows up in a report instead of hiding
  inside `no aim`).

### 5.2 The towns

`make-towns.mjs` gains `t6-tier2` (`t1-towers` with as many towers upgraded to tier II as its iron
would buy) and `t7-tier3` (the same defence value as `t1`, spent on tier III, so fewer towers).

### 5.3 Map, games, tuning

The iteration 7/8 loop: the difficulty map over `default`, `t1`–`t3`, `t6`, `t7` at nights 2–12
(two runs a cell, 2–3 in parallel), then full bot games, then change numbers and repeat, against
**plan_8 §7.3's targets** (idle first loss night 5–6; towers-only 8–9; full bot 12–16 and not over
before 14; tier III ≥ 2 nights better than tier I at equal value; tier II in between; ballistas
handle brutes at a higher cost; under 5 iron and 5 gold unspent at night 10; the walk/run split
within 5 points of iteration 7's).

The idle and towers-only baselines are re-run **after** the issue 1 fix. Any target that isn't met
gets written down in next_9 with where it landed, as before.

### 5.4 Skill tests and the showcase lab

- `--lab=skills:all` gains: craft and place a tier II wall; **a wall beside and on top of a wall
  (issue 1)**; a hold-upgrade of a wall; a tower upgraded in place; a click at the sky plays an
  action within 100 ms.
- **`--lab=showcase`** (headless, ~3 minutes, writes `recordings/showcase9/`):
  - every weapon tier **and the new pickaxe** held, swung and fired, captured at rest, wind-up,
    mid-swing and impact, one contact sheet per family;
  - one of every defence tier in a row, orbited;
  - the pickaxe against each material, for the sparks;
  - **a 60 s night clip with sound**, recorded with the §2 settings.

### 5.5 The leftover polish, and the benchmark

- next_8's four leftovers: the iron sword's gleam between swings, the bow string's shiver on
  release, the builder's blade trail in third person, and a tip the first time a brute survives a
  volley ("cannons, ballistas or bolts get through brute armour").
- **A repeatable load benchmark:** `npm run perf` runs N = 5 times, takes the median and reports
  the spread, with `--cold` used consistently. Only then do I compare first-playable time against
  the spec (4 s max, 2–3 s target). next_8 saw 0.96–3.08 s on identical code, so right now the
  number can't judge anything, including whether §4's bank really costs nothing at load.
- **Recorded hour (optional, §7.6):** a full hour with tiers, the new sound and the sharp capture,
  cut down with `short.mjs`.

---

## 6. Order of work

1. **Issue 1** (§1a) plus its session-level tests and the new skill test. It's small, and
   everything measured later depends on it.
2. **Video measurement** (§2.1), then the capture settings (§2.2). Short, and the showcase clips
   need it.
3. **Pickaxe** (§3): Blender rebuild (`BLENDER=/home/rx/Downloads/blender-5.2.1-linux-x64/blender
   npm run characters`), `validate-glb`, pose, motion, sparks.
4. **Sound engine** (§4.1): recipes, variants, bank, buses, limiter, priority, the sound board.
5. **Action sounds** (§4.2), then the **night bed** (§4.3), then loudness balancing (§4.4).
6. **Bot tiers** (§5.1), towns (§5.2), then the map, games and tuning rounds (§5.3). This is the
   longest part in wall-clock time. The map runs happen in the background while 3–5 are reviewed.
7. **Skill tests and the showcase** (§5.4), polish and the benchmark (§5.5).
8. **Wrap-up:** `next_9.md`, with before/after for each prompt item and the video comparison table.

---

## 7. How I'll verify it

- **`npm run check`**: types, tests (the §1a table at session level, sound coverage, pickaxe mesh
  builds and differs from `crude_pickaxe`, bank under budget), all GLBs valid.
- **`npm run build`**: budgets pass. Estimate: +8–12 KB brotli of game code for the sound recipes
  and engine (343.4 KB today of 550 KB); `items.glb` +~0.4 KB gzipped; **zero new network
  requests**.
- **`npm run perf`** (median of 5, desktop and mobile profiles): first playable unchanged within
  the measured spread; the night benchmark holds its fps with audio running, on `low` as well.
- **Video:** the §2.1 table with SSIM/PSNR per variant, plus side-by-side crops of the same frame.
- **Sound:** the loudness table, the spectrogram sheet, the sound board, and the night clip with
  audio. Then **a listening pass by you**: I'll list what to listen for, and your ears decide.
- **Bot:** `skills:all` passes three times running; the map and games meet plan_8 §7.3, or next_9
  says where they didn't; 0 blocked writes.

---

## 8. Choices I made that you may want to override

1. **Synthesised sound only, no files** (§4.1). This keeps first load untouched and the repo free
   of assets. The weak spot is **voices** (war cries, grunts), which never sound quite human when
   synthesised. Alternative: a **small CC0 pack** (Kenney-style, ~150–300 KB Opus) for voices,
   and possibly drums, **lazily loaded after the first playable frame**, with synthesis as the
   fallback until it arrives. The spec allows it ("progressive load later is fine"). Say if you
   want it, or if a particular source or licence matters to you.
2. **Walls upgrade on a hold; towers and spikes upgrade on a click** (§1a). Alternatives: every
   family upgrades on a hold (consistent, one more thing to learn for towers); or no in-place
   upgrade for walls at all (dig out and rebuild).
3. **Recording at DPR 1.5 → 1080p, 12 Mbps** (§2.2): about 2.5× the disk of iteration 7 per hour.
   Alternatives: 1440p (DPR 2, sharper still, ~2× that again, and a heavier GPU load in headless);
   or keep 720p and only fix the encoder settings (the cheapest fix, and a smaller improvement).
4. **The sapper keeps the old pickaxe** (§3.1). Alternative: everyone gets the new one.
5. **No pickaxe tiers.** The prompt asks for a cooler pickaxe, not for faster mining, so the
   gameplay stays as it is. A wood → stone → iron pickaxe to go with the swords would be a new
   balance axis (mining speed decides how long a day is), so I'd leave it for its own iteration.
6. **Ambience is on by default at 60% of the effects volume**, with its own slider.
7. **Directional war cries come from the wave's spawn side.** This gives away where the wave comes
   from a little earlier than the visuals do. I'd call that a feature (you get a warning), but say
   if you'd rather keep it a surprise.
8. **I don't re-record the iteration 7 hour**; the sharper capture applies from now on.
9. **A full recorded hour at the end** costs ~1.5 h of wall clock and ~8 GB. Worth doing if you
   want to watch and hear a game with tiers and the new sound; skippable if the showcase clips are
   enough.
10. **Not in this iteration:** music (beyond the drums and stingers), new attacker types, pickaxe
    tiers, drag-to-build walls.

I'll re-read `ai/prompt_9.md` before implementing, in case you've answered any of these there.
