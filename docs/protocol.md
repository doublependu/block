# Generic server protocol (future multiplayer)

The game is a static site and fully playable offline. Multiplayer is planned
through **one or two generic servers that know nothing about this game**: all
world data and game rules stay in the static app. The same servers should be
able to host completely different games.

Nothing server-side exists yet. The client already talks to these services
through interfaces with local implementations:

| Interface | Local implementation | File |
|---|---|---|
| `IdentityService` | `LocalIdentity` (guest profile, optional `?avatar=<glb url>`) | `src/net/identity.js` |
| `SyncService` | `LocalSync` (echoes ops back immediately) | `src/net/sync.js` |
| discovery | `probeServices()` reads `config.json` | `src/net/services.js` |

## Discovery and offline fallback

`config.json` sits next to `index.html` (ships as `{}`):

```json
{ "gameId": "block", "identityUrl": "https://id.example.com", "syncUrl": "wss://sync.example.com" }
```

After the first frame the client fetches it and pings `identityUrl/health`
with a 1.5 s timeout. Missing config, an error or a timeout means single player.
Probing never delays startup.

## Identity server

Generic account + avatar storage, scoped by `gameId`.

```
GET  /health                              -> 200
POST /login            {provider, ...}    -> {token, profile}
GET  /profile          (Bearer token)     -> Profile
PUT  /profile          {displayName}      -> Profile
PUT  /avatar           (GLB bytes)        -> {glbUrl}
GET  /avatars/:id.glb                     -> model/gltf-binary
```

```ts
type Profile = { id: string, displayName: string, avatar: { glbUrl: string } | null }
```

The server stores avatar GLBs as opaque files. The game validates them against
`docs/character-contract.md` on load and falls back to `player.glb` if one is
invalid.

## Sync server

A WebSocket relay with per-room ordered op logs. It never looks inside payloads.

Client → server:

```jsonc
{"t":"join", "room":"<gameId>:<roomId>", "token":"…"}
{"t":"op", "op": { /* opaque */ }}          // reliable, ordered
{"t":"presence", "blob": { /* opaque */ }}  // unreliable, throttled to ~10 Hz
{"t":"snapshot", "blob": { /* opaque */ }}  // optional compaction by the host
```

Server → client:

```jsonc
{"t":"joined", "self":"m7", "members":[{"id":"m3","order":0},{"id":"m7","order":1}],
 "snapshot": { /* last snapshot or null */ }, "ops":[ /* envelopes since snapshot */ ]}
{"t":"op", "seq": 1042, "from":"m3", "op": { /* opaque */ }}
{"t":"presence", "from":"m3", "blob": { /* opaque */ }}
{"t":"member+", "id":"m9", "order":2}
{"t":"member-", "id":"m3"}
```

Server rules (the whole server-side "game logic"):

1. Assign each op a room-wide increasing `seq`, append it to the room log, and
   broadcast it to every member, including the sender.
2. Relay presence to other members without storing it.
3. Keep member join order. **The member with the lowest `order` is the host.**
4. Replace the log prefix when the host sends a snapshot.

## How this game uses it

- **World ops** (the only permanent state): `{"t":"block","x","y","z","b":"stone_wall"}`,
  `{"t":"unit+","id","type","pos","yaw"}`, `{"t":"unit-","id"}`. Clients apply
  an op only when it comes back from the server (`LocalSync` does that
  immediately), so single player and multiplayer run the same code.
- **Seed + edits**: a room's world is the world file's seed plus the op log. A
  snapshot is simply a world file (`docs/world-format.md`).
- **NPC simulation** (NPC positions by day and night, combat, night damage) is run
  by the host only. The host sends NPC state as presence blobs and other clients
  render it. Defenders wandering near their posts is part of that state, not an op.
  Night damage is not an op: it is temporary and reverted at dawn. That includes
  everything the siege knocks down (collapses, sapper explosions, the crumbling
  town center): the host decides it, and clients replay it from the host's state.
- **Players** send their own position/animation/role as presence. At night each
  player's builder is in the fight. When the player watches from above or plays a
  unit, their builder runs on autopilot, simulated by **that player's own client**
  (it's their entity and uses their inventory's weapon), and still sent as their presence.
- **Inventories** are per player and kept locally in v1.
