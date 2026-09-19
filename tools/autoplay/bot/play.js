/*
 *  Playing to win.
 *
 *  Day:   a better weapon first (stone sword, a bow, later the iron sword and a
 *         musket), then arrow towers on 2-high cobble columns inside the wall,
 *         beside the gates first, archers when there's gold, and a step up to
 *         the wall top next to each gate. Gathers what the next build needs (a
 *         tree for planks, a quarry for cobble, iron ore when it's close), then
 *         walks home and starts the night itself once the day's time is used or
 *         there's nothing left to build.
 *  Dusk:  a look at the defences from above, then back to first person.
 *  Night: attackers inside the wall or at a gate get the sword (the Town
 *         Center's attackers first); otherwise it shoots from the wall top by
 *         the biggest group. It never leaves the town.
 *  Dawn:  watches the town rebuild.
 */

import { RECIPES, WEAPONS, weaponDps } from '../../../src/game/balance.js'
import { Town } from './town.js'

/** seconds of work before the bot starts the night itself (the day timer is 8 min) */
export const DAY_BUDGET = { first: 330, later: 250 }
/** cobble each tower needs: 4 in the recipe + a 2-high column */
const TOWER_COBBLE = 6

const cost = (out) => RECIPES.find((r) => r.out === out).cost

export class PlayStrategy {
    /** @param {import('./bot.js').Bot} bot */
    constructor(bot) {
        this.bot = bot
        this.see = bot.see
        this.k = bot.skills
        this.town = new Town(bot.see)
        this.bot.timed('findTrees', () => this.town.findTrees())
        this.bot.timed('pickQuarry', () => this.town.pickQuarry())
        bot.note('town', { R: this.town.R, gates: this.town.gates.length, trees: this.town.trees.length, quarry: this.town.quarry, slots: this.slots().length })
        this.failed = new Map()
        /** attackers the bot couldn't get at (until when) */
        this.unreachable = new WeakMap()
        this._perches = []
        this._perchCells = new Set()
        this._ironMisses = 0
        /** failed tries per tower spot */
        this.slotFails = new Map()
        this._noIron = false
    }

    want() {
        const s = this.see
        const p = s.phase
        if (s.opening) return { key: 'raid', run: () => this.watch() }
        if (p === 'day') return { key: `day:${s.day}`, run: () => this.day() }
        if (p === 'dusk') return { key: `dusk:${s.activeLevel}`, run: () => this.dusk() }
        if (p === 'night') return { key: `night:${s.activeLevel}`, run: () => this.night() }
        return { key: `dawn:${s.day}`, run: () => this.dawn() }
    }

    roleChoice() {
        return 'self'
    }

    /** back in first person as the builder (the role picker is handled by the bot) */
    async beSelf() {
        const s = this.see
        if (s.mode === 'aerial' && s.me().alive) {
            this.bot.input.tap('KeyM')
            await this.bot.until(() => s.mode === 'self', 1)
        }
        await this.bot.until(() => s.locked, 3)
    }

    async watch() {
        // the opening raid can't be won: watch it from above, as the game suggests
        for (;;) await this.bot.wait(1)
    }

    async dawn() {
        await this.bot.until(() => this.see.mode === 'self', 3)
        const tc = this.see.tc
        for (;;) {
            this.k.lookAt([tc[0] + 0.5, tc[1] + 2, tc[2] + 0.5])
            await this.bot.wait(0.5)
        }
    }

    // ---- day -------------------------------------------------------------------------

    async day() {
        const s = this.see
        const bot = this.bot
        await bot.wait(1)
        await this.beSelf()
        const start = bot.time
        const budget = s.day <= 1 ? DAY_BUDGET.first : DAY_BUDGET.later
        let misses = 0
        while (s.canEdit) {
            const left = budget - (bot.time - start)
            // leave time to get home before dusk (it can't dig its way out at night)
            if (left <= 0 || s.timeToNight < 45) break
            await this.craftUseful()
            if (await this.placeSomething()) {
                misses = 0
                continue
            }
            const need = this.needs()
            if (!need) break
            const got = await this.gather(need)
            if (!got) {
                if (++misses >= 5) break
            } else misses = 0
        }
        // spend what's left, then start the night
        await this.craftUseful()
        for (let i = 0; i < 6 && s.canEdit && s.timeToNight > 10; i++) if (!(await this.placeSomething())) break
        await this.goHome()
        await this.k.select(this.see.g.inventory.bestWeapon).catch(() => {})
        if (s.phase === 'day') {
            this.bot.note('start-night', { level: s.nightLevel, workSeconds: Math.round(bot.time - start) })
            this.bot.input.tap('KeyN')
            await bot.until(() => s.phase !== 'day', 2)
        }
        for (;;) await bot.wait(1)
    }

