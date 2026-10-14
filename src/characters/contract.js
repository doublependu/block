/*
 *  Character GLB contract (docs/character-contract.md), runtime side:
 *  clip name normalisation, aliases, fallbacks and bone groups.
 */

export const BUILTIN_MODELS = [
    'player', 'defender_swordsman', 'defender_archer', 'defender_gunner',
    'attacker_grunt', 'attacker_archer', 'attacker_brute', 'attacker_sapper', 'attacker_pyro',
]

export const CLIPS = [
    'idle', 'walk', 'run', 'jump', 'fall', 'mine', 'place', 'attack', 'shoot',
    'hit', 'die', 'hold_item', 'hold_bow', 'hold_sword', 'hold_gun', 'cheer',
]

/**
 * Clips only some models carry: the full bow draw (every model with a bow),
 * the fire mage's `cast` (the staff held up while a fireball gathers, then
 * thrust forward), and `hold_fists`, the fists raised at rest of those who
 * fight with them (the grunt, the brute). And `hold_pick`, a pick held up at
 * rest as before plan 13 (every bundled model). A model without one falls back
 * (see FALLBACKS) or does without, so a character GLB without them is still complete.
 */
export const EXTRA_CLIPS = ['shoot_draw', 'cast', 'hold_fists', 'hold_pick']

/** full-body loops that drive locomotion */
export const BASE_CLIPS = new Set(['idle', 'walk', 'run', 'fall', 'cheer'])
/** upper-body one-shots layered over locomotion (a unit that gets hit keeps walking) */
export const UPPER_ACTIONS = new Set(['mine', 'place', 'attack', 'shoot', 'hit', 'shoot_draw', 'cast'])

/** frames per second of the bundled clips (tools/blender/make_characters.py) */
export const CLIP_FPS = 30

/**
 * The key frames of the clips that strike or loose (make_characters.py): wound
 * up, the blow (or the loose), and the end. The game times what a blow does to
 * them: the dig sound and chips at the chop's blow, the arrow on the string
 * until the loose, the musket's flash. `attack` here is a sword model's slash;
 * a fist's is the strike at `attack_fist`.
 */
export const CLIP_KEYS = {
    attack: { windUp: 3, blow: 5, end: 7 },
    attack_fist: { windUp: 4, blow: 6, end: 8 },
    mine: { windUp: 0, blow: 8, end: 10 },
    shoot: { windUp: 0, blow: 2, end: 6 },
    shoot_draw: { windUp: 5, blow: 12, end: 14 },
    cast: { windUp: 10, blow: 38, end: 41 },
}
/**
 * pure: did a clip reach frame `at` going from frame `was` to `now`? A clip
 * that started over (`now` below `was`) reaches it again only once it gets
 * there. What times a chop's blow to the dig sound (library.js).
 */
export function reaches(was, now, at) {
    return now >= at && was < at
}

/** full-body one-shots */
export const FULL_ACTIONS = new Set(['jump', 'die'])

export const ARM_BONES = ['upper_arm.L', 'lower_arm.L', 'hand.L', 'upper_arm.R', 'lower_arm.R', 'hand.R']
export const UPPER_BONES = ['spine', 'chest', 'neck', 'head', ...ARM_BONES]
/**
 * What first person draws of a body (plan 14 §2.1): the forearms and hands.
 * Seen from just behind the head, the upper arms are big blocks in the bottom
 * corners of the screen
 */
export const FP_BONES = ['lower_arm.L', 'hand.L', 'lower_arm.R', 'hand.R']

export const ITEM_SOCKET = 'hand.R_socket'

const ALIASES = {
    mine_block: 'mine', mining: 'mine', dig: 'mine',
    place_block: 'place', build: 'place',
    melee: 'attack', slash: 'attack', swing: 'attack',
    fire: 'shoot', shooting: 'shoot',
    death: 'die', dead: 'die',
    damage: 'hit', hurt: 'hit',
    running: 'run', sprint: 'run',
    walking: 'walk',
    falling: 'fall',
    hold: 'hold_item', hold_block: 'hold_item',
    victory: 'cheer', celebrate: 'cheer',
}

