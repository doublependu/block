/*
 *  Siege rules: how defences come down at night.
 *
 *    - structures attackers go for (towers, the stacks holding them up, walls)
 *    - collapse: built blocks with nothing holding them up fall
 *    - the town center crumbles in stages as it loses hp
 *    - explosions (sapper kegs, the opening raid finale)
 *
 *  Everything destroyed here goes into the world's night damage overlay, so
 *  dawn rebuilds it like any other night damage. The pure functions take a
 *  getBlock(x, y, z) callback and are unit tested; Demolition is the runtime
 *  queue that applies them a few blocks per tick.
 */

import { AIR, BLOCK_BY_ID } from '../world/blocks.js'
import { SIEGE, HIT_FX } from './balance.js'

/** @typedef {(x: number, y: number, z: number) => number} GetBlock */

const H4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]

function def(id) {
    return id === AIR ? null : BLOCK_BY_ID[id] || null
}

/** a block that can hold another one up */
function supports(id) {
    const b = def(id)
    return !!b && (b.solid || !!b.gate) && !b.fluid
}

/** wall-like built block: part of a barrier (not a tower, not spikes) */
export function isWallBlock(id) {
    const b = def(id)
    return !!b && !!b.built && (b.solid || !!b.gate) && !b.tower && !b.contactDamage
}

export function isTowerBlock(id) {
    const b = def(id)
    return !!b && !!b.tower
}

/**
 * pure: attackers can't stand here: the floor under feet level `y` is a tower,
 * or a built block resting on another built block (the top of a wall).
 * @param {GetBlock} getBlock
 */
export function isBarrierTop(getBlock, x, y, z) {
    const floor = def(getBlock(x, y - 1, z))
    if (!floor || !floor.solid) return false
    if (floor.tower) return true
    const below = def(getBlock(x, y - 2, z))
    return !!floor.built && !!below && !!below.built
}

/**
 * pure: built blocks that lose their support when the block at (x, y, z) is
 * gone: the one above it and its four horizontal neighbours. A tower needs a
 * block under it; other built blocks also hold on to a solid side neighbour.
 * @param {GetBlock} getBlock  must already report (x, y, z) as air
 * @returns {number[][]} [x, y, z] of blocks that fall
 */
export function collapseCandidates(getBlock, x, y, z) {
    const out = []
    const cells = [[x, y + 1, z], ...H4.map(([dx, dz]) => [x + dx, y, z + dz])]
    for (const [cx, cy, cz] of cells) {
        const b = def(getBlock(cx, cy, cz))
        if (!b || !b.built) continue
        if (supports(getBlock(cx, cy - 1, cz))) continue
        if (!b.tower && H4.some(([dx, dz]) => supports(getBlock(cx + dx, cy, cz + dz)))) continue
        out.push([cx, cy, cz])
    }
    return out
}

/**
 * pure: town center blocks in the order they crumble: the crystal, then each
 * layer from the top (corners, edges, center).
 * @param {number[]} tc town center base block (bottom center of the 3x3x3 core)
 */
export function townRuinBlocks(tc) {
    const out = [[tc[0], tc[1] + 3, tc[2]]]
    const ring = [[-1, -1], [1, 1], [-1, 1], [1, -1], [0, -1], [0, 1], [-1, 0], [1, 0], [0, 0]]
    for (let dy = 2; dy >= 0; dy--) for (const [dx, dz] of ring) out.push([tc[0] + dx, tc[1] + dy, tc[2] + dz])
    return out
}

/**
 * pure: how many town center blocks are gone at an hp fraction. Nothing above
 * 80%, then steadily more, and the last blocks go only when hp reaches 0.
 */
export function townRuinCount(fraction, total) {
    if (fraction >= 0.8) return 0
    if (fraction <= 0) return total
    return Math.min(total - 4, 1 + Math.floor(((0.8 - fraction) / 0.8) * (total - 4)))
}

/**
 * pure: the structure a wrecker standing at feet position p should hit:
 * a tower in reach, else the lowest reachable block of a stack holding a tower
 * up, else (when allowed) a wall block. Nearest first within each kind.
 * @param {GetBlock} getBlock
 * @param {number[]} p feet position
 * @param {{walls?: boolean}} [o]
 * @returns {{kind: 'tower'|'support'|'wall', blk: number[]} | null}
 */
export function pickStructureTarget(getBlock, p, { walls = true } = {}) {
    const fx = Math.floor(p[0]), fy = Math.floor(p[1] + 0.05), fz = Math.floor(p[2])
    let best = null, bestScore = Infinity
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const x = fx + dx, z = fz + dz
            for (let y = fy - 1; y <= fy + 3; y++) {
                const id = getBlock(x, y, z)
                const b = def(id)
                if (!b || !b.built) continue
                let kind = null
                if (b.tower) kind = 'tower'
                else if (y <= fy + 2 && towerAbove(getBlock, x, y, z)) kind = 'support'
                else if (walls && y >= fy && y <= fy + 2 && isWallBlock(id)) kind = 'wall'
                if (!kind) continue
                const rank = kind === 'tower' ? 0 : kind === 'support' ? 100 : 200
                const score = rank + Math.abs(dx) + Math.abs(dz) + Math.abs(y - fy) * 0.5
                if (score < bestScore) {
                    bestScore = score
                    best = { kind, blk: [x, y, z, id] }
                }
            }
        }
    }
    return best
}

function towerAbove(getBlock, x, y, z) {
    for (let k = y + 1; k <= y + 8; k++) {
        const b = def(getBlock(x, k, z))
        if (!b || !b.built) return false
        if (b.tower) return true
    }
    return false
}

