/*
 *  The aerial camera's maths (pure; Control drives it).
 *
 *  The camera flies at a fixed height. Panning moves it sideways and rotating
 *  turns it around what's in the middle of the screen; neither changes its
 *  height. Only zooming and tilting (along and around the line of sight),
 *  automatic glides, and a smooth lift over hills that would come up through
 *  it do.
 *
 *  State (Control.aerial): the camera looks at a pivot (x, y + lift, z) from
 *  `shown` blocks back along the view direction; `shown` eases toward `zoom`.
 *  The pivot's height never follows the ground. It changes only by
 *  re-anchoring, which slides the pivot along the line of sight, so the camera
 *  itself doesn't move.
 */

export const AERIAL = {
    minZoom: 12,
    maxZoom: 70,
    /** the shown zoom follows `zoom` at this rate (1/s) */
    zoomRate: 12,
    /** the camera stays this far above the terrain around it (blocks) */
    clearTerrain: 5,
    /** and this far above trees and buildings right under it */
    clearBlocks: 2,
    /** terrain is sampled this far around the camera (blocks), now and up to `ahead` s along its path */
    reach: 4,
    ahead: 0.5,
    /** but never more than this far ahead (blocks; glides and the pull-out when entering are fast) */
    maxAhead: 35,
    /** buildings and trees are looked for only this close to the terrain (blocks) */
    blocksBand: 20,
    /** the lift's spring: smooth time rising / settling back (s), and top speed (blocks/s) */
    rise: 0.12,
    fall: 0.4,
    maxLiftSpeed: 40,
}

/**
 * pure: the view direction for a heading and a pitch (down is positive), the
 * same as noa's camera.
 * @returns {number[]}
 */
export function viewDir(heading, pitch) {
    const c = Math.cos(pitch)
    return [c * Math.sin(heading), -Math.sin(pitch), c * Math.cos(heading)]
}

/**
 * pure: the direction through a point on the screen, in normalised device
 * coordinates (-1..1, y up), for a camera with a vertical field of view.
 * @returns {number[]} unit vector
 */
export function screenDir(heading, pitch, fov, aspect, nx, ny) {
    const t = Math.tan(fov / 2)
    // camera space (looking down +z), then pitch about x, then heading about y
    const x = nx * t * aspect, y = ny * t, z = 1
    const cp = Math.cos(pitch), sp = Math.sin(pitch)
    const y1 = y * cp - z * sp, z1 = y * sp + z * cp
    const ch = Math.cos(heading), sh = Math.sin(heading)
    const x2 = x * ch + z1 * sh, z2 = z1 * ch - x * sh
    const len = Math.hypot(x2, y1, z2)
    return [x2 / len, y1 / len, z2 / len]
}

/**
 * pure: where the camera is
 * @param {{x: number, y: number, z: number, shown: number, lift: number, heading: number, pitch: number}} a
 * @returns {number[]}
 */
export function cameraPos(a) {
    const d = viewDir(a.heading, a.pitch)
    return [a.x - d[0] * a.shown, a.y + a.lift - d[1] * a.shown, a.z - d[2] * a.shown]
}

/**
 * pure: slide the pivot along the line of sight until it's at height `gy`.
 * The camera doesn't move; zoom grows by what the pivot moved. A click-pan
 * target moves with it, so it still ends in the same place. Does nothing
 * (false) if that point is behind or right at the camera, or the view is
 * almost level.
 * @param {any} a Control.aerial
 */
export function reanchor(a, gy) {
    const s = Math.sin(a.pitch)
    if (s < 0.05) return false
    const t = (a.y + a.lift - gy) / s
    if (a.shown + t < 1 || a.zoom + t < 1) return false
    const d = viewDir(a.heading, a.pitch)
    a.x += d[0] * t
    a.z += d[2] * t
    if (a.tx !== undefined) {
        a.tx += d[0] * t
        a.tz += d[2] * t
    }
    a.y = gy - a.lift
    a.zoom += t
    a.shown += t
    return true
}

/**
 * pure: the next zoom for a zoom input. The limits only stop the input: a zoom
 * that re-anchoring left outside them doesn't jump back in.
 */
export function zoomStep(zoom, factor) {
    const next = zoom * factor
    if (factor < 1) return Math.min(zoom, Math.max(next, AERIAL.minZoom))
    return Math.max(zoom, Math.min(next, AERIAL.maxZoom))
}

/**
 * pure: pan one axis of the pivot inside the world (±half). A pivot that
 * re-anchoring left outside isn't pulled back; it just can't go further out.
 */
export function panAxis(v, dv, half) {
    const n = v + dv
    if (Math.abs(n) <= half || Math.abs(n) < Math.abs(v)) return n
    return Math.abs(v) > half ? v : Math.sign(n) * half
}

/**
 * pure: how high the terrain lets the camera fly: clear of the ground around
 * each of `points` (where it is, and where it's about to be).
 * @param {(x: number, z: number) => number} groundAt y of the first air block in a column
 * @param {number[][]} points [x, z]
 * @returns {{floor: number, ground: number}} the lowest camera height, and the highest ground seen
 */
export function terrainFloor(groundAt, points) {
    const r = AERIAL.reach
    let ground = -Infinity
    for (const [px, pz] of points) {
        for (let i = -1; i <= 1; i++) {
            for (let j = -1; j <= 1; j++) ground = Math.max(ground, groundAt(Math.floor(px + i * r), Math.floor(pz + j * r)))
        }
    }
    return { floor: ground + AERIAL.clearTerrain, ground }
}

