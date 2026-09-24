/*
 *  The opening raid: a scripted attack that starts every fresh survival game.
 *  It overwhelms the starting town on purpose and leaves it in ruins, so the
 *  first thing a player learns is what the attackers want (the town center)
 *  and that the defences they start with aren't enough.
 *
 *  Script (numbers in OPENING_RAID):
 *    1. groups from all four sides; everyone wrecks towers and walls, and the
 *       town center can't be hurt yet
 *    2. once the towers are gone and the walls are mostly down, the lock lifts
 *       and everyone goes for the town center
 *    3. if the town still stands at `finaleAt`, a scripted finale blows up what's
 *       left (towers, walls, then the town center)
 *    4. the town center falls: the raiders cheer while the camera circles the
 *       ruins, then dawn rebuilds the town slowly
 */

import { OPENING_RAID, SAPPER_CHARGE } from './balance.js'
import { isWallBlock } from './siege.js'

/**
 * pure: whether a game should start with the opening raid.
 * @param {{mode: string, day: number, nightLevel: number}} def
 * @param {{resumed?: boolean, search?: string}} [o] resumed = loaded from the autosave (Continue)
 */
export function shouldPlayOpening(def, { resumed = false, search = '' } = {}) {
    if (new URLSearchParams(search).get('intro') === '0') return false
    return !resumed && def.mode === 'survival' && def.day === 1 && def.nightLevel === 1
}

/** pure: the four gate directions (the default town has a gate on each side) */
export function openingFront(rnd = Math.random) {
    return Math.floor(rnd() * 4) * (Math.PI / 2)
}

/**
 * pure: the town center opens up for attack once no tower stands and the
 * walls are down to OPENING_RAID.unlockWallsLeft of what they were.
 * @param {{towers: number, walls: number, wallStart: number}} s
 */
export function lockReleased({ towers, walls, wallStart }) {
    return towers === 0 && (wallStart === 0 || walls / wallStart <= OPENING_RAID.unlockWallsLeft)
}

/**
 * pure: what the finale destroys next: towers, then walls, then the town center.
 * @param {{towers: number, walls: number, wallStart: number, townHp: number}} s
 * @returns {'tower'|'walls'|'town'|null}
 */
export function finaleStep({ towers, walls, wallStart, townHp }) {
    if (towers > 0) return 'tower'
    if (wallStart > 0 && walls / wallStart > OPENING_RAID.finaleWallsLeft) return 'walls'
    if (townHp > 0) return 'town'
    return null
}

/** count standing wall blocks (built barriers that aren't destroyed tonight) */
export function standingWalls(world) {
    let n = 0
    world.edits.forEach((x, y, z, id) => {
        if (isWallBlock(id) && !world.damage.has(x, y, z)) n++
    })
    return n
}

export const OPENING_TEXT = {
    start: 'Raiders are attacking your town from every side — defend it!',
    hint: 'Your builder fights on its own. Press M or tap View to fight as yourself, or click a defender to play as it.',
    unlocked: 'The defences are down — they\'re going for the Town Center!',
    finale: 'The raiders light their powder kegs!',
    lostTitle: 'The raiders destroyed your town',
    lostText: 'Your town wasn\'t ready. The raiders will come back every night, a little stronger each time. ' +
        'Use the day to mine, craft walls, towers, troops and weapons (B), and place them around the Town Center.',
    day: 'Day 1: rebuild and strengthen your defences. The first night comes when the timer runs out, or press N / Start night.',
}

const FINALE_BLAST = { radius: 2.2, unitDamage: 0, unitRadius: 0, townDamage: 0, townRadius: 0 }

export class OpeningRaid {
    /** @param {any} s session */
    constructor(s) {
        this.s = s
        this.angle = openingFront()
        this.t = 0
        this.skipped = false
        this.locked = true
        this.finale = false
        this.finaleTimer = 0
        this.aftermath = -1
        this.wallStart = 0
        this.walls = 0
        this._countTimer = 0
        /** how the raid ended, for balance runs */
        this.stats = { unlockedAt: null, finaleAt: null, townFellAt: null }
    }

    /** the raid's night has started */
    start() {
        const s = this.s
        this.wallStart = this.walls = standingWalls(s.world)
        s.units.siegeWalls = true
        s.units.townLocked = true
        s.units.pushTown = false
        s.nav.setSiegeWalls(true)
        s.waves.startOpening(this.angle)
        s.demolition.active = true
    }

    get towers() {
        return this.s.towers.activeCount
    }

