import { describe, it, expect } from 'vitest'
import { readonly, violations } from '../tools/autoplay/bot/readonly.js'
import { findPath, stepCells } from '../tools/autoplay/bot/nav.js'
import { B, blockId } from '../src/world/blocks.js'

describe('autoplay: the read-only view', () => {
    class Thing {
        constructor() {
            this.hp = 10
            this.list = [{ a: 1 }, { a: 2 }]
            this.map = new Map([['k', { v: 3 }]])
        }
        getBlock(x) {
            return x * 2
        }
        heal() {
            this.hp = 100
        }
        get double() {
            return this.hp * 2
        }
    }

    it('reads, and calls methods that only read', () => {
        const t = readonly(new Thing())
        expect(t.hp).toBe(10)
        expect(t.double).toBe(20)
        expect(t.getBlock(4)).toBe(8)
        expect(t.list.map((x) => x.a)).toEqual([1, 2])
        expect([...t.list].length).toBe(2)
        expect(t.map.get('k').v).toBe(3)
        expect([...t.map.values()][0].v).toBe(3)
        expect(t.map.size).toBe(1)
    })

    it('refuses to change anything, however deep', () => {
        const raw = new Thing()
        const t = readonly(raw)
        const before = violations.count
        expect(() => (t.hp = 0)).toThrow()
        expect(() => t.heal()).toThrow()
        expect(() => (t.list[0].a = 5)).toThrow()
        expect(() => t.list.push(1)).toThrow()
        expect(() => t.map.get('k').v++).toThrow()
        expect(() => delete t.hp).toThrow()
        expect(raw.hp).toBe(10)
        expect(raw.list[0].a).toBe(1)
        expect(raw.map.get('k').v).toBe(3)
        expect(violations.count - before).toBe(6)
    })
})

describe('autoplay: path finding', () => {
    const WALL = blockId('stone_wall')
    /** a small world: stone below y = 0, grass at y = 0, and whatever `extra` adds */
    const world = (extra = {}) => (x, y, z) => {
        const k = `${x},${y},${z}`
        if (k in extra) return extra[k]
        if (y < 0) return B.stone
        if (y === 0) return B.grass
        return 0
    }
    const at = (p) => (x, y, z) => x === p[0] && y === p[1] && z === p[2]

    it('walks across open ground', () => {
        const path = findPath({ getBlock: world(), start: [0, 1, 0], isGoal: at([6, 1, 3]), toward: [6, 1, 3] })
        expect(path).not.toBeNull()
        expect(path[path.length - 1]).toMatchObject({ x: 6, y: 1, z: 3 })
        expect(path.every((s) => s.dig.length === 0)).toBe(true)
    })

    it('goes round a built wall and never digs it', () => {
        const extra = {}
        for (let z = -6; z <= 6; z++) for (const y of [1, 2]) extra[`3,${y},${z}`] = WALL
        const path = findPath({ getBlock: world(extra), start: [0, 1, 0], isGoal: at([6, 1, 0]), toward: [6, 1, 0] })
        expect(path).not.toBeNull()
        expect(path.some((s) => s.x === 3 && Math.abs(s.z) <= 6)).toBe(false)
        expect(path.every((s) => s.dig.every(([x, , z]) => !(x === 3 && Math.abs(z) <= 6)))).toBe(true)
    })

    it('digs a staircase down to a block underground, and not without digging', () => {
        const goal = [4, -4, 0]
        const isGoal = (x, y, z) => Math.abs(x - goal[0]) <= 1 && y === goal[1] + 1 && z === goal[2]
        const path = findPath({ getBlock: world(), start: [0, 1, 0], isGoal, toward: goal })
        expect(path).not.toBeNull()
        const dug = path.flatMap((s) => s.dig)
        expect(dug.length).toBeGreaterThan(4)
        // each step down is at most one block
        let y = 1
        for (const s of path) {
            expect(Math.abs(s.y - y)).toBeLessThanOrEqual(1)
            y = s.y
        }
        expect(findPath({ getBlock: world(), start: [0, 1, 0], isGoal, toward: goal, dig: false, maxNodes: 3000 })).toBeNull()
    })

    it('lists what a step needs open, top first', () => {
        expect(stepCells([0, 1, 0], { x: 1, y: 2, z: 0, kind: 'up', dig: [] })).toEqual([[0, 3, 0], [1, 3, 0], [1, 2, 0]])
        expect(stepCells([0, 1, 0], { x: 1, y: 0, z: 0, kind: 'down', dig: [] })).toEqual([[1, 2, 0], [1, 1, 0], [1, 0, 0]])
    })
})
