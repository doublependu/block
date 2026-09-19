/*
 *  Units: defenders (placed by the player), attackers (night waves) and the
 *  player's own builder avatar. Each unit is a noa entity (physics + movement)
 *  with a character model, a simple brain and data-driven combat stats.
 *
 *  Brains: attackers (fighters and wreckers, see SIEGE), defenders (guard a
 *  post), and the builder's autopilot when the player isn't controlling it
 *  during combat.
 */

import { EventEmitter } from 'events'
import {
    UNITS, PLAYER_STATS, PLAYER_SPEED, TOWN_CENTER_HP, TOWERS, DEFENDER_IDLE, SIEGE, SAPPER_CHARGE, ATTACKER_JUMP, HERO, WEAPONS, HIT_FX,
} from './balance.js'
import { AIR, BLOCK_BY_ID, dustColor } from '../world/blocks.js'
import { wanderPath, pathToward } from '../ai/localPath.js'
import { pickStructureTarget, widenTarget, isBarrierTop, isWallBlock } from './siege.js'
import { separate, cellKey, gridKey, CROWD } from './crowd.js'

const THINK_INTERVAL = 0.18
const AGGRO_MELEE = 7
const DEFENDER_LEASH = 11
const CORPSE_SECONDS = 2.4
/** an attacker that hasn't got anywhere (or hit anything) for this long starts again from its front */
const STUCK_RESPAWN_MS = 25000
const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

let unitCounter = 0

export class Unit {
    constructor(def, side) {
        this.uid = ++unitCounter
        /** @type {import('./balance.js').UnitDef} */
        this.def = def
        this.type = def.type
        /** @type {'defender'|'attacker'} */
        this.side = side
        this.maxHp = def.hp
        this.hp = def.hp
        this.alive = true
        this.active = true
        this.entity = -1
        /** @type {import('../characters/library.js').CharacterInstance} */
        this.char = null
        this.yaw = 0
        this.cooldown = Math.random() * 0.5
        this.thinkTimer = Math.random() * THINK_INTERVAL
        /** controlled by the player (the builder in self mode, or a unit played as) */
        this.possessed = false
        this.placementId = null
        this.post = null
        /** current intent from the brain */
        this.moveTo = null
        this.target = null
        this.attackBlock = null
        this.attackTown = false
        this.stuckTime = 0
        this.lastPos = [0, 0, 0]
        this.jumpTimer = 0
        this.deadTime = 0
        this.isPlayer = false
        /** attack front id (attackers spawned by a wave) */
        this.front = null
        /** idle walk for defenders (wander, patrol, back to post): {path, i} */
        this.walk = null
        this.walkWait = 0.5 + Math.random() * 3
        /** speed limit while walking (null = full speed) */
        this.moveSpeed = null
        this.jumpWanted = false
        /** attackers: goes for towers and walls before the town center */
        this.wrecker = false
        /** structure being wrecked [x, y, z, id] */
        this.siegeTarget = null
        /** wall blocks left to knock out next to a breach */
        this.widenLeft = SIEGE.widenMax
        /** a wrecker that broke through a wall: heads for the town now, not along the wall */
        this.breached = false
        /** ignore enemies until this time (ms), after getting stuck chasing one */
        this.ignoreEnemyUntil = 0
        /** sapper: lit powder keg */
        this.charge = null
        this.chargeUsed = false
        /** attackers: last position outside any gate */
        this.safePos = null
        /** opening raid aftermath: stand and cheer */
        this.cheer = false
        /** last position that counted as progress {t, p}, and when it last hurt something (ms) */
        this.progress = null
        this.lastUseful = 0
        /** builder: weapon name (see WEAPONS) and seconds until respawn when knocked out */
        this.weapon = 'none'
        this.respawnIn = 0
        /** bumping into other units (see UnitManager._resolveCrowd): touching units this tick, seconds in a crowd, when last touched (ms) */
        this.contacts = 0
        this.crowdTime = 0
        this.lastCrowded = -Infinity
        /** steering around an ally in the way: {until (ms), turn (radians)} */
        this.avoid = null
    }

    get width() {
        return this.def.width || 0.6
    }

    get height() {
        return this.def.height || 1.75
    }
}

export class UnitManager extends EventEmitter {
    /**
     * @param {object} ctx
     * @param {import('noa-engine').Engine} ctx.noa
     * @param {import('../world/worldState.js').WorldState} ctx.world
     * @param {import('../ai/navClient.js').NavClient} ctx.nav
     * @param {import('../characters/library.js').CharacterLibrary} ctx.chars
     * @param {import('./effects.js').Effects} ctx.effects
     * @param {{maxAnimated: number}} ctx.tier
     */
    constructor({ noa, world, nav, chars, effects, tier }) {
        super()
        this.noa = noa
        /** voxel raycast through solid blocks (see meleeClear) */
        this._pick = (pos, dir, dist) => noa.pick(pos, dir, dist)
        this.world = world
        this.nav = nav
        this.chars = chars
        this.effects = effects
        this.tier = tier
        /** @type {Unit[]} */
        this.units = []
        /** @type {Map<number, Unit>} */
        this.byEntity = new Map()
        /** @type {Unit} */
        this.player = null
        const tc = world.townCenter
        this.town = { hp: TOWN_CENTER_HP, maxHp: TOWN_CENTER_HP, pos: [tc[0] + 0.5, tc[1] + 1.5, tc[2] + 0.5], base: tc }
        /** units are only allowed to fight (and be targeted) while combat is on */
        this.combat = false
        /** day / dusk / night / dawn, set by the session every tick */
        this.phase = 'day'
        /** siege state (opening raid): everyone wrecks walls; the town center can't be hurt yet */
        this.siegeWalls = false
        this.townLocked = false
        /** all attackers go straight for the town center */
        this.pushTown = false
        /** attackers stop and cheer (opening raid aftermath) */
        this.celebrating = false
        /** @type {import('./siege.js').Demolition | null} set by the session */
        this.demolition = null
        this._pois = null
        this._poiTime = 0
        this.getBlock = (x, y, z) => noa.getBlock(x, y, z)
        /** block in a loaded chunk, undefined elsewhere (local paths only use known terrain) */
        this.loadedBlock = (x, y, z) => {
            const w = noa.world
            const [i, j, k] = w._coordsToChunkIndexes(x, y, z)
            const c = w._storage.getChunkByIndexes(i, j, k)
            if (!c) return undefined
            const [a, b, d] = w._coordsToChunkLocals(x, y, z)
            return c.voxels.get(a, b, d)
        }

        /** units by spatial cell, rebuilt every tick (crowd steering) */
        this._grid = new Map()
    }

    // ---- lifecycle --------------------------------------------------------

