/*
 *  Where your hand is and what it's doing, as numbers (no scene, unit tested):
 *  the arm's resting place in camera space, the motions (swing, chop, draw…) as
 *  curves over their own time, and how each item sits in the fist.
 *
 *  viewModel.js draws all of this; tests/handPose.test.js checks that every
 *  weapon meets what it swings at the right way round (a blade with its edge, a
 *  pickaxe with its head, a bow with its string toward you).
 */

import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { CLIP_KEYS, CLIP_FPS } from '../characters/contract.js'

/**
 * Where the hand sits in camera space and how big it is. Everything hangs off
 * `root`, which is scaled down: the camera sits very close to it, so full-size
 * items would fill the screen.
 */
export const SCALE = 0.42
export const HOME = { x: 0.5, y: -0.52, z: 1.15 }
export const ARM = { length: 0.34, width: 0.1 }

/**
 * The sword stroke (plan 13 §2.3), the same for every sword, wooden to iron,
 * and the swordsman's: two wide cuts with the blade laid out from the arm. A
 * forehand from high right to low left, and on every second swing (a combo,
 * see COMBO_GAP) a backhand from low left to high right.
 * `windUp` and `slashEnd` are shares of the motion's own time; the trail shows
 * between them and the blow lands half way.
 *
 * Each cut is a turn of the forearm about one axis (`axis`, camera space), so
 * the blade sweeps through a plane like a spoke: a cut, not a wave. (Until
 * plan 13 each tier had its own stroke, and the iron sword's sideways sweep
 * carried the blade upright across the view.) The sword points along the
 * forearm (ITEM_POSE), so the blade turns with it.
 *
 *   frame the forearm's frame the turn is counted from: yaw, pitch, roll (camera space)
 *   turn  how far it is turned from there about `axis` at the wind-up and at the end
 *         (radians); the blow lands half way
 *   from, to  where the hand is at the wind-up and the end (dx, dy, dz): it travels
 *         much less than the tip
 *   roll  turns the wrist about the blade, so the EDGE leads (radians, on top of
 *         the pose's own roll). Without it the flat led every slash, like a slap
 *         (next_10.md). The backhand leads with the other edge.
 *
 * Fitted (plan 13) so the tip passes the upper right, the crosshair and the
 * lower left of the screen; tests/handPose.test.js measures the edge, the cut
 * and where the tip goes, tests/handMatch.test.js the body doing the same.
 */
export const STROKE = {
    windUp: 0.24,
    slashEnd: 0.62,
    fore: { axis: [-0.387, 0.226, 0.894], frame: [-1.42, -1.117, -0.14], turn: [-0.183, 1.194], from: { dx: -0.013, dy: 0.115, dz: -0.063 }, to: { dx: -0.208, dy: 0.037, dz: 0.012 }, roll: 0.255 },
    back: { axis: [-0.046, 0.611, -0.79], frame: [-0.487, -0.711, 0.033], turn: [-1.154, 0.529], from: { dx: -0.231, dy: 0.093, dz: 0.026 }, to: { dx: -0.01, dy: 0.186, dz: -0.068 }, roll: 2.686 },
}

const tmpAxis = new Vector3()
const tmpQa = new Quaternion(), tmpQb = new Quaternion()

/**
 * the arm's offset (see armPose) turned `turn` from the cut's frame about its
 * axis, with the hand `q` of the way from `from` to `to`
 */
function cutAt(c, turn, q) {
    tmpAxis.set(c.axis[0], c.axis[1], c.axis[2]).normalize()
    Quaternion.RotationAxisToRef(tmpAxis, turn, tmpQa)
    Quaternion.RotationYawPitchRollToRef(c.frame[0], c.frame[1], c.frame[2], tmpQb)
    const e = tmpQa.multiply(tmpQb).toEulerAngles()
    return {
        dx: c.from.dx + (c.to.dx - c.from.dx) * q,
        dy: c.from.dy + (c.to.dy - c.from.dy) * q,
        dz: c.from.dz + (c.to.dz - c.from.dz) * q,
        rx: e.x + 0.3, ry: e.y + 0.25, rz: e.z,
        roll: c.roll,
    }
}

