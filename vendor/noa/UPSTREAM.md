# Vendored noa engine

- Upstream: https://github.com/fenomas/noa (MIT, see LICENSE.txt)
- Commit: `8a74866` on `develop` (2023-07-31, "Works around two different (!) chrome pointerlock bugs"),
  four commits after the npm release `noa-engine@0.33.0`.
- Why vendored: upstream is inactive since 2023 and pinned to Babylon 6; the game runs it on
  Babylon 9 and needs engine changes.
- Imported as `noa-engine` through an alias in `vite.config.js`. Its npm dependencies are listed
  in the root `package.json`.

## Local patches (search for `[block patch]`)

| File | Change | Why |
|---|---|---|
| `src/lib/terrainMaterials.js` | shader regex also matches `TEXRD(diffuseSampler, …)` | Babylon 7+ samples textures through the `TEXRD` macro; without this the texture atlas renders as stretched stripes |
| `src/lib/camera.js` | direction vector rebuilt from heading/pitch every frame | lets touch controls, the aerial camera and possession set heading/pitch in code |
| `src/lib/camera.js` | `keepOutOfTerrain` flag (default on) to skip pulling the camera in when terrain is between it and its target | the aerial camera holds its own height; the pull-in made it jump tens of blocks in one frame whenever its target was inside a roof, a tree or a hill |
| `src/lib/world.js` | chunks load around `camera.cameraTarget` instead of the player entity | the aerial camera and possessed units need terrain around them, not around the parked builder |
| `src/lib/sceneOctreeManager.js`, `src/lib/rendering.js` | scene/octree bookkeeping kept in `WeakSet`/`WeakMap` instead of `mesh.metadata` flags | Babylon clones share the source mesh's `metadata` object, so every clone after the first looked "already added" and was never rendered (only one character per GLB was visible) |
| `src/index.js` | `_localPick` passes the voxel's world coords to the block test function, after the id | the crosshair lands on gates and spikes (plan 13 §4), and skips the cell your eyes are in, so a gate you stand in doesn't stop it |
| `src/lib/chunk.js` | `Chunk.set`: an edit on a chunk's last row (in x, y or z) also remeshes the next chunk along that axis, whatever the block | the face between two chunks is meshed by the chunk on the + side. Upstream remeshed neighbours only when solidity or opacity changed, and air ↔ spikes or a gate changes neither: spikes and gates on a last row had no face on that side, a mined one left its face behind, and an upgrade there kept the old picture (plan 16 §0.1) |
| `src/lib/terrainMesher.js` | `constructMeshMask`: where two different see-through blocks meet, both faces (the first block's in the first pass, the other's in a second pass over the same plane, only when there are any) | upstream drew neither ("for now we draw neither"), so a gate behind spikes, or spikes behind a gate, vanished (plan 16 §0.2). The two faces share the plane and point opposite ways; terrain culls back faces and cuts alpha out, so each side sees only the face toward it |