    /** back inside the wall by the town center (digging out of the quarry if it has to) */
    async goHome() {
        const s = this.see
        const tc = s.tc
        const R = this.town.R
        const f = s.feetCell()
        if (this.town.ringDist(f[0], f[2]) <= R - 2 && Math.abs(f[1] - tc[1]) <= 1) return true
        const ok = await this.k.walkTo((x, y, z) => this.town.ringDist(x, z) <= R - 3 && Math.abs(y - tc[1]) <= 1, [tc[0], tc[1], tc[2] + 4], { maxNodes: 40000, tries: 3 })
        this.bot.note('home', { ok, from: f })
        return ok
    }

    /** the nearest iron ore around the quarry that hasn't failed (a scan, kept for 15 s) */
    nearIron(fresh = false) {
        const t = this.bot.time
        if (fresh || !this._ore || t - this._ore.t > 60) {
            const pos = this.bot.timed('findOre', () => this.town.findOre('iron', this.town.quarry || this.see.feetCell(), 16, 12))
            this._ore = { t, pos: pos && !this.failed.has(pos.join(',')) ? pos : null }
        }
        return this._ore.pos
    }

    /** the next thing to gather for, or null when nothing more is useful */
    needs() {
        const s = this.see
        const c = (n) => s.count(n)
        const planks = c('planks') + 4 * c('log')
        const best = s.g.inventory.bestWeapon
        if (weaponDps(best) < weaponDps('stone_sword') && c('cobble') < 3) return { kind: 'stone', n: 4 }
        // iron for the iron sword, then for cannon towers
        const ironWanted = weaponDps(best) < weaponDps('iron_sword') ? 3 : 4
        if (c('iron') < ironWanted && !this._noIron && this.nearIron()) return { kind: 'iron' }
        const slots = this.slots().length - c('arrow_tower')
        if (slots <= 0) return null
        if (c('cobble') < TOWER_COBBLE) return { kind: 'stone', n: TOWER_COBBLE * 2 - c('cobble') }
        if (planks < 6) return { kind: 'wood' }
        return { kind: 'stone', n: TOWER_COBBLE }
    }

    /** craft what helps now: a better weapon, planks, towers, troops */
    async craftUseful() {
        const s = this.see
        const inv = s.g.inventory
        const list = []
        const best = inv.bestWeapon
        const can = (out, extra = {}) => Object.entries(cost(out)).every(([k, v]) => s.count(k) >= v + (extra[k] || 0))
        if (weaponDps(best) < weaponDps('iron_sword') && can('iron_sword')) list.push(['iron_sword', 1])
        else if (weaponDps(best) < weaponDps('stone_sword') && can('stone_sword')) list.push(['stone_sword', 1])
        // something to shoot with from the wall: a bow (needs a log, so before the planks), a musket later
        if (!this.ranged() && can('bow')) list.push(['bow', 1])
        if (this.ranged() !== 'musket' && best === 'iron_sword' && can('musket', { gold: 1 })) list.push(['musket', 1])
        if (list.length) await this.k.craft(list)
        // all logs into planks
        if (s.count('log') > 0) await this.k.craft([['planks', s.count('log')]])
        // towers for the free slots, keeping cobble for their columns and the steps up the wall
        const reserve = this.ranged() ? this.stepsToBuild().length : 0
        const slots = this.slots().length - s.count('arrow_tower')
        const towers = Math.max(0, Math.min(slots, Math.floor(s.count('planks') / 6), Math.floor((s.count('cobble') - reserve) / TOWER_COBBLE)))
        const more = []
        if (towers > 0) more.push(['arrow_tower', towers])
        // troops: archers with gold; a cannon when iron piles up
        const spots = this.town.troopSpots().length
        const archers = Math.min(s.count('gold'), spots - s.count('archer'), Math.floor((s.count('planks') - 6 * towers) / 4))
        if (archers > 0) more.push(['archer', archers])
        if (weaponDps(inv.bestWeapon) >= weaponDps('iron_sword') && s.count('iron') >= 4 && s.count('cobble') - TOWER_COBBLE * towers >= 10) more.push(['cannon_tower', 1])
        if (more.length) await this.k.craft(more)
        // what gets placed next goes on the hotbar
        for (const item of ['arrow_tower', 'cannon_tower', 'archer', 'swordsman', 'gunner']) {
            if (s.count(item) > 0) await this.k.toHotbar(item, ['cobble', 'arrow_tower', inv.bestWeapon])
        }
        if (s.count('cobble') > 0) await this.k.toHotbar('cobble', ['arrow_tower', inv.bestWeapon])
        const r = this.ranged()
        if (r) await this.k.toHotbar(r, ['arrow_tower', 'cobble', inv.bestWeapon])
    }

