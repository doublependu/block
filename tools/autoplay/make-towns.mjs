/*
 *  Towns for the difficulty map (tools/autoplay/map.mjs) that aren't saved
 *  from a game:
 *    t2-mixed  the tower town (t1-towers, saved from a bot game on day 4) with
 *              the same number of towers and troops, but every third arrow tower
 *              (round the ring) a cannon tower and three archers gunners: does
 *              answering brutes pay?
 *
 *  Usage: node tools/autoplay/make-towns.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { parseWorld, serializeWorld } from '../../src/world/worldFile.js'
import { townFile } from './lab.mjs'

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
