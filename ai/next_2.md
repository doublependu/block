# Next 2 — implementation summary and what's next

Implements `ai/plan_2.md` (answering `ai/prompt_2.md`). Nothing is committed.

## What was built

**Issue 1: stuck as a defender by day** — fixed
- **Cause** (reproduced before planning): the Role button and the R key still worked during **dawn**. A role picked then carried into the day: no hotbar, no building, and the Role button was hidden.
- **Fix:**
  - `canChooseRole(phase)` (`cycle.js`) allows roles at dusk and night only. The role picker, choosing a role, clicking a unit in aerial view, touch taps and the Role button all check it.
  - `Control.returnToSelf()` runs at dawn and again at day start.
  - `Control.tick` has a safety check: from dawn on, a `possess` or `dead` mode goes straight back to the builder.
  - A delayed "wait for the next attacker" possession checks the phase again before it happens.
- **A way back at night:** "Fight as yourself" in the role picker, M / View toggles aerial view ↔ yourself, and clicking your builder in aerial view.
- The `build` mode is now `self`.

**Gameplay 1: attackers break walls and towers, never hop over**
- **Nav** (`navCore.js`): attackers never stand on a tower or on a built block resting on another built block (a wall top). The only way through a wall is breaking it.
- **The Town Center goal** comes from the 3×3 footprint in the world def, not from Town Center blocks, so pathing still works while the Town Center crumbles.
- **Gates** hold attackers back per unit (AI and possessed): an attacker that moves into a gate cell is put back on that axis and starts breaking the gate. Defenders and the builder still walk through.
- **Attacker jump** capped at about 1.1 blocks (`ATTACKER_JUMP`), including when you play as one.
- **Pushed onto a wall top anyway:** the attacker breaks down through it instead of dropping inside.
- **Default world:** a dry ditch outside the wall wherever the hills are higher than the plaza, and the wall foundations are now natural stone. The wall now stands 2 above the ground in front of it all the way round. `worlds/default.world.json` was regenerated (321 edits).
- **Siege:**
  - A third flow field in the nav worker leads to towers (head start 0), walls (+200, opening raid only) or the Town Center (+600).
  - *Wreckers* (brutes, sappers, 30% of grunts) follow it and only fight back against enemies within 2.5 blocks. They hit a tower in reach, else the stack holding a tower up, else a wall (`pickStructureTarget`).
  - After breaking a wall block they may widen the breach (`widenTarget`, 35% chance, 100% in the raid).
  - Brute hits also do 50% damage to the built blocks beside the target.
- **Collapse** (`siege.js`): at night, a built block with nothing under it falls. Wall blocks hold on to a solid side neighbour; towers need a block under them.

**Gameplay 2: the opening raid leaves the town in ruins**
- **The Town Center crumbles** as it loses hp: the crystal at 80%, then layer by layer. All 28 blocks are gone at 0 hp. It's night damage, so dawn rebuilds it.
- **Sapper powder kegs:**
  - A sapper that reaches a structure lights a keg (flashing, 2.5 s fuse, hiss) and goes up with it.
  - The blast demolishes built blocks within 2.5, hurts units of both sides within 3, and deals 400 to the Town Center within 5.
  - A sapper killed with a lit keg explodes too.
- **Demolition queue:** explosions, collapses and the crumbling Town Center are applied at most 8 blocks per tick.
- **Raid script** (`OpeningRaid` in `opening.js`, numbers in `OPENING_RAID`):
  - Groups from all four sides at 3 / 10 / 17 / 24 s.
  - Everyone wrecks towers and walls while the Town Center is locked.
  - The lock lifts when no towers are left and walls are down to 30%. A horn plays, a banner shows, and everyone pushes the Town Center.
  - Reinforcements go to the side with the most still standing.
- **Scripted finale at 110 s** if the town still stands: towers blow up one by one, wall stretches collapse down to 20–25%, then the Town Center goes in 5 steps.
- **Aftermath:**
  - The raiders stop and cheer, smoke rises from the Town Center and a few breaches, and the aerial camera circles the ruins for 6 s.
  - Then the result panel, and **dawn rebuilds at 60 blocks/s** (instead of 300) while the camera keeps circling.
  - At dawn the raiders leave (they vanish instead of dying).
