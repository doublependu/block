/*
 *  --strategy=palace: plan 12's ice palace (castle/palace.js), in survival, on
 *  a Large world (plan 12 §6.5–6.7).
 *
 *  It's iteration 10's castle bot (bot/castle.js: the day plan, the quarry hall,
 *  crafting, the nights, the export at the end) with a different design and
 *  three ways of building, a view per part (palace.js ORDER):
 *
 *    first   on foot, in first person: the grass dug out of the hall's floor
 *            (its white bricks are then laid from above), the staircase step by
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
import { buildPalace, FLOOR, L2_Y, HALL } from '../castle/palace.js'
import { REACH } from '../../../src/game/balance.js'
import { BLOCK_BY_ID, BLOCK_BY_NAME, blockId } from '../../../src/world/blocks.js'
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
/**
 * The parts that close the rings, first in line for iron and gold, in this order: the hall's
 * first level (its door stands in a portal of clear ice) and its door, then the curtain and its gates
 */
const RINGS = ['level 1', 'the door', 'curtain', 'gates']
/** seconds of a morning spent digging for ore while the rings or the towers up high wait for iron or gold */
const ORE_RUN = 210
/** days the towers and troops still out get, once every block is in, before the palace is called finished */
const WAIT_DAYS = 3
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
        /** the day the last block went in (null before): see complete() */
        this.blocksDoneDay = (bot.restored && bot.restored.strategy && bot.restored.strategy.blocksDoneDay) ?? null
        /** the moments the edit keeps at 1× (plan 12 §6.10), once each (kept across a restart from a checkpoint) */
        this.milestones = new Set((bot.restored && bot.restored.strategy && bot.restored.strategy.milestones) || [])
        /** the last tread of each flight: both in, and the flights have met */
        this.topTreads = palace.treads.filter((t) => t.i === Math.max(...palace.treads.map((x) => x.i))).flatMap((t) => t.cells)
        bot.note('palace', { blocks: palace.cells.length, dig: palace.dig.length, towers: palace.towers.length, troops: palace.troops.length, parts: palace.parts.map((p) => [p.name, p.cells.length, p.view]) })
    }

    roleChoice() {
        return 'aerial'
    }

    saveState() {
        return { ...super.saveState(), milestones: [...this.milestones], blocksDoneDay: this.blocksDoneDay }
    }

    /**
     * Finished: every block in, every tower up and every troop at its post. The
     * towers and troops take iron and gold, which the nights pay only when they're
     * won: once the blocks are all in, what's still out gets WAIT_DAYS more days
     * (the bot digs for ore meanwhile), then the palace is finished as it stands.
     */
    complete() {
        if (!this.partsDone()) return false
        if (super.complete() && !this.troopsLeft().length && !this.scarceLeft()) return true
        if (this.blocksDoneDay === null) {
            this.blocksDoneDay = this.see.day
            this.bot.note('blocks-done', { day: this.see.day, towers: this.pendingTowers().length, troops: this.troopsLeft().length })
        }
        return this.see.day - this.blocksDoneDay >= WAIT_DAYS
    }

    /**
     * Iron and gold the rest of the palace still takes, past what's in the pack
     * (looked at again every 20 s: it reads every block of the design).
     */
    oreWanted() {
        if (this._ore && this.bot.time - this._ore.t < 20) return this._ore
        const s = this.see
        const need = { iron: 0, gold: 0 }
        const add = (b) => {
            const c = rawCost(b)
            need.iron += c.iron || 0
            need.gold += c.gold || 0
        }
        for (const c of this.remaining()) if (!c.dig) add(c.b)
        for (const t of this.palace.towers) if (!BLOCK_BY_ID[s.block(t.x, t.ground ? t.y + 2 : t.y, t.z)]?.tower) add(t.block)
        for (const t of this.troopsLeft()) add(t.type)
        const g = this.guardReserve()
        this._ore = { t: this.bot.time, iron: need.iron + g.iron > s.count('iron'), gold: need.gold + g.gold > s.count('gold'), need }
        return this._ore
    }

    /**
     * The quarry goes for ore it can see within 6 of the face while the palace
     * still wants iron or gold. A night that's lost pays none, and the hall's
     * rows alone turn up about three iron a day: the gates, the towers up high
     * and the clear ice take over two hundred.
     */
    oreReach() {
        const w = this.oreWanted()
        return w.iron || w.gold ? { r: 6, iron: w.iron, gold: w.gold } : { r: 2, iron: true, gold: true }
    }

    /** a block that takes iron or gold (clear ice, spikes, the iron and steel walls and gates) */
    isScarce(b) {
        const r = rawCost(b)
        return (r.iron || 0) > 0 || (r.gold || 0) > 0
    }

    /** blocks of the design still out that take iron or gold */
    scarceLeft() {
        return this.remaining().filter((c) => !c.dig && this.isScarce(c.b) && !this.gaveUp(key([c.x, c.y, c.z]))).length
    }

    /**
     * Every part built but for a few blocks, not counting the blocks that wait
     * for iron or gold: those get the days of grace the towers and troops get
     * (complete()), or a game whose nights pay nothing would never end.
     */
    partsDone() {
        const left = {}
        for (const c of this.remaining()) {
            if (this.gaveUp(key([c.x, c.y, c.z])) || (!c.dig && this.isScarce(c.b))) continue
            left[c.part] = (left[c.part] || 0) + 1
        }
        return this.palace.parts.every((p) => (left[p.name] || 0) <= Math.max(3, p.cells.length * 0.03))
    }

    /** the design's troops not out yet */
    troopsLeft() {
        return this.palace.troops.filter((t) => !this.troopOut(t))
    }

    /** nothing to build with what's in stock: dig on in the quarry for the iron and gold the rest waits for */
    async whileWaiting() {
        const s = this.see
        if (!s.canEdit || s.timeToNight < this.dayEnd() + 30) return false
        const waiting = this.pendingTowers().some((t) => !this.gaveUp(key([t.x, t.y, t.z]))) || this.troopsLeft().length > 0
            || this.remaining().some((c) => !c.dig && !this.gaveUp(key([c.x, c.y, c.z])))
        if (!waiting) return false
        this.bot.note('need', { ore: true, iron: s.count('iron'), gold: s.count('gold') })
        await this.beSelf()
        await this.mineHall(4)
        if (await this.oreRun(this.bot.time + ORE_RUN, () => this.oreWanted())) return true
        return this.mineHall(60)
    }

    /**
     * A troop of the design is out at its post: read from the game's own list of
     * placed troops, so it holds after a restart from a checkpoint too.
     */
    troopOut(t) {
        for (const p of this.see.g.placements.values()) {
            if (p.type === t.type && Math.floor(p.pos[0]) === t.x && Math.floor(p.pos[2]) === t.z && Math.abs(p.pos[1] - t.y) < 1.5) return true
        }
        return false
    }

    // ---- what's left -----------------------------------------------------------------------

    /**
     * Cells still to do, in order. A cell to dig is done when it's open, or built
     * in already (the floor's cells are dug, then relaid: a brick there means the
     * digging is long done); a cell to build is done when its block is there. A
     * natural block where the design digs first is still to do (it's dug, then
     * built); anything else solid is left.
     */
    remaining() {
        const s = this.see
        const out = []
        for (const c of this.order) {
            const id = s.block(c.x, c.y, c.z)
            if (c.dig) {
                if (this.dugOut(id)) continue
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
        // what failed before goes last (it's hard to reach: a whole part still to build comes first).
        // Not "the last tenth of a part", iteration 10's rule: that left the last 65 cells of the
        // floor open and the front gate's lintel unbuilt until everything else was done
        const straggler = (c) => this.failed.has(key([c.x, c.y, c.z]))
        // (and while a ring is open, its cells come first, the hall's before the curtain's: they
        // take the iron in that order)
        const ring = (c) => (c.dig ? -1 : RINGS.indexOf(c.part) < 0 ? RINGS.length : RINGS.indexOf(c.part))
        const rem = all.filter((c) => !this.hasFailed(key([c.x, c.y, c.z]))).sort((a, b) => Number(straggler(a)) - Number(straggler(b)) || ring(a) - ring(b))
        // iron and gold go, in this order, to: the crystal's guard (its upgrades), the gates and the
        // hall's door, the towers up high, and then everything else. What an earlier one still
        // needs is kept back from the later ones
        const keep = this.guardReserve()
        const tiers = [this.gateReserve(), this.highReserve()]
        let iron = s.count('iron') - keep.iron, gold = s.count('gold') - keep.gold
        /** @param {number} tier 1: a gate, 2: a tower up high, 3: anything else */
        const fits = (b, n = 1, tier = 3) => {
            const need = this._scarce(b, n)
            let ki = 0, kg = 0
            for (let i = 0; i < Math.min(tier - 1, tiers.length); i++) {
                ki += tiers[i].iron
                kg += tiers[i].gold
            }
            // (with iron kept back the budget can be below 0: what needs none still fits)
            if ((need.iron > 0 && need.iron > iron - ki) || (need.gold > 0 && need.gold > gold - kg)) return false
            iron -= need.iron
            gold -= need.gold
            if (tier <= tiers.length) {
                // its share of what was kept is spent
                tiers[tier - 1].iron = Math.max(0, tiers[tier - 1].iron - need.iron)
                tiers[tier - 1].gold = Math.max(0, tiers[tier - 1].gold - need.gold)
            }
            return true
        }
        const isGate = (c) => RINGS.includes(c.part)
        const towers = this.pendingTowers().filter((t) => !this.hasFailed(key([t.x, t.y, t.z])) && fits(t.block, 1, this.isHigh(t) ? 2 : 3))
        // the crystal's guard first, on its own: a small load built on day 1, before the quarry
        const early = towers.filter((t) => t.early)
        if (early.length) return { cells: [], towers: early }
        const cells = []
        const counted = {}
        // only what can go in now: a cell with a block to be set against, in the world or earlier in
        // this load. (A day went to a load of roof and spire while level 2's walls under them
        // weren't up: every block of it failed, and three failures give a cell up for good)
        const taken = new Set()
        const inLoad = new Set()
        const ready = (c) => c.dig || this.hasSupport([c.x, c.y, c.z]) || FACES.some(([a, b, d]) => inLoad.has(key([c.x + a, c.y + b, c.z + d])))
        for (let pass = 0; pass < 2; pass++) {
            for (const c of rem) {
                if (cells.length >= LOAD) break
                if (taken.has(c) || !ready(c)) continue
                if (!c.dig) {
                    // what's already crafted covers the first of a kind; the rest take raw stock
                    counted[c.b] = (counted[c.b] || 0) + 1
                    if (counted[c.b] > s.count(c.b) && !fits(c.b, 1, isGate(c) ? 1 : 3)) {
                        counted[c.b]--
                        continue
                    }
                    if (BLOCK_BY_NAME[c.b]?.solid) inLoad.add(key([c.x, c.y, c.z]))
                }
                taken.add(c)
                cells.push(c)
            }
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
        // from above: its own parts, and what didn't work on foot under an open sky
        // (a cell of the floor still to be dug out isn't one yet: nothing goes into grass)
        const above = () => items.filter((it) => !it.dig && !this.done(it) && s.count(it.b) > 0 && passable(s.block(...it.cell)) && (it.view === 'aerial' || this.skyOpen(it.cell)))
        // the towers and the floor first: seconds of work from above, and a day's on-foot work
        // never left time for them after it (two frost towers sat in the pack for three days)
        built += await this.aerialBuild(above().filter((it) => it.tower || it.part === 'the floor'))
        await this.air.leave()
        for (const view of ['first', 'third']) {
            const mine = items.filter((it) => it.view === view && !this.done(it))
            if (!mine.length) continue
            built += await this.footBuild(mine, view)
        }
        built += await this.aerialBuild(above())
        this.bot.note('built', { n: built, day: s.day })
        return built
    }

    /**
     * Build a list from above: each tower on the ground framed on its own, the
     * rest in tiles the view takes in at once, bottom up.
     * @returns {Promise<number>} built
     */
    async aerialBuild(above) {
        const s = this.see
        if (!above.length || !s.canEdit || s.timeToNight <= Math.max(30, this.dayEnd()) || !(await this.air.enter())) return 0
        let built = 0
        const parts = [...new Set(above.map((it) => it.part))]
        this.bot.note('chapter', { title: `${parts.join(', ')} · ${VIEW_NAME.aerial}`, day: s.day, part: parts[0], view: 'aerial' })
        // each tower on the ground framed on its own (four in one shot left two off screen)
        for (const g of above.filter((it) => it.tower && it.tower.ground)) {
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
        return built
    }

    /** a cell to dig is dug: open, or with something built in it since */
    dugOut(id) {
        return passable(id) || !!BLOCK_BY_ID[id]?.built
    }

    /** an item is done: dug open, or its block in place (a ground tower's on its column) */
    done(it) {
        const s = this.see
        if (it.dig) return this.dugOut(s.block(...it.cell))
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
        let why = 'all done'
        while (pending.length) {
            if (!s.canEdit || s.timeToNight <= Math.max(30, this.dayEnd())) {
                why = 'the day is over'
                break
            }
            if (misses >= 12) {
                why = '12 in a row failed'
                break
            }
            const next = pending.find((it) => it.dig || (s.count(it.b) > 0 && this.hasSupport(it.cell)))
            if (!next) {
                why = 'nothing left has a block in stock and a face to go against'
                break
            }
            k.activity = `building:${next.part}`
            const ok = next.dig ? await k.goMine(next.cell) : await k.goPlace(next.cell, next.b)
            if (!ok) {
                this.markFailed(key(next.cell))
                misses++
                pending = pending.filter((it) => it !== next)
                continue
            }
            misses = 0
            done++
            this.checkMilestones()
            // everything else in reach from here, digs first, then by material. What doesn't go in
            // from here is left for the next place the bot stands (not tried again from this one)
            const tried = new Set()
            for (let pass = 0; pass < 3; pass++) {
                const here = pending.filter((it) => !tried.has(it) && !this.done(it) && (it.dig || s.count(it.b) > 0) && (it.dig || this.hasSupport(it.cell)) && this.inReachNow(it))
                    .sort((a, b) => Number(!!b.dig) - Number(!!a.dig) || a.cell[1] - b.cell[1] || (a.b < b.b ? -1 : a.b > b.b ? 1 : 0))
                if (!here.length) break
                for (const it of here) {
                    if (!s.canEdit || s.timeToNight < 30) break
                    if (this.done(it) || !this.inReachNow(it)) continue
                    const r = it.dig ? await k.mine(it.cell) : await k.place(it.cell, it.b)
                    if (r) {
                        done++
                        await this.bot.wait(0.04)
                    } else tried.add(it)
                }
            }
            pending = pending.filter((it) => !this.done(it) && !this.hasFailed(key(it.cell)))
        }
        this.bot.note('foot', { view, done, left: pending.length, why })
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
     * The end, before the flyover (plan 12 §6.10): the front of the palace from
     * outside its door, in through the door to look up the hall, then up a
     * flight to the landing's rail, the crystal below and the hall across the
     * well. A walk, not work: nothing is dug on the way.
     */
    async tour() {
        const s = this.see
        const k = this.k
        if (this.milestones.has('tour')) return
        this.milestones.add('tour')
        await this.setView('first')
        const tc = s.tc
        const door = tc[2] + HALL.z1
        this.bot.note('milestone', { name: 'tour', caption: 'A walk through the palace', len: 50, day: s.day })
        k.activity = 'tour'
        const step = async (name, isGoal, toward, looks) => {
            const ok = await k.walkTo(isGoal, toward, { tries: 3, dig: false, maxNodes: 80000 })
            this.bot.note('tour', { step: name, ok, at: s.feetCell() })
            k.activity = 'tour'
            if (!ok) return
            for (const [look, t] of looks) {
                look()
                await this.bot.wait(t)
            }
        }
        // (heading π looks from the door into the hall; a pitch below 0 looks up)
        await step('outside', (x, y, z) => Math.abs(x - tc[0]) <= 1 && z >= door + 5 && z <= door + 7, [tc[0] + 0.5, tc[1], door + 6.5],
            [[() => k.lookDir(Math.PI, -0.1), 1.5], [() => k.lookDir(Math.PI, -0.75), 2.5]])
        await step('the hall', (x, y, z) => Math.abs(x - tc[0]) <= 1 && z >= door - 4 && z <= door - 2 && y === tc[1], [tc[0] + 0.5, tc[1], door - 2.5],
            [[() => k.lookDir(Math.PI, -0.15), 1.5], [() => k.lookDir(Math.PI, -0.9), 2.5]])
        // the landing's rail has a post in the middle: stand beside it
        await step('the landing', (x, y, z) => y === L2_Y + 1 && Math.abs(x - tc[0]) === 1 && z === tc[2] - 3, [tc[0] + 1.5, L2_Y + 1, tc[2] - 2.5],
            [[() => k.lookAt([tc[0] + 0.5, tc[1] + 2.5, tc[2] + 2.5]), 3], [() => k.lookDir(0, -0.2), 3]])
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

    /** how far the build is, for the log (long-run.mjs --status reads the last one) */
    noteProgress() {
        const s = this.see
        const left = this.remaining()
        const parts = {}
        for (const c of left) parts[c.part] = (parts[c.part] || 0) + 1
        const towers = this.palace.towers.filter((t) => !BLOCK_BY_ID[s.block(t.x, t.ground ? t.y + 2 : t.y, t.z)]?.tower).length
        const troops = this.palace.troops.filter((t) => !this.troopOut(t)).length
        this._ore = null
        const ore = this.oreWanted()
        this.bot.note('progress', { day: s.day, left: left.length, total: this.order.length, parts, towers, troops, iron: s.count('iron'), gold: s.count('gold'), stillTakes: { iron: Math.round(ore.need.iron), gold: Math.round(ore.need.gold) } })
    }

    async day() {
        this.noteProgress()
        // day 1: the kit's swordsman and archer guard the Town Center, as iteration 10's did (night 1
        // was lost with the swordsman out at the front gate and the archer in the pack)
        if (this.see.day === 1) await super.placeTroops()
        // the guard's upgrades get the night's iron first, then the troops
        await this.upgradeTowers()
        await this.placeTroops()
        await this.lookUp()
        await this.fetchOre()
        return super.day()
    }

    /**
     * While the rings or the towers up high wait for iron or gold: dig for ore
     * first thing, up to ORE_RUN seconds of the morning. A lost night pays
     * nothing, and with a gateway open nights are lost: without this the game
     * sat at night 9 with one iron in the pack.
     */
    async fetchOre() {
        const s = this.see
        // (only for what's first in line, the rings and the towers up high. Three and a half minutes
        // every morning for everything else left no day to build in: the clear ice, the spikes and
        // the towers on the ground get their ore once the blocks are in, in the days of grace)
        const short = () => {
            const need = this.reserve()
            return { iron: s.count('iron') < need.iron, gold: s.count('gold') < need.gold }
        }
        const w = short()
        if ((!w.iron && !w.gold) || !s.canEdit || s.timeToNight < 240) return
        this.bot.note('need', { ore: true, iron: s.count('iron'), gold: s.count('gold'), kept: this.reserve() })
        await this.beSelf()
        // down to the quarry's face (a few blocks of its row), then straight for the ore round it
        await this.mineHall(4)
        await this.oreRun(this.bot.time + ORE_RUN, short)
    }

    /** the troops ready to go out, and the stock pays for (or they're in the pack) */
    troopsReady() {
        const s = this.see
        const keep = this.reserve()
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
            if (this.troopOut(t) || this.hasFailed(`troop:${t.spot}`)) return false
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
        // what the stock pays for, past the iron and gold kept for the crystal's guard and the towers up high
        const keep = this.reserve()
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
            // a gunner's post is a bastion's deck, four up with no way up on foot: set down from above
            const above = t.type === 'gunner'
            const title = above ? 'gunners to the bastions · from above' : t.type === 'archer' ? 'archers to their openings · first person' : 'troops to their posts · first person'
            const say = () => {
                if (said.has(title)) return
                said.add(title)
                this.bot.note('chapter', { title, day: s.day, part: above ? 'gunners' : t.type === 'archer' ? 'archers' : 'troops', view: above ? 'aerial' : 'first' })
            }
            let ok = false
            if (above) {
                if (!(await this.air.enter())) break
                say()
                await this.air.lookAt([t.x + 0.5, t.y - 0.5, t.z + 0.5], { zoom: ZOOM })
                this.k.activity = 'placing troops'
                ok = (await this.k.select(t.type)) && (await this.air.placeUnit([t.x, t.y, t.z], () => this.troopOut(t)))
                if (!ok) this.bot.note('place-failed', { item: t.type, at: [t.x, t.y, t.z], why: this.air.why, aerial: true })
            } else {
                await this.setView('first')
                say()
                this.k.activity = 'placing troops'
                ok = await this.k.goPlace([t.x, t.y, t.z], t.type)
            }
            if (ok) {
                placed++
                this.bot.note('troop', { troop: t.type, spot: t.spot })
            } else this.markFailed(`troop:${t.spot}`)
        }
        // (whoever called goes on by foot)
        if (this.air.on) await this.beSelf()
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
            const have = (k) => (k === 'planks' ? s.count('planks') + 4 * s.count('log') : s.count(k))
            const short = Object.entries(cost).filter(([k, v]) => have(k) < v).map(([k]) => k)
            if (short.length && s.count(g.next) <= 0) {
                // iron and gold come with the nights and the quarry's ore. Wood and stone are fetched
                // now (the second day's guard stayed arrow towers with 10 iron in the pack and no planks)
                if (short.includes('iron') || short.includes('gold') || s.timeToNight < 150) break
                await this.beSelf()
                if (!(short.includes('planks') ? await this.chopTree() : await this.mineHall(20))) break
                continue
            }
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

    /** a tower of the design out of a fire mage's reach, and due early: on a corner tower's balcony */
    isHigh(t) {
        return !t.ground && /balcony/.test(t.spot)
    }

    /**
     * Iron and gold kept for the balconies' towers still to come. Fire mages (from
     * night 7) blow up every tower on the ground, the crystal's guard first; 30 up,
     * these are out of their reach. Night 7 of the recorded game was lost with four
     * ballistas on the ground and none up high: so they come before troops, the
     * towers on the ground and clear ice.
     */
    highReserve() {
        const s = this.see
        const out = { iron: 0, gold: 0 }
        const crafted = {}
        for (const t of this.palace.towers) {
            if (!this.isHigh(t) || BLOCK_BY_ID[s.block(t.x, t.y, t.z)]?.tower) continue
            // (one already crafted and in the pack is paid for)
            crafted[t.block] = (crafted[t.block] || 0) + 1
            if (crafted[t.block] <= s.count(t.block)) continue
            const c = rawCost(t.block)
            out.iron += c.iron || 0
            out.gold += c.gold || 0
        }
        return out
    }

    /**
     * Iron and gold kept for the gates still to go in (the curtain's steel and
     * iron ones). An open gateway is no wall: the troops, who'd take the same
     * iron, wait for them (three gunners took twelve iron the morning the gates
     * were due).
     */
    gateReserve() {
        const s = this.see
        const out = { iron: 0, gold: 0 }
        const crafted = {}
        for (const c of this.order) {
            if (c.dig || !RINGS.includes(c.part) || s.block(c.x, c.y, c.z) === c.id) continue
            crafted[c.b] = (crafted[c.b] || 0) + 1
            if (crafted[c.b] <= s.count(c.b)) continue
            const r = rawCost(c.b)
            out.iron += r.iron || 0
            out.gold += r.gold || 0
        }
        return out
    }

    /** all the iron and gold kept back from troops: the guard's upgrades, the gates, the towers up high */
    reserve() {
        const g = this.guardReserve(), a = this.gateReserve(), h = this.highReserve()
        return { iron: g.iron + a.iron + h.iron, gold: g.gold + a.gold + h.gold }
    }

    /** a tower of the design is never given up on: a spot the view couldn't reach is tried again later */
    markFailed(k) {
        super.markFailed(k)
        const f = this.failed.get(k)
        if (f && f.n >= 3 && this.palace.towers.some((t) => key([t.x, t.y, t.z]) === k)) f.n = 2
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

