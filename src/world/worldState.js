/*
 *  WorldState - the single source of truth for world voxels:
 *
 *    world(x,y,z) = nightDamage(x,y,z) ?? edits(x,y,z) ?? terrain(x,y,z)
 *
 *  Terrain comes from the (versioned, deterministic) generator in a worker.
 *  Edits are permanent and exported; night damage is temporary and is
 *  reverted at dawn. All permanent changes arrive as ops via SyncService.
 */

import { EventEmitter } from 'events'
import { VoxelOverlay } from './editStore.js'
import { AIR, BLOCK_BY_ID, blockId, blockName } from './blocks.js'
import { createGenerator } from './gen/index.js'
import { HP_PER_HARDNESS } from '../game/balance.js'
import { sortEdits } from './worldFile.js'

export class WorldState extends EventEmitter {
    /**
     * @param {import('noa-engine').Engine} noa
     * @param {import('./worldFile.js').WorldDef} def
     * @param {Worker} worker   worldgen worker
     */
    constructor(noa, def, worker) {
        super()
        this.noa = noa
        this.def = def
        this.worker = worker
        this.chunkSize = noa.world._chunkSize
        this.half = def.size / 2
        this.key = `${def.generator.version}|${def.seed}|${def.size}`
        /** main-thread generator copy, for spawn heights and base lookups */
        this.gen = createGenerator(def.generator.version, def.seed, def.size)
        this.edits = new VoxelOverlay(this.chunkSize)
        this.damage = new VoxelOverlay(this.chunkSize)
        /** @type {Map<string, number>} partial block damage: "x,y,z" -> hp left */
        this.blockHp = new Map()
        this._pending = new Map()
        this._reqCounter = 0

        for (const [x, y, z, name] of def.edits) this.edits.set(x, y, z, blockId(name))

        this._onWorkerMessage = (e) => this._receiveChunk(e.data)
        worker.addEventListener('message', this._onWorkerMessage)
        worker.postMessage({ type: 'world', key: this.key, version: def.generator.version, seed: def.seed, size: def.size })

        this._onDataNeeded = (id, arr, x, y, z) => {
            this._pending.set(id, arr)
            worker.postMessage({ type: 'chunk', key: this.key, reqId: id, x, y, z, s: arr.shape[0] })
        }
        noa.world.on('worldDataNeeded', this._onDataNeeded)
        noa.worldName = this.key
    }

    dispose() {
        this.worker.removeEventListener('message', this._onWorkerMessage)
        this.noa.world.off('worldDataNeeded', this._onDataNeeded)
        this.removeAllListeners()
    }

    /** ask the worker to pre-generate chunks around a point */
    prewarm(x, y, z, radius = 2, vRadius = 1) {
        const s = this.chunkSize
        this.worker.postMessage({
            type: 'prewarm', key: this.key, s, radius, vRadius,
            cx: Math.floor(x / s), cy: Math.floor(y / s), cz: Math.floor(z / s),
        })
    }

    _receiveChunk(msg) {
        if (msg.type !== 'chunk' || msg.key !== this.key) return
        const arr = this._pending.get(msg.reqId)
        if (!arr) return
        this._pending.delete(msg.reqId)
        const data = arr.data
        let fill = msg.fill
        const [i, j, k] = msg.reqId.split('|').map(Number)
        const s = this.chunkSize
        const edits = this.edits.chunkEntries(i * s, j * s, k * s)
        const damage = this.damage.chunkEntries(i * s, j * s, k * s)
        if (fill >= 0 && !edits && !damage) {
            this.noa.world.setChunkData(msg.reqId, arr, null, fill)
            return
        }
        data.set(new Uint16Array(msg.buffer))
        if (edits) for (const [li, id] of edits) data[li] = id
        if (damage) for (const li of damage.keys()) data[li] = AIR
        this.noa.world.setChunkData(msg.reqId, arr, null, -1)
    }

    // ---- queries -------------------------------------------------------

    inBounds(x, y, z) {
        return x >= -this.half && x < this.half && z >= -this.half && z < this.half
    }

    /** current block at a voxel (loaded chunks only; falls back to overlays + generator) */
    getBlock(x, y, z) {
        if (this.damage.has(x, y, z)) return AIR
        const e = this.edits.get(x, y, z)
        if (e !== undefined) return e
        return this.gen.blockAt(x, y, z)
    }

    /** fast lookup: loaded chunk data, else overlays + generator (slow) */
    peek(x, y, z) {
        const w = this.noa.world
        const [i, j, k] = w._coordsToChunkIndexes(x, y, z)
        const c = w._storage.getChunkByIndexes(i, j, k)
        if (!c) return this.getBlock(x, y, z)
        const [a, b, d] = w._coordsToChunkLocals(x, y, z)
        return c.voxels.get(a, b, d)
    }