/**
 * pure: the next wall block to hit when widening a breach: a wall block next
 * to the destroyed one (same level, one up or down), within reach of p.
 * @param {GetBlock} getBlock
 */
export function widenTarget(getBlock, x, y, z, p) {
    const fy = Math.floor(p[1] + 0.05)
    let best = null, bestD = Infinity
    for (const [dx, dz] of H4) {
        for (const dy of [0, 1, -1]) {
            const bx = x + dx, by = y + dy, bz = z + dz
            if (by < fy || by > fy + 2) continue
            const id = getBlock(bx, by, bz)
            if (!isWallBlock(id)) continue
            const d = Math.hypot(bx + 0.5 - p[0], bz + 0.5 - p[2])
            if (d > 2.6) continue
            if (d < bestD) {
                bestD = d
                best = [bx, by, bz, id]
            }
        }
    }
    return best
}

/**
 * Runtime: a queue of night demolitions (collapses, explosions, the crumbling
 * town center), applied a few blocks per tick so one explosion doesn't remesh
 * several chunks in the same frame.
 */
export class Demolition {
    /**
     * @param {object} ctx
     * @param {import('../world/worldState.js').WorldState} ctx.world
     * @param {import('./units.js').UnitManager} ctx.units
     * @param {import('./effects.js').Effects} ctx.effects
     * @param {import('../audio/audio.js').Audio} ctx.audio
     * @param {(pos: number[], strength: number) => void} [ctx.onExplosion]
     */
    constructor({ world, units, effects, audio, onExplosion = () => {} }) {
        this.world = world
        this.units = units
        this.effects = effects
        this.audio = audio
        this.onExplosion = onExplosion
        /** @type {number[][]} */
        this.queue = []
        this.pending = new Set()
        this.ruin = townRuinBlocks(world.townCenter)
        this.ruined = 0
        /** collapses only happen while attackers are out (night damage) */
        this.active = false
        this.getBlock = (x, y, z) => (this.pending.has(`${x},${y},${z}`) ? AIR : world.peek(x, y, z))
        world.on('blockDestroyed', (x, y, z) => {
            if (!this.active) return
            for (const [cx, cy, cz] of collapseCandidates(this.getBlock, x, y, z)) this.add(cx, cy, cz)
        })
    }

    add(x, y, z) {
        const key = `${x},${y},${z}`
        if (this.pending.has(key) || this.world.peek(x, y, z) === AIR) return
        this.pending.add(key)
        this.queue.push([x, y, z])
    }

    get busy() {
        return this.queue.length > 0
    }

    tick() {
        let n = SIEGE.demolishPerTick
        while (this.queue.length && n-- > 0) {
            const [x, y, z] = this.queue.shift()
            this.pending.delete(`${x},${y},${z}`)
            const id = this.world.demolish(x, y, z)
            if (!id) continue
            const b = BLOCK_BY_ID[id]
            const color = b && b.townCenter ? [0.79, 0.7, 0.48] : [0.5, 0.45, 0.4]
            this.effects.burst([x + 0.5, y + 0.5, z + 0.5], color, 6, 3, 0.16, 0.8)
        }
    }

    /**
     * Blow up everything built within spec.radius, hurt nearby units (both sides)
     * and the town center.
     * @param {number[]} pos
     * @param {{radius: number, unitDamage: number, unitRadius: number, townDamage: number, townRadius: number}} spec
     * @param {any} [owner]
     */
    explode(pos, spec, owner = null) {
        const w = this.world
        const r = spec.radius
        const cells = []
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
            for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
                for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
                    const x = Math.floor(pos[0]) + dx, y = Math.floor(pos[1]) + dy, z = Math.floor(pos[2]) + dz
                    const d = Math.hypot(x + 0.5 - pos[0], y + 0.5 - pos[1], z + 0.5 - pos[2])
                    if (d > r) continue
                    // built blocks only exist as edits
                    const e = w.edits.get(x, y, z)
                    if (e === undefined || w.damage.has(x, y, z)) continue
                    const b = def(e)
                    if (b && b.built) cells.push([d, x, y, z])
                }
            }
        }
        cells.sort((a, b) => a[0] - b[0])
        for (const [, x, y, z] of cells) this.add(x, y, z)
        const units = this.units
        for (const u of units.units) {
            if (!u.alive || !u.active) continue
            const q = units.posOf(u)
            const d = Math.hypot(q[0] - pos[0], q[1] + 0.9 - pos[1], q[2] - pos[2])
            // the blast throws whoever it doesn't kill
            if (d < spec.unitRadius) units.damage(u, spec.unitDamage * (1 - (d / spec.unitRadius) * 0.5), owner, pos, HIT_FX.splashKnockback)
        }
        const tc = units.town.pos
        if (Math.hypot(tc[0] - pos[0], tc[2] - pos[2]) < spec.townRadius) units.damageTown(spec.townDamage, owner)
        this.effects.burst(pos, [1, 0.62, 0.18], 26, 7, 0.22, 0.6)
        this.effects.burst(pos, [0.35, 0.33, 0.32], 22, 5, 0.3, 1.1)
        this.effects.smoke(pos, 3, 0.45)
        this.audio.explosion(pos)
        this.onExplosion(pos, 1)
    }

    /** remove town center blocks to match its hp */
    updateTownRuin() {
        const t = this.units.town
        const want = townRuinCount(t.hp / t.maxHp, this.ruin.length)
        while (this.ruined < want) {
            const [x, y, z] = this.ruin[this.ruined++]
            this.add(x, y, z)
        }
    }

    /** dawn: everything is rebuilt by the world's damage restore */
    reset() {
        this.queue = []
        this.pending.clear()
        this.ruined = 0
    }
}