/**
 * pure: where the camera will be in `t` s if the rig keeps moving as it did
 * last frame: the pivot's pan, the turn and the zoom, so turning follows the
 * circle it's on rather than a tangent off it.
 * @param {any} a Control.aerial
 * @param {{x: number, z: number, heading: number, shown: number}} rate per second
 */
export function cameraAhead(a, rate, t) {
    return cameraPos({
        x: a.x + rate.x * t, y: a.y, z: a.z + rate.z * t, lift: a.lift,
        heading: a.heading + rate.heading * t, pitch: a.pitch, shown: Math.max(0, a.shown + rate.shown * t),
    })
}

/**
 * pure: how high trees and buildings right under the camera let it fly: the
 * top of the highest solid block in the 3×3 columns under it, from a little
 * above the camera down to the ground, plus a margin. -Infinity when there
 * are none, or when the camera is far above anything that tall.
 * @param {(x: number, y: number, z: number) => boolean} solidAt
 * @param {number} camY the camera's height
 * @param {number} ground the highest ground around (terrainFloor)
 */
export function blocksFloor(solidAt, x, z, camY, ground) {
    if (camY - ground > AERIAL.blocksBand) return -Infinity
    const from = Math.floor(camY) + 2
    let top = -Infinity
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const bx = Math.floor(x + i), bz = Math.floor(z + j)
            for (let y = from; y >= ground && y > top; y--) {
                if (solidAt(bx, y, bz)) {
                    top = y + 1
                    break
                }
            }
        }
    }
    return top + AERIAL.clearBlocks
}

/**
 * pure: a critically damped step of `cur` toward `target` (Unity's
 * SmoothDamp): no overshoot, no jump in speed, and never more than
 * `maxSpeed` × dt in one step.
 * @returns {number[]} [value, velocity]
 */
export function smoothDamp(cur, target, vel, time, maxSpeed, dt) {
    if (dt <= 0) return [cur, vel]
    const omega = 2 / Math.max(1e-4, time)
    const x = omega * dt
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
    const maxChange = maxSpeed * time
    const change = Math.max(-maxChange, Math.min(maxChange, cur - target))
    const temp = (vel + omega * change) * dt
    let v = (vel - omega * temp) * exp
    let out = cur - change + (change + temp) * exp
    // no overshoot
    if ((target - cur > 0) === (out > target)) {
        out = target
        v = 0
    }
    // the speed cap, per step
    const step = maxSpeed * dt
    if (out > cur + step) {
        out = cur + step
        v = Math.min(v, maxSpeed)
    } else if (out < cur - step) {
        out = cur - step
        v = Math.max(v, -maxSpeed)
    }
    return [out, v]
}

/**
 * pure: move the lift toward what's needed to keep the camera at or above
 * `need` blocks of lift: quickly up, slowly back down.
 * @param {{lift: number, liftV: number}} a
 */
export function stepLift(a, need, dt) {
    const target = Math.max(0, need)
    const time = target > a.lift ? AERIAL.rise : AERIAL.fall
    const [lift, v] = smoothDamp(a.lift, target, a.liftV, time, AERIAL.maxLiftSpeed, dt)
    a.lift = lift
    a.liftV = v
}

/**
 * pure: the rig's state to measure its motion from next frame (liftFrame)
 * @param {any} a Control.aerial
 */
export function motionFrom(a) {
    return { x: a.x, z: a.z, heading: a.heading, shown: a.shown }
}

/**
 * pure (given the lookups): one frame of the hill lift. When the ground, a
 * tree or a building comes up toward the camera, the whole rig rises smoothly
 * to stay clear of it, and settles back down after. It looks ahead along the
 * path the camera is on (cameraAhead).
 *
 * The lift is a vertical offset on top of the pivot: it doesn't move the pivot
 * sideways, so turning still turns around the same spot.
 * @param {any} a Control.aerial
 * @param {{x: number, z: number, heading: number, shown: number}} prev the rig last frame (motionFrom; updated)
 * @param {(x: number, z: number) => number} groundAt
 * @param {(x: number, y: number, z: number) => boolean} solidAt
 */
export function liftFrame(a, prev, groundAt, solidAt, dt) {
    const c = cameraPos(a)
    const points = [[c[0], c[2]]]
    if (dt > 0) {
        let dh = a.heading - prev.heading
        dh -= Math.round(dh / (Math.PI * 2)) * Math.PI * 2
        const rate = { x: (a.x - prev.x) / dt, z: (a.z - prev.z) / dt, heading: dh / dt, shown: (a.shown - prev.shown) / dt }
        let t = AERIAL.ahead
        const end = cameraAhead(a, rate, t)
        const far = Math.hypot(end[0] - c[0], end[2] - c[2])
        if (far > AERIAL.maxAhead) t *= AERIAL.maxAhead / far
        if (far > 0.25) {
            // halfway too, so a hill between here and there isn't skipped
            for (const k of [0.5, 1]) {
                const p = cameraAhead(a, rate, t * k)
                points.push([p[0], p[2]])
            }
        }
    }
    Object.assign(prev, motionFrom(a))
    const g = terrainFloor(groundAt, points)
    const floor = Math.max(g.floor, blocksFloor(solidAt, c[0], c[2], c[1], g.ground))
    stepLift(a, floor - (c[1] - a.lift), dt)
}
