/*
 *  Game balance: every tunable number in one place.
 */

// ---- day / night -------------------------------------------------------

export const DAY_SECONDS = 8 * 60
export const DUSK_SECONDS = 10
export const NIGHT_MAX_SECONDS = 5 * 60
export const DAWN_MIN_SECONDS = 4
/** blocks rebuilt per second at dawn */
export const DAWN_RESTORE_RATE = 300

// ---- blocks ------------------------------------------------------------

/** night block hp = hardness * this */
export const HP_PER_HARDNESS = 60
/** mining speed multiplier for the player (1 = hardness seconds) */
export const PLAYER_MINE_SPEED = 1
/** max distance for mining/placing */
export const REACH = 6

// ---- town center -------------------------------------------------------

export const TOWN_CENTER_HP = 2500

// ---- waves -------------------------------------------------------------

export const WAVE_BASE_BUDGET = 10
export const WAVE_GROWTH = 1.18
/** extra budget per point of defence value (structures + troops) */
export const WAVE_ADAPTIVE = 0.04
export const WAVE_SUBWAVES = [2, 3, 3, 4]
export const SUBWAVE_INTERVAL = 25

// ---- skirmish ----------------------------------------------------------

/** seconds between daytime scout groups (random within range) */
export const SKIRMISH_INTERVAL = [70, 140]
export const SKIRMISH_GROUP = [1, 3]

// ---- units -------------------------------------------------------------

/**
 * @typedef {object} UnitDef
 * @property {string} type
 * @property {'defender'|'attacker'} side
 * @property {string} model       character GLB name (public/models/<model>.glb)
 * @property {string|null} item   held item node name in items.glb
 * @property {number} hp
 * @property {number} damage      per hit
 * @property {number} cooldown    seconds between attacks
 * @property {number} range       attack range in blocks
 * @property {'melee'|'arrow'|'bullet'|'cannonball'} attack
 * @property {number} speed       max move speed (blocks/s)
 * @property {number} blockDamage multiplier vs blocks
 * @property {number} cost        wave budget points (attackers) / defence value (defenders)
 * @property {number} unlockNight first night this attacker can appear
 * @property {boolean} [digs]     can break natural terrain
 * @property {number} [scale]
 * @property {number} [height]
 * @property {number} [width]
 */

/** @type {Record<string, UnitDef>} */
export const UNITS = {
    // defenders (placed by the player)
    swordsman: { type: 'swordsman', side: 'defender', model: 'defender_swordsman', item: 'sword', hp: 160, damage: 18, cooldown: 0.8, range: 1.6, attack: 'melee', speed: 5, blockDamage: 0, cost: 12, unlockNight: 0 },
    archer: { type: 'archer', side: 'defender', model: 'defender_archer', item: 'bow', hp: 90, damage: 11, cooldown: 1.2, range: 16, attack: 'arrow', speed: 5, blockDamage: 0, cost: 10, unlockNight: 0 },
    gunner: { type: 'gunner', side: 'defender', model: 'defender_gunner', item: 'gun', hp: 110, damage: 30, cooldown: 2.0, range: 20, attack: 'bullet', speed: 4.5, blockDamage: 0, cost: 16, unlockNight: 0 },

    // attackers (spawned by waves)
    grunt: { type: 'grunt', side: 'attacker', model: 'attacker_grunt', item: null, hp: 60, damage: 9, cooldown: 1.0, range: 1.5, attack: 'melee', speed: 3.6, blockDamage: 1, cost: 1, unlockNight: 1 },
    raider: { type: 'raider', side: 'attacker', model: 'attacker_archer', item: 'bow', hp: 45, damage: 7, cooldown: 1.6, range: 13, attack: 'arrow', speed: 3.8, blockDamage: 0.3, cost: 2, unlockNight: 2 },
    brute: { type: 'brute', side: 'attacker', model: 'attacker_brute', item: null, hp: 320, damage: 26, cooldown: 1.7, range: 1.9, attack: 'melee', speed: 2.6, blockDamage: 3.5, cost: 6, unlockNight: 3, height: 1.9, width: 0.8 },
    sapper: { type: 'sapper', side: 'attacker', model: 'attacker_sapper', item: 'pickaxe', hp: 50, damage: 6, cooldown: 0.7, range: 1.5, attack: 'melee', speed: 3.4, blockDamage: 2.5, cost: 3, unlockNight: 5, digs: true },
}

/** the player's own avatar when building / in defender role without a unit */
export const PLAYER_STATS = { hp: 200, damage: 20, cooldown: 0.5, range: 2.2 }

// ---- towers ------------------------------------------------------------

export const TOWERS = {
    arrow: { range: 18, damage: 12, cooldown: 1.0, projectile: 'arrow', value: 14 },
    cannon: { range: 22, damage: 45, cooldown: 3.2, projectile: 'cannonball', splash: 2.5, value: 24 },
}

export const PROJECTILES = {
    arrow: { speed: 28, gravity: 6, radius: 0.25 },
    bullet: { speed: 60, gravity: 0, radius: 0.2 },
    cannonball: { speed: 22, gravity: 9, radius: 0.35 },
}

// ---- items & recipes -----------------------------------------------------

/**
 * Item kinds:
 *   block    places a voxel of the same name
 *   unit     places a defender unit
 *   resource can't be placed, used in recipes
 */
export const ITEMS = {
    dirt: { kind: 'block' },
    sand: { kind: 'block' },
    log: { kind: 'block' },
    cobble: { kind: 'block' },
    planks: { kind: 'block' },
    stone_wall: { kind: 'block' },
    iron_wall: { kind: 'block' },
    gate: { kind: 'block' },
    spikes: { kind: 'block' },
    arrow_tower: { kind: 'block' },
    cannon_tower: { kind: 'block' },
    iron: { kind: 'resource' },
    gold: { kind: 'resource' },
    swordsman: { kind: 'unit' },
    archer: { kind: 'unit' },
    gunner: { kind: 'unit' },
}

export const RECIPES = [
    { out: 'planks', count: 4, cost: { log: 1 } },
    { out: 'stone_wall', count: 2, cost: { cobble: 3 } },
    { out: 'iron_wall', count: 2, cost: { cobble: 2, iron: 1 } },
    { out: 'gate', count: 1, cost: { planks: 4 } },
    { out: 'spikes', count: 2, cost: { planks: 1, iron: 1 } },
    { out: 'arrow_tower', count: 1, cost: { planks: 6, cobble: 4 } },
    { out: 'cannon_tower', count: 1, cost: { cobble: 8, iron: 4 } },
    { out: 'swordsman', count: 1, cost: { iron: 3, gold: 1 } },
    { out: 'archer', count: 1, cost: { planks: 4, gold: 1 } },
    { out: 'gunner', count: 1, cost: { iron: 4, gold: 2 } },
]

export const STARTING_INVENTORY = { planks: 12, cobble: 8, archer: 1, swordsman: 1 }

/** defence value of a built block (towers count more) */
export function blockDefenceValue(name) {
    if (name === 'arrow_tower') return TOWERS.arrow.value
    if (name === 'cannon_tower') return TOWERS.cannon.value
    if (name === 'iron_wall') return 0.6
    if (name === 'stone_wall') return 0.4
    if (name === 'spikes') return 0.5
    if (name === 'gate' || name === 'planks' || name === 'cobble') return 0.2
    return 0
}
