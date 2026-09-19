# Plan 7: nights you can lose, a reason not to, and less busywork

Answers `ai/prompt_7.md`: improve the gameplay based on `ai/assessment_6.md` and `ai/next_6.md`.
Nothing below is implemented yet.

The assessment found four problems that feed each other:
1. Nights are never a threat.
2. Losing costs nothing.
3. Arrow towers do all the fighting.
4. The day is mostly walking and digging.

This plan takes them in that order. The bot from iteration 6 measures each change.

---

## 0. What I found before planning

I read the wave, cycle, session, inventory and world code, and the reports of the iteration 6
runs (`recordings/final/`, `recordings/idle-final/`). I also ran a scratch model of the wave rules
(Node, in the session scratchpad; no project files changed).

### 0.1 Why nights aren't a threat, in the code

- **Budget:** `waveBudget = 14 × 1.18^(night − 1) + 0.04 × defence value` (`waves.js`).
- **Unlocks shrink the waves.** `composeWave` spends one budget on every unlocked type. A new type
  comes *instead of* grunts, so the attacker count drops after night 1.
- **Defence barely counts.** The starting town is already worth 180 defence points. The bot's town
  (27 arrow towers, 9 troops) is worth 572. That adds 7 and 23 to the budget.
- **The model's numbers** (200 samples each; attackers / their total hp):

  | Night | 1 | 2 | 3 | 5 | 8 | 10 | 12 |
  |---|---|---|---|---|---|---|---|
  | Starting town (180) | 21 / 1,260 | 17 / 955 | 15 / 1,170 | 16 / 1,305 | 23 / 1,935 | 30 / 2,624 | 39 / 3,498 |
  | Bot's town (572) | 36 / 2,160 | 29 / 1,586 | 23 / 1,889 | 23 / 1,938 | 30 / 2,542 | 36 / 3,198 | 46 / 4,129 |

### 0.2 What each town held

- **The starting town, no player** (idle run): it held nights of up to about 2,300 hp of attackers. It first
  lost on night 10 (2,624 hp).
- **The bot's tower town:** it held night 18 (106 attackers, about 9,700 hp by the model), and no attacker touched
  the Town Center. So it can take at least 4× what the starting town can.
- **So:** a player who fills the town with arrow towers by day 3 was safe for all 18 nights the hour held.

### 0.3 A lost night today

- The Town Center falls → `endNight('lost')`.
- The night level stays the same, and dawn rebuilds everything for free.
- Rewards only come after a win.
- The world file saves `day` and `nightLevel`, and nothing about losses.

### 0.4 Where the busywork comes from

- **Planks:** one click per log (a log makes 4 planks). The recorded game had 38 plank crafts.
- **The hotbar:** `Inventory._autoSlot` gives every placeable item a slot, dirt and sand included.
- **Towers:** a tower needs a 2-high column (2 cobble), and the tower block goes on at the top of a
  jump.
- **The Build panel releases the mouse** (`setUiOpen`). Closing it doesn't take the mouse back, so
  you click the game again. The harness did that 62 times in the hour.
- **Trees:** the generator doesn't grow any within 30 blocks of the town center (`treeInCell`), and
  the default world adds none nearer.
- **Stone** is under 3–4 blocks of dirt, and gold ore only exists below y 2.

### 0.5 Pieces I can reuse

- **Night repair:** `world.restoreBlock` puts back one destroyed block (the dawn rebuild uses it).
  Placing is blocked at night only by `canEdit` (day only).
- **Wall targets:** siege rules already treat a tower's column as a "support" that wreckers go for.
- **Result cards:** `hud.showResult` shows the night's result.
- **The perf night benchmark** already fills a night up to the device cap, so bigger waves don't
  change the worst case it measures.

---

## 1. Scope

| # | Change | Answers | In this iteration |
|---|---|---|---|
| 1 | Waves that grow every night and answer what you build | nights aren't a threat, towers do everything | yes |
| 2 | Brutes shrug off arrows | towers do everything, unspent iron and gold | yes |
| 3 | Three lives, then game over with a score | losing costs nothing | yes |
| 4 | Steps up the wall, a dusk tip for the wall walk, patching breaches at night | the player has little to do at night | yes |
| 5 | Logs count as planks, craft ×5, towers come with their column, no dirt on the hotbar, the mouse stays locked | busywork | yes |
| 6 | Trees and a stone outcrop near the town (default world) | the day is walking and digging | yes |
| 7 | Bot: follows the changes, a full strategy that spends everything, game over handling | measuring it | yes |
| 8 | B6's trigger (time-boxed) | bug | yes |
| — | Tower upgrades, drag-to-build walls, directing troops, a "reaches the wall in …" timer | | later (§10, choice 8) |
| — | Real phone test, item poses, armour tier, hit sounds per weapon, multiplayer | carried over | later |

