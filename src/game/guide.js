/*
 *  Tips for the first few days, for a player who is slow to get going.
 *  And, for the first nights, a tip at dusk: shoot from the wall.
 *
 *  A tip only shows when nothing has happened for a while (no mining, crafting
 *  or placing): a busy player never sees one. Each tip is one step (wood,
 *  stone, crafting, defences, iron and gold) with a marker on where to do it,
 *  and it goes away as soon as that step is done. Done steps are remembered in
 *  the settings, so a returning player isn't told again. There's also a
 *  once-a-day reminder a minute before night.
 *
 *  The step logic (stepTips, completes, suggestCrafts, tipText) is pure; the
 *  Guide class wires it to the session, the HUD card and the markers.
 */

import { RECIPES, ITEMS } from './balance.js'
import { B, BLOCK_BY_ID } from '../world/blocks.js'
import { isBarrierTop } from './siege.js'
import { getSetting, setSetting } from '../core/settings.js'
import { label } from '../ui/hud.js'

export const TIPS = {
    /** survival days that get tips */
    days: 3,
    /** seconds with no progress before a tip: the first one of the game, then the rest */
    firstDelay: 25,
    delay: 40,
    /** the night reminder: this many seconds before night, shown this long */
    prepAt: 60,
    prepFor: 12,
    /** the ✓ after a step is done */
    doneFor: 2.5,
    /** the dusk tip (shoot from the wall) comes on nights up to this one, until you've been up there at night */
    wallNights: 3,
    /** it stays up this long into the night */
    wallFor: 25,
    /** how far to look for a tree, a dig spot and ore (blocks) */
    treeRadius: 40,
    digRadius: 16,
    oreRadius: 24,
    /** scanning budget per frame (ms): a step can run a column or two over it, so this keeps it under 1 ms */
    scanMs: 0.75,
}

/** the steps, in the order they're suggested */
export const STEPS = ['wood', 'stone', 'craft', 'defend', 'ore']

/** placing one of these counts as building defences */
const DEFENCES = new Set(['stone_wall', 'iron_wall', 'gate', 'spikes', 'arrow_tower', 'cannon_tower'])

/**
 * pure: which step an event completes, if any.
 * @param {'gained'|'crafted'|'placed'|'patched'} event
 * @param {string} item
 * @returns {string|null}
 */
export function completes(event, item) {
    if (event === 'gained') {
        if (item === 'log') return 'wood'
        if (item === 'cobble') return 'stone'
        if (item === 'iron' || item === 'gold') return 'ore'
    }
    if (event === 'crafted') return 'craft'
    if (event === 'placed' && (DEFENCES.has(item) || ITEMS[item]?.kind === 'unit')) return 'defend'
    return null
}

/**
 * @typedef {object} TipState
 * @property {Set<string>} done steps done (saved)
 * @property {number} idle seconds without progress, counted only while a tip could show
 * @property {string|null} shown the step whose tip is up
 * @property {boolean} any a tip has been shown this game (the first one comes sooner)
 * @property {number} prepDay the day the night reminder was last shown
 * @property {number} prepLeft seconds the night reminder stays up
 */

/** @returns {TipState} */
export function newTipState(done = []) {
    return { done: new Set(done), idle: 0, shown: null, any: false, prepDay: 0, prepLeft: 0 }
}

/**
 * pure: the first step not done yet that's open (iron and gold wait for day 2,
 * or for the four basics).
 * @param {Set<string>} done
 * @param {number} day
 */
export function openStep(done, day) {
    for (const id of STEPS) {
        if (done.has(id)) continue
        if (id === 'ore' && day < 2 && !['wood', 'stone', 'craft', 'defend'].every((s) => done.has(s))) continue
        return id
    }
    return null
}

/**
 * pure: move the tips on by `dt` seconds; returns the tip to show ('prep' for
 * the night reminder), or null. Mutates `st`.
 * @param {TipState} st
 * @param {object} c
 * @param {number} c.dt
 * @param {boolean} c.enabled tips on, survival
 * @param {number} c.day
 * @param {string} c.phase
 * @param {boolean} c.busy a panel or banner is up, or you aren't your builder
 * @param {number} c.timeToNight seconds
 * @returns {string|null}
 */
