import { describe, it, expect } from 'vitest'
import { canStand, wanderPath, pathToward } from '../src/ai/localPath.js'
import { blockId } from '../src/world/blocks.js'

const STONE = blockId('stone'), WALL = blockId('stone_wall'), GATE = blockId('gate'), SPIKES = blockId('spikes'), WATER = blockId('water')
const SIZE = 20

/** flat stone floor at y=-1 over a SIZE×SIZE square centered on the origin, plus extra blocks */
function world(extra = []) {
    const m = new Map()
    for (const [x, y, z, id] of extra) m.set(`${x},${y},${z}`, id)
    return (x, y, z) => {
        if (Math.abs(x) > SIZE / 2 || Math.abs(z) > SIZE / 2) return undefined // not loaded
        const k = `${x},${y},${z}`
        if (m.has(k)) return m.get(k)
        return y === -1 ? STONE : 0
    }
}

/** check each step of a path obeys the movement rules */
function checkSteps(getBlock, start, path) {
    let prev = [Math.floor(start[0]), Math.floor(start[1]), Math.floor(start[2])]
    for (const p of path) {
        const c = [Math.floor(p[0]), p[1], Math.floor(p[2])]
        expect(canStand(getBlock, c[0], c[1], c[2])).toBe(true)
        prev = c
    }
    return prev
}

/** walk a path cell by cell (waypoints are merged on straight runs) and collect columns */
function columns(start, path) {
    const out = []
    let [x, , z] = start.map(Math.floor)
    for (const p of path) {
        const tx = Math.floor(p[0]), tz = Math.floor(p[2])
        while (x !== tx || z !== tz) {
            x += Math.sign(tx - x)
            z += Math.sign(tz - z)
            out.push([x, z])
        }
    }
    return out
}

describe('local defender paths', () => {
    it('wanders to a reachable cell inside the radius', () => {
        const g = world()
        for (let i = 0; i < 20; i++) {
            const path = wanderPath(g, [0.5, 0, 0.5], [0.5, 0, 0.5], 4)
            expect(path && path.length).toBeTruthy()
            const end = checkSteps(g, [0.5, 0, 0.5], path)
            expect(Math.max(Math.abs(end[0] + 0.5 - 0.5), Math.abs(end[2] + 0.5 - 0.5))).toBeLessThanOrEqual(4)
        }
    })

    it('goes around a wall', () => {
        const extra = []
        for (let z = -6; z <= 6; z++) extra.push([2, 0, z, WALL], [2, 1, z, WALL])
        const g = world(extra)
        const path = pathToward(g, [0.5, 0, 0.5], [4.5, 0, 0.5])
        const end = checkSteps(g, [0.5, 0, 0.5], path)
        expect(end[0]).toBe(4)
        expect(end[2]).toBe(0)
        const cols = columns([0.5, 0, 0.5], path)
        expect(cols.some(([x]) => x === 2)).toBe(true) // crossed the wall line…
        expect(cols.filter(([x]) => x === 2).every(([, z]) => Math.abs(z) > 6)).toBe(true) // …only past its ends
    })

    it('walks through a gate', () => {
        const extra = []
        for (let z = -10; z <= 10; z++) {
            const id = z === 0 ? GATE : WALL
            extra.push([2, 0, z, id], [2, 1, z, id])
        }
        const g = world(extra)
        const path = pathToward(g, [0.5, 0, 0.5], [4.5, 0, 0.5])
        const cols = columns([0.5, 0, 0.5], path)
        expect(cols.some(([x, z]) => x === 2 && z === 0)).toBe(true)
        expect(cols.at(-1)).toEqual([4, 0])
    })

    it('climbs one block but not two', () => {
        const one = world([[2, 0, 0, STONE]])
        expect(pathToward(one, [0.5, 0, 0.5], [2.5, 1, 0.5]).at(-1)).toEqual([2.5, 1, 0.5])
        // a boxed-in two-high pillar top can't be reached: the nearest cell is next to it
        const extra = []
        for (let x = 1; x <= 3; x++) for (let z = -1; z <= 1; z++) extra.push([x, 0, z, STONE], [x, 1, z, STONE])
        const two = world(extra)
        const end = pathToward(two, [0.5, 0, 0.5], [2.5, 2, 0.5]).at(-1) ?? [0.5, 0, 0.5]
        expect(end[1]).toBe(0)
    })

    it('avoids spikes and water', () => {
        const extra = []
        for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) {
            if (Math.abs(x) <= 1 && Math.abs(z) <= 1) continue
            extra.push([x, 0, z, (x + z) % 2 ? SPIKES : WATER])
        }
        const g = world(extra)
        expect(wanderPath(g, [0.5, 0, 0.5], [0.5, 0, 0.5], 5, Math.random, 1.5)).toBe(null)
    })

    it('returns null where the world is not loaded', () => {
        expect(wanderPath(world(), [40.5, 0, 0.5], [40.5, 0, 0.5], 4)).toBe(null)
    })
})
