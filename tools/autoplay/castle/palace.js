/*
 *  The ice palace (plan 12 §6.2–6.4): a voxel palace after ref/castle_2.png
 *  and ref/castle_2_1.png, about twice iteration 10's castle (~6,000 blocks),
 *  for a Large world in survival.
 *
 *  Drawn with the front (the door, the side a new player spawns on) toward +z.
 *  Heights from the hall floor, FLOOR, the first air above the plaza.
 *
 *    level 1      the great hall: 29 × 25, 12 clear inside, the Town Center in
 *                 the middle under the open well
 *    the stairs   a double curved staircase: two flights of 13 treads round
 *                 the crystal to a landing at the back, 13 up (§6.3)
 *    level 2      a floor 5 wide round the well, 12 clear at the walls and up
 *                 into the roof; 24 openings at floor level for archers (§0.5)
 *    the roof     a hip roof at 45° from the wall tops, the great spire on its
 *                 peak with a snowflake finial
 *    towers       four round corner towers to a balcony 30 up (a defence tower
 *                 on each), with spires
 *    the curtain  a ring 26 out, 3 high, on a grey stone plinth, with four
 *                 gates and four bastions
 *
 *  Every block can be placed against one built before it (the bot builds by
 *  hand: a block needs a face to go against), so a stepped roof course has a
 *  hidden support under its start, and every stair tread sits on its riser.
 *
 *  Pure: tools/autoplay/bot/palace.js builds it, castle/preview.mjs shows it,
 *  tests/palace.test.js checks it.
 */

/** the first air above the plaza (the plaza is at 7 for every seed of terrain_v1, see seeds.mjs) */
export const FLOOR = 8
/** where a new player appears: the Town Center + (0.5, 0, 5.5) (session.js) */
export const SPAWN = [0, FLOOR, 5]
/** the site (seeds.mjs --frost, picked from the preview) */
export const SEED = 'ice-palace-3618'
export const SIZE = 256

/** the hall's walls, outside (inclusive) */
export const HALL = { x0: -14, x1: 14, z0: -12, z1: 12 }
/** level 1's walls are this many courses (12 clear inside, then level 2's floor) */
export const L1 = 13
/** level 2's walls: 12 courses above its floor */
export const L2 = 12
/** level 2's floor: the block layer (you stand on it at L2_Y + 1) */
export const L2_Y = FLOOR + L1 - 1
/** the eaves: the roof's first course sits on the wall tops */
export const EAVES = FLOOR + L1 + L2
/** level 2's floor ring is this wide; inside it, the well */
export const RING = 5
/** the staircase: two flights of this many treads, each one block up */
export const TREADS = 13
/** its flights run between these radii round the Town Center, from STAIR_FROM to STAIR_TO degrees off the door's axis */
export const STAIR = { r0: 6, r1: 10, from: 30, to: 180 }
/** the crystal's guard towers (x, z): free floor in the well, clear of the flights and the snowflake */
export const CRYSTAL_GUARD = [[-4, -4], [4, -4], [-5, -1], [5, -1]]
/** relay the grass and the dirt path inside the hall in snow brick: a white floor round the plaza */
export const RELAY_FLOOR = true
/** the curtain wall's radius and height */
export const CURTAIN = { r: 26, h: 3 }

const key = (x, y, z) => `${x},${y},${z}`
const deg = Math.PI / 180

/**
 * The palace.
 * @param {object} [o]
 * @param {(x: number, z: number) => number} [o.groundAt] first air above the natural ground (the generator's surfaceY); flat at FLOOR without it
 * @param {(x: number, y: number, z: number) => number} [o.blockAt] the natural block (the generator's blockAt): grass under the hall is relaid in snow brick
 * @returns {{
 *   cells: [number, number, number, string][],
 *   dig: [number, number, number][],
 *   parts: {name: string, view: 'first'|'third'|'aerial', cells: [number, number, number, string][]}[],
 *   towers: {x: number, y: number, z: number, block: string, part: string, spot: string, ground?: boolean}[],
 *   troops: {type: string, x: number, y: number, z: number, spot: string}[],
 *   openings: {x: number, y: number, z: number, out: number[]}[],
 *   treads: {flight: number, i: number, y: number, cells: number[][]}[],
 *   counts: Record<string, number>,
 *   views: Record<string, any>,
 * }}
 */