export function stepTips(st, { dt, enabled, day, phase, busy, timeToNight }) {
    if (!enabled || day > TIPS.days || phase !== 'day') return null
    // the night reminder, once a day
    if (st.prepLeft > 0) st.prepLeft = Math.max(0, st.prepLeft - dt)
    else if (timeToNight <= TIPS.prepAt && st.prepDay !== day) {
        st.prepDay = day
        st.prepLeft = TIPS.prepFor
    }
    if (busy) return null
    if (st.prepLeft > 0) return 'prep'
    const step = openStep(st.done, day)
    if (!step) return null
    if (st.shown === step) return step
    st.shown = null
    st.idle += dt
    if (st.idle < (st.any ? TIPS.delay : TIPS.firstDelay)) return null
    st.shown = step
    st.any = true
    return step
}

/**
 * pure: something happened. Any progress restarts the wait for the next tip;
 * returns the step it completed (newly), if any. Mutates `st`.
 * @param {TipState} st
 * @param {'gained'|'crafted'|'placed'|'patched'} event
 * @param {string} item
 */
export function noteProgress(st, event, item) {
    st.idle = 0
    const step = completes(event, item)
    if (!step || st.done.has(step)) return null
    st.done.add(step)
    if (st.shown === step) st.shown = null
    return step
}

/** what's worth crafting first, most useful first */
const CRAFT_PRIORITY = ['arrow_tower', 'stone_wall', 'gate', 'archer', 'swordsman', 'iron_wall', 'cannon_tower', 'spikes', 'planks', 'stone_sword', 'bow']

/**
 * pure: up to `n` useful recipes the inventory can afford right now.
 * @param {{canAfford: (cost: Record<string, number>) => boolean}} inv
 */
export function suggestCrafts(inv, n = 3) {
    const out = []
    for (const name of CRAFT_PRIORITY) {
        const r = RECIPES.find((x) => x.out === name)
        if (r && inv.canAfford(r.cost)) out.push(r)
        if (out.length >= n) break
    }
    return out
}

/** "Arrow tower (6 planks, 4 cobblestone)" */
const recipeText = (r) => `${r.count > 1 ? r.count + ' × ' : ''}${label(r.out)} (${Object.entries(r.cost).map(([k, v]) => `${v} ${label(k).toLowerCase()}`).join(', ')})`

/**
 * pure: a tip's wording. Desktop and touch name different controls.
 * @param {string} id a step, or 'prep'
 * @param {{touch?: boolean, crafts?: any[], timeToNight?: number, ranged?: string | null}} [o] ranged: the bow or musket you have
 * @returns {{title: string, text: string, after: string}} after: the line shown once it's done
 */
export function tipText(id, { touch = false, crafts = [], timeToNight = 60, ranged = null } = {}) {
    const dig = touch ? 'hold ⛏' : 'hold left click'
    const place = touch ? 'tap ▣' : 'right click'
    const build = touch ? 'Build' : 'Build (B)'
    switch (id) {
        case 'wood':
            return { title: 'Gather wood', text: `Trees grow outside the walls. Walk up to a trunk and ${dig} to chop logs. Recipes that need planks cut them from your logs (1 log makes 4).`, after: 'Logs! Recipes in ' + build + ' use them for planks.' }
        case 'stone':
            return { title: 'Dig for stone', text: `Stone starts 4 blocks under the grass. Take the pickaxe (slot 1), look down and ${dig} to dig. Stone drops cobblestone. The stone plaza can't be dug.`, after: 'Cobblestone makes stone walls and towers.' }
        case 'craft':
            return crafts.length
                ? { title: 'Craft defences', text: `You can make these now in ${build}: ${crafts.map(recipeText).join('; ')}.`, after: 'Crafted. Now place it.' }
                : { title: 'Craft defences', text: `Open ${build} to see what you can make: cobblestone becomes stone walls, and with wood it makes arrow towers.`, after: 'Crafted. Now place it.' }
        case 'defend':
            return { title: 'Build up your defences', text: `Select a wall, tower or troop and ${place} to place it. The gates are the weak spots (half a stone wall's hp): back them with stone walls, put arrow towers just inside the wall, and troops near the gates. Attackers can come from any side.`, after: 'Every block counts tonight.' }
        case 'ore':
            return { title: 'Find iron and gold', text: 'Iron ore (stone with tan specks) is 6+ blocks down; gold (yellow specks) is deeper, below height 2. Troops need gold; iron walls and cannon towers need iron. Surviving a night pays both too.', after: 'Ore! Troops and iron walls are in reach.' }
        case 'prep': {
            const t = Math.max(0, Math.round(timeToNight))
            const when = t >= 50 ? 'in about a minute' : `in ${t} s`
            const bow = ranged ? '' : ` A bow (${build}) lets you shoot from the wall.`
            return { title: 'Night is coming', text: `The attack starts ${when}. You'll fight with your best weapon; R lets you play a troop or watch from above${touch ? '' : ', and N starts the night early'}.${bow}`, after: '' }
        }
        case 'wall':
            return {
                title: 'Shoot from the wall',
                text: `Climb the step beside a gate onto the wall and shoot with your ${ranged || 'bow'}. Attackers with swords can't reach you up there, only their archers can.`,
                after: 'Up here only raider archers can hit you.',
            }
    }
    return { title: '', text: '', after: '' }
}