---

## 2. Nights that are a threat

### 2.1 Every type adds to the wave

Each attacker type gets its own stream from its first night. A new type comes on top of the
others, so the wave never shrinks.

| Type | First night | Starting count | Growth |
|---|---|---|---|
| grunt | 1 | 14 | ×1.16 a night |
| raider | 2 | 2 | +0.8 a night |
| brute | 3 | 1 | +0.4 a night |
| sapper | 5 | 2 | +0.5 a night |

- Fractions are rolled (2.4 → 2 or 3), so each night varies a little.
- Night 1 gets 14 grunts, down from 21. It's the first night a new player plays after the opening
  raid, so it should be easy. From there the wave grows every night.
- The device cap stays: above `maxAttackers × 2`, extra attackers become extra hp on the others.

### 2.2 The attack answers what you build

- **What you build adds to the wave:** `k(night) × (defence value − 180)`.
  - The first 180 points are free. That's the starting town, so a player who builds nothing isn't
    punished for the town they were given.
  - `k` starts low and rises: 0.05 on night 1, then +0.025 a night, up to 0.3 by night 11.
    Building early buys you nights, and later the attack catches up.
  - It stays well below what a defence is worth. At `k` 0.3, an arrow tower (14 points) draws
    about 0.7 of a brute a night, which it can easily kill. Building always pays; it just pays
    less later.
- **The extra attackers counter what you built.** The extra budget is split by where your defence
  value comes from:

  | You built | They send more |
  |---|---|
  | arrow towers | brutes (armoured, §2.3) |
  | cannon towers | raiders (spread out, shoot from range) |
  | troops | raiders and brutes |
  | walls and gates | sappers |
  | a strong weapon for the builder | raiders |

  Before night 3, when brutes don't exist yet, it's all grunts.
- **Fronts lean to the weak side.** From night 4, one sub-wave in three aims at the side with the
  fewest towers and troops. The choice is weighted and random, so it can't be predicted exactly.
  Leaving one side bare becomes a risk.
- **The player can see it.**
  - The dusk banner says what's coming, and why. For example: "Night 7: 34 grunts, 9 raiders,
    8 brutes. Brutes shrug off arrows."
  - The Build panel says what each tower is good against.
  - Otherwise the counters would feel unfair.

### 2.3 Brutes shrug off arrows

- **A damage table** in `balance.js`, applied where hits land (`units.damage` and
  `projectileHit`): brutes take **half damage from arrows**. That covers arrow towers, archers
  and the bow.
- **What still hurts them fully:** cannons, muskets, gunners and melee.
- **What it's for:** a town of only arrow towers runs out of answers as brutes grow. Iron (cannons,
  muskets) and gold (gunners) get a use.

### 2.4 The starting numbers

The scratch model with §2.1–2.2. The last two columns use the bot's town, with brutes as the
counter to arrow towers.

| Night | Starting town, now | Starting town, new | Bot's town, now | Bot's town, new |
|---|---|---|---|---|
| 1 | 21 / 1,260 | 14 / 840 | 36 / 2,160 | 34 / 2,015 |
| 2 | 17 / 955 | 18 / 1,064 | 29 / 1,586 | 48 / 2,827 |
| 3 | 15 / 1,170 | 23 / 1,575 | 23 / 1,889 | 33 / 3,315 (7 brutes) |
| 5 | 16 / 1,305 | 34 / 2,386 | 23 / 1,938 | 50 / 4,514 (8 brutes) |
| 8 | 23 / 1,935 | 53 / 3,814 | 30 / 2,542 | 78 / 7,002 (10 brutes) |
| 10 | 30 / 2,624 | 70 / 5,013 | 36 / 3,198 | 100 / 8,909 (13 brutes) |
| 12 | 39 / 3,498 | 92 / 6,493 | 46 / 4,129 | 125 / 10,728 (14 brutes) |

