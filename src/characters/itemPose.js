/*
 *  How each item sits in a character's hand, as numbers: no engine, so
 *  tools/fp-frame.mjs and its test can pose the bodies in node without loading
 *  Babylon's scene code. The character library (library.js) parks the item
 *  meshes on the hand socket with these. First person is the body (plan 14),
 *  so this is how you hold things in either view.
 */

/**
 * How each item sits on the hand socket: position, Euler rotation, and `roll`,
 * a turn about the item's own long axis (+y in items.glb, see itemRotation).
 * Every item anyone holds is listed by name: a missing one used to fall back to
 * the block's pose, which held the sapper's pick out like a spear.
 *   swords   all four alike, the blade running on from the forearm; the hold
 *            and the slash (make_characters.py) turn the wrist to stand it up
 *            at rest and to lead with the edge
 *   picks    as before plan 13 (plan 14 §5): the head in the plane of the chop
 *   staff    upright, the coal at the top
 *   bows     the string on the archer's side of the stave
 *   tests/fpFrame.test.js checks each of these.
 */
import { Matrix, Quaternion } from '@babylonjs/core/Maths/math.vector'

const HOLD = { pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], scale: 1 }
const BOW = { ...HOLD, roll: Math.PI }
// the pickaxe and the sapper's pick as they were before plan 13 (plan 14 §5): the head in the
// plane of the overhead chop
const PICK = { pos: [0, 0, 0], rot: [0, Math.PI / 2, -Math.PI / 2], scale: 1 }
const deg = Math.PI / 180
const SWORD = { pos: [0, 0, 0], rot: [0.305, 0.987, 0.006], roll: -1.367, scale: 1 }
export const ITEM_POSE = {
    sword: SWORD,
    wood_sword: SWORD,
    stone_sword: SWORD,
    iron_sword: SWORD,
    pickaxe: { ...PICK, roll: 170 * deg },
    crude_pickaxe: { ...PICK, roll: 140 * deg },
    // the fire mage's staff (plan 12 §2)
    fire_staff: { pos: [0, 0, 0], rot: [-0.882, -1.543, 1.644], roll: 1.436, scale: 1 },
    bow: BOW, bow_string: BOW,
    recurve_bow: BOW, recurve_bow_string: BOW,
    war_bow: BOW, war_bow_string: BOW,
    gun: HOLD,
    block: { pos: [0, -0.05, 0], rot: [0, 0, 0], scale: 1 },
}

/** an item without a pose is held like a block, and says so once */
export function poseFor(item) {
    if (ITEM_POSE[item]) return ITEM_POSE[item]
    if (!warned.has(item)) {
        warned.add(item)
        console.warn('No hand pose for', item)
    }
    return ITEM_POSE.block
}
const warned = new Set()

/** the block in your hand: a cube this big (m), in its own tile */
export const BLOCK_SIZE = 0.22

/**
 * The arrow on a drawn bow's string (library.js), in the bow's own space:
 * turned to point away from the string (+z, the archer's side) through the
 * stave, its fletching on the string, a little above the grip and beside the
 * stave. It comes back with the string.
 */
export const NOCK = { pos: [-0.035, 0.04, -0.31], rot: [-Math.PI / 2, 0, 0] }

const tmpTilt = new Matrix()
const tmpRoll = new Matrix()

/**
 * An item's rotation in the hand. `roll` (plus `extra`) turns it about its own
 * long axis (+Y in items.glb) before the pose's tilt, so a blade can be turned
 * edge-first without changing where it points. `rot` is Babylon's yaw/pitch/
 * roll as (x, y, z).
 * @param {{rot: number[], roll?: number}} pose
 */
export function itemRotation(pose, extra = 0, out = new Quaternion()) {
    Matrix.RotationYawPitchRollToRef(pose.rot[1], pose.rot[0], pose.rot[2], tmpTilt)
    Matrix.RotationYToRef((pose.roll || 0) + extra, tmpRoll)
    return Quaternion.FromRotationMatrixToRef(tmpRoll.multiply(tmpTilt), out)
}