/** columns in growing square rings around (cx, cz), nearest first */
function* ringColumns(cx, cz, radius) {
    yield [cx, cz]
    for (let r = 1; r <= radius; r++) {
        for (let i = -r; i < r; i++) {
            yield [cx + i, cz - r]
            yield [cx + r, cz + i]
            yield [cx - i, cz + r]
            yield [cx - r, cz - i]
        }
    }
}

/**
 * Looks column by column outward from a point, a little every frame, for the
 * first column where `test` finds something. Tests read loaded chunks only
 * (peekLoaded): generating unloaded terrain here would cost frames.
 */
class Scan {
    /**
     * @param {number[]} from
     * @param {number} radius
     * @param {(x: number, z: number) => ({pos: number[], label: string} | null)} test
     */
    constructor(from, radius, test) {
        this.cols = ringColumns(Math.floor(from[0]), Math.floor(from[2]), radius)
        this.test = test
        /** @type {{pos: number[], label: string} | null} */
        this.found = null
        this.over = false
    }

    /** @param {number} budgetMs */
    step(budgetMs) {
        const end = performance.now() + budgetMs
        let n = 0
        while (!this.over) {
            const next = this.cols.next()
            if (next.done) {
                this.over = true
                break
            }
            const hit = this.test(next.value[0], next.value[1])
            if (hit) {
                this.found = hit
                this.over = true
                break
            }
            if (++n % 2 === 0 && performance.now() > end) break
        }
    }
}

const DIGGABLE = new Set([B.grass, B.dirt, B.sand, B.snow])

export class Guide {
    /**
     * @param {any} session
     * @param {{touchDevice?: boolean}} [o] a touch screen (the touch controls only switch on at the first touch)
     */
    constructor(session, { touchDevice = false } = {}) {
        this.s = session
        this.touchDevice = touchDevice
        this.st = newTipState(/** @type {string[]} */ (getSetting('tipsDone')))
        /** what the card shows: a step, 'prep', or null */
        this.current = null
        /** a step just done: its ✓ stays this long */
        this.doneLeft = 0
        this.doneText = null
        /** @type {Scan|null} */
        this.scan = null
        this.pins = []
        /** recipes the craft tip suggests (the Build panel highlights them) */
        this.suggested = new Set()
        session.inventory.on('gained', (name) => this.note('gained', name))
        session.inventory.on('crafted', (name) => this.note('crafted', name))
        /** seconds the dusk tip (shoot from the wall) stays up; 0 when it's down */
        this.wallLeft = 0
        session.cycle.on('phase', (phase) => {
            if (phase === 'dusk') this._wallTip()
            else if (phase !== 'night' && this.current === 'wall') this._show(null)
        })
    }

    /** dusk: for the first nights, suggest the wall walk with a ranged weapon (markers on the steps) */
    _wallTip() {
        const s = this.s
        const c = s.cycle
        if (!this.enabled || c.opening || c.activeLevel > TIPS.wallNights || this.st.done.has('wall')) return
        if (!this._ranged()) return
        this.wallLeft = TIPS.wallFor + 10
        this._show('wall')
    }

