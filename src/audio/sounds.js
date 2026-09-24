/*
 *  Every sound in the game, as a recipe for the synthesiser (synth.js), and
 *  the pure rules that pick one for each thing that happens (unit tested:
 *  every event, weapon tier, tower, projectile and material has a sound).
 *
 *  A recipe: `layers` (see synth.js), `pitch` (how far the
 *  takes are detuned from each other), `limit` (how many can play at once, and
 *  the shortest gap between two, so thirty archers make a volley rather than
 *  thirty identical twangs), and `bus` (sfx, amb or ui). How loud each one
 *  sits in the mix is levels.json, set by measuring every sound against its
 *  category's target (tools/sound-check.mjs).
 *
 *  Materials are soundMaterial()'s: soft (dirt, sand, grass, leaves), stone,
 *  wood, metal; `ore` is stone with a brighter ring.
 */

/**
 * @typedef {{k: 'noise'|'tone'|'ring'|'crackle'|'voice', at?: number, dur: number, gain: number, attack?: number,
 *   f?: BiquadFilterType, freq?: number, to?: number, q?: number, wave?: OscillatorType, partials?: number[],
 *   n?: number, size?: number, f0?: number, vowel?: 'a'|'o'|'u'|'e', rough?: number}} Layer
 * @typedef {{layers: Layer[], pitch?: number, limit?: {max: number, gap: number}, bus?: 'sfx'|'amb'|'ui'}} Recipe
 */

// ---- building blocks --------------------------------------------------------------------

/** @type {(...a: any[]) => Layer} */
const noise = (freq, dur, gain, o = {}) => ({ k: 'noise', freq, dur, gain, ...o })
/** @type {(...a: any[]) => Layer} */
const low = (freq, dur, gain, o = {}) => noise(freq, dur, gain, { f: 'lowpass', ...o })
/** @type {(...a: any[]) => Layer} */
const high = (freq, dur, gain, o = {}) => noise(freq, dur, gain, { f: 'highpass', ...o })
/** @type {(...a: any[]) => Layer} */
const tone = (freq, to, dur, gain, o = {}) => ({ k: 'tone', freq, to, dur, gain, ...o })
/** @type {(...a: any[]) => Layer} */
const tri = (freq, to, dur, gain, o = {}) => tone(freq, to, dur, gain, { wave: 'triangle', ...o })
/** @type {(...a: any[]) => Layer} */
const ring = (freq, dur, gain, o = {}) => ({ k: 'ring', freq, dur, gain, ...o })
/** @type {(...a: any[]) => Layer} */
const crackle = (freq, n, dur, gain, o = {}) => ({ k: 'crackle', freq, n, dur, gain, ...o })
/** @type {(...a: any[]) => Layer} */
const voice = (f0, to, vowel, dur, gain, o = {}) => ({ k: 'voice', f0, to, vowel, dur, gain, ...o })
/** a layer list shifted later by `at` @type {(at: number, layers: Layer[]) => Layer[]} */
const later = (at, layers) => layers.map((l) => ({ ...l, at: (l.at || 0) + at }))

/** steel meeting stone: the tick of the pick, and sparks */
const STRIKE = [high(3500, 0.015, 0.6), ring(4200, 0.08, 0.1), crackle(5000, 6, 0.12, 0.25, { q: 1 })]
/** an arrow leaving the string */
const WHOOSH = noise(3500, 0.18, 0.15, { to: 1500, q: 2, at: 0.01 })
const PLUCK = high(3000, 0.02, 0.4)
/** a body hitting the ground */
const THUD = (at, gain = 0.6) => later(at, [low(300, 0.15, gain), tone(70, 40, 0.15, gain * 0.8)])

