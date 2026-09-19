/*
 *  A read-only view of the game for the bot. Anything reached through it can be
 *  read but not changed: assignments, deletes and calls to methods that aren't
 *  plain reads throw (and are counted), so the bot can only affect the game
 *  through input, like a player.
 */

/** methods that only read (any object that has them) */
const READS = new Set([
    'getBlock', 'peek', 'peekLoaded', 'surfaceY', 'inBounds', 'posOf', 'aliveAttackers', 'nearestEnemy', 'lineOfSight',
    'getPosition', 'getTargetPosition', 'getDirection', 'count', 'canAfford', 'getBlockSolidity', 'frontGroups',
    'hasComponent', 'getPhysics', 'getMovement', 'getFps', 'getGlInfo', 'pick', 'isTerrainBlocked', 'defenceValue',
    'unitOnRay', 'getScene', 'getViewMatrix', 'getProjectionMatrix',
])
const ARRAY_READS = new Set(['map', 'filter', 'forEach', 'some', 'every', 'find', 'findIndex', 'findLast', 'indexOf', 'lastIndexOf',
    'includes', 'reduce', 'reduceRight', 'slice', 'at', 'join', 'keys', 'values', 'entries', 'flatMap', 'flat', 'concat', 'toString'])
const COLLECTION_READS = new Set(['get', 'has'])
const COLLECTION_ITER = new Set(['values', 'keys', 'entries', 'forEach'])

export const violations = { count: 0, last: [] }

class ReadOnlyError extends Error {}

function refuse(what) {
    violations.count++
    if (violations.last.length < 20) violations.last.push(what)
    throw new ReadOnlyError(`autoplay bot is read-only: ${what}`)
}

const cache = new WeakMap()

/** @template T @param {T} v @returns {T} */
export function readonly(v) {
    if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v
    if (ArrayBuffer.isView(v)) return /** @type {any} */ (Array.from(/** @type {any} */ (v)))
    // DOM objects are what the player sees on screen: left as they are
    if (typeof v === 'function' || (typeof Node !== 'undefined' && v instanceof Node) || (typeof Window !== 'undefined' && v instanceof Window)) return v
    let p = cache.get(v)
    if (p) return p
    const isArray = Array.isArray(v)
    const isCollection = v instanceof Map || v instanceof Set
    p = new Proxy(v, {
        get(t, prop) {
            if (isCollection) {
                if (prop === 'size') return t.size
                if (COLLECTION_READS.has(prop)) return (k) => readonly(t[prop](k))
                if (prop === Symbol.iterator || COLLECTION_ITER.has(prop)) {
                    if (prop === 'forEach') return (fn) => t.forEach((val, key) => fn(readonly(val), readonly(key)))
                    const name = prop === Symbol.iterator ? (t instanceof Map ? 'entries' : 'values') : prop
                    return function* () {
                        for (const x of t[name]()) yield readonly(x)
                    }
                }
            }
            const val = Reflect.get(t, prop, t)
            if (typeof val === 'function') {
                if (isArray && (ARRAY_READS.has(/** @type {string} */ (prop)) || prop === Symbol.iterator)) return val.bind(p)
                if (READS.has(/** @type {string} */ (prop))) return (...a) => readonly(val.apply(t, a))
                if (prop === 'constructor') return val
                return () => refuse(`call ${String(prop)}()`)
            }
            return readonly(val)
        },
        set(_t, prop) {
            return refuse(`set ${String(prop)}`)
        },
        deleteProperty(_t, prop) {
            return refuse(`delete ${String(prop)}`)
        },
        defineProperty(_t, prop) {
            return refuse(`define ${String(prop)}`)
        },
    })
    cache.set(v, p)
    return p
}