- **The starting town** should now fall around night 5–6 without a player. Today it lasts to 10.
- **The bot's tower town** faces 2–3× today's hp. Against arrows, each brute counts double.
- **These are starting values,** tuned with the bot (§6). All of them live in `balance.js`.

### 2.5 What stays the same

- The opening raid.
- The night length limit: a night is won when every attacker is dead, or when the Town Center
  still stands after 5 minutes.
- Sub-waves: one every 40 s.
- The spawn ring.
- The device caps.

---

## 3. A lost night costs a life

### 3.1 Three lives

- **The rule:** a survival game has 3 lives, shown as three crystals by the night counter in the HUD.
- **Losing a night** costs one. The result card says "Night 7: the Town Center fell. 2 lives left."
- **Otherwise, a loss works as it does today.** Dawn rebuilds the town, and the same night comes
  again. That way one loss doesn't snowball into the next.
- **What doesn't count:** the opening raid.
- **Creative mode** is unchanged: it has no lives.

### 3.2 Game over

- **When:** the third loss.
- **The card:** "The town is lost. You survived 11 nights." It shows your best for this world
  (saved in settings), with **New game** and **Menu** buttons.
- **The ruins stay** behind the card: the last dawn doesn't rebuild.
- **The autosave is cleared,** so Continue doesn't bring back a finished game.

### 3.3 Saving

- **A new `lives` field** in the world file.
  - A file without it gets 3.
  - `docs/world-format.md` and `worldFile.js` are updated, with a round-trip test.
- **Exported worlds** carry the lives they have left.

---

## 4. A job at night

### 4.1 Steps up the wall

- **Where:** the default world gets a cobble step inside the wall on both sides of each gate
  (8 blocks).
- **What it does:** you can get onto the wall walk without building anything. The bot had to build
  these itself.
- **The wall walk stays as it is.**
  - Melee attackers can't reach you up there, and raiders can.
  - Attackers can't stand on the wall (`isBarrierTop`).
- **The steps are built blocks,** so dawn rebuilds them.

### 4.2 The dusk tip

- **With a bow or musket,** dusk shows "Climb the steps by a gate and shoot from the wall", with a
  marker on the nearest step.
- **Without one,** it says "Craft a bow (B) to shoot from the wall." The starting kit can already
  make one.
- **How often:** once a night for the first few nights, through the existing Guide, which already
  has markers and "done" handling.

### 4.3 Patching a breach

- **The rule:** at night, you can put a destroyed block back if you carry that block (a stone wall
  into a stone wall hole, a gate into a gate).
  - It uses `restoreBlock`, so the block comes back at full hp, and dawn has nothing left to do
    there.
  - The same checks as placing by day apply: within reach, and not where anyone is standing.
- **Where it shows:** the "breached" alert adds "right click with a stone wall to patch it".
- **Everything else** still can't be built at night.
- **Why:** it gives the player a job at a breach, and a reason to carry stone walls. It turns
  gathering by day into saving the town at night.

---

## 5. Less busywork by day

### 5.1 Crafting

- **Logs count as planks.** When a recipe is short of planks, it uses logs (1 log = 4 planks).
  - The recipe card says "uses 2 logs".
  - The planks recipe stays, for building with planks.
- **Shift-click crafts 5,** or as many as you can afford. On touch, a small "×5" button on the card
  does the same.
- **The Guide's craft tip** is updated to match.

### 5.2 A tower comes with its column

- **On the ground:** placing an arrow or cannon tower builds its 2-high cobble column and the tower
  on top, in one click.
  - The column's 2 cobble come from your stock.
  - The recipe stays the same.
- **On a built block** (a wall or a column): just the tower, as today.
- **If there's no room,** or not enough cobble, a toast says why.
- **What it's for:** no more placing at the top of a jump.
- **Tested** with a pure function that returns the cells to fill, or the reason it can't.

### 5.3 The hotbar

- **Dirt, sand and logs no longer take a slot by themselves.** You can still put them on the hotbar
  from the Build panel.
- **Crafted towers, troops and weapons** keep getting free slots.

### 5.4 Wood and stone near the town

- **In the default world only,** as world edits:
  - **A grove of about 8 trees,** 18–28 blocks out, between two gate lanes.
  - **A stone outcrop** (about 4×4×3, with 2–3 iron ore showing) on the opposite diagonal.
  - Both stay clear of the gate lanes and of the ditch.