/** fallback chains when a clip is missing */
export const FALLBACKS = {
    run: ['walk', 'idle'],
    walk: ['idle'],
    fall: ['jump', 'idle'],
    cheer: ['idle'],
    mine: ['attack'],
    place: ['attack', 'mine'],
    attack: ['mine'],
    shoot: ['attack'],
    shoot_draw: ['shoot', 'attack'],
    cast: ['shoot', 'attack'],
    hold_pick: ['hold_sword'],
}

/** "Armature|Walk Cycle" -> "walk_cycle" -> alias/contract name */
export function normaliseClipName(raw) {
    let n = String(raw).split('|').pop().trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (ALIASES[n]) n = ALIASES[n]
    return n
}

/** which hold pose goes with a held item (the weapon tiers are their own meshes) */
export function holdForItem(item) {
    if (!item) return null
    if (item.endsWith('pickaxe')) return 'hold_pick'
    if (item.endsWith('sword')) return 'hold_sword'
    if (item.endsWith('bow')) return 'hold_bow'
    if (item === 'gun') return 'hold_gun'
    return 'hold_item'
}

/**
 * A bow's string is its own node in items.glb, so a draw can pull it back
 * without moving the stave. It is attached beside the bow wherever one is held.
 * @returns {string|null} the companion node's name
 */
export function companionItem(item) {
    return item && item.endsWith('bow') ? item + '_string' : null
}

/**
 * How fast the ground moves under the planted foot when a clip plays at speed
 * ratio 1 (m/s), measured on the bundled GLBs with `npm run anim-check`.
 * Playing walk / run at speed / groundSpeed keeps the feet from skating.
 */
export const GROUND_SPEED = {
    player: { walk: 1.73, run: 4.31 },
    defender_swordsman: { walk: 1.76, run: 4.38 },
    defender_archer: { walk: 1.70, run: 4.23 },
    defender_gunner: { walk: 1.73, run: 4.31 },
    attacker_grunt: { walk: 1.73, run: 4.31 },
    attacker_archer: { walk: 1.73, run: 4.34 },
    attacker_brute: { walk: 2.13, run: 5.28 },
    attacker_sapper: { walk: 1.66, run: 4.14 },
}

/** ground speeds for a model; unknown (external) models: the player's, scaled by body height */
export function groundSpeeds(model, height = 1.75) {
    if (GROUND_SPEED[model]) return GROUND_SPEED[model]
    const k = height / 1.75
    return { walk: GROUND_SPEED.player.walk * k, run: GROUND_SPEED.player.run * k }
}

/** start / stop walking (m/s) */
export const WALK_ON = 0.45
export const WALK_OFF = 0.2
/** start / stop running, as multiples of the model's walk ground speed */
export const RUN_ON = 1.95
export const RUN_OFF = 1.7

/**
 * idle / walk / run from horizontal speed, with hysteresis so a unit near a
 * threshold doesn't flicker between clips.
 * @param {'idle'|'walk'|'run'} prev
 * @param {number} speed
 * @param {{walk: number, run: number}} speeds
 */
export function nextGait(prev, speed, speeds) {
    if (prev === 'run' ? speed > speeds.walk * RUN_OFF : speed >= speeds.walk * RUN_ON) return 'run'
    if (prev === 'idle' ? speed >= WALK_ON : speed > WALK_OFF) return 'walk'
    return 'idle'
}

/** playback speed that matches the clip's stride to the unit's speed */
export function gaitRate(gait, speed, speeds) {
    if (gait === 'walk') return Math.min(2, Math.max(0.5, speed / speeds.walk))
    if (gait === 'run') return Math.min(2.8, Math.max(0.6, speed / speeds.run))
    return 1
}
