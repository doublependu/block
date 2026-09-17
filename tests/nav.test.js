import { describe, it, expect } from 'vitest'
import { createNavGrid, DIRS } from '../src/ai/navCore.js'
import { blockId } from '../src/world/blocks.js'

const STONE = blockId('stone'), CORE = blockId('town_core'), WALL = blockId('stone_wall')
const SIZE = 32, MIN_Y = -2, MAX_Y = 10

/** flat stone floor at y=-1, town core column at the origin, plus extra blocks */
function makeGrid(extra = []) {
    return createNavGrid({ size: SIZE, minY: MIN_Y, maxY: MAX_Y }, (vox, vi) => {
        for (let x = -SIZE / 2; x < SIZE / 2; x++) for (let z = -SIZE / 2; z < SIZE / 2; z++) vox[vi(x, -1, z)] = STONE
        for (let y = 0; y < 3; y++) vox[vi(0, y, 0)] = CORE
        for (const [x, y, z, id] of extra) vox[vi(x, y, z)] = id
    })
}

/** follow a field from a start node, return the visited columns */
function walk(grid, field, x, z, y = 0, maxSteps = 200) {
    const path = [[x, z]]
    for (let i = 0; i < maxSteps; i++) {
        const col = (x + grid.half) * grid.W + (z + grid.half)
        let slot = -1
        for (let s = 0; s < grid.L; s++) if (grid.nodeY[col * grid.L + s] + grid.minY === y) slot = s
        if (slot < 0) return { path, reached: false }
        const code = field.next[col * grid.L + slot]
        if (code === 0xfe) return { path, reached: true }
        if (code === 0xff) return { path, reached: false }
        const d = DIRS[code >> 3]
        x += d[0]
        z += d[1]
        const ncol = (x + grid.half) * grid.W + (z + grid.half)
        y = grid.nodeY[ncol * grid.L + (code & 7)] + grid.minY
        path.push([x, z])
    }
    return { path, reached: false }
}

describe('nav flow field', () => {
    it('leads to the town center on open ground', () => {
        const grid = makeGrid()
        const field = grid.computeField(false)
        const r = walk(grid, field, 12, 12)
        expect(r.reached).toBe(true)
        // diagonal moves: roughly straight line, not a zig-zag
        expect(r.path.length).toBeLessThan(15)
    })

    it('goes around a wall with a gap instead of breaking it', () => {
        const extra = []
        for (let x = -15; x <= 15; x++) {
            if (x === 12) continue // gap
            extra.push([x, 0, 6, WALL], [x, 1, 6, WALL])
        }
        const grid = makeGrid(extra)
        const field = grid.computeField(false)
        const r = walk(grid, field, 0, 12)
        expect(r.reached).toBe(true)
        expect(r.path.some(([x, z]) => x === 12 && z === 6)).toBe(true)
    })

    it('breaks through a closed wall ring when there is no way around', () => {
        const extra = []
        for (let i = -5; i <= 5; i++) {
            for (const [x, z] of [[i, -5], [i, 5], [-5, i], [5, i]]) extra.push([x, 0, z, WALL], [x, 1, z, WALL])
        }
        const grid = makeGrid(extra)
        const field = grid.computeField(false)
        const r = walk(grid, field, 0, 12)
        expect(r.reached).toBe(true)
        expect(r.path.some(([x, z]) => Math.max(Math.abs(x), Math.abs(z)) === 5)).toBe(true)
    })

    it('updates when blocks change', () => {
        const grid = makeGrid()
        const before = grid.computeField(false)
        expect(walk(grid, before, 8, 0).reached).toBe(true)
        // a 3-high natural pillar replaces the ground node with one on top
        grid.setBlocks([[8, 0, 0, STONE], [8, 1, 0, STONE], [8, 2, 0, STONE]])
        grid.update()
        const after = grid.computeField(false)
        expect(walk(grid, after, 8, 0, 0).reached).toBe(false)
        // dropping 3 blocks is allowed, so the top still leads home
        expect(walk(grid, after, 8, 0, 3).reached).toBe(true)
        // a 5-high pillar is a dead end (drops over 3 aren't taken)
        grid.setBlocks([[8, 3, 0, STONE], [8, 4, 0, STONE]])
        grid.update()
        expect(walk(grid, grid.computeField(false), 8, 0, 5).reached).toBe(false)
    })
})

const GATE = blockId('gate'), TOWER = blockId('arrow_tower'), COBBLE = blockId('cobble')

/** grid with a town center footprint at the origin (3x3x3 core) */
function townGrid(extra = []) {
    const core = []
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y < 3; y++) core.push([x, y, z, CORE])
    return createNavGrid({ size: SIZE, minY: MIN_Y, maxY: MAX_Y, town: [0, 0, 0] }, (vox, vi) => {
        for (let x = -SIZE / 2; x < SIZE / 2; x++) for (let z = -SIZE / 2; z < SIZE / 2; z++) vox[vi(x, -1, z)] = STONE
        for (const [x, y, z, id] of [...core, ...extra]) vox[vi(x, y, z)] = id
    })
}

