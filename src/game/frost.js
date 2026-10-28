/*
 *  Frost (plan 12 §3–4): ice arrows and ice blocks freeze attackers.
 *
 *  A frozen attacker stands still: no moving, no attacking, no casting, and it
 *  takes FROST.vulnerable times the damage from every attack. When it thaws it
 *  can't be frozen again for FROST.immune seconds. Defenders and the builder
 *  are never frozen.
 *
 *  Pure rules, unit tested; units.js applies them.
 */

import { FROST } from './balance.js'
import { AIR, BLOCK_BY_ID } from '../world/blocks.js'

/**
 * @typedef {{side: string, alive?: boolean, frozenT: number, frostImmuneT: number}} Freezable
 */

/** pure: can this unit be frozen right now? */
export function canFreeze(u) {
    return u.side === 'attacker' && u.alive !== false && !(u.frozenT > 0) && !(u.frostImmuneT > 0)
}

/**
 * pure: freeze a unit if it can be (see canFreeze).
 * @param {Freezable} u
 * @param {number} [seconds]
 * @returns {boolean} whether it was frozen now
 */
export function freeze(u, seconds = FROST.freeze) {
    if (!canFreeze(u)) return false
    u.frozenT = seconds
    return true
}

/**
 * pure: time passes for a unit's frost.
 * @param {Freezable} u
 * @param {number} dt
 * @returns {'thawed' | null} 'thawed' on the tick it comes free
 */
export function tickFrost(u, dt) {
    if (u.frozenT > 0) {
        u.frozenT -= dt
        if (u.frozenT > 0) return null
        u.frozenT = 0
        u.frostImmuneT = FROST.immune
        return 'thawed'
    }
    if (u.frostImmuneT > 0) u.frostImmuneT = Math.max(0, u.frostImmuneT - dt)
    return null
}

/** pure: what every blow on this unit is multiplied by */
export function frostDamage(u) {
    return u.frozenT > 0 ? FROST.vulnerable : 1
}

/** pure: a block that freezes what touches it */
export function freezesId(id) {
    return id !== AIR && !!BLOCK_BY_ID[id]?.freezes
}

/**
 * pure: is a body touching ice? Standing on it, standing in it (ice spikes),
 * or pressing against its side (within `reach`) at foot or head height.
 * @param {(x: number, y: number, z: number) => number} getBlock
 * @param {number[]} p feet position
 * @param {number} width
 * @param {number} height
 */
export function touchesIce(getBlock, p, width, height, reach = 0.1) {
    const hw = width / 2
    const x0 = Math.floor(p[0] - hw), x1 = Math.floor(p[0] + hw)
    const z0 = Math.floor(p[2] - hw), z1 = Math.floor(p[2] + hw)
    const feet = Math.floor(p[1] + 0.1), head = Math.floor(p[1] + height - 0.1)
    // under the feet, and inside the body
    const under = Math.floor(p[1] - 0.05)
    for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
            if (freezesId(getBlock(x, under, z))) return true
            for (let y = feet; y <= head; y++) if (freezesId(getBlock(x, y, z))) return true
        }
    }
    // against a side: the cells just past the body's faces, where the body is within `reach`
    const sides = []
    const ex1 = Math.floor(p[0] + hw + reach), ex0 = Math.floor(p[0] - hw - reach)
    const ez1 = Math.floor(p[2] + hw + reach), ez0 = Math.floor(p[2] - hw - reach)
    if (ex1 > x1) for (let z = z0; z <= z1; z++) sides.push([ex1, z])
    if (ex0 < x0) for (let z = z0; z <= z1; z++) sides.push([ex0, z])
    if (ez1 > z1) for (let x = x0; x <= x1; x++) sides.push([x, ez1])
    if (ez0 < z0) for (let x = x0; x <= x1; x++) sides.push([x, ez0])
    for (const [x, z] of sides) {
        if (freezesId(getBlock(x, feet, z)) || freezesId(getBlock(x, head, z))) return true
    }
    return false
}
