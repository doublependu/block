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
