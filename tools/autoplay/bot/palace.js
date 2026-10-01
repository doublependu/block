/*
 *  --strategy=palace: plan 12's ice palace (castle/palace.js), in survival, on
 *  a Large world (plan 12 §6.5–6.7).
 *
 *  It's iteration 10's castle bot (bot/castle.js: the day plan, the quarry hall,
 *  crafting, the nights, the export at the end) with a different design and
 *  three ways of building, a view per part (palace.js ORDER):
 *
 *    first   on foot, in first person: the hall's floor, the staircase step by
 *            step, level 2's floor out from the landing, the snowflake, and the
 *            archers walked up to their openings
 *    third   on foot, in third person (V): the curtain, the gates, the spike
 *            bands, the hall's lowest courses from outside, where you see the
 *            builder lay the wall
 *    aerial  from above, no reach limit: everything high
 *
 *  On foot it stands where the next block is in reach and builds everything
 *  else in reach from there before it moves on. A block it can't build on foot
 *  is tried from above while the sky over it is open.
 *
 *  The pace (§6.7): loads of LOAD blocks (iteration 10: 140), aerial tiles of
 *  TILE blocks and BAND courses (14 and 6). Blocks and towers that need iron or
 *  gold wait in the order until the stock covers them, so a short of iron
 *  never stops the white walls going up.
 */

import { CastleStrategy, rawCost, SHOW_NIGHTS } from './castle.js'
import { buildPalace, FLOOR, L2_Y } from '../castle/palace.js'
import { REACH } from '../../../src/game/balance.js'
import { BLOCK_BY_ID, blockId } from '../../../src/world/blocks.js'
import { passable, standable } from './nav.js'
import { TOWER_COLUMN } from '../../../src/game/placing.js'
import { createGenerator } from '../../../src/world/gen/index.js'

/** blocks a load holds (iteration 10's castle: 140) */
export const LOAD = 400
/** aerial: a tile is this many blocks across, and this many courses (iteration 10: 14 and 6) */
const TILE = 20
const BAND = 8
/** the camera's distance building from above */
const ZOOM = 28
/** the hall's courses built on foot, from outside (the rest of its walls from above) */
const FOOT_COURSES = 5
/** seconds of daylight kept to take crafted troops to their posts before the night */
const TROOPS_BEFORE_DUSK = 100
/** the view each kind of item is built from, as the chapter captions name it */
const VIEW_NAME = { first: 'first person', third: 'third person', aerial: 'from above' }

const key = (c) => `${c[0]},${c[1]},${c[2]}`
const FACES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]

export class PalaceStrategy extends CastleStrategy {
    /** @param {import('./bot.js').Bot} bot */
    constructor(bot) {
        // its own copy of the terrain (the game is read-only to the bot): the natural block under the hall
        const def = bot.see.g.def
        const gen = createGenerator(def.generator.version, def.seed, def.size)
        const palace = buildPalace({ groundAt: (x, z) => gen.surfaceY(x, z), blockAt: (x, y, z) => gen.blockAt(x, y, z) })
        // the night watch and the flyover look from where the references do
        palace.views.photo = palace.views.reference
        super(bot, palace)
        this.palace = palace
        // the order: the cells to dig, then every block, each with the view it's built from
        this.order = []
        for (const [x, y, z] of palace.dig) this.order.push({ x, y, z, b: 'air', id: 0, dig: true, part: 'the floor', view: 'first' })
        for (const p of palace.parts) {
            for (const [x, y, z, b] of p.cells) {
                const view = p.name === 'level 1' ? (y < FLOOR + FOOT_COURSES ? 'third' : 'aerial') : p.view
                this.order.push({ x, y, z, b, id: blockId(b), part: p.name, view })
            }
        }
        this.digAt = new Set(palace.dig.map(([x, y, z]) => key([x, y, z])))
        /** troops placed so far, by spot */
        this.troopsPlaced = new Set()
        /** the moments the edit keeps at 1× (plan 12 §6.10), once each */
        this.milestones = new Set()
        /** the last tread of each flight: both in, and the flights have met */
        this.topTreads = palace.treads.filter((t) => t.i === Math.max(...palace.treads.map((x) => x.i))).flatMap((t) => t.cells)
        bot.note('palace', { blocks: palace.cells.length, dig: palace.dig.length, towers: palace.towers.length, troops: palace.troops.length, parts: palace.parts.map((p) => [p.name, p.cells.length, p.view]) })
    }

