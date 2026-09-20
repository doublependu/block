/*
 *  Register the atlas materials and block types with noa.
 */

import { BLOCKS } from './blocks.js'
import { TILE_INDEX, TILE_NAMES, buildAtlasDataURL } from './atlas.js'

/** @param {import('noa-engine').Engine} noa */
export function registerBlocks(noa) {
    const url = buildAtlasDataURL()
    // which tiles have see-through pixels, taken from the blocks that use them
    // (a hand-kept list goes stale the moment a block is added)
    const alphaTiles = new Set()
    for (const b of BLOCKS) {
        if (b.alpha) for (const t of Array.isArray(b.tiles) ? b.tiles : [b.tiles]) alphaTiles.add(t)
    }
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