export function buildPalace({ groundAt = () => FLOOR, blockAt: natural = null } = {}) {
    /** the hall's floor is relaid where the natural surface is grass or the dirt path (needs `blockAt`) */
    const isGrassOrPath = (x, y, z) => !!natural && [4, 21].includes(natural(x, y, z))
    /** key → [x, y, z, block, part]; a later write changes the block, not the part */
    const map = new Map()
    let part = ''
    const put = (x, y, z, block) => {
        const old = map.get(key(x, y, z))
        map.set(key(x, y, z), [x, y, z, block, old ? old[4] : part])
    }
    const del = (x, y, z) => map.delete(key(x, y, z))
    const has = (x, y, z) => map.has(key(x, y, z))
    const blockAt = (x, y, z) => map.get(key(x, y, z))?.[3]
    const dig = new Map()

    // ---- primitives ------------------------------------------------------------------
    const rectRing = (x0, x1, z0, z1) => {
        const out = []
        for (let x = x0; x <= x1; x++) out.push([x, z0], [x, z1])
        for (let z = z0 + 1; z < z1; z++) out.push([x0, z], [x1, z])
        return out
    }
    const rectCells = (x0, x1, z0, z1) => {
        const out = []
        for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z])
        return out
    }
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
    const raise = (cells, y0, h, block) => {
        for (let y = y0; y < y0 + h; y++) for (const [x, z] of cells) put(x, y, z, block)
    }
    /**
     * A slim spire: discs shrinking from `r`, `per` courses each, to a point and a
     * finial. Solid, so each disc stands on the one below.
     */
    const spire = (cx, cz, r, y0, block, per = 2, finial = 'ice') => {
        let y = y0
        for (let rr = r; rr >= 0.5; rr -= 0.6) {
            for (let k = 0; k < per; k++) {
                for (const [x, z] of circleDisc(cx, cz, rr)) put(x, y, z, block)
                y++
            }
        }
        const px = Math.floor(cx), pz = Math.floor(cz)
        for (let k = 0; k < 3; k++) put(px, y + k, pz, block)
        put(px, y + 3, pz, finial)
        return y + 4
    }
    /** the ground a column stands on, never above the floor inside the walls */
    const ground = (x, z) => groundAt(x, z)

    const parts = []
    const towers = []
    const troops = []
    const openings = []
    const treads = []
    const tower = (x, y, z, block, spot, ground = false) => towers.push({ x, y, z, block, part, spot, ground })
    const begin = (name) => { part = name }
    const { x0, x1, z0, z1 } = HALL

    // ---- the floor: level ground inside the hall --------------------------------------
    begin('the floor')
    for (const [x, z] of rectCells(x0 + 1, x1 - 1, z0 + 1, z1 - 1)) {
        const g = ground(x, z)
        // a dip: filled with snow brick up to the floor
        for (let y = g; y < FLOOR; y++) put(x, y, z, 'snow_brick')
        // a bump: dug out
        for (let y = FLOOR; y < g; y++) dig.set(key(x, y, z), [x, y, z])
        // grass and the dirt path round the plaza: dug out and relaid in snow brick, a white floor
        // (a dig and a block each, 310 of them: the bot digs the whole floor on foot first, then
        // lays it from above, where a brick goes in several times faster than standing in the pit)
        if (RELAY_FLOOR && g >= FLOOR && isGrassOrPath(x, FLOOR - 1, z)) {
            dig.set(key(x, FLOOR - 1, z), [x, FLOOR - 1, z])
            put(x, FLOOR - 1, z, 'snow_brick')
        }
    }

    // ---- level 1: the great hall --------------------------------------------------------
    begin('level 1')
    const hall = rectRing(x0, x1, z0, z1)
    for (const [x, z] of hall) {
        // the wall stands on the ground (a footing where it dips), up to level 2's floor
        const g = Math.min(ground(x, z), FLOOR)
        for (let y = g; y < FLOOR + L1; y++) put(x, y, z, 'snow_brick')
        // raised ground in the wall's way: dug out first, then built on
        for (let y = FLOOR; y < ground(x, z); y++) dig.set(key(x, y, z), [x, y, z])
    }
    // pillars where the walls meet (blue ice), clear ice either side of the door, and a
    // string course of blue ice under level 2. Clear ice costs iron (half an iron a block),
    // so it goes where it's seen up close: the door, the stairs, the curtain's foot
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) raise([[x, z]], FLOOR, L1, 'blue_ice')
    // (blue ice, not clear: 26 blocks of clear ice were 13 iron the hall's door had to wait for)
    for (const [x, z] of [[-3, z1], [3, z1]]) raise([[x, z]], FLOOR, L1, 'blue_ice')
    for (const [x, z] of hall) put(x, FLOOR + L1 - 1, z, 'blue_ice')
    // tall windows, every four along each wall (between the openings above)
    const winY = [FLOOR + 3, FLOOR + 4, FLOOR + 5, FLOOR + 6, FLOOR + 7, FLOOR + 8]
    for (let x = x0 + 2; x <= x1 - 2; x += 4) {
        for (const z of [z0, z1]) {
            if (z === z1 && Math.abs(x) <= 3) continue
            for (const y of winY) put(x, y, z, 'window')
        }
    }
    for (let z = z0 + 3; z <= z1 - 3; z += 4) for (const x of [x0, x1]) for (const y of winY) put(x, y, z, 'window')
    // the door: a gate three wide and two high (attackers can't jump two; a third course of gate
    // would have nothing solid to be built against) in a pointed portal of clear ice, 5 × 8
    const doorGate = []
    for (let y = FLOOR; y < FLOOR + 8; y++) {
        for (let x = -2; x <= 2; x++) {
            // the point of the arch: the top two courses narrow in
            if (y >= FLOOR + 6 && Math.abs(x) === 2) continue
            if (y === FLOOR + 7 && Math.abs(x) === 1) continue
            // the gate itself goes in with the defences: a gate isn't solid, so the one in the
            // middle needs the ice above it to be built against
            if (Math.abs(x) <= 1 && y < FLOOR + 2) {
                del(x, y, z1)
                // (a wooden gate: it takes no iron, so the hall is closed the day its walls stand)
                doorGate.push([x, y, z1, 'gate'])
            }
            else put(x, y, z1, 'ice')
        }
    }

    // ribs of clear ice up the walls at their quarter points (the references' ice columns):
    // the same blocks, a different colour, so the walls read tall rather than wide
    for (const [x, z] of [[-7, z0], [7, z0], [-7, z1], [7, z1], [x0, -6], [x0, 6], [x1, -6], [x1, 6]]) {
        for (let y = FLOOR; y < FLOOR + L1 - 1; y++) if (blockAt(x, y, z) === 'snow_brick') put(x, y, z, 'blue_ice')
    }

    // ---- the double curved staircase (§6.3) ----------------------------------------------
    begin('the staircase')
    /** a tread's cells: the annular sector between angles a0 and a1 (degrees off +z), radii r0..r1 */
    const sector = (side, a0, a1, r0, r1) => {
        const out = []
        for (let x = -14; x <= 14; x++) {
            for (let z = -12; z <= 12; z++) {
                const cx = x + 0.5, cz = z + 0.5
                const r = Math.hypot(cx, cz)
                if (r < r0 || r > r1 + 0.5) continue
                // the angle off the door's axis (+z), on this flight's side (each flight has its half)
                if (Math.sign(cx) !== side) continue
                const a = Math.atan2(Math.abs(cx), cz) / deg
                if (a >= a0 && a < a1) out.push([x, z])
            }
        }
        return out
    }
    const span = (STAIR.to - STAIR.from) / TREADS
    for (const side of [1, -1]) {
        for (let i = 1; i <= TREADS; i++) {
            // the bottom two treads flare out to 6 wide (the curtail), and round off at the outer end
            const outer = i <= 2 ? STAIR.r1 + 2 - (i - 1) * 0.6 : STAIR.r1
            const a0 = STAIR.from + (i - 1) * span - (i === 1 ? 6 : 0), a1 = STAIR.from + i * span
            // the last tread runs on to the middle, where the two flights meet
            const cells = sector(side, a0, i === TREADS ? 181 : a1, STAIR.r0, outer)
            const y = FLOOR + i - 1
            for (const [x, z] of cells) {
                // the tread: blue ice, its leading edge (the cells nearest the step below) picked out in
                // white. (It was clear ice, half an iron a block: with nights lost and no iron paid, the
                // treads stood without their edges for days)
                const a = Math.atan2(Math.abs(x + 0.5), z + 0.5) / deg
                put(x, y, z, a - a0 < span * 0.3 ? 'snow_brick' : 'blue_ice')
                // the riser under it: a ribbon two thick, curving up with nothing under it
                // (the bottom three treads stand on the floor)
                if (i > 3) put(x, y - 1, z, 'snow_brick')
                else for (let yy = FLOOR; yy < y; yy++) put(x, yy, z, 'snow_brick')
            }
            treads.push({ flight: side, i, y, cells: cells.map(([x, z]) => [x, y, z]) })
        }
    }
    /** cells that stand on a tread on purpose: the rails (see the headroom pass at the end) */
    const rails = new Set()
    const rail = (x, y, z, b) => {
        put(x, y, z, b)
        rails.add(key(x, y, z))
    }
    // rails: a blue-ice post every second tread on the outer edge with icicles between,
    // a post every fourth on the inner edge (so you look in at the crystal as you climb)
    for (const t of treads) {
        const byR = t.cells.map(([x, y, z]) => ({ x, y, z, r: Math.hypot(x + 0.5, z + 0.5) }))
        if (!byR.length) continue
        const outerEdge = byR.reduce((a, b) => (b.r > a.r ? b : a))
        const innerEdge = byR.reduce((a, b) => (b.r < a.r ? b : a))
        rail(outerEdge.x, t.y + 1, outerEdge.z, t.i % 2 === 0 ? 'blue_ice' : 'ice_spikes')
        if (t.i % 4 === 0) rail(innerEdge.x, t.y + 1, innerEdge.z, 'blue_ice')
    }
    // newels: at the foot of each flight, an ice post three high with a crystal finial
    for (const side of [1, -1]) {
        const first = treads.find((t) => t.flight === side && t.i === 1)
        const inner = first.cells.reduce((a, b) => (Math.hypot(b[0] + 0.5, b[2] + 0.5) < Math.hypot(a[0] + 0.5, a[2] + 0.5) ? b : a))
        // just in front of the first tread's inner corner, toward the door
        const nx = inner[0], nz = inner[2] + 1
        for (let y = FLOOR; y < FLOOR + 3; y++) put(nx, y, nz, 'ice')
        put(nx, FLOOR + 3, nz, 'blue_ice')
    }
    // the landing: a half-round at the back, 13 up, where the flights meet and level 2's floor
    // runs along the back wall (anything over a lower tread is cut away at the end: headroom)
    const LY = L2_Y
    for (let x = -4; x <= 4; x++) {
        for (let z = z0 + 1; z <= -3; z++) {
            const front = z >= -5
            if (front && Math.hypot(x, z + 6) > 4.3) continue
            if (!has(x, LY, z)) put(x, LY, z, 'snow_brick')
        }
    }

    // under the landing: a wall across the back of the well with an arch five wide and six high
    for (let x = -4; x <= 4; x++) {
        for (let y = FLOOR; y < LY; y++) {
            // the opening: five wide and six high, pointed (three wide in its top course)
            if (Math.abs(x) <= 2 && y < FLOOR + 6) continue
            if (Math.abs(x) <= 1 && y === FLOOR + 6) continue
            if (!has(x, y, -6)) put(x, y, -6, 'snow_brick')
        }
    }

    // ---- level 2: the floor round the well -------------------------------------------------
    begin('level 2 floor')
    const inWell = (x, z) => Math.abs(x) <= x1 - 1 - RING && Math.abs(z) <= z1 - 1 - RING
    for (const [x, z] of rectCells(x0 + 1, x1 - 1, z0 + 1, z1 - 1)) {
        if (inWell(x, z) || has(x, L2_Y, z)) continue
        put(x, L2_Y, z, 'snow_brick')
    }
    // an ice edge round the well
    for (const [x, z] of rectRing(x0 + 1 + RING, x1 - 1 - RING, z0 + 1 + RING, z1 - 1 - RING).map(([x, z]) => [x + Math.sign(x), z + Math.sign(z)])) {
        if (has(x, L2_Y, z)) put(x, L2_Y, z, 'blue_ice')
    }

    // ---- level 2: its walls and the archers' openings ---------------------------------------
    begin('level 2')
    for (const [x, z] of hall) raise([[x, z]], L2_Y + 1, L2, 'snow_brick')
    for (const [x, z] of [[-7, z0], [7, z0], [-7, z1], [7, z1], [x0, -6], [x0, 6], [x1, -6], [x1, 6]]) raise([[x, z]], L2_Y + 1, L2, 'blue_ice')
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) raise([[x, z]], L2_Y + 1, L2, 'blue_ice')
    // a band of blue ice under the eaves
    for (const [x, z] of hall) put(x, EAVES - 1, z, 'blue_ice')
    // the openings: one wide, three high, at the floor, every four along the back and front, and the sides
    const open = (x, z, out) => {
        for (let y = L2_Y + 1; y <= L2_Y + 3; y++) del(x, y, z)
        // a pointed top: an ice block either side of the head
        openings.push({ x, y: L2_Y + 1, z, out })
    }
    // (six a wall: clear of the corner towers, which take the cells next to the corners)
    for (const x of [-10, -6, -2, 2, 6, 10]) {
        open(x, z0, [0, 0, -1])
        open(x, z1, [0, 0, 1])
    }
    for (const z of [-8, -5, -2, 1, 4, 7]) {
        open(x0, z, [-1, 0, 0])
        open(x1, z, [1, 0, 0])
    }
    // the openings get a pointed head: the block above them in blue ice
    for (const o of openings) put(o.x, o.y + 3, o.z, 'blue_ice')

    // ---- the roof -----------------------------------------------------------------------
    begin('the roof')
    // a hip roof at 45°: each course one in on every side, on the course below. The bot needs
    // a face to set each course's first block against, so each course gets a hidden support:
    // a block inside the course below, under its middle on each side
    let peakY = EAVES
    for (let k = 0; ; k++) {
        const ax0 = x0 + k, ax1 = x1 - k, az0 = z0 + k, az1 = z1 - k
        if (az0 > az1 || ax0 > ax1) break
        const y = EAVES + k
        for (const [x, z] of rectRing(ax0, ax1, az0, az1)) put(x, y, z, (k + 1) % 4 === 0 ? 'snow_brick' : 'blue_ice')
        if (k > 0) for (const [x, z] of [[0, az0], [0, az1], [ax0, 0], [ax1, 0]]) if (!has(x, y - 1, z)) put(x, y - 1, z, 'blue_ice')
        peakY = y
    }
    // white ridges down the hips
    for (let k = 0; ; k++) {
        const ax0 = x0 + k, ax1 = x1 - k, az0 = z0 + k, az1 = z1 - k
        if (az0 > az1 || ax0 > ax1) break
        for (const [x, z] of [[ax0, az0], [ax0, az1], [ax1, az0], [ax1, az1]]) put(x, EAVES + k, z, 'snow_brick')
    }

    // ---- the great spire on the peak ----------------------------------------------------------
    begin('the great spire')
    // a square shaft out of the ridge, stepping in, to a point and a snowflake
    let y = peakY - 1
    for (const [w, n, block] of [[2, 6, 'blue_ice'], [1, 6, 'blue_ice'], [0, 4, 'blue_ice']]) {
        for (let k = 0; k < n; k++, y++) for (const [x, z] of rectCells(-w, w, -w, w)) put(x, y, z, block)
    }
    // the snowflake: a star of ice across the top, facing the front
    const fy = y + 2
    for (let d = -2; d <= 2; d++) {
        put(d, fy, 0, 'ice')
        put(0, fy + d, 0, 'ice')
    }
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) put(dx, fy + dy, 0, 'ice')
    for (let k = y; k < fy - 2; k++) put(0, k, 0, 'ice')
    const spireTop = fy + 2

    // ---- the four corner towers ----------------------------------------------------------------
    begin('corner towers')
    const TOWER_H = 30
    for (const [cx, cz, name] of [[x0 + 0.5, z0 + 0.5, 'back left'], [x1 + 0.5, z0 + 0.5, 'back right'], [x0 + 0.5, z1 + 0.5, 'front left'], [x1 + 0.5, z1 + 0.5, 'front right']]) {
        // slim: the eight cells round the hall's corner (the references' towers are needles)
        const ring = circleRing(cx, cz, 1.2)
        for (const [x, z] of ring) {
            const g = Math.min(ground(x, z), FLOOR)
            for (let yy = g; yy < FLOOR + TOWER_H; yy++) {
                if (!has(x, yy, z)) put(x, yy, z, 'snow_brick')
                // (the towers go up before the hall: the cell of level 2's floor in a tower's inside
                // corner goes up with the tower, or the column above it would have nothing under it)
                else if (map.get(key(x, yy, z))[4] === 'level 2 floor') map.get(key(x, yy, z))[4] = 'corner towers'
            }
        }
        // slit windows of ice up the outer face, and the balcony: a disc a step wider, 30 up
        for (const [x, z] of ring) if ((x + z) % 3 === 0) for (const yy of [FLOOR + 6, FLOOR + 14, FLOOR + 22]) put(x, yy, z, 'window')
        for (const [x, z] of circleDisc(cx, cz, 2.2)) put(x, FLOOR + TOWER_H, z, 'snow_brick')
        // the spire above it, and two defence towers on the balcony, in the middle of its two outer
        // edges (the disc has no corner cell: a tower drawn there had nothing to stand on). 30 up,
        // they're out of a fire mage's reach, which every tower on the ground is not (BALANCE: lobReach)
        spire(cx, cz, 1.2, FLOOR + TOWER_H + 1, 'blue_ice', 4)
        const sx = Math.sign(cx), sz = Math.sign(cz)
        tower(Math.floor(cx + sx * 2), FLOOR + TOWER_H + 1, Math.floor(cz), name === 'front left' ? 'crossbow_tower' : name === 'back left' ? 'arrow_tower' : 'ballista_tower', `${name} tower balcony`)
        tower(Math.floor(cx), FLOOR + TOWER_H + 1, Math.floor(cz + sz * 2), 'ballista_tower', `${name} tower balcony, second`)
    }

    // ---- crystal spires: needles on the roof's hips and over the door ------------------------------
    begin('crystal spires')
    for (const [x, z, h] of [[x0 + 4, z0 + 4, 6], [x1 - 4, z0 + 4, 6], [x0 + 4, z1 - 4, 6], [x1 - 4, z1 - 4, 6]]) {
        // standing on the hip (the roof's course there)
        const base = EAVES + 4
        for (let k = 0; k < h; k++) put(x, base + k, z, k < h - 1 ? 'blue_ice' : 'ice')
    }
    // a tall pointed gable over the middle of each face (the references' big front gable),
    // white edged in blue ice, standing on the wall top, with a needle on its point
    const gable = (axis, at, w) => {
        for (let k = 0; k <= w; k++) {
            for (let d = -w + k; d <= w - k; d++) {
                const [x, z] = axis === 'z' ? [d, at] : [at, d]
                put(x, EAVES + k, z, Math.abs(d) === w - k ? 'blue_ice' : 'snow_brick')
            }
        }
        for (let k = 1; k <= 5; k++) {
            const [x, z] = axis === 'z' ? [0, at] : [at, 0]
            put(x, EAVES + w + k, z, k < 4 ? 'blue_ice' : 'ice')
        }
    }
    gable('z', z1, 6)
    gable('z', z0, 6)
    gable('x', x0, 5)
    gable('x', x1, 5)
    // needles along the ridge and the hips
    for (const [x, z] of [[-6, 0], [6, 0], [-9, -4], [9, -4], [-9, 4], [9, 4]]) {
        // standing on the roof's course over that spot
        const k = Math.min(x1 - Math.abs(x), z1 - Math.abs(z))
        for (let h = 0; h < 7; h++) put(x, EAVES + k + h, z, h < 6 ? 'blue_ice' : 'ice')
    }

    // ---- the snowflake on the hall floor ---------------------------------------------------------
    begin('the snowflake')
    for (let a = 30; a < 360; a += 60) {
        for (let r = 2.6; r <= 4.8; r += 0.4) {
            const x = Math.floor(Math.sin(a * deg) * r + 0.5), z = Math.floor(Math.cos(a * deg) * r + 0.5)
            if (Math.abs(x) <= 1 && Math.abs(z) <= 1) continue
            if (!has(x, FLOOR, z)) put(x, FLOOR, z, 'blue_ice')
        }
    }

    // ---- the curtain ---------------------------------------------------------------------------
    begin('curtain')
    const gates = [[0, 1, 'steel_gate', 'front'], [1, 0, 'iron_gate', 'east'], [-1, 0, 'gate', 'west'], [0, -1, 'gate', 'back']]
    const ring = circleRing(0.5, 0.5, CURTAIN.r)
    /** [x, ground, z, gate block] for each gateway cell */
    const gateCells = []
    const inGate = (x, z) => gates.some(([gx, gz]) => (gx === 0 ? Math.abs(x) <= 1 && Math.sign(z) === gz : Math.abs(z) <= 1 && Math.sign(x) === gx))
    for (const [x, z] of ring) {
        const g = ground(x, z)
        if (inGate(x, z)) {
            // the gateway: a lintel over it now, the gate itself (two high: attackers can't jump two)
            // with the defences, once there's a lintel for it to be built against
            put(x, g + 2, z, 'snow_brick')
            gateCells.push([x, g, z, gates.find(([gx, gz]) => (gx === 0 ? Math.sign(z) === gz : Math.sign(x) === gx))[2]])
            continue
        }
        // a plinth of grey stone (as hard as clear ice, and no iron), white snow brick above it:
        // an attacker pressing against the wall touches the snow brick and freezes
        put(x, g, z, 'stone_wall')
        for (let yy = g + 1; yy < g + CURTAIN.h; yy++) put(x, yy, z, 'snow_brick')
    }
    // the gate flanks in grey stone, iron and steel: the gatehouse stone (every wall tier, once)
    for (const [gx, gz, , name] of gates) {
        const flanks = gx === 0 ? [[-2, 0], [2, 0]] : [[0, -2], [0, 2]]
        const rr = CURTAIN.r
        for (const [dx, dz] of flanks) {
            const x = Math.round(gx * rr + dx), z = Math.round(gz * rr + dz)
            const g = ground(x, z)
            // (grey stone, capped in steel at the front gate and iron at the east one: a whole flank of
            // either took the iron the gates themselves were waiting for)
            const wall = name === 'front' ? 'steel_wall' : name === 'east' ? 'iron_wall' : 'stone_wall'
            for (let yy = g; yy < g + CURTAIN.h + 1; yy++) put(x, yy, z, yy === g + CURTAIN.h ? wall : 'stone_wall')
        }
    }
    // four bastions on the diagonals: 3 × 3, hollow, a course above the wall with a deck on top
    // for a defence tower and a gunner
    const bastions = [[1, 1, 'mortar_tower'], [-1, 1, 'cannon_tower'], [1, -1, 'bombard_tower'], [-1, -1, 'bombard_tower']]
    for (const [sx, sz, block] of bastions) {
        const cx = Math.round((sx * CURTAIN.r) / Math.SQRT2), cz = Math.round((sz * CURTAIN.r) / Math.SQRT2)
        const top = Math.max(...rectCells(cx - 1, cx + 1, cz - 1, cz + 1).map(([x, z]) => ground(x, z))) + CURTAIN.h
        for (const [x, z] of rectCells(cx - 1, cx + 1, cz - 1, cz + 1)) {
            const g = ground(x, z)
            const edge = Math.abs(x - cx) === 1 || Math.abs(z - cz) === 1
            if (edge) for (let yy = g; yy < top; yy++) put(x, yy, z, yy === g ? 'stone_wall' : 'snow_brick')
            put(x, top, z, 'snow_brick')
        }
        tower(cx, top + 1, cz, block, `bastion ${sz > 0 ? 'front' : 'back'} ${sx > 0 ? 'right' : 'left'}`)
        troops.push({ type: 'gunner', x: cx + sx, y: top + 1, z: cz + sz, spot: `bastion ${sz > 0 ? 'front' : 'back'} ${sx > 0 ? 'right' : 'left'}` })
    }

    // ---- the Town Center and the spawn cell stay open, and the door's way in --------------------
    for (const c of [...map.values()]) {
        const [x, cy, z] = c
        if (Math.abs(x) <= 1 && Math.abs(z) <= 1 && cy >= FLOOR && cy <= FLOOR + 4) del(x, cy, z)
        if (x === SPAWN[0] && z === SPAWN[2] && cy >= FLOOR && cy <= FLOOR + 2) del(x, cy, z)
        // the way from the spawn cell out of the door
        if (Math.abs(x) <= 1 && z >= SPAWN[2] && z < z1 && cy >= FLOOR && cy <= FLOOR + 2) del(x, cy, z)
    }

    // ---- defence towers and troops --------------------------------------------------------------
    // the curtain's gates, under their lintels, and the hall's door: parts of their own, built as
    // soon as the wall round them stands. An open gateway is no wall at all: on night 7 the recorded
    // game's attackers walked through four of them, and sieges against that town held the night
    // only once the gates were in (next_12.md §12)
    part = 'gates'
    for (const [x, g, z, b] of gateCells) for (let yy = g; yy < g + 2; yy++) put(x, yy, z, b)
    part = 'the door'
    for (const [x, y, z, b] of doorGate) put(x, y, z, b)
    part = 'defences'
    // two ballistas at the great spire's foot, on the ridge, front and back
    tower(0, peakY + 1, 3, 'ballista_tower', 'great spire, front')
    tower(0, peakY + 1, -3, 'ballista_tower', 'great spire, back')
    // frost towers either side of each curtain gate, inside the ring (on the ground: a tower brings its column)
    for (const [gx, gz, , name] of gates) {
        const side = gx === 0 ? [[-4, 0], [4, 0]] : [[0, -4], [0, 4]]
        for (const [dx, dz] of side) {
            const x = Math.round(gx * (CURTAIN.r - 3) + dx), z = Math.round(gz * (CURTAIN.r - 3) + dz)
            tower(x, ground(x, z), z, 'frost_tower', `${name} gate, ${dx + dz < 0 ? 'left' : 'right'}`, true)
        }
    }
    // the crystal's guard: four arrow towers round the Town Center, in the well behind it, the
    // first thing built (no iron: planks and cobble). The first run lost nights 1 and 3 with
    // nothing by the Town Center but the builder; later they keep the hall itself
    for (const [x, z] of CRYSTAL_GUARD) {
        towers.push({ x, y: ground(x, z), z, block: 'arrow_tower', part: 'the crystal\'s guard', spot: `by the crystal, ${x},${z}`, ground: true, early: true })
    }
    // spikes on the approaches, outside each gate: a band of every kind
    const bands = { front: 'steel_spikes', east: 'ice_spikes', west: 'iron_spikes', back: 'spikes' }
    const spikes = []
    for (const [gx, gz, , name] of gates) {
        for (let along = -2; along <= 2; along++) {
            // (one row of five: two rows were twice the iron)
            for (const out of [3]) {
                const x = gx === 0 ? along : gx * (CURTAIN.r + out), z = gz === 0 ? along : gz * (CURTAIN.r + out)
                spikes.push([x, ground(x, z), z, bands[name]])
            }
        }
    }
    for (const [x, sy, z, b] of spikes) put(x, sy, z, b)
    // archers in 14 of the 24 openings: all of the front and back, two each side
    const archerOpenings = openings.filter((o) => o.out[0] === 0 || o.z === -5 || o.z === 3)
    for (const o of archerOpenings) troops.push({ type: 'archer', x: o.x, y: o.y, z: o.z, spot: `opening ${o.x},${o.z}` })
    // swordsmen inside the gates
    for (const [gx, gz, , name] of gates) troops.push({ type: 'swordsman', x: gx * (CURTAIN.r - 2), y: ground(gx * (CURTAIN.r - 2), gz * (CURTAIN.r - 2)), z: gz * (CURTAIN.r - 2), spot: `${name} gate` })
    // ---- headroom: at least three clear blocks over every tread (the rails excepted) ----------------
    const treadCells = new Set(treads.flatMap((t) => t.cells.map(([x, y, z]) => key(x, y, z))))
    for (const t of treads) {
        for (const [x, ty, z] of t.cells) {
            for (let dy = 1; dy <= 3; dy++) {
                const k = key(x, ty + dy, z)
                if (map.has(k) && !rails.has(k) && !treadCells.has(k)) map.delete(k)
            }
        }
    }

    // the landing's rail facing the hall: posts on its round front edge (on what's left of it)
    part = 'the staircase'
    for (let x = -4; x <= 4; x += 2) {
        let z = -3
        while (z > -12 && !has(x, LY, z)) z--
        if (has(x, LY, z) && !has(x, LY + 1, z)) rail(x, LY + 1, z, 'blue_ice')
    }

    // a tower stands on the block under its spot: if the spot itself was built on, it goes up; one
    // drawn in the air above the roof comes down onto it (the two at the great spire's foot)
    for (const t of towers) {
        while (has(t.x, t.y, t.z)) t.y++
        if (!t.ground) while (t.y > FLOOR + 1 && !has(t.x, t.y - 1, t.z)) t.y--
    }

    // ---- out ----------------------------------------------------------------------------------
    const cells = [...map.values()]
    /** the order a palace goes up in, and the view each part is built from (§6.6) */
    const ORDER = [
        // (the rings are closed first: the curtain and its gates, the hall's first level and its door.
        // Then the corner towers: fire mages come from night 7 and blow up every tower on the
        // ground; the balconies' towers, 30 up, are the first out of their reach)
        ['the floor', 'aerial'], ['curtain', 'third'], ['gates', 'third'], ['level 1', 'third'], ['the door', 'third'],
        ['corner towers', 'aerial'], ['the staircase', 'first'],
        ['level 2 floor', 'first'], ['level 2', 'aerial'], ['the roof', 'aerial'],
        ['the great spire', 'aerial'], ['crystal spires', 'aerial'], ['the snowflake', 'first'], ['defences', 'third'],
    ]
    // a walkable order: round the palace (by the angle about the Town Center), a column at a time,
    // so the builder works along a wall instead of back and forth across the site; level 2's floor
    // out from the landing, where the stairs arrive
    const angle = (c) => Math.atan2(c[0] + 0.5, c[2] + 0.5)
    const SORT = {
        'the floor': angle, curtain: angle, gates: angle, 'level 1': angle, 'level 2': angle, defences: angle,
        'level 2 floor': (c) => Math.PI - Math.abs(angle(c)),
    }
    for (const [name, view] of ORDER) {
        const list = cells.filter((c) => c[4] === name)
        const by = SORT[name]
        if (by) list.sort((a, b) => by(a) - by(b) || a[1] - b[1])
        parts.push({ name, view: /** @type {any} */ (view), cells: list.map(([x, y, z, b]) => [x, y, z, b]) })
    }
    const counts = {}
    for (const c of cells) counts[c[3]] = (counts[c[3]] || 0) + 1
    return {
        cells: cells.map(([x, y, z, b]) => [x, y, z, b]),
        dig: [...dig.values()],
        parts,
        towers,
        troops,
        openings,
        treads,
        counts,
        top: spireTop,
        views: {
            // from the approach, the door toward you, the mountains behind
            front: { x: 0, y: 26, z: 0, heading: Math.PI, zoom: 78, pitch: 0.18 },
            reference: { x: 0, y: 30, z: 0, heading: Math.PI * 0.82, zoom: 74, pitch: 0.12 },
            above: { x: 0, y: 20, z: 0, heading: Math.PI * 0.85, zoom: 95, pitch: 0.9 },
            back: { x: 0, y: 26, z: 0, heading: 0, zoom: 78, pitch: 0.2 },
        },
    }
}
