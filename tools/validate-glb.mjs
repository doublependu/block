/*
 *  Validate character GLBs against glTF 2.0 (Khronos validator) and the
 *  game's character contract (docs/character-contract.md).
 *
 *  Usage: node tools/validate-glb.mjs [files...]   (default: public/models/*.glb)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import validator from 'gltf-validator'
import { readGlb, animationCurves } from './glb-info.mjs'
import { CLIPS, normaliseClipName } from '../src/characters/contract.js'
import { countQuaternionFlips } from '../src/characters/animFix.js'

const REQUIRED_BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'upper_arm.L', 'lower_arm.L', 'hand.L', 'upper_arm.R', 'lower_arm.R', 'hand.R', 'upper_leg.L', 'lower_leg.L', 'foot.L', 'upper_leg.R', 'lower_leg.R', 'foot.R']
const MAX_BYTES = 150 * 1024
const MAX_TRIS = 3000
const MAX_TEX = 256

const dir = new URL('../public/models/', import.meta.url).pathname
const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.glb')).map((f) => join(dir, f))

let failures = 0
for (const file of files) {
    const bytes = readFileSync(file)
    const problems = []
    const warnings = []
    const report = await validator.validateBytes(new Uint8Array(bytes), { maxIssues: 50 })
    for (const m of report.issues.messages) {
        if (m.severity === 0) problems.push(`glTF: ${m.code} ${m.message} (${m.pointer || ''})`)
    }
    const glb = readGlb(file)
    const { json } = glb
    const isItems = basename(file) === 'items.glb'
    if (statSync(file).size > MAX_BYTES) problems.push(`file is ${(statSync(file).size / 1024).toFixed(0)} KB (max ${MAX_BYTES / 1024} KB)`)
    if (!isItems) {
        const skin = json.skins && json.skins[0]
        const bones = skin ? skin.joints.map((j) => json.nodes[j].name) : []
        const missing = REQUIRED_BONES.filter((b) => !bones.includes(b))
        if (missing.length) problems.push(`missing bones: ${missing.join(', ')}`)
        if (!bones.includes('hand.R_socket')) warnings.push('no hand.R_socket: held items will not be shown')
        const clips = (json.animations || []).map((a) => normaliseClipName(a.name))
        if (!clips.includes('idle')) problems.push('missing required clip "idle"')
        const unknown = clips.filter((c) => !CLIPS.includes(c))
        if (unknown.length) warnings.push(`unknown clips (ignored): ${unknown.join(', ')}`)
        const absent = CLIPS.filter((c) => !clips.includes(c))
        if (absent.length) warnings.push(`clips using fallbacks: ${absent.join(', ')}`)
        let tris = 0
        for (const mesh of json.meshes || []) {
            for (const p of mesh.primitives) {
                const count = p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count
                tris += count / 3
            }
        }
        if (tris > MAX_TRIS) problems.push(`${tris} triangles (max ${MAX_TRIS})`)
        // q and -q between neighbouring keys: the limb flicks through a wrong arc (tools/fix-glb-animations.mjs)
        const flipped = animationCurves(glb).filter((c) => c.path === 'rotation' && countQuaternionFlips(c.keys.map((k) => k.v)) > 0)
        if (flipped.length) problems.push(`${flipped.length} rotation curves flip quaternion sign between keys (${[...new Set(flipped.map((c) => c.clip))].join(', ')}): run node tools/fix-glb-animations.mjs`)
    }
    for (const info of report.info.resources || []) {
        if (info.image && (info.image.width > MAX_TEX || info.image.height > MAX_TEX)) {
            problems.push(`texture ${info.image.width}x${info.image.height} (max ${MAX_TEX})`)
        }
    }
    const name = basename(file)
    if (problems.length) {
        failures++
        console.log(`✗ ${name}`)
        for (const p of problems) console.log(`    ${p}`)
    } else {
        console.log(`✓ ${name} (${(statSync(file).size / 1024).toFixed(0)} KB, ${report.info.animationCount} clips)`)
    }
    for (const w of warnings) console.log(`    note: ${w}`)
}
process.exit(failures ? 1 : 0)
