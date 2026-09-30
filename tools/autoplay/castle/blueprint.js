/*
 *  The castle for the recording (plan 10 §3.4): ref/castle.jpg at roughly half
 *  scale, in parts, as block cells. Pure: the terrain comes in as groundAt, so
 *  tests and the bot use the same design.
 *
 *  Read left to right in the photo, the castle runs west to east (x):
 *
 *    Palas         the tall main hall at the west end: white stone, rows of
 *                  arched windows, a steep slate roof with dormers, a stepped
 *                  gable at the west end, corner turrets, and a stair tower
 *                  standing in front of its long south face
 *    tall tower    slim, round, the tallest thing: behind the Palas, with a
 *                  gallery near the top and a slim spire
 *    knights' wing lower, along the south side of the courtyard, with green
 *                  copper turrets
 *    square tower  square, at the south-east: arched belfry openings
 *                  near the top, a crenellated gallery, a pyramid roof
 *    gatehouse     red brick at the east end, the gate through it, round
 *                  towers with battlements at its corners
 *    curtain wall  white walls with battlements closing the courtyard, where
 *                  the Town Center stands
 *    base course   cobble under all of it, down to the ground: the castle's
 *                  own rock (no seed has a crag, see seeds.mjs)
 *
 *  The Town Center (a 3×3 core at the origin) is in the courtyard, and the cell
 *  a new player spawns in (the Town Center + 5.5 south) stays open.
 *
 *  Archery towers go on the high places: the tall tower's gallery, the Palas
 *  eaves, the square tower's gallery, the gatehouse towers, the curtain wall's
 *  corners and the gate. They are placed as the parts under them are done.
 */

/** the seed chosen by seeds.mjs (flat enough, a lake and hills in view, trees in reach) */
export const SEED = 'swan-rock-2946'

/** the castle's floor: the first air above the plaza (the plaza is always at 7, see seeds.mjs) */
export const FLOOR = 8

/** courses of every part built first, all round (see the build order in buildCastle) */
export const OUTLINE = 3

/** where a new player appears in any world: the Town Center + (0.5, 0, 5.5) (session.js) */
export const SPAWN = [0, FLOOR, 5]

/**
 * @typedef {{x: number, y: number, z: number, block: string, part: string}} Cell
 * @typedef {{x: number, y: number, z: number, block: string, part: string, spot: string, ground?: boolean}} TowerSpot
 *   (ground: built on the ground, where the game puts it on a 2-block column: the tower ends 2 higher)
 */

/**
 * The castle.
 * @param {object} [o]
 * @param {(x: number, z: number) => number} [o.groundAt] first air above the natural ground (the generator's surfaceY); without it, flat at FLOOR
 * @returns {{cells: [number, number, number, string][], parts: {name: string, cells: [number, number, number, string][]}[],
 *   towers: TowerSpot[], counts: Record<string, number>, views: Record<string, any>}}
 */
