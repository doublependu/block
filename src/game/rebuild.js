/*
 *  The dawn rebuild: after every night the town puts itself back together,
 *  slowly enough to watch (timing: DAWN in balance.js, dawnPlan in cycle.js).
 *
 *  Blocks come back in a readable order (see restoreOrder), each one growing
 *  out of a pale gold ghost cube from its base up; the real block appears when
 *  the ghost is full size, and the ghost fades off it. The ghosts are one
 *  thin-instance pool, drawn after the world (one draw call, only while
 *  something is being rebuilt).
 */

import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Material } from '@babylonjs/core/Materials/material'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { BLOCK_BY_ID } from '../world/blocks.js'
import { RENDER_GROUP } from '../core/constants.js'
import { placeSound, soundMaterial } from '../audio/sounds.js'

/** a block's ghost: grows for `grow` s, then the block is back and it fades for `fade` s */
export const GHOST = { grow: 0.25, fade: 0.35, alpha: 0.55, color: [1, 0.88, 0.5], max: 64 }

/** every `sparkleEvery`th block sparkles; the rebuild sound ticks at most every `soundGap` s */
const SPARKLE_EVERY = 4
const SOUND_GAP = 0.12
/** a block whose spot someone is standing in waits this long for them to move (s), then comes back anyway */
const BLOCKED_WAIT = 3

const TAU = Math.PI * 2

/**
 * pure: the order a dawn puts destroyed blocks back in. The Town Center first
 * (it's what the attackers were after), then everything else layer by layer
 * from the bottom, each layer sweeping clockwise round the town from the north
 * (the compass of waves.js: north is +z), inner blocks first. Walls grow back
 * side by side, and nothing appears before the block under it.
 * @param {number[][]} blocks [x, y, z, id]
 * @param {number[]} townCenter
 * @returns {number[][]} a sorted copy
 */
export function restoreOrder(blocks, townCenter) {
    const cx = townCenter[0] + 0.5, cz = townCenter[2] + 0.5
    const keyed = blocks.map((b) => {
        const dx = b[0] + 0.5 - cx, dz = b[2] + 0.5 - cz
        return {
            b,
            town: BLOCK_BY_ID[b[3]]?.townCenter ? 0 : 1,
            angle: ((Math.atan2(dx, dz) % TAU) + TAU) % TAU,
            dist: Math.hypot(dx, dz),
        }
    })
    keyed.sort((p, q) => p.town - q.town || p.b[1] - q.b[1] || p.angle - q.angle || p.dist - q.dist)
    return keyed.map((k) => k.b)
}

const tmpM = new Matrix()
const tmpQ = Quaternion.Identity()
const tmpS = new Vector3()
const tmpP = new Vector3()

export class Rebuild {
    /**
     * @param {object} ctx
     * @param {import('noa-engine').Engine} ctx.noa
     * @param {import('../world/worldState.js').WorldState} ctx.world
     * @param {import('./effects.js').Effects} ctx.effects
     * @param {import('../audio/audio.js').Audio} ctx.audio
     */
    constructor({ noa, world, effects, audio }) {
        this.noa = noa
        this.world = world
        this.effects = effects
        this.audio = audio
        const scene = noa.rendering.getScene()
        const mesh = CreateBox('rebuild-ghosts', { size: 1 }, scene)
        const mat = noa.rendering.makeStandardMaterial('rebuild-ghost-mat')
        mat.disableLighting = true
        // lighting off + emissive white: exactly the instance colour (and its alpha)
        mat.emissiveColor = new Color3(1, 1, 1)
        mat.fogEnabled = false
        mat.disableDepthWrite = true
        mat.transparencyMode = Material.MATERIAL_ALPHABLEND
        mesh.material = mat
        // after the world, tested against its depth
        mesh.renderingGroupId = RENDER_GROUP.overlay
        mesh.isPickable = false
        mesh.alwaysSelectAsActiveMesh = true
        this.matrices = new Float32Array(16 * GHOST.max)
        this.colors = new Float32Array(4 * GHOST.max)
        mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false)
        mesh.thinInstanceSetBuffer('color', this.colors, 4, false)
        mesh.thinInstanceCount = 1
        mat.freeze()
        noa.rendering.addMeshToScene(mesh)
        // an empty thin-instance mesh would still be drawn once as a plain box
        noa.rendering.setMeshVisibility(mesh, false)
        this.mesh = mesh
        this.shown = false

