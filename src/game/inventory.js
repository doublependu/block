/*
 *  Player inventory + 9-slot hotbar. Creative mode has unlimited items.
 *
 *  The pickaxe is always owned and always on the hotbar (slot 1 unless you move
 *  it). It isn't counted or saved: world files and autosaves stay the same.
 *
 *  Recipes that need planks use logs when the planks run short (a log makes
 *  PLANKS_PER_LOG), so there's no crafting planks first. Dirt, sand and logs
 *  don't take a hotbar slot by themselves (digging fills the hotbar otherwise).
 */

import { EventEmitter } from 'events'
import { ITEMS, RECIPES, WEAPONS, weaponDps } from './balance.js'

export const HOTBAR_SIZE = 9

export const PLACEABLE = Object.keys(ITEMS).filter((k) => ITEMS[k].kind !== 'resource')

export const TOOL = 'pickaxe'

/** planks a log makes (the planks recipe) */
export const PLANKS_PER_LOG = 4

/** only on the hotbar if you put them there */
export const NO_AUTO_SLOT = new Set(['dirt', 'sand', 'log'])

/**
 * pure: what paying `cost` takes from stock, with logs standing in for missing
 * planks (the leftover planks of a cut log go back). null if it can't be paid.
 * @param {Record<string, number>} cost
 * @param {(name: string) => number} count
 * @returns {{take: Record<string, number>, give: Record<string, number>} | null}
 */
export function payment(cost, count) {
    const take = {}
    const give = {}
    for (const [k, v] of Object.entries(cost)) {
        if (k === 'planks' && count('planks') < v) {
            const short = v - count('planks')
            const logs = Math.ceil(short / PLANKS_PER_LOG)
            if (count('log') < logs + (cost.log || 0)) return null
            if (count('planks') > 0) take.planks = count('planks')
            take.log = (take.log || 0) + logs
            const left = logs * PLANKS_PER_LOG - short
            if (left > 0) give.planks = left
        } else {
            if (count(k) < v) return null
            take[k] = (take[k] || 0) + v
        }
    }
    if (take.log !== undefined && cost.log && count('log') < take.log) return null
    return { take, give }
}

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
        for (const [k, v] of Object.entries(initial || {})) if (ITEMS[k] && k !== TOOL && v > 0) this.items[k] = v | 0
        /** @type {(string|null)[]} */
        this.hotbar = new Array(HOTBAR_SIZE).fill(null)
        this.hotbar[0] = TOOL
        this.selected = 0
        /** the slot you were on before the pickaxe (Q swaps back to it) */
        this.lastSlot = null
        if (creative) {
            const defaults = ['stone_wall', 'iron_wall', 'gate', 'spikes', 'arrow_tower', 'cannon_tower', 'swordsman', 'archer']
            defaults.forEach((n, i) => (this.hotbar[i + 1] = n))
        } else {
            for (const name of PLACEABLE) if (this.count(name) > 0) this._autoSlot(name)
        }
    }

    count(name) {
        return this.creative || name === TOOL ? Infinity : this.items[name] || 0
    }

    /** the strongest weapon held (by damage per second), or 'none' */
    get bestWeapon() {
        let best = 'none'
        for (const name of Object.keys(WEAPONS)) {
            if (name !== 'none' && this.count(name) > 0 && weaponDps(name) > weaponDps(best)) best = name
        }
        return best
    }

    /** the selected hotbar item if it's a weapon, else null */
    get selectedWeapon() {
        const item = this.selectedItem
        return item && ITEMS[item].kind === 'weapon' ? item : null
    }

    /** select the hotbar slot with the best weapon, if it's on the hotbar */
    selectBestWeapon() {
        const i = this.hotbar.indexOf(this.bestWeapon)
        if (i >= 0 && i !== this.selected) this.select(i)
    }

    get selectedItem() {
        const name = this.hotbar[this.selected]
        return name && this.count(name) > 0 ? name : null
    }

    select(i) {
        const next = ((i % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE
        if (next !== this.selected && this.hotbar[this.selected] !== TOOL) this.lastSlot = this.selected
        this.selected = next
        this.emit('change')
    }

    /** take the pickaxe in hand */
    selectTool() {
        const i = this.hotbar.indexOf(TOOL)
        if (i >= 0 && i !== this.selected) this.select(i)
    }

    /** Q: to the pickaxe, or back to the slot you had before it */
    swapTool() {
        const i = this.hotbar.indexOf(TOOL)
        if (i < 0) return
        if (this.selected !== i) this.select(i)
        else if (this.lastSlot !== null && this.lastSlot !== i) this.select(this.lastSlot)
    }

    /**
     * Put an item into a hotbar slot (removing it from any other slot). The
     * pickaxe can be moved but never pushed off the hotbar.
     * @returns {boolean} false when it would have been
     */
    assign(slot, name) {
        const existing = this.hotbar.indexOf(name)
        if (existing >= 0) this.hotbar[existing] = this.hotbar[slot]
        else if (this.hotbar[slot] === TOOL) {
            const free = this.hotbar.indexOf(null)
            if (free < 0) return false
            this.hotbar[free] = TOOL
        }
        this.hotbar[slot] = name
        this.emit('change')
        return true
    }

    _autoSlot(name) {
        if (!PLACEABLE.includes(name) || NO_AUTO_SLOT.has(name) || this.hotbar.includes(name)) return
        const free = this.hotbar.indexOf(null)
        if (free >= 0) this.hotbar[free] = name
    }

    add(name, n = 1) {
        if (!ITEMS[name] || this.creative || name === TOOL) return
        this.items[name] = (this.items[name] || 0) + n
        this._autoSlot(name)
        this.emit('change')
        this.emit('gained', name, n)
    }

    remove(name, n = 1) {
        if (this.creative || name === TOOL) return true
        if (this.count(name) < n) return false
        this.items[name] -= n
        if (this.items[name] <= 0) delete this.items[name]
        this.emit('change')
        return true
    }

    /** @param {Record<string, number>} cost (logs stand in for missing planks) */
    canAfford(cost) {
        return this.creative || payment(cost, (k) => this.count(k)) !== null
    }

    /**
     * What a cost would take, for the recipe card: logs used for missing planks.
     * @param {Record<string, number>} cost
     */
    logsFor(cost) {
        if (this.creative || !cost.planks) return 0
        const p = payment(cost, (k) => this.count(k))
        return p ? (p.take.log || 0) - (cost.log || 0) : 0
    }

    /** @param {typeof RECIPES[number]} recipe */
    craft(recipe) {
        if (!this.creative) {
            const p = payment(recipe.cost, (k) => this.count(k))
            if (!p) return false
            for (const [k, v] of Object.entries(p.take)) this.items[k] -= v
            for (const [k, v] of Object.entries(p.give)) this.items[k] = (this.items[k] || 0) + v
            for (const k of Object.keys(this.items)) if (this.items[k] <= 0) delete this.items[k]
        }
        this.add(recipe.out, recipe.count)
        this.emit('change')
        this.emit('crafted', recipe.out)
        return true
    }

    /**
     * Craft up to `n` times (fewer if the stock runs out).
     * @param {typeof RECIPES[number]} recipe
     * @returns {number} how many were crafted
     */
    craftMany(recipe, n) {
        let done = 0
        while (done < n && this.craft(recipe)) done++
        return done
    }

    toJSON() {
        return this.creative ? {} : { ...this.items }
    }
}
