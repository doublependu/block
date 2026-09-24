/*
 *  Skill tests for the lab (--lab=skills:<name>): each runs one skill a few
 *  times from day 1 and logs pass/fail, then stops the run.
 */

import { Town } from './town.js'
import { BLOCK_BY_NAME } from '../../../src/world/blocks.js'

const COBBLE = BLOCK_BY_NAME.cobble.id
const TOWER = BLOCK_BY_NAME.arrow_tower.id
const STONE_WALL = BLOCK_BY_NAME.stone_wall.id
const IRON_WALL = BLOCK_BY_NAME.iron_wall.id

export class SkillTests {
    /** @param {import('./bot.js').Bot} bot @param {string} name */
    constructor(bot, name) {
        this.bot = bot
        this.see = bot.see
        this.k = bot.skills
        this.name = name || 'all'
        this.town = new Town(bot.see)
        this.results = []
    }

    want() {
        if (this.see.phase !== 'day') return null
        return { key: 'tests', run: () => this.run() }
    }

    roleChoice() {
        return 'self'
    }

    check(name, ok, data = {}) {
        this.results.push({ name, ok })
        this.bot.note('test', { name, ok, ...data })
    }

    async run() {
        const bot = this.bot
        await bot.wait(1)
        await bot.until(() => this.see.locked, 3)
        const t = this.name
        try {
            if (t === 'all' || t === 'look') await this.look()
            if (t === 'all' || t === 'walk') await this.walk()
            if (t === 'all' || t === 'mine') await this.mine()
            if (t === 'all' || t === 'wood') await this.wood()
            if (t === 'all' || t === 'stone') await this.stone()
            if (t === 'all' || t === 'craft') await this.craft()
            if (t === 'all' || t === 'tower') await this.tower()
            if (t === 'all' || t === 'walls') await this.walls()
            if (t === 'all' || t === 'upgrade') await this.upgradeTower()
            if (t === 'all' || t === 'sky') await this.sky()
        } finally {
            const pass = this.results.filter((r) => r.ok).length
            bot.note('tests-done', { pass, total: this.results.length, results: this.results })
            bot.done = `tests ${pass}/${this.results.length}`
        }
    }

    async look() {
        const k = this.k
        for (const [h, p] of [[0.5, 0.2], [3, -0.4], [5.5, 0.9], [1, 0]]) {
            const t0 = this.bot.time
            k.lookDir(h, p)
            const ok = await this.bot.until(() => k.lookError() < 0.01, 2)
            this.check('look', ok, { h, p, seconds: +(this.bot.time - t0).toFixed(2) })
        }
    }

    async walk() {
        const tc = this.see.tc
        const targets = [[tc[0] + 6, tc[2] + 4], [tc[0] - 5, tc[2] - 6], [tc[0], tc[2] + 22], [tc[0] + 20, tc[2] - 3], [tc[0] + 2, tc[2] + 2]]
        for (const [x, z] of targets) {
            const t0 = this.bot.time
            const ok = await this.k.walkTo((cx, cy, cz) => Math.abs(cx - x) <= 1 && Math.abs(cz - z) <= 1, [x, tc[1], z])
            const p = this.see.me().pos
            this.check('walk', ok && Math.hypot(p[0] - x - 0.5, p[2] - z - 0.5) < 2, { to: [x, z], at: p.map((v) => +v.toFixed(1)), seconds: +(this.bot.time - t0).toFixed(1) })
        }
    }

    async mine() {
        // dirt next to the town
        const tc = this.see.tc
        const x = tc[0] + 16, z = tc[2] + 16
        const y = this.see.g.world.surfaceY(x, z) - 1
        const t0 = this.bot.time
        const ok = await this.k.goMine([x, y, z])
        this.check('mine', ok, { block: [x, y, z], seconds: +(this.bot.time - t0).toFixed(1) })
    }

    async wood() {
        const trees = this.town.findTrees()
        const me = this.see.me().pos
        trees.sort((a, b) => Math.hypot(a[0] - me[0], a[2] - me[2]) - Math.hypot(b[0] - me[0], b[2] - me[2]))
        const before = this.see.count('log')
        const t0 = this.bot.time
        let n = 0
        for (const tree of trees.slice(0, 2)) {
            for (const log of this.town.trunk(tree)) if (await this.k.goMine(log)) n++
        }
        this.check('wood', this.see.count('log') - before >= 6, { logs: this.see.count('log') - before, mined: n, seconds: +(this.bot.time - t0).toFixed(1) })
    }

    async stone() {
        this.town.pickQuarry()
        const before = this.see.count('cobble')
        const t0 = this.bot.time
        let fails = 0
        while (this.see.count('cobble') - before < 12 && fails < 6 && this.bot.time - t0 < 120) {
            const t = this.town.quarryTargets(this.see.feetCell(), 3)
            if (!t.length || !(await this.k.goMine(t[0].b))) fails++
        }
        this.check('stone', this.see.count('cobble') - before >= 12, { cobble: this.see.count('cobble') - before, fails, seconds: +(this.bot.time - t0).toFixed(1), quarry: this.town.quarry })
    }

    async craft() {
        const inv = this.see.g.inventory
        const t0 = this.bot.time
        const done = await this.k.craft([['stone_sword', 1], ['arrow_tower', 1]])
        this.check('craft', !!done.stone_sword && !!done.arrow_tower, { done, seconds: +(this.bot.time - t0).toFixed(1) })
        const ok = await this.k.toHotbar('arrow_tower', ['cobble'])
        this.check('hotbar', ok, { hotbar: [...inv.hotbar] })
    }

