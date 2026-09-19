# Plan 6: a bot that plays one whole game on video, and an assessment of the gameplay

Answers `ai/prompt_6.md`. Nothing below is implemented yet.

---

## 0. What I found before planning

I ran this repo's dev server and drove it with Playwright scripts in headless Chrome on the real GPU (Intel RPL-P through ANGLE). No project files were changed, and the scripts stayed in the session scratchpad.

### 0.1 Real input works in headless Chrome

- **Pointer lock:** a Playwright click on the canvas gets it, and `control.inputActive` is true.
- **Mouse look:** moving the mouse turns the camera about 0.0012 rad per pixel. It keeps turning past the edge of the viewport (60 moves out to x = 3040 turned it 3 rad), so a bot can turn as far as it needs.
- **WASD:** moves the builder. Holding W for 0.6 s moved it 3.3 blocks.
- **Synthetic DOM events sent from inside the page also work.** A `pointermove` with `movementX` turns the camera, and a `KeyboardEvent` on `document` moves the builder. The game's key bindings can't tell them from real input.
- **The limit:** only a trusted click can take pointer lock. So something outside the page (Playwright) has to do the first click, and click again whenever pointer lock is lost.

### 0.2 A continuous video without screen capture

- **Tab capture works headless.** I call `getDisplayMedia({ preferCurrentTab: true })` with Chrome's `--auto-accept-this-tab-capture` flag. It gives a 1280×720 track at 30 fps that has the HUD (DOM) and the 3D view in one picture. `MediaRecorder` encodes it to VP9 inside the page; 3 s came to about 0.5 MB.
- **Starting it takes pointer lock away** (see 0.3), so recording has to start at the menu, before Play.
- **Options I ruled out:**
  - **Playwright's `recordVideo`:** it's a screencast of JPEG frames. It runs at about 25 fps and drops frames under load, the bitrate is low, and the file is only written when the browser context closes. That's risky for a run that lasts hours.
  - **Canvas `captureStream`:** misses the HUD. Banners, the hotbar, tips and result cards are all DOM.
  - **Grabbing a visible window:** it ties up your desktop, and any change of focus loses pointer lock.
- **This machine:**
  - ffmpeg has libx264 and VAAPI, for the final MP4, and there's 417 GB of free disk.
  - There's 14 GB of RAM with about 4 GB free, so memory needs watching during a Chrome run that lasts hours.

### 0.3 Bug found: the pause menu throws

- **Where:** `src/ui/hud.js:264-265`. The line after `this.$('.hpbars').checked = this.s.healthBars.enabled` starts with a type cast in brackets, `/** @type {HTMLInputElement} */ (this.$('.tips'))`. The first line has no semicolon, so JavaScript reads the two lines as a call:

  `this.s.healthBars.enabled(this.$('.tips')).checked = …` → `TypeError: this.s.healthBars.enabled is not a function`
- **Reproduced:** losing pointer lock (here, because tab capture started) opens the pause menu through `lostPointerLock`, and it throws.
- **What goes wrong:** whenever the pause menu opens (P, Esc, or losing pointer lock), it appears, but `openPanel` stops halfway:
  - **The game isn't paused:** `setPaused(true)` never runs, so a night goes on behind the menu.
  - **Clicks still reach the game:** `setUiOpen(true)` never runs.
  - **Stale settings:** the Tips, Mute and FPS checkboxes and the world info line aren't refreshed.
- **When it started:** with the Tips checkbox in next_4. The type check missed it because `this.s` has no type.
- **The only one:** no other line in `src/` has this problem.

### 0.4 Game rules that shape the bot and the run

- **The game never ends.** When the town falls, dawn rebuilds it and the same night level comes again (`nightLevel` only goes up after a win). So "nights survived" needs a definition (§7, choice 1).
- **How a night is won:** every attacker is dead, **or** the Town Center still stands after 5 minutes (`NIGHT_MAX_SECONDS`).
- **Timing:**
  - day: 8 min (N starts the night early)
  - dusk: 10 s
  - night: until every attacker is dead or 5 min pass, with a new group every 40 s
  - dawn: 5–10 s (14.5 s after the opening raid)

  One day and night takes about 6–14 min, depending on how long the bot's day is.
