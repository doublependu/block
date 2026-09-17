/*
 *  Units: defenders (placed by the player), attackers (night waves) and the
 *  player's own builder avatar. Each unit is a noa entity (physics + movement)
 *  with a character model, a simple brain and data-driven combat stats.
 */

import { EventEmitter } from 'events'
import { UNITS, PLAYER_STATS, TOWN_CENTER_HP, TOWERS, DEFENDER_IDLE } from './balance.js'
import { AIR, BLOCK_BY_ID } from '../world/blocks.js'
import { wanderPath, pathToward } from '../ai/localPath.js'

const THINK_INTERVAL = 0.18
const AGGRO_MELEE = 7
const DEFENDER_LEASH = 11
const CORPSE_SECONDS = 2.4

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
        this.world = world
        this.nav = nav
        this.chars = chars
        this.effects = effects
        this.tier = tier
        /** @type {Unit[]} */
        this.units = []
        /** @type {Map<number, Unit>} */
        this.byEntity = new Map()
        const tc = world.townCenter
        this.town = { hp: TOWN_CENTER_HP, maxHp: TOWN_CENTER_HP, pos: [tc[0] + 0.5, tc[1] + 1.5, tc[2] + 0.5], base: tc }
        /** units are only allowed to fight (and be targeted) while combat is on */
        this.combat = false
        /** day / dusk / night / dawn, set by the session every tick */
        this.phase = 'day'
        this._pois = null
        this._poiTime = 0
        /** block in a loaded chunk, undefined elsewhere (local paths only use known terrain) */
        this.loadedBlock = (x, y, z) => {
            const w = noa.world
            const [i, j, k] = w._coordsToChunkIndexes(x, y, z)
            const c = w._storage.getChunkByIndexes(i, j, k)
            if (!c) return undefined
            const [a, b, d] = w._coordsToChunkLocals(x, y, z)
            return c.voxels.get(a, b, d)
        }

        // soft separation between overlapping units
        noa.entities.onPairwiseEntityCollision = (a, b) => {
            const ua = this.byEntity.get(a), ub = this.byEntity.get(b)
            if (!ua || !ub || !ua.alive || !ub.alive) return
            const pa = noa.entities.getPosition(a), pb = noa.entities.getPosition(b)
            let dx = pa[0] - pb[0], dz = pa[2] - pb[2]
            const d = Math.hypot(dx, dz) || 0.01
            dx /= d
            dz /= d
            const push = 2.5
            if (!ua.isPlayer) this._impulse(ua, dx * push, dz * push)
            if (!ub.isPlayer) this._impulse(ub, -dx * push, -dz * push)
        }
    }

    _impulse(u, x, z) {
        const phys = this.noa.entities.getPhysics(u.entity)
        if (phys) phys.body.applyImpulse([x * 0.05, 0, z * 0.05])
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
        const ents = this.noa.entities
        const eid = ents.add(pos, u.width, u.height, null, null, true, true)
        ents.addComponent(eid, ents.names.collideTerrain)
        ents.addComponent(eid, ents.names.collideEntities, { cylinder: true })
        ents.addComponent(eid, ents.names.movement, {
            maxSpeed: def.speed, moveForce: 28, responsiveness: 12, airJumps: 0, jumpImpulse: 9, jumpForce: 8,
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
        const def = { type: 'player', side: 'defender', model, item: null, attack: 'melee', speed: 10, blockDamage: 0, cost: 0, unlockNight: 0, ...PLAYER_STATS }
        const u = new Unit(def, 'defender')
        u.isPlayer = true
        u.possessed = true
        u.entity = this.noa.playerEntity
        u.char = this.chars.create(model)
        this.units.push(u)
        this.byEntity.set(u.entity, u)
        this.player = u
        return u
    }

    remove(u) {
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

    damage(u, amount, source = null) {
        if (!u.alive || !u.active || amount <= 0) return
        u.hp -= amount
        const p = this.noa.entities.getPosition(u.entity)
        this.effects.burst([p[0], p[1] + u.height * 0.6, p[2]], u.side === 'attacker' ? [0.55, 0.1, 0.1] : [0.8, 0.15, 0.1], 5, 2.5, 0.08, 0.4)
        this.emit('hit', u, amount, source)
        if (u.hp <= 0) this.kill(u, source)
        else if (!u.char.busy) u.char.playAction('hit')
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
    }

    damageTown(amount, source) {
        if (this.town.hp <= 0) return
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
            if (u.isPlayer || u.possessed) continue
            u.thinkTimer -= dt
            if (u.thinkTimer <= 0) {
                u.thinkTimer = THINK_INTERVAL
                if (u.side === 'attacker') this._thinkAttacker(u)
                else this._thinkDefender(u)
            }
            this._act(u, dt)
        }
    }

    _contactDamage(u, dt) {
        if (u.side !== 'attacker' || !this.combat) return
        const p = this.posOf(u)
        const b = BLOCK_BY_ID[this.noa.getBlock(Math.floor(p[0]), Math.floor(p[1] + 0.1), Math.floor(p[2]))]
        if (b && b.contactDamage) this.damage(u, b.contactDamage * dt, 'spikes')
    }

    _thinkAttacker(u) {
        const p = this.posOf(u)
        const def = u.def
        u.target = null
        u.attackBlock = null
        u.attackTown = false
        if (!this.combat) {
            u.moveTo = null
            return
        }
        // fight nearby defenders / player
        const aggro = def.attack === 'melee' ? AGGRO_MELEE : def.range
        const enemy = this.nearestEnemy(u, aggro)
        if (enemy) {
            const q = this.posOf(enemy)
            const inSight = def.attack === 'melee' || this.lineOfSight([p[0], p[1] + 1.5, p[2]], [q[0], q[1] + 1, q[2]])
            if (inSight) {
                u.target = enemy
                u.moveTo = def.attack === 'melee' ? [q[0], q[1], q[2]] : null
                return
            }
        }
        // keep breaking the block we got stuck on
        if (u.breaking) {
            const [bx, by, bz, bid] = u.breaking.blk
            if (this.noa.getBlock(bx, by, bz) === bid && performance.now() < u.breaking.until) {
                u.attackBlock = u.breaking.blk
                u.moveTo = null
                return
            }
            u.breaking = null
        }
        // near the town center: attack it
        const tc = this.town.pos
        const dTown = Math.hypot(p[0] - tc[0], p[2] - tc[2])
        if (dTown < 2.9 && Math.abs(p[1] - this.town.base[1]) < 3) {
            u.attackTown = true
            u.moveTo = null
            return
        }
        const step = this.nav.nextStep(p[0], p[1], p[2], !!def.digs)
        if (step && step.atGoal) {
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
                const fy = Math.floor(p[1] + 0.05)
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
        // no field (yet): head straight for the town center
        u.moveTo = [tc[0], p[1], tc[2]]
        this._unstick(u, p)
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
            if (id === AIR || !b || !isFinite(b.hardness) || !b.solid) continue
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
                if (u.cooldown <= 0) this._attackUnit(u, u.target)
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

        // idle walks: advance through the waypoints
        if (u.walk && !u.target) {
            const wp = u.walk.path[u.walk.i]
            if (Math.hypot(wp[0] - p[0], wp[2] - p[2]) < 0.35 && Math.abs(wp[1] - p[1]) < 1.2) {
                u.walk.i++
                if (u.walk.i >= u.walk.path.length) u.walk = null
            }
            u.moveTo = u.walk ? u.walk.path[u.walk.i] : null
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
                    mv.heading = heading
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
        u.stuckTime = moving && moved < def.speed * dt * 0.2 ? u.stuckTime + dt : 0
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
        const destroyed = this.world.damageBlock(x, y, z, def.damage * Math.max(0.3, def.blockDamage))
        const b = BLOCK_BY_ID[id]
        this.emit('blockHit', x, y, z, id, destroyed)
        if (destroyed) u.attackBlock = null
        if (b) this.effects.burst([x + 0.5, y + 0.5, z + 0.5], [0.5, 0.45, 0.4], destroyed ? 10 : 3, 2.5, 0.12, 0.5)
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
                if (b && b.built) this.world.damageBlock(x, y, z, pr.damage * pr.blockDamage)
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
                else this.damage(u, pr.damage, pr.owner)
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
            if (d < r) this.damage(u, pr.damage * (1 - (d / r) * 0.6), pr.owner)
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
            let base = speed > 5.5 ? 'run' : speed > 0.5 ? 'walk' : 'idle'
            if (!body.resting[1] && v[1] < -4) base = 'fall'
            if (far) {
                // animation LOD: freeze distant units in their current pose
                u.char.setBase('idle', 0)
            } else {
                animated++
                u.char.setBase(base, base === 'walk' ? Math.max(0.6, speed / 3.5) : base === 'run' ? Math.max(0.8, speed / 7) : 1)
            }
        }
    }

    dispose() {
        for (const u of [...this.units]) if (!u.isPlayer) this.remove(u)
    }
}

export function lerpAngle(a, b, t) {
    let d = b - a
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    return a + d * t
}