    /** @param {number} dt seconds */
    tick(dt) {
        const s = this.s
        this.t += dt
        this._countTimer -= dt
        if (this._countTimer <= 0) {
            this._countTimer = 0.5
            this.walls = standingWalls(s.world)
        }
        if (this.aftermath >= 0) {
            this.aftermath += dt
            if (this.aftermath >= OPENING_RAID.aftermath && s.cycle.phase === 'night') s.cycle.endNight('lost')
            return
        }
        const state = { towers: this.towers, walls: this.walls, wallStart: this.wallStart, townHp: s.units.town.hp }
        if (this.locked && lockReleased(state)) this.unlock()
        if (!this.finale && this.t >= OPENING_RAID.finaleAt) {
            this.finale = true
            this.stats.finaleAt = Math.round(this.t)
            s.hud.banner(OPENING_TEXT.finale, { kind: 'warn', seconds: 6 })
        }
        if (this.finale) {
            this.finaleTimer -= dt
            if (this.finaleTimer <= 0) this._finaleStep(state)
        }
    }

    unlock() {
        const s = this.s
        this.locked = false
        this.stats.unlockedAt = Math.round(this.t)
        s.units.townLocked = false
        s.units.siegeWalls = false
        s.units.pushTown = true
        s.nav.setSiegeWalls(false)
        s.audio.horn()
        s.hud.banner(OPENING_TEXT.unlocked, { kind: 'warn', seconds: 6 })
    }

    _finaleStep(state) {
        const s = this.s
        const step = finaleStep(state)
        if (step === 'tower') {
            const t = s.towers.list.find((x) => x.active)
            s.demolition.explode([t.x + 0.5, t.y + 0.5, t.z + 0.5], FINALE_BLAST)
            s.demolition.add(t.x, t.y, t.z)
            this.finaleTimer = 0.8
        } else if (step === 'walls') {
            this._collapseStretch()
            this.walls = standingWalls(s.world)
            this.finaleTimer = 0.45
        } else if (step === 'town') {
            if (this.locked) this.unlock()
            const town = s.units.town
            s.units.damageTown(town.maxHp * 0.2, null, true)
            const p = town.pos
            s.effects.burst(p, [1, 0.62, 0.18], 18, 6, 0.2, 0.6)
            s.audio.play('explosion', p)
            s.control.shake(0.6)
            this.finaleTimer = 1
        }
    }

    /** knock down a stretch of wall: a standing wall block and the wall blocks connected to it */
    _collapseStretch() {
        const s = this.s
        const w = s.world
        const standing = []
        w.edits.forEach((x, y, z, id) => {
            if (isWallBlock(id) && !w.damage.has(x, y, z)) standing.push([x, y, z])
        })
        if (!standing.length) return
        const start = standing[Math.floor(Math.random() * standing.length)]
        const seen = new Set([start.join(',')])
        const queue = [start]
        for (let i = 0; i < queue.length && queue.length < 14; i++) {
            const [x, y, z] = queue[i]
            for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
                const k = `${x + dx},${y + dy},${z + dz}`
                if (seen.has(k)) continue
                seen.add(k)
                const id = w.edits.get(x + dx, y + dy, z + dz)
                if (id !== undefined && isWallBlock(id) && !w.damage.has(x + dx, y + dy, z + dz)) queue.push([x + dx, y + dy, z + dz])
            }
        }
        for (const [x, y, z] of queue) s.demolition.add(x, y, z)
        const [x, y, z] = queue[Math.floor(queue.length / 2)]
        s.effects.burst([x + 0.5, y + 1, z + 0.5], [0.4, 0.37, 0.34], 20, 4, 0.28, 1)
        s.effects.smoke([x + 0.5, y + 1, z + 0.5], 2, 0.3)
        s.audio.play('explosion', [x + 0.5, y + 1, z + 0.5])
    }

    /** the town center fell: the raiders celebrate over the ruins, then dawn */
    onTownDestroyed() {
        if (this.aftermath >= 0) return
        const s = this.s
        this.aftermath = 0
        this.stats.townFellAt = Math.round(this.t)
        s.units.celebrating = true
        s.hud.hideBanner()
        const p = s.units.town.pos
        s.demolition.explode(p, { ...SAPPER_CHARGE, radius: 0, townDamage: 0, unitDamage: 0 })
        s.effects.smoke(p, OPENING_RAID.aftermath + 4, 0.8)
        // smoke over a few of the worst breaches
        const holes = []
        s.world.damage.forEach((x, y, z) => {
            if (holes.length < 60) holes.push([x + 0.5, y + 0.5, z + 0.5])
        })
        for (let i = 0; i < Math.min(5, holes.length); i++) s.effects.smoke(holes[Math.floor(Math.random() * holes.length)], OPENING_RAID.aftermath + 2, 0.25)
        s.control.orbitTown(OPENING_RAID.aftermath)
    }

    /** dawn: back to normal rules */
    end() {
        const s = this.s
        s.units.siegeWalls = false
        s.units.townLocked = false
        s.units.pushTown = false
        s.units.celebrating = false
        s.nav.setSiegeWalls(false)
    }
}
