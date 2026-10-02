# itr_12: iteration 12 in brief

A summary of iteration 12 (`prompt_12.md` → `plan_12.md`, take 3). The details are in
`next_12.md`; the section numbers below point there.

Everything the prompt asked for is done. The video and the world export exist, but the palace is
**not "very safe"**: the recorded game lost 25 of its 41 nights. `npm run check` passes (362
tests) and every build budget passes. Parts 1 and 2 are in your commit `a137ac6`; part 3 (the
recording, the game that carries on from where it stopped, one fix in the game) is not committed.

## The version tag (§2)

- `v.` and the first four characters of the deployed commit, bottom right, on the menu and in the
  game (`v.a137` in the video).
- Checked against the HUD on a desktop window and a phone, upright and sideways.
- Fixed on the way: on a phone held sideways the hotbar covered the health chip.

## The fire mage (§3)

- A new attacker from night 7. It winds up for 1.2 s and lobs a fireball that blows out every
  block within 1.7 (built or natural) and melts ice within 2.5. Dawn rebuilds it.
- The fireball is dp-sakura-crossing's Cinder Fall, ported as its choreography and numbers.
- A target 14 or more above it is out of its reach, so towers up high are safe from it.

## The ice arrow and freezing (§4)

- A frozen attacker can't move, strike or cast for 2 s, then can't be frozen for 3 s. It takes
  ×1.5 from every blow. Defenders and the builder are never frozen.
- The frost bow and the frost tower shoot ice arrows.

## Ice blocks (§5)

- Snow brick, blue ice, clear ice and ice spikes. An attacker that stands on one, presses against
  one or strikes one is frozen, exactly as by an ice arrow.

## From the chat (§6, §7)

- **Unlimited lives**, a choice when you start a world: a lost night never ends the game.
- **Late nights** grow more slowly past night 12. Night 17 now holds for iteration 10's castle;
  night 20 still doesn't.
- **Archers hold high posts:** a ranged defender placed 3 or more above the ground stays put.

## A game that carries on from where it stopped (§12.3)

- `tools/autoplay/long-run.mjs` plays a long game in parts. Every dawn it saves the game and what
  the bot has to remember. When a part ends early (the page dies, the laptop sleeps, you stop it),
  the next one continues from the newest dawn. Running the same command again carries on.
- `--status` shows the nights, the days and the build; `touch <dir>/STOP` stops it cleanly.
- The recorded game used it 15 times: once as a test (I killed the browser mid-day), the rest to
  load fixes to the bot at a dawn, or by itself every 55 minutes.

## One fix in the game (§12.1)

- Pointer lock could arrive just after you switched to the aerial view. With it held, a right
  click built twice. A lock that arrives in the aerial view is now given straight back
  (`src/game/control.js`). This is what broke the runs before this one.

## The video: `recordings/palace12/palace.mp4` (§12.7–12.9)

- 30:07 at 1920×1080 with 130 chapters (4.5 GB). `palace-share.mp4` is a 1.8 GB copy for sharing.
- **One survival game, 42 days, 7 h 04 min of play,** on a Large world from seed
  `ice-palace-3618`, with unlimited lives. It shows the opening raid, the floor dug out and laid
  white, the curtain, the hall, the corner towers, the double curved staircase built step by
  step, level 2 and its archers, the roof and spires, all 41 nights, the export, a walk through
  the finished palace and a turn round it from above.
- **The palace:** 6,592 blocks placed, on two levels 12 clear each, with a white floor round the
  plaza. 26 towers (12 ballistas; 10 of the towers are 30 or more up), 17 troops, and every wall,
  gate, spike and ice block the game has.
- **Nights: 16 won, 25 lost.** Every night from 1 to 16 was held in the end, but nights 9, 10
  and 11 took 5, 8 and 9 tries. Each lost night is shown and captioned.
- **Why:** fire mages blew up every tower on the ground, night after night, and brutes then took
  the Town Center. The attack also grows with the defence.
- **What the design had wrong, found by playing it:**
  - the six towers meant to be out of the mages' reach had no block under them and could never
    have been placed (fixed: 8 on the balconies now, 2 on the roof)
  - the gates were last in the build order, so the curtain had four open gateways until I moved
    them up (day 11)
  - the plan's iron came from night wins that didn't happen; the quarry now digs for ore
- **Missing from the finished palace:** 7 of the 14 archers (the block over their openings never
  went in, and the bot waited for it), 14 blocks over the arch under the landing, and a few
  blocks in three spires. About 100 more cells are open but shut inside other blocks.
- **Views:** of the building on screen, 66% is from above, 19% third person, 15% first person
  (the plan asked for a fifth each).
- **Speeds:** building at 33× (first person 19×), nights 22×, mining and walking 111×.

## The export: `recordings/palace12/ice-palace.world.json` (§12.10)

- Written by the game's own Export world, on day 41, before the last night.
- 10,974 edits (6,592 placed, 4,382 dug), 17 troops, and the builder's pack as the starting kit.
  No game state. 15.8 KB compressed, against the 50 KB budget.
- As the starting point, in a scratch copy of the game:
  - first playable frame in 1.02 s on desktop and 1.41 s on mobile
  - 60 fps on desktop everywhere measured; on mobile 60 fps in the hall and from the air, 59 in
    the opening raid (three frames over 50 ms), 54 in a night on the medium quality tier
  - the opening raid was held in 176 s without touching the Town Center
- **Your branch needs:**
  1. Copy the file over `worlds/default.world.json`.
  2. In `tests/worldfile.test.js`, delete the two tests about the old default world.

## Decisions for you (§12.11)

- **Late nights and frost.** The palace doesn't hold its nights, and ice makes it worse: it draws
  fire mages, and they undo every tower they can reach. Options are in §12.11.
- **The 7 missing archers and the gaps.** The game can be carried on from its last save to put
  them in, and the video's ending re-cut. Say if you want that.
- **The source recordings** take 87 GB (`recordings/palace12-test2/`). The `game.webm` files
  (44 GB) can go once you're happy with the cut; the earlier runs (`palace12-rec1` to `rec5`,
  `palace12-test1`) are another 12 GB.
