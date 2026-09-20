# Next 7: implementation summary and what's next

Implements `ai/plan_7.md` (answering `ai/prompt_7.md`: improve the gameplay based on
`ai/assessment_6.md` and `ai/next_6.md`). The prompt wasn't edited after the plan, so the plan's
defaults stand, including the recorded hour. Nothing is committed.

## What was built

### Nights that are a threat (`waves.js`, `balance.js`)

- **Every attacker type is its own stream** from its first night (`WAVE_STREAMS`), so a new type
  adds to the wave instead of replacing grunts:

  | Type | First night | Starting count | Growth |
  |---|---|---|---|
  | grunt | 1 | 14 | ×1.18 a night |
  | raider | 2 | 2 | +0.8 a night |
  | brute | 3 | 1 | +0.4 a night |
  | sapper | 5 | 2 | +0.5 a night |

- **The attack answers what you build** (`WAVE_ADAPTIVE`, `WAVE_COUNTERS`):
  - Each defence point above the starting town (225) adds k budget points. k starts at 0.05 on
    night 1 and grows by 0.04 a night, up to 0.4 (reached on night 10). At the cap an arrow tower
    still draws less than one brute a night, so building always pays.
  - **Troops count double.** They cost gold once and are back every dawn.
  - **The extra attackers counter the defence:**

    | You built | They send more |
    |---|---|
    | arrow towers | brutes |
    | cannon towers | sappers |
    | troops | raiders and brutes |
    | walls, gates, spikes | sappers |
    | the builder's weapon | raiders |

  - Before brutes exist (nights 1–2) the extra attackers are grunts.
- **Brutes take half damage from arrows** (`ARMOUR`, applied where projectiles land): towers,
  archers and the bow. Cannons, bullets and blades hurt them fully.
- **Fronts lean to the weak side.** From night 4, every third sub-wave comes at one of the three
  least defended compass sides (`weakestSides`: towers and troops by where they stand).
- **The player is told.**
  - The wave is planned at dusk (nothing can be built after that), so the dusk banner says exactly
    what's coming, and why. For example: "Night 7 is coming: 34 grunts, 7 raiders, 7 brutes and
    5 sappers. Your arrow towers drew brutes: arrows barely hurt them."
  - The Build panel's recipe cards say what each tower and troop is good against.

### A lost night costs a life (`cycle.js`, `session.js`, `hud.js`, `worldFile.js`)

- **Three lives,** shown as crystals by the night counter. A lost night costs one; the result card
  says how many are left (and warns on the last).
- **Otherwise a loss works as before:** the rebuild at dawn, then the same night again.
- **The third loss ends the game.**
  - A new phase, `over`: nothing rebuilds, and the attackers cheer over the ruins.
  - A card: "The town is lost. You survived N nights", with your best for this world (saved in
    settings), New game (the same world, fresh: `?play=<id>`) and Menu.
  - The autosave is deleted, and nothing is saved after that.
- **The opening raid and creative mode don't use lives.**
- **Saving:** the world file has `lives`. Files without it, or with none left, get a full set
  (`docs/world-format.md`).

### A job at night

- **Steps up the wall:** the default town has a cobble step inside the wall, three blocks either
  side of each gate (8).
