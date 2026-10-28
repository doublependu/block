/*
 *  The fire mage's fireball (plan 12 §2), from the gathering at the staff to
 *  the scorch it leaves.
 *
 *  A port of the Cinder Fall in ~/Repos/dp-sakura-crossing (src/world/
 *  cinderfall.js), and "port" means its choreography and its numbers, not its
 *  code: that one is three.js and cel-shaded, this game is Babylon and blocks.
 *  The beats are the reference's:
 *
 *    the wind-up  a ball gathers at the staff's tip (FIREBALL.windup): the
 *                 moment to kill or freeze the mage
 *    the arc      a lob, `arc` metres high at mid-span with a flattened top,
 *                 never shorter than `minFlight`, so even a short throw is
 *                 something you watch arrive
 *    heating up   two shells round a dark core swell from `headMin` to
 *                 `headMax` of the ball's radius, late (`chargeCurve`): what
 *                 leaves the staff is a coal with a flame on it, what lands is
 *                 a fireball with a coal in it. Flame tongues stream behind it
 *    the fireball three lumps, offset rather than nested so all three break
 *                 the silhouette: red, orange and cream, each growing fast and
 *                 coasting (1 − (1 − f)^2.6), holding, then gone. Lifted into a
 *                 dome: most of a ground blast's sphere is under the ground
 *    tongues      thrown flat out of the crater
 *    the ring     a shock ring rolling out over the ground
 *    debris       the blocks it blew out, thrown as chips in their own colours
 *                 (siege.js Demolition.fireball)
 *    embers       rising through a four-stop ramp, cream to soot
 *    the mark     a scorch on the crater floor that fades
 *
 *  Left out, for the reference's own reasons: a dynamic light (a light changes
 *  every material's shader), a volumetric trail, a PBR rock. The glow is drawn:
 *  every piece is a flat colour, unlit or (the lumps) lit only enough to show
 *  they're round, never darker than 80% of their colour. No transparency: a lump that's done
 *  shrinks away and darkens to smoke instead of fading, which costs no sorting
 *  and no overdraw.
 *
 *  Cost: four draw calls (the lumps, the tongues, the ring, the scorches), each
 *  one mesh with thin instances and a per-instance colour.
 *
 *  As in the reference, a cast stores dice, not metres: one seed and a few
 *  unitless rolls. Every distance and duration is read from C each frame.
 */

import { CreateIcoSphere } from '@babylonjs/core/Meshes/Builders/icoSphereBuilder'
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder'
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder'
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder'
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer'
import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import '@babylonjs/core/Meshes/thinInstanceMesh'

/**
 * The numbers. Where a name matches the reference's, its value there is in the
 * comment; the sizes are scaled to this world (a blast of FIREBALL.radius 2,
 * where the reference's dragon throws a 3.6 m burst).
 */
export const C = {
    // ---- the cast
    speed: 13, // reference 13
    minFlight: 0.95, // reference 0.95: the floor under the flight time
    arc: 3.4, // reference 3.4: metres the mid-span lobs upward
    arcCurve: 0.85, // < 1 flattens the top of the arc
    chargeCurve: 1.6, // how late it heats up on the way in
    // ---- the ball
    radius: 0.32, // reference 0.9 (a dragon's cinder)
    headMin: 1.15, // × radius, cool at the staff ...
    headMax: 2.1, // ... and at full charge, on the way in
    spin: 3.0,
    // ---- the trail
    trailNodes: 24, // reference 34
    trailSpan: 4.0, // reference 7.0: metres of arc behind it (the throws here are shorter)
    trailWidth: 0.42,
    trailHead: 1.7,
    trailFlicker: 0.22,
    // ---- the detonation
    burstSize: 2.2, // reference 3.6 (scaled to FIREBALL.radius)
    /** three lumps: [start radius, end radius] × burstSize, lifetime, colour, hold, spin, offset × radius */
    shells: [
        { r0: 0.22, r1: 0.94, life: 0.9, color: [1, 0.24, 0.06], hold: 0.55, spin: 0.7, off: [0, 0, 0] },
        { r0: 0.18, r1: 0.8, life: 0.66, color: [1, 0.69, 0.18], hold: 0.5, spin: -1.1, off: [-0.3, 0.34, 0.12] },
        { r0: 0.12, r1: 0.52, life: 0.4, color: [1, 0.95, 0.82], hold: 0.4, spin: 1.6, off: [0.3, 0.46, -0.16] },
    ],
    burstTongues: 16, // reference 16
    burstTongueLife: 0.7,
    burstTongueReach: 0.85, // × burstSize
    // ---- embers
    burstEmbers: 120, // reference 190 (scaled by the quality tier)
    emberSpeed: 2.4,
    emberRise: 1.6,
    emberLife: 1.5,
    // ---- the ground
    shockRadius: 4.7, // reference 7.0
    shockLife: 0.6, // reference 0.6
    scorchRadius: 1.25, // reference 2.6 (a flat mark on blocky ground: smaller, so it clips less)
    scorchLife: 8, // reference 8
}