/**
 * pure: a stroke as a motion (see MOTIONS): wind up, cut, recover. `back`
 * plays the backhand.
 * @param {typeof STROKE} k
 */
export const strokeMotion = (k) => (p, back = false) => {
    const c = back ? k.back : k.fore
    if (p < k.windUp) return scaled(cutAt(c, c.turn[0], 0), s(p / k.windUp))
    if (p < k.slashEnd) {
        const q = s((p - k.windUp) / (k.slashEnd - k.windUp))
        return cutAt(c, c.turn[0] + (c.turn[1] - c.turn[0]) * q, q)
    }
    return scaled(cutAt(c, c.turn[1], 1), 1 - s((p - k.slashEnd) / (1 - k.slashEnd)))
}

/**
 * mining: wind up over the shoulder, drive down fast, stop dead on the block
 * with a small kick back, and come up again. `impact` is the share of the
 * motion where the head lands: the dig sound, chips and sparks go there.
 */
const CHOP = {
    windUp: 0.34,
    impact: 0.52,
    /** stopped on the block, with the kick */
    hold: 0.62,
    up: { dy: 0.09, dz: -0.08, rx: -0.62, rz: 0.06 },
    down: { dy: -0.035, dz: 0.08, rx: 0.42 },
    kick: { dy: 0.018, rx: -0.12 },
}

/** the chop: the strike speeds up into the block instead of easing into it */
const chop = (p) => {
    const k = CHOP
    if (p < k.windUp) return scaled(k.up, s(p / k.windUp))
    if (p < k.impact) {
        const q = (p - k.windUp) / (k.impact - k.windUp)
        return mix(k.up, k.down, q * q)
    }
    if (p < k.hold) return mix(k.down, { dy: k.down.dy + k.kick.dy, dz: k.down.dz, rx: k.down.rx + k.kick.rx }, bump((p - k.impact) / (k.hold - k.impact)))
    return scaled(k.down, 1 - s((p - k.hold) / (1 - k.hold)))
}

/**
 * Bow: drawn back, then just past rest on release. One per tier — a war bow is
 * pulled to the ear over half a second and kicks the view when it goes.
 * `pull` is how far the string and the nocked arrow come back with the hand (m),
 * `hold` the share of the motion spent at full draw before the loose.
 */
const DRAW = {
    draw: { time: 0.32, pull: 0.03, hold: 0.7, back: { dz: -0.16, dx: -0.03, rx: -0.12 }, release: { dz: 0.04, dx: 0, rx: 0 } },
    draw_deep: { time: 0.42, pull: 0.045, hold: 0.72, back: { dz: -0.23, dx: -0.04, rx: -0.2 }, release: { dz: 0.07, dx: 0, rx: 0.04 } },
    draw_full: { time: 0.55, pull: 0.062, hold: 0.74, back: { dz: -0.3, dx: -0.05, rx: -0.3, rz: 0.06 }, release: { dz: 0.11, dx: 0, rx: 0.1 } },
}

/** a draw's key moments (see MOTIONS `moments`): half drawn, the loose, and settled after it */
const drawMoments = (k) => ({ windUp: k.hold * 0.5, blow: k.hold, end: Math.min(1, k.hold + 0.12) })

/** how far through a draw the string is pulled (0 at rest, 1 at full draw) */
export const drawPull = (k, p) => (p < k.hold ? s(p / k.hold) : p < k.hold + 0.1 ? 1 - s((p - k.hold) / 0.1) : 0)

/** pull back, snap forward on release, settle */
const pullShoot = (k) => (p) => (p < k.hold ? scaled(k.back, s(p / k.hold))
    : p < k.hold + 0.15 ? mix(k.back, k.release, s((p - k.hold) / 0.15))
        : scaled(k.release, 1 - s((p - k.hold - 0.15) / Math.max(0.05, 1 - k.hold - 0.15))))

/**
 * pure: a motion through key poses, `[share of the time, offset]`, from rest and
 * back to rest, smoothly between them (the fist, the staff)
 * @param {[number, Record<string, number>][]} keys
 */
