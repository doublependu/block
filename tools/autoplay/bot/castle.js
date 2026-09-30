/*
 *  --strategy=castle: build ref/castle.jpg in survival (plan 10 §3.5–3.6).
 *
 *  The blueprint (tools/autoplay/castle/blueprint.js) is built part by part in
 *  the order a real castle goes up: the curtain wall and gatehouse first (the
 *  nights start on day 1), then the Palas, its towers, the knights' wing, the
 *  square tower and the tall tower. Each part's archery towers go on once the
 *  part is done, on its high places.
 *
 *  Day:   everything by input, like a player. Gathering is in first person:
 *         cobble from a quarry hall dug underground behind the castle (so the
 *         landscape stays whole), sand from the nearest beach for windows,
 *         logs for gates and towers, iron that turns up in the hall. Building
 *         is from the aerial view, which has no reach limit, so the body stays
 *         at the quarry while the castle goes up: mine a load, craft it, build
 *         it, back to the face.
 *  Dusk:  home to the courtyard.
 *  Night: from above, turning slowly round the castle; the builder fights on
 *         its own.
 *  Done:  when every block and tower is in place, a few more nights to show it
 *         holds, then Export world from the menu (the harness keeps the file).
 *
 *  Every activity is named in the log (skills.activity and 'chapter' notes):
 *  tools/autoplay/edit.mjs cuts the video from them.
 */

import { RECIPES, TOWERS } from '../../../src/game/balance.js'
import { BLOCK_BY_ID, BLOCK_BY_NAME, blockId } from '../../../src/world/blocks.js'
import { buildCastle, FLOOR } from '../castle/blueprint.js'
import { Aerial } from './aerial.js'
import { Town } from './town.js'
import { passable, standable } from './nav.js'
import { TOWER_COLUMN } from '../../../src/game/placing.js'

const recipe = (out) => RECIPES.find((r) => r.out === out)
const SAND = BLOCK_BY_NAME.sand.id
const STONE = BLOCK_BY_NAME.stone.id
const IRON = BLOCK_BY_NAME.iron_ore.id
const GOLD = BLOCK_BY_NAME.gold_ore.id
const WATER = BLOCK_BY_NAME.water.id

/** blocks built in one go before going back to the quarry (and the cobble mined for them) */
export const LOAD = 140
/** a load's worth is enough to go and build once this much of it is in stock */
const ENOUGH = 0.8
/**
 * The quarry hall behind the castle (after the blueprint's mirror, behind is
 * +z): a stair goes straight down from the entrance, just behind the east end
 * of the curtain wall, and the hall spreads out from its foot.
 */
export const HALL = { x0: -24, x1: 34, entranceX: 8, entranceZ: 16, rows: 26, height: 3, depth: 6 }
/** a layer is built a tile this wide at a time (what the view takes in at ZOOM) */
const TILE = 14
/** courses a tile covers (one camera position for all of them) */
const BAND = 6
/** how far back the aerial view sits while building */
const ZOOM = 26
/** seconds a cell that couldn't be built or dug is left alone */
const FAIL_FOR = 60
/** a part counts as built at this share of its blocks */
const DONE_SHARE = 0.97
/** failures after which a cell or a block to dig is left for good */
const GIVE_UP = 3
/** towers upgraded a day at most (from the iron and gold the nights pay) */
const UPGRADES_A_DAY = 2
/** nights to show the finished castle holding before the export */
export const SHOW_NIGHTS = 1

/** the raw stock one placed block costs (planks can come from logs, 4 a log) */
export function rawCost(block) {
    const r = recipe(block)
    if (!r) return { [block]: 1 }
    const out = {}
    for (const [k, v] of Object.entries(r.cost)) out[k] = v / r.count
    return out
}

/** sum of raw costs for a list of block names (what is already crafted counts first) */
export function rawNeeds(blocks, stock = {}) {
    const want = {}
    for (const b of blocks) want[b] = (want[b] || 0) + 1
    const need = {}
    for (const [b, n] of Object.entries(want)) {
        const short = Math.max(0, n - (stock[b] || 0))
        if (!short) continue
        for (const [k, v] of Object.entries(rawCost(b))) need[k] = (need[k] || 0) + v * short
    }
    return need
}