/** @type {Record<string, Recipe>} */
export const RECIPES = {
    // ---- swings: one per sword tier (the iron one's second stroke is pitched apart)
    swing_wood: { layers: [noise(1400, 0.16, 0.5, { to: 500, q: 1.2, attack: 0.05 })], limit: { max: 4, gap: 0.03 } },
    swing_stone: { layers: [noise(900, 0.24, 0.6, { to: 250, attack: 0.07 }), tone(90, 60, 0.2, 0.15, { attack: 0.05 })], limit: { max: 3, gap: 0.03 } },
    swing_iron: { layers: [noise(2600, 0.2, 0.5, { to: 900, q: 1.5, attack: 0.04 }), ring(3200, 0.35, 0.08, { at: 0.02 })], limit: { max: 3, gap: 0.03 } },
    swing_iron_b: { layers: [noise(2900, 0.2, 0.5, { to: 1000, q: 1.5, attack: 0.04 }), ring(3600, 0.35, 0.08, { at: 0.02 })], limit: { max: 3, gap: 0.03 } },
    /** a brute's fist, a troop's sword: the NPCs' swing */
    swing_heavy: { layers: [noise(700, 0.26, 0.6, { to: 200, attack: 0.08 }), tone(80, 50, 0.22, 0.2, { attack: 0.06 })], limit: { max: 4, gap: 0.05 } },

    // ---- hits, by what is hit
    hit_flesh: { layers: [low(900, 0.09, 0.7), tone(120, 60, 0.12, 0.6), noise(2000, 0.03, 0.2, { q: 2 })], limit: { max: 6, gap: 0.02 } },
    hit_bone: { layers: [noise(2500, 0.05, 0.4, { q: 3 }), crackle(1800, 5, 0.08, 0.5), tri(400, 250, 0.05, 0.2)], limit: { max: 5, gap: 0.02 } },
    hit_armour: { layers: [ring(1100, 0.35, 0.35), noise(3000, 0.06, 0.4), tone(150, 90, 0.1, 0.4)], limit: { max: 5, gap: 0.03 } },
    hit_shield: { layers: [low(600, 0.1, 0.6), tri(220, 150, 0.12, 0.4)], limit: { max: 5, gap: 0.03 } },
    /** what hits you: closer, duller, and a breath */
    hit_you: { layers: [low(400, 0.15, 0.8), tone(80, 45, 0.2, 0.8), noise(700, 0.25, 0.15, { q: 0.8, at: 0.05 }), voice(170, 140, 'u', 0.12, 0.2, { at: 0.03 })], limit: { max: 2, gap: 0.08 } },
    /** a stone or iron blade landing: weight under the hit */
    blow_heavy: { layers: [tone(70, 35, 0.25, 0.9), low(250, 0.15, 0.5)], limit: { max: 2, gap: 0.05 } },

    // ---- bows: the draw creaks for as long as the draw lasts, the string is lower per tier
    bow_draw_1: { layers: [crackle(700, 7, 0.3, 1, { q: 2, size: 0.009 }), noise(400, 0.3, 0.25, { q: 4, attack: 0.2 })] },
    bow_draw_2: { layers: [crackle(600, 9, 0.4, 1, { q: 2, size: 0.009 }), noise(380, 0.4, 0.28, { q: 4, attack: 0.28 })] },
    bow_draw_3: { layers: [crackle(500, 12, 0.52, 1, { q: 2, size: 0.01 }), noise(340, 0.52, 0.3, { q: 4, attack: 0.38 }), tone(55, 65, 0.5, 0.06, { wave: 'sawtooth', attack: 0.4 })] },
    string_1: { layers: [tri(330, 300, 0.18, 0.5), PLUCK, WHOOSH], limit: { max: 6, gap: 0.03 } },
    string_2: { layers: [tri(250, 225, 0.22, 0.55), PLUCK, WHOOSH] },
    string_3: { layers: [tri(180, 160, 0.28, 0.6), tone(90, 80, 0.3, 0.3), PLUCK, noise(2500, 0.22, 0.25, { to: 1000, q: 2, at: 0.01 })] },
    musket: { layers: [noise(1800, 0.3, 1, { to: 300, q: 0.5 }), high(4000, 0.02, 0.7), tone(120, 50, 0.2, 0.5)], limit: { max: 4, gap: 0.04 } },

    // ---- towers, by type
    fire_arrow: { layers: [tri(330, 300, 0.18, 0.5), PLUCK, WHOOSH], limit: { max: 4, gap: 0.06 } },
    fire_crossbow: { layers: [high(2500, 0.025, 0.6), tone(200, 120, 0.06, 0.12, { wave: 'square' }), tri(280, 250, 0.15, 0.35), WHOOSH], limit: { max: 4, gap: 0.06 } },
    fire_ballista: { layers: [tone(70, 55, 0.45, 0.7), tri(140, 120, 0.35, 0.35), crackle(500, 5, 0.25, 0.3), low(800, 0.15, 0.4)], limit: { max: 3, gap: 0.08 } },
    fire_cannon: { layers: [low(400, 0.8, 1, { to: 60 }), tone(70, 30, 0.6, 0.9), noise(1500, 0.06, 0.6, { q: 0.5 })], limit: { max: 3, gap: 0.1 } },
    fire_mortar: { layers: [low(300, 0.5, 0.8, { to: 80 }), tone(110, 50, 0.35, 0.9), tone(220, 180, 0.12, 0.3), later(0.25, [tone(1800, 700, 1.1, 0.1, { attack: 0.4 })])[0]], limit: { max: 3, gap: 0.1 } },
    fire_bombard: { layers: [low(350, 1.4, 1, { to: 40 }), tone(55, 25, 1.1, 1), noise(1200, 0.08, 0.8, { q: 0.5 }), crackle(300, 14, 1, 0.35, { at: 0.2 })], limit: { max: 2, gap: 0.12 } },

    // ---- projectiles landing
    impact_wood: { layers: [tri(300, 200, 0.06, 0.5), low(1200, 0.05, 0.5)], limit: { max: 4, gap: 0.03 } },
    impact_stone: { layers: [high(2500, 0.03, 0.5), tri(900, 700, 0.04, 0.15), crackle(3000, 3, 0.06, 0.3)], limit: { max: 4, gap: 0.03 } },
    impact_soft: { layers: [low(500, 0.07, 0.6), crackle(900, 3, 0.06, 0.2)], limit: { max: 4, gap: 0.03 } },
    impact_body: { layers: [low(700, 0.06, 0.6), tone(150, 90, 0.07, 0.4)], limit: { max: 4, gap: 0.03 } },
    impact_bolt: { layers: [tone(100, 60, 0.15, 0.7), low(1000, 0.1, 0.6), crackle(1200, 4, 0.1, 0.3)], limit: { max: 3, gap: 0.04 } },
    explosion: { layers: [low(600, 1, 1, { to: 50 }), tone(70, 28, 0.8, 0.9), crackle(400, 18, 1.1, 0.5, { at: 0.1, q: 1 }), noise(2000, 0.05, 0.6, { q: 0.5 })], limit: { max: 3, gap: 0.08 } },
    fuse: { layers: [noise(5000, 1.6, 0.3, { to: 3000, q: 1.5, attack: 0.05 }), crackle(4000, 25, 1.6, 0.15)], limit: { max: 3, gap: 0.2 } },

    // ---- the pickaxe: each blow, by material (steel on stone and metal strikes sparks)
    dig_stone: { layers: [noise(1800, 0.07, 0.5, { q: 2 }), tri(250, 180, 0.05, 0.3), ...STRIKE], limit: { max: 3, gap: 0.05 } },
    dig_ore: { layers: [noise(1800, 0.07, 0.5, { q: 2 }), tri(250, 180, 0.05, 0.3), ring(3400, 0.25, 0.2), ...STRIKE], limit: { max: 3, gap: 0.05 } },
    dig_wood: { layers: [tri(220, 170, 0.09, 0.5), low(900, 0.06, 0.5), noise(2000, 0.02, 0.2, { q: 3 })], limit: { max: 3, gap: 0.05 } },
    dig_soft: { layers: [low(700, 0.12, 0.7), crackle(1200, 4, 0.1, 0.3)], limit: { max: 3, gap: 0.05 } },
    dig_metal: { layers: [ring(1500, 0.4, 0.35), high(2500, 0.03, 0.5), tri(600, 500, 0.05, 0.2), ...STRIKE], limit: { max: 3, gap: 0.05 } },
    // ---- a block giving way: a crumble and a tail of debris
    break_stone: { layers: [noise(1200, 0.3, 0.7, { to: 400, q: 0.7 }), crackle(1500, 12, 0.4, 0.5, { at: 0.03 }), tone(110, 60, 0.12, 0.4)], limit: { max: 4, gap: 0.04 } },
    break_wood: { layers: [tri(180, 110, 0.12, 0.5), low(1400, 0.25, 0.6, { to: 300 }), crackle(900, 9, 0.3, 0.45)], limit: { max: 4, gap: 0.04 } },
    break_soft: { layers: [low(800, 0.25, 0.8, { to: 200 }), crackle(900, 6, 0.22, 0.3)], limit: { max: 4, gap: 0.04 } },
    break_metal: { layers: [ring(900, 0.6, 0.4), noise(2000, 0.3, 0.5, { to: 600, q: 0.8 }), crackle(2500, 8, 0.35, 0.35)], limit: { max: 4, gap: 0.04 } },
    // ---- attackers battering what you built
    bash_stone: { layers: [low(700, 0.12, 0.8), tone(90, 55, 0.15, 0.7), crackle(1400, 4, 0.12, 0.3)], limit: { max: 5, gap: 0.04 } },
    bash_wood: { layers: [tri(150, 100, 0.14, 0.6), low(900, 0.1, 0.6), crackle(800, 3, 0.1, 0.3)], limit: { max: 5, gap: 0.04 } },
    bash_metal: { layers: [ring(700, 0.5, 0.45), tone(110, 70, 0.12, 0.5), noise(1500, 0.06, 0.4)], limit: { max: 5, gap: 0.04 } },
    bash_soft: { layers: [low(500, 0.12, 0.8), tone(80, 50, 0.1, 0.5)], limit: { max: 5, gap: 0.04 } },

    // ---- building
    place_stone: { layers: [noise(1400, 0.05, 0.5, { q: 1.5 }), tone(160, 100, 0.07, 0.6), low(500, 0.06, 0.4)] },
    place_wood: { layers: [tri(260, 200, 0.07, 0.5), low(1200, 0.05, 0.45)] },
    place_metal: { layers: [ring(950, 0.3, 0.25), tone(150, 100, 0.07, 0.5), high(2500, 0.02, 0.3)] },
    place_soft: { layers: [low(450, 0.09, 0.7), tone(110, 70, 0.07, 0.4)] },
    /** the column goes up block by block, then the head drops on with a chord */
    tower_build: {
        layers: [
            ...[0, 0.09, 0.18].flatMap((at) => later(at, [tone(140, 90, 0.07, 0.6), low(600, 0.05, 0.4)])),
            ...later(0.3, [ring(520, 0.5, 0.2), tri(330, 330, 0.35, 0.2), tri(415, 415, 0.35, 0.15), tri(494, 494, 0.35, 0.12), low(400, 0.1, 0.5)]),
        ],
    },
    /** a rising ring on top of the block's own sound: II, and a brighter III */
    upgrade_2: { layers: [tri(523, 523, 0.25, 0.25), tri(659, 659, 0.3, 0.25, { at: 0.08 }), ring(1318, 0.5, 0.12, { at: 0.16 })] },
    upgrade_3: { layers: [tri(523, 523, 0.25, 0.22), tri(659, 659, 0.28, 0.22, { at: 0.07 }), tri(784, 784, 0.32, 0.22, { at: 0.14 }), ring(1568, 0.7, 0.15, { at: 0.22 }), high(6000, 0.4, 0.05, { at: 0.22, attack: 0.1 })] },
    /** a hole patched at night: the block, and two quick hammer taps */
    patch: { layers: [noise(1400, 0.05, 0.5, { q: 1.5 }), tone(160, 100, 0.07, 0.5), ...[0.12, 0.24].flatMap((at) => later(at, [tri(700, 500, 0.04, 0.3), high(2000, 0.02, 0.25)]))] },
    /** a build that can't be done: a dull buzz under the message */
    refuse: { layers: [tone(140, 140, 0.14, 0.1, { wave: 'square' }), tone(147, 147, 0.14, 0.1, { wave: 'square' })], bus: 'ui', limit: { max: 1, gap: 0.25 } },

    // ---- moving
    step_soft: { layers: [low(500, 0.06, 0.5)], pitch: 0.12, limit: { max: 4, gap: 0.05 } },
    step_stone: { layers: [noise(1500, 0.04, 0.4), tone(120, 90, 0.03, 0.2)], pitch: 0.12, limit: { max: 4, gap: 0.05 } },
    step_wood: { layers: [tri(200, 160, 0.04, 0.35), low(900, 0.04, 0.3)], pitch: 0.12, limit: { max: 4, gap: 0.05 } },
    step_metal: { layers: [ring(1800, 0.08, 0.08), high(2500, 0.03, 0.3)], pitch: 0.12, limit: { max: 4, gap: 0.05 } },
    jump: { layers: [noise(900, 0.08, 0.3, { q: 0.7, attack: 0.02 })], limit: { max: 1, gap: 0.1 } },
    land: { layers: [low(400, 0.12, 0.8), tone(90, 50, 0.12, 0.6)], limit: { max: 1, gap: 0.1 } },

    // ---- voices: hurt and dying, per kind of unit
    hurt_grunt: { layers: [voice(110, 85, 'o', 0.3, 0.6, { rough: 0.4 })], limit: { max: 3, gap: 0.12 } },
    hurt_raider: { layers: [crackle(2000, 7, 0.15, 0.5, { q: 2 }), voice(260, 200, 'e', 0.12, 0.2, { rough: 0.6 })], limit: { max: 3, gap: 0.12 } },
    hurt_brute: { layers: [voice(70, 55, 'a', 0.35, 0.8, { rough: 0.5 })], limit: { max: 2, gap: 0.2 } },
    hurt_sapper: { layers: [voice(330, 420, 'e', 0.15, 0.4, { rough: 0.2 })], limit: { max: 3, gap: 0.12 } },
    hurt_defender: { layers: [voice(150, 120, 'u', 0.18, 0.45, { rough: 0.3 })], limit: { max: 3, gap: 0.15 } },
    death_grunt: { layers: [voice(110, 60, 'o', 0.7, 0.7, { rough: 0.4 }), ...THUD(0.35)], limit: { max: 3, gap: 0.08 } },
    death_raider: { layers: [crackle(1500, 16, 0.5, 0.6), ...THUD(0.3, 0.5)], limit: { max: 3, gap: 0.08 } },
    death_brute: { layers: [voice(70, 40, 'a', 1, 0.9, { rough: 0.5 }), ...THUD(0.6, 0.9)], limit: { max: 2, gap: 0.1 } },
    death_sapper: { layers: [voice(380, 200, 'e', 0.45, 0.5), ...THUD(0.3)], limit: { max: 3, gap: 0.08 } },
    death_defender: { layers: [voice(160, 90, 'u', 0.6, 0.55), ...THUD(0.35)], limit: { max: 3, gap: 0.08 } },
    /** the town center hit: an alarm bell */
    town_bell: { layers: [ring(440, 2.2, 0.5, { partials: [1, 2, 2.76, 5.4] }), tone(220, 220, 1.8, 0.2)], limit: { max: 1, gap: 0.6 } },

    // ---- the soundscape (ambience.js)
    drum_low: { layers: [tone(95, 55, 0.45, 1), low(600, 0.12, 0.5, { to: 200 }), tone(190, 110, 0.1, 0.2)], bus: 'amb', pitch: 0.03 },
    drum_high: { layers: [tone(180, 120, 0.25, 0.8), noise(1200, 0.06, 0.5)], bus: 'amb', pitch: 0.03 },
    war_cry: {
        layers: [
            voice(170, 230, 'a', 1.2, 0.3, { attack: 0.25, rough: 0.4 }),
            voice(150, 200, 'a', 1.1, 0.3, { at: 0.08, attack: 0.25, rough: 0.4 }),
            voice(200, 260, 'o', 1.0, 0.25, { at: 0.15, attack: 0.25, rough: 0.5 }),
            noise(500, 1.3, 0.2, { q: 0.6, attack: 0.4 }),
        ],
        bus: 'amb', pitch: 0.12, limit: { max: 2, gap: 0.8 },
    },
    clash: { layers: [ring(2100, 0.25, 0.3), ring(2900, 0.2, 0.2, { at: 0.07 }), high(3000, 0.03, 0.3)], bus: 'amb', pitch: 0.1, limit: { max: 3, gap: 0.15 } },
    bird: { layers: [tone(3200, 4200, 0.08, 0.2), tone(3800, 3000, 0.07, 0.15, { at: 0.1 }), tone(3500, 4500, 0.06, 0.12, { at: 0.2 })], bus: 'amb', pitch: 0.15 },
    cricket: { layers: [0, 0.04, 0.08].map((at) => tone(4500, 4500, 0.025, 0.1, { at })), bus: 'amb', pitch: 0.05 },
    heartbeat: { layers: [tone(60, 45, 0.12, 0.9), tone(55, 42, 0.1, 0.7, { at: 0.22 })], bus: 'amb', pitch: 0 },
}