/** the four stops an ember walks through, birth to death (the reference's, ending in soot) */
export const EMBER = [[1, 0.95, 0.82], [1, 0.71, 0.33], [0.88, 0.27, 0.25], [0.16, 0.13, 0.12]]
/** the trail, tail to head */
export const FLAME = [[1, 0.24, 0.06], [1, 0.69, 0.18], [1, 0.85, 0.63], [1, 0.95, 0.82]]

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

/** pure: a four-stop gradient at t in 0..1 */
export function gradient4(stops, t, out = [0, 0, 0]) {
    const u = clamp(t, 0, 1) * 3
    const i = Math.min(2, Math.floor(u))
    const f = u - i
    for (let k = 0; k < 3; k++) out[k] = stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f
    return out
}

/** pure: seconds a throw over `dist` metres takes */
export function flightTime(dist) {
    return Math.max(C.minFlight, dist / C.speed)
}

/** pure: the point a share `s` along a throw's arc */
export function arcPoint(from, to, s, out = [0, 0, 0]) {
    const lift = C.arc * Math.pow(Math.max(0, 4 * s * (1 - s)), C.arcCurve)
    out[0] = from[0] + (to[0] - from[0]) * s
    out[1] = from[1] + (to[1] - from[1]) * s + lift
    out[2] = from[2] + (to[2] - from[2]) * s
    return out
}

/** pure: how a burst's lump `spec` looks at `t` seconds: its radius (0 once it's gone) and its colour */
export function shellAt(spec, t, out = [0, 0, 0]) {
    const f = clamp(t / spec.life, 0, 1)
    // out fast, then coast: an explosion is not a balloon inflating
    const grow = 1 - Math.pow(1 - f, 2.6)
    // it holds, then goes: here by shrinking to nothing, and only at the very end darkening to smoke
    // (a fireball is bright for most of its life and then is not there)
    const left = 1 - smoothstep(spec.hold, 1, f)
    const smoke = smoothstep(spec.hold + (1 - spec.hold) * 0.6, 1, f)
    const r = f >= 1 ? 0 : C.burstSize * (spec.r0 + (spec.r1 - spec.r0) * grow) * (0.25 + 0.75 * left)
    for (let k = 0; k < 3; k++) out[k] = spec.color[k] * (1 - smoke) + [0.24, 0.19, 0.17][k] * smoke
    return r
}

/** the radius of the trail along the stream (0 = tail, 1 = head), × trailWidth */
function trailProfile(u) {
    return (0.3 + 0.7 * Math.pow(u, 0.55)) * (1 + (C.trailHead - 1) * smoothstep(0.62, 1, u))
}

/** a small deterministic hash in 0..1 (the cast's dice) */
function hash(a, b) {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return x - Math.floor(x)
}

/** a lumpy ball, the cinder and every shell: an icosphere pushed in and out by a hash of direction */
function lumpySphere(scene) {
    const mesh = CreateIcoSphere('fx-fireball', { radius: 1, subdivisions: 2, flat: true }, scene)
    const pos = mesh.getVerticesData(VertexBuffer.PositionKind)
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2]
        const len = Math.hypot(x, y, z) || 1
        // the same direction always gets the same push, so the faces stay joined
        const k = 1 + 0.26 * (hash(Math.round(x * 50), Math.round(y * 50) + Math.round(z * 50) * 7) - 0.5) * 2
        pos[i] = (x / len) * k
        pos[i + 1] = (y / len) * k
        pos[i + 2] = (z / len) * k
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos)
    return mesh
}

