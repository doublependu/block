/*
 *  Generator registry. Worlds record `generator.version`; old versions stay
 *  here forever so committed worlds keep producing the same terrain.
 */

import * as v1 from './terrain_v1.js'

const GENERATORS = { 1: v1 }

export const LATEST_GENERATOR = 1

/**
 * @param {number} version
 * @param {string} seed
 * @param {number} size
 */
export function createGenerator(version, seed, size) {
    const g = GENERATORS[version]
    if (!g) throw new Error(`Unknown terrain generator version ${version}`)
    return g.createTerrain(seed, size)
}

/** @param {number} version */
export function generatorBounds(version) {
    const g = GENERATORS[version]
    return { minY: g.MIN_Y, maxY: g.MAX_Y, seaLevel: g.SEA_LEVEL }
}