- **How strong a night is:** its budget is `14 × 1.18^(night − 1) + 0.04 × defence value`.
  - An arrow tower is worth 14 defence, which adds 0.56 to the budget (about half a grunt).
  - Night 10 ≈ 62, night 15 ≈ 142, night 20 ≈ 325.
  - Above the device cap (`maxAttackers × 2`: 56, 90 or 140 by quality tier), extra attackers turn into extra hit points on the others.
- **Costs:**
  - An arrow tower costs 6 planks + 4 cobble (about 1.5 logs and 4 stone), plus a column to stand on.
  - Troops need 1–2 gold each. Gold comes from ore underground and from the reward for a night (1 + ⌊night ÷ 2⌋).
- **The hotbar:** 9 slots, one of them always the pickaxe.
  - A crafted item only lands on the hotbar if a slot is free, and dirt and sand from digging fill the slots up.
  - After that, items have to be assigned in the Build panel: click the item, then press a slot key.
- **Pieces I can reuse:**
  - `window.game`, the running session
  - `src/ai/localPath.js`: pure path search with the same movement rules the units use
  - the game's events: `units.on('died', (u, source))`, `hit`, `blockHit`, `townHit`, `cycle.on('phase')`, `nightOver` and `waves.on('subwave')`

---

## 1. The autoplay tool

### 1.1 Layout

```
tools/autoplay/
  run.mjs       the harness (Node + Playwright): serves the build, launches Chrome, records,
                clicks Play, keeps watch, stops, writes the report
  capture.js    tab capture in the page → 1 s chunks → harness → one .webm, appended as it goes
  bot/          the player; runs inside the page, bundled into one script when the harness starts
    index.js    waits for window.game, then runs every frame
    input.js    keys, mouse buttons, looking around, clicks on HUD buttons
    see.js      a read-only view of the game
    skills.js   walk to, aim at, mine, place, craft, assign a hotbar slot, fight
    day.js      the day plan
    night.js    night tactics
    ui.js       banners, cards, the role picker and the pause menu, handled as a player would
    log.js      events + one telemetry line a second → harness
  report.mjs    logs → stats tables, chapter list, contact sheets
```

- **Command:** `npm run autoplay -- [--record] [--headed] [--lab=<scenario>] [--hours=4]`.
- **It plays the production build** (`npm run build`), served with brotli as `tools/perf` does, so it's what a player downloads. The static server moves out of `load-test.mjs` into a shared `tools/serve-dist.mjs`.
- **The game doesn't change:** nothing in `src/` imports the tool, so the bundle and the load budget stay the same. The bot bundles a few pure helpers from `src/` (`localPath.js`, `balance.js`, `blocks.js`) with Vite's library build.
- **Output** goes to `recordings/<date-time>/` (gitignored):
  - `game.webm` and `game.mp4`
  - `chapters.txt`
  - `events.jsonl` and `telemetry.jsonl`
  - `report.md`
  - contact sheets

### 1.2 Fair play: what the bot may and may not do

The recorded game has to be one a person could have played with the same inputs.

- **It only acts through input:**
  - **Keys:** WASD, Space, 1–9, Q, B, N, R, M, V.
  - **Mouse buttons:** hold left to dig or attack; right to place.
  - **Looking:** mouse movement (`movementX/Y`). Turning speed is capped at about one turn a second and eased, so aiming looks human and the video is easy to watch.
  - **Clicks on HUD buttons:** recipes, inventory items to assign, the role picker, Skip, closing cards.
  - **The harness** clicks the canvas (a trusted click) to get pointer lock back.
- **It may read anything.** `window.game` stands in for its eyes. It can see through walls: attackers behind a hill, ore underground (the ore tip already shows "Iron · 7 down").
- **It never:**
  - changes game state or calls game methods
  - changes the game's speed, or pauses it
  - uses URL options that change play (`intro=0`, `tips=0`)