- **Camera shake** for explosions within 40 blocks.

**Gameplay 3: the player fights at night**
- **Dusk:**
  - The builder is no longer benched at night: it stays visible, targetable and hurtable.
  - Dusk shows "Night N is coming — you'll fight as yourself" with a **Change role (R)** button, instead of opening the role picker.
  - Your best weapon slot is selected automatically.
- **Weapons** (`WEAPONS`, crafted in the Build panel):

  | Weapon | Recipe | Damage | Cooldown (s) | Range |
  |---|---|---|---|---|
  | Wooden sword | 4 planks | 16 | 0.45 | 2.4 |
  | Stone sword | 3 cobble, 1 planks | 24 | 0.45 | 2.4 |
  | Iron sword | 3 iron, 1 planks | 36 | 0.45 | 2.6 |
  | Bow | 3 planks, 1 log | 18 | 0.8 | 30 |
  | Musket | 4 iron, 2 gold | 60 | 1.4 | 40 |

  - Sword tiers reuse the `items.glb` sword mesh with a tint (`CharacterInstance.setItem(item, hold, tint)`).
  - At night you attack with the selected weapon, or your best one. By day swords still mine, and bows/muskets shoot.
  - Everyone starts with a wooden sword (`STARTING_INVENTORY` and the default world file).
  - The best weapon adds to the defence value the waves scale with.
- **Knocked out at night:**
  - The builder is down for 12 s (countdown on the HP chip) and gets up at the Town Center.
  - If you were controlling it, the camera goes to aerial view with the role picker, and comes back to your builder when it gets up (unless you picked something else meanwhile).
  - At dawn a downed builder gets up immediately.
- **Autopilot** (`_thinkHero`): whenever you watch or play another unit during a fight, your builder fights on its own with your best weapon.
  - Targets: attackers hitting the Town Center first, then ones wrecking structures, then the nearest within 10 blocks.
  - Stays within 16 blocks of the Town Center, deals 70% damage, and walks back to the plaza when idle.
  - The mode chip says "builder on autopilot"; the HP chip shows "Builder (autopilot) · weapon".
- **Role picker "You" section:** Fight as yourself / Watch from above.
- `docs/protocol.md`: each player's autopilot is simulated by their own client.

**Bugs found and fixed along the way**
- **Particle colors had never shown.** Every burst (blood, debris, sparks) rendered white since iteration 0: Babylon only compiles per-instance colors if the mesh has a thin instance when it first draws. Colored pools now keep one invisible instance.
- **Nights running to the 300 s cap.** Attackers spawned inside the western mountains or in cave pockets, and attackers in unloaded chunks slid straight through rock toward the Town Center. Now:
  - spawn points must be nav nodes with a path to the Town Center;
  - there's no sliding without a nav step;
  - an attacker that hasn't moved 2 blocks or damaged anything for 25 s starts again from its front.
- **A crash** when something was still targeting a unit that got removed without dying (this can happen when raiders vanish at dawn).
- Picking up a troop removed units from the unit list while iterating it.

## How it was verified

- **`npm run check`**: type check clean, **53 tests pass** (36 before, plus):
  - nav: 5 (no standing on wall/tower/gate tops, hill-side wall must be broken, Town Center goal survives the Town Center being removed, siege field → tower then Town Center, walls only in walls mode). The first two fail if the rule is disabled.
  - siege rules: 5 (barrier tops, collapse, ruin order and count, target picking, breach widening)
  - roles by phase: 1
  - weapons: 3
  - opening raid script: 3 (four sides, unlock rule, finale order)
