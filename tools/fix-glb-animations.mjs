/*
 *  Post-export fix for character GLBs (run by `npm run characters` after Blender):
 *    - rotation keys aligned to one quaternion hemisphere (no limb flicks, see
 *      src/characters/animFix.js), tangents recomputed where keys were flipped
 *    - looping clips re-tangented throughout: no hitch at the seam, and no
 *      limb leaving its path between keys (which sinks a planted foot)
 *
 *  Usage: node tools/fix-glb-animations.mjs [files...]   (default: public/models/*.glb)
 */

import { readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { readGlb, animationCurves, writeGlb } from './glb-info.mjs'
import { alignQuaternionKeys, retangentLoop } from '../src/characters/animFix.js'
import { BASE_CLIPS, normaliseClipName } from '../src/characters/contract.js'

const dir = new URL('../public/models/', import.meta.url).pathname
const files = process.argv.length > 2 ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith('.glb')).map((f) => join(dir, f))

for (const file of files) {
    const glb = readGlb(file)
    let flips = 0, curves = 0, loops = 0
    const saved = new Set()
    for (const c of animationCurves(glb)) {
        if (saved.has(c.output)) continue
        let changed = false
        if (c.path === 'rotation') {
            const n = alignQuaternionKeys(c.keys)
            if (n) {
                flips += n
                curves++
                changed = true
            }
        }
        if (c.interpolation === 'CUBICSPLINE' && BASE_CLIPS.has(normaliseClipName(c.clip)) && retangentLoop(c.keys)) {
            loops++
            changed = true
        }
        if (changed) {
            c.save(c.keys)
            saved.add(c.output)
        }
    }
    writeGlb(glb)
    console.log(`${basename(file)}: ${flips} flipped rotation keys in ${curves} curves, ${loops} looping curves re-tangented`)
}
