/*
 *  Projectiles and particles, each drawn as thin instances of one mesh
 *  (one draw call per kind, no per-object scene nodes).
 */

import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Meshes/thinInstanceMesh'
import { PROJECTILES } from './balance.js'

class InstancePool {
    constructor(noa, name, size, color, capacity, withColor = false) {
        const scene = noa.rendering.getScene()
        this.mesh = CreateBox(name, { width: size[0], height: size[1], depth: size[2] }, scene)
        const mat = noa.rendering.makeStandardMaterial(name + '-mat')
        mat.diffuseColor = new Color3(color[0], color[1], color[2])
        if (withColor) mat.diffuseColor = new Color3(1, 1, 1)
        mat.freeze()
        this.mesh.material = mat
        this.mesh.isPickable = false
        this.mesh.alwaysSelectAsActiveMesh = true
        this.capacity = capacity
        this.matrices = new Float32Array(16 * capacity)
        this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false)
        if (withColor) {
            this.colors = new Float32Array(4 * capacity).fill(1)
            this.mesh.thinInstanceSetBuffer('color', this.colors, 4, false)
        }
        this.mesh.thinInstanceCount = 0
        noa.rendering.addMeshToScene(this.mesh)
    }

    /** @param {number} n */
    commit(n) {
        this.mesh.thinInstanceCount = n
        if (n > 0) {
            this.mesh.thinInstanceBufferUpdated('matrix')
            if (this.colors) this.mesh.thinInstanceBufferUpdated('color')
        }
    }
}

const tmpM = new Matrix()
const tmpQ = new Quaternion()
const tmpS = new Vector3()
const tmpP = new Vector3()
const UP = new Vector3(0, 1, 0)

/**
 * @typedef {object} Projectile
 * @property {string} kind
 * @property {number[]} pos
 * @property {number[]} vel
 * @property {number} gravity
 * @property {number} radius
 * @property {number} damage
 * @property {number} splash
 * @property {number} blockDamage
 * @property {'defender'|'attacker'} side
 * @property {any} owner
 * @property {number} life
 */

export class Effects {
    /**
     * @param {import('noa-engine').Engine} noa
     * @param {{particles: number}} tier
     */
    constructor(noa, tier) {
        this.noa = noa
        this.particleScale = tier.particles
        this.pools = {
            arrow: new InstancePool(noa, 'fx-arrow', [0.05, 0.05, 0.6], [0.45, 0.32, 0.18], 256),
            bullet: new InstancePool(noa, 'fx-bullet', [0.08, 0.08, 0.25], [0.95, 0.8, 0.3], 128),
            cannonball: new InstancePool(noa, 'fx-cannonball', [0.3, 0.3, 0.3], [0.08, 0.08, 0.1], 64),
            particle: new InstancePool(noa, 'fx-particle', [1, 1, 1], [1, 1, 1], 1024, true),
        }
        /** @type {Projectile[]} */
        this.projectiles = []
        this.particles = []
    }

    /**
     * @param {string} kind arrow | bullet | cannonball
     * @param {number[]} from
     * @param {number[]} target aim point
     * @param {Partial<Projectile>} props
     */
    fire(kind, from, target, props) {
        const spec = PROJECTILES[kind]
        const dx = target[0] - from[0], dy = target[1] - from[1], dz = target[2] - from[2]
        const horiz = Math.sqrt(dx * dx + dz * dz)
        const t = Math.max(0.05, Math.sqrt(horiz * horiz + dy * dy) / spec.speed)
        // aim so gravity drop is compensated over the flight time
        const vel = [dx / t, dy / t + 0.5 * spec.gravity * t, dz / t]
        this.projectiles.push({
            kind, pos: from.slice(), vel, gravity: spec.gravity, radius: spec.radius,
            damage: 0, splash: 0, blockDamage: 0, side: 'defender', owner: null, life: 4, ...props,
        })
    }

    /** direction-based fire (possessed units aim with the camera) */
    fireDir(kind, from, dir, props) {
        const spec = PROJECTILES[kind]
        const vel = [dir[0] * spec.speed, dir[1] * spec.speed, dir[2] * spec.speed]
        this.projectiles.push({
            kind, pos: from.slice(), vel, gravity: spec.gravity, radius: spec.radius,
            damage: 0, splash: 0, blockDamage: 0, side: 'defender', owner: null, life: 4, ...props,
        })
    }