const keyed = (keys) => {
    /** @type {[number, Record<string, number>][]} */
    const pts = [[0, {}], ...keys, [1, {}]]
    return (p) => {
        let i = 1
        while (i < pts.length - 1 && p > pts[i][0]) i++
        const [p0, a] = pts[i - 1], [p1, b] = pts[i]
        const k = s((p - p0) / Math.max(1e-6, p1 - p0))
        const o = {}
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) o[key] = (a[key] || 0) + ((b[key] || 0) - (a[key] || 0)) * k
        return o
    }
}

/**
 * A bare fist (the grunt's, the brute's, plan 13 §2.4): it comes down the way
 * the body's arm does (make_characters.py `attack`, 14 frames): raised up and
 * back over the shoulder, down in front through the crosshair, and low. Taken
 * from the body clip's forearm at its keys.
 */
/** @type {[number, Record<string, number>][]} */
const PUNCH = [
    [4 / 14, { dx: -0.25, dy: 0.25, dz: -0.07, rx: -2.23, ry: 1.11 }],
    [6 / 14, { dx: -0.09, dy: 0.25, dz: 0.25, rx: -0.14, ry: -0.02 }],
    [8 / 14, { dx: -0.13, dy: -0.01, dz: 0.18, rx: 1.11, ry: -0.5 }],
    [11 / 14, { dx: -0.04, dy: 0.11, dz: 0.25, rx: 0.55, ry: 0.16 }],
]

/**
 * The fire mage's cast (plan 13 §2.4), as long as its body clip (44 frames):
 * the staff goes up, upright, and holds while the fireball gathers over it
 * (FIREBALL.windup, 1.2 s), then thrusts forward, the coal toward the aim.
 */
/** @type {[number, Record<string, number>][]} */
const CAST = [
    [10 / 44, { dx: 0, dy: 0.25, dz: -0.05, rx: -0.35, ry: 0.1 }],
    [22 / 44, { dx: 0.02, dy: 0.27, dz: -0.06, rx: -0.42, ry: 0.15, rz: 0.08 }],
    [34 / 44, { dx: 0, dy: 0.25, dz: -0.05, rx: -0.35, ry: 0.1 }],
    [38 / 44, { dx: 0, dy: 0.12, dz: 0.25, rx: 0.55 }],
    [41 / 44, { dx: 0, dy: 0.05, dz: 0.18, rx: 0.4 }],
]

/** a * (1 - k) + b * k over the keys of `a` (missing keys in b count as 0) */
const mix = (a, b, k) => {
    const o = {}
    for (const key of Object.keys(a)) o[key] = a[key] + ((b ? b[key] || 0 : 0) - a[key]) * k
    return o
}
const scaled = (a, k) => mix(a, null, 1 - k)

/**
 * Motions: each returns an offset from the resting pose for progress p (0..1).
 * dx/dy/dz are camera-space metres, rx/ry/rz radians. Each one ends at rest
 * (and all but equip start there), so nothing snaps when it ends or loops.
 * A motion with a `swing` is a sword stroke, and leaves a trail (TRAIL_TIER).
 * A `mirror` motion alternates with its backhand: f(p, true) (see nextStroke).
 * `moments` are its key moments as shares of its time: wound up, the blow
 * (or the loose), and the end; tests/handMatch.test.js holds the body's clip
 * to them (a swing's come from its `swing`).
 */