    /** free tower spots (a scan, kept until something is placed or 5 s pass) */
    slots() {
        const t = this.bot.time
        const placed = this.bot.placedCount
        if (!this._slots || t - this._slots.t > 5 || this._slots.placed !== placed) {
            this._slots = { t, placed, list: this.bot.timed('towerSlots', () => this.town.towerSlots()) }
        }
        return this._slots.list.slice()
    }

    /** the ranged weapon owned, if any (musket over bow) */
    ranged() {
        const s = this.see
        return s.count('musket') > 0 ? 'musket' : s.count('bow') > 0 ? 'bow' : null
    }

    /** the best sword owned (or none) */
    melee() {
        const s = this.see
        for (const w of ['iron_sword', 'stone_sword', 'wood_sword']) if (s.count(w) > 0) return w
        return null
    }

    /** perches whose step isn't there yet */
    stepsToBuild() {
        return this.town.perches().filter((p) => this.see.block(...p.step) === 0 && !this.failed.has(p.step.join(',')))
    }

    /** place one tower or troop, if there's one to place */
    async placeSomething() {
        const s = this.see
        for (const item of ['arrow_tower', 'cannon_tower']) {
            if (s.count(item) <= 0 || s.count('cobble') < 2) continue
            const slots = this.slots()
            const me = s.me().pos
            slots.sort((a, b) => a.near - b.near || Math.hypot(a.x - me[0], a.z - me[2]) - Math.hypot(b.x - me[0], b.z - me[2]))
            const slot = slots[0]
            if (!slot) continue
            if (await this.buildTower(slot, item)) return true
            // two tries per spot (a troop standing there is only in the way for a while)
            const key = `${slot.x},${slot.z}`
            const n = (this.slotFails.get(key) || 0) + 1
            this.slotFails.set(key, n)
            if (n >= 2) {
                this.town.badSlots.add(key)
                this.bot.note('bad-slot', { slot })
            }
            this._slots = null
            return false
        }
        for (const item of ['archer', 'swordsman', 'gunner']) {
            if (s.count(item) <= 0) continue
            const spots = this.town.troopSpots()
            const spot = spots.find((p) => !this.failed.has(p.join(',')))
            if (!spot) continue
            if (await this.k.goPlace(spot, item)) return true
            this.failed.set(spot.join(','), true)
        }
        // steps up to the wall top, once there's something to shoot with
        if (this.ranged() && s.count('cobble') > 0) {
            const me = s.me().pos
            const steps = this.stepsToBuild().sort((a, b) => Math.hypot(a.step[0] - me[0], a.step[2] - me[2]) - Math.hypot(b.step[0] - me[0], b.step[2] - me[2]))
            if (steps.length) {
                if (await this.k.goPlace(steps[0].step, 'cobble')) return true
                this.failed.set(steps[0].step.join(','), true)
            }
        }
        return false
    }

    /** a 2-high cobble column with the tower on top */
    async buildTower(slot, item) {
        const s = this.see
        const k = this.k
        const { x, y, z } = slot
        for (const cy of [y, y + 1]) {
            if (s.block(x, cy, z) !== 0) continue
            if (!(await k.goPlace([x, cy, z], 'cobble'))) return false
        }
        return k.goPlace([x, y + 2, z], item)
    }

