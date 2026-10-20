# Multiplayer: the server, and what the game sends through it

The game is a static site and fully playable offline. Multiplayer goes through **a generic
server that knows nothing about this game**: all world data and game rules stay in the static
app, and the same server hosts completely different games.

That server is p3p2. The player chooses which one:
the owner of a p3p2 server gives out a *room URL*, a player pastes it into the game
(**Play with friends** in the menu, 👥 in the game), and gets an *invite link* to send round.
Nothing is configured in the game. Players who have no room URL are pointed to
[p3p2.me](https://p3p2.me), next to every way into the panel. The client is
[`@p3p2/client`](https://www.npmjs.com/package/@p3p2/client) from npm: 2 KB on every visit, which
asks no server anything, and the rest (14 KB) only when a room is opened.

This document used to describe a sync server that did not exist yet. What it asked for is what
p3p2 does, and the differences are noted where they matter.

| In the game | What it is | File |
|---|---|---|
| `SyncService` | The interface the game submits ops to and gets them back from | `src/net/sync.js` |
| `LocalSync` | Echoes ops straight back. Used by the tools and the tests. | `src/net/sync.js` |
| `RoomSync` | The one the game runs on: echoes when alone, and goes through the room's log in a room | `src/net/room.js` |
| `Net` | Which world a room holds, and what it keeps for each player | `src/net/room.js` |
| `Replica` | Showing everybody the same players and the same night | `src/net/replica.js` |
| `IdentityService` | A guest profile, local. p3p2 has no accounts yet. | `src/net/identity.js` |

## What a room holds

| | What | How p3p2 keeps it |
|---|---|---|
| `world` | A save: the world and the game in it (`serializeSave`), packed | A room value, set once by whoever brings a world first (`room.offer`) |
| the log | Every permanent change since, in one order for everybody | The room's log: ops, and now and then a snapshot that replaces them |
| `me` | Where a player stood, what they carried, and their hotbar as they arranged it | A value per player |

- **A room is a world.** Whoever opens an empty room to friends brings the world they are
  playing, with the game in it: which day, which night, how many lives. Whoever comes later plays
  that world. Somebody who is playing another world and opens a room that has one is taken to the
  room's, by a reload; their own game stays behind **Continue**.
- **The room keeps it** when everybody has left. Coming back by the same invite, or opening the
  same room again, finds the town as it was.
- **A snapshot is a save**, packed (`@p3p2/client/pack`). The host makes one at every dawn, and
  whenever the server asks because the list of ops has grown long.
- **How large a world can get**: a save has to fit one frame, which is 64 KB on a server with
  default settings. Packed, that is about 16,000 edits: the starter town (840 edits) packs to
  4 KB, the ice palace (10,974) to 40 KB. A server with a larger `P3P2_MAX_FRAME_BYTES` takes
  more. A world that doesn't fit isn't offered: the player is told, and plays on alone
  (`tests/room.test.js` checks that every world the game ships fits).
- **Somebody new** starts with the world's starting kit, beside the others (`newcomerSpot`).
- **No opening raid in a room**: a room's game is one that is already going on. A room opened in
  the middle of the raid starts from its dawn.

## Ops: the world's permanent changes

```jsonc
{"t": "block", "x": 4, "y": 9, "z": -3, "b": "stone_wall"}      // "air": removed
{"t": "unit+", "id": "u1a2b", "type": "archer", "pos": [0.5, 8, 9.5], "yaw": 0}
{"t": "unit-", "id": "u1a2b"}
{"t": "many", "ops": [ /* any of the above */ ]}
```

- **An op is applied when it comes back from the server**, never before, so single player and
  multiplayer run the same code and everybody applies the same ops in the same order. Alone,
  `RoomSync` hands an op back at once.
- **`many`** is everything the game submitted in one go: a tower and its column, a bot laying a
  wall. One op in the log, and one frame against the server's limit of 90 a second.
- **While the room cannot be reached**, ops wait and are sent when it is back. Nothing appears
  until then.

## The night, and everything else that is not permanent

The host decides it, and the others draw it. **The earliest member who is connected and looking
at the page is the host**; p3p2 passes the role on when the host leaves, drops for 5 seconds, or
puts the page in the background.

| Channel | From | What | Lost if the connection is behind? |
|---|---|---|---|
| presence | everybody | Their own builder: position, heading, speed, alive, what is in its hand (item, tint, a block's face, and its name, for the sounds), and a counter of what it last did with its hands (swing, chop, draw, loose, place) | Only the latest counts |
| `un` | host | Every unit: 19 bytes each (format 2: with its wave front), ten times a second | Yes |
| `st` | host | The phase and the game's numbers (day, night level, lives), the attackers still to come, and the dusk banner's text, once a second and at every change | The repeat, yes; a change, no |
| `dm`, `rs` | host | Blocks the night destroyed; blocks a patch put back | No |
| `ev` | host | What happens in the fight, for its sounds, alerts and cracks: blows, shots, a block struck, the Town Center hit, a freeze, a cast, a fireball thrown, a keg, a wave's banner | Yes |
| `fx` | everybody | The shots they loose: the host its troops', towers' and attackers' and its own, everybody else their own. Drawn harmless by the others | Yes |
| `hurt` | host, to one player | An attacker struck that player's builder | No |
| `hit` | anybody, to the host | A blow on an attacker | No |
| `patch` | anybody, to the host | A hole patched | No |
| `night` | anybody, to the host | Please start the night | No |
| `skip` | anybody to the host, and the host to everybody | Please skip the dawn; the dawn is skipped | No |

- **Night damage is not an op**: it is temporary, and dawn puts it back. The host says which
  blocks went down, and every page rebuilds its own at dawn from the same list.
- **Each player's builder is their own page's**: its health is counted there. On the host it is
  something an attacker can go for, and a blow on it is sent to its player.
- **When the host goes**, the next host has been drawing every unit, and makes them its own where
  they stand. It does not know what the old host had planned, so no further wave arrives that
  night; the night ends when the attackers that are left are gone.
- **What another page fired is drawn, and hurts nothing here**: it flies, lands and makes its
  sound, and what it hit is that page's to say (`hit`, or the host's own units).
- **A builder whose player's tab is in the background** (`member-state` *away*) is not a target
  for the attackers until it is back. **One whose page is gone** (*lost*: closed, or no word for a
  few seconds) is not drawn; the room keeps its place a while, in case it was a reload.
- **Only the host can play as a unit.** On every other page a unit is a picture of one.
- **The menu doesn't pause a room's game**, and its quit leaves the room: a page reloaded in a
  room comes straight back into it.

| Measured (`tools/autoplay/room-check.mjs --measure`) | |
|---|---|
| A night with three players and 45 attackers | the host sends 32 messages and 8.7 KB a second; each guest gets the same and sends about 1 message and 0.1 KB (presence, standing still) |
| From an invite link to playable, on the load test's phone (10 Mbps, 70 ms, 4× slower CPU) | 2.4 s |

## What is not shared yet

- The sound of a friend's chop: it needs the block under the pick, which only their page knows.
- A friend's footsteps.
- The shot of a unit the host plays: it plays where the host is, and is drawn for the others.
- Other players' builders have no body in the host's physics: attackers walk through them.
- Skins: everybody else's builder is the stock one.

## Testing it

`tools/autoplay/room-check.mjs` starts a p3p2 server from `.temp/p3p2` (cloned from
[GitHub](https://github.com/doublependu/p3p2) and installed the first time), serves the build on
this machine's LAN address, and plays with players who are each a browser profile of their own.
`--lag` builds through p3p2's lag proxy (150 ms each way, a cut connection), `--phone` joins from a
phone's screen, `--firefox` compares Firefox's land and town with Chrome's, `--measure` gives the
numbers above, and `--all` does all four.

By hand: `npm run dev` in `.temp/p3p2` starts a server on port 8080 (set
`P3P2_OWNER_PASSWORD`), `npm run dev` here serves the game on the LAN, and a room is made in the
server's portal for the game's LAN address, never `localhost`. The second player needs another
browser or a private window: two tabs of one browser are one player.