- **How that's enforced:**
  - The bot only gets the game through a read-only proxy. Any write throws, and method calls go through a list of allowed reads (`getBlock`, `posOf`, `surfaceY`, …).
  - The harness refuses `--record` together with `--lab`.
- **Lab mode** is for development only and is never recorded. It may set up a scenario with debug writes (skip the opening, give an inventory, start night N), so a skill or tactic can be tested in minutes.
- **Where input comes from:** the bot sends synthetic events from inside the page every frame, in step with the game. That gives smooth aim with no round trips to Node, and the game's handlers get the same events as from a real mouse and keyboard. Playwright's trusted input is only used where the browser requires it: pointer lock and the Play click.

### 1.3 Skills, each with a lab test that passes or fails

| Skill | How | Lab test |
|---|---|---|
| Walk to | Path search with `localPath` over loaded blocks (1-block steps, drops up to 3, gates open), then W toward the next point, jumping at steps. Stuck for 2 s: jump, strafe, dig the block in front, find a new path | 10 random targets within 30 blocks, one through a gate: all reached |
| Aim | Turn toward a block face or a unit. Done when `noa.targetedBlock` (or the ray) hits exactly that | ≤ 0.5 s per aim, no overshoot |
| Mine | Aim, then hold left until the block is gone. Trees from the bottom up. Stone from a quarry dug as a staircase (so it can always walk out), away from the gates | 10 logs from the nearest trees; 20 cobble |
| Place | Pick a solid neighbour face and stand within reach, outside the target cell. Aim until the white square's build cell is the target, then right click | A 2-high column with an arrow tower on top, at a given spot |
| Craft | B, click the recipe, close | Stone sword, arrow tower, archer |
| Hotbar | B, click the item, press a slot key. Keeps dirt and sand off the hotbar | A crafted tower reaches the hotbar when 8 slots hold junk |
| Fight | Take the best weapon. Pick targets in this order: on the Town Center, then hitting a tower or gate, then the nearest. Stay in range; fall back to the Town Center when hurt | 6 grunts at a gate, all killed; the builder's hp logged |

### 1.4 The day plan (the "best shot")

Worked out again each morning from the inventory, the night's reward and what's standing:

1. **Weapon first.**
   - A stone sword straight away (3 cobble + 1 planks).
   - An iron sword or a musket once there's iron and gold. Which is better at night is a lab question (§1.5).
2. **Towers.**
   - Arrow towers on 2-high columns inside the wall, at the gates first, then between them.
   - Cannon towers near the Town Center once there's iron.
3. **Troops:** archers behind the gates, when there's gold.
4. **Extras**, if anything is left over: spikes inside the gates, iron walls.
5. **Gathering is sized to the plan:**
   - logs from trees near the town
   - stone from the quarry
   - iron and gold from where the ore tip points
6. **Then start the night (N)**, or wait for the day timer if it runs out first. That makes a day about 4–6 min instead of 8 (§7, choice 2).
7. **Dusk:** a few seconds in aerial view (M) to show the defences, then back to first person with the weapon.

The build positions are worked out from the world (the wall ring, the gates, the Town Center), not hard-coded, so the bot works on other worlds too.

### 1.5 Tuning the strategy in the lab

**Comparisons.** Before the recorded run, short lab runs compare these on nights 3, 6 and 10, with the town the bot would have built by then:
- melee next to the Town Center vs a bow or musket from somewhere high
- towers at the gates vs spread round the ring vs close to the Town Center
- how much to spend on troops vs towers

They run in real time, with 2–3 headless browsers at once if the GPU still holds 60 fps. Three runs each. The winner is what holds best: the Town Center's lowest hp and the fewest blocks lost.

**Baselines.** Two runs, not recorded, feed the assessment:
- **Idle:** builds nothing, presses N every morning, and watches from above while the builder fights on autopilot. This shows how far the starting town gets with no player.
- **The bot:** the full run.

The gap between them is how much playing well matters.

---

## 2. Recording