/**
 * pure: the quarry's cells in digging order. First the stair: from the
 * entrance straight down, a step a row, three high, to the hall's floor. Then
 * the hall, row by row away from the castle: the stair's row out to the east
 * end and back to the west end, then each row across (serpentine), each column
 * bottom to top, so the next block is always next to one dug before.
 * @param {(x: number, z: number) => number} surface first air above the ground
 * @returns {{cells: number[][], stair: number[][], rows: number[][], floor: number, entrance: number[]}}
 */
export function hallCells(surface, hall = HALL) {
    const ex = hall.entranceX, ez = hall.entranceZ
    const top0 = surface(ex, ez) - 1
    // the floor: `depth` under the lowest ground over the hall (its roof is then always in stone)
    const steps = (y0) => top0 - y0
    let y0 = top0 - hall.depth
    for (let pass = 0; pass < 3; pass++) {
        const zs = ez + steps(y0)
        let low = Infinity
        for (let x = hall.x0; x <= hall.x1; x++) for (let z = zs; z < zs + hall.rows; z++) low = Math.min(low, surface(x, z) - 1)
        y0 = Math.min(y0, low - hall.depth)
    }
    const stair = []
    // each step top down: the top block is next to the step before
    for (let k = 0; k <= steps(y0); k++) for (let h = hall.height - 1; h >= 0; h--) stair.push([ex, top0 - k + h, ez + k])
    const zs = ez + steps(y0)
    const rows = []
    const column = (x, z) => {
        for (let y = y0; y < y0 + hall.height; y++) rows.push([x, y, z])
    }
    for (let x = ex + 1; x <= hall.x1; x++) column(x, zs)
    for (let x = ex - 1; x >= hall.x0; x--) column(x, zs)
    for (let r = 1; r < hall.rows; r++) {
        const z = zs + r
        if (r % 2) for (let x = hall.x0; x <= hall.x1; x++) column(x, z)
        else for (let x = hall.x1; x >= hall.x0; x--) column(x, z)
    }
    return { cells: [...stair, ...rows], stair, rows, floor: y0, entrance: [ex, top0, ez] }
}

export class CastleStrategy {
    /** @param {import('./bot.js').Bot} bot */
    constructor(bot) {
        this.bot = bot
        this.see = bot.see
        this.k = bot.skills
        this.air = new Aerial(bot)
        const w = this.see.g.world
        const surface = (x, z) => w.surfaceY(x, z)
        this.castle = buildCastle({ groundAt: surface })
        this.order = []
        for (const p of this.castle.parts) for (const [x, y, z, b] of p.cells) this.order.push({ x, y, z, b, id: blockId(b), part: p.name })
        this.hall = hallCells(surface)
        this.town = new Town(this.see)
        this.bot.timed('findTrees', () => this.town.findTrees(80))
        /** cells and blocks that didn't work: key -> time */
        this.failed = new Map()
        this._hallAt = 0
        this._sand = null
        /** the tower tier crafted for the load being built */
        this.towerNow = null
        this.finishedDay = null
        this.exported = false
        bot.note('castle', { blocks: this.order.length, towers: this.castle.towers.length, parts: this.castle.parts.map((p) => [p.name, p.cells.length]), hallFloor: this.hall.floor, trees: this.town.trees.length })
    }

    want() {
        const s = this.see
        const p = s.phase
        if (s.opening) return { key: 'raid', run: () => this.watch('raid') }
        if (p === 'day') return { key: `day:${s.day}`, run: () => this.day() }
        if (p === 'dusk') return { key: `dusk:${s.activeLevel}`, run: () => this.dusk() }
        if (p === 'night') return { key: `night:${s.activeLevel}`, run: () => this.night() }
        return { key: `dawn:${s.day}`, run: () => this.watch('dawn') }
    }

    roleChoice() {
        return 'aerial'
    }

    // ---- the castle's state -------------------------------------------------------------

    /** a failure is left alone for FAIL_FOR, twice as long each time it fails again; after GIVE_UP, for good */
    markFailed(key) {
        const f = this.failed.get(key)
        const n = f ? f.n + 1 : 1
        this.failed.set(key, { t: this.bot.time, n })
        if (n === GIVE_UP) this.bot.note('given-up', { at: key })
    }

    hasFailed(key) {
        const f = this.failed.get(key)
        if (!f) return false
        return f.n >= GIVE_UP || this.bot.time - f.t < FAIL_FOR * 2 ** (f.n - 1)
    }

