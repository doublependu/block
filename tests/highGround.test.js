/*
 *  High ground (plan 10 §2): a shot from above carries farther and lands
 *  harder; a tower on the ground plays exactly as it always did.
 */

import { describe, it, expect } from 'vitest'
import { reachAt, heightDamage, HIGH_GROUND, TOWERS } from '../src/game/balance.js'
import { towerTarget } from '../src/game/towers.js'
import { TOWER_COLUMN } from '../src/game/placing.js'

describe('reach from above', () => {
    it('on the flat, a shot reaches its range', () => {
        expect(reachAt(16, 0)).toBe(16)
    })
    it('grows as √(1 + h/R₀): the arrow tower 8 blocks up reaches 19.6, 16 up 22.6', () => {
        expect(reachAt(16, 8)).toBeCloseTo(19.6, 1)
        expect(reachAt(16, 16)).toBeCloseTo(22.63, 1)
        expect(reachAt(18, 8)).toBeCloseTo(21.6, 1)
        expect(reachAt(21, 16)).toBeCloseTo(27.9, 1)
    })
    it('is capped at 1.5× (from 1.25 R₀ up)', () => {
        expect(reachAt(16, 20)).toBeCloseTo(24, 5)
        expect(reachAt(16, 60)).toBeCloseTo(24, 5)
        expect(HIGH_GROUND.maxReach).toBe(1.5)
    })
    it('shrinks the same way uphill, but never below half', () => {
        expect(reachAt(16, -4)).toBeCloseTo(13.86, 1)
        expect(reachAt(16, -40)).toBe(8)
    })
})

describe('damage from above', () => {
    it('half the gain in impact speed: +6% at 4 up, +11% at 8, +21% at 16', () => {
        expect(heightDamage(16, 0)).toBe(1)
        expect(heightDamage(16, 4)).toBeCloseTo(1.059, 2)
        expect(heightDamage(16, 8)).toBeCloseTo(1.112, 2)
        expect(heightDamage(16, 16)).toBeCloseTo(1.207, 2)
    })
    it('capped at +25%, and at −10% uphill', () => {
        expect(heightDamage(16, 40)).toBe(1.25)
        expect(heightDamage(16, -12)).toBe(0.9)
    })
})

describe('tower targets', () => {
    const attacker = (x, y, z) => ({ alive: true, active: true, side: 'attacker', pos: [x, y, z] })
    const pick = (towerY, groundY, units) => {
        const from = [0.5, towerY + 1.5, 0.5]
        return towerTarget(from, towerY - TOWER_COLUMN, TOWERS.arrow.range, units, (u) => u.pos, () => true).best
    }
    it('a tower on the ground (on its column) reaches its range, as before', () => {
        const near = attacker(15.5, 8, 0.5), far = attacker(16.8, 8, 0.5)
        expect(pick(8 + TOWER_COLUMN, 8, [far])).toBe(null)
        expect(pick(8 + TOWER_COLUMN, 8, [near, far])).toBe(near)
    })
    it('the same tower 8 blocks higher picks up an attacker at 19 that a ground tower ignores', () => {
        const u = attacker(19.5, 8, 0.5)
        expect(pick(8 + TOWER_COLUMN, 8, [u])).toBe(null)
        expect(pick(8 + TOWER_COLUMN + 8, 8, [u])).toBe(u)
    })
    it('it used to be the other way: straight below a tall tower was out of a 16-block sphere', () => {
        // 12 flat, 14 down: the old 3D check (√(12² + 15.5²) > 16) missed it
        const u = attacker(12.5, 8, 0.5)
        expect(pick(8 + TOWER_COLUMN + 14, 8, [u])).toBe(u)
    })
    it('nearest first, and only what it can see', () => {
        const a = attacker(10.5, 8, 0.5), b = attacker(5.5, 8, 0.5)
        expect(pick(10, 8, [a, b])).toBe(b)
        const from = [0.5, 11.5, 0.5]
        expect(towerTarget(from, 8, 16, [a, b], (u) => u.pos, (q) => q[0] > 8).best).toBe(a)
    })
})
