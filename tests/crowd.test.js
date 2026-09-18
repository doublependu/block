import { describe, it, expect } from 'vitest'
import { separate, CROWD } from '../src/game/crowd.js'

const body = (x, z, o = {}) => ({ x, y: 0, z, r: 0.3, h: 1.75, mass: 1, v: [0, 0, 0], ...o })

/** run the solver for a number of ticks, moving bodies by their pushes */
function settle(bodies, ticks) {
    for (let t = 0; t < ticks; t++) {
        separate(bodies)
        for (const b of bodies) {
            b.x += b.dx
            b.z += b.dz
        }
    }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z)

describe('crowd separation', () => {
    it('pushes two overlapping units apart to touching distance', () => {
        const a = body(0, 0), b = body(0.2, 0)
        settle([a, b], 5)
        expect(dist(a, b)).toBeGreaterThan(0.6 - 1e-6)
        expect(dist(a, b)).toBeLessThan(0.62)
        // along the line between them, symmetric for equal masses
        expect(a.z).toBeCloseTo(0)
        expect(a.x + b.x).toBeCloseTo(0.2)
    })

    it('splits the push by mass: the heavier unit moves less', () => {
        const you = body(0, 0, { mass: CROWD.mass.controlled }), grunt = body(0.55, 0)
        separate([you, grunt])
        expect(Math.abs(grunt.dx)).toBeCloseTo(Math.abs(you.dx) * CROWD.mass.controlled)
        const wall = body(0, 0, { mass: Infinity }), other = body(0.3, 0)
        separate([wall, other])
        expect(wall.dx).toBe(0)
        expect(other.dx).toBeGreaterThan(0)
    })

    it('never pushes a unit further than maxPush in one tick', () => {
        const a = body(0, 0), b = body(0, 0), c = body(0.01, 0.01)
        separate([a, b, c])
        for (const x of [a, b, c]) expect(Math.hypot(x.dx, x.dz)).toBeLessThanOrEqual(CROWD.maxPush + 1e-9)
    })

    it('spreads units standing on the same spot', () => {
        const list = [0, 1, 2, 3, 4, 5].map(() => body(5, 5))
        settle(list, 30)
        for (let i = 0; i < list.length; i++) {
            for (let j = i + 1; j < list.length; j++) expect(dist(list[i], list[j])).toBeGreaterThan(0.55)
        }
    })

    it('ignores units at different heights (on a wall top vs below it)', () => {
        const a = body(0, 0), b = body(0.1, 0, { y: 2 })
        expect(separate([a, b])).toBe(0)
        expect(a.dx).toBe(0)
    })

    it('stops a unit running into another without shoving it', () => {
        // a runs at b (+x), b stands still
        const a = body(0, 0, { v: [4, 0, 1] }), b = body(0.58, 0, { v: [0, 0, 0] })
        separate([a, b])
        expect(a.v[0]).toBeCloseTo(0)
        expect(b.v[0]).toBe(0)
        // sideways motion is kept
        expect(a.v[2]).toBe(1)
        expect(a.contacts).toBe(1)
        expect(b.contacts).toBe(1)
    })

    it('catches a fast unit one step before it would overlap', () => {
        // 0.9 m apart, closing at 10 m/s: 0.3 m in one step reaches the other body
        const a = body(0, 0, { v: [10, 0, 0] }), b = body(0.9, 0)
        expect(separate([a, b], { dt: 0.03 })).toBe(1)
        expect(a.v[0]).toBeCloseTo(0)
        // not yet overlapping, so no push
        expect(a.dx).toBe(0)
        const slow = body(0, 0, { v: [1, 0, 0] }), far = body(0.9, 0)
        expect(separate([slow, far], { dt: 0.03 })).toBe(0)
    })

    it('two units running at each other both stop', () => {
        const a = body(0, 0, { v: [3, 0, 0] }), b = body(0.6, 0, { v: [-3, 0, 0] })
        separate([a, b])
        expect(a.v[0]).toBeCloseTo(0)
        expect(b.v[0]).toBeCloseTo(0)
    })

    it('counts allies separately from enemies', () => {
        const a = body(0, 0, { side: 1 }), b = body(0.5, 0, { side: 1 }), c = body(-0.5, 0, { side: 0 })
        separate([a, b, c])
        expect(a.contacts).toBe(2)
        expect(a.allyContacts).toBe(1)
    })

    it('leaves units apart from each other alone', () => {
        const a = body(0, 0, { v: [1, 0, 0] }), b = body(3, 0)
        expect(separate([a, b])).toBe(0)
        expect(a.v[0]).toBe(1)
    })
})