export const MOTIONS = {
    /**
     * every sword (plan 13 §2.3): the forehand, and the backhand on every
     * second swing so holding the button reads as a combo. 0.36 s fits inside
     * the shortest sword cooldown (the wooden sword's 0.4 s), so strokes never overlap
     */
    swing: { time: 0.36, swing: STROKE, mirror: true, f: strokeMotion(STROKE) },
    /** played over and over while you dig (see stepMotion); lands at `impact` */
    mine: { time: 0.42, loop: true, impact: CHOP.impact, moments: { windUp: CHOP.windUp, blow: CHOP.impact - 0.02, end: CHOP.hold }, f: chop },
    /** a fist (plan 13 §2.4): as the body's arm strikes */
    punch: { time: 14 / 30, moments: { windUp: 4 / 14, blow: 6 / 14, end: 8 / 14 }, f: keyed(PUNCH) },
    /** the fire mage's staff (plan 13 §2.4): up, hold while the fireball gathers, thrust */
    cast: { time: 44 / 30, moments: { windUp: 10 / 44, blow: 38 / 44, end: 41 / 44 }, f: keyed(CAST) },
    /** placing a block: a short push forward */
    place: { time: 0.22, f: (p) => ({ dz: 0.13 * bump(p), dy: -0.03 * bump(p), rx: 0.2 * bump(p) }) },
    /** shortbow, recurve, war bow: each pulls deeper and takes longer */
    draw: { time: DRAW.draw.time, draw: DRAW.draw, moments: drawMoments(DRAW.draw), f: pullShoot(DRAW.draw) },
    draw_deep: { time: DRAW.draw_deep.time, draw: DRAW.draw_deep, moments: drawMoments(DRAW.draw_deep), f: pullShoot(DRAW.draw_deep) },
    draw_full: { time: DRAW.draw_full.time, draw: DRAW.draw_full, moments: drawMoments(DRAW.draw_full), f: pullShoot(DRAW.draw_full) },
    /** musket / gun: kick back and settle */
    recoil: { time: 0.34, moments: { windUp: 0.06, blow: 0.18, end: 0.4 }, f: (p) => (p < 0.18
        ? { dz: -0.14 * (p / 0.18), dy: 0.05 * (p / 0.18), rx: -0.4 * (p / 0.18) }
        : { dz: -0.14 * (1 - s((p - 0.18) / 0.82)), dy: 0.05 * (1 - s((p - 0.18) / 0.82)), rx: -0.4 * (1 - s((p - 0.18) / 0.82)) }) },
    /** changing item: swing the new one up into view */
    equip: { time: 0.24, f: (p) => ({ dy: -0.45 * (1 - s(p)), rx: 0.9 * (1 - s(p)) }) },
    /** you took a hit */
    hit: { time: 0.2, f: (p) => ({ dy: -0.09 * bump(p), rz: 0.18 * bump(p), rx: 0.15 * bump(p) }) },
}

/**
 * pure: a motion's key moments, as shares of its time (see MOTIONS `moments`;
 * a swing's come from its stroke: the blow lands half way through the cut)
 * @returns {{windUp: number, blow: number, end: number} | null}
 */
export function momentsOf(motion) {
    const m = MOTIONS[motion]
    if (!m) return null
    if (m.moments) return m.moments
    if (m.swing) return { windUp: m.swing.windUp, blow: (m.swing.windUp + m.swing.slashEnd) / 2, end: m.swing.slashEnd }
    return null
}

/**
 * pure: the speed to play a body clip at so its blow lands with the one in
 * first person (plan 13 §2.1): the clip's blow (contract.js CLIP_KEYS) over
 * the motion's. 1 when either has no blow.
 * @param {string} clip
 * @param {string} motion
 * @param {{blow: number}} [keys] the clip's key frames, when its name alone doesn't say (a fist's `attack`)
 */
export function clipSpeed(clip, motion, keys = CLIP_KEYS[clip]) {
    const mo = momentsOf(motion)
    if (!keys || !mo) return 1
    return (keys.blow / CLIP_FPS) / (mo.blow * MOTIONS[motion].time)
}

/**
 * Two strokes this close (s, start to start) are one combo: the second is the
 * backhand. 0.9 s (plan 13 §2.3; 0.7 before), so a swordsman, striking every
 * 0.8 s, alternates as you do. After a pause the next one opens with the forehand.
 */
export const COMBO_GAP = 0.9

/**
 * pure: the stroke starting at `now` (s): the backhand when the last one began
 * within COMBO_GAP and was a forehand. Every sword swings it, in your hands,
 * on your body and on a swordsman's (control.js, units.js).
 * @param {{at: number, back: boolean} | null} last
 * @param {number} now
 * @returns {{at: number, back: boolean}}
 */
export function nextStroke(last, now) {
    return { at: now, back: !!last && now - last.at < COMBO_GAP && !last.back }
}

/** smoothstep and a there-and-back bump */
const s = (p) => {
    const x = Math.max(0, Math.min(1, p))
    return x * x * (3 - 2 * x)
}
const bump = (p) => Math.sin(Math.PI * Math.max(0, Math.min(1, p)))

