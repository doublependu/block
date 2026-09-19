/*
 *  The bot's path finding: A* over the cells its feet can be in, where a step
 *  may first dig through natural blocks (never built ones: those are the town's
 *  defences). Costs are rough seconds, so a path walks round a hill when that's
 *  quicker than digging through it, and digs a staircase when the goal is
 *  underground.
 *
 *  Pure: blocks come from getBlock(x, y, z).
 */

import { BLOCK_BY_ID } from '../../../src/world/blocks.js'
import { PLAYER_MINE_SPEED } from '../../../src/game/balance.js'

/** seconds to walk one block, and extra for a step up or down */
const WALK = 0.15
const CLIMB = 0.12
/** seconds added per block dug (turning to it), on top of its hardness */
const DIG_OVERHEAD = 0.45
const WATER = 1.2

/** the body can be here (air, an open gate) */
export function passable(id) {
    if (id === 0) return true
    const b = BLOCK_BY_ID[id]
    return !!b && !b.solid && !b.fluid && !b.contactDamage
}

/** something to stand on */
export function standable(id) {
    const b = id ? BLOCK_BY_ID[id] : null
    return !!b && b.solid && !b.fluid
}

/** a natural block the bot may dig through */
export function diggable(id) {
    const b = id ? BLOCK_BY_ID[id] : null
    return !!b && isFinite(b.hardness) && !b.built && !b.fluid && !b.townCenter
}

function isWater(id) {
    const b = id ? BLOCK_BY_ID[id] : null
    return !!b && !!b.fluid
}

const key = (x, y, z) => ((x + 1024) * 2048 + (y + 512)) * 2048 + (z + 1024)

class Heap {
    constructor() {
        this.a = []
    }
    push(n) {
        const a = this.a
        a.push(n)
        let i = a.length - 1
        while (i > 0) {
            const p = (i - 1) >> 1
            if (a[p].f <= n.f) break
            a[i] = a[p]
            i = p
        }
        a[i] = n
    }
    pop() {
        const a = this.a
        const top = a[0]
        const last = a.pop()
        if (a.length) {
            let i = 0
            for (;;) {
                const l = 2 * i + 1, r = l + 1
                let m = i
                if (l < a.length && a[l].f < (m === i ? last.f : a[m].f)) m = l
                if (r < a.length && a[r].f < (m === i ? last.f : a[m].f)) m = r
                if (m === i) break
                a[i] = a[m]
                i = m
            }
            a[i] = last
        }
        return top
    }
    get size() {
        return this.a.length
    }
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const DIRS8 = [[1, 1], [1, -1], [-1, 1], [-1, -1]]

/**
 * @typedef {{x: number, y: number, z: number, kind: 'walk'|'up'|'down'|'drop', dig: number[][]}} Step
 */

/**
 * @param {object} o
 * @param {(x: number, y: number, z: number) => number} o.getBlock
 * @param {number[]} o.start feet cell
 * @param {(x: number, y: number, z: number) => boolean} o.isGoal
 * @param {number[]} o.toward a point near the goal (for the heuristic)
 * @param {boolean} [o.dig] allow digging (by day)
 * @param {(x: number, y: number, z: number) => boolean} [o.avoid] cells the feet must not enter
 * @param {number} [o.maxNodes]
 * @param {number} [o.half] half the world size (bounds)
 * @returns {Step[] | null} steps after the start cell
 */
export function findPath(o) {
    const it = pathSearch(o)
    for (;;) {
        const r = it.next()
        if (r.done) return r.value
    }
}

/**
 * The same search, a slice at a time: yields every `sliceMs` so a long search
 * is spread over frames instead of stalling one.
 * @returns {Generator<null, Step[] | null>}
 */
export function* pathSearch({ getBlock: rawGet, start, isGoal, toward, dig = true, avoid = null, maxNodes = 30000, half = 96, sliceMs = Infinity }) {
    // each cell is read several times while its neighbours are expanded
    const cache = new Map()
    const getBlock = (x, y, z) => {
        const k = key(x, y, z)
        let id = cache.get(k)
        if (id === undefined) {
            id = rawGet(x, y, z)
            cache.set(k, id)
        }
        return id
    }
    const [sx, sy, sz] = start
    let sliceStart = performance.now()
    const open = new Heap()
    /** @type {Map<number, any>} */
    const seen = new Map()
    // a little over the true cost: far fewer cells expanded, paths barely longer
    const h = (x, y, z) => (Math.hypot(x - toward[0], z - toward[2]) * WALK + Math.abs(y - toward[1]) * CLIMB) * 1.3
    const first = { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), prev: null, kind: 'walk', dig: [] }
    seen.set(key(sx, sy, sz), first)
    open.push(first)
    let nodes = 0
    let best = first, bestH = Infinity

