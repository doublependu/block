/*
 *  The ice palace for the recording (plan 12 §6.2–6.4): ~6,000 blocks a player
 *  can build in order, two levels with high ceilings, a double curved
 *  staircase you can walk up, and openings an archer can shoot from.
 */

import { describe, it, expect } from 'vitest'
import { buildPalace, FLOOR, SPAWN, SEED, SIZE, L1, L2, L2_Y, EAVES, TREADS, HALL } from '../tools/autoplay/castle/palace.js'
import { BLOCK_BY_NAME, AIR, blockId } from '../src/world/blocks.js'
import { createGenerator } from '../src/world/gen/index.js'
import { ITEMS } from '../src/game/balance.js'
import { explore, canStand } from '../src/ai/localPath.js'

const gen = createGenerator(1, SEED, SIZE)
const ground = (x, z) => gen.surfaceY(x, z)
const palace = buildPalace({ groundAt: ground, blockAt: (x, y, z) => gen.blockAt(x, y, z) })
const key = (x, y, z) => `${x},${y},${z}`
const cellMap = new Map(palace.cells.map(([x, y, z, b]) => [key(x, y, z), blockId(b)]))
// a tower on the ground stands on its 2-block column
for (const t of palace.towers.filter((t) => t.ground)) {
    cellMap.set(key(t.x, t.y, t.z), blockId('cobble'))
    cellMap.set(key(t.x, t.y + 1, t.z), blockId('cobble'))
    cellMap.set(key(t.x, t.y + 2, t.z), blockId(t.block))
}
const dug = new Set(palace.dig.map(([x, y, z]) => key(x, y, z)))
/** the world once the palace is built: its blocks over the terrain, the dug cells open */
const world = (except = new Set()) => (x, y, z) => {
    const k = key(x, y, z)
    if (except.has(k)) return AIR
    if (cellMap.has(k)) return cellMap.get(k)
    if (dug.has(k)) return AIR
    return gen.blockAt(x, y, z)
}

describe('the ice palace', () => {
    it('is about twice iteration 10\'s castle: at least 6,000 blocks', () => {
        expect(palace.cells.length).toBeGreaterThanOrEqual(6000)
        expect(palace.cells.length).toBeLessThan(7000)
    })

    it('is made of blocks a player can hold and place, under the build height, inside the world', () => {
        for (const [x, y, z, b] of palace.cells) {
            expect(BLOCK_BY_NAME[b], b).toBeTruthy()
            expect(ITEMS[b]?.kind, b).toBe('block')
            expect(y).toBeLessThan(70)
            expect(Math.abs(x)).toBeLessThan(SIZE / 2 - 2)
            expect(Math.abs(z)).toBeLessThan(SIZE / 2 - 2)
        }
        for (const t of palace.towers) expect(BLOCK_BY_NAME[t.block].tower, t.block).toBeTruthy()
        expect(palace.top).toBeLessThan(70)
    })

    it('has both floors 12 clear: level 2\'s floor 13 up, the eaves 12 above it', () => {
        expect(L2_Y - FLOOR).toBe(12)
        expect(EAVES - (L2_Y + 1)).toBe(12)
        expect(L1).toBe(13)
        expect(L2).toBe(12)
        // the middle of the hall, in front of the crystal: open from the floor to the roof
        const get = world()
        for (let y = FLOOR + 5; y < EAVES; y++) expect(get(0, y, 4), `0,${y},4`).toBe(AIR)
    })

    it('keeps the Town Center, the spawn cell and the way out of the door open', () => {
        for (const [x, y, z] of palace.cells) {
            expect(Math.abs(x) <= 1 && Math.abs(z) <= 1 && y >= FLOOR && y <= FLOOR + 4, `${x},${y},${z} is on the Town Center`).toBe(false)
            expect(x === SPAWN[0] && z === SPAWN[2] && y >= FLOOR && y <= FLOOR + 2, `${x},${y},${z} is in the spawn cell`).toBe(false)
        }
        // from the spawn cell out through the hall's door (a gate: open to the player)
        const get = world()
        const r = explore(get, [SPAWN[0] + 0.5, SPAWN[1], SPAWN[2] + 0.5], [0, 0, 10], 10)
        expect(r).toBeTruthy()
        expect([...r.nodes.values()].some((n) => n.z > HALL.z1)).toBe(true)
    })

    it('can be built in its order: every block has a solid neighbour when its turn comes', () => {
        const placed = new Set()
        const solidAt = (x, y, z) => placed.has(key(x, y, z)) || (y < ground(x, z) && !dug.has(key(x, y, z)))
        const cannot = []
        for (const part of palace.parts) {
            const byY = new Map()
            for (const c of part.cells) {
                if (!byY.has(c[1])) byY.set(c[1], [])
                byY.get(c[1]).push(c)
            }
            for (const y of [...byY.keys()].sort((a, b) => a - b)) {
                let left = byY.get(y)
                for (let pass = 0; pass < 60 && left.length; pass++) {
                    const next = []
                    for (const c of left) {
                        const [x, cy, z] = c
                        const touch = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, d]) => solidAt(x + a, cy + b, z + d))
                        if (touch) {
                            // gates, spikes and icicles aren't solid: nothing is built against them
                            if (BLOCK_BY_NAME[c[3]].solid) placed.add(key(x, cy, z))
                        } else next.push(c)
                    }
                    if (next.length === left.length) break
                    left = next
                }
                for (const c of left) cannot.push(`${part.name}: ${c.join(',')}`)
            }
        }
        expect(cannot.slice(0, 10)).toEqual([])
    })
})

