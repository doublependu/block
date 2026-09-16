/*
 *  Main-thread side of the nav worker: keeps the latest flow fields and
 *  answers "where do I step next" for attackers.
 */

import { AIR, BLOCK_BY_ID } from '../world/blocks.js'

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
const NONE_Y = 255

export class NavClient {
    /**
     * @param {import('../world/worldState.js').WorldState} world
     */
    constructor(world) {
        this.world = world
        this.field = null
        this.version = 0
        this.worker = new Worker(new URL('./nav.worker.js', import.meta.url), { type: 'module' })
        this.worker.onmessage = (e) => {
            if (e.data.type === 'field') {
                this.field = e.data
                this.version++
            }
        }
        this._pending = []
        this._flushTimer = null
        const def = world.def
        const blocks = []
        world.edits.forEach((x, y, z, id) => blocks.push([x, y, z, id]))
        world.damage.forEach((x, y, z) => blocks.push([x, y, z, AIR]))
        this.worker.postMessage({ type: 'init', version: def.generator.version, seed: def.seed, size: def.size, blocks })
        world.on('blockChanged', (x, y, z, id) => this._queue(x, y, z, id))
    }

    get ready() {
        return !!this.field
    }

    _queue(x, y, z, id) {
        this._pending.push([x, y, z, id])
        if (!this._flushTimer) {
            this._flushTimer = setTimeout(() => {
                this._flushTimer = null
                const list = this._pending
                this._pending = []
                this.worker.postMessage({ type: 'blocks', list })
            }, 100)
        }
    }

    /** node slot at a position, or -1 */
    _slotAt(col, fy) {
        const f = this.field
        const base = col * f.L
        let best = -1, bestD = 2
        for (let s = 0; s < f.L; s++) {
            const ny = f.nodeY[base + s]
            if (ny === NONE_Y) continue
            const d = Math.abs(ny + f.minY - fy)
            if (d < bestD) {
                best = s
                bestD = d
            }
        }
        return best
    }

    /**
     * Next step towards the town center from a position.
     * @returns {null | {atGoal: boolean, x: number, y: number, z: number, dist: number, dy: number}}
     */
    nextStep(px, py, pz, digger = false) {
        const f = this.field
        if (!f) return null
        const x = Math.floor(px), z = Math.floor(pz)
        if (x < -f.half || x >= f.half || z < -f.half || z >= f.half) return null
        const col = (x + f.half) * f.W + (z + f.half)
        const fy = Math.floor(py + 0.05)
        const s = this._slotAt(col, fy)
        if (s < 0) return null
        const node = col * f.L + s
        const code = (digger ? f.digger : f.walker)[node]
        const dist = (digger ? f.diggerDist : f.walkerDist)[node]
        if (code === 0xff) return null
        const y0 = f.nodeY[node] + f.minY
        if (code === 0xfe) return { atGoal: true, x: x + 0.5, y: y0, z: z + 0.5, dist: 0, dy: 0 }
        const d = code >> 3, slot = code & 7
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1]
        const ncol = (nx + f.half) * f.W + (nz + f.half)
        const ny = f.nodeY[ncol * f.L + slot] + f.minY
        return { atGoal: false, x: nx + 0.5, y: ny, z: nz + 0.5, dist, dy: ny - y0 }
    }

    /** built (breakable) blocks occupying the body cells of a node */
    blockersAt(x, y, z) {
        const out = []
        for (const yy of [y, y + 1]) {
            const id = this.world.noa.getBlock(x, yy, z)
            const b = BLOCK_BY_ID[id]
            if (b && (b.solid || b.gate) && id !== AIR) out.push([x, yy, z, id])
        }
        return out
    }

    dispose() {
        this.worker.terminate()
    }
}
