/*
 *  Player inventory + 9-slot hotbar. Creative mode has unlimited items.
 */

import { EventEmitter } from 'events'
import { ITEMS, RECIPES } from './balance.js'

export const HOTBAR_SIZE = 9

export const PLACEABLE = Object.keys(ITEMS).filter((k) => ITEMS[k].kind !== 'resource')

export class Inventory extends EventEmitter {
    /**
     * @param {Record<string, number>} initial
     * @param {boolean} creative
     */
    constructor(initial, creative) {
        super()
        this.creative = creative
        /** @type {Record<string, number>} */
        this.items = {}
        for (const [k, v] of Object.entries(initial || {})) if (ITEMS[k] && v > 0) this.items[k] = v | 0
        /** @type {(string|null)[]} */
        this.hotbar = new Array(HOTBAR_SIZE).fill(null)
        this.selected = 0
        if (creative) {
            const defaults = ['stone_wall', 'iron_wall', 'gate', 'spikes', 'arrow_tower', 'cannon_tower', 'swordsman', 'archer', 'gunner']
            defaults.forEach((n, i) => (this.hotbar[i] = n))
        } else {
            for (const name of PLACEABLE) if (this.count(name) > 0) this._autoSlot(name)
        }
    }

    count(name) {
        return this.creative ? Infinity : this.items[name] || 0
    }

    get selectedItem() {
        const name = this.hotbar[this.selected]
        return name && this.count(name) > 0 ? name : null
    }

    select(i) {
        this.selected = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE
        this.emit('change')
    }

    /** put an item into a hotbar slot (removing it from any other slot) */
    assign(slot, name) {
        const existing = this.hotbar.indexOf(name)
        if (existing >= 0) this.hotbar[existing] = this.hotbar[slot]
        this.hotbar[slot] = name
        this.emit('change')
    }

    _autoSlot(name) {
        if (!PLACEABLE.includes(name) || this.hotbar.includes(name)) return
        const free = this.hotbar.indexOf(null)
        if (free >= 0) this.hotbar[free] = name
    }

    add(name, n = 1) {
        if (!ITEMS[name] || this.creative) return
        this.items[name] = (this.items[name] || 0) + n
        this._autoSlot(name)
        this.emit('change')
        this.emit('gained', name, n)
    }

    remove(name, n = 1) {
        if (this.creative) return true
        if (this.count(name) < n) return false
        this.items[name] -= n
        if (this.items[name] <= 0) delete this.items[name]
        this.emit('change')
        return true
    }

    /** @param {Record<string, number>} cost */
    canAfford(cost) {
        return Object.entries(cost).every(([k, v]) => this.count(k) >= v)
    }

    /** @param {typeof RECIPES[number]} recipe */
    craft(recipe) {
        if (!this.canAfford(recipe.cost)) return false
        if (!this.creative) for (const [k, v] of Object.entries(recipe.cost)) this.items[k] -= v
        for (const k of Object.keys(this.items)) if (this.items[k] <= 0) delete this.items[k]
        this.add(recipe.out, recipe.count)
        this.emit('change')
        return true
    }

    toJSON() {
        return this.creative ? {} : { ...this.items }
    }
}