    _ranged() {
        const inv = this.s.inventory
        return inv.count('musket') > 0 ? 'musket' : inv.count('bow') > 0 ? 'bow' : null
    }

    /** the dusk tip: until you're up on the wall, or it's been up long enough */
    _tickWall(dt) {
        const s = this.s
        this.wallLeft -= dt
        const p = s.units.posOf(s.player)
        const up = s.control.mode === 'self' && isBarrierTop((x, y, z) => s.noa.getBlock(x, y, z), Math.floor(p[0]), Math.floor(p[1] + 0.05), Math.floor(p[2]))
        if (up && s.cycle.phase === 'night') {
            this.st.done.add('wall')
            setSetting('tipsDone', [...this.st.done])
            this.doneLeft = TIPS.doneFor
            const t = tipText('wall', this._wording())
            this._show(null, true)
            s.hud.showTip({ title: '✓ ' + t.title, text: t.after, done: true })
            this.wallLeft = 0
        } else if (this.wallLeft <= 0 || !s.player.alive) {
            this.wallLeft = 0
            this._show(null)
        }
    }

    get enabled() {
        return getSetting('tips') === true && !this.s.cycle.creative
    }

    /** turn the tips on (from the start again) or off */
    setEnabled(on) {
        setSetting('tips', on)
        if (on) {
            this.st = newTipState()
            setSetting('tipsDone', [])
        }
        this.suggested = new Set()
        this._show(null)
    }

    /**
     * Progress: mining, crafting, placing, patching.
     * @param {'gained'|'crafted'|'placed'|'patched'} event
     * @param {string} item
     */
    note(event, item) {
        const step = noteProgress(this.st, event, item)
        if (!step) return
        setSetting('tipsDone', [...this.st.done])
        if (step === 'craft') this.suggested = new Set()
        if (this.current === step && this.enabled) {
            this.doneLeft = TIPS.doneFor
            this.doneText = tipText(step, this._wording())
            this._show(null, true)
            this.s.hud.showTip({ title: '✓ ' + this.doneText.title, text: this.doneText.after, done: true })
        }
    }

    /** @param {number} dt seconds */
    tick(dt) {
        const s = this.s
        if (this.doneLeft > 0) {
            this.doneLeft -= dt
            if (this.doneLeft <= 0) s.hud.showTip(null)
            return
        }
        if (this.current === 'wall') {
            if (this.wallLeft > 0) this._tickWall(dt)
            else this._show(null)
            this._tickScan()
            return
        }
        const busy = !!s.hud.openName || s.hud.bannerUp || s.control.mode !== 'self' || !s.player.alive
        const id = stepTips(this.st, {
            dt, enabled: this.enabled, day: s.cycle.day, phase: s.cycle.phase, busy, timeToNight: s.cycle.timeToNight,
        })
        if (id !== this.current) this._show(id)
        else if (id === 'prep') s.hud.showTip(tipText('prep', this._wording()))
        this._tickScan()
    }

    _tickScan() {
        const s = this.s
        if (this.scan && !this.scan.over) {
            this.scan.step(TIPS.scanMs)
            if (this.scan.found) this.pins.push(s.hud.pin(this.scan.found.pos, { kind: 'guide', label: this.scan.found.label }))
        }
    }

    _wording() {
        const s = this.s
        // a phone player who hasn't touched the game view yet still gets the touch wording
        return { touch: s.touch.enabled || this.touchDevice, crafts: suggestCrafts(s.inventory), timeToNight: s.cycle.timeToNight, ranged: this._ranged() }
    }

    /** put up the card for a tip (null takes it down), with its markers */
    _show(id, keepCard = false) {
        const s = this.s
        this.current = id
        for (const p of this.pins) p.remove()
        this.pins = []
        this.scan = null
        if (!id) {
            if (!keepCard) s.hud.showTip(null)
            return
        }
        const words = this._wording()
        // kept while the card is down for the Build panel, so the panel still shows them
        this.suggested = new Set(id === 'craft' ? words.crafts.map((r) => r.out) : [])
        s.hud.showTip(tipText(id, words))
        this._mark(id)
    }