    /**
     * Burst of little cubes.
     * @param {number[]} pos
     * @param {number[]} color rgb 0..1
     */
    burst(pos, color, count = 10, speed = 3, size = 0.12, life = 0.7) {
        const n = Math.max(1, Math.round(count * this.particleScale))
        for (let i = 0; i < n; i++) {
            if (this.particles.length >= this.pools.particle.capacity) this.particles.shift()
            const a = Math.random() * Math.PI * 2, u = Math.random()
            this.particles.push({
                pos: [pos[0] + (Math.random() - 0.5) * 0.6, pos[1] + (Math.random() - 0.5) * 0.6, pos[2] + (Math.random() - 0.5) * 0.6],
                vel: [Math.cos(a) * speed * u, speed * (0.4 + Math.random()), Math.sin(a) * speed * u],
                color, size: size * (0.6 + Math.random() * 0.8), life, age: 0,
            })
        }
    }

    /**
     * Advance projectiles; `hit(p, pos)` returns true if the projectile hit something.
     * @param {number} dt seconds
     * @param {(p: Projectile, pos: number[]) => boolean} hitTest
     */
    tick(dt, hitTest) {
        const noa = this.noa
        const list = this.projectiles
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i]
            p.life -= dt
            // substeps so fast projectiles don't tunnel through targets
            const steps = Math.max(1, Math.ceil(Math.hypot(p.vel[0], p.vel[1], p.vel[2]) * dt / 0.4))
            const h = dt / steps
            let done = p.life <= 0
            for (let s = 0; s < steps && !done; s++) {
                p.vel[1] -= p.gravity * h
                p.pos[0] += p.vel[0] * h
                p.pos[1] += p.vel[1] * h
                p.pos[2] += p.vel[2] * h
                if (hitTest(p, p.pos)) done = true
                else if (noa.world.getBlockSolidity(Math.floor(p.pos[0]), Math.floor(p.pos[1]), Math.floor(p.pos[2]))) {
                    hitTest(p, null)
                    done = true
                }
            }
            if (done) {
                list[i] = list[list.length - 1]
                list.pop()
            }
        }
    }

    /** write instance buffers (every frame) */
    render(dt) {
        const counts = { arrow: 0, bullet: 0, cannonball: 0 }
        for (const p of this.projectiles) {
            const pool = this.pools[p.kind]
            const n = counts[p.kind]
            if (n >= pool.capacity) continue
            const v = tmpP.set(p.vel[0], p.vel[1], p.vel[2])
            const len = v.length()
            if (len > 0.001) {
                v.scaleInPlace(1 / len)
                // rotate +Z onto the velocity direction
                const axis = Vector3.Cross(new Vector3(0, 0, 1), v)
                const angle = Math.acos(Math.max(-1, Math.min(1, v.z)))
                if (axis.lengthSquared() < 1e-6) Quaternion.RotationAxisToRef(UP, angle, tmpQ)
                else Quaternion.RotationAxisToRef(axis.normalize(), angle, tmpQ)
            } else tmpQ.set(0, 0, 0, 1)
            Matrix.ComposeToRef(tmpS.set(1, 1, 1), tmpQ, tmpP.set(p.pos[0], p.pos[1], p.pos[2]), tmpM)
            tmpM.copyToArray(pool.matrices, n * 16)
            counts[p.kind] = n + 1
        }
        for (const k of Object.keys(counts)) this.pools[k].commit(counts[k])

        const s = dt / 1000
        const pp = this.pools.particle
        let n = 0
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const q = this.particles[i]
            q.age += s
            if (q.age >= q.life) {
                this.particles.splice(i, 1)
                continue
            }
            q.vel[1] -= 12 * s
            q.pos[0] += q.vel[0] * s
            q.pos[1] += q.vel[1] * s
            q.pos[2] += q.vel[2] * s
            const size = q.size * (1 - q.age / q.life)
            Matrix.ComposeToRef(tmpS.set(size, size, size), tmpQ.set(0, 0, 0, 1), tmpP.set(q.pos[0], q.pos[1], q.pos[2]), tmpM)
            tmpM.copyToArray(pp.matrices, n * 16)
            pp.colors[n * 4] = q.color[0]
            pp.colors[n * 4 + 1] = q.color[1]
            pp.colors[n * 4 + 2] = q.color[2]
            pp.colors[n * 4 + 3] = 1
            n++
            if (n >= pp.capacity) break
        }
        pp.commit(n)
    }
}
