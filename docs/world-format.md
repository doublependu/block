# World file format

Worlds live in `worlds/<slug>.world.json`. Every file in that folder shows up in
the in-game world list (built at build time by the `virtual:world-list` Vite
plugin). `worlds/default.world.json` is the world behind **Play**.

To add a world: play, press **P → Export world**, and commit the downloaded file
to `worlds/`. There is no in-game import; the repo is the world list.

> Don't name files `*.seed`: `.gitignore` ignores that extension.

## A world, not a save

A world file is the world: its terrain (the seed), the blocks mined and placed,
the troops placed in it, and the kit a player starts it with. **It holds no
game.** Survival or creative and daytime skirmishes are picked when you start a
world (**Play** uses survival without skirmishes); every start is day 1, night 1,
three lives, standing by the Town Center, and opens with the raid.

The game in progress (mode, skirmishes, day, night, lives, where you stand, what
you hold) lives only in the browser's save behind **Continue**: the same file
with a `game` block (`serializeSave` in `src/world/worldFile.js`).

## Example

```jsonc
{
  "format": "block-world",
  "formatVersion": 2,
  "name": "Default Valley",
  "description": "A green valley with a small walled town.",
  "seed": "default-valley",
  "generator": {"id":"terrain","version":1},
  "size": 192,
  "edits": [
    [-13,8,-13,"cobble"],      // x, y, z, block name ("air" = removed)
    [-12,8,-13,"stone_wall"]
  ],
  "units": [
    {"id":"u-start-1","type":"swordsman","pos":[0.5,8,9.5],"yaw":0}
  ],
  "start": {"inventory":{"cobble":12,"planks":12}}
}
```

A save adds, after `start`:

```jsonc
  "game": {"mode":"survival","skirmish":false,"day":4,"nightLevel":4,"lives":2,
           "player":{"pos":[0.5,9,5.5],"inventory":{"cobble":3,"iron":2}}}
```

## Rules

- **World = seed + generator version + edits.** Terrain is regenerated from the
  seed (at `size`, with generator `version`); `edits` are the *compacted final
  difference* from that terrain (a block mined and put back leaves no edit).
- **The Town Center isn't stored**: the seed puts it, on the plaza at (0, 0).
- **Block names, not numeric IDs**, so the block registry can grow without
  breaking files. Unknown names are skipped with a warning.
- **One edit / unit per line, stable sort order** (grouped by chunk column, then
  y, z, x). Changing one area of a world only changes nearby lines, so git diffs
  stay small and readable.
- **`start.inventory`** is the kit a player starts the world with. Export world
  writes what you hold at that moment. A world without one, or with an empty one,
  starts with the standard kit.
- **Night damage is never saved.** Blocks destroyed at night are restored at dawn
  and never appear in `edits`.
- **The pickaxe is never saved.** Every player always has one, so it never
  appears in an inventory.
- **The opening raid** always plays on a fresh survival start. Against a town
  about as strong as the starter one it is scripted to be lost; a stronger town
  (a built-up world) gets a real fight it can win (`OPENING_RAID.scripted`).
- **Version 1 files** (before the game moved into saves) still load: from
  `worlds/`, their `player.inventory` becomes the starting kit and the rest of the
  game is ignored; as an autosave, the game is the game.
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
