/*
 *  Walk / run cycle check, straight from a character GLB: poses the skinned
 *  mesh over the clip and measures the feet.
 *
 *    ground speed  how fast the stance foot moves back at speed ratio 1 (m/s):
 *                  play the clip at speed / groundSpeed to keep the feet planted
 *    slide         how uneven that is during stance (% of ground speed; 0 = perfectly planted)
 *    stance        share of the cycle each foot is on the ground
 *    clearance     lowest swing-foot height while it passes the other leg (m)
 *    toe pitch     foot angle at the moment it lands (+ = toe up)
 *    max step      largest bone rotation between frames 1/60 s apart (degrees)
 *    hips bob      hips vertical / forward travel (m)
 *
 *  Usage: node tools/anim-check.mjs [files...] [--clips=walk,run]  (default: public/models/*.glb)
 */

import { readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { readGlb, readAccessor, readIntAccessor, animationCurves } from './glb-info.mjs'
import { sampleCurve } from '../src/characters/animFix.js'
import { normaliseClipName } from '../src/characters/contract.js'

// ---- tiny column-major 4x4 math -------------------------------------------------

function fromTRS(t, r, s) {
    const [x, y, z, w] = r
    const x2 = x + x, y2 = y + y, z2 = z + z
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2
    const wx = w * x2, wy = w * y2, wz = w * z2
    return [
        (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
        (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
        (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
        t[0], t[1], t[2], 1,
    ]
}

function mul(a, b) {
    const o = new Array(16)
    for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
            o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
        }
    }
    return o
}

const point = (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
]

const quatAngle = (a, b) => {
    const d = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))
    return (2 * Math.acos(d) * 180) / Math.PI
}

// ---- model -----------------------------------------------------------------------

export function loadRig(file) {
    const glb = readGlb(file)
    const { json } = glb
    const nodes = json.nodes.map((n) => ({
        name: n.name,
        t: n.translation || [0, 0, 0],
        r: n.rotation || [0, 0, 0, 1],
        s: n.scale || [1, 1, 1],
        children: n.children || [],
        parent: -1,
    }))
    nodes.forEach((n, i) => n.children.forEach((c) => (nodes[c].parent = i)))
    const skin = json.skins[0]
    const ibm = readAccessor(glb, skin.inverseBindMatrices)
    const prim = json.meshes[0].primitives[0]
    const pos = readAccessor(glb, prim.attributes.POSITION)
    const joints = readIntAccessor(glb, prim.attributes.JOINTS_0)
    const weights = readAccessor(glb, prim.attributes.WEIGHTS_0)
    const jointOf = pos.map((_, v) => {
        let best = 0
        for (let k = 1; k < 4; k++) if (weights[v][k] > weights[v][best]) best = k
        return joints[v][best]
    })
    const clips = {}
    for (const c of animationCurves(glb)) {
        const name = normaliseClipName(c.clip)
        const clip = (clips[name] ||= { curves: [], length: 0 })
        const node = json.nodes.findIndex((n) => n.name === c.node)
        clip.curves.push({ node, path: c.path, keys: c.keys })
        clip.length = Math.max(clip.length, c.keys[c.keys.length - 1].t)
    }
    return { name: basename(file, '.glb'), nodes, skin, ibm, pos, jointOf, clips }
}

/** world matrix per node at time t of a clip */
function pose(rig, clip, t) {
    const local = rig.nodes.map((n) => ({ t: n.t, r: n.r, s: n.s }))
    for (const c of clip.curves) {
        const v = sampleCurve(c.keys, t)
        if (c.path === 'rotation') local[c.node].r = v
        else if (c.path === 'translation') local[c.node].t = v
        else if (c.path === 'scale') local[c.node].s = v
    }
    const world = new Array(rig.nodes.length)
    const get = (i) => {
        if (world[i]) return world[i]
        const m = fromTRS(local[i].t, local[i].r, local[i].s)
        world[i] = rig.nodes[i].parent >= 0 ? mul(get(rig.nodes[i].parent), m) : m
        return world[i]
    }
    rig.nodes.forEach((_, i) => get(i))
    return { world, local }
}

function footVerts(rig, bone) {
    const j = rig.skin.joints.findIndex((n) => rig.nodes[n].name === bone)
    return rig.pos.map((_, v) => v).filter((v) => rig.jointOf[v] === j)
}

function skinned(rig, world, v) {
    const j = rig.jointOf[v]
    const m = mul(world[rig.skin.joints[j]], rig.ibm[j])
    return point(m, rig.pos[v])
}

/**
 * @param {ReturnType<typeof loadRig>} rig
 * @param {string} clipName
 */
