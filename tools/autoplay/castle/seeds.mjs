/*
 *  Finds a seed for the castle recording (plan 10 §3.3): a plaza high on a
 *  rock, the land falling away around it like the photo's crag, nothing taller
 *  close by, dry ground for the castle, trees for planks within reach, and
 *  water in the view (the photo has a lake behind the castle).
 *
 *  The Town Center always stands at (0, plaza + 1, 0), and the plaza is always
 *  at height 7: terrain_v1's noise is zero at the origin, so rawHeight(0, 0) is
 *  7 for every seed, and the land 30–50 out is never more than 3 below it (4000
 *  seeds). No seed has a crag, so the castle brings its own rock (a stone base
 *  course, see blueprint.js), and what's rated here is the site: a flat
 *  footprint, nothing looming over the castle, water and hills in the view, and
 *  trees in reach.
 *
 *  Usage: node tools/autoplay/castle/seeds.mjs [--count=4000] [--prefix=swan-rock] [--size=192] [--top=8]
 *
 *  --frost (plan 12 §6.1, the ice palace): rates a Large world instead for
 *  snowy peaks filling one side of the view 60–120 out (the cliff behind the
 *  palace in ref/castle_2.png), a flat dry footprint 28 round the plaza (the
 *  curtain stands at 26), nothing looming just outside it, and trees and sand
 *  within reach. Snow lies only above height 36 (terrain_v1), so the frost is
 *  in the backdrop, not under the palace.
 *    node tools/autoplay/castle/seeds.mjs --frost --size=256 --prefix=ice-palace
 */

import { createGenerator, LATEST_GENERATOR } from '../../../src/world/gen/index.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const count = Number(args.count || 4000)
const prefix = String(args.prefix || 'swan-rock')
const size = Number(args.size || 192)
const top = Number(args.top || 8)

/** the castle's footprint: the plaza plus this much around it must be dry, buildable land */
const FOOTPRINT = 26

/** @returns {null | {seed: string, score: number, plaza: number, drop: number, loom: number, flat: number, water: number, hills: number, trees: number, dryMin: number}} */
function rate(seed) {
    const g = createGenerator(LATEST_GENERATOR, seed, size)
    const P = g.plazaHeight + 1
    // the drop: the plaza over the land 30–50 out (the median, all the way round)
    const ring = []
    for (let a = 0; a < 48; a++) {
        const ang = (a / 48) * Math.PI * 2
        for (const r of [30, 38, 46]) ring.push(g.surfaceY(Math.round(Math.sin(ang) * r), Math.round(Math.cos(ang) * r)))
    }
    ring.sort((a, b) => a - b)
    const drop = P - ring[Math.floor(ring.length / 2)]
    // nothing taller than the castle's walls right next to it, and dry land under the whole castle
    let loom = -Infinity, dryMin = Infinity, dryMax = -Infinity, water = 0, trees = 0, hills = 0
    for (let x = -70; x <= 70; x += 2) {
        for (let z = -70; z <= 70; z += 2) {
            const d = Math.hypot(x, z)
            const s = g.surfaceY(x, z)
            if (d <= FOOTPRINT) {
                dryMin = Math.min(dryMin, s)
                dryMax = Math.max(dryMax, s)
            } else if (d <= 50) loom = Math.max(loom, s - P)
            if (d > 35 && d < 80 && s <= 1) water++
            // hills in the distance make the backdrop (the photo's Alps)
            if (d > 55 && s - P > 10) hills++
        }
    }
    for (let x = -46; x <= 46; x += 1) {
        for (let z = -46; z <= 46; z += 1) {
            const d = Math.hypot(x, z)
            if (d < 30 || d > 46) continue
            const s = g.surfaceY(x, z)
            if (g.blockAt(x, s, z) === 8 /* log */) trees++
        }
    }
    // no sea or beach under the castle
    if (dryMin <= 3) return null
    const flat = dryMax - dryMin
    const score = Math.min(drop, 3) * 2 - Math.max(0, loom - 8) - flat * 1.5 + Math.min(water, 150) / 15 + Math.min(trees, 40) / 8 + Math.min(hills, 80) / 20
    return { seed, score: +score.toFixed(2), plaza: P, drop, loom, flat, water, hills, trees, dryMin }
}

