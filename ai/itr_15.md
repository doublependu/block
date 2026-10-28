# itr_15: iteration 15 in brief

A summary of iteration 15 (`prompt_15.md` → `plan_15.md`, every default in its §6). The details are
in `next_15.md`; the section numbers below point there. Nothing is committed.

Everything the prompt asked for is done. `npm run check` passes (545 tests), and so do the build
budgets. The room check passes, 75 of 75 with `--all`. Load time and frame rate match the last
commit's build: first playable frame about 1 s on desktop and 1.52 s on mobile. Nobody has played it
by hand yet.

## Playing together through p3p2 (§2, §3)

- The reference branch's design on today's game, with `@p3p2/client` from npm. *Play with friends…*
  in the menu, or 👥 in a game, opens p3p2's panel; a friend who opens the invite gets your world.
- Blocks, troops and the night are shared; the host's page runs the units and the night, the others
  draw them. What you carry, your hotbar and where you stood stay your own.
- Iterations 13 and 14 are met on a guest's page: the dawn's cheer and leaving are the host's, the
  fists are up, the hotbar comes back, friends hold the block they really hold.
- Beyond the reference: everybody's shots are seen, friends' builders swing, the night's events and
  their sounds reach guests, fireballs fly everywhere, names over friends' heads, a backgrounded tab
  isn't a target, quitting leaves the room, and a world too big for the server says so.

## Found on the way (§4)

- The menu froze the night for everybody, a guest simulated a placed troop twice, your own game wasn't
  saved before a room's world loaded, newcomers spawned inside each other, closed pages left ghost
  builders, and a guest counted fewer attackers than the host. All fixed. No opening raid in a room.

## The links (§5)

- "More games on Maize.Live" on the menu card, the loading screen and the pause panel.
- "Rooms come from p3p2.me" under every *Play with friends…*.

## Testing (§6, §7)

- `tools/autoplay/room-check.mjs` runs a p3p2 server on this machine and plays a host and two guests
  through building, a night, the host leaving, reloads, coming back and quitting; with `--all`, a
  slow connection that drops, Firefox against Chrome, a phone, and the numbers.
- From an invite link to playable on a phone: 2.33–2.73 s (the target was 3 s). A night with three
  players: 57–58 fps on every page, under 9.5 KB a second for anybody.

## Next (§8)

- Play a night by hand in two browsers: the check compares numbers, not how it looks.
- Then give friends' builders a body in the host's physics, so attackers stop at them.
- Then iteration 13's leftover: attackers walking through walls in unloaded terrain.