/**
 * One mesh, drawn as thin instances, each with its own colour. Unlit, or with
 * `glow` (0..1) lit just enough to show its shape: never darker than `glow` of
 * its colour, so it still reads as burning on its shadowed side.
 */
class Pool {
    constructor(noa, mesh, capacity, glow = 1) {
        const mat = noa.rendering.makeStandardMaterial(mesh.name + '-mat')
        mat.disableLighting = glow >= 1
        mat.diffuseColor = new Color3(1, 1, 1)
        mat.emissiveColor = new Color3(glow, glow, glow)
        mat.ambientColor = new Color3(0, 0, 0)
        mat.specularColor = new Color3(0, 0, 0)
        mesh.material = mat
        mesh.isPickable = false
        mesh.alwaysSelectAsActiveMesh = true
        this.mesh = mesh
        this.capacity = capacity
        this.matrices = new Float32Array(16 * capacity)
        this.colors = new Float32Array(4 * capacity).fill(1)
        mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false)
        mesh.thinInstanceSetBuffer('color', this.colors, 4, false)
        // per-instance colours only compile in if the mesh has instances when first drawn (see effects.js)
        mesh.thinInstanceCount = 1
        this.matrices.fill(0, 0, 16)
        mat.freeze()
        noa.rendering.addMeshToScene(mesh)
        this.n = 0
    }

    /** add an instance (false when full) */
    put(m, color) {
        if (this.n >= this.capacity) return false
        m.copyToArray(this.matrices, this.n * 16)
        this.colors[this.n * 4] = color[0]
        this.colors[this.n * 4 + 1] = color[1]
        this.colors[this.n * 4 + 2] = color[2]
        this.colors[this.n * 4 + 3] = 1
        this.n++
        return true
    }

    commit() {
        let n = this.n
        if (n === 0) {
            this.matrices.fill(0, 0, 16)
            n = 1
        }
        this.mesh.thinInstanceCount = n
        this.mesh.thinInstanceBufferUpdated('matrix')
        this.mesh.thinInstanceBufferUpdated('color')
        this.n = 0
    }
}

const tmpM = new Matrix()
const tmpQ = new Quaternion()
const tmpS = new Vector3()
const tmpP = new Vector3()
const AXIS = new Vector3(0.31, 0.83, 0.46).normalize()
const ID = Quaternion.Identity()
const col = [0, 0, 0]
const pt = [0, 0, 0]

export class Fireballs {
    /**
     * @param {import('noa-engine').Engine} noa
     * @param {{particles: number}} tier
     * @param {import('./effects.js').Effects} effects  the shared particle pool (embers)
     * @param {object} hooks
     * @param {(pos: number[]) => any} hooks.hitUnit  a defender the ball is touching at `pos`, or null
     * @param {(pos: number[], owner: any) => void} hooks.onImpact  it went off here (the blast's rules: siege.js)
     */
    constructor(noa, tier, effects, { hitUnit, onImpact }) {
        this.noa = noa
        this.effects = effects
        this.particleScale = tier.particles
        this.hitUnit = hitUnit
        this.onImpact = onImpact
        const scene = noa.rendering.getScene()
        // the lumps are shaded a little, so a lump reads as a ball and not a cut-out
        this.lumps = new Pool(noa, lumpySphere(scene), 64, 0.8)
        this.tongues = new Pool(noa, CreateBox('fx-tongue', { size: 1 }, scene), 512)
        this.rings = new Pool(noa, CreateTorus('fx-shock', { diameter: 2, thickness: 0.18, tessellation: 28 }, scene), 8)
        this.scorches = new Pool(noa, CreateCylinder('fx-scorch', { diameter: 2, height: 0.04, tessellation: 18 }, scene), 12)
        /** @type {Map<any, {at: () => number[] | null, t: number, total: number, seed: number}>} */
        this.gathers = new Map()
        /** @type {{from: number[], to: number[], T: number, t: number, seed: number, owner: any, pos: number[], trail: number[][]}[]} */
        this.casts = []
        /** @type {{pos: number[], t: number, seed: number, airburst: boolean, ground: number | null, tongues: {a: number, d: number, s: number, lag: number}[]}[]} */
        this.bursts = []
        /** @type {{pos: number[], t: number}[]} */
        this.marks = []
        this.clock = 0
        this._seed = 1
    }

