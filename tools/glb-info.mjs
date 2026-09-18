// Print a GLB's structure: nodes, animations, accessor byte usage.
// Also exports small GLB helpers (accessors, animation curves) for the other tools.
import { readFileSync, writeFileSync } from 'node:fs'

export function readGlb(path) {
    const buf = readFileSync(path)
    const jsonLen = buf.readUInt32LE(12)
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
    // BIN chunk follows the (padded) JSON chunk
    const binStart = 20 + jsonLen + 8
    return { buf, json, binStart, path }
}

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

/** float accessor as rows of numbers */
export function readAccessor(glb, index) {
    const a = glb.json.accessors[index]
    if (a.componentType !== 5126) throw new Error(`accessor ${index} is not float`)
    const bv = glb.json.bufferViews[a.bufferView]
    const n = COMPONENTS[a.type]
    const stride = bv.byteStride || n * 4
    const base = glb.binStart + (bv.byteOffset || 0) + (a.byteOffset || 0)
    const rows = []
    for (let k = 0; k < a.count; k++) {
        const row = []
        for (let c = 0; c < n; c++) row.push(glb.buf.readFloatLE(base + k * stride + c * 4))
        rows.push(row)
    }
    return rows
}

export function writeAccessor(glb, index, rows) {
    const a = glb.json.accessors[index]
    const bv = glb.json.bufferViews[a.bufferView]
    const n = COMPONENTS[a.type]
    const stride = bv.byteStride || n * 4
    const base = glb.binStart + (bv.byteOffset || 0) + (a.byteOffset || 0)
    rows.forEach((row, k) => row.forEach((v, c) => glb.buf.writeFloatLE(v, base + k * stride + c * 4)))
}

/** unsigned int accessor (joints, indices) as rows */
export function readIntAccessor(glb, index) {
    const a = glb.json.accessors[index]
    const bv = glb.json.bufferViews[a.bufferView]
    const n = COMPONENTS[a.type]
    const size = { 5121: 1, 5123: 2, 5125: 4 }[a.componentType]
    const stride = bv.byteStride || n * size
    const base = glb.binStart + (bv.byteOffset || 0) + (a.byteOffset || 0)
    const read = { 1: (o) => glb.buf.readUInt8(o), 2: (o) => glb.buf.readUInt16LE(o), 4: (o) => glb.buf.readUInt32LE(o) }[size]
    const rows = []
    for (let k = 0; k < a.count; k++) {
        const row = []
        for (let c = 0; c < n; c++) row.push(read(base + k * stride + c * size))
        rows.push(row)
    }
    return rows
}

/**
 * Every animation channel as curve keys ({t, v, i?, o?}, see src/characters/animFix.js).
 * `save(keys)` writes changed values back into the GLB buffer (same sizes).
 */
export function animationCurves(glb) {
    const out = []
    for (const anim of glb.json.animations || []) {
        for (const ch of anim.channels) {
            const s = anim.samplers[ch.sampler]
            const times = readAccessor(glb, s.input).map((r) => r[0])
            const rows = readAccessor(glb, s.output)
            const cubic = s.interpolation === 'CUBICSPLINE'
            const keys = times.map((t, k) => cubic ? { t, i: rows[k * 3], v: rows[k * 3 + 1], o: rows[k * 3 + 2] } : { t, v: rows[k] })
            out.push({
                clip: anim.name,
                node: glb.json.nodes[ch.target.node].name,
                path: ch.target.path,
                interpolation: s.interpolation,
                output: s.output,
                keys,
                save(changed) {
                    writeAccessor(glb, s.output, cubic ? changed.flatMap((k) => [k.i, k.v, k.o]) : changed.map((k) => k.v))
                },
            })
        }
    }
    return out
}

export function writeGlb(glb, path = glb.path) {
    writeFileSync(path, glb.buf)
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { buf, json } = readGlb(process.argv[2])
    const bv = json.bufferViews
    const acc = json.accessors
    const bytesOf = (i) => bv[acc[i].bufferView].byteLength
    let anim = 0, mesh = 0, img = 0
    for (const a of json.animations || []) for (const s of a.samplers) anim += bytesOf(s.input) + bytesOf(s.output)
    for (const m of json.meshes || []) for (const p of m.primitives) for (const k of Object.values(p.attributes)) mesh += bytesOf(k)
    for (const im of json.images || []) img += bv[im.bufferView].byteLength
    console.log({ total: buf.length, anim, mesh, img, nodes: json.nodes.length, animations: (json.animations || []).map((a) => `${a.name}(${a.channels.length})`).join(' ') })
    console.log('joints:', json.skins?.[0]?.joints.map((j) => json.nodes[j].name).join(', '))
}
