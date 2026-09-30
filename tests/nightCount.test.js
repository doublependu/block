/*
 *  What counts toward the night (plan 10 §3.1): only built blocks in the
 *  attackers' way, near the ground, and towers wherever they stand. A castle's
 *  roofs and spires don't draw sappers; every town built before counts the same.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { countsTowardNight, groundUnder, defenceParts, WALL_COUNT_HEIGHT } from '../src/game/waves.js'
import { BLOCK_BY_NAME } from '../src/world/blocks.js'
import { createGenerator } from '../src/world/gen/index.js'
import { parseWorld } from '../src/world/worldFile.js'

describe('countsTowardNight', () => {
    const wall = BLOCK_BY_NAME.stone_wall, tower = BLOCK_BY_NAME.arrow_tower
    it('a wall counts up to 3 blocks above the natural ground, not above', () => {
        expect(WALL_COUNT_HEIGHT).toBe(3)
        for (const y of [8, 9, 10]) expect(countsTowardNight(wall, y, () => 8)).toBe(true)
        expect(countsTowardNight(wall, 11, () => 8)).toBe(false)
        expect(countsTowardNight(wall, 30, () => 8)).toBe(false)
    })
    it('a wall dug into the ground counts', () => {
        expect(countsTowardNight(wall, 5, () => 8)).toBe(true)
    })
    it('a tower counts wherever it stands', () => {
        expect(countsTowardNight(tower, 40, () => 8)).toBe(true)
    })
    it('natural blocks never count', () => {
        expect(countsTowardNight(BLOCK_BY_NAME.stone, 8, () => 8)).toBe(false)
        expect(countsTowardNight(undefined, 8, () => 8)).toBe(false)
    })
})

/** a world's defence value with and without the height rule */
function values(def) {
    const gen = createGenerator(def.generator.version, def.seed, def.size)
    const edits = new Map(def.edits.map(([x, y, z, name]) => [`${x},${y},${z}`, name === 'air' ? 0 : BLOCK_BY_NAME[name].id]))
    const editAt = (x, y, z) => edits.get(`${x},${y},${z}`)
    const all = [], counted = []
    for (const [x, y, z, name] of def.edits) {
        const b = BLOCK_BY_NAME[name]
        if (!b || !b.built) continue
        all.push(name)
        if (countsTowardNight(b, y, () => groundUnder(x, y, z, editAt, gen.surfaceY(x, z), -64))) counted.push(name)
    }
    const troops = def.units.map((u) => u.type)
    return { before: defenceParts(all, troops).total, after: defenceParts(counted, troops).total }
}

describe('groundUnder', () => {
    const S = BLOCK_BY_NAME.stone.id, W = BLOCK_BY_NAME.stone_wall.id
    const at = (cells) => (x, y, z) => cells[y]
    it('a wall on the terrain stands on the terrain', () => {
        expect(groundUnder(0, 9, 0, at({ 8: W }), 8, -64)).toBe(8)
    })
    it('stone a world filled a dip with is ground', () => {
        expect(groundUnder(0, 9, 0, at({ 8: S, 7: S, 6: S }), 6, -64)).toBe(9)
    })
    it('a roof over a hollow hall stands on the hall floor, not its walls', () => {
        expect(groundUnder(0, 20, 0, at({ 19: 0, 18: 0, 17: 0, 10: W }), 10, -64)).toBe(10)
    })
    it('a wall down in a dug moat stands on the moat floor', () => {
        expect(groundUnder(0, 6, 0, at({ 7: 0, 6: W, 5: 0 }), 8, -64)).toBe(5)
    })
})

describe('every town built so far counts the same', () => {
    const files = [
        new URL('../worlds/default.world.json', import.meta.url),
        ...readdirSync(new URL('../tools/autoplay/towns/', import.meta.url)).map((f) => new URL(`../tools/autoplay/towns/${f}`, import.meta.url)),
    ]
    for (const file of files) {
        it(file.pathname.split('/').pop(), () => {
            const { before, after } = values(parseWorld(readFileSync(file, 'utf8')))
            expect(after).toBeCloseTo(before, 6)
        })
    }
})
