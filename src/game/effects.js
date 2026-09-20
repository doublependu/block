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
        // Babylon only compiles per-instance colors into the shader if the mesh has thin instances
        // when it's first drawn: colored pools always keep one (zero-size, invisible) instance
        this.minCount = withColor ? 1 : 0
        this.mesh.thinInstanceCount = this.minCount
        mat.freeze()
        noa.rendering.addMeshToScene(this.mesh)
    }

    /** @param {number} n */
    commit(n) {
        if (n < this.minCount) {
            this.matrices.fill(0, 0, 16)
            n = this.minCount
        }
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
            // a bolt is flatter, faster and brighter than an arrow, and pierces armour
            bolt: new InstancePool(noa, 'fx-bolt', [0.06, 0.06, 0.7], [0.72, 0.86, 1], 128),
            bullet: new InstancePool(noa, 'fx-bullet', [0.08, 0.08, 0.25], [0.95, 0.8, 0.3], 128),
            cannonball: new InstancePool(noa, 'fx-cannonball', [0.3, 0.3, 0.3], [0.08, 0.08, 0.1], 64),
            particle: new InstancePool(noa, 'fx-particle', [1, 1, 1], [1, 1, 1], 1024, true),
            keg: new InstancePool(noa, 'fx-keg', [0.34, 0.42, 0.34], [1, 1, 1], 32, true),
        }
        /** @type {Projectile[]} */
        this.projectiles = []
        this.particles = []
        /** @type {{pos: number[], left: number, rate: number, acc: number}[]} */
        this.smokes = []
        /** @type {{at: () => number[] | null, age: number, fuse: number}[]} */
        this.kegs = []
    }

    /**
     * A plume of rising smoke for a few seconds.
     * @param {number[]} pos
     * @param {number} seconds
     * @param {number} [rate] puffs per 0.1 s (scaled by the tier's particle setting)
     */
    smoke(pos, seconds, rate = 0.3) {
        if (this.smokes.length > 24) this.smokes.shift()
        this.smokes.push({ pos: pos.slice(), left: seconds, rate, acc: 0 })
    }

    /**
     * A lit powder keg that follows its carrier and flashes faster as the fuse
     * burns down. Remove it by returning null from `at`.
     * @param {() => number[] | null} at  keg position each frame
     * @param {number} fuse seconds
     */
    keg(at, fuse) {
        const k = { at, age: 0, fuse }
        this.kegs.push(k)
        return k
    }

    /**
     * @param {string} kind arrow | bolt | bullet | cannonball
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
                color, size: size * (0.6 + Math.random() * 0.8), life, age: 0, g: 12, grow: false,
            })
        }
    }

    /**
     * Burst of little cubes thrown toward `dir` (chips off a block, blood from a
     * hit): the same as `burst`, but aimed, so you can see where the blow came from.
     * @param {number[]} pos
     * @param {number[]} color rgb 0..1
     * @param {number[]} dir  direction to throw them (need not be normalised)
     */
    spray(pos, color, dir, count = 8, speed = 3, size = 0.12, life = 0.5) {
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
        const dx = dir[0] / len, dy = dir[1] / len, dz = dir[2] / len
        const n = Math.max(1, Math.round(count * this.particleScale))
        for (let i = 0; i < n; i++) {
            if (this.particles.length >= this.pools.particle.capacity) this.particles.shift()
            const spread = 0.65
            this.particles.push({
                pos: [pos[0] + (Math.random() - 0.5) * 0.35, pos[1] + (Math.random() - 0.5) * 0.35, pos[2] + (Math.random() - 0.5) * 0.35],
                vel: [
                    (dx + (Math.random() - 0.5) * spread) * speed,
                    (dy + (Math.random() - 0.5) * spread * 0.6) * speed,
                    (dz + (Math.random() - 0.5) * spread) * speed,
                ],
                color, size: size * (0.6 + Math.random() * 0.8), life, age: 0, g: 12, grow: false,
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
        const counts = { arrow: 0, bolt: 0, bullet: 0, cannonball: 0 }
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
        // smoke emitters: slow grey cubes that rise and grow
        for (let i = this.smokes.length - 1; i >= 0; i--) {
            const e = this.smokes[i]
            e.left -= s
            if (e.left <= 0) {
                this.smokes.splice(i, 1)
                continue
            }
            e.acc += s * 10 * e.rate * this.particleScale
            while (e.acc >= 1 && this.particles.length < pp.capacity) {
                e.acc -= 1
                const grey = 0.34 + Math.random() * 0.16
                this.particles.push({
                    pos: [e.pos[0] + (Math.random() - 0.5) * 1.2, e.pos[1] + Math.random() * 0.5, e.pos[2] + (Math.random() - 0.5) * 1.2],
                    vel: [(Math.random() - 0.5) * 0.6, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.6],
                    color: [grey, grey, grey * 1.05], size: 0.35 + Math.random() * 0.35, life: 2.2 + Math.random(), age: 0, g: -0.3, grow: true,
                })
            }
        }
        // kegs
        const kp = this.pools.keg
        let kn = 0
        for (let i = this.kegs.length - 1; i >= 0; i--) {
            const k = this.kegs[i]
            const at = k.at()
            if (!at) {
                this.kegs.splice(i, 1)
                continue
            }
            k.age += s
            if (kn >= kp.capacity) continue
            Matrix.ComposeToRef(tmpS.set(1, 1, 1), tmpQ.set(0, 0, 0, 1), tmpP.set(at[0], at[1], at[2]), tmpM)
            tmpM.copyToArray(kp.matrices, kn * 16)
            // flash faster as the fuse burns down
            const left = Math.max(0.05, k.fuse - k.age)
            const lit = Math.sin(k.age * Math.PI * 2 * (1.5 + 6 / (left + 0.5))) > 0
            kp.colors.set(lit ? [1, 0.9, 0.5, 1] : [0.45, 0.16, 0.1, 1], kn * 4)
            kn++
        }
        kp.commit(kn)
        let n = 0
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const q = this.particles[i]
            q.age += s
            if (q.age >= q.life) {
                this.particles.splice(i, 1)
                continue
            }
            q.vel[1] -= q.g * s
            q.pos[0] += q.vel[0] * s
            q.pos[1] += q.vel[1] * s
            q.pos[2] += q.vel[2] * s
            const size = q.grow ? q.size * (0.5 + 1.2 * (q.age / q.life)) * Math.min(1, (q.life - q.age) * 2) : q.size * (1 - q.age / q.life)
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
