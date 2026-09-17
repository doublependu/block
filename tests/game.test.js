import { describe, it, expect } from 'vitest'
import { waveBudget, composeWave, compassName, pickFronts, spawnPoint } from '../src/game/waves.js'
import { UNITS, RECIPES, SPAWN_RADIUS, FRONT_ARC, TWO_FRONTS_FROM_NIGHT } from '../src/game/balance.js'
import { shouldPlayOpening, openingFront } from '../src/game/opening.js'
import { createGenerator } from '../src/world/gen/index.js'
import { Inventory } from '../src/game/inventory.js'
import { DayCycle } from '../src/game/cycle.js'
import { normaliseClipName, holdForItem } from '../src/characters/contract.js'

const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

describe('waves', () => {
    it('grows with the night level and with defences', () => {
        expect(waveBudget(2)).toBeGreaterThan(waveBudget(1))
        expect(waveBudget(10)).toBeGreaterThan(waveBudget(9))
        expect(waveBudget(3, 200)).toBeGreaterThan(waveBudget(3, 0))
    })

    it('spends the budget only on unlocked attackers', () => {
        for (const level of [1, 3, 6, 12]) {
            const budget = waveBudget(level)
            const list = composeWave(level, budget, seeded(level))
            const cost = list.reduce((n, t) => n + UNITS[t].cost, 0)
            expect(cost).toBeLessThanOrEqual(budget)
            expect(cost).toBeGreaterThan(budget - 1)
            for (const t of list) {
                expect(UNITS[t].side).toBe('attacker')
                expect(UNITS[t].unlockNight).toBeLessThanOrEqual(level)
            }
        }
    })
})

const angleDiff = (a, b) => {
    const d = Math.abs(a - b) % (Math.PI * 2)
    return d > Math.PI ? Math.PI * 2 - d : d
}

describe('attack fronts', () => {
    it('names compass directions (north is +z, east is +x)', () => {
        expect(compassName(0)).toBe('north')
        expect(compassName(Math.PI / 2)).toBe('east')
        expect(compassName(Math.PI)).toBe('south')
        expect(compassName(-Math.PI / 2)).toBe('west')
        expect(compassName(Math.PI * 1.75)).toBe('north-west')
    })

    it('uses one front early, two later, and moves away from the previous front', () => {
        const rnd = seeded(7)
        for (let i = 0; i < 50; i++) {
            const prev = rnd() * Math.PI * 2
            const [a] = pickFronts(rnd, 1, prev)
            expect(pickFronts(rnd, 1, prev).length).toBe(1)
            expect(angleDiff(a, prev)).toBeGreaterThanOrEqual(Math.PI / 3 - 1e-9)
            const two = pickFronts(rnd, TWO_FRONTS_FROM_NIGHT)
            expect(two.length).toBe(2)
            expect(angleDiff(two[0], two[1])).toBeGreaterThan(Math.PI * 0.5)
        }
    })

    it('spawns on land, on the ring, inside the arc (default world)', () => {
        const gen = createGenerator(1, 'default-valley', 192)
        const rnd = seeded(3)
        const center = [0, 8, 0]
        for (let i = 0; i < 16; i++) {
            const angle = (i / 16) * Math.PI * 2
            for (let t = 0; t < 4; t++) {
                const p = spawnPoint({ standY: gen.surfaceY, isWater: (x, z) => gen.surfaceY(x, z) <= 1, half: 96, center, angle, rnd })
                expect(p).not.toBe(null)
                const r = Math.hypot(p[0] - center[0], p[2] - center[2])
                expect(r).toBeLessThanOrEqual(SPAWN_RADIUS[1] + 1)
                expect(r).toBeGreaterThanOrEqual(12)
                expect(Math.abs(p[0])).toBeLessThan(96)
                expect(Math.abs(p[2])).toBeLessThan(96)
                expect(angleDiff(Math.atan2(p[0], p[2]), angle)).toBeLessThanOrEqual(FRONT_ARC + 0.1)
                expect(gen.surfaceY(Math.floor(p[0]), Math.floor(p[2]))).toBeGreaterThan(1)
            }
        }
    })
})

