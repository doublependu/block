/*
 *  Wave director: builds each night's attack and spawns it in sub-waves.
 *
 *  A night is made of streams, one per attacker type from its first night
 *  (WAVE_STREAMS), plus the attackers that answer what the player has built
 *  (WAVE_ADAPTIVE, WAVE_COUNTERS). Each sub-wave comes from one or two "fronts"
 *  (compass directions) on a ring around the town center, so attackers arrive
 *  as a visible group; from WEAK_SIDE.fromNight some aim at the least defended
 *  side. Also runs the opening raid's waves and daytime skirmish scouts.
 */

import { EventEmitter } from 'events'
import {
    UNITS, WAVE_STREAMS, WAVE_ADAPTIVE, WAVE_COUNTERS, WEAK_SIDE, WAVE_SUBWAVES, SUBWAVE_INTERVAL,
    SKIRMISH_INTERVAL, SKIRMISH_GROUP, SPAWN_RADIUS, FRONT_ARC, TWO_FRONTS_FROM_NIGHT, OPENING_RAID,
    blockDefenceValue,
} from './balance.js'
import { blockName, BLOCK_BY_ID } from '../world/blocks.js'

/**
 * @typedef {{arrow: number, cannon: number, troops: number, walls: number, weapon: number, total: number}} DefenceParts
 */

/**
 * pure: what a defence is made of, in defence value (the parts WAVE_COUNTERS
 * answers; troops weighted by WAVE_ADAPTIVE.troops).
 * @param {Iterable<string>} blocks  names of built blocks
 * @param {Iterable<string>} troops  placed defender types
 * @param {number} [weaponValue]     the builder's best weapon
 * @returns {DefenceParts}
 */
export function defenceParts(blocks, troops, weaponValue = 0) {
    const p = { arrow: 0, cannon: 0, troops: 0, walls: 0, weapon: weaponValue, total: 0 }
    for (const name of blocks) {
        const v = blockDefenceValue(name)
        if (!v) continue
        if (name === 'arrow_tower') p.arrow += v
        else if (name === 'cannon_tower') p.cannon += v
        else p.walls += v
    }
    for (const t of troops) p.troops += (UNITS[t]?.cost || 0) * WAVE_ADAPTIVE.troops
    p.total = p.arrow + p.cannon + p.troops + p.walls + p.weapon
    return p
}

/** pure: attackers of a type on a night, from its stream (fractional) */
export function streamCount(type, level) {
    const s = WAVE_STREAMS[type]
    const m = level - (UNITS[type]?.unlockNight ?? Infinity)
    if (!s || m < 0) return 0
    return s.start * Math.pow(s.growth, m) + s.perNight * m
}

/** pure: budget points per defence point above WAVE_ADAPTIVE.free, on a night */
export function adaptiveRate(level) {
    const A = WAVE_ADAPTIVE
    return Math.min(A.max, A.start + A.perNight * Math.max(0, level - 1))
}

/** pure: the extra budget a defence of this value draws on a night */
export function adaptiveBudget(level, defenceValue) {
    return adaptiveRate(level) * Math.max(0, defenceValue - WAVE_ADAPTIVE.free)
}

/** 2.4 → 2 or 3 (3 four times in ten) */
const roll = (x, rnd) => Math.floor(x) + (rnd() < x - Math.floor(x) ? 1 : 0)

/**
 * pure: a night's attackers: every unlocked type's stream, plus the attackers
 * that answer the defence, shuffled so every sub-wave gets a mix.
 * @param {number} level
 * @param {DefenceParts | null} [parts]
 * @param {() => number} [rnd]
 * @returns {{list: string[], counts: Record<string, number>, answer: Record<string, number>, extra: number, answers: string | null}}
 *   `answer`: the attackers sent because of the defence; `answers`: the part of the defence most of them answer
 */