    /** failed GIVE_UP times: left for good (a cell the aerial view can't see, say) */
    gaveUp(key) {
        const f = this.failed.get(key)
        return !!f && f.n >= GIVE_UP
    }

    /** seconds until the first failed cell or tower spot may be tried again (Infinity if none) */
    nextRetry(keys) {
        let soon = Infinity
        for (const key of keys) {
            const f = this.failed.get(key)
            if (!f || f.n >= GIVE_UP) continue
            soon = Math.min(soon, f.t + FAIL_FOR * 2 ** (f.n - 1) - this.bot.time)
        }
        return Math.max(0, soon)
    }

    /**
     * Cells still to build, in build order. A cell with anything solid in it is
     * left: a natural block (nothing to build there), or another built block
     * (it can't be built over; close enough).
     */
    remaining() {
        const s = this.see
        const out = []
        for (const c of this.order) {
            const id = s.block(c.x, c.y, c.z)
            if (id === c.id) continue
            if (id && !passable(id)) continue
            out.push(c)
        }
        return out
    }

    /**
     * Tower spots with something to stand on and no tower yet: a spot is ready
     * as soon as the block under it is built (a guard tower on the ground at
     * once), so the towers go up with the walls, not after them.
     */
    pendingTowers() {
        const s = this.see
        return this.castle.towers.filter((t) => {
            const top = t.ground ? t.y + 2 : t.y
            const here = s.block(t.x, top, t.z)
            if (BLOCK_BY_ID[here]?.tower) return false
            // a spot something solid fills (the wall rebuilt through it after a night) is left, as in remaining()
            if (!t.ground && here && !passable(here)) return false
            return t.ground || !!BLOCK_BY_ID[s.block(t.x, t.y - 1, t.z)]?.built
        })
    }

    /**
     * Finished: every part built but for a few blocks (DONE_SHARE; the last few
     * of a part are the ones hard to get at) and the ones given up on (the
     * aerial view can't see them), and every tower spot that has something to
     * stand on has its tower (or was given up on).
     */
    complete() {
        const left = {}
        for (const c of this.remaining()) if (!this.gaveUp(`${c.x},${c.y},${c.z}`)) left[c.part] = (left[c.part] || 0) + 1
        const parts = this.castle.parts.every((p) => (left[p.name] || 0) <= Math.max(3, p.cells.length * (1 - DONE_SHARE)))
        return parts && !this.pendingTowers().some((t) => !this.gaveUp(`${t.x},${t.y},${t.z}`))
    }

    /** the best arrow-family tower the stock pays for (with the cobble still needed for the castle) */
    towerTier() {
        const s = this.see
        const can = (b) => Object.entries(recipe(b).cost).every(([k, v]) => (k === 'planks' ? s.count('planks') + 4 * s.count('log') : s.count(k)) >= v)
        if (this.towerNow && s.count(this.towerNow) > 0) return this.towerNow
        for (const b of ['ballista_tower', 'crossbow_tower', 'arrow_tower']) if (can(b)) return b
        return 'arrow_tower'
    }

    /**
     * The next load: the next LOAD cells in order, and the towers with something
     * to stand on. Parts nine tenths finished go last: what's left of them is mostly
     * blocks that are hard to reach, and a whole part still to build comes first.
     */
    nextLoad() {
        const all = this.remaining()
        const left = {}
        for (const c of all) left[c.part] = (left[c.part] || 0) + 1
        const size = Object.fromEntries(this.castle.parts.map((p) => [p.name, p.cells.length]))
        const straggler = (c) => left[c.part] <= size[c.part] * 0.1
        const rem = all.filter((c) => !this.hasFailed(`${c.x},${c.y},${c.z}`))
            .sort((a, b) => Number(straggler(a)) - Number(straggler(b)))
        const towers = this.pendingTowers().filter((t) => !this.hasFailed(`${t.x},${t.y},${t.z}`))
        const cells = rem.slice(0, LOAD)
        if (!cells.length && !towers.length) return null
        return { cells, towers }
    }