- **`npm run build`**: budget passes. Game code 319.1 KB brotli (was 312.6), total to first playable frame 336.4 KB.
- **Issue 1** (scripted browser runs, 6 scenarios):
  - pick a role at dusk
  - click a defender in aerial view
  - possessed defender dies + close the picker
  - third person + Esc/Resume
  - **Role/R/chooseRole during dawn** (refused)
  - Fight as yourself + M at night

  At day start, every scenario is in `self` mode with builder inputs, `canEdit`, a visible hotbar, and a block actually mined.
  - Mining went through the touch fire button: this Playwright browser session refused pointer lock even for a plain `requestPointerLock` (`WrongDocumentError`). The mouse button path shares the same `firing` code but wasn't re-run with a real click this time.
- **Walls, night 1** (crossing log, default world, no player input):

  | | Before (itr 1) | After |
  |---|---|---|
  | Attackers inside before any block was destroyed | 11 (1 through a gate, 11 over hill-side walls) | **0** in 12 nights |
  | Attackers standing on a wall top / inside a gate cell | yes | **0 / 0** |
  | Blocks destroyed per night | 0 | 8–20, tower blocks in every night |

- **Playing as a grunt** holding W + Space against the north wall and the north gate: max jump 1.08 blocks, stopped at both.
- **Weapons** (crafted through the Build panel):
  - iron sword: 6 hits of 36 in 2.6 s, tinted sword in hand
  - bow: 4 hits of 18
  - autopilot with an iron sword killed a 180 hp grunt in under 6 s
- **Touch** (412×915): dusk banner → role picker; tap a defender → possess; Role → Fight as yourself; ⛏ swings at night; View toggles aerial ↔ self. No errors.
- **Opening raid** (default world, med tier, no input), 3 runs with final settings:

  | Run | Walls destroyed | Towers left | Town Center blocks left | Town Center unlocked | Town Center fell | Finale needed | Kegs | Longest frame |
  |---|---|---|---|---|---|---|---|---|
  | 1 | 87% | 0 | 0 | 77 s | 87 s | no | 6 | 25 ms |
  | 2 | 73% | 0 | 0 | 68 s | 81 s | no | 4 | 25 ms |
  | 3 | 75% | 0 | 0 | 70 s | 82 s | no | 4 | 38 ms |

  - Every run went aftermath → result → slow rebuild → Day 1 as yourself.
  - Forcing the finale at the start of a raid (before anything was damaged): towers 4 → 0, walls to 20%, Town Center gone, all within 14 s, then aftermath and dawn.
  - Two earlier runs, with the unlock at 40% of walls left: 75% and 65% destroyed, which is why the threshold went to 30%.
- **Night balance**, final settings (default world, med tier, builder on autopilot with the wooden sword, 3 runs each):

  | Night | Survived | Length | Blocks destroyed | Tower blocks destroyed | Lowest Town Center HP | Builder's share of kills |
  |---|---|---|---|---|---|---|
  | 1 | 3/3 | 82–97 s | 8–15 | 2–3 | 90–100% (hit in 1/3) | 29–57% |
  | 3 | 3/3 | 102–146 s | 6–17 | 2–3 | 96–100% (hit in 1/3) | 10–40% |

  - Night 3 **without the builder** (2 runs): Town Center down to 32% in one run, untouched in the other.
  - After the last rule changes, 2 more night 3 runs: survived in 122 and 180 s, Town Center at 96% and 99% at its lowest, no stuck respawns, no errors.
  - Tuning history:
    - Rules as planned: Town Center never hit, builder 27–53% of kills.
    - Autopilot at 70% damage, leash 16, aggro 10, `WAVE_BASE_BUDGET` 10 → 12: still never hit.
    - `WAVE_BASE_BUDGET` 14 and arrow tower damage 12 → 10: the numbers above.