    /**
     * @param {string} type key of UNITS
     * @param {number[]} pos feet position
     * @param {{placementId?: string, hpMult?: number, yaw?: number}} [opts]
     */
    spawn(type, pos, opts = {}) {
        const def = UNITS[type]
        const u = new Unit(def, def.side)
        u.maxHp = u.hp = Math.round(def.hp * (opts.hpMult || 1))
        u.placementId = opts.placementId || null
        u.post = u.side === 'defender' ? pos.slice() : null
        u.yaw = opts.yaw || 0
        u.wrecker = !!def.wrecker || (type === 'grunt' && Math.random() < SIEGE.wreckerShare)
        u.safePos = pos.slice()
        const ents = this.noa.entities
        const eid = ents.add(pos, u.width, u.height, null, null, true, true)
        ents.addComponent(eid, ents.names.collideTerrain)
        // attackers can't jump walls (not even when a player plays as one)
        const jump = u.side === 'attacker' ? ATTACKER_JUMP : { jumpImpulse: 9, jumpForce: 8 }
        ents.addComponent(eid, ents.names.movement, {
            maxSpeed: def.speed, moveForce: 28, responsiveness: 12, airJumps: 0, ...jump,
        })
        const body = ents.getPhysics(eid).body
        body.autoStep = true
        body.gravityMultiplier = 2
        u.entity = eid
        u.char = this.chars.create(def.model, { height: u.height, width: u.width })
        u.char.setItem(def.item)
        u.char.setTransform(pos[0], pos[1], pos[2], u.yaw)
        u.lastPos = pos.slice()
        this.units.push(u)
        this.byEntity.set(eid, u)
        this.emit('spawned', u)
        return u
    }

    /** wrap noa's player entity as a unit (builder avatar) */
    adoptPlayer(model = 'player') {
        const def = { type: 'player', side: 'defender', model, item: null, attack: 'melee', speed: PLAYER_SPEED, blockDamage: 0, cost: 0, unlockNight: 0, ...PLAYER_STATS }
        const u = new Unit(/** @type {any} */ (def), 'defender')
        u.isPlayer = true
        u.possessed = true
        u.entity = this.noa.playerEntity
        // unit collisions are resolved by the crowd solver, not noa's pairwise pass
        const ents = this.noa.entities
        if (ents.hasComponent(u.entity, ents.names.collideEntities)) ents.removeComponent(u.entity, ents.names.collideEntities)
        u.char = this.chars.create(model)
        this.units.push(u)
        this.byEntity.set(u.entity, u)
        this.player = u
        return u
    }

    /**
     * the builder's weapon sets its attack stats (used by the autopilot and the player)
     * @param {string} name
     * @param {number} [damageMult]
     */
    setPlayerWeapon(name, damageMult = 1) {
        const p = this.player
        if (!p) return
        const w = WEAPONS[name] || WEAPONS.none
        p.weapon = WEAPONS[name] ? name : 'none'
        Object.assign(p.def, { attack: w.attack, damage: w.damage * damageMult, cooldown: w.cooldown, range: w.range })
    }

    remove(u) {
        // anything still aiming at it lets go (targets are checked by `alive`)
        u.alive = false
        const i = this.units.indexOf(u)
        if (i >= 0) this.units.splice(i, 1)
        this.byEntity.delete(u.entity)
        if (!u.isPlayer) {
            if (this.noa.entities.hasComponent(u.entity, 'position')) this.noa.entities.deleteEntity(u.entity)
            u.char.dispose()
        }
        this.emit('removed', u)
    }

    get attackers() {
        return this.units.filter((u) => u.side === 'attacker' && !u.isPlayer)
    }

    get defenders() {
        return this.units.filter((u) => u.side === 'defender' && !u.isPlayer)
    }

    aliveAttackers() {
        let n = 0
        for (const u of this.units) if (u.alive && u.side === 'attacker') n++
        return n
    }

    // ---- damage -------------------------------------------------------------

    /**
     * @param {number} amount
     * @param {any} source the unit (or 'spikes', or a projectile owner) that did it
     * @param {number[]} [from] where the blow came from, for the spray and the push
     * @param {number} [push] how hard it throws the target back (m/s); default from the attacker
     */
    damage(u, amount, source = null, from = null, push = 0) {
        if (!u.alive || !u.active || amount <= 0) return
        if (source instanceof Unit) source.lastUseful = performance.now()
        u.hp -= amount
        const p = this.noa.entities.getPosition(u.entity)
        const at = from || (source instanceof Unit ? this.posOf(source) : null)
        // chips spray away from whatever hit it, and the blow pushes it back a little
        let dx = 0, dz = 0
        if (at) {
            dx = p[0] - at[0]
            dz = p[2] - at[2]
            const d = Math.hypot(dx, dz) || 1
            dx /= d
            dz /= d
        }
        const hitPos = [p[0] + dx * 0.2, p[1] + u.height * 0.6, p[2] + dz * 0.2]
        const color = u.side === 'attacker' ? [0.55, 0.1, 0.1] : [0.8, 0.15, 0.1]
        this.effects.spray(hitPos, color, [dx, 0.45, dz], 8, 3.4, 0.09, 0.4)
        this.effects.burst(hitPos, [1, 0.95, 0.85], 2, 1.6, 0.14, 0.16)
        u.char.flash(HIT_FX.flashSeconds)
        if (at) this._knockback(u, dx, dz, source, push)
        this.emit('hit', u, amount, source)
        if (u.hp <= 0) this.kill(u, source)
        else if (!u.char.busy) u.char.playAction('hit')
    }

    /** a small push away from the blow; it never interrupts what the unit is doing */
    _knockback(u, dx, dz, source, push = 0) {
        const body = this.noa.entities.getPhysics(u.entity)?.body
        if (!body) return
        const def = source instanceof Unit ? source.def : null
        const v = push || (def && (def.splash || (def.mass || 1) >= 2) ? HIT_FX.heavyKnockback : HIT_FX.knockback)
        const m = body.mass || 1
        body.applyImpulse([dx * v * m, 0.12 * v * m, dz * v * m])
    }

    kill(u, source = null) {
        if (!u.alive) return
        u.alive = false
        u.hp = 0
        u.deadTime = 0
        const mv = this.noa.entities.getMovement(u.entity)
        if (mv) {
            mv.running = false
            mv.jumping = false
        }
        u.char.setItem(null)
        u.char.playAction('die')
        this.emit('died', u, source)
        // a sapper cut down with a lit keg goes up with it
        if (u.charge) {
            u.charge = null
            const p = this.posOf(u)
            if (this.demolition) this.demolition.explode([p[0], p[1] + 1, p[2]], SAPPER_CHARGE, u)
        }
    }

