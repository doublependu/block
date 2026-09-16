/*
 *  Wave director: builds each night's attack from a budget that grows with
 *  the night level and (a little) with the player's defences, then spawns it
 *  in sub-waves at the island edge. Also runs daytime skirmish scouts.
 */

import { EventEmitter } from 'events'
import {
    UNITS, WAVE_BASE_BUDGET, WAVE_GROWTH, WAVE_ADAPTIVE, WAVE_SUBWAVES, SUBWAVE_INTERVAL,
    SKIRMISH_INTERVAL, SKIRMISH_GROUP, blockDefenceValue,
} from './balance.js'
import { blockName, BLOCK_BY_ID } from '../world/blocks.js'

/** pure: attack budget for a night */
export function waveBudget(level, defenceValue = 0) {
    return WAVE_BASE_BUDGET * Math.pow(WAVE_GROWTH, Math.max(0, level - 1)) + WAVE_ADAPTIVE * defenceValue
}

/**
 * pure: pick attacker types for a budget.
 * @param {number} level
 * @param {number} budget
 * @param {() => number} rnd
 * @returns {string[]}
 */
export function composeWave(level, budget, rnd = Math.random) {
    const types = Object.values(UNITS).filter((u) => u.side === 'attacker' && u.unlockNight <= level)
    const list = []
    let left = budget
    let guard = 0
    while (left >= 1 && guard++ < 1000) {
        const affordable = types.filter((t) => t.cost <= left)
        if (!affordable.length) break
        // cheaper units are more common; stronger ones get likelier on later nights
        const weights = affordable.map((t) => 1 / t.cost + (t.cost > 1 ? level * 0.02 : 0))
        let r = rnd() * weights.reduce((a, b) => a + b, 0)
        let pick = affordable[0]
        for (let i = 0; i < affordable.length; i++) {
            r -= weights[i]
            if (r <= 0) {
                pick = affordable[i]
                break
            }
        }
        list.push(pick.type)
        left -= pick.cost
    }
    return list
}

export class WaveDirector extends EventEmitter {
    /**
     * @param {object} ctx
     * @param {import('../world/worldState.js').WorldState} ctx.world
     * @param {import('./units.js').UnitManager} ctx.units
     * @param {{maxAttackers: number}} ctx.tier
     */
    constructor({ world, units, tier }) {
        super()
        this.world = world
        this.units = units
        this.tier = tier
        this.queue = []
        this.subwaves = []
        this.running = false
        this.hpMult = 1
        this.total = 0
        this.skirmishTimer = this._skirmishDelay()
    }

    _skirmishDelay() {
        const [a, b] = SKIRMISH_INTERVAL
        return a + Math.random() * (b - a)
    }

    defenceValue(placements) {
        let v = 0
        this.world.edits.forEach((x, y, z, id) => {
            if (BLOCK_BY_ID[id]?.built) v += blockDefenceValue(blockName(id))
        })
        for (const p of placements) v += UNITS[p.type]?.cost || 0
        return v
    }

    /** prepare and start a night's attack */
    startNight(level, placements) {
        const budget = waveBudget(level, this.defenceValue(placements))
        let list = composeWave(level, budget)
        // too many bodies for this device: fewer, tougher attackers
        const cap = this.tier.maxAttackers * 2
        this.hpMult = 1
        if (list.length > cap) {
            this.hpMult = list.length / cap
            list = list.slice(0, cap)
        }
        const parts = WAVE_SUBWAVES[Math.min(WAVE_SUBWAVES.length - 1, Math.floor((level - 1) / 3))]
        this.subwaves = []
        const per = Math.ceil(list.length / parts)
        for (let i = 0; i < parts; i++) this.subwaves.push({ at: i * SUBWAVE_INTERVAL, list: list.slice(i * per, (i + 1) * per) })
        this.total = list.length
        this.spawned = 0
        this.t = 0
        this.running = true
        this.emit('nightStarted', { level, budget, count: list.length })
    }

    stop() {
        this.running = false
        this.subwaves = []
        this.queue = []
    }

    /** all attackers of the night spawned and defeated */
    get cleared() {
        return this.running && this.subwaves.length === 0 && this.queue.length === 0 && this.units.aliveAttackers() === 0
    }

    get remaining() {
        return this.units.aliveAttackers() + this.queue.length + this.subwaves.reduce((n, s) => n + s.list.length, 0)
    }

    /** a random standable spawn point near the island edge */
    spawnPoint() {
        const half = this.world.half
        for (let tries = 0; tries < 30; tries++) {
            const side = Math.floor(Math.random() * 4)
            const along = (Math.random() * 2 - 1) * (half - 12)
            const inset = half - 10 - Math.random() * 10
            const x = side < 2 ? (side === 0 ? inset : -inset) : along
            const z = side < 2 ? along : (side === 2 ? inset : -inset)
            const sy = this.world.surfaceY(Math.floor(x), Math.floor(z))
            if (sy <= 1.5) continue // water
            return [Math.floor(x) + 0.5, sy + 0.2, Math.floor(z) + 0.5]
        }
        return [0.5, this.world.surfaceY(0, half - 20) + 1, half - 20 + 0.5]
    }

    /** @param {number} dt seconds */
    tick(dt, { day, skirmish }) {
        if (this.running) {
            this.t += dt
            while (this.subwaves.length && this.subwaves[0].at <= this.t) {
                const sw = this.subwaves.shift()
                this.queue.push(...sw.list)
                this.emit('subwave', sw.list.length)
            }
            // spawn a few per tick while under the concurrency cap
            let n = 0
            while (this.queue.length && this.units.aliveAttackers() < this.tier.maxAttackers && n++ < 2) {
                const type = this.queue.shift()
                this.units.spawn(type, this.spawnPoint(), { hpMult: this.hpMult })
                this.spawned++
            }
        } else if (day && skirmish) {
            this.skirmishTimer -= dt
            if (this.skirmishTimer <= 0) {
                this.skirmishTimer = this._skirmishDelay()
                const [a, b] = SKIRMISH_GROUP
                const count = a + Math.floor(Math.random() * (b - a + 1))
                const p = this.spawnPoint()
                for (let i = 0; i < count; i++) this.units.spawn('grunt', [p[0] + i * 0.8, p[1], p[2]])
                this.emit('skirmish', count)
            }
        }
    }
}
