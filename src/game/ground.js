/*
 *  Standing in the ground (plan 13 §1), as pure functions with no imports, so
 *  the game (units.js, session.js) and tools/autoplay/buried-check.mjs run the
 *  same test: is a unit's feet in a solid block, and where does it fit.
 */

/**
 * A body resting on a block has its feet a hair above the block's top, never in
 * it: feet this far inside a solid block are buried (plan 13 §1)
 */
export const BURIED_SLACK = 0.05

/**
 * pure: how deep a unit's feet are in solid ground: from its feet up to the top
 * of the solid blocks they're in, 0 when they aren't in one. Gates, spikes and
 * water aren't solid, so standing in them is never buried.
 * @param {(x: number, y: number, z: number) => boolean} solid
 * @param {number[]} p feet position
 */
export function buriedDepth(solid, p, max = 24) {
    const x = Math.floor(p[0]), z = Math.floor(p[2])
    let y = Math.floor(p[1] + BURIED_SLACK)
    if (!solid(x, y, z)) return 0
    const top = y + max
    while (y < top && solid(x, y + 1, z)) y++
    return y + 1 - p[1]
}

/**
 * pure: a unit whose feet are in a solid block is stuck in the terrain (a
 * block came back under it, or it slid through ground that wasn't loaded): the
 * feet level of the first cell above where it fits (two free cells), or null
 * when it isn't buried (or nothing fits within `max`). Before plan 13 it took
 * the head in a block too, so a unit one block deep stood buried to the waist
 * until its next walk.
 * @param {(x: number, y: number, z: number) => boolean} solid
 * @param {number[]} p feet position
 */
export function unstuckY(solid, p, max = 24) {
    if (buriedDepth(solid, p, max) <= 0) return null
    const x = Math.floor(p[0]), z = Math.floor(p[2])
    const fy = Math.floor(p[1] + BURIED_SLACK)
    for (let y = fy + 1; y <= fy + max; y++) {
        if (!solid(x, y, z) && !solid(x, y + 1, z)) return y
    }
    return null
}

/**
 * pure: the feet level of the place to stand in a column nearest to `y` (solid
 * under, two free cells), searching `reach` either way; null when there's none.
 * Where the terrain isn't loaded a unit takes its height from this, for the
 * column it's in (plan 13 §1.3).
 * @param {(x: number, y: number, z: number) => boolean} solid
 */
export function standY(solid, x, y, z, reach = 6) {
    const fits = (cy) => solid(x, cy - 1, z) && !solid(x, cy, z) && !solid(x, cy + 1, z)
    const y0 = Math.floor(y + BURIED_SLACK)
    for (let d = 0; d <= reach; d++) {
        if (fits(y0 + d)) return y0 + d
        if (d && fits(y0 - d)) return y0 - d
    }
    return null
}
