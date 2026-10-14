/*
 *  How each item sits in a character's hand (third person), as numbers: no
 *  engine, so tests/handMatch.test.js can hold it against first person
 *  (src/game/handPose.js) without loading Babylon's scene code. The character
 *  library (library.js) parks the item meshes on the hand socket with these.
 */

/**
 * How each item sits on the hand socket: position, Euler rotation, and `roll`,
 * a turn about the item's own long axis (+y in items.glb, see itemRotation).
 * Every item anyone holds is listed by name: a missing one used to fall back to
 * the block's pose, which held the sapper's pick out like a spear.
 *
 * Plan 13 §2: the body shows what your own hands do (src/game/handPose.js is
 * the reference). The swords, the picks and the staff were fitted with their
 * clips (tools/blender/make_characters.py) so that, at rest and through the
 * stroke, the item points where it points in first person, and the edge or the
 * point leads the same way; tests/handMatch.test.js holds them there.
 *   swords   all four alike, the blade running on from the forearm (until plan
 *            13 it stood straight up out of the fist, 66° from first person)
 *   picks    the head in the plane of the chop, the long point forward
 *   staff    upright, the coal at the top
 *   bows     the string on the archer's side of the stave
 */
const HOLD = { pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], scale: 1 }
const BOW = { ...HOLD, roll: Math.PI }
const SWORD = { pos: [0, 0, 0], rot: [0.305, 0.987, 0.006], roll: -1.367, scale: 1 }
export const ITEM_POSE = {
    sword: SWORD,
    wood_sword: SWORD,
    stone_sword: SWORD,
    iron_sword: SWORD,
    pickaxe: { pos: [0, 0, 0], rot: [-0.701, 1.643, -0.923], roll: -2.693, scale: 1 },
    crude_pickaxe: { pos: [0, 0, 0], rot: [0.23, 2.237, -1.055], roll: 2.509, scale: 1 },
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
