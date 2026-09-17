/*
 *  Short local paths for defenders: wandering, night patrols and walking back
 *  to a post. Breadth-first search over standing cells in a small window,
 *  with the same movement rules as the attackers' flow field (navCore.js):
 *  solid floor, two free cells for the body, step up 1, drop up to 3, and no
 *  cutting corners on diagonals. Gates are open for defenders; water and
 *  spikes are avoided.
 *
 *  Pure logic: blocks come from a getBlock(x, y, z) callback that returns
 *  undefined where the world isn't known (chunk not loaded).
 */

import { BLOCK_BY_ID } from '../world/blocks.js'

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const MAX_UP = 1
const MAX_DROP = 3
/** vertical search window around the start, in blocks */
const Y_RANGE = 8

/** @typedef {(x: number, y: number, z: number) => (number | undefined)} GetBlock */
/** @typedef {{x: number, y: number, z: number, prev: string | null}} PathNode */

function isSolid(id) {
    const b = BLOCK_BY_ID[id]
    return !!(b && b.solid)
}

/** a body can be in this cell */
function isOpen(id) {
    if (id === undefined) return false
    if (id === 0) return true
    const b = BLOCK_BY_ID[id]
    return !!b && !b.solid && !b.fluid && !b.contactDamage
}

/** @param {GetBlock} getBlock */
export function canStand(getBlock, x, y, z) {
    const floor = getBlock(x, y - 1, z)
    return floor !== undefined && isSolid(floor) && isOpen(getBlock(x, y, z)) && isOpen(getBlock(x, y + 1, z))
}

/**
 * Standable levels per column, computed once per column per search.
 * @param {GetBlock} getBlock
 * @param {number} minY
 * @param {number} maxY
 */
function columnCache(getBlock, minY, maxY) {
    /** @type {Map<string, number[]>} */
    const cols = new Map()
    return (x, z) => {
        const key = `${x},${z}`
        let levels = cols.get(key)
        if (!levels) {
            levels = []
            let above2 = getBlock(x, maxY + 1, z), above1 = getBlock(x, maxY, z)
            for (let y = maxY; y >= minY; y--) {
                const floor = getBlock(x, y - 1, z)
                if (floor !== undefined && isSolid(floor) && isOpen(above1) && isOpen(above2)) levels.push(y)
                above2 = above1
                above1 = floor
            }
            cols.set(key, levels)
        }
        return levels
    }
}

/**
 * Breadth-first search from a feet position over standing cells within
 * `radius` blocks (square window) of `center`.
 * @param {GetBlock} getBlock
 * @param {number[]} start  feet position
 * @param {number[]} center
 * @param {number} radius
 * @param {number} [maxNodes]
 * @returns {{nodes: Map<string, PathNode>, startKey: string} | null}
 */
export function explore(getBlock, start, center, radius, maxNodes = 2500) {
    const sx = Math.floor(start[0]), sz = Math.floor(start[2])
    const fy = Math.floor(start[1] + 0.05)
    const levelsAt = columnCache(getBlock, fy - Y_RANGE, fy + Y_RANGE)
    // start level: the standable level closest to the feet
    let sy = null
    for (const y of levelsAt(sx, sz)) if (sy === null || Math.abs(y - fy) < Math.abs(sy - fy)) sy = y
    if (sy === null || Math.abs(sy - fy) > 2) return null

    const cx = Math.floor(center[0]), cz = Math.floor(center[2])
    const key = (x, y, z) => `${x},${y},${z}`
    /** @type {Map<string, PathNode>} */
    const nodes = new Map()
    const startKey = key(sx, sy, sz)
    nodes.set(startKey, { x: sx, y: sy, z: sz, prev: null })
    const queue = [startKey]
    for (let qi = 0; qi < queue.length && nodes.size < maxNodes; qi++) {
        const nk = queue[qi]
        const n = nodes.get(nk)
        for (const [dx, dz] of DIRS) {
            const nx = n.x + dx, nz = n.z + dz
            if (Math.abs(nx - cx) > radius || Math.abs(nz - cz) > radius) continue
            const levels = levelsAt(nx, nz)
            for (const ny of levels) {
                const dy = ny - n.y
                if (dy > MAX_UP || dy < -MAX_DROP) continue
                const k = key(nx, ny, nz)
                if (nodes.has(k)) continue
                // room to climb out of the current cell
                if (dy > 0 && !isOpen(getBlock(n.x, n.y + 2, n.z))) continue
                // room to fall into the lower cell
                if (dy < 0) {
                    let ok = true
                    for (let y = ny + 2; y <= n.y + 1 && ok; y++) ok = isOpen(getBlock(nx, y, nz))
                    if (!ok) continue
                }
                if (dx && dz) {
                    const top = Math.max(n.y, ny)
                    if (!isOpen(getBlock(nx, top, n.z)) || !isOpen(getBlock(nx, top + 1, n.z)) ||
                        !isOpen(getBlock(n.x, top, nz)) || !isOpen(getBlock(n.x, top + 1, nz))) continue
                }
                nodes.set(k, { x: nx, y: ny, z: nz, prev: nk })
                queue.push(k)
            }
        }
    }
    return { nodes, startKey }
}

