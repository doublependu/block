import { describe, it, expect } from 'vitest'
import { isBarrierTop, collapseCandidates, townRuinBlocks, townRuinCount, pickStructureTarget, widenTarget } from '../src/game/siege.js'
import { blockId } from '../src/world/blocks.js'

const STONE = blockId('stone'), WALL = blockId('stone_wall'), COBBLE = blockId('cobble'), TOWER = blockId('arrow_tower'), PLANKS = blockId('planks')

/** flat stone ground at y=-1, plus extra blocks; `removed` keys read as air */
function world(extra = []) {
    const m = new Map()
    for (const [x, y, z, id] of extra) m.set(`${x},${y},${z}`, id)
    const get = (x, y, z) => {
        const k = `${x},${y},${z}`
        if (m.has(k)) return m.get(k)
        return y < 0 ? STONE : 0
    }
    get.remove = (x, y, z) => m.set(`${x},${y},${z}`, 0)
    return get
}

/** remove a block and let everything unsupported fall, like Demolition does */
function cascade(get, x, y, z) {
    get.remove(x, y, z)
    const fell = []
    const queue = [[x, y, z]]
    while (queue.length) {
        const [a, b, c] = queue.shift()
        for (const p of collapseCandidates(get, a, b, c)) {
            get.remove(...p)
            fell.push(p.join(','))
            queue.push(p)
        }
    }
    return fell
}

describe('siege rules', () => {
    it('knows wall tops and tower tops from floors', () => {
        const get = world([[0, 0, 0, WALL], [0, 1, 0, WALL], [2, 0, 0, PLANKS], [4, 0, 0, TOWER], [6, 0, 0, STONE], [6, 1, 0, STONE]])
        expect(isBarrierTop(get, 0, 2, 0)).toBe(true)
        expect(isBarrierTop(get, 2, 1, 0)).toBe(false)
        expect(isBarrierTop(get, 4, 1, 0)).toBe(true)
        expect(isBarrierTop(get, 6, 2, 0)).toBe(false)
    })

    it('brings a tower down when its column is cut, but a wall holds on to its neighbours', () => {
        const tower = world([[0, 0, 0, COBBLE], [0, 1, 0, COBBLE], [0, 2, 0, TOWER]])
        expect(cascade(tower, 0, 0, 0).sort()).toEqual(['0,1,0', '0,2,0'])

        const wall = []
        for (let x = -3; x <= 3; x++) wall.push([x, 0, 0, WALL], [x, 1, 0, WALL])
        expect(cascade(world(wall), 0, 0, 0)).toEqual([])

        // a tower on a wall corner falls when the block under it goes, even with wall blocks beside it
        const corner = world([[0, 0, 0, COBBLE], [0, 1, 0, COBBLE], [0, 2, 0, TOWER], [1, 0, 0, WALL], [1, 1, 0, WALL], [0, 0, 1, WALL], [0, 1, 1, WALL]])
        expect(cascade(corner, 0, 1, 0)).toEqual(['0,2,0'])
    })

    it('crumbles the town center in order, the last blocks only at 0 hp', () => {
        const blocks = townRuinBlocks([0, 8, 0])
        expect(blocks.length).toBe(28)
        expect(blocks[0]).toEqual([0, 11, 0])
        expect(new Set(blocks.map((b) => b.join(','))).size).toBe(28)
        expect(townRuinCount(1, 28)).toBe(0)
        expect(townRuinCount(0.8, 28)).toBe(0)
        expect(townRuinCount(0.79, 28)).toBe(1)
        expect(townRuinCount(0.001, 28)).toBeLessThanOrEqual(24)
        expect(townRuinCount(0, 28)).toBe(28)
        let last = 0
        for (let f = 1; f >= 0; f -= 0.01) {
            const n = townRuinCount(f, 28)
            expect(n).toBeGreaterThanOrEqual(last)
            last = n
        }
    })

    it('picks towers, then what holds a tower up, then walls', () => {
        const get = world([[1, 0, 0, WALL], [1, 1, 0, WALL], [-1, 0, 1, COBBLE], [-1, 1, 1, COBBLE], [-1, 2, 1, COBBLE], [-1, 3, 1, COBBLE], [-1, 4, 1, TOWER]])
        const p = [0.5, 0, 0.5]
        expect(pickStructureTarget(get, p).kind).toBe('support')
        expect(pickStructureTarget(get, p).blk.slice(0, 3)).toEqual([-1, 0, 1])
        const withTower = world([[1, 0, 0, WALL], [0, 2, 1, TOWER]])
        expect(pickStructureTarget(withTower, p).kind).toBe('tower')
        const walls = world([[1, 0, 0, WALL]])
        expect(pickStructureTarget(walls, p).kind).toBe('wall')
        expect(pickStructureTarget(walls, p, { walls: false })).toBe(null)
    })

    it('widens a breach along the wall', () => {
        const get = world([[1, 0, 0, WALL], [1, 1, 0, WALL], [1, 0, 2, WALL]])
        get.remove(1, 0, 1)
        const next = widenTarget(get, 1, 0, 1, [0.5, 0, 1.5])
        expect(next).not.toBe(null)
        expect([[1, 0, 0], [1, 1, 0], [1, 0, 2]].map((b) => b.join(','))).toContain(next.slice(0, 3).join(','))
    })
})