    roleChoice() {
        return 'aerial'
    }

    // ---- what's left -----------------------------------------------------------------------

    /**
     * Cells still to do, in order. A cell to dig is done when it's open; a cell to
     * build is done when its block is there. A natural block where the design digs
     * first is still to do (it's dug, then built); anything else solid is left.
     */
    remaining() {
        const s = this.see
        const out = []
        for (const c of this.order) {
            const id = s.block(c.x, c.y, c.z)
            if (c.dig) {
                if (passable(id)) continue
                out.push(c)
                continue
            }
            if (id === c.id) continue
            if (id && !passable(id) && !(this.digAt.has(key([c.x, c.y, c.z])) && !BLOCK_BY_ID[id]?.built)) continue
            out.push(c)
        }
        return out
    }

    /** tower spots ready to build on, each with its own tower (every kind the game has, palace.js) */
    pendingTowers() {
        const s = this.see
        return this.palace.towers.filter((t) => {
            const top = t.ground ? t.y + 2 : t.y
            const here = s.block(t.x, top, t.z)
            if (BLOCK_BY_ID[here]?.tower) return false
            if (!t.ground && here && !passable(here)) return false
            return t.ground || !!BLOCK_BY_ID[s.block(t.x, t.y - 1, t.z)]?.built
        })
    }

    /** iron and gold a block (or tower) takes from the raw stock, once what's crafted is used */
    _scarce(b, n = 1) {
        const have = this.see.count(b)
        const make = Math.max(0, n - have)
        const raw = rawCost(b)
        return { iron: (raw.iron || 0) * make, gold: (raw.gold || 0) * make }
    }

    /**
     * The next load: up to LOAD cells in order, and the towers ready. What needs
     * iron or gold the stock can't cover waits (it isn't in the load), so the
     * rest goes on. Parts nine tenths done go last, as iteration 10's.
     */
    nextLoad() {
        const s = this.see
        const all = this.remaining()
        const left = {}
        for (const c of all) left[c.part] = (left[c.part] || 0) + 1
        const size = Object.fromEntries(this.palace.parts.map((p) => [p.name, p.cells.length]))
        size['the floor'] = (size['the floor'] || 0) + this.palace.dig.length
        const straggler = (c) => left[c.part] <= size[c.part] * 0.1
        const rem = all.filter((c) => !this.hasFailed(key([c.x, c.y, c.z]))).sort((a, b) => Number(straggler(a)) - Number(straggler(b)))
        // what the crystal's guard still needs to become ballistas is kept for it
        const keep = this.guardReserve()
        let iron = s.count('iron') - keep.iron, gold = s.count('gold') - keep.gold
        const fits = (b, n = 1) => {
            const need = this._scarce(b, n)
            // (with iron kept back for the guard the budget can be below 0: what needs none still fits)
            if ((need.iron > 0 && need.iron > iron) || (need.gold > 0 && need.gold > gold)) return false
            iron -= need.iron
            gold -= need.gold
            return true
        }
        const towers = this.pendingTowers().filter((t) => !this.hasFailed(key([t.x, t.y, t.z])) && fits(t.block))
        // the crystal's guard first, on its own: a small load built on day 1, before the quarry
        const early = towers.filter((t) => t.early)
        if (early.length) return { cells: [], towers: early }
        const cells = []
        const counted = {}
        for (const c of rem) {
            if (cells.length >= LOAD) break
            if (!c.dig) {
                // what's already crafted covers the first of a kind; the rest take raw stock
                counted[c.b] = (counted[c.b] || 0) + 1
                if (counted[c.b] > s.count(c.b) && !fits(c.b, 1)) continue
            }
            cells.push(c)
        }
        if (!cells.length && !towers.length) return null
        return { cells, towers }
    }

