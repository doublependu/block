# next_9: where iteration 9 got to

Answers `ai/prompt_9.md`, following `ai/plan_9.md`. Everything below is in the working tree, and
`npm run check` passes (210 tests, all nine models valid).

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| Issue 1: can't build a stone wall next to a stone wall | **fixed**, and a second bug of the same kind fixed with it (§2) |
| Issue 2: is the 1-hour video blurry from resolution or from ffmpeg? | **both, measured**: the browser's recorder loses the most, then resolution, then ffmpeg; all three are fixed for the next recording (§3) |
| Feature 1: a cooler pickaxe | **done**: new mesh, pose, chop, and sparks (§4) |
| Feature 2: better sound for everything, and a night that sounds like an attack | **done**, all synthesised: 77 sounds, a mixer, and a night soundscape driven by the siege (§5). **It needs your ears**: I can measure it, but I can't hear it |
| next_8 §4–5: bot tiers, towns, map, games, tuning, showcase, polish | **done**. The games found why late nights stopped getting harder (fixed), and that the economy is too short of iron for tiers to be bought in a real game (your call, §8) |

---

## 2. Issue 1: building beside a wall

**Cause.** Iteration 8's in-place upgrade was checked before an ordinary build. Aiming at a wall
block with a wall of the **same or a lower** tier in hand returned "Already a stone wall" / "A
better wall is already here", and nothing was built. The same rule had a second problem: a higher
tier **always** replaced the block you clicked, so you couldn't stack an iron wall on a stone one.

**The bot hit it too.** `skills.place` builds against the previous block of the wall, so every
wall after the first in a run failed as `no aim`. The wall numbers in iteration 8's games are
suspect.

**The rule now** (`placing.js`: `upgradeGesture`, `upgradePlacement`):

| Holding | Right-click on | Result |
|---|---|---|
| same family, same or lower tier | a wall, gate, tower | builds beside it (the fix) |
| a higher **tower** or **spike** tier | a lower one of its family | upgrades in place on a click (nobody stacks towers) |
| a higher **wall** or **gate** tier | a lower one | a click **builds beside or on top**; **holding** the button 0.4 s upgrades in place (a bar fills under the crosshair; touch: hold ▣) |

The first click beside a lower wall with a higher tier in hand says once: "Hold to upgrade the
stone wall to iron wall". The help panel, the recipe cards and the README say the same.

**Verified** in the running game with a new skill test (`--lab=skills:walls`): a five-block wall
built each block against the previous one, a second course on top, iron stacked on stone with a
click, and stone upgraded to iron with a hold. **4/4, three runs in a row**, and `skills:all` is
21/21 (it was 15 before this iteration).

---

## 3. Issue 2: the blurry video, answered with numbers

`tools/autoplay/capture-test.mjs`: the game is frozen at five moments in a recorded lab night, a
lossless screenshot is taken each time, and the video frame that best matches it is scored at each
stage of the pipeline (SSIM, 1 = identical):

| Recording | Browser recorder (WebM) | + ffmpeg, iteration 7 settings | + ffmpeg, new settings |
|---|---|---|---|
| 1280×720, 4 Mbps (**iteration 7**) | 0.957 | **0.937** | 0.954 |
| 1920×1080, 12 Mbps (**now**) | 0.972 | 0.951 | **0.968** |

On top of that, **resolution alone** costs 0.028 when a 720p picture is shown full-screen at
1080p: the lossless 1080p stills, scaled down to 720p and back up, score 0.972.

So your two guesses were both right, and one thing you didn't name was the biggest:

1. **The browser's realtime recorder at 4 Mbps** lost the most (0.043). It's tuned for speed,
   like a video call, and the game's blocky textures are the hardest thing to encode. You can see
   the grass's pixel texture smoothed away in `recordings/captest-720/crops/`.
2. **Resolution**: 720p on a 1080p or 1440p screen is scaled up 1.5–2× (0.028).
3. **ffmpeg** at `veryfast -crf 23` (0.020).

**Now:** the layout is still 1280×720, drawn at device pixel ratio 1.5, so the picture is 1920×1080
and the HUD looks the same as before. Capture is at 12 Mbps, and the final encode is x264
`slow -crf 18 -tune animation`, which costs 0.004 instead of 0.021. Recorded runs also flag it in
the report if the quality tier steps down, since that alone would blur the picture. The cost is
disk space: about 5 GB of WebM and 2.5–3 GB of MP4 per hour. `short.mjs` still cuts to 1280×720.
It's your script, so I left it alone; the input it cuts from is sharper now.

