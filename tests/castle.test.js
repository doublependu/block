/*
 *  The castle for the recording (plan 10 §3.4–3.6): a design a player can
 *  actually build, and the bot's planning maths.
 */

import { describe, it, expect } from 'vitest'
import { buildCastle, SPAWN, FLOOR, SEED } from '../tools/autoplay/castle/blueprint.js'
import { hallCells, rawNeeds, rawCost, HALL } from '../tools/autoplay/bot/castle.js'
import { BLOCK_BY_NAME, ITEMS } from '../src/world/blocks.js'
import { createGenerator } from '../src/world/gen/index.js'
import { ITEMS as ITEM_KINDS, RECIPES } from '../src/game/balance.js'

const gen = createGenerator(1, SEED, 192)
const ground = (x, z) => gen.surfaceY(x, z)
const castle = buildCastle({ groundAt: ground })
const key = (x, y, z) => `${x},${y},${z}`

describe('the castle blueprint', () => {
    it('keeps the Town Center and the spawn cell open', () => {
        for (const [x, y, z] of castle.cells) {
            expect(Math.abs(x) <= 1 && Math.abs(z) <= 1 && y >= FLOOR && y <= FLOOR + 4, `${x},${y},${z} is on the Town Center`).toBe(false)
            expect(x === SPAWN[0] && z === SPAWN[2] && y >= FLOOR && y <= FLOOR + 2, `${x},${y},${z} is in the spawn cell`).toBe(false)
        }
    })
    it('is made of blocks a player can hold and place', () => {
        for (const [, , , b] of castle.cells) {
            expect(BLOCK_BY_NAME[b], b).toBeTruthy()
            expect(ITEM_KINDS[b]?.kind, b).toBe('block')
        }
        for (const t of castle.towers) expect(BLOCK_BY_NAME[t.block].tower).toBeTruthy()
    })
    it('fits under the build height and inside the world', () => {
        for (const [x, y, z] of castle.cells) {
            expect(y).toBeLessThan(70)
            expect(Math.abs(x)).toBeLessThan(90)
            expect(Math.abs(z)).toBeLessThan(90)
        }
    })
    it('can be built in its order: every block has a solid neighbour when its turn comes', () => {
        // the world as it stands: the terrain, and what's been built so far
        const placed = new Set()
        const solidAt = (x, y, z) => placed.has(key(x, y, z)) || y < ground(x, z)
        const cannot = []
        for (const part of castle.parts) {
            const byY = new Map()
            for (const c of part.cells) {
                if (!byY.has(c[1])) byY.set(c[1], [])
                byY.get(c[1]).push(c)
            }
            for (const y of [...byY.keys()].sort((a, b) => a - b)) {
                let left = byY.get(y)
                // a layer goes down from what it touches outward
                for (let pass = 0; pass < 50 && left.length; pass++) {
                    const next = []
                    for (const c of left) {
                        const [x, cy, z] = c
                        const touch = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, d]) => {
                            const n = [x + a, cy + b, z + d]
                            const k = key(...n)
                            // gates aren't solid: nothing is built against them
                            return solidAt(...n) && !(placed.has(k) && gates.has(k))
                        })
                        if (touch) placed.add(key(x, cy, z))
                        else next.push(c)
                    }
                    if (next.length === left.length) break
                    left = next
                }
                cannot.push(...left)
            }
        }
        expect(cannot.map((c) => c.join(" ")).slice(0, 30)).toEqual([])
    })
    it('stands on the ground: under every block of the floor course is terrain or the base course', () => {
        const cells = new Set(castle.cells.map(([x, y, z]) => key(x, y, z)))
        const floating = castle.cells.filter(([x, y, z]) => y === FLOOR && !cells.has(key(x, y - 1, z)) && y - 1 >= ground(x, z))
        expect(floating.map((c) => c.join(' ')).slice(0, 10)).toEqual([])
    })
    it('closes the courtyard: from the Town Center there is no way out at ground level but the gates', () => {
        const wall = new Set(castle.cells.filter(([, y]) => y >= FLOOR && y <= FLOOR + 1).map(([x, , z]) => `${x},${z}`))
        const seen = new Set(['0,5'])
        const queue = [[0, 5]]
        let out = null
        while (queue.length && !out) {
            const [x, z] = queue.shift()
            for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, nz = z + dz, k = `${nx},${nz}`
                if (seen.has(k) || wall.has(k)) continue
                // ground higher than a step up is a wall too (the hill the Palas stands against)
                if (ground(nx, nz) > FLOOR + 1) continue
                if (Math.abs(nx) > 45 || Math.abs(nz) > 30) {
                    out = [x, z]
                    break
                }
                seen.add(k)
                queue.push([nx, nz])
            }
        }
        expect(out).toBe(null)
    })
    it('puts every archery tower on something built (a tower on a built block needs no column)', () => {
        const cells = new Set(castle.cells.map(([x, y, z]) => key(x, y, z)))
        for (const t of castle.towers) {
            if (t.ground) {
                // on the ground (a guard tower's column goes under it): nothing built in the way
                for (let dy = 0; dy < 3; dy++) expect(cells.has(key(t.x, t.y + dy, t.z)), t.spot).toBe(false)
                expect(t.y).toBe(ground(t.x, t.z))
                continue
            }
            expect(cells.has(key(t.x, t.y - 1, t.z)), t.spot).toBe(true)
            expect(cells.has(key(t.x, t.y, t.z)), t.spot).toBe(false)
        }
    })
    it('has archery towers high up: at least 8 of them 11 blocks over the ground', () => {
        const high = castle.towers.filter((t) => !t.ground && t.y - ground(t.x, t.z) >= 11)
        expect(high.length).toBeGreaterThanOrEqual(8)
    })
})
const gates = new Set(castle.cells.filter((c) => c[3] === 'gate').map(([x, y, z]) => key(x, y, z)))