    /** raw stock short for a load */
    shortFor(load) {
        const s = this.see
        const stock = {}
        const blocks = [...load.cells.map((c) => c.b), ...load.towers.map(() => 'arrow_tower')]
        for (const b of new Set(blocks)) stock[b] = s.count(b)
        const need = rawNeeds(blocks, stock)
        // and the column under each tower on the ground
        const columns = TOWER_COLUMN * load.towers.filter((t) => t.ground && !BLOCK_BY_ID[s.block(t.x, t.y, t.z)]?.built).length
        if (columns) need.cobble = (need.cobble || 0) + columns
        const have = { cobble: s.count('cobble'), sand: s.count('sand'), iron: s.count('iron'), gold: s.count('gold'), planks: s.count('planks') + 4 * s.count('log') }
        const short = {}
        for (const [k, v] of Object.entries(need)) {
            const miss = Math.ceil(v - (have[k] || 0))
            if (miss > 0) short[k] = miss
        }
        return { need, short }
    }

    // ---- day ----------------------------------------------------------------------------

    async beSelf() {
        const s = this.see
        await this.air.leave()
        if (s.mode !== 'self' && s.me().alive) {
            this.bot.input.tap('KeyM')
            await this.bot.until(() => s.mode === 'self', 2)
        }
        await this.bot.until(() => s.locked, 3)
        await this.offTheTownCenter()
    }

    /**
     * Knocked out at night, the builder gets back up on top of the Town Center,
     * where no path starts: step off it first (toward the courtyard's open side).
     */
    async offTheTownCenter() {
        const s = this.see
        const tc = s.tc
        for (let i = 0; i < 3; i++) {
            const f = s.feetCell()
            if (!(Math.abs(f[0] - tc[0]) <= 1 && Math.abs(f[2] - tc[2]) <= 1 && f[1] > tc[1])) return
            this.k.lookAt([tc[0] + 0.5, f[1], tc[2] + 6])
            await this.bot.wait(0.4)
            this.bot.input.setMoveKeys(new Set(['KeyW']))
            await this.bot.wait(0.9)
            this.bot.input.setMoveKeys(new Set())
            await this.bot.until(() => s.onGround(), 1.5)
        }
    }

    async day() {
        const s = this.see
        const bot = this.bot
        await bot.wait(1)
        if (this.complete()) return this.finished()
        await this.beSelf()
        if (s.day === 1) await this.placeTroops()
        await this.upgradeTowers()
        let idle = 0
        while (s.canEdit && s.timeToNight > 40) {
            // finished mid-day: the export at once
            if (this.complete()) return this.finished()
            const load = this.nextLoad()
            if (!load) {
                // all that's left failed a moment ago: wait for the first retry, if it comes before dusk
                const keys = [...this.remaining().map((c) => `${c.x},${c.y},${c.z}`), ...this.pendingTowers().map((t) => `${t.x},${t.y},${t.z}`)]
                const wait = this.nextRetry(keys)
                if (wait > s.timeToNight - 60) break
                this.k.activity = 'waiting'
                await bot.wait(wait + 0.5)
                continue
            }
            const { need, short } = this.shortFor(load)
            const total = Object.values(need).reduce((a, b) => a + b, 0) || 1
            const missing = Object.values(short).reduce((a, b) => a + b, 0)
            // build when most of the load is in stock, or the day is nearly over
            if (missing <= total * (1 - ENOUGH) || (s.timeToNight < 110 && missing < total)) {
                const built = await this.buildLoad(load)
                idle = built ? 0 : idle + 1
                if (idle >= 3) {
                    bot.note('build-stuck', { left: load.cells.length })
                    for (const c of load.cells.slice(0, 20)) this.markFailed(`${c.x},${c.y},${c.z}`)
                    idle = 0
                }
                continue
            }
            const got = await this.gather(short)
            if (!got) {
                bot.note('gather-failed', { short })
                if (++idle >= 4) break
            } else idle = 0
        }
        await this.air.leave()
        await this.goHome()
        this.k.activity = 'waiting'
        for (;;) await bot.wait(1)
    }

