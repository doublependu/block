/*
 *  Deterministic hashing and PRNG helpers.
 *
 *  Everything here uses integer math (Math.imul, bit ops) only, so results
 *  are identical in every JS engine. Worldgen must not use Math.sin/cos/pow/exp,
 *  whose last bits differ between V8, SpiderMonkey and JavaScriptCore.
 */

/** 32-bit hash of a string (murmur-style mixing) */
export function hashString(str) {
    let h = 0x811c9dc5 | 0
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(h ^ str.charCodeAt(i), 0x01000193)
    }
    return mix32(h)
}

/** Final avalanche mix of a 32-bit integer */
export function mix32(h) {
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return h >>> 0
}

/** Hash of integer coordinates + salt, returns uint32 */
export function hash3(x, y, z, salt) {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1) ^ (salt | 0)
    return mix32(h)
}

/** Hash of integer coordinates + salt, returns float in [0, 1) */
export function rand3(x, y, z, salt) {
    return hash3(x, y, z, salt) / 4294967296
}

/** sfc32 PRNG, returns a function giving floats in [0, 1) */
export function makeRandom(seed) {
    let a = hashString('a' + seed), b = hashString('b' + seed)
    let c = hashString('c' + seed), d = hashString('d' + seed)
    const next = () => {
        a |= 0; b |= 0; c |= 0; d |= 0
        const t = (((a + b) | 0) + d) | 0
        d = (d + 1) | 0
        a = b ^ (b >>> 9)
        b = (c + (c << 3)) | 0
        c = (c << 21) | (c >>> 11)
        c = (c + t) | 0
        return (t >>> 0) / 4294967296
    }
    for (let i = 0; i < 15; i++) next()
    return next
}