/** follow a field, returning [x, y, z] per node */
function walk3(grid, field, x, z, y, maxSteps = 200) {
    const path = [[x, y, z]]
    for (let i = 0; i < maxSteps; i++) {
        const col = (x + grid.half) * grid.W + (z + grid.half)
        let slot = -1
        for (let s = 0; s < grid.L; s++) if (grid.nodeY[col * grid.L + s] + grid.minY === y) slot = s
        if (slot < 0) return { path, reached: false }
        const code = field.next[col * grid.L + slot]
        if (code === 0xfe) return { path, reached: true }
        if (code === 0xff) return { path, reached: false }
        const d = DIRS[code >> 3]
        x += d[0]
        z += d[1]
        const ncol = (x + grid.half) * grid.W + (z + grid.half)
        y = grid.nodeY[ncol * grid.L + (code & 7)] + grid.minY
        path.push([x, y, z])
    }
    return { path, reached: false }
}

function levels(grid, x, z) {
    const col = (x + grid.half) * grid.W + (z + grid.half)
    const out = []
    for (let s = 0; s < grid.L; s++) if (grid.nodeY[col * grid.L + s] !== 255) out.push(grid.nodeY[col * grid.L + s] + grid.minY)
    return out
}

describe('nav: walls are barriers', () => {
    it('has no standing node on a wall top, a tower or a gate; a single built floor is walkable', () => {
        const grid = townGrid([
            [6, 0, 0, WALL], [6, 1, 0, WALL],
            [6, 0, 3, COBBLE], [6, 1, 3, TOWER],
            [6, 0, 5, GATE], [6, 1, 5, GATE],
            [6, 0, -4, COBBLE],
        ])
        expect(levels(grid, 6, 0)).not.toContain(2)
        expect(levels(grid, 6, 3)).not.toContain(2)
        expect(levels(grid, 6, 5)).not.toContain(2)
        expect(levels(grid, 6, -4)).toContain(1)
    })

    it('breaks through a wall on a hill side instead of walking over its top', () => {
        // wall ring at radius 5; outside the ring on the +x side the ground is one block higher
        const extra = []
        for (let i = -5; i <= 5; i++) {
            for (const [x, z] of [[i, -5], [i, 5], [-5, i], [5, i]]) extra.push([x, 0, z, WALL], [x, 1, z, WALL])
        }
        for (let x = 6; x < SIZE / 2; x++) for (let z = -SIZE / 2; z < SIZE / 2; z++) extra.push([x, 0, z, STONE])
        const grid = townGrid(extra)
        const r = walk3(grid, grid.computeField('walker'), 10, 0, 1)
        expect(r.reached).toBe(true)
        const crossing = r.path.find(([x, , z]) => Math.max(Math.abs(x), Math.abs(z)) === 5)
        expect(crossing).toBeDefined()
        // through the wall's cells (breaking them), not on top of it
        expect(crossing[1]).toBe(0)
    })
})

describe('nav: goals', () => {
    it('keeps the town center goal when the town center blocks are gone', () => {
        const grid = townGrid()
        expect(walk3(grid, grid.computeField('walker'), 12, 12, 0).reached).toBe(true)
        const gone = []
        for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y < 3; y++) gone.push([x, y, z, 0])
        grid.setBlocks(gone)
        grid.update()
        const r = walk3(grid, grid.computeField('walker'), 12, 12, 0)
        expect(r.reached).toBe(true)
        const [x, , z] = r.path[r.path.length - 1]
        expect(Math.max(Math.abs(x), Math.abs(z))).toBe(2)
    })

    it('leads wreckers to a tower first, then falls back to the town center', () => {
        const grid = townGrid([[9, 0, 9, COBBLE], [9, 1, 9, TOWER]])
        expect(grid.hasTowers).toBe(true)
        const r = walk3(grid, grid.computeField('siege'), 14, 14, 0)
        expect(r.reached).toBe(true)
        const [x, , z] = r.path[r.path.length - 1]
        expect(Math.max(Math.abs(x - 9), Math.abs(z - 9))).toBe(1)
        // the tower is gone: the siege field leads to the town center
        grid.setBlocks([[9, 1, 9, 0], [9, 0, 9, 0]])
        grid.update()
        expect(grid.hasTowers).toBe(false)
        const r2 = walk3(grid, grid.computeField('siege'), 14, 14, 0)
        expect(r2.reached).toBe(true)
        const [x2, , z2] = r2.path[r2.path.length - 1]
        expect(Math.max(Math.abs(x2), Math.abs(z2))).toBe(2)
    })

    it('counts walls as siege goals only in walls mode', () => {
        const extra = []
        for (let z = 8; z <= 12; z++) extra.push([12, 0, z, WALL], [12, 1, z, WALL])
        const grid = townGrid(extra)
        const end = (field) => {
            const r = walk3(grid, field, 14, 10, 0)
            expect(r.reached).toBe(true)
            return r.path[r.path.length - 1]
        }
        const [wx, , wz] = end(grid.computeField('siege', { walls: true }))
        expect(Math.abs(wx - 12)).toBeLessThanOrEqual(1)
        expect(wz).toBeGreaterThanOrEqual(7)
        const [tx, , tz] = end(grid.computeField('siege'))
        expect(Math.max(Math.abs(tx), Math.abs(tz))).toBe(2)
    })
})