    /**
     * Night wins pay iron and gold: spend some on the towers already up, tier I
     * to II, II to III, a couple a day (the castle's stone comes first).
     */
    async upgradeTowers(max = UPGRADES_A_DAY) {
        const s = this.see
        const tierOf = (id) => ['arrow_tower', 'crossbow_tower', 'ballista_tower'].indexOf(BLOCK_BY_ID[id]?.name)
        const standing = this.castle.towers.map((t) => ({ t, tier: tierOf(s.block(t.x, t.y, t.z)) })).filter((x) => x.tier >= 0 && x.tier < 2)
        if (!standing.length) return 0
        standing.sort((a, b) => a.tier - b.tier)
        let done = 0
        for (const { t, tier } of standing) {
            if (done >= max || !s.canEdit || s.timeToNight < 60) break
            const next = tier === 0 ? 'crossbow_tower' : 'ballista_tower'
            const cost = recipe(next).cost
            // keep a reserve of iron for copper roofs and finials
            if (s.count('iron') < cost.iron + 3 || (cost.gold && s.count('gold') < cost.gold)) continue
            await this.craftFor({ cells: [], towers: [], extra: { [next]: 1 } })
            if (s.count(next) <= 0) break
            if (!(await this.air.enter())) break
            await this.air.lookAt([t.x + 0.5, t.y - 0.5, t.z + 0.5], { zoom: ZOOM })
            if (!(await this.k.select(next))) break
            this.k.activity = 'upgrading'
            if (await this.air.upgrade([t.x, t.y, t.z], next)) done++
        }
        if (done) this.bot.note('chapter', { title: 'stronger towers', day: s.day })
        return done
    }

    /** the starting troops: in the courtyard, by the Town Center */
    async placeTroops() {
        const s = this.see
        const tc = s.tc
        const spots = [[tc[0] + 3, tc[1], tc[2] - 3], [tc[0] - 3, tc[1], tc[2] - 3], [tc[0] + 4, tc[1], tc[2] + 2], [tc[0] - 4, tc[1], tc[2] + 2]]
        for (const item of ['swordsman', 'archer']) {
            if (s.count(item) <= 0) continue
            for (const spot of spots) {
                if (!passable(s.block(...spot)) || !standable(s.block(spot[0], spot[1] - 1, spot[2]))) continue
                if (await this.k.goPlace(spot, item)) break
            }
        }
    }

    /** gather what a load is short of: sand, then logs, then iron, then cobble */
    async gather(short) {
        const s = this.see
        await this.beSelf()
        if (short.sand > 0) return this.digSand(Math.min(short.sand + 4, 60))
        if (short.planks > 0) return this.chopTree()
        if (short.iron > 0 && s.count('iron') < short.iron) {
            // iron turns up in the hall: dig on, it comes
            this.bot.note('need', { iron: short.iron })
        }
        return this.mineHall(Math.max(20, Math.min(LOAD, short.cobble || 20)))
    }

    /** dig on in the quarry hall until `n` more cobble (and whatever ore shows) */
    async mineHall(n) {
        const s = this.see
        const k = this.k
        const start = s.count('cobble')
        this.bot.note('chapter', { title: 'the quarry', day: s.day })
        let fails = 0
        while (s.canEdit && s.timeToNight > 40 && s.count('cobble') - start < n && fails < 6) {
            const b = this.nextHallBlock()
            if (!b) {
                this.bot.note('hall-done')
                return s.count('cobble') > start
            }
            k.activity = 'mining'
            // at the face, the next block is usually in reach: no walk to plan
            const ok = k.reachable(b, 0.8) ? await k.mine(b) : await k.goMine(b)
            if (!ok) {
                this.markFailed(b.join(','))
                fails++
            } else fails = 0
        }
        return s.count('cobble') > start
    }