---

## 4. The pickaxe

- **Mesh** (`make_characters.py`, `items.glb`): a head that curves down into a long point on one
  side and a flaring chisel on the other, bright steel on the working end and along the top edge, a
  riveted collar, a leather grip with two bands, and a pommel cap. The sapper keeps the old
  one, renamed `crude_pickaxe`. The rebuild is byte-identical when run twice. `items.glb` grew
  from 8.3 to 10.2 KB gzipped; it's loaded after play starts.
- **In the hand**: turned so the curve of the head reads. The chop now winds up over the
  shoulder, drives down faster the closer it gets, stops dead with a small kick back, and
  recovers.
- **Each blow lands when you see it land**: the dig sound, chips and sparks used to run on their
  own 0.25 s timer, out of step with the 0.42 s chop. Now they fire as the chop passes its impact
  point.
- **Sparks** fly off stone, ore and metal from the face you hit (they used to start inside the
  block).
- Contact sheets: `recordings/showcase9/sheet-pickaxe.jpg` (eight points of the chop) and
  `sheet-sparks.jpg`.

---

## 5. Sound

### 5.1 What there is

Everything is still synthesised: no files, nothing added to the first load. Game code went from
343.4 to 351.8 KB brotli, of a 550 KB budget.

- **77 recipes** (`src/audio/sounds.js`), each built from 1–5 layers: filtered noise, tones,
  struck-metal rings, crackle (debris, splinters, creaks, sparks, rattles) and formant voices.
- **Every event has its own sound, tested** (`tests/sound.test.js`):
  - three sword swings, with the iron sword's second stroke pitched apart;
  - hits by what is hit: flesh, bone rattle, armour clank, shield knock, and a closer, duller hit
    when it's you;
  - a heavy thump under stone and iron blows;
  - three bow draws that creak for as long as the draw lasts, with the string released when you
    see it loosed, lower for each tier;
  - all six towers: the tier II/III towers used to fall back to the arrow sound;
  - projectile impacts by surface (they were silent);
  - dig, break, and attackers battering walls, by material, with ore ringing brighter than stone;
  - placing by material, a tower going up block by block, a rising ring for an upgrade (brighter
    for tier III), a patch with hammer taps, and a buzz for a refused build;
  - footsteps by surface, walking and running (`step()` existed and nothing called it), jumping
    and landing;
  - a hurt and a death voice per kind of unit;
  - an alarm bell when the Town Center is hit.
- **The mix** (`audio.js`):
  - effects, ambience and UI buses into a limiter;
  - a shared reverb, so distant sounds sit further back (off on the low tier);
  - a voice budget with priorities: yours first, then near ones;
  - per-sound limits, so a volley is a few twangs, not thirty;
  - effects and ambience volume sliders in the pause panel.
- **The bank** (`bank.js`): the 48 heavier recipes are pre-rendered after the game is playable, in
  idle time, and then play as a single buffer each. 3.9 MB, under the 4 MB budget, which is a test.
- **The night** (`ambience.js`) follows the siege, not a timer:
  - war drums that speed up and fill in as attackers get more numerous and closer, placed toward
    them;
  - war cries from the side they come from;
  - a low drone, wind, distant clashing steel from fights you're not in;
  - a heartbeat under everything when the town is under 25%;
  - crickets at dusk and on a quiet night, birds by day.

### 5.2 How it was checked without ears

- `tools/sound-check.mjs` renders every recipe in Chrome, measures its peak and its loudest 50 ms,
  and sets its level so each category lands on a target: a footstep −30 dB, a cannon −12 dB, and
  so on. The levels are in `src/audio/levels.json`, and **no sound peaks above −1 dBFS**. It also
  writes a WAV of every sound and a spectrogram sheet (`recordings/sound9/`). The sheet shows every
  family is distinct.
- A 90 s **night 8 clip with sound**: `recordings/night9-sound/game.mp4`. It measures −21.6 LUFS
  with a −6.3 dBFS true peak. Iteration 7's night in the recorded hour was −35.7 LUFS: 14 LU louder
  and far denser. The frame rate held at a median of 59.8 fps with 25 attackers.