/**
 * Waypoints (cell centers, feet height) from the start to a node, without the
 * start cell. Straight runs on one level are merged.
 * @param {{nodes: Map<string, PathNode>}} result
 * @param {string} key
 * @returns {number[][]}
 */
export function pathTo(result, key) {
    const cells = []
    for (let k = key; k; k = result.nodes.get(k).prev) cells.push(result.nodes.get(k))
    cells.reverse()
    const out = []
    for (let i = 1; i < cells.length; i++) {
        const a = cells[i - 1], b = cells[i], c = cells[i + 1]
        const straight = c && b.y === a.y && c.y === b.y && c.x - b.x === b.x - a.x && c.z - b.z === b.z - a.z
        if (!straight) out.push([b.x + 0.5, b.y, b.z + 0.5])
    }
    return out
}

/**
 * Path to a random reachable cell within `radius` of `center`, at least
 * `minDist` from the start. The search window grows to include the start when
 * the unit has strayed.
 * @param {GetBlock} getBlock
 * @returns {number[][] | null}
 */
export function wanderPath(getBlock, start, center, radius, rnd = Math.random, minDist = 2) {
    const strayed = Math.max(Math.abs(start[0] - center[0]), Math.abs(start[2] - center[2]))
    const r = explore(getBlock, start, center, Math.min(16, Math.max(radius, Math.ceil(strayed) + 2)))
    if (!r) return null
    const picks = []
    for (const [k, n] of r.nodes) {
        if (Math.max(Math.abs(n.x + 0.5 - center[0]), Math.abs(n.z + 0.5 - center[2])) > radius) continue
        if (Math.hypot(n.x + 0.5 - start[0], n.z + 0.5 - start[2]) < minDist) continue
        picks.push(k)
    }
    if (!picks.length) return null
    return pathTo(r, picks[Math.floor(rnd() * picks.length)])
}

/**
 * Path to a goal, or to the reachable cell nearest to it when the goal itself
 * can't be reached. Empty when the start is already the nearest cell; null
 * when the start isn't standable or the world there isn't loaded.
 * @param {GetBlock} getBlock
 * @param {number[]} start
 * @param {number[]} goal
 * @returns {number[][] | null}
 */
export function pathToward(getBlock, start, goal) {
    const center = [(start[0] + goal[0]) / 2, 0, (start[2] + goal[2]) / 2]
    const half = Math.max(Math.abs(start[0] - goal[0]), Math.abs(start[2] - goal[2])) / 2
    const r = explore(getBlock, start, center, Math.min(20, Math.ceil(half) + 8))
    if (!r) return null
    let best = r.startKey, bestD = Infinity
    for (const [k, n] of r.nodes) {
        const d = Math.hypot(n.x + 0.5 - goal[0], n.z + 0.5 - goal[2]) + Math.abs(n.y - Math.floor(goal[1] + 0.05)) * 0.5
        if (d < bestD) {
            bestD = d
            best = k
        }
    }
    return best === r.startKey ? [] : pathTo(r, best)
}