    /** raw stock short for a load (iron and gold aren't: the load was cut to what they cover) */
    shortFor(load) {
        const s = this.see
        const blocks = [...load.cells.filter((c) => !c.dig).map((c) => c.b), ...load.towers.map((t) => t.block)]
        const want = {}
        for (const b of blocks) want[b] = (want[b] || 0) + 1
        const need = {}
        for (const [b, n] of Object.entries(want)) {
            const short = Math.max(0, n - s.count(b))
            if (!short) continue
            for (const [k, v] of Object.entries(rawCost(b))) need[k] = (need[k] || 0) + v * short
        }
        const columns = TOWER_COLUMN * load.towers.filter((t) => t.ground && !BLOCK_BY_ID[s.block(t.x, t.y, t.z)]?.built).length
        if (columns) need.cobble = (need.cobble || 0) + columns
        const have = { cobble: s.count('cobble'), sand: s.count('sand'), planks: s.count('planks') + 4 * s.count('log') }
        const short = {}
        for (const [k, v] of Object.entries(need)) {
            if (k === 'iron' || k === 'gold') continue
            const miss = Math.ceil(v - (have[k] || 0))
            if (miss > 0) short[k] = miss
        }
        delete need.iron
        delete need.gold
        return { need, short }
    }

    /** craft a load's blocks and its towers, each of its own kind */
    async craftFor(load) {
        const towers = {}
        for (const t of load.towers) towers[t.block] = (towers[t.block] || 0) + 1
        const s = this.see
        const columns = load.towers.filter((t) => t.ground && !BLOCK_BY_ID[s.block(t.x, t.y, t.z)]?.built).length
        return super.craftFor({ cells: load.cells.filter((c) => !c.dig), towers: [], columns, extra: { ...(load.extra || {}), ...towers } })
    }

    // ---- building --------------------------------------------------------------------------

    /**
     * A load, each part from its own view: on foot first (the low and inside
     * work), then from above; what failed on foot is tried from above where the
     * sky over it is open. Towers go up from above.
     * @returns {Promise<number>} blocks built (and cells dug)
     */
    async buildLoad(load) {
        const s = this.see
        await this.craftFor(load)
        const items = [...load.cells.map((c) => ({ cell: [c.x, c.y, c.z], b: c.b, part: c.part, view: c.view, dig: !!c.dig })),
            ...load.towers.map((t) => ({ cell: [t.x, t.y, t.z], b: t.block, part: t.part, view: 'aerial', tower: t }))]
            .filter((it) => it.dig || s.count(it.b) > 0)
        if (!items.length) return 0
        let built = 0
        for (const view of ['first', 'third']) {
            const mine = items.filter((it) => it.view === view && !this.done(it))
            if (!mine.length) continue
            built += await this.footBuild(mine, view)
        }
        // from above: its own parts, and what didn't work on foot under an open sky
        const above = items.filter((it) => !it.dig && !this.done(it) && s.count(it.b) > 0 && (it.view === 'aerial' || this.skyOpen(it.cell)))
        if (above.length && s.canEdit && s.timeToNight > Math.max(30, this.dayEnd()) && (await this.air.enter())) {
            const parts = [...new Set(above.map((it) => it.part))]
            this.bot.note('chapter', { title: `${parts.join(', ')} · ${VIEW_NAME.aerial}`, day: s.day, part: parts[0], view: 'aerial' })
            const guards = above.filter((it) => it.tower && it.tower.ground)
            // each tower on the ground framed on its own (four in one shot left two off screen)
            for (const g of guards) {
                if (!s.canEdit || s.timeToNight < 30) break
                built += await this.buildTile([g])
            }
            const tiles = new Map()
            for (const it of above) {
                if (this.done(it) || (it.tower && it.tower.ground)) continue
                const band = Math.floor((it.cell[1] - FLOOR) / BAND)
                const k = `${band},${Math.floor(it.cell[0] / TILE)},${Math.floor(it.cell[2] / TILE)}`
                if (!tiles.has(k)) tiles.set(k, { band, list: [] })
                tiles.get(k).list.push(it)
            }
            for (const tile of [...tiles.values()].sort((a, b) => a.band - b.band)) {
                if (!s.canEdit || s.timeToNight < 30) break
                built += await this.buildTile(tile.list)
            }
        }
        this.bot.note('built', { n: built, day: s.day })
        return built
    }