describe('the castle bot plans', () => {
    it('counts what a load costs from the recipes, crafted blocks first', () => {
        expect(rawCost('ashlar')).toEqual({ cobble: 0.5 })
        expect(rawCost('stone_wall')).toEqual({ cobble: 1.5 })
        expect(rawCost('window')).toEqual({ cobble: 0.5, sand: 0.5 })
        expect(rawCost('cobble')).toEqual({ cobble: 1 })
        expect(rawNeeds(['brick', 'brick', 'window', 'window'], { brick: 1 })).toEqual({ cobble: 1.5, sand: 1 })
    })
    it('the whole castle needs what survival can gather', () => {
        const need = rawNeeds([...castle.cells.map((c) => c[3]), ...castle.towers.map(() => 'arrow_tower')])
        expect(Object.keys(need).sort()).toEqual(['cobble', 'iron', 'planks', 'sand'].sort())
        for (const k of Object.keys(need)) expect(RECIPES.some((r) => r.cost[k]) || k === 'cobble', k).toBe(true)
    })
    it('digs its quarry hall in stone, under the ground, behind the castle, next to the face each time', () => {
        const hall = hallCells(ground)
        // (the stair's last step is the first column of the hall)
        expect(hall.rows.length).toBe((HALL.x1 - HALL.x0 + 1) * HALL.rows * HALL.height - HALL.height)
        // the hall's roof is at least 3 under the ground everywhere: the landscape stays whole
        for (const [x, y, z] of hall.rows) expect(ground(x, z) - 1 - y).toBeGreaterThanOrEqual(3)
        // the stair starts at the surface and ends on the hall's floor
        expect(Math.min(...hall.stair.filter((c) => c[2] === HALL.entranceZ).map((c) => c[1]))).toBe(ground(HALL.entranceX, HALL.entranceZ) - 1)
        expect(Math.min(...hall.stair.map((c) => c[1]))).toBe(hall.floor)
        // behind the castle: nothing of it over the stair or the hall
        const castleTop = new Set(castle.cells.map(([x, , z]) => `${x},${z}`))
        for (const [x, , z] of hall.cells) expect(castleTop.has(`${x},${z}`)).toBe(false)
        // each cell next to one dug before it (or the first)
        const dug = new Set()
        hall.cells.forEach(([x, y, z], i) => {
            if (i) expect([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => dug.has(key(x + a, y + b, z + c))), `${x},${y},${z}`).toBe(true)
            dug.add(key(x, y, z))
        })
    })
})
