/*
 *  Unit-to-unit collision. Every tick, units whose bodies overlap are pushed
 *  apart along the line between them, the lighter one moving more, and each
 *  loses the part of its velocity that heads into the other. Pure: the
 *  unit manager turns units into bodies and applies the pushes through their
 *  velocities, so terrain and gates still hold them (UnitManager._resolveCrowd).
 */

/** spatial hash key of grid cell gx, gz */
export const gridKey = (gx, gz) => (gx * 73856093) ^ (gz * 19349663)
/** key of the cell holding x, z */
export const cellKey = (x, z, cell = CROWD.cell) => gridKey(Math.floor(x / cell), Math.floor(z / cell))

export const CROWD = {
    /** spatial hash cell (m) */
    cell: 2,
    iterations: 2,
    /** largest push per unit per tick (m): overlapping spawns spread out over a few ticks */
    maxPush: 0.15,
    /** bodies closer than the sum of their radii times this count as touching */
    contactSlack: 1.05,
    /** simulation step (s): fast units are caught before they overlap, by the distance they close in one step */
    dt: 0.03,
    /** steering around an ally in the way (radians) */
    steerTurn: 0.7,
    /** multipliers on a unit's own mass (UnitDef.mass, default 1) */
    mass: {
        /** hitting a block or the town center: holds its spot at a wall */
        busy: 3,
        /** your builder or the unit you play: a crowd can nudge you, you can't walk through it */
        controlled: 4,
    },
}

/**
 * @typedef {object} Body
 * @property {number} x
 * @property {number} y   feet
 * @property {number} z
 * @property {number} r   radius
 * @property {number} h   height
 * @property {number} mass  Infinity = never moves
 * @property {number[]} [v] velocity [x, y, z] (changed in place)
 * @property {number} [side]  bodies with the same side are allies (contact counts separately)
 * @property {number} [dx]  push to apply (output)
 * @property {number} [dz]
 * @property {number} [contacts]  touching bodies (output)
 * @property {number} [allyContacts]  touching bodies of the same side (output)
 */

/**
 * @param {Body[]} bodies
 * @param {Partial<typeof CROWD>} [opts]
 * @returns {number} overlapping pairs found in the first pass
 */
export function separate(bodies, opts = {}) {
    const { cell, iterations, maxPush, contactSlack, dt } = { ...CROWD, ...opts }
    const n = bodies.length
    const px = new Float64Array(n), pz = new Float64Array(n)
    const grid = new Map()
    for (let i = 0; i < n; i++) {
        const b = bodies[i]
        b.dx = b.dz = 0
        b.contacts = b.allyContacts = 0
        px[i] = b.x
        pz[i] = b.z
        const key = cellKey(b.x, b.z, cell)
        let list = grid.get(key)
        if (!list) grid.set(key, (list = []))
        list.push(i)
    }
    const stepMax = maxPush / iterations
    const sx = new Float64Array(n), sz = new Float64Array(n)
    let firstPairs = 0
    for (let it = 0; it < iterations; it++) {
        sx.fill(0)
        sz.fill(0)
        for (let i = 0; i < n; i++) {
            const a = bodies[i]
            const cx = Math.floor(px[i] / cell), cz = Math.floor(pz[i] / cell)
            for (let gx = cx - 1; gx <= cx + 1; gx++) {
                for (let gz = cz - 1; gz <= cz + 1; gz++) {
                    const list = grid.get(gridKey(gx, gz))
                    if (!list) continue
                    for (const j of list) {
                        if (j <= i) continue
                        const b = bodies[j]
                        // vertical overlap (a unit on a wall top doesn't bump one below)
                        if (a.y >= b.y + b.h - 0.1 || b.y >= a.y + a.h - 0.1) continue
                        let dx = px[i] - px[j], dz = pz[i] - pz[j]
                        const reach = a.r + b.r
                        const d2 = dx * dx + dz * dz
                        const near = reach * contactSlack + (it === 0 ? closingSpeed(a, b, dx, dz, d2) * dt : 0)
                        if (d2 >= near * near) continue
                        let d = Math.sqrt(d2)
                        if (d < 1e-4) {
                            // same spot: split along a fixed, pair-dependent direction
                            const ang = (i * 2.399 + j * 0.713) % (Math.PI * 2)
                            dx = Math.cos(ang)
                            dz = Math.sin(ang)
                            d = 1
                        } else {
                            dx /= d
                            dz /= d
                        }
                        if (it === 0) {
                            firstPairs++
                            a.contacts++
                            b.contacts++
                            if (a.side !== undefined && a.side === b.side) {
                                a.allyContacts++
                                b.allyContacts++
                            }
                            removeApproach(a, b, dx, dz)
                        }
                        const overlap = reach - Math.sqrt((px[i] - px[j]) ** 2 + (pz[i] - pz[j]) ** 2)
                        if (overlap <= 0) continue
                        const [wa, wb] = shares(a.mass, b.mass)
                        sx[i] += dx * overlap * wa
                        sz[i] += dz * overlap * wa
                        sx[j] -= dx * overlap * wb
                        sz[j] -= dz * overlap * wb
                    }
                }
            }
        }
        for (let i = 0; i < n; i++) {
            const len = Math.hypot(sx[i], sz[i])
            if (len < 1e-6) continue
            const k = len > stepMax ? stepMax / len : 1
            px[i] += sx[i] * k
            pz[i] += sz[i] * k
        }
    }
    for (let i = 0; i < n; i++) {
        bodies[i].dx = px[i] - bodies[i].x
        bodies[i].dz = pz[i] - bodies[i].z
    }
    return firstPairs
}

/** how much of a push each of two bodies takes */
function shares(ma, mb) {
    if (ma === Infinity && mb === Infinity) return [0, 0]
    if (ma === Infinity) return [0, 1]
    if (mb === Infinity) return [1, 0]
    return [mb / (ma + mb), ma / (ma + mb)]
}

/** how fast two bodies close in on each other (0 if they're parting); dx, dz from b to a, unnormalised */
function closingSpeed(a, b, dx, dz, d2) {
    if (d2 < 1e-8) return 0
    const d = Math.sqrt(d2)
    const nx = dx / d, nz = dz / d
    const an = a.v ? -(a.v[0] * nx + a.v[2] * nz) : 0
    const bn = b.v ? b.v[0] * nx + b.v[2] * nz : 0
    return Math.max(0, an) + Math.max(0, bn)
}

/**
 * Each of two touching bodies loses its own velocity toward the other (n points
 * from b to a); sideways motion is kept, so they slide past. Nobody shoves: the
 * overlap that's left is split by mass as a push.
 */
function removeApproach(a, b, nx, nz) {
    const va = a.v, vb = b.v
    const an = va ? -(va[0] * nx + va[2] * nz) : 0
    if (an > 0) {
        va[0] += nx * an
        va[2] += nz * an
    }
    const bn = vb ? vb[0] * nx + vb[2] * nz : 0
    if (bn > 0) {
        vb[0] -= nx * bn
        vb[2] -= nz * bn
    }
}