    /** the next block to dig: ore in reach first, then the hall's next cell in order */
    nextHallBlock() {
        const s = this.see
        const f = s.feetCell()
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = -1; dy <= 3; dy++) {
                for (let dz = -2; dz <= 2; dz++) {
                    const b = [f[0] + dx, f[1] + dy, f[2] + dz]
                    const id = s.block(...b)
                    if ((id === IRON || id === GOLD) && !this.hasFailed(b.join(','))) return b
                }
            }
        }
        const cells = this.hall.cells
        for (let i = this._hallAt; i < cells.length; i++) {
            const b = cells[i]
            const id = s.block(...b)
            if (passable(id)) {
                if (i === this._hallAt) this._hallAt++
                continue
            }
            // never open the hall into water
            if ([[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([a, c, e]) => s.block(b[0] + a, b[1] + c, b[2] + e) === WATER)) continue
            if (this.hasFailed(b.join(','))) continue
            return b
        }
        return null
    }

    /** the nearest sand at the surface (a beach, a desert), scanned once */
    findSand() {
        if (this._sand !== null) return this._sand
        const s = this.see
        const w = s.g.world
        const me = s.me().pos
        const found = []
        for (let x = -90; x <= 90; x += 2) {
            for (let z = -90; z <= 90; z += 2) {
                if (Math.abs(x) > s.half - 3 || Math.abs(z) > s.half - 3) continue
                const y = w.surfaceY(x, z) - 1
                if (s.block(x, y, z) === SAND && s.block(x, y + 1, z) === 0) found.push([x, y, z])
            }
        }
        found.sort((a, b) => Math.hypot(a[0] - me[0], a[2] - me[2]) - Math.hypot(b[0] - me[0], b[2] - me[2]))
        this._sand = found.length ? found[0] : false
        this.bot.note('sand', { at: this._sand, patches: found.length })
        return this._sand
    }

    /** dig sand around the nearest patch */
    async digSand(n) {
        const s = this.see
        const at = this.findSand()
        if (!at) return false
        this.bot.note('chapter', { title: 'sand for the windows', day: s.day })
        const start = s.count('sand')
        for (let r = 0; r <= 6 && s.count('sand') - start < n; r++) {
            for (let dx = -r; dx <= r && s.count('sand') - start < n; dx++) {
                for (let dz = -r; dz <= r && s.count('sand') - start < n; dz++) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
                    for (let dy = 1; dy >= -2; dy--) {
                        const b = [at[0] + dx, at[1] + dy, at[2] + dz]
                        if (s.block(...b) !== SAND || this.hasFailed(b.join(','))) continue
                        if (!s.canEdit || s.timeToNight < 40) return s.count('sand') > start
                        this.k.activity = 'digging sand'
                        if (!(await this.k.goMine(b))) this.markFailed(b.join(','))
                    }
                }
            }
        }
        return s.count('sand') > start
    }

    /** one tree: its trunk, bottom up */
    async chopTree() {
        const s = this.see
        const me = s.me().pos
        const trees = (this.town.trees || []).filter((b) => this.town.trunk(b).length && !this.hasFailed(b.join(',')))
        trees.sort((a, b) => Math.hypot(a[0] - me[0], a[2] - me[2]) - Math.hypot(b[0] - me[0], b[2] - me[2]))
        const tree = trees[0]
        if (!tree) return false
        this.bot.note('chapter', { title: 'wood for gates and towers', day: s.day })
        const before = s.count('log')
        for (const log of this.town.trunk(tree)) {
            if (!s.canEdit || s.timeToNight < 40) break
            this.k.activity = 'chopping'
            if (!(await this.k.goMine(log))) break
        }
        if (s.count('log') === before) this.markFailed(tree.join(','))
        return s.count('log') > before
    }

    // ---- crafting and building ----------------------------------------------------------

    /** craft what a load needs (five at a time where it can: Shift-click) */
    async craftFor(load) {
        const s = this.see
        const want = { ...(load.extra || {}) }
        for (const c of load.cells) want[c.b] = (want[c.b] || 0) + 1
        if (load.towers.length) {
            this.towerNow = this.towerTier()
            want[this.towerNow] = (want[this.towerNow] || 0) + load.towers.length
        }
        // towers first: the walls would eat the cobble they need
        const todo = Object.entries(want).map(([b, n]) => [b, Math.max(0, n - s.count(b))]).filter(([b, n]) => n > 0 && recipe(b))
            .sort((a, b) => Number(!!BLOCK_BY_NAME[b[0]]?.tower) - Number(!!BLOCK_BY_NAME[a[0]]?.tower))
        if (!todo.length) return
        const inv = s.g.inventory
        // a tower on the ground stands on 2 cobble the game takes from the stock (placing.js)
        const reserve = TOWER_COLUMN * load.towers.filter((t) => t.ground).length
        const prev = this.k.activity
        this.k.activity = 'crafting'
        if (!(await this.k.openBuild())) return
        try {
            await this.bot.wait(0.3)
            for (const [b, n] of todo) {
                const r = recipe(b)
                const i = RECIPES.indexOf(r)
                let made = 0
                while (made < n && inv.canAfford(r.cost)) {
                    // (the towers are crafted first; what follows leaves their columns' cobble)
                    if (!BLOCK_BY_NAME[b]?.tower && r.cost.cobble && s.count('cobble') - r.cost.cobble < reserve) break
                    const el = document.querySelector(`[data-panel="build"] [data-recipe="${i}"]:not(.x5)`)
                    if (!el) break
                    const before = s.count(b)
                    // Shift-click crafts five (or as many as the stock allows), if five leave the reserve
                    const five = n - made >= r.count * 2 && (BLOCK_BY_NAME[b]?.tower || !r.cost.cobble || s.count('cobble') - 5 * r.cost.cobble >= reserve)
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: five }))
                    this.bot.input.counts.hudClicks++
                    await this.bot.wait(0.12)
                    const got = s.count(b) - before
                    if (got <= 0) break
                    made += got
                }
                if (made) this.bot.note('crafted', { item: b, n: made })
            }
            await this.bot.wait(0.2)
        } finally {
            await this.k.closePanel()
            this.k.activity = prev
        }
    }

    /**
     * Build a load from the aerial view: layer by layer (a layer's blocks rest on
     * the one under it), each layer's blocks by material, looking at them from
     * the side they show best; what can't be built from one side is tried from
     * the others.
     * @returns {Promise<number>} blocks built
     */
    async buildLoad(load) {
        const s = this.see
        await this.craftFor(load)
        const items = [...load.cells.map((c) => ({ cell: [c.x, c.y, c.z], b: c.b, part: c.part })),
            ...load.towers.map((t) => ({ cell: [t.x, t.y, t.z], b: this.towerNow || 'arrow_tower', part: t.part, tower: t }))]
            .filter((it) => s.count(it.b) > 0)
        if (!items.length) return 0
        if (!(await this.air.enter())) return 0
        const parts = [...new Set(items.map((it) => it.part))]
        this.bot.note('chapter', { title: `building: ${parts.join(', ')}`, day: s.day, part: parts[0] })
        let built = 0
        // guard towers on the ground first: their columns take cobble the walls would use
        const guards = items.filter((it) => it.tower && it.tower.ground && !this.done(it))
        if (guards.length) built += await this.buildTile(guards)
        // then tiles the view takes in at once, a band of BAND layers each: one camera
        // move per tile, not one per layer (the camera was most of the building time)
        const tiles = new Map()
        for (const it of items) {
            if (this.done(it)) continue
            const band = Math.floor((it.cell[1] - FLOOR) / BAND)
            const key = `${band},${Math.floor(it.cell[0] / TILE)},${Math.floor(it.cell[2] / TILE)}`
            if (!tiles.has(key)) tiles.set(key, { band, list: [] })
            tiles.get(key).list.push(it)
        }
        for (const tile of [...tiles.values()].sort((a, b) => a.band - b.band)) {
            if (!s.canEdit || s.timeToNight < 30) break
            built += await this.buildTile(tile.list)
        }
        this.bot.note('built', { n: built, day: s.day })
        return built
    }

    /** a build item is in place (a guard tower's block sits on its column, 2 up) */
    done(it) {
        const c = it.tower && it.tower.ground ? [it.cell[0], it.cell[1] + 2, it.cell[2]] : it.cell
        return this.see.block(c[0], c[1], c[2]) === blockId(it.b)
    }

    /**
     * One tile: the view over its lowest blocks from the side it looks from now,
     * then the other three sides for what couldn't be built from there. Bottom up,
     * so each block's support is in before it.
     * @returns {Promise<number>} blocks built
     */
    async buildTile(tile) {
        const s = this.see
        let layer = tile
        let built = 0
        const low = Math.min(...layer.map((it) => it.cell[1]))
        const bottom = layer.filter((it) => it.cell[1] === low)
        const cx = bottom.reduce((a, it) => a + it.cell[0], 0) / bottom.length
        const cz = bottom.reduce((a, it) => a + it.cell[2], 0) / bottom.length
        // the camera pans to (and settles at the height of) the block under the middle of the lowest blocks
        const mid = bottom.slice().sort((a, b) => Math.hypot(a.cell[0] - cx, a.cell[2] - cz) - Math.hypot(b.cell[0] - cx, b.cell[2] - cz))[0].cell
        this.k.activity = `building:${layer[0].part}`
        const base = this.air.heading
        for (let side = 0; side < 4 && layer.length; side++) {
            await this.air.lookAt([mid[0] + 0.5, low - 0.5, mid[2] + 0.5], { heading: base + side * (Math.PI / 2), zoom: side === 0 ? ZOOM : null })
            let progress = true
            while (progress && layer.length) {
                progress = false
                // bottom up, and by material within a course: fewer hotbar changes
                layer.sort((a, b) => a.cell[1] - b.cell[1] || (a.b < b.b ? -1 : a.b > b.b ? 1 : 0))
                for (const it of layer) {
                    if (!s.canEdit) break
                    if (s.count(it.b) <= 0) continue
                    if (!(await this.k.select(it.b))) continue
                    // a tower on the ground ends on top of the column the game builds under it
                    const at = it.tower && it.tower.ground ? [it.cell[0], it.cell[1] + 2, it.cell[2]] : it.cell
                    if (await this.air.place(it.cell, it.b, at)) {
                        built++
                        progress = true
                        // a steady builder's pace, not a machine gun
                        await this.bot.wait(0.05)
                    }
                }
                layer = layer.filter((it) => !this.done(it) && s.count(it.b) > 0)
            }
        }
        for (const it of layer) this.markFailed(it.cell.join(','))
        if (layer.length) {
            const c = layer[0].cell
            this.bot.note('unbuilt', { y: c[1], n: layer.length, first: c, b: layer[0].b, why: this.air.why, here: BLOCK_BY_ID[s.block(...c)]?.name || 'air' })
        }
        return built
    }

    // ---- home, dusk, night ----------------------------------------------------------------

    /** into the courtyard (through the gatehouse, or up out of the quarry) */
    async goHome() {
        const s = this.see
        const tc = s.tc
        const inCourt = (x, y, z) => Math.abs(x - tc[0]) <= 9 && Math.abs(z - tc[2]) <= 6 && Math.abs(y - tc[1]) <= 1
        const f = s.feetCell()
        if (inCourt(...f)) return true
        this.k.activity = 'walking'
        this.bot.note('chapter', { title: 'home for the night', day: s.day })
        const ok = await this.k.walkTo(inCourt, [tc[0] + 4, tc[1], tc[2] - 4], { maxNodes: 60000, tries: 3 })
        this.bot.note('home', { ok, from: f })
        return ok
    }

    async dusk() {
        await this.bot.wait(0.5)
        await this.air.leave()
        await this.goHome()
        for (;;) await this.bot.wait(1)
    }

    /** from above, turning slowly round the castle (the builder fights on its own) */
    async night() {
        await this.watch('night')
    }

    async watch(what) {
        const bot = this.bot
        this.k.activity = what === 'night' ? 'night' : what
        await bot.wait(1)
        if (what === 'night' && this.see.me().alive) {
            await this.air.enter()
            const v = this.castle.views.photo
            await this.air.lookAt([v.x, v.y, v.z], { zoom: 58 })
        }
        for (;;) {
            if (what === 'night' && this.air.on) {
                // a slow turn round the castle
                this.bot.input.keyDown('KeyC')
                await bot.wait(0.4)
                this.bot.input.keyUp('KeyC')
                await bot.wait(3)
            } else await bot.wait(1)
        }
    }

    // ---- the end ----------------------------------------------------------------------------

    /**
     * The castle is done: exported at once (a night lost after it can't cost the
     * file), then a turn round it from above and SHOW_NIGHTS nights to show it
     * holds, and the harness stops.
     */
    async finished() {
        const s = this.see
        const bot = this.bot
        if (this.finishedDay === null) {
            this.finishedDay = s.day
            bot.note('chapter', { title: 'the castle is finished', day: s.day })
            bot.note('castle-done', { day: s.day })
        }
        if (!this.exported) {
            await this.beSelf()
            await this.goHome()
            await this.exportWorld()
        }
        if (s.day - this.finishedDay >= SHOW_NIGHTS) {
            bot.done = 'castle exported'
            for (;;) await bot.wait(1)
        }
        // a golden-hour turn round it from above, then the night comes by itself
        await this.air.enter()
        const v = this.castle.views.photo
        await this.air.lookAt([v.x, v.y, v.z], { zoom: 62 })
        this.k.activity = 'flyover'
        bot.note('chapter', { title: 'the finished castle', day: s.day })
        // once round it, then no need to wait out the day: the night comes early
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

    /** P, then Export world: the game downloads the file, the harness keeps it */
    async exportWorld() {
        const bot = this.bot
        bot.expectPanel = 'pause'
        bot.input.tap('KeyP')
        await bot.until(() => this.see.panel === 'pause', 2)
        await bot.wait(0.8)
        bot.input.click(document.querySelector('[data-panel="pause"] [data-a="export"]'))
        bot.note('export', { day: this.see.day })
        this.exported = true
        await bot.wait(2)
        bot.input.click(document.querySelector('[data-panel="pause"] [data-a="resume"]'))
        bot.expectPanel = null
    }
}