describe('the double curved staircase (plan 12 §6.3)', () => {
    it('two flights of 13 treads, each one block up from the last, from the floor to level 2', () => {
        for (const side of [1, -1]) {
            const flight = palace.treads.filter((t) => t.flight === side).sort((a, b) => a.i - b.i)
            expect(flight).toHaveLength(TREADS)
            flight.forEach((t, i) => {
                expect(t.cells.length, `tread ${t.i}`).toBeGreaterThanOrEqual(4)
                expect(t.y).toBe(FLOOR + i)
            })
            expect(flight[TREADS - 1].y + 1).toBe(L2_Y + 1)
        }
    })

    it('has at least three blocks of headroom over every tread, away from its rails', () => {
        const get = world()
        let blocked = []
        for (const t of palace.treads) {
            for (const [x, y, z] of t.cells) {
                const over = [1, 2, 3].map((dy) => get(x, y + dy, z))
                // a rail post or icicles stand on some edge cells: those are the edges, not the way up
                const rails = over.filter((id) => id === blockId('blue_ice') || id === blockId('ice_spikes')).length
                if (over.some((id) => id !== AIR) && !rails) blocked.push(`${x},${y},${z}`)
            }
        }
        expect(blocked).toEqual([])
    })

    it('can be walked up from the hall floor to level 2 by each flight alone', () => {
        for (const side of [1, -1]) {
            // the other flight taken away: this one has to make it on its own
            const other = new Set(palace.treads.filter((t) => t.flight !== side).flatMap((t) => t.cells.map(([x, y, z]) => key(x, y, z))))
            const get = world(other)
            let from = [SPAWN[0] + 0.5, FLOOR, SPAWN[2] + 0.5]
            let onLevel2 = false
            // the path search looks 8 up at a time: climb, then look again from the highest step reached
            for (let hop = 0; hop < 4 && !onLevel2; hop++) {
                const r = explore(get, from, [0, 0, 0], 14, 20000)
                expect(r, `hop ${hop}`).toBeTruthy()
                let best = null
                for (const n of r.nodes.values()) {
                    // standing on level 2's floor, out on its ring (not on a rail post)
                    if (n.y === L2_Y + 1 && (Math.abs(n.x) >= 9 || Math.abs(n.z) >= 7)) onLevel2 = true
                    if (n.y <= L2_Y + 1 && (!best || n.y > best.y)) best = n
                }
                from = [best.x + 0.5, best.y, best.z + 0.5]
            }
            expect(onLevel2, `flight ${side}`).toBe(true)
        }
    })
})