    /** gather for a need: one tree, or a few blocks from the quarry */
    async gather(need) {
        const s = this.see
        if (need.kind === 'wood') return this.chopTree()
        if (need.kind === 'iron') {
            const ore = this.nearIron(true)
            const before = s.count('iron')
            if (ore && !this.failed.has(ore.join(','))) {
                const ok = await this.k.goMine(ore)
                if (!ok) this.failed.set(ore.join(','), true)
            }
            if (s.count('iron') === before && ++this._ironMisses >= 3) this._noIron = true
            return s.count('iron') > before
        }
        const before = s.count('cobble') + s.count('iron') + s.count('gold')
        const target = before + (need.n || 6)
        let fails = 0
        while (s.canEdit && s.count('cobble') + s.count('iron') + s.count('gold') < target && fails < 4) {
            const t = this.bot.timed('quarryTargets', () => this.town.quarryTargets(s.feetCell(), 6))
            let ok = false
            for (const { b } of t) {
                if (this.failed.has(b.join(','))) continue
                ok = await this.k.goMine(b)
                if (ok) break
                this.failed.set(b.join(','), true)
            }
            if (!ok) fails++
        }
        return s.count('cobble') + s.count('iron') + s.count('gold') > before
    }

    async chopTree() {
        const s = this.see
        const me = s.me().pos
        const trees = (this.town.trees || []).filter((b) => this.town.trunk(b).length && !this.failed.has(b.join(',')))
        trees.sort((a, b) => Math.hypot(a[0] - me[0], a[2] - me[2]) - Math.hypot(b[0] - me[0], b[2] - me[2]))
        const tree = trees[0]
        if (!tree) return false
        const before = s.count('log')
        for (const log of this.town.trunk(tree)) {
            if (!s.canEdit) break
            if (!(await this.k.goMine(log))) break
        }
        if (s.count('log') === before) this.failed.set(tree.join(','), true)
        return s.count('log') > before
    }

    // ---- dusk and night --------------------------------------------------------------

    async dusk() {
        const bot = this.bot
        const s = this.see
        await bot.wait(1)
        // a look at the defences from above
        if (s.mode === 'self') {
            bot.input.tap('KeyM')
            await bot.wait(4.5)
            if (s.mode === 'aerial') bot.input.tap('KeyM')
        }
        await this.beSelf()
        await this.k.select(s.g.inventory.bestWeapon).catch(() => {})
        for (;;) await bot.wait(1)
    }

    /** the bot keeps to the town: inside the wall, out as far as a gateway, or on a perch */
    inTown(x, z) {
        const d = this.town.ringDist(x, z)
        if (d <= this.town.R - 1) return true
        if (d > this.town.R + 1) return false
        if (this.town.gates.some((g) => Math.hypot(x - g.at[0], z - g.at[1]) <= 2.5)) return true
        return this._perchCells.has(`${x},${z}`)
    }

    /** which attacker to go for: on the Town Center, then inside the wall, then at a gate; nearest first */
    pickTarget() {
        const s = this.see
        const tc = s.tc
        const me = s.me().pos
        const R = this.town.R
        const now = this.bot.time
        let best = null, bestScore = Infinity
        for (const a of s.attackers()) {
            if ((this.unreachable.get(a.u) || 0) > now) continue
            const ring = this.town.ringDist(Math.floor(a.pos[0]), Math.floor(a.pos[2]))
            const atGate = this.town.gates.some((g) => Math.hypot(a.pos[0] - g.at[0] - 0.5, a.pos[2] - g.at[1] - 0.5) < 3.5)
            if (ring >= R && !atGate) continue
            const dMe = Math.hypot(a.pos[0] - me[0], a.pos[1] - me[1], a.pos[2] - me[2])
            const dTown = Math.hypot(a.pos[0] - tc[0], a.pos[2] - tc[2])
            let score = dMe + dTown * 0.3
            if (a.attackTown) score -= 30
            else if (ring < R) score -= 12
            if (score < bestScore) {
                bestScore = score
                best = a
            }
        }
        return best
    }