    /** loaded chunk data only: the block, or -1 when its chunk isn't loaded (cheap, for scans) */
    peekLoaded(x, y, z) {
        const w = this.noa.world
        const [i, j, k] = w._coordsToChunkIndexes(x, y, z)
        const c = w._storage.getChunkByIndexes(i, j, k)
        if (!c) return -1
        const [a, b, d] = w._coordsToChunkLocals(x, y, z)
        return c.voxels.get(a, b, d)
    }

    /** terrain surface y (first air) at a column, ignoring edits */
    surfaceY(x, z) {
        return this.gen.surfaceY(x, z)
    }

    get townCenter() {
        return this.def.townCenter
    }

    // ---- permanent edits (applied from ops) ------------------------------

    /** @param {number} x @param {number} y @param {number} z @param {number} id */
    applyBlockEdit(x, y, z, id) {
        if (!this.inBounds(x, y, z)) return
        const prev = this.noa.getBlock(x, y, z)
        const base = this.gen.blockAt(x, y, z)
        if (id === base) this.edits.delete(x, y, z)
        else this.edits.set(x, y, z, id)
        this.damage.delete(x, y, z)
        this.blockHp.delete(`${x},${y},${z}`)
        this.noa.setBlock(id, x, y, z)
        this.emit('blockChanged', x, y, z, id, prev)
    }

    // ---- temporary night damage -----------------------------------------

    maxHp(id) {
        const def = BLOCK_BY_ID[id]
        if (!def || !isFinite(def.hardness)) return Infinity
        return Math.max(10, def.hardness * HP_PER_HARDNESS)
    }

    /**
     * Damage a block; destroys it (temporarily) when hp runs out.
     * @returns {boolean} true if the block was destroyed
     */
    damageBlock(x, y, z, amount) {
        const id = this.noa.getBlock(x, y, z)
        if (id === AIR) return false
        const max = this.maxHp(id)
        if (!isFinite(max)) return false
        const key = `${x},${y},${z}`
        const hp = (this.blockHp.has(key) ? this.blockHp.get(key) : max) - amount
        if (hp > 0) {
            this.blockHp.set(key, hp)
            this.emit('blockDamaged', x, y, z, hp / max)
            return false
        }
        this.blockHp.delete(key)
        if (!this.damage.has(x, y, z)) this.damage.set(x, y, z, id)
        this.noa.setBlock(AIR, x, y, z)
        this.emit('blockChanged', x, y, z, AIR, id)
        this.emit('blockDestroyed', x, y, z, id)
        return true
    }

    /**
     * Destroy a block outright (explosions, collapses, the crumbling town
     * center), ignoring hardness. Temporary like any night damage.
     * @returns {number} the destroyed block id (0 if there was nothing)
     */
    demolish(x, y, z) {
        if (!this.inBounds(x, y, z) || this.damage.has(x, y, z)) return AIR
        const id = this.peek(x, y, z)
        if (id === AIR || BLOCK_BY_ID[id]?.fluid) return AIR
        this.blockHp.delete(`${x},${y},${z}`)
        this.damage.set(x, y, z, id)
        this.noa.setBlock(AIR, x, y, z)
        this.emit('blockChanged', x, y, z, AIR, id)
        this.emit('blockDestroyed', x, y, z, id)
        return id
    }

    get damageCount() {
        return this.damage.count
    }

    /**
     * Put one destroyed block back (the dawn rebuild does them one by one).
     * @returns {boolean} false if it wasn't destroyed
     */
    restoreBlock(x, y, z) {
        const id = this.damage.get(x, y, z)
        if (id === undefined) return false
        this.damage.delete(x, y, z)
        this.blockHp.delete(`${x},${y},${z}`)
        this.noa.setBlock(id, x, y, z)
        this.emit('blockChanged', x, y, z, id, AIR)
        this.emit('blockRestored', x, y, z, id)
        return true
    }

    /** Restore up to `budget` destroyed blocks; returns how many remain */
    restoreDamage(budget) {
        this.blockHp.clear()
        if (this.damage.count === 0) return 0
        const restored = []
        this.damage.forEach((x, y, z, id) => {
            if (restored.length < budget) restored.push([x, y, z, id])
        })
        for (const [x, y, z, id] of restored) {
            this.damage.delete(x, y, z)
            this.noa.setBlock(id, x, y, z)
            this.emit('blockChanged', x, y, z, id, AIR)
            this.emit('blockRestored', x, y, z, id)
        }
        return this.damage.count
    }

    // ---- export ----------------------------------------------------------

    /** list of [x, y, z, blockName] edits, in stable file order */
    sortedEdits() {
        const out = []
        this.edits.forEach((x, y, z, id) => out.push([x, y, z, blockName(id)]))
        return sortEdits(out)
    }
}
