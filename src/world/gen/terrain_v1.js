/*
 *  Terrain generator, version 1.
 *
 *  FROZEN once a world file references it: any change to the output of this
 *  file silently changes every committed world using generator version 1.
 *  Make a terrain_v2.js instead. Golden hashes in tests/worldgen.test.js
 *  catch accidental drift.
 *
 *  Only + - * / Math.floor Math.sqrt are used (bit-identical across engines).
 */

import { createNoise2D, createNoise3D } from 'simplex-noise'
import { makeRandom, hash3, rand3 } from '../../core/rng.js'
import { B } from '../blocks.js'

export const VERSION = 1
export const MIN_Y = -24
export const MAX_Y = 72
export const SEA_LEVEL = 0

const PLAZA_RADIUS = 9
const TREE_CELL = 7

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const smoothstep = (a, b, v) => {
    const t = clamp((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)
}

/**
 * @param {string} seed
 * @param {number} size  world width/depth in blocks (square, centred on origin)
 */
export function createTerrain(seed, size) {
    const rnd = makeRandom(seed)
    const n2a = createNoise2D(rnd)
    const n2b = createNoise2D(rnd)
    const n2c = createNoise2D(rnd)
    const n2d = createNoise2D(rnd)
    const n3a = createNoise3D(rnd)
    const n3b = createNoise3D(rnd)
    const n3c = createNoise3D(rnd)
    const salt = Math.floor(rnd() * 4294967296) | 0
    const half = size / 2

    const fbm2 = (noise, x, z, oct) => {
        let sum = 0, amp = 1, freq = 1, norm = 0
        for (let o = 0; o < oct; o++) {
            sum += amp * noise(x * freq, z * freq)
            norm += amp
            amp *= 0.5
            freq *= 2
        }
        return sum / norm
    }

    /** raw (unflattened) terrain height */
    const rawHeight = (x, z) => {
        const continental = fbm2(n2a, x / 110, z / 110, 3)
        const hills = fbm2(n2b, x / 34, z / 34, 2)
        const ridge = 1 - Math.abs(n2c(x / 70, z / 70))
        const mountainMask = smoothstep(0.15, 0.65, n2d(x / 150, z / 150))
        const mountains = ridge * ridge * ridge * mountainMask
        let h = 7 + continental * 9 + hills * 3.5 + mountains * 34
        // island falloff towards the world border
        const d = Math.max(Math.abs(x), Math.abs(z)) / half
        const f = smoothstep(0.7, 0.97, d)
        h = h * (1 - f) + -9 * f
        return h
    }

    const plazaHeight = clamp(Math.floor(rawHeight(0, 0)), 4, 14)

    /** final terrain surface height (float) */
    const heightAt = (x, z) => {
        const h = rawHeight(x, z)
        const r = Math.sqrt(x * x + z * z)
        const t = smoothstep(PLAZA_RADIUS + 4, PLAZA_RADIUS + 20, r)
        return plazaHeight * (1 - t) + h * t
    }

    /** biome surface block for a column */
    const surfaceBlock = (x, z, top) => {
        const r2 = x * x + z * z
        if (r2 <= PLAZA_RADIUS * PLAZA_RADIUS) return B.plaza
        if (r2 <= (PLAZA_RADIUS + 2) * (PLAZA_RADIUS + 2)) return B.dirt_path
        if (top <= SEA_LEVEL + 1) return B.sand
        if (top > 36) return B.snow
        const humidity = n2b(x / 90 + 311, z / 90 - 127)
        const temperature = n2c(x / 130 - 271, z / 130 + 97) - top * 0.015
        if (temperature > 0.35 && humidity < -0.1) return B.sand
        return B.grass
    }

    /** is there a tree rooted in this cell? returns [x, z, trunkHeight] or null */
    const treeInCell = (cx, cz) => {
        const h = hash3(cx, 0, cz, salt ^ 0x7ee)
        if ((h & 1023) / 1024 > 0.62) return null
        const tx = cx * TREE_CELL + 1 + ((h >>> 10) % (TREE_CELL - 2))
        const tz = cz * TREE_CELL + 1 + ((h >>> 16) % (TREE_CELL - 2))
        if (tx * tx + tz * tz < 30 * 30) return null
        const top = Math.floor(heightAt(tx, tz))
        if (top <= SEA_LEVEL + 1 || top > 34) return null
        if (surfaceBlock(tx, tz, top) !== B.grass) return null
        if (Math.max(Math.abs(tx), Math.abs(tz)) > half - 4) return null
        const trunk = 4 + ((h >>> 22) % 3)
        return [tx, top + 1, tz, trunk]
    }

    /**
     * Generate a box of voxels into `out` (index = i*sy*sz + j*sz + k).
     * Returns a fill block ID if the whole region is uniform, else -1.
     * @param {Uint16Array} out
     */
    const generateRegion = (out, x0, y0, z0, sx, sy, sz) => {
        // fast paths for regions fully above or below the world
        if (y0 > MAX_Y || y0 + sy <= MIN_Y) {
            out.fill(0)
            return 0
        }
        const x1 = x0 + sx, z1 = z0 + sz
        if (x1 <= -half || x0 >= half || z1 <= -half || z0 >= half) {
            out.fill(0)
            return 0
        }
        out.fill(0)
        const syz = sy * sz

        for (let i = 0; i < sx; i++) {
            const x = x0 + i
            if (x < -half || x >= half) continue
            for (let k = 0; k < sz; k++) {
                const z = z0 + k
                if (z < -half || z >= half) continue
                const hf = heightAt(x, z)
                const top = Math.floor(hf)
                const surf = surfaceBlock(x, z, top)
                const nearPlaza = x * x + z * z < (PLAZA_RADIUS + 12) * (PLAZA_RADIUS + 12)
                const sub = surf === B.sand ? B.sand : B.dirt
                for (let j = 0; j < sy; j++) {
                    const y = y0 + j
                    if (y < MIN_Y) continue
                    let id = 0
                    if (y === MIN_Y) {
                        id = B.bedrock
                    } else if (y <= top) {
                        const depth = top - y
                        if (depth === 0) id = surf
                        else if (depth <= 3) id = (surf === B.plaza || surf === B.dirt_path) ? B.dirt : sub
                        else {
                            id = B.stone
                            // ores
                            const oreR = rand3(x, y, z, salt)
                            if (oreR < 0.012 && y < top - 5) id = B.iron_ore
                            else if (oreR > 0.9955 && y < 2) id = B.gold_ore
                        }
                        // caves (not under the plaza, never breach bedrock)
                        if (depth >= 4 && y > MIN_Y + 2 && !nearPlaza) {
                            const a = n3a(x / 22, y / 14, z / 22)
                            const b = n3b(x / 22, y / 14, z / 22)
                            if (a * a + b * b < 0.012) id = 0
                            else if (n3c(x / 36, y / 20, z / 36) > 0.68) id = 0
                        }
                    } else if (y <= SEA_LEVEL) {
                        id = B.water
                    }
                    if (id) out[i * syz + j * sz + k] = id
                }
            }
        }

        // trees overlapping this region
        const cxMin = Math.floor((x0 - 3) / TREE_CELL), cxMax = Math.floor((x1 + 2) / TREE_CELL)
        const czMin = Math.floor((z0 - 3) / TREE_CELL), czMax = Math.floor((z1 + 2) / TREE_CELL)
        for (let cx = cxMin; cx <= cxMax; cx++) {
            for (let cz = czMin; cz <= czMax; cz++) {
                const t = treeInCell(cx, cz)
                if (!t) continue
                const [tx, ty, tz, trunk] = t
                if (ty > y0 + sy + 1 || ty + trunk + 2 < y0) continue
                const set = (x, y, z, id, onlyAir) => {
                    const i = x - x0, j = y - y0, k = z - z0
                    if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) return
                    const idx = i * syz + j * sz + k
                    if (onlyAir && out[idx] !== 0) return
                    out[idx] = id
                }
                const leafY = ty + trunk - 2
                for (let dy = 0; dy <= 3; dy++) {
                    const r = dy === 3 ? 1 : 2
                    for (let dx = -r; dx <= r; dx++) {
                        for (let dz = -r; dz <= r; dz++) {
                            if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2) continue
                            set(tx + dx, leafY + dy, tz + dz, B.leaves, true)
                        }
                    }
                }
                for (let dy = 0; dy < trunk; dy++) set(tx, ty + dy, tz, B.log, false)
            }
        }

        // town center structure: 3x3x3 core with a crystal on top, on the plaza
        const tcy = plazaHeight + 1
        if (x0 <= 1 && x1 > -1 && z0 <= 1 && z1 > -1 && y0 <= tcy + 3 && y0 + sy > tcy) {
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy < 3; dy++) {
                const i = dx - x0, j = tcy + dy - y0, k = dz - z0
                if (i < 0 || j < 0 || k < 0 || i >= sx || j >= sy || k >= sz) continue
                out[i * syz + j * sz + k] = B.town_core
            }
            const i = -x0, j = tcy + 3 - y0, k = -z0
            if (i >= 0 && j >= 0 && k >= 0 && i < sx && j < sy && k < sz) out[i * syz + j * sz + k] = B.town_crystal
        }

        // detect uniform regions (lets noa skip meshing/storage work)
        const first = out[0]
        for (let n = 1; n < out.length; n++) if (out[n] !== first) return -1
        return first
    }

    const single = new Uint16Array(1)
    return {
        version: VERSION,
        seed,
        size,
        plazaHeight,
        heightAt,
        generateRegion,
        /** single voxel lookup (slow-ish, for tools/tests) */
        blockAt(x, y, z) {
            generateRegion(single, x, y, z, 1, 1, 1)
            return single[0]
        },
        /** y of the first air block above the surface at (x, z) */
        surfaceY(x, z) {
            return Math.max(Math.floor(heightAt(x, z)), SEA_LEVEL) + 1
        },
    }
}
