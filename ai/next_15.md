# next_15: where iteration 15 got to

Answers `ai/prompt_15.md`, following `ai/plan_15.md`. You didn't answer plan §6, so every default
there stands. Nothing is committed: it's all in the working tree, on `main`.

`npm run check` passes (545 tests, 22 of them new; types clean; all ten models valid), and so do the
build budgets. The room check passes, 75 of 75 with `--all` (§6.2). Load time and frame rate match
the last commit's build, measured side by side (§7).

**Look at these first** (all in `recordings/room15/`, which git ignores):

- `night-side-by-side.jpg`: a guest's night beside the host's, at the same moment
- `building-host.jpg`: the host's page while the guests build
- `menu-in-room.jpg`: the menu in a room, over a night that goes on
- `phone-390x844.jpg`, `phone-844x390.jpg`: the room panel on a phone, upright and on its side

**Nobody has played it by hand yet** (§8 says how).

---

## 1. The prompt, item by item

| Prompt | State |
|---|---|
| 1: multiplayer with `@p3p2/client` | **done** (§2, §3): the reference's design on today's game, with the client from npm and the gaps it left closed |
| 1: a link to p3p2.me | **done** (§5): "Rooms come from p3p2.me" by every way into the room panel |
| 1: test against a local p3p2 server | **done** (§6): `tools/autoplay/room-check.mjs` clones and runs one, and plays with three players |
| 2: "More games on Maize.Live" | **done** (§5): on the menu card, the loading screen and the pause panel |
| Found on the way | **fixed** (§4): eight things the reference got wrong or never met |

---

## 2. The port

- **The client:** `@p3p2/client@^0.1.1` from npm, in `package.json` and the lockfile. No vendored
  tarball. `vite.config.js` gets `optimizeDeps: { exclude: ['@p3p2/client'] }`, as the client's README
  asks, so the dev server doesn't send all of it on every visit.
- **From the reference** (`~/Repos/mine/public/p3p2_test_repos/block`, branch `p3p2`):
  - its patch, applied to today's code. Three hunks failed, as the plan found, and were redone by
    hand: `skipDawn`, the dawn's attackers, and the `Unit` constructor.
  - `src/net/room.js` and `tests/room.test.js`, copied and then changed
  - `src/net/replica.js`, rewritten from the reference's
  - `docs/protocol.md`, copied and brought up to date
- **The room code rides in the session chunk:** `session.js` re-exports `Net`. As a chunk of its own
  it split the game code into more files, which compressed worse.
- **What you'll see** is plan §1: *Play with friends…* in the menu, or 👥 during a game, opens
  p3p2's panel; paste a room URL and it gives you an invite link and a QR code; whoever opens it gets
  your world. Blocks, troops and the night are shared; what you carry stays your own.

## 3. What changed from the reference

### 3.1 Iterations 13 and 14 met (plan §3.1)

- **The dawn on a guest:** the winners' cheer, their leaving and their falling are left to the host
  (`u.remote` checks in `session.js`).
- **`_clearCell`** skips units another page moves.
- **Each player's room value carries the hotbar** (`ownThings` in `room.js`), as well as where they
  stood and what they carried.
- **One body setup:** `spawn` and `spawnRemote` share `_dress` in `units.js`, so a grunt's fists are
  up on a guest's page too (`hold_fists`).
- **Presence carries the held block's tile,** so friends hold the block they really hold.

### 3.2 The gaps a player would notice (plan §3.2)

1. **Everybody's shots are seen.**
   - Every shot now goes through `Effects.launch`, which calls `onLaunch`.
   - Each page sends its own player's shots (`fx`); the host also sends its units' and towers'.
   - The others draw them as `drawn` projectiles that hurt nothing (`_drawnHit` in `units.js`):
     what a shot hits is decided where it was fired.
2. **Friends' builders move their arms.** Presence carries an action counter (`HERO_ACTIONS`,
   `nextAct` in `replica.js`) and the held item's name, for the sounds (`Control.held.name`). A
   friend's sword, pick and bow swing on your screen as on theirs.
3. **The night's events reach guests, with their sounds,** through a new `ev` channel: blows, shots,
   a block struck, the Town Center hit, freezes, casts, tower shots, cracks, fireballs (`fb`), kegs
   (`boom`) and the wave banners. A guest's page plays them through the session's own handlers, so the
   sounds and alerts are the ones you'd hear alone. Helpers: `demolishNow`, `explosionFx` and
   `fireballFx` in `siege.js`.
4. **Fireballs fly on every page.** One whose owner is drawn from the host's reports hurts nothing
   (`onImpact` checks `owner.remote`); what it knocks down falls from the host's damage reports.
5. **Names over friends' heads,** within 40 m: an HTML chip in the HUD's markers layer (`hud.nameTag`,
   `.name-tag` in `hud.css`).
6. **A builder whose tab is in the background isn't a target** (the client's `member-state`), so a
   player who switches tabs doesn't come back dead.
7. **Quitting in a room leaves it.** The pause panel's quit says *Leave room & quit to menu*, leaves
   the room, then reloads to the menu (`session.js`, `this.net.leave()`).
