# Gameplay assessment (prompt 6)

Answers the assessment part of `ai/prompt_6.md`: is the game engaging, is it fun, and how to
improve it. Written while building the autoplay bot and watching it play.

## How it was judged

- **Games played by the bot**, through input only (keys, mouse, HUD clicks), on the production build:
  - **the recorded game**, `recordings/final/`: one hour, final code, 18 nights
  - a rehearsal hour on an earlier build (18 nights)
  - two earlier full games (25 and 20 min)
  - about 20 short lab runs while the bot was built
- **An idle baseline** (`--strategy=idle`, 35 min, final game code except B6): builds nothing,
  starts every night straight away, and watches from above while the builder fights on autopilot.
  It shows what the starting town does with no player.
- **Numbers**: every run logs each night's attackers, kills by source, Town Center hp and blocks
  lost, and what the bot was doing every second (`report.md` in each run folder).
- **Footage**: screenshots every 15–20 s in test runs, and contact sheets (a frame every 30 s) of
  both recorded hours.
- **The caveat**: I can't feel whether something is fun. I'm judging from outcomes, pacing,
  choices and footage, and from what each task took the bot to do. What only a person playing
  can answer is listed at the end.

## Verdict

**The idea reads clearly and the presentation is good.**
- The opening raid shows in 90 seconds what the attackers want.
- The dawn rebuild explains the loop without text.
- Hits, alerts and health bars make a night easy to follow.

**But past the first half hour it isn't engaging.** Four problems feed each other:

1. **Nights are never a threat.** With no building at all, the starting town wins the first
   9 nights. The bot won 18 of 18, and **no attacker touched the Town Center on any of them** (night 19,
   cut off by the 1-hour cap, took it to 99.7%).
2. **Losing costs nothing.** A lost night is rebuilt for free at dawn and simply comes again.
3. **Arrow towers do the fighting.** They are cheap, the bot filled every spot inside the wall by
   day 3, and nothing else was ever needed. The player's own fighting is a quarter of the kills,
   the same share the builder's *autopilot* got with no player at all.
4. **The day is walking and digging.** 86% of the bot's day went on walking and digging; placing
   and crafting, where the decisions are, took 10%. From day 4 on there was nothing left worth
   building, and the bot started each night within seconds.

The moments that could be fun (choosing and placing defences, holding a gate, shooting from the
wall) are a small part of the time, and there's no pressure to make them count.

## The evidence

### 1. Nights aren't a threat

| | Nights won | Town Center lowest | Built |
|---|---|---|---|
| Idle baseline (no player) | 1–9 in a row; 10 and 11 lost once each, then won | 100% on 1–6 (95% on 4), then 60%, 85%, 8% | nothing |
| Bot, recorded hour | **18 of 18** | **100% every night** | 23 arrow towers, 5 archers, steps up the wall |
| Bot, rehearsal hour | 18 of 18 | ≥ 99% | 23 arrow towers, 7 archers |

- **The attack barely grows for the first week.** The wave budget rises 18% a night, but new,
  pricier attackers unlock as it rises (raiders night 2, brutes 3, sappers 5), so the *number* of
  attackers falls after night 1. From the wave rules (40 samples each, starting town):

  | Night | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 |
  |---|---|---|---|---|---|---|---|---|
  | Attackers | 21 | 17 | 15 | 16 | 16 | 19 | 23 | 29 |
  | Total attacker hp | 1260 | 958 | 1162 | 1344 | 1324 | 1459 | 1934 | 2624 |

  Night 2 is weaker than night 1, and night 6 is only 16% stronger. In the recorded game the
  attacker count was 24–31 on nights 1–8, then 33–106 on nights 10–18.
- **Defences outgrow it.** An arrow tower does 10 damage a second. The bot had 23 towers by
  night 2 (~230 damage a second): enough to kill a whole night's hit points in about 6 seconds of
  fire.
- **Building more barely raises the waves.** Each point of defence adds 0.04 to the budget, so the
  bot's 572 points added ~23 (night 10's base budget is 62).
- **Night 18 (106 attackers) still didn't reach the Town Center.** The towers lost 8 of 27 that
  night, and 49 blocks.

### 2. Losing costs nothing

- A lost night: the town is rebuilt at dawn, block by block, for free. No resources are lost, and
  the same night level comes again.
