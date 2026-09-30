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

/**
 * Where the hand sits in camera space and how big it is. Everything hangs off
 * `root`, which is scaled down: the camera sits very close to it, so full-size
 * items would fill the screen.
 */
export const SCALE = 0.42
export const HOME = { x: 0.5, y: -0.52, z: 1.15 }
export const ARM = { length: 0.34, width: 0.1 }

/**
 * A melee swing: wind up over the shoulder, slash across the view, come back.
 * One per sword tier, each heavier than the last — `windUp` and `slashEnd` are
 * shares of the motion's own time, and the trail shows between them.
 *
 * `roll` turns the wrist about the blade during the stroke (radians, on top of
 * the pose's own roll): the sword rests showing three quarters of its flat,
 * and the wind-up turns it so the EDGE leads the cut. Without it the flat of
 * the blade led every slash, like a slap (next_10.md). A mirrored stroke (the
 * iron backhand) cuts in another plane and turns the wrist by `rollBack`.
 */
const SWING = {
    windUp: 0.25,
    /** end of the slash; the trail shows from windUp to here */
    slashEnd: 0.6,
    up: { dx: 0.05, dy: 0.1, dz: -0.12, rx: -0.7, rz: 0.5, roll: -0.7 },
    down: { dx: -0.25, dy: -0.16, dz: 0.12, rx: 0.8, rz: -0.7, roll: -0.7 },
}

/** stone: higher over the shoulder, straight down, and a beat where it lands */
const HEAVY = {
    windUp: 0.34,
    slashEnd: 0.58,
    /** the blade stays down this long after the blow, before the recovery */
    hold: 0.11,
    up: { dx: 0.02, dy: 0.2, dz: -0.2, rx: -1.15, rz: 0.3, roll: -0.84 },
    down: { dx: -0.06, dy: -0.26, dz: 0.16, rx: 1.15, rz: -0.25, roll: -0.84 },
}