    /** an item is done: dug open, or its block in place (a ground tower's on its column) */
    done(it) {
        const s = this.see
        if (it.dig) return passable(s.block(...it.cell))
        return super.done(it)
    }

    /** nothing solid over a cell, up to the sky (the aerial view can see it) */
    skyOpen(cell) {
        for (let y = cell[1] + 1; y < 70; y++) if (standable(this.see.block(cell[0], y, cell[2]))) return false
        return true
    }

    /** a block next to the cell to build against */
    hasSupport(cell) {
        return FACES.some(([a, b, c]) => standable(this.see.block(cell[0] + a, cell[1] + b, cell[2] + c)))
    }

    /** first or third person, on foot */
    async setView(view) {
        const s = this.see
        await this.beSelf()
        const third = view === 'third'
        if (!!s.g.control.thirdPerson !== third) {
            this.bot.input.tap('KeyV')
            await this.bot.until(() => !!s.g.control.thirdPerson === third, 1.5)
            await this.bot.wait(0.3)
        }
    }

    /** in reach from where the bot stands, with a face to build against (or, to dig, in view) */
    inReachNow(it) {
        const k = this.k
        if (it.dig) return k.reachable(it.cell, 0.8) && k.clearTo(this.see.eye(), it.cell)
        if (this.see.block(...it.cell) !== 0) return false
        if (k.inCell(it.cell)) return false
        return k.clearTo(this.see.eye(), it.cell) && k.supportFaces(it.cell).some((f) => f.facing > 0.05 && f.clear && f.dist < REACH - 0.4)
    }

    /**
     * Build a list on foot, in order: go where the next block is in reach, then
     * build everything else in reach from there (by material: fewer hotbar
     * changes), and on.
     * @returns {Promise<number>} done
     */
    async footBuild(items, view) {
        const s = this.see
        const k = this.k
        await this.setView(view)
        const parts = [...new Set(items.map((it) => it.part))]
        this.bot.note('chapter', { title: `${parts.join(', ')} · ${VIEW_NAME[view]}`, day: s.day, part: parts[0], view })
        let done = 0
        let pending = items.filter((it) => !this.done(it))
        let misses = 0
        while (pending.length && s.canEdit && s.timeToNight > Math.max(30, this.dayEnd()) && misses < 12) {
            const next = pending.find((it) => it.dig || this.hasSupport(it.cell))
            if (!next) break
            k.activity = `building:${next.part}`
            const ok = next.dig ? await k.goMine(next.cell) : (s.count(next.b) > 0 && (await k.goPlace(next.cell, next.b)))
            if (!ok) {
                this.markFailed(key(next.cell))
                misses++
                pending = pending.filter((it) => it !== next)
                continue
            }
            misses = 0
            done++
            this.checkMilestones()
            // everything else in reach from here, digs first, then by material
            for (let pass = 0; pass < 3; pass++) {
                const here = pending.filter((it) => !this.done(it) && (it.dig || s.count(it.b) > 0) && (it.dig || this.hasSupport(it.cell)) && this.inReachNow(it))
                    .sort((a, b) => Number(!!b.dig) - Number(!!a.dig) || a.cell[1] - b.cell[1] || (a.b < b.b ? -1 : a.b > b.b ? 1 : 0))
                if (!here.length) break
                for (const it of here) {
                    if (!s.canEdit || s.timeToNight < 30) break
                    if (this.done(it) || !this.inReachNow(it)) continue
                    const r = it.dig ? await k.mine(it.cell) : await k.place(it.cell, it.b)
                    if (r) {
                        done++
                        await this.bot.wait(0.04)
                    }
                }
            }
            pending = pending.filter((it) => !this.done(it) && !this.hasFailed(key(it.cell)))
        }
        return done
    }