/**
 * A motion in flight: which one, how far through it is, and (for a mirroring
 * swing) whether this stroke is the backhand.
 * @typedef {{name: string, t: number, mirror?: boolean}} Motion
 */

/**
 * pure: move a motion on by `dt` seconds. A looping motion (mining) only goes
 * round again while `keepLooping` is set; otherwise it finishes the cycle it's
 * in and ends, so the chop never outlasts the digging.
 * @param {Motion | null} action advanced in place
 * @param {number} dt seconds
 * @param {boolean} keepLooping
 * @returns {Motion | null} the action, or null once it's over
 */
export function stepMotion(action, dt, keepLooping) {
    const spec = action && MOTIONS[action.name]
    if (!spec) return null
    action.t += dt
    if (action.t < spec.time) return action
    if (spec.loop && keepLooping) {
        action.t %= spec.time
        return action
    }
    return null
}

/**
 * pure: did a looping motion pass its impact point going from progress `was`
 * to `now` (both 0..1; `now` below `was` means it went round again)?
 */
export function strikes(was, now, impact) {
    if (now >= was) return was < impact && now >= impact
    return was < impact || now >= impact
}

/**
 * How an item sits in the hand: position, rotation, scale. The meshes come out
 * of items.glb already pointing out of the fist, so most of them need no turning;
 * the pickaxe is rolled about its own shaft (its +Y axis), which turns the head
 * toward the plane it chops through instead of straight across it.
 */
export const ITEM_POSE = {
    // a sword points where you look: tipped forward out of the fist (pitch) and
    // a little in (yaw), so the blade reaches ahead and up toward the crosshair,
    // in line with the forearm. Never stood up across the view: that lies the
    // blade along the screen at 90° to the aim (ref/sword-90.png, next_11.md).
    // The grip sits in the fist, the guard just over it. Rolled about the
    // blade so its flats face the sides, turned to show you the inner one; the
    // swing's own roll turns the edge into the cut (see STROKE). The longer the
    // tier, the smaller it sits, so no tip covers the crosshair
    sword: { pos: [0, 0.03, 0], rot: [1.285, -0.158, 0], roll: 1.016, scale: 0.6 },
    wood_sword: { pos: [0, 0.03, 0], rot: [1.285, -0.158, 0], roll: 1.016, scale: 0.62 },
    stone_sword: { pos: [0, 0.03, 0], rot: [1.285, -0.158, 0], roll: 1.016, scale: 0.56 },
    iron_sword: { pos: [0, 0.03, 0], rot: [1.285, -0.158, 0], roll: 1.016, scale: 0.48 },
    // turned most of a quarter turn about the haft: the head chops in its own
    // plane with the long point forward, into what it hits (the camera looks
    // down +z), and enough of the side shows to read the curve of the head
    pickaxe: { pos: [0, 0.03, 0.04], rot: [0, -1.25, 0], scale: 0.6 },
    // half a turn about the stave: the string (+z in items.glb) toward you
    bow: { pos: [0.01, 0.02, 0.06], rot: [0, 0, 0], roll: Math.PI, scale: 0.7 },
    recurve_bow: { pos: [0.01, 0.02, 0.06], rot: [0, 0, 0], roll: Math.PI, scale: 0.66 },
    war_bow: { pos: [0.01, 0.02, 0.06], rot: [0, 0, 0], roll: Math.PI, scale: 0.6 },
    gun: { pos: [0, 0.02, 0.05], rot: [0, 0, 0], scale: 0.6 },
    // the sapper's pick (plan 13 §2.4): as the pickaxe, and it chops as the pickaxe does
    crude_pickaxe: { pos: [0, 0.03, 0.04], rot: [0, -1.25, 0], scale: 0.6 },
    // the fire mage's staff: upright, the coal at the top (tipped back against the arm's own lift)
    fire_staff: { pos: [0, 0.02, 0.03], rot: [0.3, 0, 0], scale: 0.55 },
    block: { pos: [0.02, 0.03, 0.08], rot: [0.3, 0.6, 0], scale: 1 },
}

