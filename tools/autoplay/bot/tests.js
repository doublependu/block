/*
 *  Skill tests for the lab (--lab=skills:<name>): each runs one skill a few
 *  times from day 1 and logs pass/fail, then stops the run.
 */

import { Town } from './town.js'
import { BLOCK_BY_NAME } from '../../../src/world/blocks.js'

const COBBLE = BLOCK_BY_NAME.cobble.id
const TOWER = BLOCK_BY_NAME.arrow_tower.id

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
}
