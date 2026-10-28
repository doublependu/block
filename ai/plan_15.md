# Plan 15: playing together through p3p2, and links to p3p2.me and Maize.Live

Answers `ai/prompt_15.md`. Nothing below is implemented yet.

The prompt has two items. Item 1 is mostly built already, on the reference branch, but against the
game as it was before iterations 13 and 14 and with a client that came from a tarball. So item 1 is
a port onto today's game, using the published client, plus the gaps the reference left (§0.1). Item
2 is a few lines of markup. In brief:

| Prompt | What I found | What I'll do |
|---|---|---|
| 1: multiplayer with `@p3p2/client` | The reference (`~/Repos/mine/public/p3p2_test_repos/block`, branch `p3p2`) is a whole design that runs: friends build one town together and the night attacks all of them. It's built on the code from before iteration 13, and nobody has looked at it in a browser (§0.1) | Bring it onto today's code, with the client from npm (§1, §2). Close the gaps a player would notice (§3) |
| 1: a link to p3p2.me | The 👥 panel asks for a room URL and doesn't say where to get one. p3p2.me does: it explains rooms and can make a temporary one (§0.5) | Put a line by every way into the panel: "Rooms come from p3p2.me" (§4) |
| 1: test against a local server | The reference's browser tests live in a private p3p2 repo. The public one has no tests for block (§0.1) | A room check in block itself, against a p3p2 server cloned from GitHub and run on this machine (§5) |
| 2: "More games on Maize.Live" | Neither link exists. The menu card and the pause panel already end with the fork line (`src/ui/fork.js`) | One more line under the fork line: on the menu, on the loading screen, and in the pause panel (§4) |

---

## 0. What I found before planning

I read the reference branch, the published client, and p3p2's docs on GitHub. I measured world
sizes and the build budget, and ran the reference's patch dry against today's files. I didn't run
anything in a browser. No game code changed. HEAD is `b0122a9`.

### 0.1 The reference branch

- **9 commits on top of `24854d2`** ("plan 13, take 1"), 2026-10-11 to 10-13. Its own notes are
  `ai/p3p2_plan.md` and `ai/p3p2_next.md` on that branch.
- **Two new files:**
  - `src/net/room.js` (319 lines): which world a room holds, the edits through the room's log
    (`RoomSync`), and what the room keeps for each player
  - `src/net/replica.js` (506 lines): the host simulates the night and reports it; everybody else
    draws it
- **Changes to** `session.js`, `units.js`, `cycle.js`, `boot/main.js`, `hud.js`, `index.html` and
  `vite.config.js`. Also `tests/room.test.js` (new) and `docs/protocol.md` (rewritten for a server
  that exists).
- **The client** was `vendor/p3p2-client.tar.gz`, version 0.0.0.
- **Its notes say** 9 new unit tests and 7 browser tests. The browser tests are in p3p2's private
  repo (`e2e/tests/games/block.spec.ts`), which isn't on this machine. Also: "No test looked at a
  picture", and "You have not looked at any of it".
- **What it left open** (its §5):
  - a guest's night is drawn from the host's reports, and nobody has seen how that looks
  - only the host can play as a unit
  - guests don't see fireballs
  - other players' shots and blows make no sound
  - no names over other players' heads

### 0.2 The client on npm

- **`@p3p2/client@0.1.1`**, published 2026-10-16. MIT, no dependencies.
- **Same calls as the tarball.** Every call the reference makes is there under the same name.
- **New since the tarball:**
  - `member-state`: a member is `here`, `away` (its tab is in the background) or `lost`
  - `sendEach`, `room.now()`, `P3P2.local()`
- **What it weighs** (gzip, measured from the package):

  | Part | Size | When |
  |---|---|---|
  | `@p3p2/client` | 1.9 KB | every visit; an ordinary visit contacts no server |
  | the room client + the 👥 panel | 8.9 + 5.3 KB | when a room is opened |
  | `/smooth`, `/pack` | 1.4, 0.5 KB | with the game code |

- **The menu costs 6.0 KB of its 30 KB budget today.** The first load gets 1.9 KB heavier, and that's
  all it gets.

### 0.3 What iterations 13 and 14 changed under the reference