/**
 * The nocked arrow: its fletching on the string (so it comes back with it) and
 * its head out past the stave, toward what you aim at. It is canted a little
 * across the view rather than pointing straight down the aim line, where it
 * would be seen end-on and read as nothing at all. `side`, `lift` and `ahead`
 * place it from the bow's own position (tests/handPose.test.js keeps its rear
 * on the string).
 */
export const NOCK = { rot: [Math.PI / 2 + 0.2, -0.1, 0], scale: 0.5, side: -0.02, lift: -0.03, ahead: 0.12 }

/**
 * How far a drawn string (and the arrow on it) moves along the hand's z for a
 * pull of `pull` metres: toward you, since the string is on your side of the
 * stave and the camera looks down +z.
 */
export const drawOffset = (pull) => -pull

/** a tier falls back to the plain pose of the thing it is a tier of */
export function poseFor(item) {
    if (ITEM_POSE[item]) return ITEM_POSE[item]
    // a bow's string sits exactly where its own stave does
    if (item.endsWith('_string')) return poseFor(item.slice(0, -'_string'.length))
    if (item.endsWith('sword')) return ITEM_POSE.sword
    if (item.endsWith('bow')) return ITEM_POSE.bow
    return ITEM_POSE.sword
}

/** no idle sway or walking bob: the hand exactly where the motion puts it */
export const STILL = { aspect: 1, x: 0, y: 0, rx: 0, rz: 0 }

/**
 * The arm's pose (camera space) for a motion offset, with a frame's sway and
 * bob. Writes into `pos` and `rot` (anything with set(x, y, z)).
 */
export function armPose(o, sway, pos, rot) {
    pos.set((HOME.x + (o.dx || 0)) * sway.aspect + sway.x, HOME.y + (o.dy || 0) + sway.y, HOME.z + (o.dz || 0))
    rot.set(-0.3 + (o.rx || 0) + sway.rx, (o.ry || 0) - 0.25, (o.rz || 0) + sway.rz)
}

/** the wrist's extra roll about the blade for a motion offset (see STROKE) */
export function wristRoll(o) {
    return o.roll || 0
}

const tmpTilt = new Matrix()
const tmpRoll = new Matrix()

/**
 * An item's rotation in the fist. `roll` (plus the wrist's `extra`) turns it
 * about its own long axis (+Y in items.glb) before the pose's tilt, so a blade
 * can be turned edge-first without changing where it points. `rot` is
 * Babylon's yaw/pitch/roll as (x, y, z); the camera looks down +z.
 * @param {{rot: number[], roll?: number}} pose
 */
export function itemRotation(pose, extra = 0, out = new Quaternion()) {
    Matrix.RotationYawPitchRollToRef(pose.rot[1], pose.rot[0], pose.rot[2], tmpTilt)
    Matrix.RotationYToRef((pose.roll || 0) + extra, tmpRoll)
    return Quaternion.FromRotationMatrixToRef(tmpRoll.multiply(tmpTilt), out)
}

/** the item's transform relative to the hand */
export function itemMatrix(pose, extra = 0) {
    return Matrix.Compose(new Vector3(pose.scale, pose.scale, pose.scale), itemRotation(pose, extra), Vector3.FromArray(pose.pos))
}

/**
 * The hand's transform in camera space (before the view model's overall
 * SCALE, which doesn't change any direction) for a motion offset.
 */
export function handMatrix(o, sway = STILL) {
    const pos = new Vector3(), rot = new Vector3()
    armPose(o, sway, pos, rot)
    const pivot = Matrix.Compose(new Vector3(1, 1, 1), Quaternion.RotationYawPitchRoll(rot.y, rot.x, rot.z), pos)
    return Matrix.Translation(0, 0, ARM.length / 2 + 0.04).multiply(pivot)
}

/**
 * an item's transform in camera space, held at progress `p` of a motion
 * (`back`: its backhand)
 */
export function heldMatrix(item, motion = null, p = 0, back = false) {
    const o = motion ? MOTIONS[motion].f(p, back) : {}
    return itemMatrix(poseFor(item), wristRoll(o)).multiply(handMatrix(o))
}