8. **A world too big for one message isn't offered.** The player is told, and plays on alone (`fits`,
   `RoomSync.release` in `room.js`). The three worlds we ship all fit a server's default 64 KB (the ice
   palace is 40 KB).

### 3.3 As the reference has it (plan §3.3)

- **Only the host plays as a unit** (choice 2). A guest is told to fight as themselves, or watch.
- **A block appears when the server has it,** not on the click. On a home network that's at once.
- **Units on a guest's page** are drawn from 10 reports a second, smoothed (`@p3p2/client/smooth`).

## 4. Found on the way, beyond the plan

- **Opening the menu in a room froze the night for everybody:** the host's page paused. In a room the
  menu no longer pauses; it's titled *Menu*, not *Paused*.
- **A troop placed in a room was simulated twice on a guest's page.** `_spawnPlacement` now returns
  early unless this page leads.
- **The reference never saved your own game before loading a room's world,** because in a room
  `autosave()` writes only the room's value. `_cross` now calls the new `saveLocal()` first, so
  *Continue* is still your own game after a room.
- **No opening raid in a room.** A world started in a room has none, and a room opened during the
  raid skips to its dawn (`_bring`).
- **Newcomers spawned inside each other.** They now stand on a spiral by the Town Center
  (`newcomerSpot`).
- **Ghost builders:** your own previous page, or a page that had closed, was drawn. Members that are
  *lost*, or carry your own player id, aren't drawn any more.
- **A guest counted fewer attackers:** "Attackers: 8" against the host's 15, because it left out those
  still to come. The state report (`st`) now carries `coming`. The unit report (`un`) went to format 2,
  19 bytes a unit, with the wave front, so the edge markers group the same way on every page.
- **Skip at dawn on a guest** asks the host, and the host's skip reaches everybody (`skip` channel).

## 5. The links

- **`src/ui/fork.js`** makes both, next to `forkLine`: `moreGames()` ("More games on Maize.Live",
  `https://maize.live`) and `roomsLine()` ("Rooms come from p3p2.me", `https://p3p2.me`). The whole
  phrase is the link, and it opens a new tab, as the fork link does.
- **Where:**

  | | Maize.Live | p3p2.me |
  |---|---|---|
  | menu card | under the fork line | under *Play with friends…* |
  | loading screen | under the spinner, static in `index.html` | |
  | pause panel | under the fork line | a new *Friends* row, under *Play with friends…* (*Friends in this room…* when in one) |

- **What it costs:** a few hundred bytes of HTML; no request until clicked.
- **A test** checks that `index.html` carries exactly what `fork.js` makes, so the two can't drift.

## 6. Testing

### 6.1 Unit tests

22 new, all in `tests/room.test.js`: the reference's (`RoomSync` alone and in a room, a day cycle that
follows another) and new ones for the size check, the hotbar in each player's value, a newcomer's
spot, the action counter, what a presence holds, a friend's sounds and shots, and the links.

The dawn on a guest, a guest's shots going out and quitting in a room are checked in the browser by
the room check, not by unit tests.

### 6.2 The room check (`tools/autoplay/room-check.mjs`, new)

The whole of plan §5.3. It starts a p3p2 server from `.temp/p3p2` (cloning and installing it if it's
missing) on port 8091, serves `dist/` on the LAN on port 4198, and plays with players that are each a
browser profile of their own. It asks the pages what they hold (`window.game`,
`window.game.net.replica.list()`) and never judges a picture.

- **What it covers:**
  - alone: an ordinary visit asks the server nothing
  - a host and two guests on the same world, no opening raid, three builders apart
  - a guest's block, the host's dig, a tower as one op, troops in the same places within 0.23 m;
    each builder where its player stands, holding what it holds, swinging when it swings; names
  - the night: the same attackers, the same count and fronts, a wall down, cracks, a guest's blow and
    arrow, an attacker hurting a guest, a patch, a fireball and a keg seen and heard, a menu that
    doesn't stop the night, the lost night's cheer, a skip asked by a guest
  - the host leaving in the night, reloads of a guest and of the host, a newcomer and a returning
    player, quitting
  - `--lag`: 76 new edits that match through 150 ms each way and a cut connection
  - `--firefox`: Chrome and Firefox build the same land at 3,000 places, and the same town
  - `--phone`: in by the link; the panel fits upright and sideways; chat arrives
  - `--measure`: the numbers in §7
  - `--all` does all four flags
- **The last full run** (`--all`, today, on a fresh build): 75 of 75 passed. Its output is in
  `.temp/p15/room-check-all.log`.
  - The run before it failed one check of 74: the phone's invite timing, 3.20 s, measured while the
    other players' game pages were still open in the same browser. The timing now uses a fresh
    browser with nothing else open; it read 2.33 s on its own, then 2.73 s in this run.
- **Also:** `tools/serve-dist.mjs` got a `plain` option (HTTP on the LAN, gzip), and `vite.config.js`
  limits vitest to `tests/`, so it doesn't pick up p3p2's own tests under `.temp/`.
