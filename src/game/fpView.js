/*
 *  First person is the body itself (plan 14): the same model, clips and item
 *  as third person, carried by the camera. These are the numbers for it, with
 *  no scene (tools/fp-frame.mjs and tests/fpFrame.test.js use them in node):
 *
 *    - where your body is seen from (the vantage): a point a little behind
 *      your eye. From the eye itself the game's 46° view leaves the hand that
 *      holds a sword below the screen, and the blade passes a hand's width from
 *      the eye (plan 14 §0.1). The world is still seen from the eye; only your
 *      body is drawn as if from here, over the world (firstPerson.js)
 *    - where a shot leaves the item you hold
 */

/**
 * The vantage in the body's frame (m; x to its right, y up from the feet, z
 * ahead), for a body of the builder's size; a bigger body scales it (see
 * `vantage`). Fitted (plan 14 §2.3, tools/fp-frame.mjs) so that at rest the
 * hand is in the lower right and nothing covers the crosshair, and a sword's
 * slash crosses it. `narrow`: on a screen narrower than `aspect` (a phone held
 * upright) the vantage moves a little toward the right shoulder and back, by
 * up to `x` and `z` at `min`, so the hand stays in view and the slash still
 * crosses the crosshair.
 */
export const VANTAGE = { x: 0.04, y: 1.7, z: -1.0, narrow: { aspect: 1.4, min: 0.45, x: 0.04, z: -0.7 } }

/** the builder's head bone above its feet (m): a body's size is its head's height over this */
export const HEAD_HEIGHT = 1.46

/**
 * pure: the vantage for a body whose head bone stands `head` m above its feet,
 * on a screen `aspect` wide (width / height)
 * @returns {[number, number, number]}
 */
export function vantage(head = HEAD_HEIGHT, aspect = 16 / 9) {
    const k = head / HEAD_HEIGHT
    const n = VANTAGE.narrow
    const narrow = Math.max(0, Math.min(1, (n.aspect - aspect) / (n.aspect - n.min)))
    return [(VANTAGE.x + n.x * narrow) * k, VANTAGE.y * k, (VANTAGE.z + n.z * narrow) * k]
}

/**
 * Where a shot leaves what you hold, in the item's own space (items.glb): past
 * a bow's stave, where the arrow on the string points; the musket's muzzle.
 */
export const MUZZLE = {
    bow: [0, 0.03, -0.3], recurve_bow: [0, 0.03, -0.3], war_bow: [0, 0.03, -0.3],
    gun: [0, 0.03, 0.47],
    fire_staff: [0, 1.0, 0],
}

/**
 * Your shot in first person leaves from where your weapon shows on the screen,
 * this far from your eye (m). The weapon shows as if about 1.4 m ahead (it's
 * seen from the vantage), and a shot from there flies almost along your view:
 * seen end on, a dot. From nearer, on the same line of sight, it comes out
 * from behind the bow and crosses the view toward the crosshair.
 */
export const SHOT_NEAR = 0.6

/**
 * pure: the point on the line from `eye` to `at` that is `dist` from the eye,
 * or `at` itself when that's nearer
 */
export function nearer(eye, at, dist) {
    const d = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]
    const len = Math.hypot(d[0], d[1], d[2])
    if (len <= dist) return at.slice()
    const k = dist / len
    return [eye[0] + d[0] * k, eye[1] + d[1] * k, eye[2] + d[2] * k]
}