    /** @param {boolean} [force] ignore the opening raid's town lock (scripted finale) */
    damageTown(amount, source, force = false) {
        if (this.town.hp <= 0 || (this.townLocked && !force)) return
        if (source instanceof Unit) source.lastUseful = performance.now()
        this.town.hp = Math.max(0, this.town.hp - amount)
        const p = this.town.pos
        this.effects.burst([p[0] + (Math.random() - 0.5) * 3, p[1] + Math.random() * 2, p[2] + (Math.random() - 0.5) * 3], [0.79, 0.7, 0.48], 4, 3, 0.12, 0.6)
        this.emit('townHit', amount, source)
        if (this.town.hp <= 0) this.emit('townDestroyed')
    }

    // ---- queries --------------------------------------------------------------

    posOf(u) {
        return this.noa.entities.getPosition(u.entity)
    }

    /** nearest hostile unit (alive, active) within range */
    nearestEnemy(u, range) {
        const p = this.posOf(u)
        let best = null, bestD = range * range
        for (const o of this.units) {
            if (o === u || !o.alive || !o.active || o.side === u.side) continue
            const q = this.posOf(o)
            const dx = q[0] - p[0], dy = (q[1] - p[1]) * 1.5, dz = q[2] - p[2]
            const d = dx * dx + dy * dy + dz * dz
            if (d < bestD) {
                bestD = d
                best = o
            }
        }
        return best
    }

    /** first unit hit by a ray (slab test against unit AABBs) */
    unitOnRay(origin, dir, maxDist, filter = null) {
        let best = null, bestT = maxDist
        for (const u of this.units) {
            if (!u.alive || !u.active || (filter && !filter(u))) continue
            const p = this.posOf(u)
            const hw = u.width / 2 + 0.1
            const lo = [p[0] - hw, p[1], p[2] - hw], hi = [p[0] + hw, p[1] + u.height, p[2] + hw]
            let t0 = 0, t1 = bestT, ok = true
            for (let a = 0; a < 3 && ok; a++) {
                if (Math.abs(dir[a]) < 1e-8) {
                    if (origin[a] < lo[a] || origin[a] > hi[a]) ok = false
                    continue
                }
                let ta = (lo[a] - origin[a]) / dir[a], tb = (hi[a] - origin[a]) / dir[a]
                if (ta > tb) [ta, tb] = [tb, ta]
                t0 = Math.max(t0, ta)
                t1 = Math.min(t1, tb)
                if (t0 > t1) ok = false
            }
            if (ok && t0 < bestT) {
                bestT = t0
                best = u
            }
        }
        return best ? { unit: best, dist: bestT } : null
    }

    /** true if no solid block between two points */
    lineOfSight(a, b) {
        const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
        const len = Math.hypot(d[0], d[1], d[2])
        if (len < 0.01) return true
        const hit = this.noa.pick(a, [d[0] / len, d[1] / len, d[2] / len], len - 0.3)
        return !hit
    }

    chunkLoaded(x, y, z) {
        const w = this.noa.world
        const [i, j, k] = w._coordsToChunkIndexes(x, y, z)
        const c = w._storage.getChunkByIndexes(i, j, k)
        return !!c
    }

    // ---- simulation -------------------------------------------------------------

    /** @param {number} dt seconds */
    tick(dt) {
        this._resolveCrowd(dt)
        for (let i = this.units.length - 1; i >= 0; i--) {
            const u = this.units[i]
            if (!u.alive) {
                u.deadTime += dt
                if (u.deadTime > CORPSE_SECONDS && !u.isPlayer) this.remove(u)
                continue
            }
            // hold units in place until the terrain under them is loaded
            const body = this.noa.entities.getPhysics(u.entity)?.body
            if (body) {
                const p = this.posOf(u)
                const grounded = this.chunkLoaded(p[0], p[1] - 0.5, p[2])
                body.gravityMultiplier = grounded ? 2 : 0
                if (!grounded && body.velocity[1] < 0) body.velocity[1] = 0
            }
            if (!u.active) continue
            u.cooldown -= dt
            this._contactDamage(u, dt)
            if (u.side === 'attacker') this._gateBarrier(u)
            if (u.charge) this._tickCharge(u, dt)
            if (!u.alive || u.possessed) continue
            if (u.isPlayer && !this.combat) {
                // the builder only acts on its own in a fight
                this._stop(u)
                continue
            }
            if (u.side === 'attacker' && this.celebrating) {
                this._stop(u)
                u.cheer = true
                const tc = this.town.pos, p = this.posOf(u)
                u.yaw = lerpAngle(u.yaw, Math.atan2(tc[0] - p[0], tc[2] - p[2]), Math.min(1, dt * 4))
                continue
            }
            u.thinkTimer -= dt
            if (u.thinkTimer <= 0) {
                u.thinkTimer = THINK_INTERVAL
                if (u.isPlayer) this._thinkHero(u)
                else if (u.side === 'attacker') this._thinkAttacker(u)
                else this._thinkDefender(u)
            }
            this._act(u, dt)
        }
    }

    /**
     * Units bump into each other: overlapping bodies are pushed apart (through
     * their velocity, so terrain and gates still hold them) and stop running
     * into each other. Heavier units, units hitting a structure and the unit
     * you control move less.
     */
    _resolveCrowd(dt) {
        const ents = this.noa.entities
        const bodies = [], list = []
        const grid = this._grid
        grid.clear()
        const now = performance.now()
        for (const u of this.units) {
            u.contacts = 0
            if (!u.alive || !u.active) continue
            const body = ents.getPhysics(u.entity)?.body
            if (!body) continue
            const p = this.posOf(u)
            const key = cellKey(p[0], p[2])
            let cell = grid.get(key)
            if (!cell) grid.set(key, (cell = []))
            cell.push(u)
            // held in place while the terrain loads, or sliding along nav nodes: not physical
            if (body.gravityMultiplier === 0) continue
            const busy = !u.moveTo && !!(u.attackBlock || u.attackTown)
            const mass = (u.def.mass || 1) * (u.possessed ? CROWD.mass.controlled : busy ? CROWD.mass.busy : 1)
            bodies.push({ x: p[0], y: p[1], z: p[2], r: u.width / 2, h: u.height, mass, v: body.velocity, side: u.side === 'attacker' ? 1 : 0 })
            list.push(u)
        }
        if (bodies.length < 2) return
        separate(bodies, { dt })
        const maxVel = CROWD.maxPush / dt
        for (let i = 0; i < list.length; i++) {
            const u = list[i], b = bodies[i]
            u.contacts = b.contacts
            if (!b.contacts) {
                u.crowdTime = Math.max(0, u.crowdTime - dt * 2)
                continue
            }
            u.crowdTime += dt
            u.lastCrowded = now
            // an impulse (not a velocity edit) wakes a resting physics body
            const phys = ents.getPhysics(u.entity).body
            const m = phys.mass || 1
            phys.applyImpulse([clampAbs(b.dx / dt, maxVel) * m, 0, clampAbs(b.dz / dt, maxVel) * m])
        }
    }