- **Playwright's Firefox** was downloaded to `~/.cache/ms-playwright/firefox-1543` (choice 6).

## 7. Load and frame rate (spec)

The last commit's build against today's, side by side (`tools/perf/load-test.mjs --headless`, the
last commit's build in `.temp/p15/head`):

| | last commit | now |
|---|---|---|
| desktop: menu interactive (median) | 0.11 s | 0.11 s |
| desktop: first playable frame, three pairs (medians of 5, 5 and 9) | 1.15 / 0.95 / 0.92 s | 0.94 / 1.05 / 0.98 s |
| mobile (4× CPU): first playable frame (median of 5) | 1.50 s | 1.52 s |
| the opening raid / the night benchmark | 60 / 60 fps | 60 / 60 fps (the screen's cap) |

- **The first playable frame** goes both ways between the pairs, by less than one load swings on this
  machine (the load test's own note: up to 2 s). Either way it's far inside the spec's 2.5 s.
- One load of today's build timed out at 30 s once, the first of a run. It didn't happen again in the
  20 loads after. Unexplained.
- **Budgets:** the menu 6.2 → 7.9 KB of 30, the game code 353.2 → 361.3 KB of 550, both built the
  same way, outside the repo (`.temp/p15/head` and `.temp/p15/now2`). Built in place, as
  `npm run build` does, today's reads 8.0 and 370.2 KB, against iteration 14's 361.7: the same 8 KB
  more.
  - The first load gets the client's 1.9 KB entry. The rest of it (the room client and the 👥 panel,
    14 KB) loads only when a room is opened.
- **From an invite link to playable,** on the load test's phone profile, the room's server on this
  network: median of 5 is 2.73 s (1.97–2.91), of which 1.47 s after *Join*, in the `--all` run; 2.33 s
  (1.96–3.03) with `--measure` alone. The target was under 3 s.
- **A night with three players and 46 attackers,** all on this machine: 58, 57 and 58 fps. The host
  sends 30 messages and 8.9 KB a second; each guest gets 9.4 KB and sends almost nothing.

## 8. For you, and what's next

- **Play it by hand.** Two browsers side by side is how to judge whether a guest's night reads as a
  fight; the room check only compares numbers.
  1. A server: in `.temp/p3p2`, `P3P2_OWNER_PASSWORD=<any> npm run dev` (port 8080; it needs Node 24,
     which is what's installed).
  2. The game: `npm run dev` here (it listens on the LAN).
  3. A room: open the server's address, log in with that password, and make a room for the game's LAN
     address (`http://192.168.1.132:5173/`), never `localhost`: p3p2 only takes invites on the address
     its room was made for.
  4. In the game, *Play with friends…*, paste the room URL, and open the invite in another browser or
     a private window: two tabs of one browser are one player.
  Also in `docs/protocol.md`, under "Testing it".
- **Not shared yet** (also in `docs/protocol.md`):
  - a friend's chop sound and footsteps
  - the shot of a unit the host plays
  - friends' builders have no body in the host's physics, so attackers walk through them
- **Only the host can play as a unit** (choice 2). Letting guests do it means sending their input to
  the host, a round trip late, and it's a much bigger job.
- **The line reads "Rooms come from p3p2.me"** (the plan's words). "No room? Get one at p3p2.me" might
  say it better: one string in `fork.js`, and the same in `index.html` (the test holds them together).
- **What I'd do next:** play a night by hand with two browsers, then give friends' builders a body in
  the host's physics, so attackers stop at them. After that, iteration 13's leftover: attackers walk
  through walls in terrain that isn't loaded.

## 9. Changes by file

- **New:** `src/net/room.js`, `src/net/replica.js`, `tests/room.test.js`,
  `tools/autoplay/room-check.mjs`
- **The port and §3:** `src/boot/main.js` (one `P3P2`, `p3p2.start()`, *Play with friends…*),
  `session.js`, `units.js` (`spawnRemote`, `_dress`, `_drawnHit`), `cycle.js` (`DayCycle.follow`),
  `effects.js` (`launch`, `onLaunch`), `siege.js` (`demolishNow`, `explosionFx`, `fireballFx`),
  `waves.js` (`coming`, the fronts of the host's attackers), `control.js` (`held.name`), `hud.js`
  (👥, the *Friends* row, `nameTag`, the menu in a room), `hud.css`, `index.html`
- **The links:** `src/ui/fork.js`, `hud.js`, `boot/main.js`, `index.html`
- **The client:** `package.json`, `package-lock.json`, `vite.config.js`
- **Tools:** `tools/serve-dist.mjs` (`plain`), `tools/autoplay/room-check.mjs`
- **Docs:** `docs/protocol.md` (the p3p2 server, the channels, testing it), `README.md` (the intro, the
  👥 control, the room check, the `src/net` line)
- **Scratch, git-ignored:** `.temp/p15/` (the explore, quit and debug scripts, the builds, the room
  check's output), `.temp/p3p2` (the server checkout the room check uses), `.temp/p3p2-data` (the
  hand-run server's data)