    // ---- moments for the video --------------------------------------------------------------

    milestone(name, caption, len = 8) {
        if (this.milestones.has(name)) return false
        this.milestones.add(name)
        this.bot.note('milestone', { name, caption, len, day: this.see.day })
        return true
    }

    /** the flights meeting at the landing; the first time up on level 2 */
    checkMilestones() {
        const s = this.see
        if (!this.milestones.has('flights') && this.topTreads.every(([x, y, z]) => s.block(x, y, z) !== 0)) {
            this.milestone('flights', 'The two flights meet at the landing')
        }
        const f = s.feetCell()
        if (!this.milestones.has('up') && f[1] >= L2_Y + 1 && Math.abs(f[0]) <= 13 && Math.abs(f[2]) <= 11) {
            this.milestone('up', 'Up the stairs to level 2', 10)
        }
    }

    /** a part is built (all but a few of its blocks) */
    partDone(name) {
        const p = this.palace.parts.find((x) => x.name === name)
        if (!p) return false
        const s = this.see
        const missing = p.cells.filter(([x, y, z, b]) => s.block(x, y, z) !== blockId(b)).length
        return missing <= Math.max(3, p.cells.length * 0.03)
    }

    /**
     * Once the roof is on: stand inside the door and look up the full height
     * of the hall, past level 2, into the roof (plan 12 §6.10).
     */
    async lookUp() {
        const s = this.see
        if (this.milestones.has('look-up') || !this.partDone('the roof') || !s.canEdit) return
        await this.setView('first')
        const tc = s.tc
        const ok = await this.k.walkTo((x, y, z) => Math.abs(x - tc[0]) <= 1 && z >= tc[2] + 8 && z <= tc[2] + 10 && y === tc[1], [tc[0] + 0.5, tc[1], tc[2] + 9.5], { tries: 2 })
        if (!ok) return
        this.milestone('look-up', 'The great hall: twelve high, and the roof thirty-eight up', 10)
        this.k.activity = 'looking'
        for (const [pitch, t] of [[-0.25, 2.5], [-0.75, 3.5], [-1.1, 3]]) {
            this.k.lookDir(Math.PI, pitch)
            await this.bot.wait(t)
        }
    }

    /**
     * The end, before the flyover: in through the door, up a flight to the
     * landing, and a look down at the crystal (plan 12 §6.10).
     */
    async tour() {
        const s = this.see
        if (this.milestones.has('tour')) return
        this.milestones.add('tour')
        await this.setView('first')
        const tc = s.tc
        this.bot.note('milestone', { name: 'tour', caption: 'A walk through the palace', len: 40, day: s.day })
        this.k.activity = 'tour'
        await this.k.walkTo((x, y, z) => Math.abs(x - tc[0]) <= 1 && z === tc[2] + 13 && y === tc[1], [tc[0] + 0.5, tc[1], tc[2] + 13.5], { tries: 2 })
        this.k.lookDir(Math.PI, -0.2)
        await this.bot.wait(2)
        await this.k.walkTo((x, y, z) => y >= L2_Y + 1 && Math.abs(x - tc[0]) <= 3 && z <= tc[2] - 4 && z >= tc[2] - 8, [tc[0] + 0.5, L2_Y + 1, tc[2] - 5.5], { tries: 2, maxNodes: 60000 })
        this.k.lookDir(0, 0.6)
        await this.bot.wait(4)
    }

