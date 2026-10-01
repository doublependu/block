/*
 *  Game balance: every tunable number in one place.
 */

// ---- day / night -------------------------------------------------------

/**
 * A survival game's lives: each night the Town Center falls costs one, and the
 * last one ends the game (the opening raid, which is meant to be lost, doesn't
 * count). A lost night still comes back at the same level after the rebuild.
 */
export const LIVES = 3

export const DAY_SECONDS = 8 * 60
export const DUSK_SECONDS = 10
export const NIGHT_MAX_SECONDS = 5 * 60

/**
 * Dawn: the town rebuilds itself, paced by time rather than a fixed rate so
 * it's always slow enough to watch. First light, then the rebuild, then a
 * moment to look at the finished town before the day starts (seconds).
 */
export const DAWN = {
    lead: 1,
    /** after a normal night: base + perBlock * blocks, clamped to min..max */
    base: 3,
    perBlock: 0.1,
    minRebuild: 5,
    maxRebuild: 10,
    /** after the opening raid: much more to rebuild, and the first time you see it */
    openingRebuild: 12,
    hold: 1.5,
    /** a dawn with nothing to rebuild */
    empty: 4,
}

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

/**
 * Each attacker type comes as its own stream from its first night, so a new
 * type adds to the wave instead of taking the place of grunts. Attackers of a
 * type on a night, n nights after it unlocks: start × growth^n + perNight × n
 * (fractions are rolled: 2.4 is 2 or 3). From night `linearFrom` on, a stream
 * that compounds grows by that night's step instead (plan 12 §5.4): the grunts
 * gained ×1.18 a night forever, which past night 15 no defence could answer.
 */
export const WAVE_STREAMS = {
    grunt: { start: 14, growth: 1.18, perNight: 0, linearFrom: 12 },
    raider: { start: 2, growth: 1, perNight: 0.8 },
    brute: { start: 1, growth: 1, perNight: 0.4 },
    sapper: { start: 2, growth: 1, perNight: 0.5 },
    pyro: { start: 1, growth: 1, perNight: 0.35 },
}
/**
 * The attack answers what you build. Every point of defence value above
 * `free` (the starting town: 225) adds k budget points, where k starts at `start`
 * on night 1 and grows by `perNight` up to `max`: building early buys nights,
 * and later the attack catches up. The extra budget is spent on the attackers
 * that counter what the defence is made of (WAVE_COUNTERS). Troops count
 * `troops` times their value.
 */
export const WAVE_ADAPTIVE = {
    free: 226, start: 0.05, perNight: 0.04, max: 0.4,
    /** troops count this many times their value: they cost gold once and are back every dawn */
    troops: 2,
}
/**
 * Which attackers answer each part of a defence, as shares of that part's
 * extra budget (a type that isn't unlocked yet comes as grunts):
 *   arrow   arrow towers: brutes, whom arrows barely hurt (ARMOUR)
 *   cannon  cannon towers: sappers, who go for towers and blow them up
 *   troops  placed defenders: raiders and brutes
 *   walls   walls, gates, spikes and other built blocks: sappers, who blow them up
 *   frost   ice blocks and frost towers: fire mages, whose fireballs melt ice, and grunts (plan 12 §5.1)
 *   weapon  the builder's weapon: raiders
 */
export const WAVE_COUNTERS = {
    arrow: { brute: 1 },
    cannon: { sapper: 1 },
    troops: { raider: 0.5, brute: 0.5 },
    walls: { sapper: 1 },
    // half fire mages, half grunts: with mages alone, a frost town drew so many that they undid
    // the freeze (the map, next_12 §7.1)
    frost: { pyro: 0.5, grunt: 0.5 },
    weapon: { raider: 1 },
}
/**
 * Past the attacker cap (twice the device's maxAttackers), a night's extra
 * attackers come back as more HP on the ones that come, and their blows land
 * harder, but at most `maxDamage` times (plan 12 §5.4: it used to be the full
 * HP multiplier, ×2 by night 17 and ×5 by night 24, and a castle's walls and
 * troops simply melted).
 */
export const WAVE_OVERFLOW = { maxDamage: 1.25 }

/** from this night on, every `every`th sub-wave comes at one of the `pick` least defended sides */
export const WEAK_SIDE = { fromNight: 4, every: 3, pick: 3 }
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

