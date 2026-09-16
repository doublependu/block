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
| `src/lib/world.js` | chunks load around `camera.cameraTarget` instead of the player entity | the aerial camera and possessed units need terrain around them, not around the parked builder |