- **The dusk tip** (nights 1–3, until you've been up there at night): "Shoot from the wall", with
  markers on the two nearest steps, when you have a bow or musket. The night reminder by day
  suggests crafting a bow if you have nothing to shoot with.
- **Patching.** At night, a destroyed wall, gate or tower block can be put back with the same
  block from your stock (`placing.js: canPatch`, `session.patch`).
  - It's back at full strength, and the dawn rebuild has nothing left to do there.
  - The first breach of each night shows "Patch the breach: select stone wall and right click the
    hole" if you carry the block. The controls help says so too.

### Less busywork by day

- **Logs count as planks:** a recipe short of planks cuts them from logs (`inventory.payment`).
  The card shows "uses 2 logs". The planks recipe stays.
- **×5:** shift-click, or the ×5 button on a card you can afford twice, crafts five (or as many as
  the stock allows).
- **A tower placed on the ground comes with its 2-cobble column,** in one click
  (`placing.js: towerPlacement`). On a wall or a column it's just the tower. A toast says why when
  there's no room or not enough cobble.
- **Dirt, sand and logs don't take a hotbar slot by themselves.**
- **Wood and stone near the town** (default world only, as edits):
  - a grove of 8 trees 27–37 blocks north-east
  - a stone outcrop with 3 iron ore 27 blocks north-west, on ground 3 blocks above the plaza (the
    south-west, planned first, is a mountainside)
- **Closing a panel with a key or a click takes the mouse back** in the same event. Esc still
  needs a click: the browser reserves it.

### Bug found and fixed

| | Bug | How it showed | Fix |
|---|---|---|---|
| B6 | **The knocked-out builder's body fell through the world.** Units are held in place while the chunk under them isn't loaded, but dead ones were skipped. Chunks load around the camera, so with the aerial view far away (a front across the town), the chunk under the body unloaded and it fell. On getting up, it kept its falling speed | next_6: the body sank 2.5 s after going down, and the builder got up inside the ground under the plaza | the hold applies to bodies too; getting up stops the body (`respawnPlayer`). Reproduced with a browser probe (the builder knocked out, the aerial camera 130 blocks away: the body fell to y −40); after the fix it stays at y 8. On high quality the chunk unloads at about 103 blocks; on medium and low (phones) at about 79 and 67, so it happens sooner there |

### Measuring (`tools/autoplay/`)

- **The difficulty map** (`map.mjs`, `--lab=siege:<town>:<night>`):
  - loads a saved town through Continue (the lab writes it into the autosave), starts night N at
    once, and lets the builder fight on autopilot
  - one night takes 1–3 minutes, 2–3 run at once
  - `map.md` tabulates the result, the Town Center's lowest hp, towers lost and attackers
- **Towns** (`tools/autoplay/towns/`):
  - `t1-towers`: saved from a game of iteration 6's bot (day 4: 27 arrow towers, 7 troops),
    `--save-town=<day>:<name>`
  - `t2-mixed`: the same with every third arrow tower a cannon and three archers gunners
    (`make-towns.mjs`)
  - `t3-full`: saved from a full-play game on day 10, before the bot's cannon fix (below): 21 arrow
    towers, 23 troops
  - `default`: the starting town
- **`--dist=<dir>`** serves another build, so the old rules could be mapped from a copy of the
  iteration 6 build.
- **Bot strategies:**
  - `--strategy=towers`: iteration 6's plan (arrow towers, archers, bow, musket), on the new
    mechanics
  - `--strategy=bot` (default, `bot/full.js`): spends everything:
    - cannons once brutes come, keeping iron for them while there are spots
    - troops with the gold: gunners, archers, swordsmen
    - six stone walls in stock, and it patches breaches at night when no attacker is within
      4 blocks of the hole
  - Both use the one-click tower and log-paid recipes, quarry the outcrop, and stop at game over.
- **Report:**
  - first lost night and game over
  - each night's wave make-up and what the extra attackers answered
  - lives left
  - holes patched
  - why each day ended

## The results

All runs on the final code and numbers, headless on this machine's Intel iGPU (quality high unless
noted). Iteration 6's numbers are from `recordings/final/` and `recordings/idle-final/`.

### Whole games (`recordings/final7/`, up to an hour each, stopping at game over)

| Strategy | Run | First night lost | Game over | Played | Nights the Town Center was hit | Towers lost a night |
|---|---|---|---|---|---|---|
| **idle** (builds nothing) | 1 | 5 | after night 6 | 21 min | 6 of 8 | 2.6 |
| | 2 | 6 | after night 6 | 20 min | 6 of 8 | 2.5 |
| | iteration 6 | 10 | (no lives then) | 35 min | 8 of 13 | 2.8 |
| **towers** (iteration 6's plan) | 1 | 8 | after night 9 | 44 min | 10 of 11 | 12.4 |
| | 2 | 8 | after night 9 | 47 min | 10 of 11 | 11.8 |
| | iteration 6 | none in 18 nights | (no lives then) | 60 min | 2 of 18 | 3.2 |
| **bot** (spends everything) | 1 | 9 (then won it, lost 10, won it) | not in the hour: 1 life left at night 12 | 60 min | 11 of 13 | 9.8 |
| | 2 | none in 12 nights | not in the hour | 60 min | 8 of 12 | 9.5 |
| | recorded (below) | none in 13 nights | not in the hour | 60 min | 9 of 13 | 10.8 |

- **Targets from the plan** (§6.3):
  - **idle**, first loss on night 4–6: met.
  - **towers**, first loss on night 7–10: met.
  - **bot**, first loss on night 10–14: 9 in one game, none by night 12 and none by night 13 in
    the other two. It's on the strong side of the target: this bot plays the night well (patching
    40–50 holes a game) and never hesitates.
- **The full-play bot's hour** (run 1) has what the recorded hour of iteration 6 didn't:
  - The Town Center was down to 56% on night 7.
  - It lost night 9, won the retry, lost night 10, won that retry, and played on with one life left.
