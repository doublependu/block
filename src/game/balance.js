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

export const WAVE_BASE_BUDGET = 14
export const WAVE_GROWTH = 1.18
/** extra budget per point of defence value (structures + troops) */
export const WAVE_ADAPTIVE = 0.04
export const WAVE_SUBWAVES = [2, 3, 3, 4]
export const SUBWAVE_INTERVAL = 40
/** attackers spawn on a ring this far from the town center (blocks) */
export const SPAWN_RADIUS = [45, 60]
/**
 * Feedback when something is hit: how hard a blow pushes its target back (m/s),
 * and how long the character flashes.
 */
export const HIT_FX = {
    knockback: 1.2,
    heavyKnockback: 3,
    splashKnockback: 4,
    flashSeconds: 0.12,
    /** damage numbers over what you hit, and the red edges when you're hit */
    numberSeconds: 0.8,
    vignetteSeconds: 0.55,
}

/** half-width of a front's spawn arc (radians, ~20°) */
export const FRONT_ARC = 0.35
/** from this night on, each sub-wave splits over two fronts */
export const TWO_FRONTS_FROM_NIGHT = 6

// ---- siege -------------------------------------------------------------

/**
 * How attackers wreck defences. "Wreckers" (brutes, sappers and a share of
 * grunts) go for towers first, then walls on the way, then the town center.
 */
export const SIEGE = {
    /** share of grunts that are wreckers */
    wreckerShare: 0.3,
    /** after destroying a wall block, chance to keep widening the breach */
    widenChance: 0.35,
    widenMax: 3,
    /** brute hits on built blocks also hit the blocks left and right, at this share */
    bruteSplash: 0.5,
    /** siege field head start per goal kind, in tenths of a block walked */
    seedTower: 0,
    seedWall: 200,
    seedTown: 600,
    /** wreckers only fight back against enemies this close */
    selfDefence: 2.5,
    /** night demolitions (explosions, collapses) applied per tick */
    demolishPerTick: 8,
}

/** a sapper lights a powder keg when it reaches a structure, and goes up with it */
export const SAPPER_CHARGE = {
    fuse: 2.5,
    radius: 2.5,
    unitDamage: 60,
    unitRadius: 3,
    townDamage: 400,
    townRadius: 5,
}

/** attackers can hop onto a 1-block step, never over a 2-high wall */
export const ATTACKER_JUMP = { jumpImpulse: 7, jumpForce: 0 }

// ---- opening raid ------------------------------------------------------

/**
 * The scripted attack that starts a new survival game. It is meant to be lost,
 * and to leave the town in ruins: raiders come from all four sides, wreck the
 * towers and walls first (the town center is off limits until then), and keep
 * getting reinforcements. If the town still stands after `finaleAt` seconds, a
 * scripted finale finishes the job.
 */
export const OPENING_RAID = {
    /** one group per side, seconds after the raid starts */
    groups: [3, 10, 17, 24],
    group: ['brute', 'sapper', 'grunt', 'grunt', 'grunt'],
    radius: [34, 40],
    hpMult: 1.5,
    /** a new group comes when this few raiders are left, or after `reinforceEvery` seconds */
    reinforceBelow: 6,
    reinforceEvery: 18,
    reinforcement: ['brute', 'sapper', 'grunt', 'grunt'],
    /** each reinforcement round adds this many extra brutes */
    extraBrutesPerRound: 1,
    /** the town center can be attacked once no towers are left and walls are down to this share */
    unlockWallsLeft: 0.3,
    /** scripted finale if the town still stands */
    finaleAt: 110,
    /** the finale knocks walls down to this share */
    finaleWallsLeft: 0.25,
    /** seconds of looking at the ruins before dawn */
    aftermath: 6,
    /** dawn after the raid rebuilds slowly, so the town visibly comes back */
    dawnRestoreRate: 60,
}

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
 * @property {boolean} [wrecker]  goes for towers and walls before the town center
 * @property {boolean} [splash]   hits on built blocks spread to the neighbouring blocks
 * @property {boolean} [charge]   carries a powder keg (see SAPPER_CHARGE)
 * @property {number} [mass]     pushing weight when units bump into each other (default 1, see crowd.js)
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
    brute: { type: 'brute', side: 'attacker', model: 'attacker_brute', item: null, hp: 320, damage: 26, cooldown: 1.7, range: 1.9, attack: 'melee', speed: 2.6, blockDamage: 3.5, cost: 6, unlockNight: 3, height: 1.9, width: 0.8, mass: 2.5, wrecker: true, splash: true },
    sapper: { type: 'sapper', side: 'attacker', model: 'attacker_sapper', item: 'pickaxe', hp: 50, damage: 6, cooldown: 0.7, range: 1.5, attack: 'melee', speed: 3.4, blockDamage: 2.5, cost: 3, unlockNight: 5, digs: true, wrecker: true, charge: true },
}

