/*
 *  Register the atlas materials and block types with noa.
 */

import { BLOCKS } from './blocks.js'
import { TILE_INDEX, TILE_NAMES, buildAtlasDataURL } from './atlas.js'

/** @param {import('noa-engine').Engine} noa */
export function registerBlocks(noa) {
    const url = buildAtlasDataURL()
    const alphaTiles = new Set(['water', 'leaves', 'gate', 'spikes', 'town_crystal'])
    for (const name of TILE_NAMES) {
        noa.registry.registerMaterial(name, {
            textureURL: url,
            atlasIndex: TILE_INDEX[name],
            texHasAlpha: alphaTiles.has(name),
        })
    }
    for (const b of BLOCKS) {
        /** @type {any} */
        const opts = { material: b.tiles, solid: b.solid, opaque: b.opaque, fluid: !!b.fluid }
        if (b.fluid) Object.assign(opts, { fluidDensity: 1.0, viscosity: 0.5 })
        noa.registry.registerBlock(b.id, opts)
    }
    return url
}