- In the idle game night 10 was lost and then won the next time. The only difference between
  winning and losing is the reward (1–10 gold and iron) and the night level going up.

### 3. One strategy wins: arrow towers

- **Cheap and quick.** 6 planks and 4 cobble, plus 2 cobble for the column. The bot built 23 in
  its first three days (about 13 minutes of play) and then ran out of spots.
- **They do the killing.** Towers got **51% of the 816 kills** in the recorded game, the bot 27%,
  troops 18%.
- **Nothing else was needed.**
  - Cannon towers need iron (4 each) and troops need gold. Both come slowly: the night reward is
    1–10 gold and 1–9 iron, and gold ore only exists below y 2.
  - Spikes, iron walls and extra walls were never worth building.
  - The bot spent some gold on archers and some iron on the iron sword and a musket; the rest
    piled up (see 5).

### 4. The player has little to do at night

- **A quarter of the kills.** The bot got 27% of the kills in the recorded game. In the idle game
  the builder on **autopilot** got 26% (70 kills), and troops did most of the rest. Playing yourself
  isn't clearly better than letting the game do it.
- **A sword can't reach attackers outside the wall.** They break the wall from outside, where only
  a gate lets you at them. Before this iteration the sword reached *through* the wall (B3).
- **The bow from the wall top is the useful job, and the game never suggests it.** On the wall
  you're also safe: melee attackers can't reach 2 blocks up and can't stand on the wall, so only
  raiders can hurt you. The bot was knocked out once in the first 18 nights, and twice on night 19.
- **Nights are mostly waiting and moving.** The bot's night time: walking 47% (to a perch, between
  perches, to a gate), shooting 36%, guarding 11%. New groups spawn 45–60 blocks out and take
  15–20 s to reach the wall.

### 5. The day is walking and digging

The bot's day, second by second (recorded game): **walking 44%, mining 42%, placing 6%,
crafting 4%**.

- **Wood is far.** No tree grows within 30 blocks of the town center.
- **Stone is under 4 blocks of dirt.** The first cobble of each column costs grass and 3 dirt.
  Digging sideways, once stone shows, gives one cobble per ~1.5 s.
- **Gold is deep.** Gold ore only exists below y 2 (6+ blocks under the town).
- **Even played fast, it's slow.** The bot is quicker than a new player and still spent its first
  two days (5–6 minutes each) mostly walking and digging.
- **Then there's nothing pressing to do.** From day 4 every tower spot was taken, so the bot
  stopped gathering and started each night within seconds. The last 40 minutes of the video are
  night after night with 3–10 s of day in between.
- **Rewards pile up.** By the end the bot held **92 gold and 83 iron** unspent. That's partly the
  bot's limit: it only spends gold on archers, which also need planks, and never tried
  swordsmen, gunners or more cannons. But with every night won and the Town Center untouched,
  nothing pushed it to. The rewards grow every night and there's nothing new to spend them on.
- **The footage shows it.** A day is close-ups of dirt and stone at the quarry, and walks.

### 6. Friction in the controls and UI

- **Planks take one click per log.** The recorded game has 38 "Crafted 4 × Planks" toasts; each
  tower is another click.
- **The Build panel releases the mouse,** and you click back into the game after every visit.
  The bot's harness clicked 62 times in the hour.
- **Towers go on 2-high columns,** so the tower block has to be placed at the top of a jump (its
  top face is above eye level). The default town is built this way, so a player will copy it.
- **The hotbar fills with dirt.** Day 1 gave ~35 dirt. Once the 9 slots are taken, newly crafted
  towers don't get one; you have to open Build, click the item, then press a slot key.

### 7. Performance over a long game

- **Frame rate:** an hour at 59.9 fps on average (1% low 57.4) on the Intel iGPU, recording as it
  went, with 3 frames over 50 ms in the whole hour.
- **Memory grew by about 2 MB a minute** in the recorded hour: the heap's floor went from 52 MB to
  170 MB, and the idle game grew the same way. The cause was a leak: every unit left its skeleton
  and a GPU texture behind when it was removed, about a thousand an hour. That's fixed now (B7),
  and after the fix the heap stays flat.

## What works

- **The opening raid.** It shows the goal quickly and reads well from above; the dawn rebuild
  after it explains the loop.
