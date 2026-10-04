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
    /** the sound listener sits at most this far back from what the camera looks at (blocks) */
    listenerBack: 40,
    /** the camera's near plane while it's up here (it never comes closer than clearBlocks to anything) */
    nearPlane: 0.5,
    /** chunks load at least this far round what it looks at (horizontally, in chunks; the low tiers load less from the ground) */
    chunkReach: 3,
    /** and the town's chunks this far round it (blocks), so the land round the town fades out instead of ending */
    townMargin: 24,
    /** the ground fog's fade from clear to gone (blocks), at least and at most */
    fogBand: [12, 32],
}

/**
 * Framing the whole town from above (fitZoom): at an attack, at the dawn
 * after the opening raid, and how far the build view can zoom out.
 */
export const FRAME = {
    /** the town fills at most this share of the screen's height, and of its width */
    fillHeight: 0.75,
    fillWidth: 0.85,
    /** looking down this steeply (rad) */
    pitch: 1.0,
    /** a built block further than this from the town center (horizontally) isn't part of the town */
    reach: 64,
    /** with fewer built blocks than this, the town is framed as the starter town's wall ring */
    minBlocks: 8,
    fallbackRadius: 13,
    fallbackHeight: 4,
    /** the build view zooms out to this many times the whole-town view */
    buildOut: 1.25,
    /** framing a wave: the pivot moves this share of the town's radius toward its front */
    lean: 0.15,
    /** headings tried for a view that turns (the dawn orbit) */
    headings: 8,
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
 * pure: where a world point shows on the screen, the inverse of screenDir:
 * normalised device coordinates (-1..1, y up), and how far in front of the
 * camera it is along the view (≤ 0: behind it).
 * @param {number[]} eye the camera's position
 * @param {number[]} p the point
 * @returns {{nx: number, ny: number, depth: number}}
 */
export function screenPoint(heading, pitch, fov, aspect, eye, p) {
    const t = Math.tan(fov / 2)
    const [x, y, z] = toView(heading, pitch, p[0] - eye[0], p[1] - eye[1], p[2] - eye[2])
    return { nx: x / (z * t * aspect), ny: y / (z * t), depth: z }
}

/**
 * pure: a world offset in camera space (x right, y up, z along the view):
 * undo the heading, then the pitch (see screenDir)
 * @returns {number[]}
 */
export function toView(heading, pitch, x2, y1, z2) {
    const ch = Math.cos(heading), sh = Math.sin(heading)
    const x = x2 * ch - z2 * sh, z1 = x2 * sh + z2 * ch
    const cp = Math.cos(pitch), sp = Math.sin(pitch)
    return [x, y1 * cp + z1 * sp, z1 * cp - y1 * sp]
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
 * @param {number} [max] the zoom-out limit (Control works it out per town and screen)
 */
export function zoomStep(zoom, factor, max = AERIAL.maxZoom) {
    const next = zoom * factor
    if (factor < 1) return Math.min(zoom, Math.max(next, AERIAL.minZoom))
    return Math.max(zoom, Math.min(next, max))
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

/**
 * pure: the town's shape, for framing it: the corners of the lowest and the
 * highest built block in each of its columns, and the box around them. Built
 * blocks only (not trees, ore or dug earth), within FRAME.reach of the town
 * center; the town center itself is always in it. A town with almost nothing
 * built is framed as the starter town's wall ring.
 * @param {(fn: (x: number, y: number, z: number, id: number) => void) => void} forEachEdit every edit (VoxelOverlay.forEach)
 * @param {(id: number) => boolean} isBuilt
 * @param {number[]} townCenter
 * @returns {{points: number[][], min: number[], max: number[], center: number[], radius: number, blocks: number}}
 *   radius: how far the shape reaches from its center, horizontally
 */
export function townShape(forEachEdit, isBuilt, townCenter) {
    const [tx, ty, tz] = townCenter
    /** @type {Map<number, number[]>} column -> [x, z, lowest y, highest y] */
    const cols = new Map()
    let blocks = 0
    const add = (x, y, z) => {
        const k = (x + 4096) * 8192 + (z + 4096)
        const c = cols.get(k)
        if (!c) cols.set(k, [x, z, y, y])
        else if (y < c[2]) c[2] = y
        else if (y > c[3]) c[3] = y
    }
    forEachEdit((x, y, z, id) => {
        if (!id || !isBuilt(id)) return
        if (Math.hypot(x - tx, z - tz) > FRAME.reach) return
        blocks++
        add(x, y, z)
    })
    if (blocks < FRAME.minBlocks) {
        const r = FRAME.fallbackRadius
        for (const x of [tx - r, tx + r]) {
            for (const z of [tz - r, tz + r]) {
                add(x, ty - 1, z)
                add(x, ty + FRAME.fallbackHeight - 1, z)
            }
        }
    }
    // the town center: the core under the crystal, and the crystal
    add(tx, ty - 1, tz)
    add(tx, ty + 1, tz)
    const points = []
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    for (const [x, z, lo, hi] of cols.values()) {
        for (const y of [lo, hi + 1]) {
            for (const dx of [0, 1]) {
                for (const dz of [0, 1]) points.push([x + dx, y, z + dz])
            }
        }
        min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x + 1)
        min[1] = Math.min(min[1], lo); max[1] = Math.max(max[1], hi + 1)
        min[2] = Math.min(min[2], z); max[2] = Math.max(max[2], z + 1)
    }
    const center = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
    let radius = 0
    for (const p of points) radius = Math.max(radius, Math.hypot(p[0] - center[0], p[2] - center[2]))
    return { points, min, max, center, radius, blocks }
}

/**
 * pure: how far back from `pivot` the camera has to be for every point to be
 * on screen, inside FRAME.fillHeight of its height and FRAME.fillWidth of its
 * width. Exact for a perspective camera: each point needs the camera back by
 * a distance that's linear in its offset, and the furthest of those wins.
 * @param {number[][]} points
 * @param {number[]} pivot what the camera looks at (the middle of the screen)
 * @param {number} fov vertical field of view (rad)
 * @param {number} aspect width / height
 */
export function fitZoom(points, pivot, heading, pitch, fov, aspect) {
    const t = Math.tan(fov / 2)
    const fx = FRAME.fillWidth * t * aspect, fy = FRAME.fillHeight * t
    const ch = Math.cos(heading), sh = Math.sin(heading)
    const cp = Math.cos(pitch), sp = Math.sin(pitch)
    let need = 0
    for (const p of points) {
        // toView, inlined: this runs over thousands of points
        const x2 = p[0] - pivot[0], y1 = p[1] - pivot[1], z2 = p[2] - pivot[2]
        const x = x2 * ch - z2 * sh, z1 = x2 * sh + z2 * ch
        const y = y1 * cp + z1 * sp, z = z1 * cp - y1 * sp
        need = Math.max(need, Math.abs(x) / fx - z, Math.abs(y) / fy - z)
    }
    return need
}

/**
 * pure: fitZoom for a view that turns round the pivot (the dawn orbit): the
 * most any of FRAME.headings headings needs, so the zoom doesn't breathe.
 */
export function fitZoomAround(points, pivot, pitch, fov, aspect) {
    let need = 0
    for (let i = 0; i < FRAME.headings; i++) {
        need = Math.max(need, fitZoom(points, pivot, (i / FRAME.headings) * Math.PI * 2, pitch, fov, aspect))
    }
    return need
}

/** ringReach's answers, by reach */
const RING = new Map()

/**
 * pure: how far round the camera's target land is sure to be loaded
 * (blocks, horizontally), wherever in its chunk the target is, when noa loads
 * chunks within `reach` chunks of the target's chunk (its distance test, in
 * the target's row).
 * @param {number} reach chunks
 * @param {number} size blocks per chunk
 */
export function ringReach(reach, size) {
    const key = `${reach}|${size}`
    if (RING.has(key)) return RING.get(key)
    const n = Math.ceil(reach) + 2
    let sure = Infinity
    for (let px = 0; px < size; px += size / 12) {
        for (let pz = 0; pz < size; pz += size / 12) {
            for (let i = -n; i <= n; i++) {
                for (let k = -n; k <= n; k++) {
                    if (i * i + k * k <= reach * reach) continue
                    const dx = Math.max(i * size - px, 0, px - (i + 1) * size)
                    const dz = Math.max(k * size - pz, 0, pz - (k + 1) * size)
                    sure = Math.min(sure, Math.hypot(dx, dz))
                }
            }
        }
    }
    RING.set(key, sure)
    return sure
}

/**
 * pure: the aerial view's ground fog round the point it looks at (blocks,
 * horizontally): it ends where loaded land is sure to end, and starts past
 * the whole town when it can.
 * @param {number[]} at [x, z] the point
 * @param {{min: number[], max: number[]} | null} box the town's loaded box (blocks; x and z used), or null
 * @param {number} ring how far land is loaded round the point anyway (ringReach)
 * @param {{center: number[], radius: number}} town
 * @returns {number[]} [start, end]
 */
export function groundFogRange(at, box, ring, town) {
    let end = ring
    if (box && at[0] > box.min[0] && at[0] < box.max[0] && at[1] > box.min[2] && at[1] < box.max[2]) {
        end = Math.max(end, Math.min(at[0] - box.min[0], box.max[0] - at[0], at[1] - box.min[2], box.max[2] - at[1]))
    }
    const [lo, hi] = AERIAL.fogBand
    const townFar = town.radius + Math.hypot(at[0] - town.center[0], at[1] - town.center[2]) + 2
    const start = Math.max(end - hi, Math.min(end - lo, townFar))
    return [start, end]
}

/**
 * pure: the chunks to keep loaded for the town (noa's pinnedChunks): every
 * chunk its shape is in, with `margin` blocks of land round it (not above or
 * below), and the same box in blocks.
 * @param {{min: number[], max: number[]}} town townShape (max exclusive)
 * @param {number} margin blocks
 * @param {number} size blocks per chunk
 * @returns {{chunks: {min: number[], max: number[]}, blocks: {min: number[], max: number[]}}} chunks inclusive, blocks max exclusive
 */
export function pinnedBox(town, margin, size) {
    const at = (v) => Math.floor(v / size)
    const chunks = {
        min: [at(town.min[0] - margin), at(town.min[1]), at(town.min[2] - margin)],
        max: [at(town.max[0] - 1 + margin), at(town.max[1] - 1), at(town.max[2] - 1 + margin)],
    }
    return { chunks, blocks: { min: chunks.min.map((v) => v * size), max: chunks.max.map((v) => (v + 1) * size) } }
}