| Today's game | What it means in a room |
|---|---|
| After a lost night the winners cheer, then leave (`attackersAtDawn`, `_winners`, `_attackersLeave`) | On a guest those attackers are the host's. Today's dawn code would kill or remove them on the guest's own page |
| The dawn's rebuild moves anyone standing in a returning block (`_clearCell`) | It would move units that another page moves |
| The hotbar is saved (`player.hotbar`, plan 13 §7.4) | What the room keeps for each player has no hotbar |
| Fist fighters hold `hold_fists` (`units.js:238`), and hold poses now reach the arms (iteration 14 §6) | The reference's copies of the host's units skip that setup, so grunts' arms would hang |
| A block in your hand has its texture (`setItem(…, tile)`) | Presence doesn't carry the tile, so friends would hold a blank block |
| Your bow looses when its draw does, and leaves a streak (iteration 14 §10) | The reference sends only the host's shots. A guest's arrows hit, but nobody else sees them |
| First person shows your own body (`setFirstPerson`) | That's only your own body. Friends are drawn whole, in the world, as today's troops are. Nothing to change |
| An attacker you play breaks walls (`strikeBlock`) | Only the host plays a unit, so that's the host's game, as alone |

**Most of the reference's edits still apply.** I ran its patch dry against today's files:

- **Three hunks fail,** each in a place iterations 13 and 14 rewrote:
  - `skipDawn`, which now also ends the winners' cheer
  - the dawn handler's attackers loop, which is now `attackersAtDawn`
  - the `Unit` constructor in `units.js`
- **The rest apply,** some a few lines off where they were. They still need reading against the
  table above.

### 0.4 A world has to fit one message

- **The size limit:** a room keeps its world as one value. By default a server takes at most 64 KB
  for one (`P3P2_MAX_FRAME_BYTES`), and the log can grow to 1 MB.
- **The worlds we ship,** packed the way the client packs (deflate, then base64):

  | World | Edits | Packed |
  |---|---|---|
  | default | 840 | 3.7 KB |
  | castle neu | 6,446 | 22.7 KB |
  | ice palace | 10,974 | 40.1 KB |

- All three fit. The ice palace has 24 KB to spare.
- **A bigger world fails without a word:** the reference never checks the size, so a world built
  past the limit just doesn't arrive.

### 0.5 Quitting, the links, and the "loading page"

- **"Save & quit to menu" doesn't work in a room.** It reloads the page, and a reloaded page goes back
  into its room by itself. In a room it would bring you straight back into the game. The reference
  didn't change it (its panel's *Leave* works).
- **p3p2.me** is p3p2's own site. It explains rooms, and it has "No server? Make a temporary one".
  That's the missing step for a player who presses 👥 and is asked for a room URL.
- **Maize.Live** is the site of free web games ("free web games, no login").
- **Two screens could be the "loading page":**
  - the menu, which shows first, after 0.12 s
  - the loading screen, the spinner after Play: "Building world…". It shows about 1 s, longer on a
    phone, and longer again for a room's world, "Fetching the room's world…".
  - I'll put the link on both (choice 1, §6).

---

## 1. Multiplayer: what it is

I keep the reference's design. In short:

| What | Alone (today) | In a room |
|---|---|---|
| The world and the game in it (seed, edits, troops, day, night, lives) | the world file, then the browser's save | one value kept by the room. Whoever brings a world first sets it. Then every change goes through the room's log |
| Blocks placed and dug, troops placed and picked up | ops through `LocalSync` | the same ops, through the room's log (`RoomSync`), in one order for everybody |
| Units, fights, night damage, the phase of the day | this page | the host's page. The others draw what it reports |
| Your builder | this page | still yours. The others draw it from your presence |
| What you carry, your hotbar, where you stand | the browser's save | one value per player, kept by the room |

**What you'll see:**

- **Inviting someone:**
  - *Play with friends…* in the menu, or 👥 during a game (top right), opens p3p2's panel.
  - Paste a room URL, and the panel gives you an invite link and a QR code.
  - Whoever opens the link is asked *Join?* and gets your world, with every block you've placed.
- **Building together:**
  - a block anybody places or digs is there for everybody
  - the town's troops stand and wander the same on every screen
  - what you carry stays your own: leave, come back next week, and you have what you had, where you
    stood
