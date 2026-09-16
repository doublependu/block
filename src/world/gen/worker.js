/*
 *  Worldgen worker. Generates base terrain for chunk requests, and can
 *  pre-generate chunks around spawn while the menu is still showing.
 *
 *  Messages in:
 *    { type: 'world', key, version, seed, size }
 *    { type: 'chunk', key, reqId, x, y, z, s }
 *    { type: 'prewarm', key, cx, cy, cz, s, radius, vRadius }
 *  Messages out:
 *    { type: 'chunk', key, reqId, buffer, fill }
 */

import { createGenerator } from './index.js'

let current = null
/** @type {Map<string, {buffer: ArrayBuffer, fill: number}>} */
let cache = new Map()
const MAX_CACHE = 400

function setWorld(msg) {
    if (current && current.key === msg.key) return
    current = { key: msg.key, gen: createGenerator(msg.version, msg.seed, msg.size) }
    cache = new Map()
    prewarmQueue = []
}

function generate(x, y, z, s) {
    const ck = `${x},${y},${z},${s}`
    const hit = cache.get(ck)
    if (hit) {
        cache.delete(ck)
        return hit
    }
    const arr = new Uint16Array(s * s * s)
    const fill = current.gen.generateRegion(arr, x, y, z, s, s, s)
    return { buffer: arr.buffer, fill }
}

self.onmessage = (e) => {
    const msg = e.data
    if (msg.type === 'world') return setWorld(msg)
    if (!current || msg.key !== current.key) return
    if (msg.type === 'chunk') {
        const { buffer, fill } = generate(msg.x, msg.y, msg.z, msg.s)
        const post = /** @type {any} */ (self).postMessage.bind(self)
        post({ type: 'chunk', key: msg.key, reqId: msg.reqId, buffer, fill }, [buffer])
    } else if (msg.type === 'prewarm') {
        const { s } = msg
        const list = []
        for (let i = -msg.radius; i <= msg.radius; i++)
            for (let k = -msg.radius; k <= msg.radius; k++)
                for (let j = -msg.vRadius; j <= msg.vRadius; j++)
                    list.push([msg.cx + i, msg.cy + j, msg.cz + k, i * i + k * k + j * j * 2])
        list.sort((a, b) => a[3] - b[3])
        prewarmQueue = list.map(([i, j, k]) => [i * s, j * s, k * s, s])
        schedulePrewarm()
    }
}

// prewarm in small slices, so real chunk requests are never blocked for long
let prewarmQueue = []
let prewarmScheduled = false
function schedulePrewarm() {
    if (prewarmScheduled) return
    prewarmScheduled = true
    setTimeout(() => {
        prewarmScheduled = false
        const t0 = performance.now()
        while (prewarmQueue.length && performance.now() - t0 < 8) {
            if (cache.size >= MAX_CACHE) { prewarmQueue = []; break }
            const [x, y, z, s] = prewarmQueue.shift()
            const ck = `${x},${y},${z},${s}`
            if (cache.has(ck)) continue
            const arr = new Uint16Array(s * s * s)
            const fill = current.gen.generateRegion(arr, x, y, z, s, s, s)
            cache.set(ck, { buffer: arr.buffer, fill })
        }
        if (prewarmQueue.length) schedulePrewarm()
    }, 0)
}