- **What the full-play bot built** in its hour:
  - 7–8 cannon towers, 17 arrow towers and 31–33 archers
  - 20–23 stone walls, used to patch 40–46 holes at night
- **Kills, full-play bot:** towers 52–56%, troops 30–35%, the builder 7–8%.
  - In iteration 6: towers 51%, the bot 27%, troops 18%.
  - The builder's share fell because its nights now go on patching as well as shooting.
- **Kills, towers-only bot:** towers 66–67%.
- **Low tier** (`--quality=low`, 25 min, full-play bot): at most 28 attackers at once. Night 5 was
  the first to reach the 56-a-night cap; the extra came as hp (×1.07). 59.9 fps, no errors.

### The difficulty map (`recordings/map-final/`; iteration 6's rules: `map-baseline-*`)

One night per run with the builder on autopilot, 2 runs per cell. Each cell: result, the Town
Center's lowest hp.

| Town | Rules | Night 2 | Night 4 | Night 6 | Night 8 | Night 10 | Night 12 |
|---|---|---|---|---|---|---|---|
| Starting town | iteration 6 | W 100 / W 100 | W 78 / W 100 | W 100 / W 82 | W 92 / W 56 | W 60 / W 70 | L / L |
| | now | W 100 / W 100 | W 43 / W 94 | L / L | L / L | L / L | L / L |
| Tower town (t1: 27 arrow towers, 7 troops) | iteration 6 | W 100 ×2 | W 100 ×2 | W 100 ×2 | W 100 ×2 | W 100 ×2 | W 100 ×2 |
| | now | W 100 / W 100 | W 85 / W 89 | W 49 / W 78 | L / W 40 | L / L | L / L |
| Mixed town (t2: t1 with 9 cannons, 3 gunners) | iteration 6 | W 100 ×2 | W 100 ×2 | W 100 ×2 | W 100 ×2 | W 100 ×2 | W 100 ×2 |
| | now | W 100 / W 100 | W 100 / W 100 | W 100 / W 100 | W 100 / W 100 | W 100 / W 100 | W 96 (one run didn't load) |
| Arrow towers and troops (t3: 21 towers, 23 troops, from a full-play game) | now | W 100 / W 100 | W 100 / W 78 | W 92 / W 55 | L / L | L / L | L / L |

- **The same number of towers, a third of them cannons,** holds at least 4 nights longer than all
  arrow towers (the plan's check that choices matter: at least 2).
- **A town of arrow towers and many troops (t3)**, left to the autopilot, falls from night 8.
  - Its 23 troops count double, so it draws the biggest answer (raiders and brutes).
  - Towns like it held nights 8–12 in the full-play bot's games, so the night's work (patching,
    shooting from the wall) matters now.
  - A town of towers with a third cannons (t2) holds best.

### The assessment's four problems, before and after

1. **Nights weren't a threat.** Now:
   - with no player, the starting town falls on night 5–6 (iteration 6: night 10)
   - iteration 6's winning plan (all arrow towers) loses on night 8 and is over after night 9
   - the Town Center is hit on most nights, and 10–12 towers are lost a night
2. **Losing cost nothing.** Now it costs a life:
   - the towers-only and idle games all ended in game over after the third loss
   - the full-play bot played its last 8 minutes on its last life
   - One thing shows up: a lost night comes back the same, and a player (or bot) who changes
     nothing usually loses it again. The idle and towers-only games lost their night 2–3 times
     in a row.
3. **Arrow towers did the fighting.** Now:
   - arrow towers only is the weakest built town: first loss on night 8, against night 9 to
     beyond 12 for the full plan
   - in the map, a third cannons adds at least 4 nights
   - iron and gold have uses: cannons, gunners, troops
   - troops are strong, but the attack answers them hardest
4. **The day was walking and digging.** Partly better:
   - gathering is faster: 10 logs in 17.6 s (31 s), 12 cobble in 30.8 s (33 s)
   - placing a tower takes one click (placing is 1% of the bot's day, 6% before)
   - crafting is 3% (4%)
   - the harness clicked for the mouse 13–19 times a game (62 in iteration 6's hour)
   - **But the share of the day spent walking and mining didn't change:** 48% and 44%
     (iteration 6: 44% and 42%). With more to build (cannons, troops, a stock of walls), the bot
     spends the time it saves on gathering more.

### Tuning (how the numbers got there)

The plan's numbers were the starting point. Each round was measured on the map, then in games:

| Round | Change | What it showed |
|---|---|---|
| 1 | the plan's numbers | starting town right (falls from night 6); the tower town first lost on night 12 (target 7–10); the mixed town held at 100% to night 12: cannons drew raiders, who die before they matter |
| 2 | the extra budget grows by 0.035 a night up to 0.4 (was 0.025, up to 0.3); cannons draw sappers | map on target. In games the full-play bot won 16 and 18 nights: its 30–45 troops, revived free every dawn, did 70% of the late kills. (It also had a bot bug: it stopped gathering after day 1, so troops were all it bought) |
| 3 | troops count double; +0.04 a night; the starting town's allowance 226 (troops doubled, and the steps) | towers-only first lost on night 8–9 (target met). The full-play bot, after two bot fixes (below), won all 13 and 14 nights of its hour: from night 10 the waves hit the device cap (140) and the extra budget stops growing, so only grunts grew |
| 4 | grunts ×1.18 a night (was 1.16) | the final numbers above |

- **Tried and dropped:** an extra-budget cap of 0.5. At 0.5 one arrow tower would draw more than
  one brute a night, so building could stop paying. The cap stays 0.4.

### The recorded hour (`recordings/final7-rec/`)

- **Files:**
  - `game.mp4`: 59:55, 1.3 GB, H.264 at 30 fps with the game's sound, and a chapter for each phase
  - `game-8x.mp4` (164 MB) for a quick watch
  - contact sheets in `sheets/` (a frame every 30 s)
  - `report.md`
  - `game.webm` (2.1 GB) is the raw capture and can be deleted
- **Continuity:** one file, 107,825 frames, the largest gap between frames 0.125 s, none over 0.25 s.
- **The game:** the full-play bot won all 13 nights. The Town Center was hit on 9 of them, down to
  48% on nights 8 and 10 and 45% on night 13, and it lost 10.8 towers a night on average.
  - It patched 50 holes.
  - Kills: towers 54%, troops 33%, the builder 8%.
- **What it shows that iteration 6's hour didn't:**
  - breaches and patching at night
  - the dusk banner naming the counters ("Night 12 is coming: 87 grunts, 72 raiders, 40 brutes and
    33 sappers. Your troops drew brutes and raiders.")
  - the builder knocked out
  - crowds of up to 140 attackers a night from night 9
- **What it doesn't show:** a lost night or a game over. The first unrecorded full-play game has
  both a loss and a won retry, and the towers-only and idle games end in game over (their reports
  are in `recordings/final7/`).
- **Performance while recording:** 59.8 fps on average, 1% low 56.1, 6 frames over 50 ms in the hour.
  The heap went from 42 MB to 142 MB (290 MB at most, during night 13).

## How it was verified

- **`npm run check`:** the type check is clean and **167 tests pass** (143 before). New tests:
  - **Waves (8):**
    - only unlocked attackers come
    - a fixed town's waves grow every night (count and hp, nights 1–20)
    - a new type adds to the grunts
    - the starting town draws nothing extra, while building does, more on later nights, and a
      tower never draws a brute
    - what's built draws its counter
    - the list is mixed
    - the weakest side
    - the banner wording
  - **Armour:** 1.
  - **Lives (3):**
    - a loss costs one; the opening raid and creative don't
    - the third loss ends the game: phase `over`, no more dawns
    - fewer lives at the start
  - **World file:** `lives` round-trips; older and used-up files get a full set.
  - **Building (`tests/building.test.js`, 8):**
    - logs pay for planks
    - a tower straight from logs
    - ×5 stops at the stock
    - no dirt, sand or logs on the hotbar
    - the tower's column, and each reason it can't be built
    - patching: only a hole made tonight, only with the same block
  - **Guide and default town (5):**
    - the wall tip and the night reminder's bow
    - patching completes no step
    - 8 steps onto the wall
    - trees, the outcrop and its iron, all clear of the gate lanes and the ditch
- **`npm run build`:**
  - game code **339.3 KB** brotli (336.0 KB in next_6), 366.0 KB to the first playable frame
    (361.7 KB)
  - the default world file is 22 KB raw, 1.7 KB brotli (budget 50 KB)
- **`npm run perf -- --headless`:**

  | Profile | Menu interactive | First playable frame | Opening raid (60 s) | Night benchmark |
  |---|---|---|---|---|
  | desktop | 0.11 s | 0.88–0.99 s warm (one run 1.40 s), 2.45 s cold shader cache (next_6: 0.96 / 2.62) | 60.0 fps, longest frame 33 ms, 0 over 50 ms | 60.0 fps, 71 units, high |
  | mobile (4× CPU) | 0.20 s | 1.50 s (next_6: 1.48) | 60.0 fps, longest frame 33 ms | 60.0 fps, 48 units, med |

- **Skill tests** (`--lab=skills:all`): 15/15, including the new one-click tower.
- **B6:** the browser probe (above) before and after the fix.
- **Screenshots** checked:
  - the Build panel (×5, "uses N logs", the notes)
  - the dusk banner (two lines) and the lives chip
  - the game-over card
- **Fair play:** 0 blocked writes in every run. The read-only view now also allows `forEach` and
  `has`, for the world's overlays (the night's damage, to find holes).

## Where it differs from the plan

- **The numbers,** after four rounds of tuning (above):

  | | Plan | Final |
  |---|---|---|
  | grunt growth | ×1.16 | ×1.18 |
  | extra budget per defence point | +0.025 a night, up to 0.3 | +0.04 a night, up to 0.4 |
  | starting town allowance | 180 | 226 |
  | troops | count once | count double |
  | cannons draw | raiders | sappers |

- **The outcrop is north-west,** not on the diagonal opposite the grove: the south-west is a
  mountainside (the bot's first quarry there was 17 blocks above the plaza).
- **B6 was found and fixed** (the plan time-boxed the search).
- **The breach hint is a toast** (once a night), not text added to the "breached" alert, which is a
  short label on a marker.
- **The mouse stays locked only for real input.** The browser counts only trusted events as user
  activation, so the bot's own key presses (synthetic) don't count. The harness still needed
  13–19 clicks a game (62 in iteration 6's hour): a harness click leaves a few seconds of activation that often
  covers the bot closing a panel.
- **Added:**
  - the attackers cheer at game over, and a knocked-out builder stays down
  - the attackers chip hides at game over
  - the dusk banner wraps to two lines
  - `--dist`, the `t3-full` town, and the day-end and aim notes in the bot's log
- **Bot fixes found while measuring:**
  - **Placing:** a standing spot must have a clear line to the cell. It used to pick spots outside
    the wall, in reach but blocked by it: 17 failed placements in one game.
  - **Failed blocks expire after 150 s.** The quarry skips them when it picks its targets; the
    outcrop's first failures used to block all gathering from day 2.
  - It looks for iron again every day.
  - It keeps iron for cannons while there are spots for them.
- **The map's first round ran against the iteration 6 build** (a copy in
  `recordings/dist-baseline/`), for the "before" rows.

## Known issues / limits

- **A lost night comes back the same.** A player who changes nothing usually loses it again, so the
  first loss often means game over within 10 minutes (idle, towers-only). A human would build
  between tries; whether three tries at one night feels fair needs a person to play it.
- **Late nights grow as hp, not as bodies.** From about night 9 (high tier; night 5 on low) the
  device cap holds the count, and the rest becomes hp on every attacker. It works, but a night 14
  looks like a night 10 with tougher attackers. Stronger types would read better (see next).
- **The bot's day split didn't change** (walking 48%, mining 44%). Measured by the bot, the busywork
  changes made each task faster, not the day less about gathering.
- **The full-play bot's limits:**
  - It ends with 13–15 iron and 10–15 gold unspent: it holds iron for cannon spots it can't always
    fill.
  - It never uses the ×5 craft (it crafts one at a time, as before).
  - The dusk tip's "done" (standing on the wall at night) isn't in its report.
- **The weak-side fronts** weren't measured on their own.
- **Two runs per setup.**
- **Two of about 70 runs failed to start** (one game, one map night). One logged a Chrome load error
  from the local test server (`ERR_CERT_VERIFIER_CHANGED`); the other logged nothing. Both were
  re-run or left out, and the harness doesn't retry by itself.
- **The numbers are tuned to a bot.** It aims well and never hesitates, but builds by fixed rules.
  A person could be weaker at night or smarter by day.

## What to work on next (suggested order)

1. **Play it.** A person's first hour against these numbers: is night 5–8 the right place for a new
   player's first loss? Do the dusk banner and the Build panel's notes make the counters clear? Is
   losing a life, then the same night again, fair?
2. **Late nights with new attackers instead of hp:** a type that appears once the cap is reached
   (an armoured brute, a siege ram for gates), so night 14 looks different from night 10.
3. **Something to change between tries** of a lost night, like a shop at dawn after a loss, or the
   attack shifting its fronts, so a retry isn't a replay.
4. **The day, still:** drag-to-build walls, tower upgrades as an iron and gold sink, directing
   troops (rally to a gate).
5. **Carried over:**
   - a real phone and an older laptop, then tune `TIERS`
   - first-person item poses (`ITEM_POSE`)
   - an armour tier, hit sounds per weapon, a hand-built default world, multiplayer groundwork