- **The night:**
  - N on a guest's page asks the host to start it
  - everybody fights the same attackers, and the same walls go down
  - a guest fights as their own builder, watches from above, or patches holes
- **When the host leaves:** the next player takes over the units where they stand, after about five
  seconds. No further wave comes that night.
- **No opening raid in a room.**
- **Leaving** goes back to the menu. *Continue* there is still your own game, untouched.

---

## 2. The port

- **The client from npm:**
  - `npm install @p3p2/client` gives `^0.1.1` in `package.json`. No `vendor/` tarball.
  - `vite.config.js` gets `optimizeDeps: { exclude: ['@p3p2/client'] }`, which the client's README
    asks for. Without it the dev server sends all of it on every visit.
- **`src/boot/main.js`:**
  - one `P3P2` with game id `block` and version the first 12 characters of the commit, so two
    different builds never share a room. It uses no button of its own (`button: false`), because
    every corner of the HUD is taken.
  - `p3p2.start()`: if a reloaded page or an invite lands in a room that has a world, it goes
    straight into that world (`launch({ kind: 'room' })`), with "Fetching the room's world…" on the
    loading screen
  - *Play with friends…* in the menu calls `p3p2.open()`
- **`src/net/room.js` and `src/net/replica.js`:** from the reference, with the changes in §3.
- **`session.js`, `units.js`, `cycle.js`, `hud.js`, `index.html`:** the reference's edits, made again
  on today's code:
  - the session's `net`: the room, or a stand-in when alone. The tools and the autoplay bots build
    sessions without one and get the stand-in.
  - `DayCycle.follow`, so a guest's day goes through the host's phases
  - `UnitManager.spawnRemote`, for a unit another page decides
  - the host-only parts of `tick`
  - the 👥 button in the HUD's corner
- **`tests/room.test.js`:** the reference's 9 tests, plus the new ones in §3 and §4.
- **`docs/protocol.md`:** the reference's rewrite, which describes the p3p2 server, brought up to date.

---

## 3. What I'll change from the reference

### 3.1 Meeting iterations 13 and 14 (§0.3)

- **The dawn on a guest:** the winners' cheer, the leaving and the falling are for units this page
  decides. The host's units cheer, leave and fall because the host's reports say so. One that
  vanishes from the reports at dawn while still alive leaves in a puff of dust, as it does alone.
- **`_clearCell`** skips units another page moves.
- **Each player's value carries the hotbar** as well as the position and inventory. A newcomer gets
  the world's starting kit, as in the reference.
- **One setup for every unit body.** `spawn` and `spawnRemote` set up a body the same way: the item,
  `hold_fists`, the size. The copy is then held the way the original is.
- **Presence carries the held block's tile,** so friends hold the block they really hold.

### 3.2 Gaps a player would notice

