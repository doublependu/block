# World file format

Worlds live in `worlds/<slug>.world.json`. Every file in that folder shows up in
the in-game world list (built at build time by the `virtual:world-list` Vite
plugin). `worlds/default.world.json` is the world behind **Play**.

To add a world: play, press **P → Export world**, and commit the downloaded file
to `worlds/`. There is no in-game import; the repo is the world list.

> Don't name files `*.seed`: `.gitignore` ignores that extension.

## Example

```jsonc
{
  "format": "block-world",
  "formatVersion": 1,
  "name": "Default Valley",
  "description": "A green valley with a small walled town.",
  "seed": "default-valley",
  "generator": {"id":"terrain","version":1},
  "size": 192,
  "mode": "survival",          // survival | creative
  "skirmish": false,           // small daytime attacks
  "day": 1,
  "nightLevel": 1,             // strength of the next night
  "townCenter": [0,8,0],       // base of the town center structure
  "edits": [
    [-13,8,-13,"cobble"],      // x, y, z, block name ("air" = removed)
    [-12,8,-13,"stone_wall"]
  ],
  "units": [
    {"id":"u-start-1","type":"swordsman","pos":[0.5,8,9.5],"yaw":0}
  ],
  "player": {"pos":null,"inventory":{"cobble":12,"planks":12}}
}
```

## Rules

- **World = seed + generator version + edits.** Terrain is regenerated from the
  seed; `edits` are the *compacted final difference* from that terrain (a block
  mined and put back leaves no edit).
- **Block names, not numeric IDs**, so the block registry can grow without
  breaking files. Unknown names are skipped with a warning.
- **One edit / unit per line, stable sort order** (grouped by chunk column, then
  y, z, x). Changing one area of a world only changes nearby lines, so git diffs
  stay small and readable.
- **Night damage is never saved.** Blocks destroyed at night are restored at dawn
  and never appear in `edits`.
- `generator.version` pins the terrain algorithm. Generators are never changed
  once released: a new algorithm is `src/world/gen/terrain_v2.js`, and old
  worlds keep using v1. `tests/worldgen.test.js` holds golden hashes that fail
  if v1 output drifts.
- Terrain generation uses only `+ - * / floor sqrt` and integer hashing, so the
  same seed gives the same world in every browser.

## Regenerating the default world

`worlds/default.world.json` is produced by `src/world/defaultWorld.js`:

```bash
node tools/make-default-world.mjs
```

A test checks that the committed file matches the script output. If you'd rather
hand-build the default world in game, export it over the file and delete that
test.