    /** units within a radius (horizontal) of a point, from this tick's grid */
    _nearby(p, radius) {
        const out = []
        const c = CROWD.cell
        for (let gx = Math.floor((p[0] - radius) / c); gx <= Math.floor((p[0] + radius) / c); gx++) {
            for (let gz = Math.floor((p[2] - radius) / c); gz <= Math.floor((p[2] + radius) / c); gz++) {
                const cell = this._grid.get(gridKey(gx, gz))
                if (cell) for (const o of cell) out.push(o)
            }
        }
        return out
    }

    /**
     * Walking into an ally that is standing or slower: steer around it for a
     * moment, on the side it's already off to (or a fixed side per unit).
     * @returns {number} heading to use
     */
    _steer(u, p, heading, dist) {
        if (dist < 1.5) return heading
        const now = performance.now()
        if (u.avoid && now < u.avoid.until) return heading + u.avoid.turn
        u.avoid = null
        const fx = Math.sin(heading), fz = Math.cos(heading)
        const own = u.moveSpeed || u.def.speed
        for (const o of this._nearby(p, 2)) {
            if (o === u || o.side !== u.side || !o.alive) continue
            const q = this.posOf(o)
            if (Math.abs(q[1] - p[1]) > 1.2) continue
            const rx = q[0] - p[0], rz = q[2] - p[2]
            const ahead = rx * fx + rz * fz
            if (ahead <= 0 || ahead > 1.2 + o.width / 2) continue
            const lateral = rx * fz - rz * fx
            if (Math.abs(lateral) > (u.width + o.width) / 2) continue
            const ov = this.noa.entities.getPhysics(o.entity)?.body.velocity
            if (ov && ov[0] * fx + ov[2] * fz > own * 0.5) continue
            const side = Math.abs(lateral) > 0.05 ? -Math.sign(lateral) : u.uid % 2 ? 1 : -1
            u.avoid = { until: now + 500, turn: side * CROWD.steerTurn }
            return heading + u.avoid.turn
        }
        return heading
    }

    /** an ally within `radius` is busy hitting a structure or the town center (this unit is queueing behind it) */
    _allyBusyNear(u, p, radius) {
        for (const o of this._nearby(p, radius)) {
            if (o === u || o.side !== u.side || !o.alive) continue
            if (!(o.attackBlock || o.attackTown || o.siegeTarget)) continue
            const q = this.posOf(o)
            if (Math.hypot(q[0] - p[0], q[2] - p[2]) <= radius) return true
        }
        return false
    }

    _stop(u) {
        u.moveTo = null
        u.target = null
        u.attackBlock = null
        u.attackTown = false
        u.walk = null
        const mv = this.noa.entities.getMovement(u.entity)
        if (mv) mv.running = mv.jumping = false
    }

    _contactDamage(u, dt) {
        if (u.side !== 'attacker' || !this.combat) return
        const p = this.posOf(u)
        const b = BLOCK_BY_ID[this.noa.getBlock(Math.floor(p[0]), Math.floor(p[1] + 0.1), Math.floor(p[2]))]
        if (b && b.contactDamage) this.damage(u, b.contactDamage * dt, 'spikes')
    }

    /** gate block overlapping a unit's body at feet position p, or null */
    _gateAt(p, u) {
        const hw = u.width / 2 - 0.02
        const y0 = Math.floor(p[1] + 0.1), y1 = Math.floor(p[1] + u.height - 0.1)
        for (let x = Math.floor(p[0] - hw); x <= Math.floor(p[0] + hw); x++) {
            for (let z = Math.floor(p[2] - hw); z <= Math.floor(p[2] + hw); z++) {
                for (let y = y0; y <= y1; y++) {
                    const id = this.noa.getBlock(x, y, z)
                    if (id !== AIR && BLOCK_BY_ID[id]?.gate) return [x, y, z, id]
                }
            }
        }
        return null
    }

    /**
     * Gates are open to defenders but hold attackers back: an attacker that
     * moved into a gate is put back where it was (keeping the free axis, so it
     * slides along), and an AI attacker starts breaking the gate.
     */
    _gateBarrier(u) {
        const p = this.posOf(u)
        const gate = this._gateAt(p, u)
        const s = u.safePos
        if (!gate) {
            if (s) {
                s[0] = p[0]
                s[1] = p[1]
                s[2] = p[2]
            } else u.safePos = [p[0], p[1], p[2]]
            return
        }
        if (!s || this._gateAt(s, u)) {
            // a gate was built on top of it: let it walk out
            u.safePos = [p[0], p[1], p[2]]
            return
        }
        const body = this.noa.entities.getPhysics(u.entity)?.body
        let fix
        if (!this._gateAt([s[0], p[1], p[2]], u)) {
            fix = [s[0], p[1], p[2]]
            if (body) body.velocity[0] = 0
        } else if (!this._gateAt([p[0], p[1], s[2]], u)) {
            fix = [p[0], p[1], s[2]]
            if (body) body.velocity[2] = 0
        } else {
            fix = [s[0], p[1], s[2]]
            if (body) body.velocity[0] = body.velocity[2] = 0
        }
        this.noa.entities.setPosition(u.entity, fix)
        if (!u.possessed && !u.breaking) u.breaking = { blk: gate, until: performance.now() + 6000 }
    }