- **The generator doesn't change,** so other worlds and existing saves are unaffected.
- **World file size:** it grows from 9 KB to about 15 KB. Its budget is 50 KB.

### 5.5 The mouse stays locked

- **Closing a panel** with its key (B, H…) or ✕ takes pointer lock back in the same event. Both
  count as user input, so the browser allows it.
- **Esc** can't do this (the browser reserves it), so it still needs a click.

---

## 6. Measuring it with the bot

### 6.1 Bot changes

- **Follow the game changes:**
  - towers placed with their column
  - no plank crafting
  - the hotbar without dirt
  - fewer harness clicks for pointer lock
  - the steps up the wall (it stops building its own)
- **Strategies:**
  - **`--strategy=towers`:** today's plan (arrow towers, archers, bow and musket), kept as the
    "one strategy" baseline.
  - **`--strategy=bot`** (the default) **spends everything:**
    - cannon towers near the gates once there's iron
    - gunners and swordsmen with gold
    - the musket
    - a stock of stone walls to patch breaches at night, when no attacker is within 4 blocks of the
      hole
    - it reads the dusk banner's wave make-up to decide what to build (from the same read-only view)
  - **`idle`** is unchanged.
- **Lives:** the harness stops at game over (a few seconds after the card) and reports it.
- **Report additions:**
  - lives left after each night
  - the first lost night
  - the game-over night
  - the wave make-up and its counter share
  - towers lost
  - patches made

### 6.2 A quick lab: one night against a saved town

- **What it is:** `--lab=siege:<town>:<night>` loads a saved town, starts night N at once, and lets
  the builder fight on autopilot. It measures the town, not the player.
  - A night takes 2–4 minutes.
  - Lab only, never recorded.
- **How a town loads:** the lab writes the town into the autosave slot and clicks Continue.
- **Towns** (`tools/autoplay/towns/*.world.json`, 10–30 KB each, saved from bot runs):
  - **T0:** the starting town.
  - **T1:** the tower town: the bot's town on day 4 with today's strategy (27 arrow towers,
    9 troops).
  - **T2:** a mixed town of the same cost: fewer arrow towers, plus cannons and gunners.
- **The difficulty map:** each town × nights 2, 4, 6, 8, 10, 12, 2 runs each. For each, the result,
  the Town Center's lowest hp, towers lost and blocks lost.
  - It's the inner loop for tuning §2.
  - 36 nights take about 45 minutes with 3 browsers in parallel (if the iGPU holds them; otherwise
    2).
- **Today's rules are mapped first,** as the baseline.

### 6.3 Targets

| Who | Today | Target |
|---|---|---|
| Idle: starting town, no building | first loss on night 10 | first loss on night 4–6; nights 1–2 won comfortably |
| Bot, `towers` (one strategy) | 18/18 won, Town Center 100% | first loss on night 7–10 |
| Bot, full (counters, troops, patching) | – | first loss on night 10–14; game over around night 13–18 |
| T2 against T1 (same cost) in the lab | – | T2 holds at least 2 nights longer |
| Nights 3+ in bot games | Town Center untouched | something lost most nights: towers, blocks or Town Center hp |

The fourth row is the check that choices matter. If the mixed town doesn't outlast the tower town
at the same cost, the counters are too weak.

### 6.4 Full games

- **The runs:** 2 each of idle, `towers` and full.
- **Each run** goes until game over or 60 minutes, headless and not recorded.
- **Wall-clock:** about 2 hours with 3 in parallel.
- **The loop:** retune, run the map again, then the games again.
- **The last round** uses the final code.

---

## 7. B6: why the knocked-out builder sank into the ground (time-boxed)

- **The lab scenario:** knock the builder out next to a wall block that's being breached. Then log
  its body's position, the blocks around it and the physics flags every tick until it gets up.
- **The time box:** about 2 hours.
- **If it's found:** fix the cause, with a test.
- **If not,** the safety net from iteration 6 stays. I'll write down what was ruled out.

---

## 8. Order of work

1. **Tooling and baseline:** the siege lab, town snapshots, report fields. Map today's rules
   (§6.2).