- **Feedback.** Health bars, damage numbers, cracks, the "under attack" and "breached" alerts
  with edge arrows, and the hurt flash make a night easy to follow.
- **Building feels responsive.** Once in reach, a column and a tower go up in under a second.
- **Late nights look good.** From night 14, 57–106 attackers pour at the wall from two sides
  while towers fire. It's the most exciting part of the video, and it comes after 43 minutes.

## Bugs found and fixed

| | Bug | Fix |
|---|---|---|
| B1 | The pause menu threw an error on opening (a missing semicolon joined two lines). The game kept running behind it, and clicks reached the game | fixed; a source test catches the pattern anywhere in `src/` |
| B2 | After being knocked out at night, the role picker stayed open with a stale, disabled "Fight as yourself (knocked out)" button. The builder stood still until the player closed it | closes when the builder gets up, or refreshes if you're still choosing |
| B3 | Melee hit through walls: the builder's sword reached attackers on the other side of a stone wall, and grunts could hit a builder standing against it | a blow needs a clear line between the two chests (open gateways still work); unit tested |
| B4 | After B3, an attacker in reach of someone behind a wall stood still forever (standing still never counts as stuck) | it drops that target for a few seconds and goes back to the wall |
| B5 | Wreckers that had broken through the wall kept eating the rest of the ring, block by block, instead of going in. A night's last two grunts took 2+ minutes | through the wall, a wrecker heads for the town (it still widens its own breach) |
| B6 | The knocked-out builder's body sank through the ground, and it got up *inside* the ground under the plaza, trapped for the rest of the night | a unit stuck inside blocks is lifted to where it fits; a body falling out of the world is stopped (the trigger isn't found yet) |
| B7 | Memory leak: every unit left its skeleton and its bone texture behind (about a thousand an hour; the heap grew ~2 MB a minute) | disposed with the unit; heap flat since |

## How to improve it (most important first)

1. **Make nights dangerous, and grow with the player.** Without this the core loop has no tension.
   - Scale the attack with the defence, not mostly with the night. For example, a budget that
     aims at a target share of the town's damage output, or a much bigger `WAVE_ADAPTIVE`.
   - Keep the attacker *count* growing when new types unlock (their cost comes on top, not instead).
   - Attackers that answer the defence: more brutes and sappers when there are many towers,
     raiders that snipe towers, fronts that avoid the strongest side.
   - The bot and the idle baseline can measure each change. With the bot, a good first target
     is losing a night somewhere around night 8–12.
   - *Cost: small to medium (balance.js and waves.js), then play testing.*
2. **Give a lost night a cost.** For example:
   - the dawn rebuild only restores part of what was lost, and the rest costs resources
   - a lost night takes resources
   - three lost nights end the game with a score (nights survived)
   - *Cost: medium.*
3. **Give the player a job at night.** *Cost: medium.*
   - **Make the wall walk a designed place to fight:** ramparts that are easy to climb, and the
     bow suggested at dusk. The bot found it on its own, and it's the best part of its nights.
   - Repair damaged blocks at night from what you carry.
   - Direct troops (rally to a gate).
4. **Give the days something to do after day 3, and less busywork before.** *Cost: small each.*
   - Tower upgrades or more tower types, so resources keep mattering once the spots are full
     (the bot ended the hour with 92 gold and 83 iron and nothing it needed to buy).
   - Craft a stack at once (shift-click, or "×10").
   - Place a wall line by dragging; towers that come with their own base.
   - Keep dirt and sand off the hotbar unless you choose them.
   - Put some trees and exposed stone nearer the town.
5. **More real choices.** *Cost: medium.*
   - Towers that counter specific attackers (arrows vs grunts, cannons vs brutes).
   - A reason to use walls, spikes and troops: e.g. attackers that ignore towers until blocked.
6. **Smaller.**
   - Keep the pointer locked when a panel closes.
   - A "reaches the wall in …" timer for each group.

## What only a person playing can answer

- Whether mining and building *feel* good (sound, hit feel, the pickaxe motion).
- Whether first-person sword fighting feels good, and whether the bow and the musket are
  satisfying from the wall.
- Whether the day's pace feels relaxing or tedious to a person who doesn't optimise.
- Whether a new player finds the tips helpful and understands the dawn rebuild without text.
- How the game feels on a phone.