    /**
     * The palace is done: exported at once (as iteration 10's castle), then the
     * walk through it, a turn round it from above, and SHOW_NIGHTS nights.
     */
    async finished() {
        const s = this.see
        const bot = this.bot
        if (this.finishedDay === null) {
            this.finishedDay = s.day
            bot.note('chapter', { title: 'the palace is finished', day: s.day })
            bot.note('castle-done', { day: s.day })
        }
        if (!this.exported) {
            await this.beSelf()
            await this.goHome()
            await this.exportWorld()
        }
        if (s.day - this.finishedDay >= SHOW_NIGHTS) {
            bot.done = 'palace exported'
            for (;;) await bot.wait(1)
        }
        if (s.phase === 'day') await this.tour()
        await this.air.enter()
        const v = this.palace.views.reference
        await this.air.lookAt([v.x, v.y, v.z], { zoom: 70 })
        this.k.activity = 'flyover'
        bot.note('chapter', { title: 'the finished palace', day: s.day })
        const until = bot.time + 45
        while (s.phase === 'day' && bot.time < until) {
            bot.input.keyDown('KeyC')
            await bot.wait(0.5)
            bot.input.keyUp('KeyC')
            await bot.wait(1.5)
        }
        if (s.phase === 'day') bot.input.tap('KeyN')
        for (;;) await bot.wait(1)
    }

    // ---- the day: the palace's troops ---------------------------------------------------------

    async day() {
        // day 1: the kit's swordsman and archer guard the Town Center, as iteration 10's did (night 1
        // was lost with the swordsman out at the front gate and the archer in the pack)
        if (this.see.day === 1) await super.placeTroops()
        // the guard's upgrades get the night's iron first, then the troops
        await this.upgradeTowers()
        await this.placeTroops()
        await this.lookUp()
        return super.day()
    }

    /** the troops ready to go out, and the stock pays for (or they're in the pack) */
    troopsReady() {
        const s = this.see
        const keep = this.guardReserve()
        return this.readyTroops().filter((t) => s.count(t.type) > 0 || Object.entries(rawCost(t.type)).every(([k, v]) => s.count(k) - (keep[k] || 0) >= v))
    }

    /**
     * The day's work stops early when troops crafted in the day wait to go out,
     * so they're at their posts for the night (night 1 of the first run was lost
     * with three swordsmen in the pack).
     */
    dayEnd() {
        if (this._troopsDay === this.see.day || !this.see.canEdit) return 40
        return this.troopsReady().length ? TROOPS_BEFORE_DUSK : 40
    }

    async goHome() {
        const s = this.see
        if (this._troopsDay !== s.day && s.canEdit && this.troopsReady().length) {
            this._troopsDay = s.day
            await this.air.leave()
            await this.placeTroops(20)
        }
        return super.goHome()
    }

    /**
     * Troops go to their spots as soon as there's ground under them and the
     * stock pays: archers walked up the stairs to their openings on level 2,
     * swordsmen inside the gates, gunners on the bastions.
     */
    /** troop posts built and still empty */
    readyTroops() {
        const s = this.see
        return this.palace.troops.filter((t) => {
            if (this.troopsPlaced.has(t.spot) || this.hasFailed(`troop:${t.spot}`)) return false
            // an archer's opening is ready once it is one: level 2's wall stands round it (its pointed head is in)
            if (t.type === 'archer' && !standable(s.block(t.x, t.y + 3, t.z))) return false
            return standable(s.block(t.x, t.y - 1, t.z)) && passable(s.block(t.x, t.y, t.z)) && passable(s.block(t.x, t.y + 1, t.z))
        })
    }