2. **Waves, armour and fronts** (§2), with unit tests. Tune a first pass on the map.
3. **Lives and game over** (§3), with the world file field, the HUD and tests.
4. **Busywork** (§5) and **the night job** (§4): the default world edits, crafting, the tower
   column, the hotbar, pointer lock, patching.
5. **The bot** (§6.1): follow the changes, then the full strategy. Skill tests pass again.
6. **Full games** (§6.4), retune, and B6's time box (§7).
7. **Wrap up:** the recorded hour, if chosen (§10, choice 9), and `next_7.md`. Next_7 gets a
   before/after section on each of the assessment's four problems.

---

## 9. How I'll verify it

- **`npm run check` passes,** with new tests:
  - **Waves:**
    - for a fixed town, attacker hp never falls from one night to the next (nights 1–20, seeded)
    - a new type adds to a wave instead of replacing grunts
    - the first 180 points of defence add nothing
    - a tower-heavy defence draws more brutes than a troop-heavy one
  - **Armour:** brutes take half damage from arrows and full damage from the rest.
  - **Lives:** a lost night takes one, and the third ends the game. The opening raid and creative
    don't count. The world file round-trips `lives`, and old files get 3.
  - **Inventory:**
    - logs stand in for planks
    - ×5 stops when you can't afford more
    - dirt, sand and logs don't take a slot by themselves
  - **Tower placement:** the cells a tower with its column fills, and each reason it can't.
  - **Patching:** only a destroyed cell, only with the same block, only at night, and never into
    someone.
  - **Default world:**
    - the steps, grove and outcrop are there
    - the gate lanes and the ditch are clear
    - a path still leads from every side to every gate
- **`npm run build`:**
  - the budget passes
  - game code grows by an estimated 4–6 KB brotli (336.0 KB today)
  - the world file stays under its 50 KB budget
- **`npm run perf -- --headless`:**
  - the menu and the first playable frame are unchanged within noise (spec: 2–3 s, 4 s at most)
  - the night benchmark holds 60 fps on desktop and on the mobile profile. It already fills a
    night to the device cap, so this checks the cap still holds.
- **Bot:**
  - `skills:all` passes 3 times in a row
  - the difficulty map and full games meet §6.3, or next_7 says where they don't and why
  - 0 blocked writes in every run
- **Performance in the bot games:** fps and longest frames from telemetry, as in next_6. Nights
  have more attackers now, so I'll check the low and med tiers with `--quality`.

---

## 10. Choices I made that you may want to override

1. **Losing costs a life, 3 lives, then game over** with a score (nights survived).
   - Alternatives:
     - endless play where a lost night takes a share of your stock (for example half your gold
       and iron)
     - after a loss, dawn rebuilds only the wall and the Town Center; towers lost stay lost
   - Both can be added to lives later.
2. **Difficulty targets** (§6.3):
   - the starting town falls around night 5 without a player
   - the full bot's first loss is around night 12
   - Say if you want it harder or easier.
3. **The attack grows with what you build,** above the starting town and gently at first (§2.2).
   - Alternative: a curve by night only, where a player can always out-build it. Some players
     dislike rubber-banding. I think the counters and the dusk banner make it read as the enemy
     adapting, not as a penalty.
4. **Brutes take half damage from arrows.** It's the one counter rule, to keep it learnable. More
   (raiders outranging troops, cannons weak against spread groups) can come later.
5. **Patching at night needs the same block that was destroyed.**
   - Alternative: any wall block patches any hole. It's easier to use, but a patch then isn't what
     dawn would rebuild, and the damage overlay has to track both.
6. **Logs count as planks automatically.** Alternative: keep planks as a step, with only craft ×5.
7. **Towers come with their column** when placed on the ground. Alternative: a separate "tower on a
   column" recipe, with the plain tower kept as it is.
8. **Not in this iteration:**
   - tower upgrades
   - drag-to-build walls
   - directing troops (rally to a gate)
   - the "reaches the wall in …" timer

   Tower upgrades are the next resource sink if the counters aren't enough.
9. **Video:** I'll record one hour with the final code, as in iteration 6 (about 1.5 hours of
   wall-clock and 1.2 GB), stopping at game over if it comes first. Alternatives: no video, just
   the before/after tables, or play on with a new game after game over to fill the hour.
10. **Trees and the outcrop only in the default world.** Generated worlds keep today's terrain.
    Changing the generator would need a new generator version, so that saved worlds don't change
    under their edits.