/**
 * The fire mage's fireball (plan 12 §2.2): it blows a crater in whatever it
 * lands on, built or natural (dawn rebuilds it, like all night damage), and
 * melts ice further out. Only defenders, the builder and the Town Center are
 * hurt: it's the attackers' own spell.
 */
export const FIREBALL = {
    /** seconds the ball gathers at the staff before it's thrown: kill or freeze the mage to stop it */
    windup: 1.2,
    /** blocks within this of the impact are destroyed (2.0 in plan 12; 1.7 after the map: a frost town drew enough mages to undo its freeze) */
    radius: 1.7,
    /** ice blocks within this go too: fire melts ice */
    iceRadius: 2.5,
    unitDamage: 45,
    unitRadius: 3,
    /** about what a grunt does to it over a cast's cooldown: a fire mage breaks walls, it doesn't siege the Town Center from afar */
    townDamage: 60,
    townRadius: 4,
    /** a defender or the builder this close gets the fireball instead of the structure */
    selfDefence: 5,
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
    /**
     * The raid always comes, but it's only scripted to be lost against a town
     * about as strong as the starter one (the default world's is worth 222 in
     * defence value). A stronger town gets a real fight: no finale, the
     * reinforcements stop at finaleAt, and if every raider falls, it held.
     */
    scripted: 260,
    /** the finale knocks walls down to this share */
    finaleWallsLeft: 0.25,
    /** seconds of looking at the ruins before dawn (the rebuild after it: DAWN.openingRebuild) */
    aftermath: 6,
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
 * @property {'melee'|'arrow'|'bullet'|'cannonball'|'fireball'} attack
 * @property {number} speed       max move speed (blocks/s)
 * @property {number} blockDamage multiplier vs blocks
 * @property {number} cost        wave budget points (attackers) / defence value (defenders)
 * @property {number} unlockNight first night this attacker can appear
 * @property {boolean} [digs]     can break natural terrain
 * @property {boolean} [wrecker]  goes for towers and walls before the town center
 * @property {boolean} [splash]   hits on built blocks spread to the neighbouring blocks
 * @property {boolean} [charge]   carries a powder keg (see SAPPER_CHARGE)
 * @property {boolean} [caster]   throws fireballs at structures from range (see FIREBALL)
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
    sapper: { type: 'sapper', side: 'attacker', model: 'attacker_sapper', item: 'crude_pickaxe', hp: 50, damage: 6, cooldown: 0.7, range: 1.5, attack: 'melee', speed: 3.4, blockDamage: 2.5, cost: 3, unlockNight: 5, digs: true, wrecker: true, charge: true },
    // the fire mage (plan 12 §2): lobs fireballs at towers and walls from range
    pyro: { type: 'pyro', side: 'attacker', model: 'attacker_pyro', item: 'fire_staff', hp: 70, damage: 0, cooldown: 7, range: 14, attack: 'fireball', speed: 3.0, blockDamage: 0, cost: 6, unlockNight: 7, wrecker: true, caster: true },
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

/**
 * Damage taken by attack kind (1 when not listed). Brutes shrug off arrows:
 * towers' arrows, archers' and the bow. Cannons, bullets and blades hurt them
 * fully.
 * @type {Record<string, Record<string, number>>}
 */
export const ARMOUR = {
    brute: { arrow: 0.5, ice_arrow: 0.5 },
}

/**
 * Frost (plan 12 §3): ice arrows and ice blocks freeze attackers. A frozen
 * attacker can't move, attack or cast, and takes `vulnerable` times the damage
 * from every attack. Once it thaws it can't be frozen again for `immune`
 * seconds, so nothing is held frozen forever (at most 40% of the time).
 * Defenders and the builder are never frozen.
 */
export const FROST = {
    freeze: 2.0,
    immune: 3.0,
    vulnerable: 1.5,
}

/** pure: how much of a hit of this attack kind a unit type takes */
export function armourFactor(type, attack) {
    const a = ARMOUR[type]
    return a && a[attack] !== undefined ? a[attack] : 1
}

/** the player's own avatar (the builder) */
export const PLAYER_STATS = { hp: 200, damage: 10, cooldown: 0.5, range: 2.2 }
/**
 * The builder walks by default and runs while Shift is held (see control.js).
 *
 * Both speeds are inside what the gait clips carry honestly: the walk clip's
 * ground speed is 1.73 m/s and the run clip's 4.31 (GROUND_SPEED), so these
 * play at 1.6x and 2.1x, under the 2x / 2.8x caps in `gaitRate`. The walk also
 * has to sit *below* RUN_OFF x 1.73 = 2.94, or letting go of Shift would leave
 * the builder in the run clip at three quarters speed — the very thing this
 * pair of speeds is here to fix.
 */
export const PLAYER_GAIT = { walk: 2.8, run: 9 }
/** the builder's top speed: what `mv.maxSpeed` is set to while running */
export const PLAYER_SPEED = PLAYER_GAIT.run

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
 * Weapons the builder can craft. `item` is the held mesh in items.glb — one per
 * tier, so the tiers differ in the hand and not just in colour. `value` adds to
 * the defence value the waves scale with.
 *
 * Presentation per tier: `motion` is what your own hands do (MOTIONS in
 * viewModel.js — a swing for a blade, a draw for a bow), `clip` the body clip
 * (only the player model carries the extra ones; everyone else falls back, see
 * FALLBACKS). A draw's own time always fits inside the weapon's cooldown, so it
 * never lies about when you can shoot again. `impact` is what a landed blow
 * does beyond the damage: how hard it shakes the view, and the colour of the
 * chips it strikes off (a heavier blade hits harder in every sense).
 * @type {Record<string, {attack: 'melee'|'arrow'|'bolt'|'bullet'|'ice_arrow', damage: number, cooldown: number, range: number, item: string, tint?: number[], value: number, motion?: string, clip?: string, impact?: {shake: number, chips: number[]}}>}
 */
export const WEAPONS = {
    none: { attack: 'melee', damage: 10, cooldown: 0.5, range: 2.2, item: 'pickaxe', value: 0 },
    wood_sword: { attack: 'melee', damage: 16, cooldown: 0.4, range: 2.4, item: 'wood_sword', value: 3, motion: 'swing', clip: 'attack' },
    stone_sword: { attack: 'melee', damage: 28, cooldown: 0.5, range: 2.4, item: 'stone_sword', value: 6, motion: 'swing_heavy', clip: 'attack_heavy', impact: { shake: 0.5, chips: [0.62, 0.62, 0.64] } },
    iron_sword: { attack: 'melee', damage: 36, cooldown: 0.45, range: 2.6, item: 'iron_sword', value: 12, motion: 'swing_flourish', clip: 'attack_flourish', impact: { shake: 0.3, chips: [1, 0.92, 0.6] } },
    bow: { attack: 'arrow', damage: 18, cooldown: 0.8, range: 30, item: 'bow', value: 5, motion: 'draw', clip: 'shoot' },
    recurve_bow: { attack: 'arrow', damage: 30, cooldown: 0.9, range: 36, item: 'recurve_bow', value: 9, motion: 'draw_deep', clip: 'shoot_draw' },
    war_bow: { attack: 'bolt', damage: 46, cooldown: 1.05, range: 44, item: 'war_bow', value: 14, motion: 'draw_full', clip: 'shoot_draw' },
    musket: { attack: 'bullet', damage: 60, cooldown: 1.4, range: 40, item: 'gun', value: 14, motion: 'recoil' },
    // a weapon of its own, like the musket: ice arrows (FROST). In the hand, the recurve bow tinted ice-blue
    frost_bow: { attack: 'ice_arrow', damage: 14, cooldown: 0.9, range: 30, item: 'recurve_bow', tint: [0.62, 0.86, 1.25], value: 8, motion: 'draw_deep', clip: 'shoot_draw' },
}

/**
 * Weapons and structures come in families of three, tier I first. The hotbar
 * and the Build panel group by family, and a higher tier can be built straight
 * onto a lower one of the same family (see upgradePlacement).
 * @type {Record<string, string[]>}
 */
export const FAMILIES = {
    sword: ['wood_sword', 'stone_sword', 'iron_sword'],
    bow: ['bow', 'recurve_bow', 'war_bow'],
    wall: ['stone_wall', 'iron_wall', 'steel_wall'],
    gate: ['gate', 'iron_gate', 'steel_gate'],
    spikes: ['spikes', 'iron_spikes', 'steel_spikes'],
    arrow_tower: ['arrow_tower', 'crossbow_tower', 'ballista_tower'],
    cannon_tower: ['cannon_tower', 'mortar_tower', 'bombard_tower'],
}

/** pure: [family, tier] of an item, tier counting from 1; null when it's in no family */
export function familyOf(name) {
    for (const [family, tiers] of Object.entries(FAMILIES)) {
        const i = tiers.indexOf(name)
        if (i >= 0) return { family, tier: i + 1 }
    }
    return null
}

/** pure: damage per second of a weapon */
export function weaponDps(name) {
    const w = WEAPONS[name] || WEAPONS.none
    return w.damage / w.cooldown
}

// ---- towers ------------------------------------------------------------

/**
 * Defence towers, three tiers per family. Each tier gives more damage per point
 * of defence value than the one below (that is what makes upgrading worth the
 * stronger night it draws, see WAVE_ADAPTIVE): arrows 0.71 -> 0.81 -> 0.98
 * damage per second per point, cannons 0.59 -> 0.63 -> 0.67.
 *
 * The ballista fires bolts, which are not in ARMOUR: brutes shrug off arrows
 * but take a bolt in full, so upgrading arrow towers is an answer to brutes
 * next to building cannons.
 */
export const TOWERS = {
    arrow: { range: 16, damage: 10, cooldown: 1.0, projectile: 'arrow', value: 14 },
    crossbow: { range: 18, damage: 17, cooldown: 0.95, projectile: 'arrow', value: 22 },
    ballista: { range: 21, damage: 30, cooldown: 0.9, projectile: 'bolt', value: 34 },
    cannon: { range: 22, damage: 45, cooldown: 3.2, projectile: 'cannonball', splash: 2.5, value: 24 },
    mortar: { range: 26, damage: 70, cooldown: 3.1, projectile: 'cannonball', splash: 3.0, value: 36 },
    bombard: { range: 30, damage: 105, cooldown: 3.0, projectile: 'cannonball', splash: 3.6, value: 52 },
    // a tower of its own (plan 12 §3.2): ice arrows, at the attackers it can still freeze first
    frost: { range: 16, damage: 6, cooldown: 1.4, projectile: 'ice_arrow', value: 20 },
}

/**
 * High ground (plan 10 §2): shooting down, a shot carries farther and lands
 * harder. For a shot leaving at speed v from h above its target, the best reach
 * is (v²/g)·√(1 + 2gh/v²). A tower's or archer's range R₀ is its useful reach,
 * taken as half the shot's best flat reach (v² = 2gR₀), so
 *
 *   reach(h)  = R₀ · √(1 + h/R₀), capped at maxReach·R₀
 *   damage(h) = 1 + share·(√(1 + h/R₀) − 1)   (the same √ is the gain in impact speed)
 *
 * and both shrink the same way shooting uphill. h is measured between feet:
 * the shooter's and the target's. A tower counts from where a tower on the
 * ground stands (on its column, placing.js TOWER_COLUMN), so every tower on
 * the ground, and every town built so far, plays exactly as before.
 */
export const HIGH_GROUND = {
    maxReach: 1.5,
    minReach: 0.5,
    /** the share of the gain in impact speed that becomes damage */
    damageShare: 0.5,
    maxDamage: 1.25,
    minDamage: 0.9,
}

/** the gain √(1 + h/R₀) (0 once the target is out of reach uphill) */
const heightGain = (range, h) => Math.sqrt(Math.max(0, 1 + h / Math.max(1, range)))

/** pure: how far a shot with useful range `range` reaches from `h` above its target (flat distance) */
export function reachAt(range, h) {
    const H = HIGH_GROUND
    return range * Math.min(H.maxReach, Math.max(H.minReach, heightGain(range, h)))
}

/**
 * pure: a lob's reach (the fire mage's fireball, plan 12 §2.1): the same law,
 * but with no floor. A target more than `range` above the thrower is out of
 * reach altogether, as a shot's best height is: so a tower up high is safe.
 */
export function lobReach(range, h) {
    return 1 + h / Math.max(1, range) <= 0 ? 0 : reachAt(range, h)
}

/** pure: the damage multiplier for a shot from `h` above its target */
export function heightDamage(range, h) {
    const H = HIGH_GROUND
    return Math.min(H.maxDamage, Math.max(H.minDamage, 1 + H.damageShare * (heightGain(range, h) - 1)))
}

export const PROJECTILES = {
    arrow: { speed: 28, gravity: 6, radius: 0.25 },
    /** a bolt: faster and flatter than an arrow, and not in ARMOUR, so brutes take it in full */
    bolt: { speed: 42, gravity: 3, radius: 0.25 },
    bullet: { speed: 60, gravity: 0, radius: 0.2 },
    cannonball: { speed: 22, gravity: 9, radius: 0.35 },
    /** an arrow that freezes what it hits (FROST) */
    ice_arrow: { speed: 28, gravity: 6, radius: 0.25, freezes: true },
}

// ---- items & recipes -----------------------------------------------------

/**
 * Item kinds:
 *   tool     the pickaxe: always owned, always on the hotbar, never saved
 *   block    places a voxel of the same name
 *   unit     places a defender unit
 *   weapon   the builder's weapon (see WEAPONS)
 *   resource can't be placed, used in recipes
 */
export const ITEMS = {
    pickaxe: { kind: 'tool' },
    dirt: { kind: 'block' },
    sand: { kind: 'block' },
    log: { kind: 'block' },
    cobble: { kind: 'block' },
    planks: { kind: 'block' },
    stone_wall: { kind: 'block' },
    iron_wall: { kind: 'block' },
    steel_wall: { kind: 'block' },
    gate: { kind: 'block' },
    iron_gate: { kind: 'block' },
    steel_gate: { kind: 'block' },
    spikes: { kind: 'block' },
    iron_spikes: { kind: 'block' },
    steel_spikes: { kind: 'block' },
    arrow_tower: { kind: 'block' },
    crossbow_tower: { kind: 'block' },
    ballista_tower: { kind: 'block' },
    cannon_tower: { kind: 'block' },
    mortar_tower: { kind: 'block' },
    bombard_tower: { kind: 'block' },
    ashlar: { kind: 'block' },
    slate: { kind: 'block' },
    copper_roof: { kind: 'block' },
    brick: { kind: 'block' },
    window: { kind: 'block' },
    snow_brick: { kind: 'block' },
    blue_ice: { kind: 'block' },
    ice: { kind: 'block' },
    ice_spikes: { kind: 'block' },
    frost_tower: { kind: 'block' },
    iron: { kind: 'resource' },
    gold: { kind: 'resource' },
    swordsman: { kind: 'unit' },
    archer: { kind: 'unit' },
    gunner: { kind: 'unit' },
    wood_sword: { kind: 'weapon' },
    stone_sword: { kind: 'weapon' },
    iron_sword: { kind: 'weapon' },
    bow: { kind: 'weapon' },
    recurve_bow: { kind: 'weapon' },
    war_bow: { kind: 'weapon' },
    musket: { kind: 'weapon' },
    frost_bow: { kind: 'weapon' },
}

export const RECIPES = [
    { out: 'planks', count: 4, cost: { log: 1 } },
    { out: 'stone_wall', count: 2, cost: { cobble: 3 } },
    { out: 'iron_wall', count: 2, cost: { cobble: 2, iron: 1 } },
    { out: 'steel_wall', count: 2, cost: { cobble: 2, iron: 2, gold: 1 } },
    { out: 'gate', count: 1, cost: { planks: 4 } },
    { out: 'iron_gate', count: 1, cost: { planks: 2, iron: 2 } },
    { out: 'steel_gate', count: 1, cost: { planks: 2, iron: 2, gold: 1 } },
    { out: 'spikes', count: 2, cost: { planks: 1, iron: 1 } },
    { out: 'iron_spikes', count: 2, cost: { cobble: 1, iron: 2 } },
    { out: 'steel_spikes', count: 2, cost: { iron: 2, gold: 1 } },
    { out: 'arrow_tower', count: 1, cost: { planks: 6, cobble: 4 } },
    { out: 'crossbow_tower', count: 1, cost: { planks: 6, cobble: 4, iron: 2 } },
    { out: 'ballista_tower', count: 1, cost: { planks: 6, cobble: 6, iron: 3, gold: 1 } },
    { out: 'cannon_tower', count: 1, cost: { cobble: 8, iron: 4 } },
    { out: 'mortar_tower', count: 1, cost: { cobble: 8, iron: 5, gold: 1 } },
    { out: 'bombard_tower', count: 1, cost: { cobble: 10, iron: 6, gold: 3 } },
    { out: 'swordsman', count: 1, cost: { iron: 3, gold: 1 } },
    { out: 'archer', count: 1, cost: { planks: 4, gold: 1 } },
    { out: 'gunner', count: 1, cost: { iron: 4, gold: 2 } },
    { out: 'wood_sword', count: 1, cost: { planks: 4 } },
    { out: 'stone_sword', count: 1, cost: { cobble: 3, planks: 1 } },
    { out: 'iron_sword', count: 1, cost: { iron: 3, planks: 1 } },
    { out: 'bow', count: 1, cost: { planks: 3, log: 1 } },
    { out: 'recurve_bow', count: 1, cost: { planks: 3, iron: 2 } },
    { out: 'war_bow', count: 1, cost: { planks: 2, iron: 3, gold: 1 } },
    { out: 'musket', count: 1, cost: { iron: 4, gold: 2 } },
    // decorative building blocks: two to a cobble, and half as hard (see blocks.js)
    { out: 'ashlar', count: 2, cost: { cobble: 1 } },
    { out: 'slate', count: 2, cost: { cobble: 1 } },
    { out: 'copper_roof', count: 4, cost: { cobble: 1, iron: 1 } },
    { out: 'brick', count: 2, cost: { cobble: 1 } },
    { out: 'window', count: 2, cost: { cobble: 1, sand: 1 } },
    // frost (plan 12 §4): every one of these freezes attackers that touch it. The cheap two hold
    // like a stone wall per cobble (as the decor blocks do); the freeze is what draws the night
    { out: 'snow_brick', count: 2, cost: { cobble: 1 } },
    { out: 'blue_ice', count: 2, cost: { cobble: 1 } },
    { out: 'ice', count: 2, cost: { cobble: 2, iron: 1 } },
    { out: 'ice_spikes', count: 2, cost: { planks: 1, iron: 1 } },
    { out: 'frost_tower', count: 1, cost: { planks: 6, cobble: 4, iron: 2, gold: 1 } },
    { out: 'frost_bow', count: 1, cost: { planks: 3, iron: 2, gold: 1 } },
]

/** the Build panel's "Decor" row: blocks for looks, not defence */
export const DECOR = ['ashlar', 'slate', 'copper_roof', 'brick', 'window']

/** the Build panel's "Frost" row: the ice blocks, the frost tower and the frost bow (plan 12) */
export const FROST_ITEMS = ['snow_brick', 'blue_ice', 'ice', 'ice_spikes', 'frost_tower', 'frost_bow']

export const STARTING_INVENTORY = { planks: 12, cobble: 8, archer: 1, swordsman: 1, wood_sword: 1 }

/** the tower type each tower block runs (kept in step with `tower` in world/blocks.js) */
const TOWER_OF_BLOCK = {
    arrow_tower: 'arrow', crossbow_tower: 'crossbow', ballista_tower: 'ballista',
    cannon_tower: 'cannon', mortar_tower: 'mortar', bombard_tower: 'bombard',
    frost_tower: 'frost',
}

/**
 * What a built block is worth to the night (see WAVE_ADAPTIVE). Every tier is
 * worth more than the one below, but less than the extra power it brings —
 * which is what makes an upgrade a better deal than another tier I.
 */
const BLOCK_VALUE = {
    stone_wall: 0.4, iron_wall: 0.55, steel_wall: 0.75,
    gate: 0.2, iron_gate: 0.35, steel_gate: 0.5,
    spikes: 0.5, iron_spikes: 0.8, steel_spikes: 1.1,
    planks: 0.2, cobble: 0.2,
    ashlar: 0.2, slate: 0.2, copper_roof: 0.2, brick: 0.2, window: 0.2,
    // the freeze is what these add, and this is what it costs (plan 12 §4.1)
    snow_brick: 0.25, blue_ice: 0.25, ice: 0.6, ice_spikes: 0.6,
}

/** defence value of a built block (towers count more) */
export function blockDefenceValue(name) {
    const tower = TOWER_OF_BLOCK[name]
    if (tower) return TOWERS[tower].value
    return BLOCK_VALUE[name] || 0
}