    async night() {
        const bot = this.bot
        const s = this.see
        const k = this.k
        this.unreachable = new WeakMap()
        this._perches = this.town.perches().filter((p) => s.block(...p.step) !== 0)
        this._perchCells = new Set(this._perches.map((p) => `${p.top[0]},${p.top[2]}`))
        await this.beSelf()
        await k.select(this.melee() || s.g.inventory.bestWeapon).catch(() => {})
        for (;;) {
            if (!s.me().alive || s.mode !== 'self') {
                k.activity = 'down'
                await bot.wait(0.5)
                continue
            }
            if (!s.locked) {
                k.activity = 'waiting'
                await bot.until(() => s.locked, 2)
                continue
            }
            // outside the town (knocked over the wall, or it jumped): back in through the nearest gate
            const f = s.feetCell()
            if (!this.inTown(f[0], f[2])) {
                k.activity = 'walking'
                await this.backInside()
                continue
            }
            const t = this.pickTarget()
            if (t) {
                k.activity = 'fighting'
                if (this.melee()) await k.select(this.melee())
                await this.engage(t.u)
                continue
            }
            if (this.ranged() && this._perches.length && s.attackers().length) {
                k.activity = 'shooting'
                await this.perchShoot()
                continue
            }
            k.activity = 'guarding'
            await this.guard()
        }
    }

    /** the perch nearest the biggest group of attackers */
    pickPerch() {
        const s = this.see
        const groups = s.g.waves.frontGroups()
        const at = groups.length ? groups.reduce((a, b) => (b.count > a.count ? b : a)).pos : s.attackers()[0]?.pos
        if (!at) return null
        let best = null, bestD = Infinity
        for (const p of this._perches) {
            const d = Math.hypot(p.top[0] - at[0], p.top[2] - at[2])
            if (d < bestD) {
                bestD = d
                best = p
            }
        }
        return best
    }

    /** up on the wall with the bow: shoot what's in range for a few seconds */
    async perchShoot() {
        const s = this.see
        const k = this.k
        const bot = this.bot
        const perch = this.pickPerch()
        if (!perch) return this.guard()
        const f = s.feetCell()
        if (f[0] !== perch.top[0] || f[2] !== perch.top[2] || f[1] !== perch.top[1]) {
            const ok = await k.walkTo((x, y, z) => x === perch.top[0] && y === perch.top[1] && z === perch.top[2], perch.top,
                { dig: false, tries: 1, maxNodes: 8000, avoid: (x, y, z) => !this.inTown(x, z) })
            if (!ok) {
                this.bot.note('perch-failed', { perch: perch.top })
                this._perches = this._perches.filter((p) => p !== perch)
                return
            }
        }
        const w = this.ranged()
        await k.select(w)
        const speed = w === 'bow' ? 28 : 60
        const grav = w === 'bow' ? 6 : 0
        const range = w === 'bow' ? 28 : 38
        const t0 = bot.time
        try {
            while (bot.time - t0 < 4 && s.me().alive && s.mode === 'self' && s.locked && !this.pickTarget()) {
                const eye = s.eye()
                let target = null, bestD = Infinity
                for (const a of s.attackers()) {
                    const c = [a.pos[0], a.pos[1] + a.height * 0.6, a.pos[2]]
                    const d = Math.hypot(c[0] - eye[0], c[1] - eye[1], c[2] - eye[2])
                    if (d < range && d < bestD && s.g.units.lineOfSight(eye, c)) {
                        bestD = d
                        target = a
                    }
                }
                if (!target) {
                    bot.input.mouseUp(0)
                    const at = this.pickPerch()?.gate
                    if (at) k.lookAt([s.tc[0] + at.n[0] * (this.town.R + 10), eye[1] - 2, s.tc[2] + at.n[1] * (this.town.R + 10)])
                    await bot.frame()
                    continue
                }
                // lead it, and aim above for the arrow's drop
                const body = s.g.noa.entities.getPhysics(target.u.entity)?.body
                const tt = bestD / speed
                const v = body ? [body.velocity[0], body.velocity[2]] : [0, 0]
                const aim = [target.pos[0] + v[0] * tt, target.pos[1] + target.height * 0.6 + 0.5 * grav * tt * tt, target.pos[2] + v[1] * tt]
                k.lookAt(aim, true)
                if (k.lookError() < 0.02) bot.input.mouseDown(0)
                else bot.input.mouseUp(0)
                await bot.frame()
            }
        } finally {
            bot.input.mouseUp(0)
        }
    }

    async backInside() {
        const s = this.see
        const tc = s.tc
        const R = this.town.R
        const ok = await this.k.walkTo((x, y, z) => this.town.ringDist(x, z) <= R - 2, [tc[0], tc[1], tc[2]], { dig: false, tries: 1, maxNodes: 20000 })
        if (!ok) await this.bot.wait(0.5)
    }