1. **Everyone's shots are seen.**
   - Today only the host reports shots.
   - Each page will report its own player's shots, and the host also reports its units' and towers'.
   - Everybody else draws them, harmless: what a shot hits is decided where it was fired. A guest's
     shot that hits a unit is sent to the host as a hit (the reference's `hit`).
2. **Friends' builders move their arms.**
   - Today they only walk.
   - Presence will carry a counter of the builder's last action (swing, chop, place, draw, loose), as
     the host's report already does for units.
   - Then a friend's sword, pickaxe and bow move on your screen as on theirs. That's 1 byte more,
     sent only when something changes.
3. **Shots and blows make their sounds** on every page, from where they happen (choice 3). Today they
   play only on the host's page.
4. **Fireballs are drawn for guests,** harmless (choice 3). What one knocks down already falls, from
   the host's damage reports.
5. **Friends' names over their heads** (choice 4): a small chip for friends within 40 m. It's an HTML
   label in the HUD's markers layer, the way the dawn's rebuild pin is drawn, so no new textures.
6. **Attackers leave a friend alone while the friend's tab is away,** via the client's new
   `member-state`. Today the host's attackers keep hitting a builder whose player switched tabs, and
   that player comes back dead.
7. **Quitting in a room leaves it** (choice 5). In a room the pause panel's button reads *Leave room &
   quit to menu*. It leaves the room, then reloads to the menu, which works because the room is no
   longer there to rejoin.
8. **A world that's too big says so.** Before offering a world, its packed size is checked against
   `room.limits.maxFrameBytes`. If it doesn't fit: "This world is too big for this room's server",
   and you keep playing alone.

### 3.3 What stays as the reference has it

- **Only the host plays as a unit** (choice 2). A guest gets: "Only the host can play as a unit.
  Fight as yourself, or watch."
- **A block appears when the server has it,** not on the click. On a home network that's immediate.
  Alone, it's immediate as today.
- **Units on a guest's screen** are drawn from 10 reports a second, smoothed (`@p3p2/client/smooth`).
  They play *attack*, *shoot*, *cast*, *mine* and *hit* when the host's do.

---

## 4. The links (prompt 1's p3p2.me, and item 2)

- **"More games on Maize.Live"** links to `https://maize.live`. Where:
  - the menu card: a line under the fork line
  - the loading screen: under the spinner's text
  - the pause panel: under the fork line
- **"Rooms come from p3p2.me"** links to `https://p3p2.me`. It's a small line next to every way into
  the panel:
  - the menu: under *Play with friends…*
  - the pause panel: a new *Friends* row, with *Play with friends…* (or *Leave room* when in one)
    and the line under it
  - the 👥 button opens the panel directly, as in the reference: the pause panel is one tap away
- **How they look:**
  - small and quiet, like the fork line's second line
  - the whole phrase is the link, so the tap target is the size of the fork link's (32 px tall)
  - each opens a new tab, as the fork link does, so a game in progress isn't lost
- **What it costs:** a few hundred bytes of HTML. No image, no font, no request until clicked.
- **Code:** the markup goes in `src/ui/fork.js` next to `forkLine`, as pure functions (`moreGames()`,
  `roomsLine()`), with tests in `tests/version.test.js` beside the fork line's.
  - The loading screen's line is in `index.html` itself, so it's there before any script runs.

```
Menu card                                Pause panel
┌──────────────────────────────┐         ┌──────────────────────────────┐
│ Block Defence                │         │ Paused                    ✕  │
│ [ Play                     ] │         │ [Resume] [Export] [Controls] │
│ [ Continue — …             ] │         │ [Save & quit to menu]        │
│ [ New world from seed…     ] │         │ Friends                      │
│ [ Load a world…            ] │         │ [Play with friends…]         │
│ [ Play with friends…       ] │         │ Rooms come from p3p2.me      │
│   Rooms come from p3p2.me    │         │ Settings …                   │
│ ──────────────────────────── │         │ World …                      │
│     Fork me on GitHub        │         │ ──────────────────────────── │
│  open source, GPL-3.0        │         │     Fork me on GitHub        │
│  More games on Maize.Live    │         │  open source, GPL-3.0 · v.…  │
└──────────────────────────────┘         │  More games on Maize.Live    │
                                         └──────────────────────────────┘
```

---

## 5. Testing

### 5.1 Unit tests (`npm run check`)

- the reference's: `RoomSync` alone and in a room, and a day cycle that follows another
- new:
  - the dawn on a guest leaves the host's units to the host
  - each player's value carries the hotbar
  - the presence action counter (§3.2 item 2)
  - a guest's shots go out
  - quitting in a room leaves it
  - the size check
  - the links' markup

### 5.2 A p3p2 server on this machine

- **Clone and start it:** `github.com/doublependu/p3p2` into `.temp/p3p2` (git ignores `.temp`), then
  `npm install && npm run build && npm run dev`. It runs on port 8080, with `P3P2_OWNER_PASSWORD` set
  and its data in `.temp/p3p2-data`. It needs Node 24, which is what's installed.
- **The game:** `vite --host`, at this machine's LAN address (192.168.1.132:5173), never `localhost`.
  A room is made for that address, and p3p2 only accepts invites on the address its room was made
  for.
- **To see it yourself:** the same two commands, then follow §1. Use another browser, or a private
  window, for the second player: two tabs of one browser count as one player. That goes in
  `next_15.md`.

### 5.3 A room check in the game (`tools/autoplay/room-check.mjs`, new)

It uses Chrome through `playwright-core`, as `possess-check` does. Each player is a browser context
of its own. It makes the room in the portal, as p3p2's own tests do.

| p3p2's "before you call it done" | What the check does |
|---|---|
| alone, the game is what it was | an ordinary visit makes no request to any server, and loads one 2 KB file more |
| two players, and the most you expect | a host and two guests: the same edits, a block from a guest, a tower with its column as one op, the same troops in the same places, each builder where its player stands, holding what its player holds |
| a night | a guest asks for it; the same attackers; a wall down for everybody; a guest's blow and arrow reaching the host's attacker; an attacker's blow reaching a guest; a patch; dawn and the cheer after a lost night; the new day's numbers |
| the host leaves | the next player carries the units on |
| a reload | of a guest and of the host |
| everybody leaves and comes back | the town, and each player's things and hotbar |
| a slow connection that drops | through p3p2's `npm run lag` (150 ms each way, cut every 30 s): the same edits at the end |
| two browser engines | Chrome and Firefox build the same land and edits (choice 6) |
| a phone | in by the link; the panel fits upright and sideways; 👥 isn't under a touch control |

- **The page reports what it holds:** `window.game.net.replica.list()`, as in the reference. The check
  compares those reports and doesn't judge pictures.
- **Then a picture for you:** a showcase sheet of a guest's night beside the host's at the same
  moment (`recordings/showcase15/`). Neither the reference nor its tests ever looked at that.

### 5.4 The spec

- **Load:**
  - the menu, and the first playable frame alone, with and without the client: within 0.05 s of
    today's (0.12 s and 0.94 s)
  - **from an invite link to playable** is new. It adds the room client (14 KB) and the room's world
    (one message). With the server on this network and the mobile profile, the target is under
    3 s.
- **Frame rate:**
  - `perf` and `perf:mobile` alone: within noise of today's
  - a night with three players: on a guest, who now simulates nothing but its own builder, and on
    the host
  - the host's reports are about 18 bytes a unit, 10 times a second. The reference measured
    2.5 KB/s received per player in a night.

---

## 6. Your choices

Each has a default. I'll go with the defaults for anything you don't answer.

1. **Where "More games on Maize.Live" goes.** *Default: the menu card, the loading screen and the
   pause panel* (§0.5: the "loading page" could be the menu or the spinner, so both). Otherwise,
   say which.
2. **Who can play as a unit in a room.** *Default: only the host,* as the reference. The other way
   is for guests to send their input to the host, which moves the unit for them. Their unit then
   answers a round trip late, and it's a much bigger job.
3. **Others' shots, blows and fireballs on a guest's page.** *Default: drawn, with sound* (§3.2
   items 1, 3 and 4). The reference showed arrows only, all of them silent.
4. **Names over friends' heads.** *Default: yes,* a small chip for friends within 40 m (§3.2 item 5).
5. **Quitting in a room.** *Default: the button leaves the room* and returns to the menu (§3.2 item 7).
   Otherwise quitting can't reach the menu in a room at all.
6. **Firefox in the room check.** The world is built from a seed on every page, and engines can
   differ there. That's the trap p3p2's docs warn about most. `playwright-core` needs its own
   Firefox: about 90 MB, into `~/.cache/ms-playwright`. *Default: download it, and check Chrome
   against Firefox once.* The other option is Chrome only.
7. **A server in the game.** *Default: none.* Players bring a room URL, and the p3p2.me line says
   where to get one. If you have a server you'd like the game to suggest, give me its address.

---

## 7. Order of work

1. **The client and the port** (§2): `npm install @p3p2/client`, boot, `room.js`, `replica.js`, the
   edits to session, units, cycle and the HUD, and the reference's unit tests passing.
2. **Iterations 13 and 14** (§3.1), with their tests.
3. **The local server and `room-check`** (§5.2, §5.3), Chrome only, so the rest is built against a
   working check.
4. **The gaps** (§3.2), each with its line in the check.
5. **The links** (§4), checked on the phone screens with `hud-check`.
6. **Firefox, the lag proxy, and the phone** (§5.3); the sheet for you; `npm run check`, the build
   budgets, `perf`, `perf:mobile`, and a night with three players (§5.4).
7. **`docs/protocol.md`;** write `next_15.md` and `itr_15.md`.