describe('the crystal\'s guard (the first run lost nights 1 and 3 without it)', () => {
    const guard = palace.towers.filter((t) => t.early)
    it('four arrow towers within 6 of the Town Center, on the hall floor, clear of every palace block', () => {
        expect(guard).toHaveLength(4)
        for (const t of guard) {
            expect(t.block).toBe('arrow_tower')
            expect(Math.hypot(t.x, t.z)).toBeLessThan(6)
            expect(t.y).toBe(FLOOR)
            for (let y = t.y; y <= t.y + 3; y++) expect(palace.cells.some(([x, cy, z]) => x === t.x && cy === y && z === t.z), `${t.x},${y},${t.z}`).toBe(false)
        }
    })
})

describe('the towers up high (out of a fire mage\'s reach)', () => {
    const high = palace.towers.filter((t) => !t.ground)
    it('every tower off the ground stands on a block of the palace, in a free cell', () => {
        const floating = high.filter((t) => !cellMap.has(key(t.x, t.y - 1, t.z)) || cellMap.has(key(t.x, t.y, t.z))).map((t) => t.spot)
        expect(floating).toEqual([])
    })
    it('two on each corner tower\'s balcony and two at the great spire\'s foot, all 14 or more above the hall floor', () => {
        const mageSafe = high.filter((t) => t.y - FLOOR >= 14)
        expect(mageSafe.filter((t) => /balcony/.test(t.spot))).toHaveLength(8)
        expect(mageSafe.filter((t) => /great spire/.test(t.spot))).toHaveLength(2)
    })
})

describe('archers at the openings (plan 12 §0.5, §6.4)', () => {
    const get = world()
    it('24 openings at level 2\'s floor: room to stand in, a floor under, a drop outside', () => {
        expect(palace.openings).toHaveLength(24)
        for (const o of palace.openings) {
            expect(canStand(get, o.x, o.y, o.z), `${o.x},${o.z}`).toBe(true)
            expect(get(o.x, o.y + 2, o.z), `${o.x},${o.z} 3 high`).toBe(AIR)
            // outside: nothing to stand on (the archer never walks out)
            expect(canStand(get, o.x + o.out[0], o.y, o.z + o.out[2])).toBe(false)
        }
    })

    it('an archer in an opening sees attackers 5 blocks out from the wall\'s foot', () => {
        const solid = (p) => BLOCK_BY_NAME_ID(get(Math.floor(p[0]), Math.floor(p[1]), Math.floor(p[2])))
        let blind = []
        for (const o of palace.openings) {
            const eye = [o.x + 0.5, o.y + 1.5, o.z + 0.5]
            const tx = o.x + 0.5 + o.out[0] * 6, tz = o.z + 0.5 + o.out[2] * 6
            const target = [tx, ground(Math.floor(tx), Math.floor(tz)) + 1, tz]
            const n = 60
            for (let i = 1; i < n - 3; i++) {
                const p = eye.map((v, k) => v + ((target[k] - v) * i) / n)
                if (solid(p)) {
                    blind.push(`${o.x},${o.z}`)
                    break
                }
            }
        }
        expect(blind).toEqual([])
    })

    it('places archers in most of them, and every defence the game has somewhere', () => {
        const archers = palace.troops.filter((t) => t.type === 'archer')
        expect(archers.length).toBeGreaterThanOrEqual(12)
        expect(archers.length).toBeLessThanOrEqual(16)
        const placed = new Set([...palace.cells.map((c) => c[3]), ...palace.towers.map((t) => t.block), ...palace.troops.map((t) => t.type)])
        for (const d of ['stone_wall', 'iron_wall', 'steel_wall', 'gate', 'iron_gate', 'steel_gate', 'spikes', 'iron_spikes', 'steel_spikes', 'ice_spikes',
            'arrow_tower', 'crossbow_tower', 'ballista_tower', 'cannon_tower', 'mortar_tower', 'bombard_tower', 'frost_tower',
            'snow_brick', 'blue_ice', 'ice', 'archer', 'swordsman', 'gunner']) expect(placed.has(d), d).toBe(true)
    })
})

function BLOCK_BY_NAME_ID(id) {
    if (id === AIR || id === undefined) return false
    const name = Object.values(BLOCK_BY_NAME).find((b) => b.id === id)
    return !!(name && name.solid)
}