    /** the troops to their posts, while `minTime` seconds of daylight are left */
    async placeTroops(minTime = 60) {
        const s = this.see
        if (!s.canEdit) return
        const ready = this.readyTroops()
        if (!ready.length) return
        // craft what the stock pays for (the gold the nights bring)
        const want = {}
        for (const t of ready) want[t.type] = (want[t.type] || 0) + 1
        // what the stock pays for, past the iron and gold kept for the crystal's guard
        const keep = this.guardReserve()
        const left = { iron: s.count('iron') - keep.iron, gold: s.count('gold') - keep.gold, planks: s.count('planks') + 4 * s.count('log') }
        for (const [type, n] of Object.entries(want)) {
            const cost = rawCost(type)
            let make = Math.max(0, n - s.count(type))
            for (const [k, v] of Object.entries(cost)) if (k in left) make = Math.min(make, Math.floor(left[k] / v))
            make = Math.max(0, make)
            for (const [k, v] of Object.entries(cost)) if (k in left) left[k] -= v * make
            want[type] = make
        }
        if (Object.values(want).some((n) => n > 0)) await super.craftFor({ cells: [], towers: [], extra: want })
        let placed = 0
        const said = new Set()
        for (const t of ready) {
            if (!s.canEdit || s.timeToNight < minTime) break
            if (s.count(t.type) <= 0) continue
            await this.setView('first')
            const title = t.type === 'archer' ? 'archers to their openings · first person' : 'troops to their posts · first person'
            if (!said.has(title)) {
                said.add(title)
                this.bot.note('chapter', { title, day: s.day, part: t.type === 'archer' ? 'archers' : 'troops', view: 'first' })
            }
            this.k.activity = 'placing troops'
            if (await this.k.goPlace([t.x, t.y, t.z], t.type)) {
                this.troopsPlaced.add(t.spot)
                placed++
                this.bot.note('troop', { type: t.type, spot: t.spot })
            } else this.markFailed(`troop:${t.spot}`)
        }
    }

    /**
     * The crystal's guard, a tier at a time (arrow, crossbow, ballista) as the
     * iron comes, from above while the sky over the hall is open. Brutes take
     * half from arrows, and the night answers arrow towers with brutes: run 2's
     * nights 4 and 5 fell to 52% and 38%, nearly all of it brutes. Iteration 10's
     * castle held on its ballistas. (The design's own towers are each of their
     * kind, every kind once at least: none of those is upgraded away.)
     * @returns {Promise<number>} upgraded
     */
    async upgradeTowers() {
        const s = this.see
        let done = 0
        while (s.canEdit && s.timeToNight > 60) {
            const g = this.guardToUpgrade()
            if (!g) break
            const cost = rawCost(g.next)
            if (Object.entries(cost).some(([k, v]) => (k === 'planks' ? s.count('planks') + 4 * s.count('log') : s.count(k)) < v) && s.count(g.next) <= 0) break
            await this.craftFor({ cells: [], towers: [], extra: { [g.next]: 1 } })
            if (s.count(g.next) <= 0) break
            if (!(await this.air.enter())) break
            if (!done) this.bot.note('chapter', { title: 'the crystal\'s guard, stronger · from above', day: s.day, part: 'upgrades', view: 'aerial' })
            await this.air.lookAt([g.at[0] + 0.5, g.at[1] - 0.5, g.at[2] + 0.5], { zoom: ZOOM })
            if (!(await this.k.select(g.next))) break
            this.k.activity = 'upgrading'
            if (await this.air.upgrade(g.at, g.next)) done++
            else {
                this.markFailed(`upgrade:${key(g.at)}`)
                break
            }
        }
        return done
    }

    /** the crystal's guard towers standing, each with its tier, where its tower block is, and the next tier */
    guard() {
        const s = this.see
        const tiers = ['arrow_tower', 'crossbow_tower', 'ballista_tower']
        return this.palace.towers.filter((t) => t.early).map((t) => {
            const at = [t.x, t.y + 2, t.z]
            const tier = tiers.indexOf(BLOCK_BY_ID[s.block(...at)]?.name)
            return { t, at, tier, next: tiers[tier + 1] || null }
        })
    }

    /** the lowest guard tower to upgrade next (from above: the sky over it open) */
    guardToUpgrade() {
        return this.guard().filter((g) => g.tier >= 0 && g.next && this.skyOpen(g.at) && !this.hasFailed(`upgrade:${key(g.at)}`))
            .sort((a, b) => a.tier - b.tier)[0] || null
    }

    /** iron and gold kept for the guard's upgrades still to come (they come first) */
    guardReserve() {
        const out = { iron: 0, gold: 0 }
        for (const g of this.guard()) {
            if (!this.skyOpen(g.at)) continue
            for (const b of ['crossbow_tower', 'ballista_tower'].slice(Math.max(0, g.tier))) {
                const c = rawCost(b)
                out.iron += c.iron || 0
                out.gold += c.gold || 0
            }
        }
        return out
    }
}

