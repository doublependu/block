# itr_13: iteration 13 in brief

A summary of iteration 13 (`prompt_13.md` → `plan_13.md`, take 2, every default in its §10). The
details are in `next_13.md`; the section numbers below point there. Nothing is committed.

Everything the prompt and your addition asked for is done. `npm run check` passes (498 tests),
and so do the build budgets and load time on both profiles: first playable frame 0.97 s on
desktop and 1.51 s on mobile.

## Half underground (§2)

- A unit with its feet in a block is lifted at once; the dawn's rebuild moves anyone in the way
  beside the block (onto it if there's no room); and units sliding through terrain that isn't
  loaded follow its ground.
- A new check counts buried units on every tick. The game as it was: 8,517 unit-ticks buried, up
  to 3 blocks deep. Now: none, on three quality levels and two worlds.

## Weapons, first person against third (§3)

- First person is the reference, and a new test holds the body to it for every item and every
  model: at rest the item points within 22° (swords 1°), through the stroke within 24°.
- **One sword stroke** for wooden, stone, iron and the swordsman's: a forehand from high right to
  low left, and a backhand back, every second swing. A cut in both views, not a wave. The tiers
  differ in the blade, its trail, its sound and its hit.
- Bows are drawn by the other hand with the string coming back; the fire mage you play casts (it
  used to throw an error); the sapper's pick and the fist strike match their bodies.
- All nine models rebuilt, each about 22 KB compressed.

## The winners cheer (§4)

- After a lost night, in every mode, the attackers cheer at the Town Center for 4 s, then leave.

## Spikes and gates (§5)

- The crosshair lands on spikes and gates: they can be mined and come back to you, and the block
  behind them stays. Spikes have no top face.

## Fork me on GitHub, and the version (§6)

- A line at the foot of the menu and the pause panel; in the pause panel the version links to its
  commit.

## Inventory and hotbar (§7)

- The Build panel shows the hotbar row and the inventory under it. Tap an item, then where it
  goes; it works by touch, and the arrangement is saved.

## Next (§10)

- Attackers walk through walls in terrain that isn't loaded (plan §8): measure, then fix, in an
  iteration of its own.