describe('opening raid', () => {
    const fresh = { mode: 'survival', day: 1, nightLevel: 1 }

    it('plays only for fresh survival games', () => {
        expect(shouldPlayOpening(fresh)).toBe(true)
        expect(shouldPlayOpening(fresh, { resumed: true })).toBe(false)
        expect(shouldPlayOpening({ ...fresh, mode: 'creative' })).toBe(false)
        expect(shouldPlayOpening({ ...fresh, day: 4 })).toBe(false)
        expect(shouldPlayOpening({ ...fresh, nightLevel: 2 })).toBe(false)
        expect(shouldPlayOpening(fresh, { search: '?autoplay&intro=0' })).toBe(false)
        expect(shouldPlayOpening(fresh, { search: '?autoplay' })).toBe(true)
    })

    it('comes from a gate direction', () => {
        const rnd = seeded(11)
        for (let i = 0; i < 20; i++) expect([0, 0.5, 1, 1.5]).toContain(openingFront(rnd) / Math.PI)
    })

    it('has no time limit and is not a counted day or night', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1 })
        c.startOpening()
        expect(c.phase).toBe('night')
        expect(c.activeLevel).toBe(0)
        c.update(100000, { damageRemaining: 0 })
        expect(c.phase).toBe('night')
        c.endNight('lost')
        c.update(5, { damageRemaining: 0 })
        expect(c.phase).toBe('day')
        expect(c.wasOpening).toBe(true)
        expect(c.day).toBe(1)
        expect(c.nightLevel).toBe(1)
        // the next night is a normal night 1
        c.startNight()
        c.update(11, { damageRemaining: 0 })
        expect(c.activeLevel).toBe(1)
        c.endNight('survived')
        c.update(5, { damageRemaining: 0 })
        expect(c.wasOpening).toBe(false)
        expect(c.day).toBe(2)
        expect(c.nightLevel).toBe(2)
    })
})

describe('inventory', () => {
    it('crafts when affordable and fills the hotbar', () => {
        const inv = new Inventory({ log: 2 }, false)
        const planks = RECIPES.find((r) => r.out === 'planks')
        expect(inv.craft(planks)).toBe(true)
        expect(inv.count('planks')).toBe(4)
        expect(inv.count('log')).toBe(1)
        expect(inv.hotbar).toContain('planks')
        const tower = RECIPES.find((r) => r.out === 'arrow_tower')
        expect(inv.craft(tower)).toBe(false)
    })

    it('is unlimited in creative mode', () => {
        const inv = new Inventory({}, true)
        expect(inv.count('cannon_tower')).toBe(Infinity)
        expect(inv.remove('cannon_tower', 99)).toBe(true)
        expect(inv.toJSON()).toEqual({})
    })
})

describe('day cycle', () => {
    it('runs day -> dusk -> night -> dawn -> day', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1 })
        const phases = []
        c.on('phase', (p) => phases.push(p))
        c.update(c.dayLength + 1, { damageRemaining: 0 })
        c.update(11, { damageRemaining: 0 })
        expect(c.phase).toBe('night')
        c.endNight('survived')
        c.update(5, { damageRemaining: 3 })
        expect(c.phase).toBe('dawn') // still rebuilding
        c.update(1, { damageRemaining: 0 })
        expect(phases).toEqual(['dusk', 'night', 'dawn', 'day'])
        expect(c.day).toBe(2)
        expect(c.nightLevel).toBe(2)
    })

    it('does not grow the next night after a loss, and creative days never end', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 4 })
        c.startNight()
        c.update(11, { damageRemaining: 0 })
        c.endNight('lost')
        expect(c.nightLevel).toBe(4)
        const k = new DayCycle({ mode: 'creative', day: 1, nightLevel: 1 })
        k.update(100000, { damageRemaining: 0 })
        expect(k.phase).toBe('day')
        k.startNight(15)
        expect(k.activeLevel).toBe(15)
    })
})

describe('character contract', () => {
    it('normalises clip names from other tools', () => {
        expect(normaliseClipName('Armature|Walk')).toBe('walk')
        expect(normaliseClipName('mine block')).toBe('mine')
        expect(normaliseClipName('Hold Bow')).toBe('hold_bow')
        expect(normaliseClipName('Death')).toBe('die')
    })

    it('maps items to hold poses', () => {
        expect(holdForItem('bow')).toBe('hold_bow')
        expect(holdForItem('gun')).toBe('hold_gun')
        expect(holdForItem('block')).toBe('hold_item')
        expect(holdForItem(null)).toBe(null)
    })
})