    _thinkAttacker(u) {
        const p = this.posOf(u)
        const def = u.def
        const gb = this.getBlock
        u.jumpWanted = false
        u.cheer = false
        if (!this.combat) {
            u.target = null
            u.attackBlock = null
            u.attackTown = false
            u.moveTo = null
            return
        }
        const now = performance.now()
        // hasn't got anywhere or hurt anything for a long time (walled in, shooting at a wall...):
        // start again from the spawn ring
        const pr = u.progress
        if (!pr || Math.hypot(p[0] - pr.p[0], p[1] - pr.p[1], p[2] - pr.p[2]) > 2) {
            u.progress = { t: now, p: [p[0], p[1], p[2]] }
        } else if (now - Math.max(pr.t, u.lastUseful) > STUCK_RESPAWN_MS) {
            if (now - u.lastCrowded < 3000 && this._allyBusyNear(u, p, 6)) {
                // queueing behind allies who are breaking through: that's not stuck
                u.progress = { t: now, p: [p[0], p[1], p[2]] }
            } else {
                u.progress = null
                this.emit('stuck', u)
                return
            }
        }
        u.target = null
        u.attackBlock = null
        u.attackTown = false
        // pushed up onto a wall: break down through it rather than dropping inside
        const fx = Math.floor(p[0]), fy = Math.floor(p[1] + 0.05), fz = Math.floor(p[2])
        if (isBarrierTop(gb, fx, fy, fz)) {
            u.attackBlock = [fx, fy - 1, fz, gb(fx, fy - 1, fz)]
            u.moveTo = null
            return
        }
        // fight nearby defenders / the builder (wreckers only when something is right on them)
        if (now >= u.ignoreEnemyUntil) {
            const aggro = u.wrecker && !this.pushTown ? SIEGE.selfDefence : def.attack === 'melee' ? AGGRO_MELEE : def.range
            const enemy = this.nearestEnemy(u, aggro)
            if (enemy) {
                const q = this.posOf(enemy)
                const inSight = def.attack === 'melee' || this.lineOfSight([p[0], p[1] + 1.5, p[2]], [q[0], q[1] + 1, q[2]])
                if (inSight) {
                    if (def.attack === 'melee' && u.stuckTime > 1.5) {
                        // can't get to it (behind a wall): get back to the attack for a while
                        u.ignoreEnemyUntil = now + 4000
                        u.stuckTime = 0
                    } else {
                        u.target = enemy
                        u.moveTo = def.attack === 'melee' ? [q[0], q[1], q[2]] : null
                        return
                    }
                }
            }
        }
        // keep breaking the block we got stuck on
        if (u.breaking) {
            const [bx, by, bz, bid] = u.breaking.blk
            if (this.noa.getBlock(bx, by, bz) === bid && now < u.breaking.until) {
                u.attackBlock = u.breaking.blk
                u.moveTo = null
                return
            }
            u.breaking = null
        }
        // keep wrecking the current structure while it stands
        if (u.siegeTarget) {
            const [bx, by, bz, bid] = u.siegeTarget
            if (gb(bx, by, bz) === bid && inReach(p, u.siegeTarget)) {
                this._wreck(u, u.siegeTarget)
                return
            }
            u.siegeTarget = null
        }
        // held up in a crowd next to a wall: hit whatever structure is in reach
        if ((u.wrecker || this.siegeWalls) && !this.pushTown && u.crowdTime > 2) {
            const t = pickStructureTarget(gb, p, { walls: true })
            if (t) {
                u.siegeTarget = t.blk
                this._wreck(u, t.blk)
                return
            }
        }
        // near the town center: attack it
        const tc = this.town.pos
        const dTown = Math.hypot(p[0] - tc[0], p[2] - tc[2])
        if (!this.townLocked && dTown < 2.9 && Math.abs(p[1] - this.town.base[1]) < 3) {
            u.attackTown = true
            u.moveTo = null
            return
        }
        const siege = (u.wrecker || this.siegeWalls) && !this.pushTown && !u.breached && this.nav.hasSiege
        const step = this.nav.nextStep(p[0], p[1], p[2], siege ? 'siege' : def.digs ? 'digger' : 'walker')
        if (step && step.atGoal) {
            if (siege) {
                const t = pickStructureTarget(gb, p, { walls: true })
                if (t) {
                    u.siegeTarget = t.blk
                    u.widenLeft = SIEGE.widenMax
                    this._wreck(u, t.blk)
                    return
                }
            }
            if (this.townLocked) {
                // nothing to wreck here and the town center is off limits: wait for the field to catch up
                u.moveTo = null
                return
            }
            u.attackTown = true
            u.moveTo = [tc[0], p[1], tc[2]]
            return
        }
        if (step) {
            const nx = Math.floor(step.x), nz = Math.floor(step.z)
            // blocks in the way of the next step
            const blockers = this.nav.blockersAt(nx, step.y, nz)
            const near = Math.hypot(step.x - p[0], step.z - p[2]) < 1.7
            if (blockers.length && near) {
                u.attackBlock = blockers[0]
                u.moveTo = null
                return
            }
            if (def.digs && step.dy >= 2 && near) {
                // dig a step into the slope
                const candidates = [[nx, step.y - 1, nz], [Math.floor(p[0]), fy + 2, Math.floor(p[2])]]
                for (const c of candidates) {
                    const id = this.noa.getBlock(c[0], c[1], c[2])
                    const b = BLOCK_BY_ID[id]
                    if (id !== AIR && b && isFinite(b.hardness)) {
                        u.attackBlock = [c[0], c[1], c[2], id]
                        u.moveTo = null
                        return
                    }
                }
            }
            u.moveTo = [step.x, step.y, step.z]
            u.jumpWanted = step.dy >= 1
            this._unstick(u, p)
            return
        }
        // no field (yet): head straight for the town center, but never slide through unloaded terrain
        u.moveTo = this.chunkLoaded(p[0], p[1] - 1, p[2]) ? [tc[0], p[1], tc[2]] : null
        this._unstick(u, p)
    }

    /** hit a structure; a sapper lights its keg first */
    _wreck(u, blk) {
        u.moveTo = null
        u.attackBlock = blk
        if (u.def.charge && !u.chargeUsed && this.demolition) {
            u.chargeUsed = true
            u.charge = { left: SAPPER_CHARGE.fuse }
            this.effects.keg(() => {
                if (!u.charge || !u.alive) return null
                const q = this.posOf(u)
                return [q[0], q[1] + u.height + 0.35, q[2]]
            }, SAPPER_CHARGE.fuse)
            this.emit('chargeLit', u)
        }
    }

    _tickCharge(u, dt) {
        u.charge.left -= dt
        if (u.charge.left > 0) return
        u.charge = null
        const p = this.posOf(u)
        // the blast sits between the sapper and what it was hitting
        const t = u.siegeTarget || u.attackBlock
        const at = t ? [(p[0] + t[0] + 0.5) / 2, (p[1] + 1 + t[1] + 0.5) / 2, (p[2] + t[2] + 0.5) / 2] : [p[0], p[1] + 1, p[2]]
        if (this.demolition) this.demolition.explode(at, SAPPER_CHARGE, u)
        this.kill(u)
    }

    /** stuck for a while: break the block in the way (built, soft natural, or anything for diggers) */
    _unstick(u, p) {
        if (u.stuckTime < 1.5 || !u.moveTo) return
        const dx = u.moveTo[0] - p[0], dz = u.moveTo[2] - p[2]
        const len = Math.hypot(dx, dz) || 1
        const fx = Math.floor(p[0] + (dx / len) * 0.9), fz = Math.floor(p[2] + (dz / len) * 0.9)
        const fy = Math.floor(p[1] + 0.05)
        const strong = u.def.digs || u.def.blockDamage >= 2
        for (const [x, y, z] of [[fx, fy, fz], [fx, fy + 1, fz], [fx, fy + 2, fz], [Math.floor(p[0]), fy + 2, Math.floor(p[2])]]) {
            const id = this.noa.getBlock(x, y, z)
            const b = BLOCK_BY_ID[id]
            if (id === AIR || !b || !isFinite(b.hardness) || !(b.solid || b.gate)) continue
            if (b.built || b.hardness <= 0.5 || strong) {
                u.attackBlock = [x, y, z, id]
                u.breaking = { blk: u.attackBlock, until: performance.now() + 8000 }
                u.moveTo = null
                return
            }
        }
    }