    async tower() {
        const slots = this.town.towerSlots()
        const slot = slots[0]
        const t0 = this.bot.time
        if (!slot) return this.check('tower', false, { reason: 'no slot' })
        if (this.see.count('arrow_tower') < 1) await this.k.craft([['arrow_tower', 1]])
        const { x, y, z } = slot
        // one click on the ground: the game builds the 2-cobble column under the tower
        const ok = await this.k.goPlace([x, y, z], 'arrow_tower')
        const column = [y, y + 1].every((cy) => this.see.block(x, cy, z) === COBBLE) && this.see.block(x, y + 2, z) === TOWER
        this.check('tower', ok && column && this.see.g.towers.count >= 5, { slot, column, towers: this.see.g.towers.count, seconds: +(this.bot.time - t0).toFixed(1) })
    }

    /**
     * A wall built the way a player builds one (prompt 9, issue 1): each block
     * against the one before, a second course on top, an iron block stacked on
     * a stone one with a click, and a stone block upgraded to iron with a hold.
     * The lab hands out the walls (lab.mjs): this tests building, not mining.
     */
    async walls() {
        const see = this.see
        const k = this.k
        const run = this.flatRun(5)
        if (!run) return this.check('walls', false, { reason: 'no flat ground' })
        const { x, y, z } = run
        if (see.count('stone_wall') < 9 || see.count('iron_wall') < 2) return this.check('walls', false, { reason: 'no walls (the lab hands them out)' })
        const t0 = this.bot.time
        // the first on the ground, each next one against the one before it
        let line = await k.goPlace([x, y, z], 'stone_wall')
        for (let i = 1; i < 5 && line; i++) line = await k.goPlace([x + i, y, z], 'stone_wall', { against: [x + i - 1, y, z] })
        const row = [0, 1, 2, 3, 4].every((i) => see.block(x + i, y, z) === STONE_WALL)
        this.check('wall-beside', line && row, { at: [x, y, z], seconds: +(this.bot.time - t0).toFixed(1) })
        // a second course, on top of the first
        let top = true
        for (let i = 1; i < 4 && top; i++) top = await k.goPlace([x + i, y + 1, z], 'stone_wall', { against: [x + i, y, z] })
        this.check('wall-on-top', top && [1, 2, 3].every((i) => see.block(x + i, y + 1, z) === STONE_WALL))
        // iron on stone with a click: it stacks, the stone stays
        const stacked = await k.goPlace([x + 4, y + 1, z], 'iron_wall', { against: [x + 4, y, z] })
        this.check('wall-stack-higher-tier', stacked && see.block(x + 4, y + 1, z) === IRON_WALL && see.block(x + 4, y, z) === STONE_WALL)
        // and a hold replaces it
        const up = await k.goUpgrade([x, y, z], 'iron_wall')
        this.check('wall-upgrade-hold', up && see.block(x, y, z) === IRON_WALL, { seconds: +(this.bot.time - t0).toFixed(1) })
    }

    /** a tower upgraded in place with a click: it keeps its spot and its column, and fires bolts after */
    async upgradeTower() {
        const see = this.see
        const tower = see.g.towers.list.find((t) => t.type === 'arrow')
        if (!tower) return this.check('tower-upgrade', false, { reason: 'no arrow tower' })
        if (see.count('ballista_tower') < 1) return this.check('tower-upgrade', false, { reason: 'no ballista (the lab hands one out)' })
        const cell = [tower.x, tower.y, tower.z]
        const t0 = this.bot.time
        const ok = await this.k.goUpgrade(cell, 'ballista_tower')
        const now = see.g.towers.list.find((t) => t.x === cell[0] && t.y === cell[1] && t.z === cell[2])
        this.check('tower-upgrade', ok && !!now && now.type === 'ballista' && now.spec.projectile === 'bolt', { cell, now: now && now.type, seconds: +(this.bot.time - t0).toFixed(1) })
    }

    /** a click at the sky plays the action at once (prompt 8): the swing or the chop, hit or not */
    async sky() {
        const see = this.see
        const k = this.k
        await k.select('pickaxe')
        k.lookDir(see.cam().heading, -1.2)
        await this.bot.until(() => k.lookError() < 0.02, 2)
        const view = see.g.control.view
        const t0 = performance.now()
        this.bot.input.mouseDown(0)
        const ok = await this.bot.until(() => !!view.action, 0.3)
        const ms = performance.now() - t0
        this.bot.input.mouseUp(0)
        this.check('sky-click', ok && ms < 150, { ms: Math.round(ms), motion: view.action && view.action.name })
    }

    /** n cells in a row along +x, on level natural ground with room above, near the town */
    flatRun(n) {
        const see = this.see
        const w = see.g.world
        const tc = see.tc
        for (const [dx, dz] of [[14, 10], [-18, 10], [14, -14], [-18, -14], [10, 22], [-12, 22]]) {
            const x0 = Math.floor(tc[0] + dx), z = Math.floor(tc[2] + dz)
            const y = w.surfaceY(x0, z)
            let ok = true
            for (let i = 0; i < n && ok; i++) {
                const x = x0 + i
                ok = w.surfaceY(x, z) === y && see.block(x, y, z) === 0 && see.block(x, y + 1, z) === 0 && see.block(x, y + 2, z) === 0
            }
            if (ok) return { x: x0, y, z }
        }
        return null
    }
}