/** defender idle movement: wandering by day, patrolling at night */
export const DEFENDER_IDLE = {
    dayRadius: 5,
    nightRadius: 3,
    /** chance that a day walk goes to a nearby gate / tower / town center instead */
    poiChance: 0.25,
    poiRadius: 12,
    dayPause: [2, 6],
    nightPause: [1, 3],
    /** walking speed as a share of the unit's max speed */
    dayWalk: 0.45,
    nightWalk: 0.6,
}

/** the player's own avatar (the builder) */
export const PLAYER_STATS = { hp: 200, damage: 10, cooldown: 0.5, range: 2.2 }
/** noa's default run speed for the builder under player control */
export const PLAYER_SPEED = 10

/** the builder at night: knocked out / autopilot */
export const HERO = {
    respawnSeconds: 12,
    /** respawn delay by day (skirmish) */
    dayRespawnSeconds: 5,
    /** autopilot stays within this distance of the town center */
    leash: 16,
    /** autopilot engages attackers this close to itself */
    aggro: 10,
    /** the autopilot hits softer than a player would (playing yourself is worth it) */
    autopilotDamage: 0.7,
    /** autopilot walking speed */
    speed: 5.5,
}

/**
 * Weapons the builder can craft. `item` is the held mesh in items.glb, `tint`
 * colors it per tier. `value` adds to the defence value the waves scale with.
 * @type {Record<string, {attack: 'melee'|'arrow'|'bullet', damage: number, cooldown: number, range: number, item: string, tint?: number[], value: number}>}
 */
export const WEAPONS = {
    none: { attack: 'melee', damage: 10, cooldown: 0.5, range: 2.2, item: 'pickaxe', value: 0 },
    wood_sword: { attack: 'melee', damage: 16, cooldown: 0.45, range: 2.4, item: 'sword', tint: [0.75, 0.52, 0.3], value: 3 },
    stone_sword: { attack: 'melee', damage: 24, cooldown: 0.45, range: 2.4, item: 'sword', tint: [0.62, 0.62, 0.64], value: 6 },
    iron_sword: { attack: 'melee', damage: 36, cooldown: 0.45, range: 2.6, item: 'sword', tint: [1.1, 1.1, 1.15], value: 12 },
    bow: { attack: 'arrow', damage: 18, cooldown: 0.8, range: 30, item: 'bow', value: 5 },
    musket: { attack: 'bullet', damage: 60, cooldown: 1.4, range: 40, item: 'gun', value: 14 },
}

/** pure: damage per second of a weapon */
export function weaponDps(name) {
    const w = WEAPONS[name] || WEAPONS.none
    return w.damage / w.cooldown
}

// ---- towers ------------------------------------------------------------

export const TOWERS = {
    arrow: { range: 16, damage: 10, cooldown: 1.0, projectile: 'arrow', value: 14 },
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
 *   weapon   the builder's weapon (see WEAPONS)
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
    wood_sword: { kind: 'weapon' },
    stone_sword: { kind: 'weapon' },
    iron_sword: { kind: 'weapon' },
    bow: { kind: 'weapon' },
    musket: { kind: 'weapon' },
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
    { out: 'wood_sword', count: 1, cost: { planks: 4 } },
    { out: 'stone_sword', count: 1, cost: { cobble: 3, planks: 1 } },
    { out: 'iron_sword', count: 1, cost: { iron: 3, planks: 1 } },
    { out: 'bow', count: 1, cost: { planks: 3, log: 1 } },
    { out: 'musket', count: 1, cost: { iron: 4, gold: 2 } },
]

export const STARTING_INVENTORY = { planks: 12, cobble: 8, archer: 1, swordsman: 1, wood_sword: 1 }

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