    _thinkDefender(u) {
        const p = this.posOf(u)
        const def = u.def
        u.target = null
        u.attackBlock = null
        const post = u.post || p
        const fromPost = Math.hypot(p[0] - post[0], p[2] - post[2])
        if (this.combat) {
            const range = def.attack === 'melee' ? AGGRO_MELEE + 2 : def.range
            const enemy = this.nearestEnemy(u, range)
            if (enemy) {
                const q = this.posOf(enemy)
                const qPost = Math.hypot(q[0] - post[0], q[2] - post[2])
                if (def.attack === 'melee') {
                    if (qPost < DEFENDER_LEASH) {
                        this._engage(u, enemy, [q[0], q[1], q[2]])
                        return
                    }
                } else if (this.lineOfSight([p[0], p[1] + 1.5, p[2]], [q[0], q[1] + 1, q[2]])) {
                    this._engage(u, enemy, null)
                    return
                }
            }
        }
        this._idleDefender(u, p, post, fromPost)
    }

    /**
     * The builder on autopilot: defends the town center with its best weapon.
     * Goes for attackers hitting the town center first, then those wrecking
     * structures, then the nearest; never strays far from the town center.
     */
    _thinkHero(u) {
        const p = this.posOf(u)
        const def = u.def
        const tc = this.town.pos
        u.target = null
        u.attackBlock = null
        u.attackTown = false
        u.moveSpeed = HERO.speed
        const fromTown = Math.hypot(p[0] - tc[0], p[2] - tc[2])
        let best = null, bestScore = Infinity
        if (fromTown < HERO.leash + 2) {
            for (const o of this.units) {
                if (!o.alive || !o.active || o.side !== 'attacker') continue
                const q = this.posOf(o)
                const d = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])
                if (d > HERO.aggro || Math.hypot(q[0] - tc[0], q[2] - tc[2]) > HERO.leash + 4) continue
                const score = d - (o.attackTown ? 20 : o.attackBlock || o.siegeTarget ? 8 : 0)
                if (score < bestScore) {
                    bestScore = score
                    best = o
                }
            }
        }
        if (best) {
            const q = this.posOf(best)
            if (u.walk && !u.walk.chase) u.walk = null
            if (def.attack === 'melee') {
                // can't walk straight at it (a wall in between): take a local path
                if (u.stuckTime > 1.2) {
                    u.walk = null
                    this._walkTo(u, p, q)
                    if (u.walk) u.walk.chase = true
                }
                if (u.walk) {
                    u.target = best
                    u.moveTo = u.walk.path[u.walk.i]
                    return
                }
                this._engage(u, best, [q[0], q[1], q[2]])
                u.moveSpeed = HERO.speed
            } else if (this.lineOfSight([p[0], p[1] + 1.5, p[2]], [q[0], q[1] + 1, q[2]])) {
                this._engage(u, best, null)
            } else {
                u.walk = null
                u.moveTo = [q[0], q[1], q[2]]
            }
            return
        }
        // nothing to fight: back to the plaza next to the town center
        if (u.walk) {
            if (u.stuckTime < 1.5) {
                u.moveTo = u.walk.path[u.walk.i]
                return
            }
            u.walk = null
        }
        u.moveTo = null
        const home = [tc[0], this.town.base[1], tc[2] + 4]
        if (Math.hypot(p[0] - home[0], p[2] - home[2]) > 3) this._walkTo(u, p, home)
    }

    _engage(u, enemy, moveTo) {
        u.walk = null
        u.moveSpeed = null
        u.jumpWanted = false
        u.target = enemy
        u.moveTo = moveTo
        u.walkWait = 1 + Math.random() * 2
    }

    /**
     * No enemy around: wander near the post by day, patrol it at night, and
     * walk back to it at dusk or after a chase.
     */
    _idleDefender(u, p, post, fromPost) {
        const I = DEFENDER_IDLE
        const phase = this.phase
        const night = phase === 'night' || phase === 'dusk'
        u.moveSpeed = u.def.speed * (night ? I.nightWalk : I.dayWalk)
        if (u.walk) {
            // _act advances the waypoints; give up on a blocked walk
            if (u.stuckTime < 1.5) {
                u.moveTo = u.walk.path[u.walk.i]
                return
            }
            u.walk = null
            u.walkWait = 1
        }
        u.moveTo = null
        const radius = phase === 'night' ? I.nightRadius : I.dayRadius
        if (phase === 'dusk') {
            if (fromPost > 0.8) this._walkTo(u, p, post)
            return
        }
        u.walkWait -= THINK_INTERVAL
        if (u.walkWait > 0) return
        const [a, b] = night ? I.nightPause : I.dayPause
        u.walkWait = a + Math.random() * (b - a)
        // strayed (after a chase or a visit): head back first
        if (fromPost > radius + 1.5) return this._walkTo(u, p, post)
        let path = null
        if (!night && Math.random() < I.poiChance) {
            const poi = this._nearbyPoi(post, I.poiRadius)
            if (poi) path = pathToward(this.loadedBlock, p, poi)
        }
        if (!path || !path.length) path = wanderPath(this.loadedBlock, p, post, radius)
        if (path && path.length) u.walk = { path, i: 0 }
    }

    _walkTo(u, p, goal) {
        const path = pathToward(this.loadedBlock, p, goal)
        if (path && path.length) u.walk = { path, i: 0 }
        // terrain not loaded here: straight line, as before
        else if (!path) u.moveTo = [goal[0], goal[1], goal[2]]
    }

    /** a gate, tower or the town center near a post, as a place to visit */
    _nearbyPoi(post, radius) {
        const now = performance.now()
        if (!this._pois || now - this._poiTime > 10000) {
            this._poiTime = now
            const pois = []
            const edits = this.world.edits
            edits.forEach((x, y, z, id) => {
                const b = BLOCK_BY_ID[id]
                // one entry per gate / tower column (its bottom block)
                if (b && (b.gate || b.tower) && edits.get(x, y - 1, z) !== id) pois.push([x + 0.5, y, z + 0.5])
            })
            this._pois = pois
        }
        const list = this._pois.filter((q) => Math.hypot(q[0] - post[0], q[2] - post[2]) <= radius)
        const tc = this.town.base
        if (Math.hypot(tc[0] + 0.5 - post[0], tc[2] + 0.5 - post[2]) <= radius + 3) {
            const side = Math.random() < 0.5 ? -3 : 3
            list.push(Math.random() < 0.5 ? [tc[0] + 0.5 + side, tc[1], tc[2] + 0.5] : [tc[0] + 0.5, tc[1], tc[2] + 0.5 + side])
        }
        return list.length ? list[Math.floor(Math.random() * list.length)] : null
    }

    _act(u, dt) {
        const noa = this.noa
        const p = this.posOf(u)
        const mv = noa.entities.getMovement(u.entity)
        const def = u.def
        let wantYaw = u.yaw
        let moving = false

        // attack whatever the brain chose
        let aimAt = null
        if (u.target && u.target.alive) {
            const q = this.posOf(u.target)
            const d = Math.hypot(q[0] - p[0], q[2] - p[2])
            aimAt = q
            if (d <= def.range + u.target.width / 2 && Math.abs(q[1] - p[1]) < (def.attack === 'melee' ? 1.6 : 30)) {
                u.moveTo = null
                u.walk = null
                // a sword doesn't reach through a wall
                const clear = def.attack !== 'melee' || meleeClear(this._pick, chest(p, u.height), chest(q, u.target.height))
                if (clear && u.cooldown <= 0) this._attackUnit(u, u.target)
                // an attacker standing at a wall with its target on the other side: back to breaking the wall
                // (standing still, it would never count as stuck, and the night would stall)
                else if (!clear && u.side === 'attacker') {
                    u.ignoreEnemyUntil = performance.now() + 4000
                    u.target = null
                }
            }
        } else if (u.attackBlock) {
            const [bx, by, bz] = u.attackBlock
            aimAt = [bx + 0.5, by, bz + 0.5]
            if (u.cooldown <= 0) this._attackBlock(u, u.attackBlock)
        } else if (u.attackTown) {
            aimAt = this.town.pos
            const d = Math.hypot(aimAt[0] - p[0], aimAt[2] - p[2])
            if (d < 3.2 && u.cooldown <= 0) {
                u.cooldown = def.cooldown
                u.char.playAction('attack')
                this.damageTown(def.damage * Math.max(1, def.blockDamage), u)
            }
        }

        // walks: advance through the waypoints
        if (u.walk && (!u.target || u.isPlayer)) {
            const wp = u.walk.path[u.walk.i]
            if (Math.hypot(wp[0] - p[0], wp[2] - p[2]) < 0.35 && Math.abs(wp[1] - p[1]) < 1.2) {
                u.walk.i++
                if (u.walk.i >= u.walk.path.length) u.walk = null
            }
            if (u.walk) u.moveTo = u.walk.path[u.walk.i]
            else if (!u.target) u.moveTo = null
            u.jumpWanted = !!u.moveTo && u.moveTo[1] > p[1] + 0.5
        }

        if (u.moveTo) {
            const dx = u.moveTo[0] - p[0], dz = u.moveTo[2] - p[2]
            const dist = Math.hypot(dx, dz)
            if (dist > 0.25) {
                moving = true
                const heading = Math.atan2(dx, dz)
                if (!this.chunkLoaded(p[0], p[1], p[2]) || !this.chunkLoaded(p[0], p[1] - 1, p[2])) {
                    // terrain not loaded here: move kinematically along the nav nodes
                    const body = noa.entities.getPhysics(u.entity).body
                    body.velocity[0] = body.velocity[1] = body.velocity[2] = 0
                    body.gravityMultiplier = 0
                    const s = Math.min(dist, def.speed * 0.8 * dt)
                    noa.entities.setPosition(u.entity, [p[0] + dx / dist * s, u.moveTo[1], p[2] + dz / dist * s])
                    mv.running = false
                } else {
                    noa.entities.getPhysics(u.entity).body.gravityMultiplier = 2
                    mv.heading = this._steer(u, p, heading, dist)
                    mv.running = true
                    mv.maxSpeed = u.moveSpeed || def.speed
                }
                wantYaw = heading
            }
        }
        if (!moving) mv.running = false
        if (aimAt && !moving) wantYaw = Math.atan2(aimAt[0] - p[0], aimAt[2] - p[2])

        // stuck detection + jumping
        u.jumpTimer -= dt
        const moved = Math.hypot(p[0] - u.lastPos[0], p[2] - u.lastPos[2])
        // held up by other units isn't stuck on terrain: no jumping, no breaking blocks
        const slow = moving && moved < (u.moveSpeed || def.speed) * dt * 0.2
        u.stuckTime = !slow ? 0 : u.contacts ? u.stuckTime : u.stuckTime + dt
        u.lastPos[0] = p[0]
        u.lastPos[1] = p[1]
        u.lastPos[2] = p[2]
        const wantJump = moving && (u.jumpWanted || u.stuckTime > 0.35) && u.jumpTimer <= 0
        mv.jumping = wantJump
        if (wantJump) u.jumpTimer = 0.6

        u.yaw = lerpAngle(u.yaw, wantYaw, Math.min(1, dt * 10))
    }

    _attackUnit(u, target) {
        const def = u.def
        u.cooldown = def.cooldown * (0.9 + Math.random() * 0.2)
        const p = this.posOf(u)
        const q = this.posOf(target)
        if (def.attack === 'melee') {
            u.char.playAction('attack')
            this.damage(target, def.damage, u)
            this.emit('melee', u, target)
        } else {
            u.char.playAction('shoot')
            const from = [p[0], p[1] + u.height * 0.75, p[2]]
            const to = [q[0], q[1] + target.height * 0.55, q[2]]
            this.effects.fire(def.attack, from, to, { damage: def.damage, side: u.side, owner: u, blockDamage: def.blockDamage })
            this.emit('shot', u, def.attack)
        }
    }

    _attackBlock(u, blk) {
        const def = u.def
        u.cooldown = def.cooldown
        u.char.playAction(def.digs ? 'mine' : 'attack')
        const [x, y, z, id] = blk
        if (this.noa.getBlock(x, y, z) !== id) {
            u.attackBlock = null
            return
        }
        const amount = def.damage * Math.max(0.3, def.blockDamage)
        const destroyed = this.world.damageBlock(x, y, z, amount)
        if (isFinite(this.world.maxHp(id))) u.lastUseful = performance.now()
        const b = BLOCK_BY_ID[id]
        this.emit('blockHit', x, y, z, id, destroyed)
        // brutes: the blow cracks the built blocks next to it too
        if (def.splash) {
            for (const [dx, dz] of H4) {
                const nid = this.noa.getBlock(x + dx, y, z + dz)
                if (BLOCK_BY_ID[nid]?.built) this.world.damageBlock(x + dx, y, z + dz, amount * SIEGE.bruteSplash)
            }
        }
        if (b) {
            const dust = dustColor(b.name)
            const q = this.posOf(u)
            this.effects.spray([x + 0.5, y + 0.5, z + 0.5], dust, [q[0] - x - 0.5, 0.5, q[2] - z - 0.5], destroyed ? 12 : 4, 2.6, 0.12, 0.5)
        }
        if (!destroyed) return
        u.attackBlock = null
        // through the wall: the walls on its way are done. Without this it would take the next wall
        // block along the ring, and the next, instead of going in (the opening raid does flatten them all)
        if (u.wrecker && isWallBlock(id) && !this.siegeWalls) u.breached = true
        // wreckers widen the breach: knock out the wall blocks next to the hole
        if (u.wrecker && isWallBlock(id) && u.widenLeft > 0 && (this.siegeWalls || Math.random() < SIEGE.widenChance)) {
            const next = widenTarget(this.getBlock, x, y, z, this.posOf(u))
            if (next) {
                u.siegeTarget = next
                u.widenLeft--
            }
        }
    }

    /**
     * Projectile collision test for Effects.tick
     * @param {import('./effects.js').Projectile} pr
     * @param {number[] | null} pos null when the projectile hit terrain
     */
    projectileHit(pr, pos) {
        if (!pos) {
            if (pr.kind === 'cannonball') this._splash(pr, pr.pos)
            // attacker projectiles chip at built blocks
            if (pr.side === 'attacker' && pr.blockDamage > 0) {
                const x = Math.floor(pr.pos[0]), y = Math.floor(pr.pos[1]), z = Math.floor(pr.pos[2])
                const b = BLOCK_BY_ID[this.noa.getBlock(x, y, z)]
                if (b && b.built) {
                    this.world.damageBlock(x, y, z, pr.damage * pr.blockDamage)
                    if (pr.owner instanceof Unit) pr.owner.lastUseful = performance.now()
                }
            }
            return true
        }
        for (const u of this.units) {
            if (!u.alive || !u.active || u.side === pr.side) continue
            const q = this.posOf(u)
            const hw = u.width / 2 + pr.radius
            if (pos[0] > q[0] - hw && pos[0] < q[0] + hw && pos[2] > q[2] - hw && pos[2] < q[2] + hw &&
                pos[1] > q[1] - pr.radius && pos[1] < q[1] + u.height + pr.radius) {
                if (pr.kind === 'cannonball') this._splash(pr, pos)
                else this.damage(u, pr.damage, pr.owner, [pos[0] - pr.vel[0], pos[1] - pr.vel[1], pos[2] - pr.vel[2]])
                return true
            }
        }
        // attackers' projectiles can hit the town center
        if (pr.side === 'attacker') {
            const tc = this.town.pos
            if (Math.abs(pos[0] - tc[0]) < 1.6 && Math.abs(pos[2] - tc[2]) < 1.6 && pos[1] > this.town.base[1] && pos[1] < this.town.base[1] + 4) {
                this.damageTown(pr.damage, pr.owner)
                return true
            }
        }
        return false
    }

    _splash(pr, pos) {
        const r = TOWERS.cannon.splash
        this.effects.burst(pos, [0.3, 0.3, 0.3], 14, 5, 0.18, 0.6)
        for (const u of this.units) {
            if (!u.alive || u.side === pr.side) continue
            const q = this.posOf(u)
            const d = Math.hypot(q[0] - pos[0], q[1] + 1 - pos[1], q[2] - pos[2])
            if (d < r) this.damage(u, pr.damage * (1 - (d / r) * 0.6), pr.owner, pos, HIT_FX.splashKnockback)
        }
        this.emit('explosion', pos)
    }

    // ---- rendering ----------------------------------------------------------------

    /** @param {number} dtMs */
    render(dtMs) {
        const dt = dtMs / 1000
        const ents = this.noa.entities
        const cam = this.noa.camera.getPosition()
        let animated = 0
        // nearest units animate first when over the tier budget
        const maxAnim = this.tier.maxAnimated
        for (const u of this.units) {
            if (!ents.hasComponent(u.entity, 'position')) continue
            const dat = ents.getPositionData(u.entity)
            const rp = dat._renderPosition
            if (u.possessed && u.alive) {
                // controlled units face where they move, or where the camera looks
                const mv = ents.getMovement(u.entity)
                const want = mv && mv.running ? mv.heading : this.noa.camera.heading
                u.yaw = lerpAngle(u.yaw, want, Math.min(1, dt * 10))
            }
            u.char.setTransform(rp[0], rp[1], rp[2], u.yaw)
            u.char.update(dt)
            if (!u.alive) continue
            const body = ents.getPhysics(u.entity)?.body
            if (!body) continue
            const v = body.velocity
            const speed = Math.hypot(v[0], v[2])
            const d2 = (rp[0] - cam[0]) ** 2 + (rp[2] - cam[2]) ** 2
            const far = d2 > 60 * 60 || (animated >= maxAnim && d2 > 15 * 15)
            if (far) {
                // animation LOD: freeze distant units in their current pose
                u.char.setBase('idle', 0)
            } else {
                animated++
                u.char.locomote(speed, { falling: !body.resting[1] && v[1] < -4, cheer: u.cheer })
            }
        }
    }

    dispose() {
        for (const u of [...this.units]) if (!u.isPlayer) this.remove(u)
    }
}

