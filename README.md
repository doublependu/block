# block

Voxel tower defence game built on the [noa](https://github.com/fenomas/noa) engine (vendored in
`vendor/noa`) and Babylon.js 9. A static web page, single player. Designed so the multiplayer
servers can be added later (see `docs/protocol.md`).

A new survival game opens with a raid from all four sides that leaves the starting town in ruins,
to show what the attackers are after. Then mine, build and craft weapons by day. At night waves of
attackers break down your towers and walls and try to destroy the town center. Fight as yourself
with the weapons you crafted (from the wall walk with a bow is safest), patch breaches with the
blocks you carry, or watch from above / play as any defender or attacker while your builder fights
on its own. At dawn the town rebuilds itself, block by block. Every night is stronger, and the
attackers answer what you build (brutes, whom arrows barely hurt, for arrow towers; sappers for
walls; the dusk banner says what's coming). You have three lives: each night the town center falls
costs one, and the last ends the game with your score, the nights survived. On the first days, a
player who is slow to get going gets tips on where to find wood, stone and ore, what to craft, and
where to build defences (switch them off in the menu).

## Setup and run

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # dist/ + load budget check
npm run check        # type check, unit tests, GLB validation
npm run perf         # load time + FPS under throttling (needs a build and Chrome)
npm run perf:mobile  # same with the entry-level phone profile (add -- --quality=low to force a tier)
```

URL options: `?autoplay` (skip the menu), `?intro=0` (no opening raid), `?quality=low|med|high`,
`?fps`, `?hpbars=0` (no health bars), `?tips=0` (no first-day tips), `?avatar=<url to a character GLB>`.

## Deploy to Cloudflare

The build is a static site (`dist/`), so it runs on Cloudflare Workers (static assets, no Worker
script) or Cloudflare Pages. Log in once with `npx wrangler login`, then:

```bash
npm run deploy        # Workers: builds, then uploads to https://block.<your subdomain>.workers.dev
npm run deploy:pages  # or Pages (the first run offers to create the "block" project)
npm run preview:cf    # the build served locally by wrangler, with Cloudflare's headers and compression
```

- `wrangler.jsonc` names the Worker (`block`) and points it at `dist/`. Pages ignores it (wrangler
  prints a warning about it).
- `public/_headers` sets the cache headers on both. Hashed files under `assets/` are cached for a year;
  everything else is revalidated on each load.
- Cloudflare doesn't compress `.glb` files, so the build also writes a gzipped copy of each model
  (`dist/models/*.glb.gz`, ~17 KB instead of ~124 KB) and the game loads that one. The dev server
  still serves the plain `.glb`.
- To build from Git instead (Workers Builds or Pages): build command `npm run build`, output
  directory `dist`. `.node-version` pins Node 24.

## Autoplay

```bash
npm run autoplay -- --record          # a bot plays one game (to game over, 1 hour cap), recorded as one video
npm run autoplay -- --strategy=towers # iteration 6's plan: arrow towers and archers only
npm run autoplay -- --strategy=idle   # baseline: builds nothing, watches every night from above
npm run autoplay -- --lab=skills:all  # development scenarios (see tools/autoplay/lab.mjs)
node tools/autoplay/map.mjs           # difficulty map: saved towns × nights, one night each (--lab=siege)
```

The bot (`tools/autoplay/`) plays the production build in headless Chrome. It sees the game
through a read-only view and acts only through input (keys, mouse, HUD clicks), so a recorded
game is one a person could have played. Each run writes `recordings/<date>-<label>/`
(gitignored): `report.md` (nights, kills by source, how the days were spent, performance,
errors), `events.jsonl`, `telemetry.jsonl`, and with `--record` `game.mp4` with chapters and
contact sheets. `--shots=15` saves a screenshot every 15 s instead.

## Controls

| Desktop | Touch | Action |
|---|---|---|
| WASD, Space, mouse | left stick, drag, ⤒ | move, look, jump |
| hold left click | hold ⛏ | mine (always with the pickaxe) / attack with your weapon / pick up your troop |
| right click or E | ▣ | place block or troop (at night: patch a hole with the same block) |
| 1–9, wheel | tap hotbar | select item (the pickaxe is in slot 1) |
| Q, middle click | tap slot 1 | swap between the pickaxe and the last item |
| B | Build | craft walls, towers, troops and weapons; assign hotbar items |
| M | View | aerial view / back to yourself (drag rotates, wheel zooms, right click places, click a unit at night to play as it) |
| R | Role | at dusk and night: play as a unit, watch, or fight as yourself |
| N | Start night | start the night early (creative: choose its strength); at dawn, skip the rebuild |
| V | | first / third person |
| P, Esc | ☰ | menu, export world, settings (quality, health bars, tips, sound) |

## Project layout

```
index.html            menu shell (interactive before the game code loads)
src/boot/             tiny first-load script: menu, preloading, speculative worldgen
src/game/             session, day/night cycle, units + AI, towers, waves, inventory, balance.js
src/world/            blocks, texture atlas, versioned terrain generators (worker), world state, file format
src/ai/               flow-field navigation (worker)
src/characters/       GLB loading, character contract, layered animation
src/engine/           noa setup, quality tiers, sky
src/input/ src/ui/    touch controls, HUD
src/audio/            procedural Web Audio sound effects
src/net/              identity / sync service interfaces with local implementations
worlds/               committed worlds; the in-game world list (default.world.json = Play)
public/models/        character + item GLBs (generated by tools/blender/make_characters.py)
tools/                budget check, perf test, GLB validator, autoplay bot, Blender + default world generators
docs/                 world format, character contract, server protocol
tests/                vitest unit tests (worldgen golden hashes, nav, world files, game rules, autoplay)
vendor/noa/           vendored engine + UPSTREAM.md (local patches)
ai/                   prompts, plans and notes
```

## Adding a world to the list

Play, press **P → Export world**, and commit the downloaded `*.world.json` to `worlds/`.
See `docs/world-format.md`.

## Regenerating assets

```bash
BLENDER=~/Downloads/blender-5.2.1-linux-x64/blender npm run characters   # all character GLBs
npm run default-world                                                    # worlds/default.world.json
npm run anim-check                                                       # walk/run cycle measurements
```

`npm run characters` runs the Blender script and then
`tools/fix-glb-animations.mjs`, which keeps rotation curves in one quaternion
hemisphere (otherwise limbs kick out mid-stride) and smooths looping clips at
their seam. `npm run anim-check` prints each cycle's ground speed, foot slide
and swing clearance — the ground speeds go into `GROUND_SPEED` in
`src/characters/contract.js`, which is what keeps feet from skating.

## Initial setup

```bash
npm create vite@latest . -- --template vanilla
claude --dangerously-skip-permissions
```


## Backed by

Man & Bot

Browse web games at [Maize.Live](https://maize.live)
, or watch on YouTube [@RadWebGame](https://www.youtube.com/@RadWebGame)