/** a variant's detune when a recipe doesn't set its own (±, as a share) */
export const DEFAULT_PITCH = 0.06

// ---- which sound for what -----------------------------------------------------------------

/** the swing of each sword tier (and the none weapon: the pickaxe as a club) */
const SWING_OF = { none: 'swing_wood', wood_sword: 'swing_wood', stone_sword: 'swing_stone', iron_sword: 'swing_iron' }

/** @param {string} weapon WEAPONS key @param {boolean} [mirror] the iron sword's second stroke */
export function swingSound(weapon, mirror = false) {
    const s = SWING_OF[weapon] || 'swing_wood'
    return s === 'swing_iron' && mirror ? 'swing_iron_b' : s
}

/** what a unit sounds like when struck: armoured brutes clank, skeletons rattle, swordsmen take it on the shield */
const BODY = { grunt: 'hit_flesh', raider: 'hit_bone', brute: 'hit_armour', sapper: 'hit_flesh', swordsman: 'hit_shield', archer: 'hit_flesh', gunner: 'hit_flesh', player: 'hit_flesh' }

/** @param {string} type a UNITS key, or 'player' */
export function hitSound(type) {
    return BODY[type] || 'hit_flesh'
}

/** @param {string} type @param {'attacker'|'defender'} side */
export function hurtSound(type, side) {
    if (side === 'defender' || type === 'player') return 'hurt_defender'
    return RECIPES['hurt_' + type] ? 'hurt_' + type : 'hurt_grunt'
}

