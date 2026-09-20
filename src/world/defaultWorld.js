/*
 *  Builds the starter layout for worlds/default.world.json (used by
 *  tools/make-default-world.mjs). Pure data, reproducible.
 */

import { newWorldDef } from './worldFile.js'
import { createGenerator } from './gen/index.js'
import { blockId } from './blocks.js'

/** trees near the town (offsets from the town center, north-east) */
const GROVE = [[18, 21], [21, 17], [22, 23], [25, 19], [19, 26], [26, 25], [23, 29], [29, 21]]
/** the stone outcrop's middle (north-west, where the ground is only a little above the plaza), and its ore: [dx, height, dz] */
const OUTCROP = [-19, 19]
const ORE = [[1, 1, -1], [-1, 2, 0], [0, 1, 1]]
/**
 * Gold at the outcrop's base. Tier III of every defence costs gold, and gold
 * otherwise only comes from surviving a night or from deep mining: these three
 * are what make a second tier reachable in the first few days without a grind.
 */
const GOLD = [[2, 0, 0], [-2, 0, 1], [0, 0, -2]]

export function buildDefaultWorld() {
    const def = newWorldDef({ seed: 'default-valley', name: 'Default Valley', size: 192, mode: 'survival', skirmish: false })
    def.description = 'A green valley with a small walled town. The starter world behind "Play".'
    const gen = createGenerator(def.generator.version, def.seed, def.size)
    const [tx, ty, tz] = def.townCenter
    const edits = new Map()
    const set = (x, y, z, b) => {
        if (gen.blockAt(x, y, z) === blockId(b)) return
        edits.set(`${x},${y},${z}`, [x, y, z, b])
    }
    const clearAbove = (x, z, from) => {
        for (let y = from; y < gen.surfaceY(x, z) + 10; y++) set(x, y, z, 'air')
    }
    // a low stone wall ring (radius ~13) with four gates, on the plaza level
    const R = 13
    for (let x = -R; x <= R; x++) {
        for (let z = -R; z <= R; z++) {
            const onRing = (Math.abs(x) === R && Math.abs(z) <= R) || (Math.abs(z) === R && Math.abs(x) <= R)
            if (!onRing) continue
            const gate = (x === 0 || z === 0) || (Math.abs(x) === 1 && Math.abs(z) === R) || (Math.abs(z) === 1 && Math.abs(x) === R)
            // clear anything above the wall base, fill below with stone (natural ground, not part of the wall)
            clearAbove(tx + x, tz + z, ty)
            const base = gen.surfaceY(tx + x, tz + z)
            for (let y = base; y < ty; y++) set(tx + x, y, tz + z, 'stone')
            for (let y = ty; y < ty + 2; y++) set(tx + x, y, tz + z, gate ? 'gate' : 'stone_wall')
        }
    }
    // a dry ditch outside the wall wherever the hills are higher than the plaza, so the wall
    // stands 2 blocks above the ground in front of it everywhere (attackers can't step onto it)
    for (let x = -R - 2; x <= R + 2; x++) {
        for (let z = -R - 2; z <= R + 2; z++) {
            if (Math.max(Math.abs(x), Math.abs(z)) <= R) continue
            if (gen.surfaceY(tx + x, tz + z) > ty) clearAbove(tx + x, tz + z, ty)
        }
    }
    // steps up onto the wall walk: a cobble block inside the wall, 3 blocks either side of each gate
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        for (const side of [3, -3]) {
            // along the wall (the tangent) by `side`, one block in from it
            const x = tx + nx * (R - 1) + Math.abs(nz) * side, z = tz + nz * (R - 1) + Math.abs(nx) * side
            set(x, ty, z, 'cobble')
        }
    }
    // wood and stone near the town, on the diagonals (clear of the gate lanes and the ditch):
    // a grove to the north-east, a stone outcrop with some iron ore to the north-west
    const placed = (x, y, z) => edits.get(`${x},${y},${z}`)?.[3]
    const setIfAir = (x, y, z, b) => {
        if (gen.blockAt(x, y, z) === 0 && !placed(x, y, z)) set(x, y, z, b)
    }
    for (const [dx, dz] of GROVE) {
        const x = tx + dx, z = tz + dz
        const y = gen.surfaceY(x, z)
        if (gen.blockAt(x, y - 1, z) !== blockId('grass')) continue
        const trunk = 5
        for (let i = 0; i < trunk; i++) set(x, y + i, z, 'log')
        const leafY = y + trunk - 2
        for (let dy = 0; dy <= 3; dy++) {
            const r = dy === 3 ? 1 : 2
            for (let lx = -r; lx <= r; lx++) {
                for (let lz = -r; lz <= r; lz++) {
                    if (r === 2 && Math.abs(lx) === 2 && Math.abs(lz) === 2) continue
                    setIfAir(x + lx, leafY + dy, z + lz, 'leaves')
                }
            }
        }
    }
    const [ox, oz] = OUTCROP
    for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
            // a mound: 1 high at the corners, 4 in the middle
            const h = 4 - Math.max(Math.abs(dx), Math.abs(dz)) - (Math.abs(dx) === 2 && Math.abs(dz) === 2 ? 1 : 0)
            const x = tx + ox + dx, z = tz + oz + dz
            const y = gen.surfaceY(x, z)
            for (let i = 0; i < h; i++) {
                const ore = ORE.some(([a, b, c]) => a === dx && b === i && c === dz) ? 'iron_ore'
                    : GOLD.some(([a, b, c]) => a === dx && b === i && c === dz) ? 'gold_ore' : 'stone'
                set(x, y + i, z, ore)
            }
        }
    }
    // four arrow towers at the corners, on 2-high cobble columns
    for (const [cx, cz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
        set(tx + cx, ty, tz + cz, 'cobble')
        set(tx + cx, ty + 1, tz + cz, 'cobble')
        set(tx + cx, ty + 2, tz + cz, 'arrow_tower')
    }
    def.edits = [...edits.values()]
    def.units = [
        { id: 'u-start-1', type: 'swordsman', pos: [tx + 0.5, ty, tz + 9.5], yaw: 0 },
        { id: 'u-start-2', type: 'swordsman', pos: [tx + 0.5, ty, tz - 8.5], yaw: 180 },
        { id: 'u-start-3', type: 'archer', pos: [tx + 9.5, ty, tz + 0.5], yaw: 90 },
        { id: 'u-start-4', type: 'archer', pos: [tx - 8.5, ty, tz + 0.5], yaw: -90 },
    ]
    def.player = { pos: null, inventory: { planks: 12, cobble: 12, log: 4, wood_sword: 1 } }
    return def
}
