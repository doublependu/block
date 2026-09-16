/*
 *  Sparse voxel overlay, keyed by absolute voxel coordinates and bucketed by
 *  chunk so a chunk load only visits its own entries.
 *
 *  Used twice: for permanent player edits, and for temporary night damage.
 */

export class VoxelOverlay {
    /** @param {number} chunkSize */
    constructor(chunkSize) {
        this.size = chunkSize
        /** @type {Map<string, Map<number, number>>} chunkKey -> localIndex -> value */
        this.chunks = new Map()
        this.count = 0
    }

    chunkKey(x, y, z) {
        const s = this.size
        return `${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`
    }

    localIndex(x, y, z) {
        const s = this.size
        const i = x - Math.floor(x / s) * s
        const j = y - Math.floor(y / s) * s
        const k = z - Math.floor(z / s) * s
        return i * s * s + j * s + k
    }

    get(x, y, z) {
        const m = this.chunks.get(this.chunkKey(x, y, z))
        if (!m) return undefined
        return m.get(this.localIndex(x, y, z))
    }

    has(x, y, z) {
        return this.get(x, y, z) !== undefined
    }

    set(x, y, z, value) {
        const key = this.chunkKey(x, y, z)
        let m = this.chunks.get(key)
        if (!m) {
            m = new Map()
            this.chunks.set(key, m)
        }
        const li = this.localIndex(x, y, z)
        if (!m.has(li)) this.count++
        m.set(li, value)
    }

    delete(x, y, z) {
        const key = this.chunkKey(x, y, z)
        const m = this.chunks.get(key)
        if (!m) return
        const li = this.localIndex(x, y, z)
        if (m.delete(li)) this.count--
        if (m.size === 0) this.chunks.delete(key)
    }

    clear() {
        this.chunks.clear()
        this.count = 0
    }

    /** entries for the chunk whose corner is at world coords (x, y, z) */
    chunkEntries(x, y, z) {
        return this.chunks.get(this.chunkKey(x, y, z))
    }

    /** iterate all entries as absolute coords: fn(x, y, z, value) */
    forEach(fn) {
        const s = this.size
        for (const [key, m] of this.chunks) {
            const [cx, cy, cz] = key.split(',').map(Number)
            for (const [li, v] of m) {
                const i = Math.floor(li / (s * s))
                const j = Math.floor(li / s) % s
                const k = li % s
                fn(cx * s + i, cy * s + j, cz * s + k, v)
            }
        }
    }
}