export function planWave(level, parts = null, rnd = Math.random) {
    /** @type {Record<string, number>} */
    const counts = {}
    for (const type of Object.keys(WAVE_STREAMS)) {
        const n = roll(streamCount(type, level), rnd)
        if (n > 0) counts[type] = n
    }
    const extra = parts ? adaptiveBudget(level, parts.total) : 0
    /** @type {Record<string, number>} */
    const answer = {}
    let answers = null
    if (extra > 0) {
        const kinds = Object.keys(WAVE_COUNTERS).filter((k) => parts[k] > 0)
        const sum = kinds.reduce((a, k) => a + parts[k], 0)
        /** @type {Record<string, number>} */
        const want = {}
        for (const k of kinds) {
            for (const [t, share] of Object.entries(WAVE_COUNTERS[k])) {
                const type = UNITS[t].unlockNight <= level ? t : 'grunt'
                want[type] = (want[type] || 0) + (extra * (parts[k] / sum) * share) / UNITS[type].cost
            }
        }
        for (const [t, x] of Object.entries(want)) {
            const n = roll(x, rnd)
            if (n <= 0) continue
            answer[t] = n
            counts[t] = (counts[t] || 0) + n
        }
        answers = kinds.reduce((a, k) => (a === null || parts[k] > parts[a] ? k : a), null)
    }
    const list = []
    for (const [t, n] of Object.entries(counts)) for (let i = 0; i < n; i++) list.push(t)
    for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1))
        ;[list[i], list[j]] = [list[j], list[i]]
    }
    return { list, counts, answer, extra, answers }
}

/**
 * pure: the least defended sides of the town: the compass directions (8)
 * sorted by how much defence value stands on that side, weakest first.
 * @param {{x: number, z: number, value: number}[]} items towers and troops
 * @param {number[]} center town center
 * @returns {number[]} angles
 */
export function weakestSides(items, center) {
    const dirs = []
    for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4
        let v = 0
        for (const it of items) {
            const b = Math.atan2(it.x + 0.5 - center[0], it.z + 0.5 - center[2])
            // full weight on its own side, fading to nothing on the far side
            const w = (1 + Math.cos(b - a)) / 2
            v += it.value * w * w
        }
        dirs.push({ a, v })
    }
    dirs.sort((p, q) => p.v - q.v)
    return dirs.map((d) => d.a)
}

const PLURAL = { grunt: ['grunt', 'grunts'], raider: ['raider', 'raiders'], brute: ['brute', 'brutes'], sapper: ['sapper', 'sappers'] }

/** why the extra attackers came, by the part of the defence they answer, and the type that has to be there */
const WHY = {
    arrow: ['brute', 'Your arrow towers drew brutes: arrows barely hurt them.'],
    cannon: ['sapper', 'Your cannons drew sappers: they go for towers and blow them up.'],
    troops: ['brute', 'Your troops drew brutes and raiders.'],
    walls: ['sapper', 'Your walls drew sappers: they blow up what they reach.'],
    weapon: ['raider', 'Your weapon drew raiders: they shoot from range.'],
}

/**
 * pure: a wave plan in words, for the dusk banner: what's coming, and why the
 * extra attackers came (null when there are none).
 * @param {{counts: Record<string, number>, answer: Record<string, number>, answers: string | null}} plan
 * @returns {{makeup: string, why: string | null}}
 */