- **The sound board**: open the game with `?soundboard`. Every sound has a play button, grouped by
  use. The night has sliders ("how bad", "town left") so you can hear the drums build.

**Please listen** to the clip and the board: whether it sounds good is yours to judge, and levels
and spectrograms can't tell me that. The weakest part will be the **voices** (war cries,
grunts), because synthesised voices never quite sound human. plan_9 §8.1 offers a small CC0 voice
pack loaded after play starts, if you want one.

---

## 6. Tiers in play (next_8 §4–5)

### 6.1 Bot, towns, tests, showcase

- **The bot buys tiers** (`bot/full.js`): every tower is the best of its family the stock pays for.
  Once the spots are taken, or iron and gold pile up (10 and 8), it upgrades standing towers in
  place, lowest tier and oldest first. It uses the new `skills.upgrade`, which holds the button for
  walls, and mines the cobble for it. `--strategy=towers` stays tier I, as the baseline.
- **Reports** gained the tier mix and iron, gold, cobble and planks at each dusk, upgrades per day,
  and failed builds by reason, so a rule that refuses builds shows up there instead of hiding in
  `no aim`.
- **Towns**: `t6-tier2` and `t7-tier3` spend t1-towers' tower value (378) on 17 crossbows and on 11
  ballistas. They cost the wave the same, so the map shows what a tier is worth per defence point.
- **Skill tests**, all passing: wall beside, wall on top, stack a higher tier, hold-upgrade, tower
  upgrade in place, and a click at the sky starting the motion that same frame.
- **The showcase** (`node tools/autoplay/showcase.mjs`, `recordings/showcase9/`): contact sheets for
  the pickaxe, swords and bows at set points of each motion, sparks on four materials, the
  third-person blade trail per tier, and every defence tier in a row from three sides.
- **Polish from next_8**: the iron sword's gleam between swings, the bow string shivering after the
  loose, the builder's blade trail in third person, and a one-off tip the first time an arrow
  glances off brute armour.

### 6.2 The difficulty map (`recordings/map-9a/map.md`)

| Town (same defence value for t1, t6, t7) | Holds through | Towers lost per night, nights 6–10 |
|---|---|---|
| default | night 4 (loses 6+) | — |
| t1-towers: 27 arrow towers | night 6 (loses 8+) | 12–20 of 27 |
| **t6-tier2: 17 crossbows** | **night 8**, split at 10 and 12 | 4–11 of 17 |
| **t7-tier3: 11 ballistas** | **night 10**, split at 12 | 1–6 of 11 |
| t2-mixed / t3-full | 10–12 / 8 | as in iteration 7 |

Tier II is worth about two nights over tier I at the same cost to the wave, and tier III about
four. The plan wanted tier III at least two nights better and tier II in between: **met**. The
tier I towns match iteration 7 cell for cell, so tiers didn't change tier I.

### 6.3 Full games, and the reason late nights didn't get harder

**The runs:**

| Game | Bot policy | Past-the-cap damage (below) | First night lost | Game over |
|---|---|---|---|---|
| idle (builds nothing) | — | no | **5** (target 5–6 ✓) | after 6 |
| towers only (tier I) | iteration 6 | no | **8** (target 8–9 ✓) | after 10 |
| full 1 | tiers, gold kept per open spot | no | none: **20 of 20** in 75 min | — |
| full 2 | gold and iron spent on troops and upgrades sooner | no | 9 | after 10 |
| full 4 | the same, gold reserve capped at 6 | yes | 9 | after 9 |
| full 5, 6 | back to full 1's policy | yes | 8, 7 | after 16, after 17 |
| **full 7, 8 (final)** | full 1's policy, and upgrades when rich | yes | **15, 15** (target 12–16 ✓) | not by 80 min, after 16 (target ≥ 14 ✓) |

