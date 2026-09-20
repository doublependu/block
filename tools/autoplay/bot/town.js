/*
 *  The bot's picture of the town, worked out from the world (not hard-coded):
 *  the wall ring and its gates, free spots for towers and troops, a quarry
 *  site, the trees around, and ore.
 */

import { BLOCK_BY_ID, BLOCK_BY_NAME } from '../../../src/world/blocks.js'
import { passable, standable } from './nav.js'

const LOG = BLOCK_BY_NAME.log.id
const STONE = BLOCK_BY_NAME.stone.id
const IRON = BLOCK_BY_NAME.iron_ore.id
const GOLD = BLOCK_BY_NAME.gold_ore.id

const isWall = (id) => {
    const b = BLOCK_BY_ID[id]
    return !!b && !!b.built && (b.solid || !!b.gate) && !b.tower && !b.contactDamage
}

export class Town {
    /** @param {import('./see.js').See} see */
    constructor(see) {
        this.see = see
        const tc = see.tc
        this.tc = tc
        this.ty = tc[1]
        const get = see.block
        // the wall ring: the square ring around the town center with the most wall blocks at plaza level
        let bestR = 13, bestN = -1
        for (let r = 6; r <= 24; r++) {
            let n = 0
            for (let i = -r; i <= r; i++) {
                for (const [x, z] of [[i, -r], [i, r], [-r, i], [r, i]]) if (isWall(get(tc[0] + x, this.ty, tc[2] + z))) n++
            }
            if (n > bestN) {
                bestN = n
                bestR = r
            }
        }
        this.R = bestR
        // gates: one per side, where the gate blocks are
        this.gates = []
        for (const [nx, nz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
            const cells = []
            for (let i = -bestR; i <= bestR; i++) {
                const x = tc[0] + (nx ? nx * bestR : i), z = tc[2] + (nz ? nz * bestR : i)
                if (BLOCK_BY_ID[get(x, this.ty, z)]?.gate) cells.push(i)
            }
            if (!cells.length) continue
            const mid = cells.reduce((a, b) => a + b, 0) / cells.length
            this.gates.push({ n: [nx, nz], t: [nz, nx], offset: mid, at: [tc[0] + (nx ? nx * bestR : Math.round(mid)), tc[2] + (nz ? nz * bestR : Math.round(mid))] })
        }
        this.badSlots = new Set()
        this.trees = null
        this.quarry = null
    }

    /** first cell a column's floor supports (feet level), searching down from above the plaza */
    groundAt(x, z, from = this.ty + 4) {
        const get = this.see.block
        for (let y = from; y > this.ty - 8; y--) {
            if (standable(get(x, y - 1, z)) && passable(get(x, y, z))) return y
        }
        return null
    }

    /** inside the ring (Chebyshev distance from the town center) */
    ringDist(x, z) {
        return Math.max(Math.abs(x - this.tc[0]), Math.abs(z - this.tc[2]))
    }

    /** a column of free cells from y up, n high */
    _free(x, y, z, n) {
        for (let i = 0; i < n; i++) if (!passable(this.see.block(x, y + i, z)) || this.see.block(x, y + i, z) !== 0) return false
        return true
    }

    /** on a gate's walkway (the straight line from a gate to the town center), where nothing should stand */
    onWalkway(x, z, width = 1.5) {
        const tc = this.tc
        for (const g of this.gates) {
            const along = (x - tc[0]) * g.n[0] + (z - tc[2]) * g.n[1]
            const across = (x - tc[0]) * g.t[0] + (z - tc[2]) * g.t[1]
            if (along > 2 && Math.abs(across - g.offset) <= width) return true
        }
        return false
    }

    /**
     * Where the next towers go: inside the wall, 3–4 blocks in, beside the gates
     * first (attackers come through them), then round the ring. Each is a 2-high
     * column with the tower on top.
     * @returns {{x: number, y: number, z: number, near: number}[]}
     */
    towerSlots() {
        const tc = this.tc, R = this.R
        const out = []
        const taken = []
        const get = this.see.block
        // towers already standing (and the ones we build) keep the others 3 apart
        for (let x = -R; x <= R; x++) {
            for (let z = -R; z <= R; z++) {
                for (let y = this.ty - 1; y <= this.ty + 4; y++) if (BLOCK_BY_ID[get(tc[0] + x, y, tc[2] + z)]?.tower) taken.push([tc[0] + x, tc[2] + z])
            }
        }
        for (let x = tc[0] - R + 2; x <= tc[0] + R - 2; x++) {
            for (let z = tc[2] - R + 2; z <= tc[2] + R - 2; z++) {
                const d = this.ringDist(x, z)
                // an outer ring 3-4 in from the wall, then an inner one 6-7 in
                const inner = d >= R - 7 && d <= R - 6
                if (!(d >= R - 4 && d <= R - 3) && !inner) continue
                // keep the lane inside each gate clear: attackers come through it, troops stand beside it
                if (this.onWalkway(x, z, 3.5) || this.badSlots.has(`${x},${z}`)) continue
                const y = this.groundAt(x, z)
                if (y === null || !this._free(x, y, z, 3)) continue
                if (taken.some(([tx, tz]) => Math.max(Math.abs(tx - x), Math.abs(tz - z)) < 3)) continue
                // near a gate first
                let near = Infinity
                for (const g of this.gates) near = Math.min(near, Math.hypot(x - g.at[0], z - g.at[1]))
                out.push({ x, y, z, near: near + (inner ? 100 : 0) })
            }
        }
        out.sort((a, b) => a.near - b.near)
        // spread out: greedily keep 3 apart
        const picked = []
        for (const s of out) {
            if (picked.some((p) => Math.max(Math.abs(p.x - s.x), Math.abs(p.z - s.z)) < 3)) continue
            picked.push(s)
        }
        return picked
    }

    /** spots for troops: just inside each gate, then either side of it */
    troopSpots() {
        const tc = this.tc, R = this.R
        const out = []
        for (let k = 0; k < 3; k++) {
            for (const g of this.gates) {
                const side = k === 0 ? 0 : k === 1 ? 2 : -2
                const x = tc[0] + g.n[0] * (R - 3) + g.t[0] * (Math.round(g.offset) + side)
                const z = tc[2] + g.n[1] * (R - 3) + g.t[1] * (Math.round(g.offset) + side)
                const y = this.groundAt(x, z)
                if (y !== null && this._free(x, y, z, 2)) out.push([x, y, z])
            }
        }
        return out
    }

    /**
     * Places on top of the wall to shoot from, three blocks either side of each
     * gate, each with a step inside the wall to climb up by (one block, then the wall).
     * @returns {{top: number[], step: number[], gate: any}[]}
     */
    perches() {
        const tc = this.tc, R = this.R, ty = this.ty
        const get = this.see.block
        const out = []
        for (const g of this.gates) {
            for (const side of [3, -3]) {
                const a = Math.round(g.offset) + side
                const x = tc[0] + g.n[0] * R + g.t[0] * a, z = tc[2] + g.n[1] * R + g.t[1] * a
                const sx = x - g.n[0], sz = z - g.n[1]
                if (!isWall(get(x, ty + 1, z)) || get(x, ty + 2, z) !== 0 || get(x, ty + 3, z) !== 0) continue
                if (!standable(get(sx, ty - 1, sz))) continue
                out.push({ top: [x, ty + 2, z], step: [sx, ty, sz], gate: g })
            }
        }
        return out
    }

    /** trees around the town: the bottom log of each trunk */
    findTrees(radius = 70) {
        const get = this.see.block
        const tc = this.tc
        const out = []
        for (let x = tc[0] - radius; x <= tc[0] + radius; x++) {
            for (let z = tc[2] - radius; z <= tc[2] + radius; z++) {
                if (Math.abs(x) >= this.see.half - 2 || Math.abs(z) >= this.see.half - 2) continue
                const y = this.see.g.world.surfaceY(x, z)
                if (get(x, y, z) === LOG) out.push([x, y, z])
            }
        }
        this.trees = out
        return out
    }

    /** the logs of a trunk, bottom up */
    trunk(base) {
        const get = this.see.block
        const out = []
        for (let y = base[1]; y < base[1] + 9; y++) if (get(base[0], y, base[2]) === LOG) out.push([base[0], y, base[2]])
        return out
    }

    /**
     * Stone standing above the ground near the town (an outcrop): the middle of
     * the biggest one within `radius`, at ground level, or null.
     */
    findOutcrop(radius = 32) {
        const tc = this.tc
        const w = this.see.g.world
        const get = this.see.block
        const cells = []
        for (let x = tc[0] - radius; x <= tc[0] + radius; x++) {
            for (let z = tc[2] - radius; z <= tc[2] + radius; z++) {
                if (this.ringDist(x, z) <= this.R + 3) continue
                const y = w.surfaceY(x, z)
                const id = get(x, y, z)
                if (id === STONE || id === IRON || id === GOLD) cells.push([x, y, z])
            }
        }
        if (cells.length < 6) return null
        // the densest spot
        let best = null, bestN = 0
        for (const c of cells) {
            const n = cells.filter((d) => Math.abs(d[0] - c[0]) <= 2 && Math.abs(d[2] - c[2]) <= 2).length
            if (n > bestN) {
                bestN = n
                best = c
            }
        }
        return bestN >= 6 ? best : null
    }

    /**
     * A quarry site: an outcrop if there is one near the town, else flat ground
     * 6–16 blocks outside the wall, near a corner of the ring (between two
     * gates), as close in as that allows.
     */
    pickQuarry() {
        const rock = this.findOutcrop()
        if (rock) {
            this.quarry = rock
            return rock
        }
        const tc = this.tc
        const w = this.see.g.world
        let best = null, bestScore = Infinity
        for (let d = this.R + 6; d <= this.R + 16; d++) {
            for (let i = -d; i <= d; i++) {
                for (const [x0, z0] of [[i, -d], [i, d], [-d, i], [d, i]]) {
                    if (Math.min(Math.abs(x0), Math.abs(z0)) < d - 6) continue
                    const x = tc[0] + x0, z = tc[2] + z0
                    if (Math.abs(x) > this.see.half - 8 || Math.abs(z) > this.see.half - 8) continue
                    let lo = Infinity, hi = -Infinity, water = false
                    for (let a = -2; a <= 2; a++) {
                        for (let b = -2; b <= 2; b++) {
                            const h = w.surfaceY(x + a, z + b)
                            lo = Math.min(lo, h)
                            hi = Math.max(hi, h)
                            if (h <= 1) water = true
                        }
                    }
                    if (water) continue
                    const score = (hi - lo) * 4 + d * 0.5 + Math.abs(w.surfaceY(x, z) - this.ty) * 0.5
                    if (score < bestScore) {
                        bestScore = score
                        best = [x, w.surfaceY(x, z), z]
                    }
                }
            }
        }
        this.quarry = best
        return best
    }

    /**
     * Stone to dig at the quarry. Once stone is showing, the exposed stone
     * nearest the bot (so it tunnels sideways, about one block of dirt for many of
     * stone); ore first. Before that, the highest stone of each column in the pit.
     */
    /** @param {(b: number[]) => boolean} [skip] blocks to leave out (ones that failed) */
    quarryTargets(from, n = 12, skip = () => false) {
        const q = this.quarry || this.pickQuarry()
        const get = this.see.block
        const exposed = []
        const tops = []
        const d = (b) => Math.hypot(b[0] + 0.5 - from[0] - 0.5, (b[1] - from[1]) * 1.3, b[2] + 0.5 - from[2] - 0.5)
        for (let x = q[0] - 4; x <= q[0] + 4; x++) {
            for (let z = q[2] - 4; z <= q[2] + 4; z++) {
                let top = true
                // from the top of an outcrop down
                for (let y = q[1] + 5; y >= q[1] - 7; y--) {
                    const id = get(x, y, z)
                    if (id !== STONE && id !== IRON && id !== GOLD) continue
                    const b = [x, y, z]
                    const open = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]].some(([a, c, e]) => passable(get(x + a, y + c, z + e)))
                    const ore = id !== STONE
                    if (open) exposed.push({ b, ore, y })
                    else if (top && Math.abs(x - q[0]) <= 2 && Math.abs(z - q[2]) <= 2) tops.push({ b, ore, y })
                    top = false
                }
            }
        }
        // don't dig the floor out from under the bot, nor tunnel below the pit's floor level
        const floorY = q[1] - 7
        const list = exposed.filter((e) => e.y > floorY && !(e.b[0] === from[0] && e.b[2] === from[2] && e.b[1] === from[1] - 1) && !skip(e.b))
        const pick = list.length ? list : tops.filter((e) => !skip(e.b))
        pick.sort((a, b) => (b.ore - a.ore) || (b.y >= from[1]) - (a.y >= from[1]) || d(a.b) - d(b.b))
        return pick.slice(0, n)
    }

    /** the nearest ore of a kind to a point, within a box (loaded or not) */
    findOre(kind, near, radius = 14, depth = 14) {
        const id = kind === 'gold' ? GOLD : IRON
        const get = this.see.block
        const w = this.see.g.world
        let best = null, bestD = Infinity
        for (let x = near[0] - radius; x <= near[0] + radius; x++) {
            for (let z = near[2] - radius; z <= near[2] + radius; z++) {
                const top = w.surfaceY(x, z)
                for (let y = top - 4; y >= top - depth; y--) {
                    if (get(x, y, z) !== id) continue
                    const d = Math.hypot(x - near[0], (y - near[1]) * 1.5, z - near[2])
                    if (d < bestD) {
                        bestD = d
                        best = [x, y, z]
                    }
                }
            }
        }
        return best
    }
}