export function measureCycle(rig, clipName, samples = 240) {
    const clip = rig.clips[clipName]
    if (!clip) return null
    const feet = ['L', 'R'].map((side) => {
        const verts = footVerts(rig, `foot.${side}`)
        // heel and toe on the sole, from the rest pose (forward is +Z)
        const rest = verts.map((v) => rig.pos[v])
        const minY = Math.min(...rest.map((p) => p[1]))
        const sole = verts.filter((_, k) => rest[k][1] < minY + 0.01)
        const toe = sole.reduce((a, b) => (rig.pos[b][2] > rig.pos[a][2] ? b : a))
        const heel = sole.reduce((a, b) => (rig.pos[b][2] < rig.pos[a][2] ? b : a))
        return { side, verts, toe, heel, track: [] }
    })
    const hipsNode = rig.nodes.findIndex((n) => n.name === 'hips')
    const hips = []
    let maxStep = 0, maxStepBone = ''
    let prevLocal = null
    const dt = clip.length / samples
    for (let s = 0; s <= samples; s++) {
        const t = s * dt
        const { world, local } = pose(rig, clip, t)
        hips.push(point(world[hipsNode], [0, 0, 0]))
        for (const f of feet) {
            const pts = f.verts.map((v) => skinned(rig, world, v))
            const y = Math.min(...pts.map((p) => p[1]))
            const toe = skinned(rig, world, f.toe), heel = skinned(rig, world, f.heel)
            const pitch = (Math.atan2(toe[1] - heel[1], toe[2] - heel[2]) * 180) / Math.PI
            const z = (toe[2] + heel[2]) / 2
            f.track.push({ t, y, z, pitch, heelZ: heel[2], toeZ: toe[2] })
        }
        if (prevLocal) {
            // compare at 60 fps spacing
            const scale = (1 / 60) / dt
            for (const c of clip.curves) {
                if (c.path !== 'rotation') continue
                const step = quatAngle(local[c.node].r, prevLocal[c.node].r) * scale
                if (step > maxStep) {
                    maxStep = step
                    maxStepBone = rig.nodes[c.node].name
                }
            }
        }
        prevLocal = local
    }
    const ground = Math.min(...feet.flatMap((f) => f.track.map((p) => p.y)))
    const CONTACT = 0.01
    // stance: the point touching the ground (heel while the toe is up, toe while the heel is up,
    // any sole point when flat) should move back at one steady speed; compare it frame to frame
    // on the same point so rolling over heel or toe doesn't count as sliding
    const vel = []
    for (const f of feet) {
        for (let k = 3; k < f.track.length - 3; k++) {
            if (![-3, -2, -1, 0, 1, 2, 3].every((o) => f.track[k + o].y <= ground + CONTACT)) continue
            const a = f.track[k], b = f.track[k + 1]
            const key = a.pitch > 1 ? 'heelZ' : a.pitch < -1 ? 'toeZ' : 'z'
            vel.push(-(b[key] - a[key]) / dt)
        }
    }
    const groundSpeed = vel.length ? vel.reduce((a, v) => a + v, 0) / vel.length : 0
    const slide = vel.length && groundSpeed > 0 ? vel.reduce((a, v) => a + Math.abs(v - groundSpeed), 0) / vel.length / groundSpeed : 1
    const stance = feet.map((f) => f.track.filter((p) => p.y <= ground + CONTACT).length / f.track.length)
    // swing foot passing the stance leg
    let clearance = Infinity
    for (let s = 0; s < feet[0].track.length; s++) {
        for (const [a, b] of [[0, 1], [1, 0]]) {
            const sw = feet[a].track[s], st = feet[b].track[s]
            if (st.y <= ground + CONTACT && sw.y > ground + CONTACT / 2 && Math.abs(sw.z - st.z) < 0.12) clearance = Math.min(clearance, sw.y - ground)
        }
    }
    // toe pitch when a foot touches down
    const landing = []
    for (const f of feet) {
        for (let s = 1; s < f.track.length; s++) {
            if (f.track[s - 1].y > ground + CONTACT && f.track[s].y <= ground + CONTACT) landing.push(f.track[s].pitch)
        }
    }
    const hy = hips.map((p) => p[1]), hz = hips.map((p) => p[2])
    return {
        groundSpeed,
        slide,
        stance,
        clearance: isFinite(clearance) ? clearance : null,
        landingPitch: landing,
        maxStep,
        maxStepBone,
        hipsBob: Math.max(...hy) - Math.min(...hy),
        hipsSurge: Math.max(...hz) - Math.min(...hz),
        length: clip.length,
        tracks: feet.map((f) => f.track),
    }
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2)
    const clipsArg = args.find((a) => a.startsWith('--clips='))
    const clipNames = clipsArg ? clipsArg.slice(8).split(',') : ['walk', 'run']
    const dir = new URL('../public/models/', import.meta.url).pathname
    const files = args.filter((a) => !a.startsWith('--'))
    const list = files.length ? files : readdirSync(dir).filter((f) => f.endsWith('.glb') && f !== 'items.glb').map((f) => join(dir, f))
    const f2 = (x) => (x === null ? '  -  ' : x.toFixed(2))
    console.log('model               clip  length  ground m/s  slide  stance     clearance  landing pitch   max step          hips bob/surge')
    for (const file of list) {
        const rig = loadRig(file)
        for (const clip of clipNames) {
            const m = measureCycle(rig, clip)
            if (!m) continue
            console.log(
                `${rig.name.padEnd(19)} ${clip.padEnd(5)} ${m.length.toFixed(2)} s  ${f2(m.groundSpeed).padStart(6)}      ${(m.slide * 100).toFixed(0).padStart(3)}%  ` +
                `${m.stance.map((s) => (s * 100).toFixed(0) + '%').join('/').padEnd(9)}  ${f2(m.clearance).padStart(5)} m    ` +
                `${m.landingPitch.map((p) => p.toFixed(0) + '°').join(' ').padEnd(14)}  ${m.maxStep.toFixed(1).padStart(5)}° ${m.maxStepBone.padEnd(11)} ` +
                `${f2(m.hipsBob)}/${f2(m.hipsSurge)} m`,
            )
        }
    }
}
