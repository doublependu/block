/*
 *  Block and item definitions (pure data, shared by main thread and workers).
 *
 *  Block IDs are fixed here and must never be reused or renumbered for a
 *  different block; world files store block *names*, so adding blocks is safe.
 */

/**
 * @typedef {object} BlockDef
 * @property {number} id
 * @property {string} name
 * @property {string|string[]} tiles  atlas tile name(s): one, [top, bottom, sides]
 * @property {boolean} [solid]        default true
 * @property {boolean} [opaque]       default true
 * @property {boolean} [fluid]
 * @property {boolean} [alpha]        texture has transparent pixels
 * @property {number} hardness        seconds to mine by hand; Infinity = unbreakable
 * @property {string|null} drop       item name given when mined (null = nothing)
 * @property {boolean} [built]        player-built structure (attackers target, nav treats as breakable)
 * @property {boolean} [gate]         passable for defenders, a wall for attackers
 * @property {number} [contactDamage] damage per second to attackers standing inside
 * @property {string} [tower]         tower type, if this block is a defence tower
 * @property {number} [contactSlow]   attackers standing inside move at this share of their speed
 * @property {boolean} [townCenter]   part of the town center structure
 */

/** @type {BlockDef[]} */
export const BLOCKS = [
    { id: 1, name: 'bedrock', tiles: 'bedrock', hardness: Infinity, drop: null },
    { id: 2, name: 'stone', tiles: 'stone', hardness: 1.1, drop: 'cobble' },
    { id: 3, name: 'dirt', tiles: 'dirt', hardness: 0.4, drop: 'dirt' },
    { id: 4, name: 'grass', tiles: ['grass_top', 'dirt', 'grass_side'], hardness: 0.5, drop: 'dirt' },
    { id: 5, name: 'sand', tiles: 'sand', hardness: 0.4, drop: 'sand' },
    { id: 6, name: 'snow', tiles: ['snow', 'dirt', 'snow_side'], hardness: 0.35, drop: 'dirt' },
    { id: 7, name: 'water', tiles: 'water', solid: false, opaque: false, fluid: true, alpha: true, hardness: Infinity, drop: null },
    { id: 8, name: 'log', tiles: ['log_top', 'log_top', 'log_side'], hardness: 0.9, drop: 'log' },
    { id: 9, name: 'leaves', tiles: 'leaves', opaque: false, alpha: true, hardness: 0.15, drop: null },
    { id: 10, name: 'iron_ore', tiles: 'iron_ore', hardness: 1.5, drop: 'iron' },
    { id: 11, name: 'gold_ore', tiles: 'gold_ore', hardness: 1.7, drop: 'gold' },
    { id: 12, name: 'cobble', tiles: 'cobble', hardness: 1.1, drop: 'cobble', built: true },
    { id: 13, name: 'planks', tiles: 'planks', hardness: 0.7, drop: 'planks', built: true },
    { id: 14, name: 'stone_wall', tiles: 'stone_wall', hardness: 1.8, drop: 'stone_wall', built: true },
    { id: 15, name: 'iron_wall', tiles: 'iron_wall', hardness: 2.6, drop: 'iron_wall', built: true },
    { id: 16, name: 'gate', tiles: 'gate', solid: false, opaque: false, alpha: true, hardness: 0.9, drop: 'gate', built: true, gate: true },
    { id: 17, name: 'spikes', tiles: 'spikes', solid: false, opaque: false, alpha: true, hardness: 0.6, drop: 'spikes', built: true, contactDamage: 12 },
    { id: 18, name: 'arrow_tower', tiles: ['tower_top', 'planks', 'arrow_tower'], hardness: 1.6, drop: 'arrow_tower', built: true, tower: 'arrow' },
    { id: 19, name: 'cannon_tower', tiles: ['tower_top', 'cobble', 'cannon_tower'], hardness: 2.2, drop: 'cannon_tower', built: true, tower: 'cannon' },
    { id: 20, name: 'plaza', tiles: 'plaza', hardness: Infinity, drop: null },
    { id: 21, name: 'dirt_path', tiles: ['plaza', 'dirt', 'dirt'], hardness: 0.5, drop: 'dirt' },
    { id: 22, name: 'town_core', tiles: ['town_core_top', 'town_core_top', 'town_core'], hardness: Infinity, drop: null, townCenter: true },
    { id: 23, name: 'town_crystal', tiles: 'town_crystal', opaque: false, alpha: true, hardness: Infinity, drop: null, townCenter: true },
    // tier II and III of each defence family (see FAMILIES in game/balance.js).
    // Ids are append-only and world files store names, so older saves still load.
    { id: 24, name: 'steel_wall', tiles: 'steel_wall', hardness: 3.8, drop: 'steel_wall', built: true },
    { id: 25, name: 'iron_gate', tiles: 'iron_gate', solid: false, opaque: false, alpha: true, hardness: 1.8, drop: 'iron_gate', built: true, gate: true },
    { id: 26, name: 'steel_gate', tiles: 'steel_gate', solid: false, opaque: false, alpha: true, hardness: 2.8, drop: 'steel_gate', built: true, gate: true },
    { id: 27, name: 'iron_spikes', tiles: 'iron_spikes', solid: false, opaque: false, alpha: true, hardness: 0.9, drop: 'iron_spikes', built: true, contactDamage: 22 },
    { id: 28, name: 'steel_spikes', tiles: 'steel_spikes', solid: false, opaque: false, alpha: true, hardness: 1.2, drop: 'steel_spikes', built: true, contactDamage: 34, contactSlow: 0.55 },
    { id: 29, name: 'crossbow_tower', tiles: ['tower_top', 'planks', 'crossbow_tower'], hardness: 2.2, drop: 'crossbow_tower', built: true, tower: 'crossbow' },
    { id: 30, name: 'ballista_tower', tiles: ['tower_top', 'cobble', 'ballista_tower'], hardness: 2.8, drop: 'ballista_tower', built: true, tower: 'ballista' },
    { id: 31, name: 'mortar_tower', tiles: ['tower_top', 'cobble', 'mortar_tower'], hardness: 2.8, drop: 'mortar_tower', built: true, tower: 'mortar' },
    { id: 32, name: 'bombard_tower', tiles: ['tower_top', 'cobble', 'bombard_tower'], hardness: 3.4, drop: 'bombard_tower', built: true, tower: 'bombard' },
]