    /** cost to have these cells open (digging what's in them), or Infinity */
    const clearCost = (cells, out) => {
        let c = 0
        for (const [x, y, z] of cells) {
            const id = getBlock(x, y, z)
            if (passable(id)) continue
            if (isWater(id)) {
                c += WATER
                continue
            }
            if (!dig || !diggable(id)) return Infinity
            c += DIG_OVERHEAD + BLOCK_BY_ID[id].hardness / PLAYER_MINE_SPEED
            out.push([x, y, z])
        }
        return c
    }

    const tryStep = (cur, nx, ny, nz, kind, cells, base) => {
        if (nx < -half + 1 || nx >= half - 1 || nz < -half + 1 || nz >= half - 1) return
        if (avoid && avoid(nx, ny, nz)) return
        const k = key(nx, ny, nz)
        const old = seen.get(k)
        if (old && old.closed) return
        const digs = []
        const c = clearCost(cells, digs)
        if (!isFinite(c)) return
        const g = cur.g + base + c
        if (old && old.g <= g) return
        const n = { x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), prev: cur, kind, dig: digs }
        seen.set(k, n)
        open.push(n)
    }

    while (open.size && nodes < maxNodes) {
        if ((nodes & 255) === 0 && performance.now() - sliceStart > sliceMs) {
            yield null
            sliceStart = performance.now()
        }
        const cur = open.pop()
        if (cur.closed) continue
        cur.closed = true
        nodes++
        const { x, y, z } = cur
        if (isGoal(x, y, z)) return unwind(cur)
        const hh = h(x, y, z)
        if (hh < bestH) {
            bestH = hh
            best = cur
        }
        // head room here, needed to step up
        for (const [dx, dz] of DIRS4) {
            const nx = x + dx, nz = z + dz
            const floor = getBlock(nx, y - 1, nz)
            // level: the floor ahead holds, the body fits (dig it clear)
            if (standable(floor)) tryStep(cur, nx, y, nz, 'walk', [[nx, y + 1, nz], [nx, y, nz]], WALK)
            // up one: the block ahead is the step
            if (standable(getBlock(nx, y, nz))) tryStep(cur, nx, y + 1, nz, 'up', [[x, y + 2, z], [nx, y + 2, nz], [nx, y + 1, nz]], WALK + CLIMB)
            // down one (a staircase when dug)
            if (standable(getBlock(nx, y - 2, nz))) tryStep(cur, nx, y - 1, nz, 'down', [[nx, y + 1, nz], [nx, y, nz], [nx, y - 1, nz]], WALK + CLIMB)
            // drop: walk off an edge onto a floor 2 or 3 below, nothing dug
            if (!standable(floor) && passable(floor) && passable(getBlock(nx, y, nz)) && passable(getBlock(nx, y + 1, nz))) {
                for (let d = 2; d <= 3; d++) {
                    const mid = getBlock(nx, y - d, nz)
                    if (standable(mid)) {
                        tryStep(cur, nx, y - d + 1, nz, 'drop', [], WALK + 0.1 * d)
                        break
                    }
                    if (!passable(mid)) break
                }
            }
        }
        // diagonals: only on the level, with nothing to dig and both corners open
        for (const [dx, dz] of DIRS8) {
            const nx = x + dx, nz = z + dz
            if (!standable(getBlock(nx, y - 1, nz))) continue
            const open2 = (cx, cz) => passable(getBlock(cx, y, cz)) && passable(getBlock(cx, y + 1, cz))
            if (!open2(nx, nz) || !open2(x + dx, z) || !open2(x, z + dz)) continue
            tryStep(cur, nx, y, nz, 'walk', [], WALK * Math.SQRT2)
        }
    }
    return null
}

function unwind(n) {
    const out = []
    while (n.prev) {
        out.push({ x: n.x, y: n.y, z: n.z, kind: n.kind, dig: n.dig })
        n = n.prev
    }
    return out.reverse()
}

/** the cells a step needs open, top first (what to dig before moving) */
export function stepCells(from, s) {
    const { x, y, z } = s
    if (s.kind === 'up') return [[from[0], from[1] + 2, from[2]], [x, y + 1, z], [x, y, z]]
    if (s.kind === 'down') return [[x, y + 2, z], [x, y + 1, z], [x, y, z]]
    return [[x, y + 1, z], [x, y, z]]
}
