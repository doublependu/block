import { describe, it, expect } from 'vitest'
import { waveBudget, composeWave } from '../src/game/waves.js'
import { UNITS, RECIPES } from '../src/game/balance.js'
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
