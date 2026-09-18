/*
 *  Animation curve fixes, shared by the GLB build step (tools/fix-glb-animations.mjs)
 *  and the character loader (external GLBs).
 *
 *  q and -q are the same rotation, but cubic-spline curves (and Babylon's
 *  Hermite interpolation) blend quaternion components, so a sign flip between
 *  two keys whips the bone through a wrong arc. Exporters that write every
 *  key with w >= 0 produce exactly that on limbs whose rest pose is 180°
 *  (arms and legs pointing down) whenever a swing crosses it.
 */

/**
 * A curve key. Tangents are derivatives per unit of `t` (seconds in glTF,
 * frames in Babylon), for cubic-spline curves only.
 * @typedef {object} CurveKey
 * @property {number} t
 * @property {number[]} v
 * @property {number[]} [i] in tangent
 * @property {number[]} [o] out tangent
 */

const dot = (a, b) => {
    let s = 0
    for (let c = 0; c < a.length; c++) s += a[c] * b[c]
    return s
}

/** @param {number[][]} values quaternions [x, y, z, w] in key order */
export function countQuaternionFlips(values) {
    let n = 0
    for (let k = 1; k < values.length; k++) if (dot(values[k], values[k - 1]) < 0) n++
    return n
}

/** first and last key hold the same value (a looping curve) */
export function isLoopCurve(keys, eps = 1e-4) {
    if (keys.length < 3) return false
    const a = keys[0].v, b = keys[keys.length - 1].v
    for (let c = 0; c < a.length; c++) if (Math.abs(a[c] - b[c]) > eps) return false
    return true
}

/**
 * Clamped Catmull-Rom tangent at key k: the slope between the neighbours, per
 * component, and flat where the component peaks (like Blender's auto-clamped
 * handles). Looping curves wrap around at the ends; other curves are flat there.
 * @param {CurveKey[]} keys
 * @param {number} k
 * @param {boolean} loop
 */
export function curveTangent(keys, k, loop) {
    const n = keys.length
    const dim = keys[k].v.length
    const out = new Array(dim).fill(0)
    let prev, next, span
    if (k > 0 && k < n - 1) {
        prev = keys[k - 1]
        next = keys[k + 1]
        span = next.t - prev.t
    } else if (loop && n >= 3) {
        prev = keys[n - 2]
        next = keys[1]
        span = keys[n - 1].t - keys[n - 2].t + keys[1].t - keys[0].t
    } else return out
    if (!(span > 0)) return out
    const b = keys[k].v
    for (let c = 0; c < dim; c++) {
        const d0 = b[c] - prev.v[c], d1 = next.v[c] - b[c]
        out[c] = d0 * d1 <= 0 ? 0 : (next.v[c] - prev.v[c]) / span
    }
    return out
}

/**
 * Put every rotation key in the same hemisphere as the one before it. When a
 * cubic-spline curve had flips, its tangents were computed across them too:
 * they're recomputed from the aligned keys.
 * @param {CurveKey[]} keys modified in place
 * @returns {number} how many keys were flipped
 */
export function alignQuaternionKeys(keys) {
    let flips = 0
    for (let k = 1; k < keys.length; k++) {
        const key = keys[k]
        if (dot(key.v, keys[k - 1].v) >= 0) continue
        flips++
        key.v = key.v.map((x) => -x)
        if (key.i) key.i = key.i.map((x) => -x)
        if (key.o) key.o = key.o.map((x) => -x)
    }
    if (flips && keys[0].i) {
        const loop = isLoopCurve(keys)
        const tangents = keys.map((_, k) => curveTangent(keys, k, loop))
        keys.forEach((key, k) => {
            key.i = tangents[k].slice()
            key.o = tangents[k].slice()
        })
    }
    return flips
}

/**
 * Make a looping cubic-spline curve pass smoothly through its start/end key
 * (exporters flatten the tangents there, so every cycle hitches).
 * @param {CurveKey[]} keys modified in place
 * @returns {boolean} whether the seam was changed
 */
export function smoothLoopSeam(keys) {
    if (!keys[0].i || !isLoopCurve(keys)) return false
    const t = curveTangent(keys, 0, true)
    keys[0].i = t.slice()
    keys[0].o = t.slice()
    keys[keys.length - 1].i = t.slice()
    keys[keys.length - 1].o = t.slice()
    return true
}

/**
 * Evaluate a curve at time `t` (cubic Hermite with tangents, else linear;
 * quaternions are normalised). For tests and tools.
 * @param {CurveKey[]} keys
 * @param {number} t
 */
export function sampleCurve(keys, t) {
    const n = keys.length
    if (t <= keys[0].t) return keys[0].v.slice()
    if (t >= keys[n - 1].t) return keys[n - 1].v.slice()
    let k = 0
    while (k < n - 2 && keys[k + 1].t < t) k++
    const a = keys[k], b = keys[k + 1]
    const td = b.t - a.t
    const s = (t - a.t) / td
    const out = new Array(a.v.length)
    if (a.o && b.i) {
        const s2 = s * s, s3 = s2 * s
        const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2
        for (let c = 0; c < out.length; c++) out[c] = h00 * a.v[c] + h10 * td * a.o[c] + h01 * b.v[c] + h11 * td * b.i[c]
    } else {
        for (let c = 0; c < out.length; c++) out[c] = a.v[c] + (b.v[c] - a.v[c]) * s
    }
    if (out.length === 4) {
        const len = Math.hypot(out[0], out[1], out[2], out[3]) || 1
        for (let c = 0; c < 4; c++) out[c] /= len
    }
    return out
}