export function buildCastle({ groundAt = () => FLOOR } = {}) {
    /**
     * key → [x, y, z, block, part]. A later write changes the block (a window
     * over a wall, a tower through a cornice) but not the part: the cell is
     * still built in the first part's turn, where its neighbours are.
     */
    const map = new Map()
    let part = ''
    const key = (x, y, z) => `${x},${y},${z}`
    const put = (x, y, z, block) => {
        const old = map.get(key(x, y, z))
        map.set(key(x, y, z), [x, y, z, block, old ? old[4] : part])
    }
    const del = (x, y, z) => map.delete(key(x, y, z))
    const has = (x, y, z) => map.has(key(x, y, z))

    // ---- primitives ------------------------------------------------------------------
    /** the ring of a rectangle x0..x1 × z0..z1 (inclusive) */
    const rectRing = (x0, x1, z0, z1) => {
        const out = []
        for (let x = x0; x <= x1; x++) out.push([x, z0], [x, z1])
        for (let z = z0 + 1; z < z1; z++) out.push([x0, z], [x1, z])
        return out
    }
    /** a round ring: the cells whose centres are about r from (cx, cz) (cx, cz may be half-way) */
    const circleRing = (cx, cz, r) => {
        const out = []
        const R = Math.ceil(r) + 1
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
            for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
                const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz)
                if (d <= r + 0.5 && d > r - 0.5) out.push([x, z])
            }
        }
        return out
    }
    const circleDisc = (cx, cz, r) => {
        const out = []
        const R = Math.ceil(r) + 1
        for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
            for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) if (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) <= r + 0.5) out.push([x, z])
        }
        return out
    }
    /** walls up a ring from y0 for h blocks */
    const raise = (ring, y0, h, block) => {
        for (let y = y0; y < y0 + h; y++) for (const [x, z] of ring) put(x, y, z, block)
    }
    /** windows in a ring's walls: every `every`-th cell along it (skipping corners), at the given heights */
    const windows = (ring, heights, every = 2, block = 'window') => {
        ring.forEach(([x, z], i) => {
            if (i % every) return
            for (const y of heights) if (has(x, y, z)) put(x, y, z, block)
        })
    }
    /** a spire: rings shrinking from r, two courses each, to a tall thin point and a finial (the photo's needles) */
    const spire = (cx, cz, r, y0, block, finial = 'iron_wall') => {
        let y = y0
        for (let rr = r; rr >= 0.5; rr -= 0.6) {
            for (let k = 0; k < 2; k++) {
                for (const [x, z] of circleDisc(cx, cz, rr)) put(x, y, z, block)
                y++
            }
        }
        const px = Math.floor(cx), pz = Math.floor(cz)
        for (let k = 0; k < 3; k++) put(px, y + k, pz, block)
        put(px, y + 3, pz, finial)
        return y + 4
    }
    /** a gabled roof over x0..x1 × z0..z1 with its ridge along x: each course steps in 1 on both long sides */
    const gableRoof = (x0, x1, z0, z1, y0, block) => {
        // the first course sits on the wall tops (an overhang would have nothing to be built against)
        let y = y0, a = z0, b = z1
        while (a <= b) {
            for (let x = x0; x <= x1; x++) {
                put(x, y, a, block)
                put(x, y, b, block)
            }
            a++
            b--
            y++
        }
        return y
    }
    /** a pyramid roof over a square */
    const pyramid = (x0, x1, z0, z1, y0, block) => {
        let y = y0
        for (let i = 0; x0 + i <= x1 - i && z0 + i <= z1 - i; i++) {
            for (const [x, z] of rectRing(x0 - 1 + i, x1 + 1 - i, z0 - 1 + i, z1 + 1 - i)) put(x, y, z, block)
            y++
        }
        return y
    }
    /** battlements: every other cell of a ring, one up */
    const merlons = (ring, y, block) => ring.forEach(([x, z], i) => { if (i % 2 === 0) put(x, y, z, block) })
    /**
     * Fill the ground up to the floor under a footprint (the castle's own rock),
     * where the terrain dips. The design is drawn mirrored (see below): the
     * ground a cell will stand on is at the mirrored z.
     */
    const footing = (cells, block = 'cobble') => {
        for (const [x, z] of cells) for (let y = groundAt(x, z === 0 ? 0 : -z); y < FLOOR; y++) put(x, y, z, block)
    }
    const rectCells = (x0, x1, z0, z1) => {
        const out = []
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z])
        return out
    }

    const parts = []
    const towers = []
    const tower = (x, y, z, spot, block = 'arrow_tower') => towers.push({ x, y, z, block, part, spot })
    const begin = (name) => { part = name }

    // Laid out with the Palas's long face to the south (+z) as drawn here; the
    // whole thing is mirrored to -z at the end (Babylon is left-handed: seen from
    // the front, that puts the Palas on the left, as in the photo)

    // ---- base course: the rock under everything --------------------------------------
    begin('base course')
    footing([
        ...rectCells(-30, -12, -6, 5),     // Palas
        ...circleDisc(-18.5, -8.5, 3),     // tall tower
        ...circleDisc(-21.5, 6.5, 2), ...circleDisc(-12.5, 6.5, 2),
        ...rectCells(-11, 5, 8, 11),       // knights' wing
        ...rectCells(7, 11, 7, 11), ...circleDisc(12.5, 11.5, 1.5), // square tower and its stair turret
        ...rectCells(15, 22, -5, 5),       // gatehouse
        ...circleDisc(23.5, 6.5, 2), ...circleDisc(23.5, -5.5, 2),
        ...rectCells(-15, 15, -11, -11), ...rectCells(12, 22, 8, 8), // curtain walls
        ...rectCells(-15, -15, -10, -6), ...rectCells(15, 15, -10, -6), ...rectCells(6, 6, 7, 12),
    ])

    // ---- Palas -----------------------------------------------------------------------
    begin('Palas')
    const PH = 11 // wall height
    const palas = rectRing(-29, -13, -5, 4)
    raise(palas, FLOOR, PH, 'ashlar')
    // a cobble plinth course, then rows of paired windows on every storey
    for (const [x, z] of palas) put(x, FLOOR, z, 'cobble')
    windows(palas, [FLOOR + 3, FLOOR + 6, FLOOR + 9], 2)
    // the door into the courtyard, at the east end
    for (const y of [FLOOR, FLOOR + 1]) for (const z of [-1, 0]) del(-13, y, z)
    // a string course of cobble between the hall and the roof
    for (const [x, z] of rectRing(-30, -12, -6, 5)) put(x, FLOOR + PH - 1, z, 'cobble')
    const eaves = FLOOR + PH
    const ridgeTop = gableRoof(-29, -13, -5, 4, eaves, 'slate')
    // the stepped gable at the west end: the wall climbs with the roof, stepping in
    for (let y = eaves, a = -5, b = 4; a <= b; y++, a++, b--) {
        for (let z = a; z <= b; z++) put(-30, y, z, 'ashlar')
    }
    // dormers along the south slope
    for (const x of [-26, -21, -16]) {
        for (const y of [eaves, eaves + 1]) { put(x, y, 5, 'ashlar'); put(x + 1, y, 5, 'ashlar') }
        put(x, eaves + 1, 5, 'window')
        for (const dx of [0, 1]) put(x + dx, eaves + 2, 5, 'slate')
    }
    // corner turrets on the west eaves, with spires
    for (const [cx, cz] of [[-29.5, 5.5], [-29.5, -5.5]]) {
        raise(circleRing(cx, cz, 1), eaves - 4, 6, 'ashlar')
        spire(cx, cz, 1.6, eaves + 2, 'slate')
    }
    tower(-13, eaves, -6, 'Palas east eave, north')
    tower(-30, ridgeTop - 1, -1, 'Palas west gable')

    // ---- the stair tower in front of the Palas, and the east corner tower -------------
    begin('stair towers')
    const stair = circleRing(-21.5, 6.5, 1.6)
    raise(stair, FLOOR, PH + 5, 'ashlar')
    windows(stair, [FLOOR + 4, FLOOR + 8, FLOOR + 12], 3)
    spire(-21.5, 6.5, 2.2, FLOOR + PH + 5, 'slate')
    const corner = circleRing(-12.5, 6.5, 1.6)
    raise(corner, FLOOR, PH + 3, 'ashlar')
    windows(corner, [FLOOR + 5, FLOOR + 10], 3)
    const cornerTop = FLOOR + PH + 3
    for (const [x, z] of circleDisc(-12.5, 6.5, 2.1)) put(x, cornerTop - 1, z, 'ashlar')
    merlons(circleRing(-12.5, 6.5, 2.1), cornerTop, 'ashlar')
    tower(-13, cornerTop, 6, 'corner tower top')

    // ---- the tall tower behind the Palas ----------------------------------------------
    begin('tall tower')
    const TT = 15
    const tall = circleRing(-18.5, -8.5, 1.6)
    raise(tall, FLOOR, TT, 'ashlar')
    windows(tall, [FLOOR + 5, FLOOR + 10], 3)
    // the gallery: a ring a step wider, with battlements
    const galleryY = FLOOR + TT
    for (const [x, z] of circleDisc(-18.5, -8.5, 3.6)) put(x, galleryY, z, 'ashlar')
    merlons(circleRing(-18.5, -8.5, 3.6), galleryY + 1, 'ashlar')
    // the lantern above the gallery, and the slim spire
    raise(circleRing(-18.5, -8.5, 1.6), galleryY + 1, 4, 'ashlar')
    spire(-18.5, -8.5, 2.2, galleryY + 5, 'slate')
    tower(-22, galleryY + 1, -9, 'tall tower gallery, west')
    tower(-16, galleryY + 1, -9, 'tall tower gallery, east')

    // ---- knights' wing along the south of the courtyard ---------------------------------
    begin("knights' wing")
    const WH = 6
    const wing = rectRing(-11, 5, 8, 11)
    raise(wing, FLOOR, WH, 'ashlar')
    for (const [x, z] of wing) put(x, FLOOR, z, 'cobble')
    windows(wing, [FLOOR + 3], 2)
    gableRoof(-11, 5, 8, 11, FLOOR + WH, 'slate')
    // green copper turrets at its courtyard corners
    for (const [cx, cz] of [[-10.5, 7.5], [4.5, 7.5]]) {
        raise(circleRing(cx, cz, 1), FLOOR + WH - 2, 5, 'ashlar')
        spire(cx, cz, 1.5, FLOOR + WH + 3, 'copper_roof')
    }
    tower(-3, FLOOR + WH + 2, 9, "knights' wing ridge")

    // ---- the square tower at the south-east ---------------------------------------------
    begin('square tower')
    const SQ = 9
    const sq = rectRing(7, 11, 7, 11)
    raise(sq, FLOOR, SQ, 'ashlar')
    windows(sq, [FLOOR + 6], 3)
    // arched belfry openings near the top
    for (const [x, z] of sq) {
        const onFace = (x > 7 && x < 11) || (z > 7 && z < 11)
        if (onFace && (x + z) % 2 === 0) for (const y of [FLOOR + SQ - 5, FLOOR + SQ - 4]) del(x, y, z)
    }
    const sqTop = FLOOR + SQ
    for (const [x, z] of rectCells(6, 12, 6, 12)) put(x, sqTop, z, 'ashlar')
    merlons(rectRing(6, 12, 6, 12), sqTop + 1, 'ashlar')
    pyramid(8, 10, 8, 10, sqTop + 1, 'slate')
    // its round stair turret
    raise(circleRing(12.5, 11.5, 1), FLOOR, SQ + 2, 'ashlar')
    spire(12.5, 11.5, 1.5, FLOOR + SQ + 2, 'slate')
    tower(6, sqTop + 1, 6, 'square tower gallery, courtyard')
    tower(12, sqTop + 1, 6, 'square tower gallery, east')
    tower(6, sqTop + 1, 12, 'square tower gallery, front')

    // ---- the gatehouse at the east end ------------------------------------------------
    begin('gatehouse')
    const GH = 6
    const gate = rectRing(15, 22, -5, 5)
    raise(gate, FLOOR, GH, 'brick')
    windows(gate, [FLOOR + 3], 3)
    for (const [x, z] of gate) put(x, FLOOR + GH - 1, z, 'ashlar')
    merlons(gate, FLOOR + GH, 'brick')
    // the passage through it: gates at both ends, two wide and two high (a gate isn't solid:
    // nothing can be built against it, so each gate block must touch the ground or the brick)
    for (const x of [15, 22]) for (const z of [-1, 0]) for (const y of [FLOOR, FLOOR + 1]) put(x, y, z, 'gate')
    // round corner towers
    for (const [cx, cz] of [[23.5, 6.5], [23.5, -5.5]]) {
        raise(circleRing(cx, cz, 1.6), FLOOR, GH + 3, 'brick')
        for (const [x, z] of circleDisc(cx, cz, 1.6)) put(x, FLOOR + GH + 2, z, 'brick')
        merlons(circleRing(cx, cz, 2.1), FLOOR + GH + 2, 'brick')
    }
    // and along its walls (a tower on a battlement goes on top of it)
    for (const [x, z] of [[17, -5], [20, -5], [17, 5], [20, 5]]) tower(x, FLOOR + GH, z, `gatehouse wall at ${x}`)
    tower(23, FLOOR + GH + 3, 6, 'gatehouse tower, south')
    tower(23, FLOOR + GH + 3, -6, 'gatehouse tower, north')
    tower(22, FLOOR + GH, 2, 'over the gate')

    // ---- the curtain wall ---------------------------------------------------------------
    begin('curtain wall')
    const CW = 5
    // north: from the tall tower to the gatehouse
    for (let x = -15; x <= 15; x++) for (let y = FLOOR; y < FLOOR + CW; y++) put(x, y, -11, 'ashlar')
    merlons(Array.from({ length: 31 }, (_, i) => [i - 15, -11]), FLOOR + CW, 'ashlar')
    // south-east: from the square tower to the gatehouse's south tower
    for (let x = 12; x <= 22; x++) for (let y = FLOOR; y < FLOOR + CW; y++) put(x, y, 8, 'ashlar')
    // and the short stretches that close the courtyard: Palas to curtain wall,
    // curtain wall to gatehouse, knights' wing to square tower
    for (const [x, z0, z1] of [[-15, -10, -6], [15, -10, -6], [6, 7, 12]]) {
        for (let z = z0; z <= z1; z++) for (let y = FLOOR; y < FLOOR + CW; y++) if (!has(x, y, z)) put(x, y, z, 'ashlar')
    }
    // in the gaps of its battlements, all along it
    for (const x of [-10, -4, 4, 10]) tower(x, FLOOR + CW, -11, `curtain wall at ${x}`)
    tower(-15, FLOOR + CW, -11, 'curtain wall, west end')
    tower(0, FLOOR + CW, -11, 'curtain wall, middle')
    tower(14, FLOOR + CW, -11, 'curtain wall, east end')

    // mirror to the photo's side (see above)
    const flip = (z) => (z === 0 ? 0 : -z)
    const flipped = [...map.values()].map(([x, y, z, b, p]) => [x, y, flip(z), b, p])
    map.clear()
    for (const c of flipped) map.set(key(c[0], c[1], c[2]), c)
    for (const t of towers) t.z = flip(t.z)

    // the Town Center and the cell a new player spawns in stay open
    for (const [x, y, z] of [...map.values()]) {
        if (Math.abs(x) <= 1 && Math.abs(z) <= 1 && y >= FLOOR && y <= FLOOR + 4) map.delete(key(x, y, z))
        if (x === SPAWN[0] && z === SPAWN[2] && y >= FLOOR && y <= FLOOR + 2) map.delete(key(x, y, z))
    }
    // a tower stands on the block under its spot: if the spot itself was built on, it goes up
    for (const t of towers) while (has(t.x, t.y, t.z)) t.y++

    // four guard towers on the ground in the courtyard, the first thing built: the
    // nights start on day 1, before any wall is high enough to carry a tower (on
    // the ground a tower brings its own 2-block column: placing.js towerPlacement)
    part = 'courtyard'
    for (const [x, z, spot] of [[-9, -3, 'courtyard, west'], [10, 3, 'courtyard, east'], [-9, 4, 'courtyard, south-west'], [10, -5, 'courtyard, north-east']]) {
        towers.unshift({ x, y: FLOOR, z, block: 'arrow_tower', part, spot, ground: true })
    }

    // ---- out -----------------------------------------------------------------------------
    const cells = [...map.values()]
    // the outline first: the lowest courses of every part close the courtyard
    // within the first days (the nights start at once), then each part rises
    const order = ['base course', 'curtain wall', 'gatehouse', 'Palas', 'stair towers', "knights' wing", 'square tower', 'tall tower']
    const low = (c) => c[1] < FLOOR + OUTLINE && c[4] !== 'base course'
    parts.push({ name: 'base course', cells: cells.filter((c) => c[4] === 'base course').map(([x, y, z, b]) => [x, y, z, b]) })
    parts.push({ name: 'the outline', cells: order.flatMap((name) => cells.filter((c) => c[4] === name && low(c))).map(([x, y, z, b]) => [x, y, z, b]) })
    for (const name of order.slice(1)) {
        parts.push({ name, cells: cells.filter((c) => c[4] === name && !low(c)).map(([x, y, z, b]) => [x, y, z, b]) })
    }
    const counts = {}
    for (const c of cells) counts[c[3]] = (counts[c[3]] || 0) + 1
    return {
        cells: cells.map(([x, y, z, b]) => [x, y, z, b]),
        parts,
        towers,
        counts,
        // cameras for looking at it: the photo is taken from the south-east, a little above
        views: {
            photo: { x: -2, y: 18, z: 0, heading: 0.5, zoom: 66, pitch: 0.32 },
            front: { x: -4, y: 16, z: 0, heading: 0, zoom: 70, pitch: 0.32 },
            back: { x: -4, y: 16, z: 0, heading: Math.PI, zoom: 70, pitch: 0.35 },
            above: { x: -4, y: 12, z: 0, heading: 0.6, zoom: 72, pitch: 1.0 },
        },
    }
}