        /** blocks still to come, in order, and the next one */
        this.queue = []
        this.next = 0
        /** @type {{x: number, y: number, z: number, id: number, age: number, vis: number, placed: boolean, placedAt: number}[]} */
        this.ghosts = []
        this.total = 0
        this.done = 0
        this.active = false
        this.t = 0
        /** @type {{lead: number, rebuild: number, total: number}} */
        this.plan = { lead: 0, rebuild: 0, total: 0 }
        this._soundAt = -Infinity
    }

    /**
     * Start putting back everything destroyed last night, timed by `plan`.
     * @param {{lead: number, rebuild: number, total: number}} plan see dawnPlan
     * @param {number[]} townCenter
     */
    start(plan, townCenter) {
        const list = []
        this.world.damage.forEach((x, y, z, id) => list.push([x, y, z, id]))
        this.queue = restoreOrder(list, townCenter)
        this.next = 0
        this.total = this.queue.length
        this.done = 0
        this.t = 0
        this.plan = plan
        this.active = this.total > 0
        // blocks that were only damaged are whole again
        this.world.blockHp.clear()
    }

    /** where the rebuild is working right now (the newest ghost), or null */
    get focus() {
        const g = this.ghosts[this.ghosts.length - 1]
        return this.active && g ? [g.x + 0.5, g.y + 0.5, g.z + 0.5] : null
    }

    /** @param {number} dt seconds (fixed tick) */
    tick(dt) {
        if (!this.active) return
        this.t += dt
        const { lead, rebuild } = this.plan
        const p = rebuild > 0 ? (this.t - lead) / rebuild : 1
        const due = Math.min(this.total, Math.ceil(this.total * Math.max(0, Math.min(1, p))))
        while (this.next < due) {
            const [x, y, z, id] = this.queue[this.next++]
            if (this.ghosts.length >= GHOST.max) this._drop()
            this.ghosts.push({ x, y, z, id, age: 0, vis: 0, placed: false, placedAt: 0 })
        }
        let waiting = false
        const ents = this.noa.entities
        for (const g of this.ghosts) {
            g.age += dt
            // not into someone standing there (they'd be stuck in the wall), unless they stay put
            if (!g.placed && g.age >= GHOST.grow && (g.age >= GHOST.grow + BLOCKED_WAIT || !ents.isTerrainBlocked(g.x, g.y, g.z))) this._place(g)
            waiting = waiting || !g.placed
        }
        if (this.next >= this.total && !waiting) this._finish()
    }

    /** put the rest back at once (the dawn banner's Skip) */
    skip() {
        if (!this.active) return
        for (const g of this.ghosts) if (!g.placed) this._place(g, true)
        while (this.next < this.total) {
            const [x, y, z] = this.queue[this.next++]
            if (this.world.restoreBlock(x, y, z)) this.done++
        }
        this._finish()
    }

    _finish() {
        // anything destroyed that wasn't in the queue (it shouldn't happen) comes back too
        if (this.world.damageCount) this.world.restoreDamage(Infinity)
        this.done = this.total
        this.active = false
    }

    /** the oldest ghost goes (placing its block if it hadn't yet) */
    _drop() {
        const g = this.ghosts.shift()
        if (g && !g.placed) this._place(g, true)
    }

    _place(g, quiet = false) {
        g.placed = true
        g.placedAt = g.vis
        if (!this.world.restoreBlock(g.x, g.y, g.z)) return
        this.done++
        if (quiet) return
        const pos = [g.x + 0.5, g.y + 0.5, g.z + 0.5]
        if (this.done % SPARKLE_EVERY === 0) this.effects.burst(pos, [0.95, 0.9, 0.6], 3, 1.5, 0.08, 0.5)
        const now = performance.now()
        if (now - this._soundAt > SOUND_GAP * 1000) {
            this._soundAt = now
            this.audio.play(placeSound(soundMaterial(BLOCK_BY_ID[this.world.getBlock(g.x, g.y, g.z)]?.name)), pos)
        }
    }

    /** @param {number} dtMs */
    render(dtMs) {
        const dt = dtMs / 1000
        let n = 0
        let keep = 0
        for (const g of this.ghosts) {
            g.vis += dt
            // a placed ghost that has faded is done with
            if (g.placed && g.vis - g.placedAt >= GHOST.fade) continue
            this.ghosts[keep++] = g
            // grows up from the base (and waits at full size if someone is in the way),
            // then swells a little and fades off the block
            let sy, sxz, alpha
            if (!g.placed) {
                const k = smooth(g.vis / GHOST.grow)
                sy = Math.max(0.02, k * 1.02)
                sxz = 0.9 + 0.12 * k
                alpha = GHOST.alpha
            } else {
                const k = Math.min(1, Math.max(0, g.vis - g.placedAt) / GHOST.fade)
                sy = sxz = 1.02 + 0.08 * k
                alpha = GHOST.alpha * (1 - k)
            }
            tmpS.set(sxz, sy, sxz)
            tmpP.set(g.x + 0.5, g.y + sy / 2 - 0.01, g.z + 0.5)
            Matrix.ComposeToRef(tmpS, tmpQ, tmpP, tmpM)
            tmpM.copyToArray(this.matrices, n * 16)
            this.colors[n * 4] = GHOST.color[0]
            this.colors[n * 4 + 1] = GHOST.color[1]
            this.colors[n * 4 + 2] = GHOST.color[2]
            this.colors[n * 4 + 3] = alpha
            n++
        }
        this.ghosts.length = keep
        const show = n > 0
        if (show !== this.shown) {
            this.shown = show
            this.noa.rendering.setMeshVisibility(this.mesh, show)
        }
        if (!show) return
        this.mesh.thinInstanceCount = n
        this.mesh.thinInstanceBufferUpdated('matrix')
        this.mesh.thinInstanceBufferUpdated('color')
    }

    dispose() {
        this.mesh.dispose()
    }
}

/** smoothstep */
function smooth(p) {
    const x = Math.max(0, Math.min(1, p))
    return x * x * (3 - 2 * x)
}