/** iron: a wide flourish clear across the view, mirrored every second swing */
const FLOURISH = {
    windUp: 0.22,
    slashEnd: 0.66,
    up: { dx: 0.3, dy: 0.06, dz: -0.1, rx: -0.45, ry: 0.6, rz: 0.95, roll: -0.79, rollBack: -1.22 },
    down: { dx: -0.42, dy: -0.1, dz: 0.06, rx: 0.5, ry: -0.7, rz: -1.15, roll: -0.79, rollBack: -1.22 },
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

/** how far through a draw the string is pulled (0 at rest, 1 at full draw) */
export const drawPull = (k, p) => (p < k.hold ? s(p / k.hold) : p < k.hold + 0.1 ? 1 - s((p - k.hold) / 0.1) : 0)

/** pull back, snap forward on release, settle */
const pullShoot = (k) => (p) => (p < k.hold ? scaled(k.back, s(p / k.hold))
    : p < k.hold + 0.15 ? mix(k.back, k.release, s((p - k.hold) / 0.15))
        : scaled(k.release, 1 - s((p - k.hold - 0.15) / Math.max(0.05, 1 - k.hold - 0.15))))

/** a * (1 - k) + b * k over the keys of `a` (missing keys in b count as 0) */
const mix = (a, b, k) => {
    const o = {}
    for (const key of Object.keys(a)) o[key] = a[key] + ((b ? b[key] || 0 : 0) - a[key]) * k
    return o
}
const scaled = (a, k) => mix(a, null, 1 - k)

/** wind up, slash, recover — the shape every sword tier's swing is cut from */
const slash = (k) => (p) => {
    if (p < k.windUp) return scaled(k.up, s(p / k.windUp))
    if (p < k.slashEnd) return mix(k.up, k.down, s((p - k.windUp) / (k.slashEnd - k.windUp)))
    const rest = k.slashEnd + (k.hold || 0)
    if (p < rest) return scaled(k.down, 1)
    return scaled(k.down, 1 - s((p - rest) / (1 - rest)))
}

/**
 * Motions: each returns an offset from the resting pose for progress p (0..1).
 * dx/dy/dz are camera-space metres, rx/ry/rz radians. Each one ends at rest
 * (and all but equip start there), so nothing snaps when it ends or loops.
 * A motion with a `swing` is a sword stroke, and leaves a trail (TRAIL_TIER).
 */
export const MOTIONS = {
    /** wooden: a quick diagonal slash */
    swing: { time: 0.34, swing: SWING, f: slash(SWING) },
    /** stone: slow, heavy, and it lands with weight */
    swing_heavy: { time: 0.46, swing: HEAVY, f: slash(HEAVY) },
    /**
     * iron: a wide sweep, mirrored on every second swing so holding the button
     * reads as a combo rather than the same stroke over and over
     */
    swing_flourish: { time: 0.4, swing: FLOURISH, mirror: true, f: slash(FLOURISH) },
    /** played over and over while you dig (see stepMotion); lands at `impact` */
    mine: { time: 0.42, loop: true, impact: CHOP.impact, f: chop },
    /** placing a block: a short push forward */
    place: { time: 0.22, f: (p) => ({ dz: 0.13 * bump(p), dy: -0.03 * bump(p), rx: 0.2 * bump(p) }) },
    /** shortbow, recurve, war bow: each pulls deeper and takes longer */
    draw: { time: DRAW.draw.time, draw: DRAW.draw, f: pullShoot(DRAW.draw) },
    draw_deep: { time: DRAW.draw_deep.time, draw: DRAW.draw_deep, f: pullShoot(DRAW.draw_deep) },
    draw_full: { time: DRAW.draw_full.time, draw: DRAW.draw_full, f: pullShoot(DRAW.draw_full) },
    /** musket / gun: kick back and settle */
    recoil: { time: 0.34, f: (p) => (p < 0.18
        ? { dz: -0.14 * (p / 0.18), dy: 0.05 * (p / 0.18), rx: -0.4 * (p / 0.18) }
        : { dz: -0.14 * (1 - s((p - 0.18) / 0.82)), dy: 0.05 * (1 - s((p - 0.18) / 0.82)), rx: -0.4 * (1 - s((p - 0.18) / 0.82)) }) },
    /** changing item: swing the new one up into view */
    equip: { time: 0.24, f: (p) => ({ dy: -0.45 * (1 - s(p)), rx: 0.9 * (1 - s(p)) }) },
    /** you took a hit */
    hit: { time: 0.2, f: (p) => ({ dy: -0.09 * bump(p), rz: 0.18 * bump(p), rx: 0.15 * bump(p) }) },
}

/** smoothstep and a there-and-back bump */
const s = (p) => {
    const x = Math.max(0, Math.min(1, p))
    return x * x * (3 - 2 * x)
}
const bump = (p) => Math.sin(Math.PI * Math.max(0, Math.min(1, p)))

/**
 * A motion in flight: which one, how far through it is, and (for a mirroring
 * swing) whether this stroke goes the other way.
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
    // the swords are held higher and canted across the view, so you see the
    // blade instead of the end of it; the longer the tier, the smaller it sits.
    // Rolled a little about the blade: three quarters of the flat shows at rest,
    // and the swing's own roll turns the edge into the cut (see SWING)
    sword: { pos: [-0.02, 0.06, 0.02], rot: [0.3, 0, -0.42], roll: -0.35, scale: 0.6 },
    wood_sword: { pos: [-0.02, 0.06, 0.02], rot: [0.3, 0, -0.42], roll: -0.35, scale: 0.62 },
    stone_sword: { pos: [-0.02, 0.06, 0.02], rot: [0.28, 0, -0.45], roll: -0.35, scale: 0.56 },
    iron_sword: { pos: [-0.03, 0.05, 0.02], rot: [0.26, 0, -0.48], roll: -0.35, scale: 0.48 },
    // turned most of a quarter turn about the haft: the head chops in its own
    // plane with the long point forward, into what it hits (the camera looks
    // down +z), and enough of the side shows to read the curve of the head
    pickaxe: { pos: [0, 0.03, 0.04], rot: [0, -1.25, 0], scale: 0.6 },
    // half a turn about the stave: the string (+z in items.glb) toward you
    bow: { pos: [0.01, 0.02, 0.06], rot: [0, 0, 0], roll: Math.PI, scale: 0.7 },
    recurve_bow: { pos: [0.01, 0.02, 0.06], rot: [0, 0, 0], roll: Math.PI, scale: 0.66 },
    war_bow: { pos: [0.01, 0.02, 0.06], rot: [0, 0, 0], roll: Math.PI, scale: 0.6 },
    gun: { pos: [0, 0.02, 0.05], rot: [0, 0, 0], scale: 0.6 },
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
 * bob. `mirror` sweeps the same stroke the other way (a backhand), which is
 * what turns a held button into a combo instead of one stroke over and over.
 * Writes into `pos` and `rot` (anything with set(x, y, z)).
 */
export function armPose(o, sway, mirror, pos, rot) {
    const m = mirror ? -1 : 1
    pos.set((HOME.x + m * (o.dx || 0)) * sway.aspect + sway.x, HOME.y + (o.dy || 0) + sway.y, HOME.z + (o.dz || 0))
    rot.set(-0.3 + (o.rx || 0) + sway.rx, m * (o.ry || 0) - 0.25, m * (o.rz || 0) + sway.rz)
}

/** the wrist's extra roll about the blade for a motion offset (see SWING) */
export function wristRoll(o, mirror = false) {
    return (mirror && o.rollBack !== undefined ? o.rollBack : o.roll) || 0
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
export function handMatrix(o, mirror = false, sway = STILL) {
    const pos = new Vector3(), rot = new Vector3()
    armPose(o, sway, mirror, pos, rot)
    const pivot = Matrix.Compose(new Vector3(1, 1, 1), Quaternion.RotationYawPitchRoll(rot.y, rot.x, rot.z), pos)
    return Matrix.Translation(0, 0, ARM.length / 2 + 0.04).multiply(pivot)
}

/** an item's transform in camera space, held at progress `p` of a motion */
export function heldMatrix(item, motion = null, p = 0, mirror = false) {
    const o = motion ? MOTIONS[motion].f(p) : {}
    return itemMatrix(poseFor(item), wristRoll(o, mirror)).multiply(handMatrix(o, mirror))
}
