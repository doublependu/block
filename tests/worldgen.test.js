import { describe, it, expect } from 'vitest'
import { createGenerator } from '../src/world/gen/index.js'
import { mix32 } from '../src/core/rng.js'

function chunkHash(gen, x, y, z, s) {
    const arr = new Uint16Array(s * s * s)
    gen.generateRegion(arr, x, y, z, s, s, s)
    let h = 0
    for (let i = 0; i < arr.length; i++) h = mix32(h ^ (arr[i] + i * 65536))
    return h
}

/*
 * Golden hashes for generator v1. If these fail, terrain output changed and
 * every committed world using version 1 would change: make terrain_v2 instead.
 */
const GOLDEN_V1 = {
    "default-valley|0|0|0": 4088648656,
    "default-valley|-72|-24|48": 951926211,
    "default-valley|24|24|-48": 2205980662,
    "ember-oak-7|48|0|48": 1849809406,
    "ember-oak-7|-96|0|-96": 3132080596
}

describe('terrain v1', () => {
    it('is deterministic for a seed', () => {
        const a = createGenerator(1, 'hello', 192)
        const b = createGenerator(1, 'hello', 192)
        expect(chunkHash(a, 0, 0, 0, 24)).toBe(chunkHash(b, 0, 0, 0, 24))
        expect(chunkHash(a, -48, -24, 24, 24)).toBe(chunkHash(b, -48, -24, 24, 24))
    })

    it('differs between seeds', () => {
        const a = createGenerator(1, 'hello', 192)
        const b = createGenerator(1, 'world', 192)
        expect(chunkHash(a, 24, 0, 24, 24)).not.toBe(chunkHash(b, 24, 0, 24, 24))
    })

    it('matches golden hashes', () => {
        const got = {}
        for (const key of Object.keys(GOLDEN_V1)) {
            const [seed, x, y, z] = key.split('|')
            got[key] = chunkHash(createGenerator(1, seed, 192), +x, +y, +z, 24)
        }
        expect(got).toEqual(GOLDEN_V1)
    })

    it('single voxel lookup agrees with region generation', () => {
        const g = createGenerator(1, 'probe', 192)
        const s = 16
        const arr = new Uint16Array(s * s * s)
        g.generateRegion(arr, 30, -8, -40, s, s, s)
        for (let n = 0; n < 200; n++) {
            const i = (n * 7) % s, j = (n * 11) % s, k = (n * 13) % s
            expect(g.blockAt(30 + i, -8 + j, -40 + k)).toBe(arr[i * s * s + j * s + k])
        }
    })

    it('is empty outside the world border and has bedrock at the bottom', () => {
        const g = createGenerator(1, 'edge', 128)
        expect(g.blockAt(64, 0, 0)).toBe(0)
        expect(g.blockAt(0, -24, 0)).toBe(1)
    })
})
