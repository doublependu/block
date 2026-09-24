/*
 *  Towns for the difficulty map (tools/autoplay/map.mjs) that aren't saved
 *  from a game:
 *    t2-mixed  the tower town (t1-towers, saved from a bot game on day 4) with
 *              the same number of towers and troops, but every third arrow tower
 *              (round the ring) a cannon tower and three archers gunners: does
 *              answering brutes pay?
 *    t6-tier2  t1-towers' tower value (27 × 14 = 378) spent on crossbow towers instead:
 *              17 of them, spread evenly round the ring (the other spots keep their column)
 *    t7-tier3  the same value spent on ballistas: 11 of them
 *
 *  t6 and t7 cost the wave the same as t1, so the map shows what a tier is
 *  worth per point of defence value: the rule the tiers were designed on.
 *
 *  Usage: node tools/autoplay/make-towns.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parseWorld, serializeWorld } from '../../src/world/worldFile.js'
import { townFile } from './lab.mjs'
import { TOWERS } from '../../src/game/balance.js'

const t1 = parseWorld(readFileSync(townFile('t1-towers'), 'utf8'))
const tc = t1.townCenter
const angle = (e) => Math.atan2(e[0] - tc[0], e[2] - tc[2])
const towers = t1.edits.filter((e) => e[3] === 'arrow_tower').sort((a, b) => angle(a) - angle(b))
const swap = new Set(towers.filter((_, i) => i % 3 === 1))
const edits = t1.edits.map((e) => (swap.has(e) ? [e[0], e[1], e[2], 'cannon_tower'] : e))
let archers = 0
const units = t1.units.map((u) => (u.type === 'archer' && archers++ < 3 ? { ...u, type: 'gunner' } : u))
const t2 = { ...t1, name: 'Mixed town (day 4)', description: 't1-towers with every third arrow tower a cannon tower and three archers gunners', edits, units }
writeFileSync(townFile('t2-mixed'), serializeWorld(t2))
console.log(`t2-mixed: ${swap.size} of ${towers.length} arrow towers are cannons, ${Math.min(3, archers)} archers are gunners`)

/** t1 with its arrow towers swapped for as many of `tower` as the same value buys, spread evenly */
function sameValue(name, tower, label) {
    const value = towers.length * TOWERS.arrow.value
    const n = Math.floor(value / TOWERS[tower.replace('_tower', '')].value)
    const keep = new Set(Array.from({ length: n }, (_, i) => towers[Math.floor((i * towers.length) / n)]))
    const edits = t1.edits.map((e) => (e[3] !== 'arrow_tower' ? e : keep.has(e) ? [e[0], e[1], e[2], tower] : [e[0], e[1], e[2], 'air']))
    writeFileSync(townFile(name), serializeWorld({ ...t1, name: label, description: `t1-towers' ${value} tower value as ${n} ${tower.replace(/_/g, ' ')}s`, edits }))
    console.log(`${name}: ${n} ${tower} for ${n * TOWERS[tower.replace('_tower', '')].value} of t1's ${value}`)
}
sameValue('t6-tier2', 'crossbow_tower', 'Tier II town (day 4 value)')
sameValue('t7-tier3', 'ballista_tower', 'Tier III town (day 4 value)')