(Game 3 was stopped: it had started on game 2's policy.)

What the runs taught:

1. **Why late nights stopped getting harder.** A night bigger than twice the device's attacker
   cap (140 on desktop) was cut to 140 bodies. The cut attackers' **health** was added to the
   survivors, but not their **damage**. From night 10 on, every night was 140 attackers that
   only got tankier: game 1 won 20 nights in a row, with the Town Center untouched for the last
   several. On a phone the cap is 56, so the effect started even earlier and **phones got easier
   late nights than desktops**. **Fixed** (`waves.js`, `units.js`): a folded attacker carries the
   damage of the ones it stands for as well as their health (`dmgMult`). A night past the cap
   keeps growing, and it's the same night on every device. Tested (`tests/game.test.js`). The
   capped-night map (`recordings/map-9b-dmg/`) shows towns being worn down at nights 12–14
   instead of holding at 100%.
2. **Troops cost more than they look.** Waves count troops at twice their value, so games 2 and 4,
   which spent the gold on troops (22–29 of them), drew nights full of raiders and brutes "for
   troops", built no cannons, and lost on night 9. The original policy (gold kept for tier III
   towers, iron kept for cannons) is the one kept.
3. **Tiers barely happen in a real game, and the reason is the economy.** Across the eight games
   the bot bought 2–3 crossbows and 2–6 mortars and bombards, and **never upgraded**, whatever the
   policy. Iron is what tiers need, and there's too little of it: the bot ends most days with 0–8
   iron. Gold, meanwhile, piles up unused: 20–36 by night 14, because a night won pays
   `1 + level/2` gold, more than troops and towers can take. Late in the game cobble runs out too.
   plan_8 §7.3's "under 5 iron and gold left at night 10" is **not met** for gold (10–15 left).
   This is a question for you (§8), not for the bot.
4. The walking share of the day is **47%** (iteration 7: 48%, target within 5 points ✓): the bot
   uses the Shift run.

---

## 7. Verified

- `npm run check`: 210 tests (was 193); types clean; all nine GLBs valid; `items.glb` rebuilds
  byte-identical.
- `npm run build`: every budget passes. Game code 351.8 KB of 550; player model 23.0 KB; 384 KB to
  the first playable frame.
- Skill tests 21/21; the wall tests 4/4 three runs in a row.
- The recording measurements, the sound checks and the showcase sheets above.

**Load benchmark**, now `--runs=5` (median of five loads, each in a fresh browser):

| Profile | Menu | First playable frame | Opening raid | Night benchmark |
|---|---|---|---|---|
| desktop | 0.11 s | **0.94 s** (0.89–1.04) | 60 fps, longest frame 33 ms | 59.9 fps, 70 attackers |
| mobile (4× CPU, touch) | 0.19 s | **1.51 s** (1.46–1.61) | 60 fps, longest frame 17 ms | 60 fps, 42 attackers (med tier) |

The spec is 2–3 s, with 4 s the maximum. The 2 s swing next_8 saw between single loads didn't
show up across ten loads here (the spread is 0.15 s), so it was the machine, not the code. The
median of five is what to quote from now on. The sound system adds nothing to the load: the bank
renders after play starts, and the frame rates above include it.

---

## 8. What to do next

1. **Decide the economy for tiers** (the one open design question). The map shows the tiers are
   worth their price: two nights for tier II and four for tier III at the same cost to the wave.
   But in a real game iron is too scarce to buy them, while gold piles up unused. Options:
   - (a) nights pay less gold and more iron (e.g. `level/3` gold, `level/2 + 1` iron);
   - (b) tier II and III recipes trade some iron for gold (gold is what the player has);
   - (c) an upgrade costs the difference from the tier below, not the whole recipe;
   - (d) more iron ore in the world.

   I'd try (a) with (c). Then rerun the map (it doesn't change) and the full games: the dusk
   tables will show whether tiers get bought.
2. **Listen** to `recordings/night9-sound/game.mp4` and `?soundboard`, and tell me what's wrong.
   Levels, recipes and the ambience are all data (`sounds.js`, `levels.json`, `ambience.js`), so
   changes are quick. Say if you want a small CC0 voice pack for the war cries (plan_9 §8.1).
3. **A recorded hour** on this build, if you want to watch and hear it: `npm run autoplay --
   --record`, about 1.5 h of wall clock and ~8 GB at 1080p. Then `short.mjs`. Consider moving the
   short to 1920×1080 too: its captions are laid out for 1280×720, so that's a change to your
   script, not mine to make.
4. Smaller things:
   - hold-to-upgrade from the aerial view on touch (a tap there only builds);
   - the bot upgrading walls (it only upgrades towers);
   - a sapper's charge doesn't grow with `dmgMult` (one charge per folded sapper).