    /** wait inside the gate the attackers are heading for, looking out */
    async guard() {
        const s = this.see
        const tc = s.tc
        const R = this.town.R
        const groups = s.g.waves.frontGroups()
        let gate = this.town.gates[0]
        if (groups.length && this.town.gates.length) {
            const g = groups.reduce((a, b) => (b.count > a.count ? b : a))
            gate = this.town.gates.reduce((a, b) => (Math.hypot(b.at[0] - g.pos[0], b.at[1] - g.pos[2]) < Math.hypot(a.at[0] - g.pos[0], a.at[1] - g.pos[2]) ? b : a))
        }
        const spot = gate
            ? [tc[0] + gate.n[0] * (R - 3) + gate.t[0] * Math.round(gate.offset) + 0.5, tc[2] + gate.n[1] * (R - 3) + gate.t[1] * Math.round(gate.offset) + 0.5]
            : [tc[0] + 0.5, tc[2] + 3.5]
        const me = s.me().pos
        if (Math.hypot(me[0] - spot[0], me[2] - spot[1]) > 2) {
            await this.k.walkTo((x, y, z) => Math.hypot(x + 0.5 - spot[0], z + 0.5 - spot[1]) < 1.6, [Math.floor(spot[0]), tc[1], Math.floor(spot[1])],
                { dig: false, tries: 1, maxNodes: 6000, maxSteps: 8, avoid: (x, y, z) => !this.inTown(x, z) })
        }
        const look = gate ? [tc[0] + gate.n[0] * (R + 8), s.eye()[1], tc[2] + gate.n[1] * (R + 8)] : [tc[0], s.eye()[1], tc[2] + 20]
        this.k.lookAt(look)
        await this.bot.wait(0.3)
    }

    /** go to an attacker and hit it until it's down (or something more urgent comes up) */
    async engage(u) {
        const s = this.see
        const k = this.k
        const bot = this.bot
        const sel = s.g.inventory.selectedWeapon || s.g.inventory.bestWeapon
        const w = { name: sel, ...WEAPONS[sel] }
        const ranged = w.attack !== 'melee'
        const range = ranged ? Math.min(w.range, 26) : w.range + 0.4
        const t0 = bot.time
        let replan = 0
        let lastHit = bot.time
        try {
            while (u.alive && bot.time - t0 < 15 && s.me().alive && s.mode === 'self' && s.locked) {
                const q = [...s.g.units.posOf(u)]
                const me = s.me().pos
                const d = Math.hypot(q[0] - me[0], q[1] - me[1], q[2] - me[2])
                const aim = [q[0], q[1] + u.height * 0.6, q[2]]
                if (ranged) {
                    const tt = d / (w.attack === 'arrow' ? 28 : 60)
                    aim[1] += w.attack === 'arrow' ? 0.5 * 6 * tt * tt : 0
                }
                // something more urgent?
                const better = this.pickTarget()
                if (better && better.u !== u && better.attackTown && !u.attackTown) return
                if (d <= range && s.g.units.lineOfSight(s.eye(), aim)) {
                    lastHit = bot.time
                    k.lookAt(aim, true)
                    const close = !ranged && d > w.range - 0.3
                    bot.input.setMoveKeys(new Set(close ? ['KeyW'] : []))
                    if (k.lookError() < (ranged ? 0.03 : 0.3)) bot.input.mouseDown(0)
                    else bot.input.mouseUp(0)
                    await bot.frame()
                    continue
                }
                bot.input.mouseUp(0)
                if (bot.time - lastHit > 6) {
                    // can't get at it: leave it to the towers for a while
                    this.unreachable.set(u, bot.time + 8)
                    return
                }
                if (bot.time >= replan) {
                    replan = bot.time + 0.5
                    const goal = [Math.floor(q[0]), Math.floor(q[1] + 0.05), Math.floor(q[2])]
                    const r = ranged ? range - 3 : 1.6
                    const ok = await k.walkTo((x, y, z) => Math.hypot(x + 0.5 - q[0], y - q[1], z + 0.5 - q[2]) <= r, goal,
                        { dig: false, tries: 1, maxNodes: 5000, maxSteps: 5, avoid: (x, y, z) => !this.inTown(x, z) })
                    if (!ok) {
                        this.unreachable.set(u, bot.time + 5)
                        return
                    }
                    continue
                }
                await bot.frame()
            }
        } finally {
            bot.input.mouseUp(0)
            k.stop()
        }
    }
}