- **How a run starts:** the harness opens the menu, starts tab capture (before there's pointer lock), clicks Play, and records until the run stops (§7, choice 1). It's one Chrome, one page and one MediaRecorder, so there are no cuts.
- **In the page:**
  - 1280×720 at 30 fps, VP9 at about 4 Mbps, one chunk a second.
  - Each chunk goes to the harness (`exposeBinding`) and is appended to `game.webm` straight away. If something crashes, what was recorded still plays, and nothing large builds up in the page's memory.
- **Sound:** the game's sounds if headless tab capture supports them; otherwise the video is silent, and I'll say which.
- **After the run**, ffmpeg:
  - rewrites the file with a seek index (MediaRecorder files don't have one)
  - encodes `game.mp4` (H.264, CRF about 23, VAAPI if that's faster)
  - adds chapters: the opening raid, each day, dusk, night N with its result, dawn
- **Checking there are no gaps:** `ffprobe` reads the frame timestamps. The video has to be within 1 s of the real time the run took, with no gap over 250 ms, or the run doesn't count.
- **What recording costs:**
  - I'll measure fps with and without capture over 60 s of a busy night. If capture costs more than about 3 fps, I'll drop to 24 fps or a lower bitrate.
  - The game's own frame-rate governor stays on. If it lowers the quality during the run, that's part of the result.
- **Length:** a cycle of about 7.5–10 min means one hour of video covers 6–8 nights. At the 4-hour cap that's roughly 24–32 nights, if the bot gets that far.

---

## 3. Logs, watchdogs, bug fixing

### 3.1 What's logged

- **`events.jsonl`:**
  - phase changes and night results
  - what the bot did: crafted, placed, mined
  - kills: the builder's, and all of them by source (builder, towers, troops, spikes, powder kegs), plus the builder's deaths
  - damage: towers lost, hits on the Town Center
  - panels opened, toasts and warnings
  - page errors and console errors, pointer lock lost, recoveries from being stuck
- **`telemetry.jsonl`**, one line a second:
  - the game: phase, night, time, units, attackers, Town Center hp, defence value, inventory
  - performance: fps, longest frame, JS heap
  - what the bot is doing: walking, mining, crafting, placing, fighting or waiting
- **In the terminal:** the harness prints a one-line status every minute, so I can follow a long run and report progress.

### 3.2 Watchdogs (a run mustn't end stuck)

- **Page error:** logged.
- **Crash:** ends the run, and that run doesn't count.
- **No progress by day for 60 s** (position, inventory and phase all unchanged): the bot recovers by dropping its task and walking to the Town Center. Three times in a row and the run is flagged.
- **Pointer lock lost:** the harness clicks the canvas. Once B1 is fixed the pause menu opens, and the bot closes it the way a player would.
- **Heap over about 1.5 GB, or under 20 fps for a minute:** logged with what was happening.

### 3.3 Fixing bugs

- **Bugs get fixed in the game, each with a test.** A bug is an error, a stuck state, a broken rule (for example, an attacker jumping a wall), or anything that doesn't do what the game says. The test is a unit test when the code is pure, a lab scenario otherwise. Each one is listed in next_6.
- **A bug found during the recorded run:** fix it and record again. The video you get is from the final code.
- **Balance and design stay as they are in this iteration**, for example if arrow towers turn out to be too strong. Those go into the assessment. Changing them halfway would change the game being judged, and it's your call afterwards (§7, choice 4).
- **Exploits:** if the bot finds something clearly unintended, like a spot attackers can't reach, it's logged and the recorded run doesn't use it. It's fixed if it's plainly a bug; otherwise the fix is suggested in the assessment.
- **Already found, B1: the pause menu (§0.3).**
  - **Fix:** move the cast into its own statement (`const tips = /** @type … */ (this.$('.tips'))`).
  - **Test:** a small source check, run with the unit tests, that fails when a line in `src/` starts with `(`, `[` or a type cast right after a line that doesn't end its statement.

---

## 4. The assessment

It goes in `ai/assessment_6.md`. I'll start it during the lab runs and finish it after the recorded run. The evidence comes from three places:
- the telemetry
- the video: contact sheets of a frame every 30 s for each day and night, which I'll look through, with moments referenced by timestamp
- what each task took the bot to do

**What it answers:**
- **Is it engaging? Is it fun?** A caveat up front: I'm judging from the bot's play, the numbers and the footage, not from how it feels to play. I'll mark the questions only a human playtest can answer.
- **The first minutes:** does the opening raid get the goal across? How long until the first real choice?
- **Pacing:**
  - how each day splits between walking, digging, crafting, building and waiting
  - stretches of night with nothing for the player to do
  - how long nights and dawns take
- **Choices:**
  - which recipes the bot used, and which never mattered
  - whether one strategy beats all the others
  - whether placement matters
- **Challenge:**
  - nights survived against the idle baseline
  - the Town Center's hp each night
  - when it gets hard, and why
  - what losing costs (today, nothing lasting)
- **The player at night:** the builder's share of kills against towers and troops. Does fighting yourself matter?
- **Tedium:** clicks and seconds for common jobs (a 10-block wall, one tower with its column, one troop), and juggling the hotbar.
- **Clarity and feedback:** alerts, tips and cards, as seen in the footage.
- **Performance over a long game:** fps, longest frames and heap as the town and the waves grow.
- **How to improve it:** a ranked list, each item with the evidence behind it and a rough cost.
- **What already works well.**

---

## 5. Order of work

1. **B1:** fix and test.
2. **Harness, capture and report skeleton:** record 10 minutes of an idle game and check for gaps, the fps cost and file sizes. Everything else depends on recording working.
3. **Input, seeing and skills**, each with its lab test.
4. **Day plan, night tactics and UI handling**, then a first full fair-play run, headless and not recorded.
5. **Lab comparisons (§1.5) and the idle baseline**, while fixing bugs as they turn up. Start the assessment notes.
6. **The recorded run**, stopping as in §7 choice 1. It runs in the background and I'll report its progress. If it hits a bug: fix it, record again.
7. **Wrap up:** encode the video, add chapters, the report and contact sheets; finish `assessment_6.md`; write `next_6.md`.

---

## 6. How I'll verify it

- **`npm run check` passes**, with the B1 test and a test for each bug fixed.
- **`npm run build`:** the budget passes, and game code changes only by the bug fixes (within ±0.5 KB).
- **Every skill's lab test** passes 3 times in a row.
- **The final video:**
  - one file, from the menu to the stop
  - the gap check passes (§2)
  - its chapters match `events.jsonl`
  - the log has no page errors, or each one is explained or fixed
- **Fair play:** the read-only proxy blocked zero writes during the recorded run.
- **Performance:** fps with capture on, reported next to the usual `npm run perf` numbers.
- **Risks I'll keep in view:**
  - **The bot's skill is the biggest unknown.** If it plays badly, the score says more about the bot than the game. The idle baseline and the lab comparisons keep that visible.
  - **One run is one sample:** fronts and wave makeup are random. The lab runs show the spread on the key nights.
  - **A run that lasts hours is fragile.** That's why chunks are written to disk as they arrive, the watchdogs exist, and memory is logged.

---

## 7. Choices I made that you may want to override

1. **The score, and when the run stops.** The game never ends, so the score is **nights survived in a row from night 1**.
   - The run stops at the first night lost (after its dawn rebuild), or at **4 hours** of video, whichever comes first.
   - At the cap, the bot finishes the night it's in.
   - Alternative: keep playing through losses until the cap, and report the highest night won.
2. **Length of the day.** The bot starts the night once its day plan is done (days of about 4–6 min).
   - Alternative: always use the full 8 minutes. The bot would be a bit stronger, but the video is about 40% longer for each night.
3. **Camera.** First person for the whole game (what a player sees), with a short aerial look at dusk.
   - Alternative: third person (V) at night. On video it shows the crowd and the builder better.
4. **Balance stays as it is.** Balance and design problems go into the assessment, not the code, so the video shows today's game. Only clear bugs get fixed.
5. **Resolution:** 1280×720 at 30 fps. The iGPU renders that at about 60 fps and records it cheaply. 1080p is possible if capture doesn't cost frames.
6. **The video isn't committed.** Hours of video are gigabytes, so it stays in `recordings/` (gitignored), and next_6 gives the path. If you want a quick watch, I can also make a sped-up copy (for example 8×).