/** @param {string} type @param {'attacker'|'defender'} side */
export function deathSound(type, side) {
    if (side === 'defender' || type === 'player') return 'death_defender'
    return RECIPES['death_' + type] ? 'death_' + type : 'death_grunt'
}

/** the draw and the release of each bow tier */
const BOW = { bow: 1, recurve_bow: 2, war_bow: 3 }
/** @param {string} weapon */
export function bowSounds(weapon) {
    const n = BOW[weapon] || 1
    return { draw: `bow_draw_${n}`, release: `string_${n}` }
}

/** a unit's own ranged attack (archers, raiders, gunners): by projectile */
const SHOT = { arrow: 'string_1', bolt: 'string_3', bullet: 'musket', cannonball: 'fire_cannon' }
/** @param {string} projectile PROJECTILES key */
export function shotSound(projectile) {
    return SHOT[projectile] || 'string_1'
}

/** @param {string} tower TOWERS key */
export function towerSound(tower) {
    return RECIPES['fire_' + tower] ? 'fire_' + tower : 'fire_arrow'
}

/**
 * A projectile landing: on a body, or on the block it stuck in.
 * @param {string} projectile PROJECTILES key
 * @param {string} surface a sound material, or 'body'
 */
export function impactSound(projectile, surface) {
    if (projectile === 'cannonball') return 'explosion'
    if (projectile === 'bolt') return 'impact_bolt'
    if (surface === 'body') return 'impact_body'
    if (surface === 'wood') return 'impact_wood'
    if (surface === 'stone' || surface === 'metal') return 'impact_stone'
    return 'impact_soft'
}