    /** markers on where to do it: found by a scan over the next frames, or known already */
    _mark(id) {
        const s = this.s
        const w = s.world
        const from = s.units.posOf(s.player)
        const tc = w.townCenter
        if (id === 'wood') {
            this.scan = new Scan(from, TIPS.treeRadius, (x, z) => {
                const y0 = w.surfaceY(x, z)
                for (let y = y0; y < y0 + 7; y++) if (w.peekLoaded(x, y, z) === B.log) return { pos: [x + 0.5, y + 0.5, z + 0.5], label: 'Tree' }
                return null
            })
        } else if (id === 'stone') {
            this.scan = new Scan(from, TIPS.digRadius, (x, z) => {
                // off the plaza and the path round it, on plain ground
                const dx = x + 0.5 - tc[0], dz = z + 0.5 - tc[2]
                if (dx * dx + dz * dz < 12 * 12) return null
                const y = w.surfaceY(x, z) - 1
                if (!DIGGABLE.has(w.peekLoaded(x, y, z)) || w.edits.has(x, y + 1, z)) return null
                return { pos: [x + 0.5, y + 1.2, z + 0.5], label: 'Dig here' }
            })
        } else if (id === 'ore') {
            this.scan = new Scan(from, TIPS.oreRadius, (x, z) => {
                const top = w.surfaceY(x, z)
                for (let y = top - 7; y > top - 18; y--) {
                    if (w.peekLoaded(x, y, z) === B.iron_ore) return { pos: [x + 0.5, top + 0.2, z + 0.5], label: `Iron · ${top - y} down` }
                }
                return null
            })
        } else if (id === 'wall') {
            // the two steps nearest you
            const steps = wallSteps(w).sort((a, b) => Math.hypot(a[0] - from[0], a[2] - from[2]) - Math.hypot(b[0] - from[0], b[2] - from[2]))
            for (const st of steps.slice(0, 2)) this.pins.push(s.hud.pin(st, { kind: 'guide', label: 'Step up' }))
        } else if (id === 'defend') {
            for (const g of gateSpots(w)) this.pins.push(s.hud.pin(g, { kind: 'guide', label: 'Gate' }))
            if (!this.pins.length) this.pins.push(s.hud.pin([tc[0] + 0.5, tc[1] + 3, tc[2] + 0.5], { kind: 'guide', label: 'Town Center' }))
        }
    }
}

/**
 * The middle of each gate in the world's edits (the default town has four).
 * @param {import('../world/worldState.js').WorldState} world
 * @returns {number[][]}
 */
export function gateSpots(world) {
    /** @type {Map<string, {x: number, y: number, z: number, n: number}>} */
    const groups = new Map()
    world.edits.forEach((x, y, z, id) => {
        if (!BLOCK_BY_ID[id]?.gate) return
        const key = `${Math.round(x / 5)},${Math.round(z / 5)}`
        const g = groups.get(key) || { x: 0, y: 0, z: 0, n: 0 }
        g.x += x
        g.y = Math.max(g.y, y)
        g.z += z
        g.n++
        groups.set(key, g)
    })
    return [...groups.values()].slice(0, 6).map((g) => [g.x / g.n + 0.5, g.y + 1.2, g.z / g.n + 0.5])
}

/**
 * Steps up onto the wall: built blocks on the plaza level with a wall top
 * beside them (a wall block with a wall block under it and room on top).
 * @param {import('../world/worldState.js').WorldState} world
 * @returns {number[][]} marker positions, over each step
 */
export function wallSteps(world) {
    const ty = world.townCenter[1]
    const get = (x, y, z) => world.getBlock(x, y, z)
    const out = []
    world.edits.forEach((x, y, z, id) => {
        if (y !== ty || !BLOCK_BY_ID[id]?.built || !BLOCK_BY_ID[id].solid || get(x, y + 1, z) !== 0) return
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (isBarrierTop(get, x + dx, y + 2, z + dz) && get(x + dx, y + 2, z + dz) === 0 && get(x + dx, y + 3, z + dz) === 0) {
                out.push([x + 0.5, y + 1.6, z + 0.5])
                break
            }
        }
    })
    return out
}
