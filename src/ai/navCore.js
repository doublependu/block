/*
 *  Navigation grid + flow fields (pure logic, used by the nav worker and tests).
 *
 *  Node:  standing cell (x, y, z): solid floor at y-1, cells y and y+1 passable
 *         or player-built (breakable, extra cost). Attackers never stand on a
 *         tower or on top of a built stack (a wall), so walls can't be walked
 *         over: the only way through is breaking them.
 *  Field: per node, the direction + slot of the next node on the way to a goal,
 *         from one reverse Dijkstra per movement profile:
 *           walker   to the town center
 *           digger   to the town center, climbing up to 3
 *           siege    to the nearest tower (or wall, in walls mode), falling back
 *                    to the town center; goal kinds are seeded with a head start
 *                    cost so towers win unless they're far out of the way
 *
 *  Encoding of a field byte: 0xFF no path, 0xFE at goal, else (dir << 3) | slot.
 */

import { BLOCK_BY_ID } from '../world/blocks.js'
import { HP_PER_HARDNESS, SIEGE } from '../game/balance.js'

export const L = 6                // max node levels per column
export const NONE_Y = 255
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const INF = 0x7fffffff

export const GOAL_TOWN = 1, GOAL_TOWER = 2, GOAL_WALL = 4

// block flags
const F_SOLID = 1, F_BUILT = 2, F_GATE = 4, F_SPIKE = 8, F_WATER = 16, F_TOWN = 32, F_WALL = 64, F_TOWER = 128
const flags = new Uint8Array(256)
const breakCost = new Uint16Array(256)
for (let id = 1; id < 256; id++) {
    const b = BLOCK_BY_ID[id]
    if (!b) continue
    let f = 0
    if (b.solid) f |= F_SOLID
    if (b.built) f |= F_BUILT
    if (b.gate) f |= F_GATE
    if (b.contactDamage) f |= F_SPIKE
    if (b.fluid) f |= F_WATER
    if (b.townCenter) f |= F_TOWN
    if (b.tower) f |= F_TOWER
    // wall-like: built blocks that form barriers (not towers, not spikes)
    if (b.built && (b.solid || b.gate) && !b.tower && !b.contactDamage) f |= F_WALL
    flags[id] = f
    // cost in "tenths of a block walked": hp / ~12 dps * ~3.5 blocks/s * 10
    if (b.built) breakCost[id] = Math.min(4000, Math.round(b.hardness * HP_PER_HARDNESS / 12 * 35))
}

/**
 * @param {{size: number, minY: number, maxY: number, town?: number[] | null}} dims
 *   town: town center base block (the 3x3 footprint's center); goals are the
 *   nodes around the footprint, so they survive the structure crumbling. Without
 *   it, goals are the nodes next to town center blocks.
 * @param {(vox: Uint8Array, idx: (x: number, y: number, z: number) => number) => void} fill  writes block ids into the volume
 */