/** a block's material, with ore told apart from plain stone (it rings brighter) */
const material = (mat, block) => (block && /ore/.test(block) ? 'ore' : mat)

/** the pickaxe's blow @param {string} mat soundMaterial @param {string} [block] */
export function digSound(mat, block) {
    const m = material(mat, block)
    return RECIPES['dig_' + m] ? 'dig_' + m : 'dig_soft'
}

/** @param {string} mat */
export function breakSound(mat) {
    return RECIPES['break_' + mat] ? 'break_' + mat : 'break_soft'
}

/** an attacker's blow on a built block @param {string} mat */
export function bashSound(mat) {
    return RECIPES['bash_' + mat] ? 'bash_' + mat : 'bash_soft'
}

/** @param {string} mat */
export function placeSound(mat) {
    return RECIPES['place_' + mat] ? 'place_' + mat : 'place_soft'
}

/** @param {string} mat */
export function stepSound(mat) {
    return RECIPES['step_' + mat] ? 'step_' + mat : 'step_soft'
}

/** @param {number} tier 2 or 3 */
export function upgradeSound(tier) {
    return tier >= 3 ? 'upgrade_3' : 'upgrade_2'
}

/** sound material for a block name */
export function soundMaterial(name) {
    if (!name) return 'soft'
    // metal first: an iron gate rings, a wooden one thuds
    if (/^(iron|steel)_|spikes|cannon|mortar|bombard|ballista|crossbow/.test(name)) return 'metal'
    if (/stone|cobble|ore|bedrock|plaza|town/.test(name)) return 'stone'
    if (/log|planks|gate|arrow_tower/.test(name)) return 'wood'
    return 'soft'
}