export function waveText(plan) {
    const parts = Object.keys(PLURAL).filter((t) => plan.counts[t] > 0).map((t) => `${plan.counts[t]} ${PLURAL[t][plan.counts[t] === 1 ? 0 : 1]}`)
    const makeup = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || 'nothing'
    const extra = Object.values(plan.answer || {}).reduce((a, b) => a + b, 0)
    let why = null
    if (extra > 0 && plan.answers) {
        const [type, text] = WHY[plan.answers]
        if (plan.answer[type] > 0) why = text
        else why = `Your defences drew ${extra} more ${extra === 1 ? 'attacker' : 'attackers'}.`
    }
    return { makeup, why }
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/**
 * pure: compass name of a direction angle. Angles follow the camera heading
 * convention, direction = (sin a, cos a) in (x, z): north is +z, east is +x.
 */
export function compassName(angle) {
    const i = Math.round(angle / (Math.PI / 4))
    return COMPASS[((i % 8) + 8) % 8]
}

/**
 * pure: direction angles for one sub-wave. A new front is kept at least 60°
 * away from the previous one so consecutive groups come from different sides.
 * @param {() => number} rnd
 * @param {number} level
 * @param {number | null} [previous]
 * @returns {number[]}
 */
export function pickFronts(rnd, level, previous = null) {
    let a = rnd() * Math.PI * 2
    if (previous !== null) {
        let d = Math.abs(a - previous) % (Math.PI * 2)
        if (d > Math.PI) d = Math.PI * 2 - d
        if (d < Math.PI / 3) a += Math.PI * (2 / 3)
    }
    a %= Math.PI * 2
    if (level < TWO_FRONTS_FROM_NIGHT) return [a]
    return [a, (a + Math.PI * (0.6 + rnd() * 0.8)) % (Math.PI * 2)]
}

/**
 * pure: a standable spawn point for a front. Picks a spot in the front's arc on
 * the spawn ring and walks inward along the ray until it finds land inside the
 * play area.
 * @param {object} o
 * @param {(x: number, z: number) => number} o.standY  y a unit can stand at (first air above ground), per column
 * @param {(x: number, z: number) => boolean} o.isWater
 * @param {number} o.half     half the world size
 * @param {number[]} o.center town center
 * @param {number} o.angle
 * @param {number[]} [o.radius]
 * @param {number} [o.arc]
 * @param {() => number} [o.rnd]
 * @returns {number[] | null} feet position
 */
export function spawnPoint({ standY, isWater, half, center, angle, radius = SPAWN_RADIUS, arc = FRONT_ARC, rnd = Math.random }) {
    for (let tries = 0; tries < 8; tries++) {
        const a = angle + (rnd() * 2 - 1) * arc
        const sin = Math.sin(a), cos = Math.cos(a)
        for (let r = radius[0] + rnd() * (radius[1] - radius[0]); r >= 12; r -= 2) {
            const x = Math.floor(center[0] + sin * r), z = Math.floor(center[2] + cos * r)
            if (x < -half + 3 || x >= half - 3 || z < -half + 3 || z >= half - 3) continue
            if (isWater(x, z)) continue
            return [x + 0.5, standY(x, z) + 0.05, z + 0.5]
        }
    }
    return null
}

/** @typedef {{id: number, angle: number, name: string}} Front */

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
        // an attacker that got stuck somewhere with no way on starts again from its front
        if (units.on) units.on('stuck', (u) => this._respawnStuck(u))
        /** @type {{type: string, front: number, radius: number[]}[]} */
        this.queue = []
        this.subwaves = []
        /** @type {Front[]} */
        this.fronts = []
        this.running = false
        this.opening = false
        this.hpMult = 1
        this.total = 0
        this.spawned = 0
        this.t = 0
        this.skirmishTimer = this._skirmishDelay()
    }

    _skirmishDelay() {
        const [a, b] = SKIRMISH_INTERVAL
        return a + Math.random() * (b - a)
    }

    /** defence value of the built town and its troops (the builder's weapon comes on top) */
    defenceValue(placements) {
        return this.defenceParts(placements).total
    }

    /**
     * What the defence is made of (see defenceParts).
     * @param {Iterable<{type: string}>} placements
     * @param {number} [weaponValue]
     */
    defenceParts(placements, weaponValue = 0) {
        const names = []
        this.world.edits.forEach((x, y, z, id) => {
            if (BLOCK_BY_ID[id]?.built) names.push(blockName(id))
        })
        return defenceParts(names, [...placements].map((p) => p.type), weaponValue)
    }

    /** a night's plan for the town as it stands (see planWave) */
    plan(level, placements, weaponValue = 0, rnd = Math.random) {
        return planWave(level, this.defenceParts(placements, weaponValue), rnd)
    }

    /** the least defended sides, weakest first (towers and troops by where they stand) */
    weakSides(placements) {
        const items = []
        this.world.edits.forEach((x, y, z, id) => {
            const b = BLOCK_BY_ID[id]
            if (b?.tower) items.push({ x, z, value: blockDefenceValue(b.name) })
        })
        for (const p of placements) items.push({ x: Math.floor(p.pos[0]), z: Math.floor(p.pos[2]), value: UNITS[p.type]?.cost || 0 })
        return weakestSides(items, this.world.townCenter)
    }

    _addFront(angle) {
        const f = { id: this.fronts.length, angle, name: compassName(angle) }
        this.fronts.push(f)
        return f
    }

    _reset() {
        this.fronts = []
        this.subwaves = []
        this.queue = []
        this.spawned = 0
        this.t = 0
        this.running = true
    }

    /**
     * prepare and start a night's attack
     * @param {number} level
     * @param {Iterable<{type: string, pos: number[]}>} placements
     * @param {number} [weaponValue] defence value outside the world (the builder's weapon)
     * @param {ReturnType<typeof planWave> | null} [plan] made at dusk (so the banner's preview is what comes)
     */
    startNight(level, placements, weaponValue = 0, plan = null) {
        const all = [...placements]
        plan = plan || this.plan(level, all, weaponValue)
        let list = plan.list
        // too many bodies for this device: fewer, tougher attackers
        const cap = this.tier.maxAttackers * 2
        this.hpMult = 1
        if (list.length > cap) {
            this.hpMult = list.length / cap
            list = list.slice(0, cap)
        }
        this._reset()
        this.opening = false
        const parts = WAVE_SUBWAVES[Math.min(WAVE_SUBWAVES.length - 1, Math.floor((level - 1) / 3))]
        const per = Math.ceil(list.length / parts)
        const weak = level >= WEAK_SIDE.fromNight ? this.weakSides(all).slice(0, WEAK_SIDE.pick) : []
        let previous = null
        for (let i = 0; i < parts; i++) {
            const angles = pickFronts(Math.random, level, previous)
            // every few sub-waves, the first front goes for a weak side
            if (weak.length && i % WEAK_SIDE.every === 1) angles[0] = weak[Math.floor(Math.random() * weak.length)]
            previous = angles[0]
            const fronts = angles.map((a) => this._addFront(a).id)
            this.subwaves.push({ at: i * SUBWAVE_INTERVAL, list: list.slice(i * per, (i + 1) * per), fronts, radius: SPAWN_RADIUS })
        }
        this.total = list.length
        this.emit('nightStarted', { level, count: list.length, counts: plan.counts, answer: plan.answer, answers: plan.answers, extra: +plan.extra.toFixed(1), hpMult: +this.hpMult.toFixed(2) })
    }

    /**
     * The opening raid: a group from each of the four sides, then
     * reinforcements until the town center falls (see OPENING_RAID).
     * @param {number} angle direction of the first group
     */
    startOpening(angle) {
        const R = OPENING_RAID
        this._reset()
        this.opening = true
        this.round = 0
        this.reinforceTimer = R.reinforceEvery
        this.hpMult = R.hpMult
        R.groups.forEach((at, i) => {
            const front = this._addFront((angle + (i * Math.PI) / 2) % (Math.PI * 2))
            this.subwaves.push({ at, list: R.group.slice(), fronts: [front.id], radius: R.radius })
        })
        this.total = R.groups.length * R.group.length
        this.emit('nightStarted', { level: 0, count: this.total })
    }

    stop() {
        this.running = false
        this.opening = false
        this.subwaves = []
        this.queue = []
        this.fronts = []
    }

    /** all attackers of the night spawned and defeated (never, during the opening raid) */
    get cleared() {
        return this.running && !this.opening && this.subwaves.length === 0 && this.queue.length === 0 && this.units.aliveAttackers() === 0
    }

    get remaining() {
        return this.units.aliveAttackers() + this.queue.length + this.subwaves.reduce((n, s) => n + s.list.length, 0)
    }

    /** seconds until the next sub-wave (null if none) */
    get nextSubwaveIn() {
        return this.subwaves.length ? Math.max(0, this.subwaves[0].at - this.t) : null
    }

    _respawnStuck(u) {
        if (!u.alive || u.possessed) return
        const front = u.front !== null && u.front !== undefined ? this.fronts[u.front] : null
        const pos = this.spawnPointFor(front ? front.angle : Math.random() * Math.PI * 2)
        this.units.noa.entities.setPosition(u.entity, pos)
        u.safePos = pos.slice()
        u.moveTo = u.attackBlock = u.siegeTarget = u.breaking = null
        u.stuckTime = 0
    }

    /** standable spawn point for a front: on land, with a path to the town center */
    spawnPointFor(angle, radius = SPAWN_RADIUS) {
        const w = this.world
        const nav = this.units.nav
        const p = spawnPoint({
            // the nav field knows real standing spots (caves, overhangs, edits); the generator height is a fallback
            standY: (x, z) => {
                const y = nav ? nav.pathNodeY(x, z) : undefined
                return y === undefined || y === null ? this.standY(x, z) : y
            },
            isWater: (x, z) => w.surfaceY(x, z) <= 1 || (nav ? nav.pathNodeY(x, z) === null : false),
            half: w.half,
            center: w.townCenter,
            angle,
            radius,
        })
        if (p) return p
        // all water that way: straight line from the town center
        const r = radius[0]
        const x = Math.floor(w.townCenter[0] + Math.sin(angle) * r * 0.5), z = Math.floor(w.townCenter[2] + Math.cos(angle) * r * 0.5)
        return [x + 0.5, this.standY(x, z) + 0.05, z + 0.5]
    }

    /** first free cell above the terrain surface, including built blocks */
    standY(x, z) {
        const w = this.world
        let y = w.surfaceY(x, z)
        for (let i = 0; i < 16; i++) {
            const b = BLOCK_BY_ID[w.getBlock(x, y, z)]
            const above = BLOCK_BY_ID[w.getBlock(x, y + 1, z)]
            if (!(b && b.solid) && !(above && above.solid)) break
            y++
        }
        return y
    }

    /** @param {number} dt seconds */
    tick(dt, { day, skirmish }) {
        if (this.running) {
            this.t += dt
            while (this.subwaves.length && this.subwaves[0].at <= this.t) {
                const sw = this.subwaves.shift()
                // split the group over its fronts
                sw.list.forEach((type, i) => this.queue.push({ type, front: sw.fronts[i % sw.fronts.length], radius: sw.radius }))
                this.emit('subwave', sw.list.length, sw.fronts.map((id) => this.fronts[id]))
            }
            if (this.opening) this._reinforce(dt)
            // spawn a few per tick while under the concurrency cap
            let n = 0
            while (this.queue.length && this.units.aliveAttackers() < this.tier.maxAttackers && n++ < 2) {
                const q = this.queue.shift()
                const front = this.fronts[q.front]
                const u = this.units.spawn(q.type, this.spawnPointFor(front.angle, q.radius), { hpMult: this.hpMult })
                u.front = front.id
                this.spawned++
            }
        } else if (day && skirmish) {
            this.skirmishTimer -= dt
            if (this.skirmishTimer <= 0) {
                this.skirmishTimer = this._skirmishDelay()
                const [a, b] = SKIRMISH_GROUP
                const count = a + Math.floor(Math.random() * (b - a + 1))
                const angle = Math.random() * Math.PI * 2
                for (let i = 0; i < count; i++) this.units.spawn('grunt', this.spawnPointFor(angle))
                this.emit('skirmish', count, compassName(angle))
            }
        }
    }

    /** opening raid: keep the pressure on until the town center falls */
    _reinforce(dt) {
        if (this.subwaves.length || this.queue.length) return
        const R = OPENING_RAID
        this.reinforceTimer -= dt
        if (this.units.aliveAttackers() >= R.reinforceBelow && this.reinforceTimer > 0) return
        this.reinforceTimer = R.reinforceEvery
        this.round++
        const list = R.reinforcement.slice()
        for (let i = 0; i < this.round * R.extraBrutesPerRound; i++) list.push('brute')
        const front = this._frontWithMostStanding()
        this.subwaves.push({ at: this.t, list, fronts: [front.id], radius: R.radius })
        this.total += list.length
    }

    /** the front facing the most built blocks still standing */
    _frontWithMostStanding() {
        const w = this.world
        const tc = w.townCenter
        const counts = this.fronts.map(() => 0)
        w.edits.forEach((x, y, z, id) => {
            if (!BLOCK_BY_ID[id]?.built || w.damage.has(x, y, z)) return
            const a = Math.atan2(x + 0.5 - tc[0], z + 0.5 - tc[2])
            let bi = 0, bd = Infinity
            this.fronts.forEach((f, i) => {
                let d = Math.abs(a - f.angle) % (Math.PI * 2)
                if (d > Math.PI) d = Math.PI * 2 - d
                if (d < bd) {
                    bd = d
                    bi = i
                }
            })
            counts[bi]++
        })
        let best = 0
        counts.forEach((n, i) => {
            if (n > counts[best]) best = i
        })
        return this.fronts[best]
    }

    /**
     * Where each front's living attackers are (for off-screen markers).
     * @returns {{front: Front, pos: number[], count: number}[]}
     */
    frontGroups() {
        const acc = new Map()
        for (const u of this.units.units) {
            if (!u.alive || u.side !== 'attacker' || u.front === undefined || u.front === null) continue
            const f = this.fronts[u.front]
            if (!f) continue
            const p = this.units.posOf(u)
            let g = acc.get(f.id)
            if (!g) acc.set(f.id, (g = { front: f, pos: [0, 0, 0], count: 0 }))
            g.pos[0] += p[0]
            g.pos[1] += p[1]
            g.pos[2] += p[2]
            g.count++
        }
        const out = [...acc.values()]
        for (const g of out) for (let i = 0; i < 3; i++) g.pos[i] /= g.count
        return out
    }
}
