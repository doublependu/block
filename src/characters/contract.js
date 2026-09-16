/*
 *  Character GLB contract (docs/character-contract.md), runtime side:
 *  clip name normalisation, aliases, fallbacks and bone groups.
 */

export const BUILTIN_MODELS = [
    'player', 'defender_swordsman', 'defender_archer', 'defender_gunner',
    'attacker_grunt', 'attacker_archer', 'attacker_brute', 'attacker_sapper',
]

export const CLIPS = [
    'idle', 'walk', 'run', 'jump', 'fall', 'mine', 'place', 'attack', 'shoot',
    'hit', 'die', 'hold_item', 'hold_bow', 'hold_sword', 'hold_gun', 'cheer',
]

/** full-body loops that drive locomotion */
export const BASE_CLIPS = new Set(['idle', 'walk', 'run', 'fall', 'cheer'])
/** upper-body one-shots layered over locomotion */
export const UPPER_ACTIONS = new Set(['mine', 'place', 'attack', 'shoot'])
/** full-body one-shots */
export const FULL_ACTIONS = new Set(['jump', 'hit', 'die'])

export const ARM_BONES = ['upper_arm.L', 'lower_arm.L', 'hand.L', 'upper_arm.R', 'lower_arm.R', 'hand.R']
export const UPPER_BONES = ['spine', 'chest', 'neck', 'head', ...ARM_BONES]

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
}

/** "Armature|Walk Cycle" -> "walk_cycle" -> alias/contract name */
export function normaliseClipName(raw) {
    let n = String(raw).split('|').pop().trim().toLowerCase().replace(/[\s-]+/g, '_')
    if (ALIASES[n]) n = ALIASES[n]
    return n
}

/** which hold pose goes with a held item */
export function holdForItem(item) {
    if (!item) return null
    if (item === 'sword' || item === 'pickaxe') return 'hold_sword'
    if (item === 'bow') return 'hold_bow'
    if (item === 'gun') return 'hold_gun'
    return 'hold_item'
}