- **Performance** (production build, Chrome, HTTP/2 + brotli, 10 Mbps, Intel RPL-P iGPU):

  | Profile | First playable frame | Opening raid (60 s) | Night benchmark |
  |---|---|---|---|
  | desktop | 0.69–1.48 s warm, 2.9–3.0 s cold | 59.0 fps avg (52.4 min), longest frame 50 ms, 0 over 50 ms | 55–57 fps, 70 attackers, high |
  | mobile (4× CPU), med | 1.30 s | 58.2 fps avg (57.7 min), longest 34 ms, 0 over 50 ms | 57.6 fps, 45 attackers |
  | mobile (4× CPU), low | 1.53 s | 58.3 fps avg (54.9 min), longest 34 ms, 0 over 50 ms | 58.5 fps, 28 attackers |

  - Desktop load varied a lot on this machine. Alternating runs of the old build (last commit, scratch worktree) and the new build in the same session gave warm 0.67–1.08 s vs 0.69–1.48 s, with no clear regression.
  - The nav worker's three fields take 55–93 ms per rebuild (desktop, dev build), off the main thread. The grid build is ~20 ms slower (goal scans).
  - `npm run perf` now also reports the opening raid (`--raid=<seconds>`).

## Where it differs from the plan

- **A ditch instead of raising the hill-side walls.** Taller walls stop the nav from ever breaching them, because the drop from the hill into the wall's ground cell is blocked by the wall blocks above. With a ditch every wall is 2 high from the ground in front of it, and the default town looks the same from inside.
- **Collapse keeps walls standing.** A wall block holds on to its neighbours; only towers and free-standing stacks fall. The plan expected walls to get weaker (and wall hp to go up), but neither was needed.
- **The builder on autopilot is weaker than planned:** 70% damage, aggro 10, leash 16 (plan: full damage, 14, 20). At full strength it took up to half of all kills with a wooden sword.
- **The Town Center lock lifts at 30% walls left** (plan: 40%).
- **Stuck attackers** (spawn check, no sliding, 25 s restart) weren't planned. They came out of the balance runs.
- **Balance targets missed:** the Town Center was hit in only 1 of 3 runs on nights 1 and 3 (plan: "some" on night 1, "clearly" on night 3). Nights are 82–146 s. The iron sword night 3 share (25–35%) wasn't run as a balance test.
- **Dawn after the raid keeps the aerial camera circling** until day, instead of returning to the builder at dawn (issue 1's rule still applies to `possess`/`dead`).
- The keg is a flashing box above the sapper's head (thin instances), not a barrel on its back.

## Known issues / limits

- **Nights 1–3 are on the easy side** for the default world. Attackers now stop at the walls, where towers, troops and the builder pick them off. `WAVE_BASE_BUDGET`, `TOWERS.arrow`, `HERO.autopilotDamage` and `SIEGE` are the knobs.
- **A wall only holds where it's 2 above the ground in front of it.** Player-built walls on a slope can still be walked over from the high side. There's no build hint for that.
- When the bottom block of a wall is destroyed, the block above it stays (held by its neighbours) until something hits it.
- Sapper kegs on regular nights (night 5+) and nights past 3 aren't balance-tested.
- The autopilot only uses local paths (~20 blocks). It won't find long detours around big structures.
- The opening raid knocks out the builder in most runs (it defends the Town Center to the end).
- HUD mode chip and hotbar update on the 100 ms HUD tick, so they lag a frame or two after a switch.
- Still **not tested on a real phone**; mobile numbers are CPU-throttled emulation.
- Unchanged from next_1: no unit HP bars, no music, entity shadow discs render through walls, the aerial camera gets pulled in behind hills.

## What to work on next (suggested order)

1. **Play it**: the opening raid, day 1 with a wooden sword, then nights 1–3, both as yourself and on autopilot. Tune the knobs above; nights should threaten the Town Center again.
2. **Siege readability**: cracks on damaged blocks, tower HP, a "breach!" marker, and HP bars over units. With walls holding, it matters more to see what's being wrecked.
3. **Build help for walls**: warn when a placed wall is less than 2 high from the ground outside, or offer a ditch tool.
4. **Armor and more weapon feel**: hit feedback, a musket reload, maybe armor as the next crafting tier.
5. **Real phone and older laptop test**, then tune `TIERS`.
6. Choice 2 from plan_2 is still open: ruins that stay into day 1 after the opening raid, if the rebuild at dawn feels too forgiving.
7. The rest of next_1's list: day-1 guidance, better placeholder art, a hand-built default world, multiplayer groundwork.
