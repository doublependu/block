# itr_16: iteration 16 in brief

A summary of iteration 16 (`prompt_16.md` → `plan_16.md`, every default in its §7). The details are
in `next_16.md`; the section numbers below point there. Nothing is committed.

Everything the prompt asked for is done. `npm run check` passes (552 tests), and so do the build
budgets. `touch-check` passes 23 of 23, `target-check` 165 of 165, and the room check 86 of 86 with
`--all`. Load time and frame rate match the last commit's build: first playable frame about 1 s on
desktop and 1.56 s on mobile, 60 fps in the night benchmark (§6). One raid of seven had a single
100 ms frame, and I can't explain it. Nobody has played it by hand yet, and no real phone has tried
the touch fix.

## Spikes and gates (§2)

- **Seen from one side:** noa didn't re-mesh the next chunk when spikes or a gate went onto a
  chunk's last row, so their face on that side was never drawn. It hit every spike and every gate,
  one row in 24. Fixed in `vendor/noa/src/lib/chunk.js`. That also fixes faces left behind after
  mining there, and old pictures after an upgrade there.
- **Hiding each other:** noa drew no face where two different see-through blocks met. It now draws
  both (`terrainMesher.js`).
- **Checked:** `target-check --only=faces` reads the meshes. 156 pass on today's build; 41 fail on
  the last commit's.

## Touch (§3)

- A finger was also a mouse button to noa, and that button is *fire*: every touch attacked, even
  on the joystick, and by day it picked up the troop under the crosshair. Touches no longer press
  key bindings. ⛏ attacks, as the controls say.
- **Checked:** `touch-check` (new) passes on today's build; 10 of its checks fail on the last
  commit's.

## Shirts (§4)

- Eight colours, the host in the builder's own blue. Each player wears the first colour nobody else
  wears, keeps it in the room, and gets it back. If someone who joined earlier has it, they keep
  it and the other player takes the next one.
- Drawn by repainting the shirt's blue in a copy of the body's material: no new draws, the model
  unchanged, and your own arms in your colour.

## Name tags (§5)

- 16 px bold (14 on a phone), ringed in the friend's shirt colour, and just over the health bar.
- Shown within 80 m on foot (40 before), and for every friend on the screen from above (almost
  never before).

## Next (§8)

- Play it by hand, and on a real phone.
- Then give friends' builders a body in the host's physics, and fix attackers walking through walls
  in terrain that isn't loaded.