/** the ice palace's site (--frost): see the header */
const FROST_FOOTPRINT = 28
function rateFrost(seed) {
    const g = createGenerator(LATEST_GENERATOR, seed, size)
    const P = g.plazaHeight + 1
    const half = size / 2
    // snow in each of eight directions, 60–120 out (inside the world)
    const sectors = Array(8).fill(0), peak = Array(8).fill(0)
    for (let x = -120; x <= 120; x += 2) {
        for (let z = -120; z <= 120; z += 2) {
            const d = Math.hypot(x, z)
            if (d < 60 || d > 120 || Math.abs(x) >= half - 2 || Math.abs(z) >= half - 2) continue
            const s = g.surfaceY(x, z)
            const i = (Math.round(Math.atan2(x, z) / (Math.PI / 4)) + 8) % 8
            if (s > 36) sectors[i]++
            peak[i] = Math.max(peak[i], s)
        }
    }
    const best = sectors.indexOf(Math.max(...sectors))
    let dryMin = Infinity, dryMax = -Infinity, loom = -Infinity, trees = 0, sand = 0
    for (let x = -80; x <= 80; x++) {
        for (let z = -80; z <= 80; z++) {
            const d = Math.hypot(x, z)
            const step = d <= FROST_FOOTPRINT + 21 || (x % 2 === 0 && z % 2 === 0)
            if (!step) continue
            const s = g.surfaceY(x, z)
            if (d <= FROST_FOOTPRINT) {
                dryMin = Math.min(dryMin, s)
                dryMax = Math.max(dryMax, s)
            } else if (d <= FROST_FOOTPRINT + 20) loom = Math.max(loom, s - P)
            if (d > 30 && d < 75) {
                const b = g.blockAt(x, s, z)
                if (b === 8 /* log */) trees++
                if (g.blockAt(x, s - 1, z) === 5 /* sand */) sand++
            }
        }
    }
    if (dryMin <= 3) return null
    const flat = dryMax - dryMin
    const snow = sectors[best]
    const score = Math.min(snow, 400) / 40 - flat * 1.5 - Math.max(0, loom - 10) + Math.min(trees, 40) / 8 + Math.min(sand, 30) / 15
    return { seed, score: +score.toFixed(2), plaza: P, snow, side: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][best], peak: peak[best], flat, loom, trees, sand }
}

const rated = []
const t0 = Date.now()
for (let i = 0; i < count; i++) {
    const r = (args.frost ? rateFrost : rate)(`${prefix}-${i}`)
    if (r) rated.push(r)
}
rated.sort((a, b) => b.score - a.score)
console.log(`${count} seeds in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${rated.length} with dry land under the castle`)
const col = (v, n) => String(v).padStart(n)
if (args.frost) {
    console.log('seed                     score  plaza  snow  side         peak  flat  loom  trees  sand')
    for (const r of rated.slice(0, top)) {
        console.log(`${r.seed.padEnd(24)} ${col(r.score, 6)} ${col(r.plaza, 6)} ${col(r.snow, 5)}  ${r.side.padEnd(11)} ${col(r.peak, 5)} ${col(r.flat, 5)} ${col(r.loom, 5)} ${col(r.trees, 6)} ${col(r.sand, 5)}`)
    }
} else {
    console.log('seed                 score  plaza  drop  loom  flat  water  hills  trees')
    for (const r of rated.slice(0, top)) {
        console.log(`${r.seed.padEnd(20)} ${col(r.score, 6)} ${col(r.plaza, 6)} ${col(r.drop, 5)} ${col(r.loom, 5)} ${col(r.flat, 5)} ${col(r.water, 6)} ${col(r.hills, 6)} ${col(r.trees, 6)}`)
    }
}
