/*
 *  Shirts (plan 16 §3): in a room, each player's builder wears a colour of its
 *  own. The builder's shirt is painted into player.glb's texture in one blue
 *  (tools/blender/make_characters.py: the torso, the sleeves, the top of the
 *  forearms). Another colour is that texture with the blue repainted, on a copy
 *  of the body's material (CharacterLibrary.shirtMaterial): no second material
 *  on the body, so no extra draw, and the first-person arms are left as they are.
 *
 *  Who wears what is worked out on every page alike (pickShirt), so nobody
 *  decides for anybody: whoever joined the room first keeps a colour.
 */

/**
 * The colours, the first being the builder's own blue (what you wear alone, and
 * what the host wears). Bright, and away from the troops': steel grey, olive,
 * dark red, muted purple, bone, brown and orange.
 */
export const SHIRTS = ['#3d8fd6', '#e6c02a', '#e35d9f', '#1aa89a', '#93d13d', '#8e63e6', '#eef1f4', '#d93a3a']

/** the blue the shirt is painted in */
const BLUE = [0x3d, 0x8f, 0xd6]
/**
 * how far a pixel's channels may be from the blue and still be shirt: the painter
 * jitters about 4%. The eyes (#1d2733) and the trousers (#3b3b58) are well outside.
 */
const NEAR = 25

/** @param {string} hex '#rrggbb' */
export const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))

/** pure: is this a colour of SHIRTS (its index)? */
export const isShirt = (/** @type {unknown} */ i) => Number.isInteger(i) && /** @type {number} */ (i) >= 0 && /** @type {number} */ (i) < SHIRTS.length

/**
 * pure: repaint the shirt in RGBA pixels, in place: every pixel near the blue
 * becomes the colour, keeping its own shade (pixel × colour ÷ blue).
 * @template {Uint8Array | Uint8ClampedArray} T
 * @param {T} px
 * @param {string} hex
 * @returns {T}
 */
export function recolorShirt(px, hex) {
    const to = rgbOf(hex)
    const k = to.map((c, i) => c / BLUE[i])
    for (let i = 0; i < px.length; i += 4) {
        if (Math.abs(px[i] - BLUE[0]) > NEAR || Math.abs(px[i + 1] - BLUE[1]) > NEAR || Math.abs(px[i + 2] - BLUE[2]) > NEAR) continue
        for (let c = 0; c < 3; c++) px[i + c] = Math.min(255, Math.round(px[i + c] * k[c]))
    }
    return px
}

/**
 * pure: the colour (index in SHIRTS) a player wears in a room.
 *  - the colour the room kept for them, unless somebody who joined before them
 *    wears it (one who joined after gives it up to them)
 *  - or else the first colour nobody here wears
 *  - or else (a ninth player) the first nobody who joined before them wears
 *  - or else one by their order
 * Every page works it out the same way from the same presences, so a clash (two
 * who came at once, or one who took your colour while you were away) settles in
 * one round: the one who joined first keeps it.
 * @param {number | null | undefined} kept the room's value for them (me.shirt), or what they wear now
 * @param {number} order their Member.order
 * @param {{order: number, shirt: number}[]} others the other players here, and what each wears
 */
export function pickShirt(kept, order, others) {
    const earlier = new Set(others.filter((o) => o.order < order).map((o) => o.shirt))
    if (isShirt(kept) && !earlier.has(/** @type {number} */ (kept))) return /** @type {number} */ (kept)
    const worn = new Set(others.map((o) => o.shirt))
    for (let i = 0; i < SHIRTS.length; i++) if (!worn.has(i)) return i
    for (let i = 0; i < SHIRTS.length; i++) if (!earlier.has(i)) return i
    return ((order % SHIRTS.length) + SHIRTS.length) % SHIRTS.length
}