export const AIR = 0

/** @type {Record<string, BlockDef>} */
export const BLOCK_BY_NAME = {}
/** @type {BlockDef[]} indexed by id */
export const BLOCK_BY_ID = []
for (const b of BLOCKS) {
    if (b.solid === undefined) b.solid = true
    if (b.opaque === undefined) b.opaque = true
    BLOCK_BY_NAME[b.name] = b
    BLOCK_BY_ID[b.id] = b
}

/** @param {string} name */
export function blockId(name) {
    if (name === 'air') return AIR
    const b = BLOCK_BY_NAME[name]
    if (!b) throw new Error('Unknown block: ' + name)
    return b.id
}

/** @param {number} id */
export function blockName(id) {
    if (id === AIR) return 'air'
    return BLOCK_BY_ID[id] ? BLOCK_BY_ID[id].name : 'air'
}

/** Block IDs frequently used by worldgen */
export const B = {
    bedrock: blockId('bedrock'),
    stone: blockId('stone'),
    dirt: blockId('dirt'),
    grass: blockId('grass'),
    sand: blockId('sand'),
    snow: blockId('snow'),
    water: blockId('water'),
    log: blockId('log'),
    leaves: blockId('leaves'),
    iron_ore: blockId('iron_ore'),
    gold_ore: blockId('gold_ore'),
    plaza: blockId('plaza'),
    dirt_path: blockId('dirt_path'),
    town_core: blockId('town_core'),
    town_crystal: blockId('town_crystal'),
}

/**
 * Colour of the chips that fly off a block when it's hit or broken (rgb 0..1).
 * Roughly the tile's main colour (see world/atlas.js); anything missing uses stone grey.
 */
export const BLOCK_DUST = {
    stone: [0.5, 0.5, 0.52], cobble: [0.48, 0.48, 0.5], bedrock: [0.23, 0.23, 0.25],
    dirt: [0.48, 0.33, 0.2], grass: [0.37, 0.66, 0.23], dirt_path: [0.55, 0.45, 0.35],
    sand: [0.86, 0.8, 0.55], snow: [0.93, 0.95, 0.97],
    log: [0.42, 0.29, 0.17], planks: [0.72, 0.57, 0.36], leaves: [0.27, 0.55, 0.2],
    iron_ore: [0.6, 0.55, 0.5], gold_ore: [0.7, 0.6, 0.3],
    stone_wall: [0.55, 0.55, 0.58], iron_wall: [0.7, 0.72, 0.76], steel_wall: [0.82, 0.85, 0.9],
    gate: [0.45, 0.31, 0.18], iron_gate: [0.6, 0.62, 0.66], steel_gate: [0.78, 0.8, 0.85],
    spikes: [0.6, 0.6, 0.62], iron_spikes: [0.72, 0.74, 0.78], steel_spikes: [0.85, 0.88, 0.93],
    arrow_tower: [0.62, 0.5, 0.33], crossbow_tower: [0.58, 0.55, 0.45], ballista_tower: [0.7, 0.68, 0.5],
    cannon_tower: [0.45, 0.45, 0.47], mortar_tower: [0.5, 0.5, 0.54], bombard_tower: [0.62, 0.58, 0.42],
    plaza: [0.66, 0.62, 0.55], town_core: [0.79, 0.7, 0.48], town_crystal: [0.5, 0.8, 0.9],
}

export const dustColor = (name) => BLOCK_DUST[name] || BLOCK_DUST.stone