    /** a ball gathering at a staff for `seconds`; `at` gives the staff's tip each frame (null: gone) */
    gather(owner, at, seconds) {
        this.gathers.set(owner, { at, t: 0, total: seconds, seed: this._seed++ })
    }

    /** the gathering stopped (the mage was frozen or killed) */
    cancel(owner) {
        this.gathers.delete(owner)
    }

    /** throw a fireball from `from` at `to` */
    throw(from, to, owner) {
        this.gathers.delete(owner)
        const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2])
        this.casts.push({ from: from.slice(), to: to.slice(), T: flightTime(dist), t: 0, seed: this._seed++, owner, pos: from.slice(), trail: [] })
    }

    get busy() {
        return this.gathers.size + this.casts.length + this.bursts.length + this.marks.length > 0
    }

    /** @param {number} dt seconds */
    tick(dt) {
        this.clock += dt
        for (const g of this.gathers.values()) g.t += dt
        const solid = (p) => this.noa.world.getBlockSolidity(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2]))
        for (let i = this.casts.length - 1; i >= 0; i--) {
            const k = this.casts[i]
            const t0 = k.t
            k.t += dt
            // substeps so it can't pass through a wall or a body
            const steps = Math.max(1, Math.ceil((C.speed * 1.6 * dt) / 0.25))
            let hit = null
            for (let s = 1; s <= steps && !hit; s++) {
                const t = Math.min(k.T, t0 + ((k.t - t0) * s) / steps)
                const prev = k.pos.slice()
                arcPoint(k.from, k.to, t / k.T, k.pos)
                k.trail.push(k.pos.slice())
                if (k.trail.length > 40) k.trail.shift()
                // past the staff (the first few cm), anything solid or any defender stops it
                if (t > 0.05 && (solid(k.pos) || this.hitUnit(k.pos))) hit = prev
                else if (t >= k.T) hit = k.pos.slice()
            }
            if (!hit) continue
            this.casts.splice(i, 1)
            this._detonate(hit, k)
        }
        for (let i = this.bursts.length - 1; i >= 0; i--) {
            const b = this.bursts[i]
            b.t += dt
            if (b.t > Math.max(C.shells[0].life, C.burstTongueLife + 0.2, C.shockLife)) this.bursts.splice(i, 1)
        }
        for (let i = this.marks.length - 1; i >= 0; i--) {
            const m = this.marks[i]
            m.t += dt
            if (m.t > C.scorchLife) this.marks.splice(i, 1)
        }
    }

    _detonate(pos, k) {
        // an airburst (against a body or a wall high up) has no ground to roll a ring over or scorch
        const ground = this._groundBelow(pos, 1.6)
        const airburst = ground === null
        const tongues = []
        for (let i = 0; i < C.burstTongues; i++) {
            tongues.push({ a: (i / C.burstTongues) * Math.PI * 2 + hash(k.seed, i) * 0.4, d: 0.6 + 0.4 * hash(i, k.seed), s: 0.7 + 0.6 * hash(k.seed + 1, i), lag: 0.08 * hash(i + 3, k.seed) })
        }
        this.bursts.push({ pos: pos.slice(), t: 0, seed: k.seed, airburst, tongues, ground })
        if (!airburst) {
            if (this.marks.length >= this.scorches.capacity) this.marks.shift()
            this.marks.push({ pos: pos.slice(), t: 0 })
        }
        // embers: thrown out and up, rising as they cool
        const fx = this.effects
        const n = Math.round(C.burstEmbers * this.particleScale)
        for (let i = 0; i < n && fx.particles.length < fx.pools.particle.capacity; i++) {
            const a = Math.random() * Math.PI * 2, u = Math.random()
            const v = C.emberSpeed * (1.5 + Math.random() * 2.1)
            fx.particles.push({
                pos: [pos[0], pos[1] + 0.35, pos[2]], vel: [Math.cos(a) * v * u, v * (0.3 + Math.random() * 0.8), Math.sin(a) * v * u],
                color: [1, 1, 1], ramp: EMBER, size: 0.07 + Math.random() * 0.1, life: C.emberLife * (0.6 + Math.random() * 0.6),
                age: 0, g: -C.emberRise * 0.4, grow: false, drag: 1.2,
            })
        }
        this.onImpact(pos, k.owner)
    }

    /** the top of the first solid block within `max` below a point (null: none) */
    _groundBelow(pos, max) {
        const x = Math.floor(pos[0]), z = Math.floor(pos[2])
        for (let y = Math.floor(pos[1]); y >= Math.floor(pos[1] - max); y--) {
            if (this.noa.world.getBlockSolidity(x, y, z)) return y + 1
        }
        return null
    }

    /** write the instance buffers (every frame) */
    render() {
        const clock = this.clock
        const L = this.lumps, T = this.tongues
        // ---- the ball gathering at the staff: a coal swelling, with flickers
        for (const g of this.gathers.values()) {
            const at = g.at()
            if (!at) continue
            const f = clamp(g.t / g.total, 0, 1)
            const r = C.radius * C.headMin * (0.25 + 0.75 * f) * (1 + 0.12 * Math.sin(clock * 23 + g.seed))
            this._lump(at, r, clock * C.spin + g.seed, gradient4(FLAME, 0.4 + 0.6 * f, col))
            this._lump(at, r * 0.55, -clock * C.spin, [0.35, 0.12, 0.05])
            if (Math.random() < 0.25 * this.particleScale) this._ember(at, 0.6)
        }
        // ---- in flight: the core, two shells swelling late, and the trail
        for (const k of this.casts) {
            const s = clamp(k.t / k.T, 0, 1)
            const charge = Math.pow(s, C.chargeCurve)
            const r = C.radius * (C.headMin + (C.headMax - C.headMin) * charge)
            // opaque shells can't nest (the outer one would hide the rest), so they're offset like the
            // burst's lumps: the flame round it, a hot cream lump poking out ahead, the coal showing behind
            const n = k.trail.length
            const back = n > 2 ? k.trail[n - 3] : k.from
            let dx = k.pos[0] - back[0], dy = k.pos[1] - back[1], dz = k.pos[2] - back[2]
            const dl = Math.hypot(dx, dy, dz) || 1
            dx /= dl
            dy /= dl
            dz /= dl
            this._lump(k.pos, r, -clock * C.spin + 2, gradient4(FLAME, 0.35 + 0.45 * charge, col))
            pt[0] = k.pos[0] + dx * r * 0.45
            pt[1] = k.pos[1] + dy * r * 0.45 + r * 0.2
            pt[2] = k.pos[2] + dz * r * 0.45
            this._lump(pt, r * 0.62, clock * C.spin * 1.3 + 1, gradient4(FLAME, 0.75 + 0.25 * charge, col))
            pt[0] = k.pos[0] - dx * r * 0.55
            pt[1] = k.pos[1] - dy * r * 0.55 - r * 0.15
            pt[2] = k.pos[2] - dz * r * 0.55
            this._lump(pt, C.radius * 0.75, clock * C.spin, [0.3, 0.1, 0.05])
            // tongues laid back along the arc, swelling toward the head
            const span = Math.max(1, Math.round((C.trailSpan / Math.max(0.5, C.speed)) * 60))
            const nodes = Math.min(C.trailNodes, k.trail.length)
            for (let i = 0; i < nodes; i++) {
                const j = k.trail.length - 1 - Math.floor((i / nodes) * Math.min(k.trail.length - 1, span))
                const p = k.trail[j]
                const u = 1 - i / nodes
                const flick = 1 + C.trailFlicker * Math.sin(clock * 31 + i * 1.7 + k.seed)
                const w = C.trailWidth * trailProfile(u) * flick * (0.6 + 0.4 * charge)
                Quaternion.RotationAxisToRef(AXIS, clock * 4 + i, tmpQ)
                Matrix.ComposeToRef(tmpS.set(w * 0.8, w * 1.5, w * 0.8), tmpQ, tmpP.set(p[0], p[1] + w * 0.2, p[2]), tmpM)
                T.put(tmpM, gradient4(FLAME, u * (0.5 + 0.5 * charge), col))
            }
        }
        // ---- bursts: the three lumps, the tongues thrown flat, the shock ring
        for (const b of this.bursts) {
            const lift = b.airburst ? 0 : C.burstSize * 0.28
            C.shells.forEach((spec, i) => {
                const r = shellAt(spec, b.t, col)
                if (r <= 0.01) return
                const o = spec.off
                pt[0] = b.pos[0] + o[0] * r
                pt[1] = b.pos[1] + lift + o[1] * r
                pt[2] = b.pos[2] + o[2] * r
                this._lump(pt, r, clock * spec.spin + i + b.seed, col)
            })
            if (!b.airburst) {
                for (const t of b.tongues) {
                    const f = clamp((b.t - t.lag) / C.burstTongueLife, 0, 1)
                    if (f <= 0 || f >= 1) continue
                    const reach = C.burstSize * C.burstTongueReach * t.d * (1 - Math.pow(1 - f, 2.2))
                    const size = C.burstSize * 0.34 * t.s * Math.sin(Math.PI * Math.min(1, f * 1.15))
                    if (size < 0.02) continue
                    Quaternion.RotationAxisToRef(Vector3.UpReadOnly, t.a, tmpQ)
                    Matrix.ComposeToRef(tmpS.set(size * 0.5, size * 1.5, size * 0.5), tmpQ,
                        tmpP.set(b.pos[0] + Math.cos(t.a) * reach, b.ground + size * 0.6, b.pos[2] + Math.sin(t.a) * reach), tmpM)
                    T.put(tmpM, gradient4(FLAME, 0.25 + 0.6 * (1 - f), col))
                }
                const f = clamp(b.t / C.shockLife, 0, 1)
                if (f < 1) {
                    const r = C.shockRadius * (1 - Math.pow(1 - f, 2))
                    const flat = 1 - f
                    Matrix.ComposeToRef(tmpS.set(r, Math.max(0.01, flat), r), ID, tmpP.set(b.pos[0], b.ground + 0.15, b.pos[2]), tmpM)
                    this.rings.put(tmpM, [1, 0.75 + 0.2 * f, 0.4 + 0.4 * f])
                }
            }
        }
        // ---- scorch marks, on the crater floor as it's dug, shrinking away at the end
        for (const m of this.marks) {
            const f = m.t / C.scorchLife
            const y = this._groundBelow([m.pos[0], m.pos[1] + 0.5, m.pos[2]], 4)
            if (y === null) continue
            const r = C.scorchRadius * (0.72 + 0.28 * smoothstep(0, 0.25, f)) * (1 - smoothstep(0.7, 1, f))
            Matrix.ComposeToRef(tmpS.set(r, 1, r), ID, tmpP.set(m.pos[0], y + 0.025, m.pos[2]), tmpM)
            this.scorches.put(tmpM, [0.2, 0.16, 0.14])
        }
        L.commit()
        T.commit()
        this.rings.commit()
        this.scorches.commit()
    }

    _lump(p, r, angle, color) {
        Quaternion.RotationAxisToRef(AXIS, angle, tmpQ)
        Matrix.ComposeToRef(tmpS.set(r, r, r), tmpQ, tmpP.set(p[0], p[1], p[2]), tmpM)
        this.lumps.put(tmpM, color)
    }

    /** one ember drifting up off a point */
    _ember(p, speed) {
        const fx = this.effects
        if (fx.particles.length >= fx.pools.particle.capacity) return
        fx.particles.push({
            pos: [p[0] + (Math.random() - 0.5) * 0.2, p[1], p[2] + (Math.random() - 0.5) * 0.2],
            vel: [(Math.random() - 0.5) * speed, speed * (0.5 + Math.random()), (Math.random() - 0.5) * speed],
            color: [1, 1, 1], ramp: EMBER, size: 0.06, life: 0.7, age: 0, g: -0.6, grow: false, drag: 1,
        })
    }
}
