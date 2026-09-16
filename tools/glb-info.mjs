// Print a GLB's structure: nodes, animations, accessor byte usage.
import { readFileSync } from 'node:fs'

export function readGlb(path) {
    const buf = readFileSync(path)
    const jsonLen = buf.readUInt32LE(12)
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'))
    return { buf, json }
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
