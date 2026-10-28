import { describe, it, expect } from 'vitest'
import { move, inventoryCells, readHotbar, Inventory, PICKAXE_STAYS, HOTBAR_SIZE } from '../src/game/inventory.js'

// the Build panel's tap, then tap (plan 13 §7.2)
const bar = () => ['pickaxe', 'cobble', 'planks', null, 'wood_sword', null, null, null, null]

describe('moving items between the inventory and the hotbar (plan 13 §7)', () => {
    it('highlights an item on the first tap, and nothing for an empty slot or cell', () => {
        expect(move(bar(), null, { hotbar: 1 }).picked).toEqual({ hotbar: 1 })
        expect(move(bar(), null, { item: 'gate' }).picked).toEqual({ item: 'gate' })
        expect(move(bar(), null, { hotbar: 3 }).picked).toBe(null)
        expect(move(bar(), null, { item: null }).picked).toBe(null)
        expect(move(bar(), null, { hotbar: 1 }).hotbar).toEqual(bar())
    })

    it('cancels on the same one again, and highlights another inventory item instead', () => {
        expect(move(bar(), { hotbar: 1 }, { hotbar: 1 })).toEqual({ hotbar: bar(), picked: null })
        expect(move(bar(), { item: 'gate' }, { item: 'gate' })).toEqual({ hotbar: bar(), picked: null })
        expect(move(bar(), { item: 'gate' }, { item: 'spikes' })).toEqual({ hotbar: bar(), picked: { item: 'spikes' } })
        expect(move(bar(), { item: 'gate' }, { item: null })).toEqual({ hotbar: bar(), picked: null })
    })

    it('an inventory item onto a hotbar slot with something in it: it takes the slot, the other goes back', () => {
        const r = move(bar(), { item: 'gate' }, { hotbar: 2 })
        expect(r.hotbar).toEqual(['pickaxe', 'cobble', 'gate', null, 'wood_sword', null, null, null, null])
        expect(r.picked).toBe(null)
        // planks are off the hotbar now, so they're in the inventory
        expect(inventoryCells(r.hotbar, (k) => ({ planks: 4, gate: 1, cobble: 2, wood_sword: 1 })[k] || 0)).toContain('planks')
    })

    it('an inventory item onto an empty hotbar slot: it goes there', () => {
        expect(move(bar(), { item: 'gate' }, { hotbar: 3 }).hotbar).toEqual(['pickaxe', 'cobble', 'planks', 'gate', 'wood_sword', null, null, null, null])
    })

    it('a hotbar item onto an inventory item: they swap', () => {
        expect(move(bar(), { hotbar: 2 }, { item: 'gate' }).hotbar).toEqual(['pickaxe', 'cobble', 'gate', null, 'wood_sword', null, null, null, null])
    })

    it('a hotbar item onto an empty inventory cell: it comes off the hotbar, the slot is empty', () => {
        expect(move(bar(), { hotbar: 2 }, { item: null }).hotbar).toEqual(['pickaxe', 'cobble', null, null, 'wood_sword', null, null, null, null])
    })

    it('a hotbar item onto another hotbar slot: they swap, or it moves to an empty one', () => {
        expect(move(bar(), { hotbar: 1 }, { hotbar: 4 }).hotbar).toEqual(['pickaxe', 'wood_sword', 'planks', null, 'cobble', null, null, null, null])
        expect(move(bar(), { hotbar: 1 }, { hotbar: 8 }).hotbar).toEqual(['pickaxe', null, 'planks', null, 'wood_sword', null, null, null, 'cobble'])
    })

    it('the pickaxe changes slots but never leaves the hotbar', () => {
        expect(move(bar(), { hotbar: 0 }, { hotbar: 5 }).hotbar).toEqual([null, 'cobble', 'planks', null, 'wood_sword', 'pickaxe', null, null, null])
        expect(move(bar(), { hotbar: 0 }, { item: null })).toEqual({ hotbar: bar(), picked: null, reason: PICKAXE_STAYS })
        expect(move(bar(), { hotbar: 0 }, { item: 'gate' })).toEqual({ hotbar: bar(), picked: null, reason: PICKAXE_STAYS })
        // something put on its slot: it makes way, to a free one
        expect(move(bar(), { item: 'gate' }, { hotbar: 0 }).hotbar).toEqual(['gate', 'cobble', 'planks', 'pickaxe', 'wood_sword', null, null, null, null])
    })

    it('with a full hotbar, an item can still take a slot, but not the pickaxe\'s', () => {
        const full = ['pickaxe', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'].map((n) => (n === 'pickaxe' ? n : 'cobble planks gate spikes stone_wall iron_wall archer swordsman'.split(' ')[Number(n.slice(1)) - 1]))
        expect(move(full, { item: 'wood_sword' }, { hotbar: 3 }).hotbar[3]).toBe('wood_sword')
        expect(move(full, { item: 'wood_sword' }, { hotbar: 0 })).toEqual({ hotbar: full, picked: null, reason: PICKAXE_STAYS })
    })

    it('never puts iron or gold on the hotbar', () => {
        expect(move(bar(), { item: 'iron' }, { hotbar: 3 }).reason).toMatch(/hotbar/)
        expect(move(bar(), { hotbar: 2 }, { item: 'gold' }).reason).toMatch(/hotbar/)
    })

    it('the inventory is what you own off the hotbar, then empty cells to the end of the row', () => {
        const count = (k) => ({ cobble: 3, planks: 4, gate: 1, iron: 2, wood_sword: 1 })[k] || 0
        const cells = inventoryCells(bar(), count)
        expect(cells.filter(Boolean)).toEqual(['gate', 'iron'])
        expect(cells.length % HOTBAR_SIZE).toBe(0)
        expect(cells.filter((c) => c === null).length).toBeGreaterThanOrEqual(1)
        // a full row still gets one more, empty
        expect(inventoryCells([], (k) => (['cobble', 'planks', 'gate', 'spikes', 'iron'].includes(k) ? 1 : 0), 5).filter((c) => c === null).length).toBe(5)
    })

    it('reads a saved hotbar back, and turns away a broken one', () => {
        expect(readHotbar(bar())).toEqual(bar())
        expect(readHotbar(undefined)).toBe(null)
        expect(readHotbar(['pickaxe'])).toBe(null)
        // unknown names and resources go, each item once, and the pickaxe is always on it
        expect(readHotbar(['dragon', 'iron', 'cobble', 'cobble', null, null, null, null, null])).toEqual(['pickaxe', null, 'cobble', null, null, null, null, null, null])
    })

    it('keeps an item you took off the hotbar off it when you get more', () => {
        const inv = new Inventory({ cobble: 3, planks: 2 }, false)
        const slot = inv.hotbar.indexOf('cobble')
        inv.tapMove({ hotbar: slot }, { item: null })
        expect(inv.hotbar).not.toContain('cobble')
        inv.add('cobble', 1)
        expect(inv.hotbar).not.toContain('cobble')
        // put it back on, and it's an ordinary item again
        inv.tapMove({ item: 'cobble' }, { hotbar: 5 })
        expect(inv.hotbar[5]).toBe('cobble')
        // something new still finds a slot by itself
        inv.add('gate', 1)
        expect(inv.hotbar).toContain('gate')
    })
})
