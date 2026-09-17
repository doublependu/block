/*
 *  Builds the starter layout for worlds/default.world.json (used by
 *  tools/make-default-world.mjs). Pure data, reproducible.
 */

import { newWorldDef } from './worldFile.js'
import { createGenerator } from './gen/index.js'
import { blockId } from './blocks.js'

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
