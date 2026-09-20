import { describe, it, expect } from 'vitest'
import { Inventory, payment } from '../src/game/inventory.js'
import { RECIPES } from '../src/game/balance.js'
import { towerPlacement, canPatch, TOWER_COLUMN } from '../src/game/placing.js'
import { AIR, blockId } from '../src/world/blocks.js'

const recipe = (out) => RECIPES.find((r) => r.out === out)

describe('crafting', () => {
    it('logs stand in for missing planks, and the rest of a cut log comes back as planks', () => {
        const count = (o) => (k) => o[k] || 0
        // 6 planks needed, 2 in stock: one log covers the other 4
        expect(payment({ planks: 6, cobble: 4 }, count({ planks: 2, log: 3, cobble: 4 }))).toEqual({ take: { planks: 2, log: 1, cobble: 4 }, give: {} })
        // none in stock: 2 logs make 8, 2 come back
        expect(payment({ planks: 6 }, count({ log: 2 }))).toEqual({ take: { log: 2 }, give: { planks: 2 } })
        // not enough logs either
        expect(payment({ planks: 6 }, count({ log: 1 }))).toBe(null)
        // a recipe that needs a log as well (the bow): the log is on top of the ones cut for planks
        expect(payment({ planks: 3, log: 1 }, count({ log: 1 }))).toBe(null)
        expect(payment({ planks: 3, log: 1 }, count({ log: 2 }))).toEqual({ take: { log: 2 }, give: { planks: 1 } })
        // enough planks: logs untouched
        expect(payment({ planks: 4 }, count({ planks: 4, log: 5 }))).toEqual({ take: { planks: 4 }, give: {} })
    })

    it('crafts a tower straight from logs', () => {
        const inv = new Inventory({ log: 2, cobble: 4 }, false)
        expect(inv.canAfford(recipe('arrow_tower').cost)).toBe(true)
        expect(inv.logsFor(recipe('arrow_tower').cost)).toBe(2)
        expect(inv.craft(recipe('arrow_tower'))).toBe(true)
        expect(inv.count('arrow_tower')).toBe(1)
        expect(inv.count('log')).toBe(0)
        expect(inv.count('planks')).toBe(2)
        expect(inv.count('cobble')).toBe(0)
    })

    it('crafts several at once, stopping when the stock runs out', () => {
        const inv = new Inventory({ cobble: 10 }, false)
        expect(inv.craftMany(recipe('stone_wall'), 5)).toBe(3)
        expect(inv.count('stone_wall')).toBe(6)
        expect(inv.count('cobble')).toBe(1)
        expect(inv.craftMany(recipe('stone_wall'), 5)).toBe(0)
    })

    it('keeps dirt, sand and logs off the hotbar unless you put them there', () => {
        const inv = new Inventory({ dirt: 5, cobble: 2 }, false)
        expect(inv.hotbar).not.toContain('dirt')
        expect(inv.hotbar).toContain('cobble')
        inv.add('sand', 3)
        inv.add('log', 2)
        inv.add('stone_wall', 2)
        expect(inv.hotbar).not.toContain('sand')
        expect(inv.hotbar).not.toContain('log')
        expect(inv.hotbar).toContain('stone_wall')
        expect(inv.assign(4, 'dirt')).toBe(true)
        expect(inv.hotbar[4]).toBe('dirt')
    })
})

describe('placing', () => {
    // a flat world: grass at y 7, air above; built blocks can be added
    const world = (extra = {}) => (x, y, z) => extra[`${x},${y},${z}`] ?? (y <= 7 ? blockId('grass') : AIR)

    it('a tower on the ground comes with its column', () => {
        const r = towerPlacement(world(), [3, 8, 3], 'arrow_tower', { cobble: 5 })
        expect(r.cells).toEqual([[3, 8, 3, 'cobble'], [3, 9, 3, 'cobble'], [3, 10, 3, 'arrow_tower']])
        expect(TOWER_COLUMN).toBe(2)
    })

    it('on a wall or a column it is just the tower', () => {
        const w = world({ '3,8,3': blockId('stone_wall'), '3,9,3': blockId('stone_wall') })
        expect(towerPlacement(w, [3, 10, 3], 'cannon_tower', { cobble: 0 }).cells).toEqual([[3, 10, 3, 'cannon_tower']])
    })

    it('says why it can not: cobble, room, someone standing there', () => {
        expect(towerPlacement(world(), [3, 8, 3], 'arrow_tower', { cobble: 1 }).reason).toMatch(/1 more/)
        const low = world({ '3,10,3': blockId('leaves') })
        expect(towerPlacement(low, [3, 8, 3], 'arrow_tower', { cobble: 5 }).reason).toMatch(/No room/)
        const busy = towerPlacement(world(), [3, 8, 3], 'arrow_tower', { cobble: 5, free: (x, y) => y !== 9 })
        expect(busy.reason).toMatch(/No room/)
        const hill = world({ '3,67,3': blockId('grass') })
        expect(towerPlacement(hill, [3, 68, 3], 'arrow_tower', { cobble: 5, maxY: 70 }).reason).toMatch(/Too high/)
    })

    it('patches only a hole made tonight, and only with the same block', () => {
        expect(canPatch(blockId('stone_wall'), 'stone_wall')).toBe(true)
        expect(canPatch(blockId('gate'), 'gate')).toBe(true)
        expect(canPatch(blockId('stone_wall'), 'cobble')).toBe(false)
        expect(canPatch(undefined, 'stone_wall')).toBe(false)
        // natural blocks are never in the night's damage, but never patchable either
        expect(canPatch(blockId('stone'), 'stone')).toBe(false)
    })
})
