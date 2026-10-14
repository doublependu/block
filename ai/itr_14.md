# itr_14: iteration 14 in brief

A summary of iteration 14 (`prompt_14.md` → `plan_14.md`, every default in its §8). The details are
in `next_14.md`; the section numbers below point there. Nothing is committed.

Everything the prompt asked for is done. `npm run check` passes (521 tests), and so do the build
budgets. Load time and frame rate match the last commit's build: first playable frame 0.94 s on
desktop and 1.50 s on mobile.

## First person is the body (§2)

- There's no separate first-person arm. Whoever you control is drawn by the camera: the same model,
  clips and item as from outside. Your builder, every troop and every attacker.
- It's seen from 1 m behind your eye (from the eye itself, the hand is below the screen). Only the
  forearms and hands are drawn, over the world, so they never go into a wall.
- The trail, the arrow on the string, the musket's flash, the iron glint and the chop's timing now
  belong to the body, so both views have them.
- A new test holds where everything lands on a desktop window and on a phone, sideways and upright.

## One slash (§3)

- Every sword swings one overhead slash: high over the right shoulder, edge first, down across the
  crosshair, low in front. The backhand and the combo are gone.

## Attackers you play break walls (§4)

- Their blow read the air in front of the wall, or kept its damage under a point no second blow would
  hit. That was there since iteration 0.
- Now the blow is the AI's own, multiplier, splash and alerts included. In the old game 2 of 10 wall
  tests broke the block; now 15 of 15.

## The old pickaxe chop (§5)

- The chop, the pick's pose and its rest hold are exactly as before iteration 13, in both views.

## Found on the way (§6)

- Troops and attackers never showed their hold pose: their arms hung whatever they held. The masks
  meant to stop that had been disabled since iteration 0. Fixed.

## Next (§8)

- Look at the slash and your arm in play.
- The old chop's raised head passes before your eyes once a chop: say whether to lower it.
- Then attackers walking through unloaded walls (iteration 13's leftover).