export function createNavGrid({ size, minY: minYArg, maxY, town = null }, fill) {
    const W = size, half = size / 2, minY = minYArg, H = maxY - minYArg + 1
    const vox = new Uint8Array(W * W * H)
    const nodeY = new Uint8Array(W * W * L)
    const nodeCost = new Uint16Array(W * W * L)
    const goal = new Uint8Array(W * W * L)
    /** per column: built blocks and tower blocks (skips goal scans far from structures) */
    const builtCount = new Uint16Array(W * W)
    const towerCount = new Uint16Array(W * W)
    let towerTotal = 0
    let dirty = null

    const vi = (x, y, z) => ((x + half) * W + (z + half)) * H + (y - minY)
    const inside = (x, y, z) => x >= -half && x < half && z >= -half && z < half && y >= minY && y < minY + H
    const colOf = (x, z) => (x + half) * W + (z + half)
    const inColumns = (x, z) => x >= -half && x < half && z >= -half && z < half

    function block(x, y, z) {
        if (!inside(x, y, z)) return y < minY ? 1 : 0
        return vox[vi(x, y, z)]
    }

    function count(x, z, id, d) {
        const f = flags[id]
        if (!(f & F_BUILT)) return
        const col = colOf(x, z)
        builtCount[col] += d
        if (f & F_TOWER) {
            towerCount[col] += d
            towerTotal += d
        }
    }

    /** cell is enterable: air, non-solid (gate/spikes/water) or breakable built block */
    function cellOk(id) {
        const f = flags[id]
        if (!(f & F_SOLID)) return true
        return (f & F_BUILT) !== 0
    }
    function passable(id) {
        return !(flags[id] & F_SOLID) && !(flags[id] & F_GATE)
    }

    /** a tower in a neighbouring column is within reach of a unit standing at y (directly, or through its supporting stack) */
    function towerInReach(nx, nz, y) {
        for (let yy = y - 1; yy <= y + 3; yy++) {
            const f = flags[block(nx, yy, nz)]
            if (f & F_TOWER) return true
            if (f & F_BUILT && yy <= y + 2) {
                // a built stack holding a tower up: cutting it brings the tower down
                for (let k = yy + 1; k <= yy + 8; k++) {
                    const g = flags[block(nx, k, nz)]
                    if (g & F_TOWER) return true
                    if (!(g & F_BUILT)) break
                }
            }
        }
        return false
    }

    function wallInReach(nx, nz, y) {
        for (let yy = y; yy <= y + 2; yy++) if (flags[block(nx, yy, nz)] & F_WALL) return true
        return false
    }

    function buildColumn(x, z) {
        const col = colOf(x, z)
        const base = col * L
        for (let s = 0; s < L; s++) nodeY[base + s] = NONE_Y
        let slot = 0
        // scan top-down so the highest levels are kept
        for (let y = minY + H - 2; y > minY && slot < L; y--) {
            const floor = block(x, y - 1, z)
            const ff = flags[floor]
            if (!(ff & F_SOLID)) continue
            // never stand on a tower or on top of a wall (a built block on a built block)
            if (ff & F_TOWER) continue
            if (ff & F_BUILT && flags[block(x, y - 2, z)] & F_BUILT) continue
            const a = block(x, y, z), b = block(x, y + 1, z)
            if (!cellOk(a) || !cellOk(b)) continue
            const builtCells = (flags[a] & F_BUILT ? 1 : 0) + (flags[b] & F_BUILT ? 1 : 0)
            // breakable nodes only at ground level (not inside wall stacks)
            if (builtCells && (ff & F_BUILT)) continue
            let cost = breakCost[a] + breakCost[b]
            if (flags[a] & F_SPIKE) cost += 40
            if (flags[a] & F_WATER) cost += 8
            nodeY[base + slot] = y - minY
            nodeCost[base + slot] = Math.min(65535, cost)
            let g = 0
            if (town) {
                // around the 3x3 town center footprint
                if (Math.max(Math.abs(x - town[0]), Math.abs(z - town[2])) === 2 && Math.abs(y - town[1]) <= 1) g |= GOAL_TOWN
            }
            for (const [dx, dz] of DIRS) {
                const nx = x + dx, nz = z + dz
                if (!town && (flags[block(nx, y, nz)] & F_TOWN || flags[block(nx, y + 1, nz)] & F_TOWN)) g |= GOAL_TOWN
                if (!inColumns(nx, nz)) continue
                const ncol = colOf(nx, nz)
                if (!builtCount[ncol]) continue
                if (towerCount[ncol] && !(g & GOAL_TOWER) && towerInReach(nx, nz, y)) g |= GOAL_TOWER
                if (!(g & GOAL_WALL) && wallInReach(nx, nz, y)) g |= GOAL_WALL
            }
            goal[base + slot] = g
            slot++
        }
    }

    /**
     * Reverse Dijkstra: for each node P, the next node N on the cheapest path to a goal.
     * Encoded per node as byte: 0xFF = no path, else (dir << 3) | slot
     * @param {'walker'|'digger'|'siege'|boolean} profileArg  (boolean: digger)
     * @param {{walls?: boolean}} [opts] siege: walls count as goals too
     */
    function computeField(profileArg, { walls = false } = {}) {
        const profile = typeof profileArg === 'string' ? profileArg : profileArg ? 'digger' : 'walker'
        const digger = profile === 'digger'
        const n = W * W * L
        const dist = new Int32Array(n).fill(INF)
        const next = new Uint8Array(n).fill(0xff)
        // bucket queue (costs are small integers)
        const buckets = new Map()
        let cur = 0, pending = 0
        const push = (node, d) => {
            let b = buckets.get(d)
            if (!b) buckets.set(d, (b = []))
            b.push(node)
            pending++
        }
        for (let i = 0; i < n; i++) {
            const g = goal[i]
            if (!g || nodeY[i] === NONE_Y) continue
            let seed = INF
            if (profile === 'siege') {
                if (g & GOAL_TOWER) seed = SIEGE.seedTower
                else if (g & GOAL_WALL && walls) seed = SIEGE.seedWall
                else if (g & GOAL_TOWN) seed = SIEGE.seedTown
            } else if (g & GOAL_TOWN) seed = 0
            if (seed === INF) continue
            dist[i] = seed
            next[i] = 0xfe // at goal
            push(i, seed)
        }
        const maxUp = digger ? 3 : 1
        while (pending > 0) {
            let b = buckets.get(cur)
            while (!b || b.length === 0) {
                buckets.delete(cur)
                cur++
                b = buckets.get(cur)
            }
            const N = b.pop()
            pending--
            if (dist[N] !== cur) continue
            const ncol = Math.floor(N / L)
            const nx = Math.floor(ncol / W) - half, nz = (ncol % W) - half
            const ny = nodeY[N] + minY
            const enterCost = nodeCost[N]
            // predecessors: nodes P in neighbouring columns that can step into N
            for (let d = 0; d < 8; d++) {
                const px = nx - DIRS[d][0], pz = nz - DIRS[d][1]
                if (px < -half || px >= half || pz < -half || pz >= half) continue
                const pcol = (px + half) * W + (pz + half)
                const diag = d >= 4
                for (let s = 0; s < L; s++) {
                    const P = pcol * L + s
                    const pyRaw = nodeY[P]
                    if (pyRaw === NONE_Y) continue
                    const py = pyRaw + minY
                    const dy = ny - py
                    if (dy > maxUp || dy < -3) continue
                    // headroom to climb
                    if (dy >= 1 && !passable(block(px, py + 2, pz))) {
                        if (!digger) continue
                    }
                    // falling space above the lower target
                    if (dy < 0) {
                        let ok = true
                        for (let y = ny + 2; y <= py + 1; y++) if (!passable(block(nx, y, nz))) ok = false
                        if (!ok) continue
                    }
                    if (diag) {
                        const top = Math.max(py, ny)
                        const ax = px + DIRS[d][0], bz = pz + DIRS[d][1]
                        if (!passable(block(ax, top, pz)) || !passable(block(ax, top + 1, pz)) ||
                            !passable(block(px, top, bz)) || !passable(block(px, top + 1, bz))) continue
                    }
                    let c = (diag ? 14 : 10) + enterCost
                    if (dy !== 0) c += 4
                    if (dy > 1) c += 60 * (dy - 1)
                    const nd = cur + c
                    if (nd < dist[P]) {
                        dist[P] = nd
                        const slot = N - ncol * L
                        next[P] = (d << 3) | slot
                        push(P, nd)
                    }
                }
            }
        }
        const dist16 = new Uint16Array(n)
        for (let i = 0; i < n; i++) dist16[i] = dist[i] === INF ? 65535 : Math.min(65534, dist[i] >> 2)
        return { next, dist: dist16 }
    }


    fill(vox, vi)
    for (let x = -half; x < half; x++) {
        for (let z = -half; z < half; z++) {
            for (let y = minY; y < minY + H; y++) {
                const id = vox[vi(x, y, z)]
                if (id && flags[id] & F_BUILT) count(x, z, id, 1)
            }
        }
    }
    for (let x = -half; x < half; x++) for (let z = -half; z < half; z++) buildColumn(x, z)

    return {
        W, H, half, minY, L, nodeY, goal,
        get hasDirty() {
            return !!dirty
        },
        /** any tower in the world (the siege field has something to lead to) */
        get hasTowers() {
            return towerTotal > 0
        },
        /** apply block changes; columns are rebuilt on the next update() */
        setBlocks(list) {
            dirty = dirty || new Set()
            for (const [x, y, z, id] of list) {
                if (!inside(x, y, z)) continue
                const i = vi(x, y, z)
                count(x, z, vox[i], -1)
                vox[i] = id
                count(x, z, id, 1)
                for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) dirty.add(`${x + dx},${z + dz}`)
            }
        },
        update() {
            if (!dirty) return
            for (const key of dirty) {
                const [x, z] = key.split(',').map(Number)
                if (x >= -half && x < half && z >= -half && z < half) buildColumn(x, z)
            }
            dirty = null
        },
        computeField,
    }
}

/** fill a nav volume from a terrain generator */
export function fillFromGenerator(gen, size, minY, maxY) {
    const half = size / 2, H = maxY - minY + 1, B = 16
    const tmp = new Uint16Array(B * H * B)
    return (vox, vi) => {
        for (let bx = -half; bx < half; bx += B) {
            for (let bz = -half; bz < half; bz += B) {
                gen.generateRegion(tmp, bx, minY, bz, B, H, B)
                for (let i = 0; i < B && bx + i < half; i++) {
                    for (let k = 0; k < B && bz + k < half; k++) {
                        const dst = vi(bx + i, minY, bz + k)
                        for (let j = 0; j < H; j++) vox[dst + j] = tmp[i * H * B + j * B + k]
                    }
                }
            }
        }
    }
}