/** a block is within a wrecker's reach from feet position p */
function inReach(p, blk) {
    const fy = Math.floor(p[1] + 0.05)
    return Math.hypot(blk[0] + 0.5 - p[0], blk[2] + 0.5 - p[2]) <= 2.3 && blk[1] >= fy - 1 && blk[1] <= fy + 3
}

const clampAbs = (v, max) => (v > max ? max : v < -max ? -max : v)

/**
 * pure: a unit whose feet and head are both in solid blocks is stuck inside the
 * terrain (something was placed or fell onto it): the feet level of the first
 * cell above where it fits, or null when it isn't stuck (or nothing fits within `max`).
 * @param {(x: number, y: number, z: number) => boolean} solid
 * @param {number[]} p feet position
 */
export function unstuckY(solid, p, max = 24) {
    const x = Math.floor(p[0]), z = Math.floor(p[2])
    const fy = Math.floor(p[1] + 0.3)
    if (!solid(x, fy, z) || !solid(x, fy + 1, z)) return null
    for (let y = fy + 1; y <= fy + max; y++) {
        if (!solid(x, y, z) && !solid(x, y + 1, z)) return y
    }
    return null
}

/** where a melee blow is aimed from and at: a unit's chest */
export function chest(p, height) {
    return [p[0], p[1] + height * 0.6, p[2]]
}

/**
 * pure: a melee blow can land from `from` to `to`: nothing solid in between.
 * Walls and towers stop a sword; an open gateway (gates aren't solid) doesn't.
 * @param {(pos: number[], dir: number[], dist: number) => any} pick voxel raycast (noa.pick)
 */
export function meleeClear(pick, from, to) {
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    const len = Math.hypot(d[0], d[1], d[2])
    if (len < 0.3) return true
    return !pick(from, [d[0] / len, d[1] / len, d[2] / len], len - 0.2)
}

export function lerpAngle(a, b, t) {
    let d = b - a
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    return a + d * t
}
