/*
 *  World file format (`worlds/<slug>.world.json`), see docs/world-format.md.
 *
 *  A world is `seed + generator version + edits`, the troops placed in it and
 *  the kit a player starts it with. Edits are the compacted final difference
 *  from generated terrain, one per line, sorted, so a change in the game
 *  produces a small git diff.
 *
 *  A world file holds no game: survival or creative, daytime attacks, the day,
 *  the night, lives, where you stand and what you hold are picked or played
 *  when you start it. A save (the browser's autosave behind Continue) is the
 *  same file with a `game` block holding all of that (serializeSave).
 */

import { BLOCK_BY_NAME } from './blocks.js'
import { LATEST_GENERATOR, createGenerator } from './gen/index.js'
import { UNITS, LIVES, STARTING_INVENTORY } from '../game/balance.js'
import { CHUNK_SIZE } from '../core/constants.js'

export const FORMAT = 'block-world'
/** 2: the game moved out of the world, into saves; 1 (everything at the top level) still loads */
export const FORMAT_VERSION = 2

/**
 * @typedef {object} UnitPlacement
 * @property {string} id
 * @property {string} type
 * @property {number[]} pos
 * @property {number} yaw  degrees
 */

/**
 * What a game runs on: the world, and the game being played in it (for a world
 * started fresh: the settings picked, day 1, the kit).
 * @typedef {object} WorldDef
 * @property {string} name
 * @property {string} description
 * @property {string} seed
 * @property {{version: number}} generator
 * @property {number} size
 * @property {'survival'|'creative'} mode
 * @property {boolean} skirmish
 * @property {number} day
 * @property {number} nightLevel  strength level of the next night
 * @property {number} lives       lives left (survival: a night the Town Center falls costs one)
 * @property {number[]} townCenter
 * @property {Array<[number, number, number, string]>} edits
 * @property {UnitPlacement[]} units
 * @property {{pos: number[] | null, inventory: Record<string, number>}} player
 * @property {{inventory: Record<string, number>}} start  the kit the world is started with (may be empty: the standard kit)
 */

/**
 * how a world from a file is played unless the player picks otherwise
 * @type {{mode: 'survival'|'creative', skirmish: boolean}}
 */
export const FRESH_GAME = { mode: 'survival', skirmish: false }

export const WORLD_SIZES = [128, 192, 256]

export function slugify(name) {
    return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'world'
}

/** Create a fresh world definition from a seed */
export function newWorldDef({ seed, name, size = 192, mode = 'survival', skirmish = false }) {
    seed = String(seed ?? '').trim() || randomSeed()
    const gen = createGenerator(LATEST_GENERATOR, seed, size)
    return {
        name: name || `World ${seed}`,
        description: '',
        seed,
        generator: { version: LATEST_GENERATOR },
        size,
        mode,
        skirmish,
        day: 1,
        nightLevel: 1,
        lives: LIVES,
        townCenter: [0, gen.plazaHeight + 1, 0],
        edits: [],
        units: [],
        player: { pos: null, inventory: /** @type {Record<string, number>} */ ({ ...STARTING_INVENTORY }) },
        start: { inventory: {} },
    }
}

/** the kit a world starts with: its own, or the standard one if it has none */
export function startingKit(kit) {
    return kit && Object.values(kit).some((n) => n > 0) ? { ...kit } : { ...STARTING_INVENTORY }
}

export function randomSeed() {
    const words = ['amber', 'basalt', 'cedar', 'dune', 'ember', 'fjord', 'grove', 'heath', 'iris', 'juniper', 'kestrel', 'lichen', 'marsh', 'nettle', 'oak', 'pine', 'quartz', 'reed', 'slate', 'thistle', 'umber', 'vale', 'willow', 'yarrow']
    const pick = () => words[Math.floor(Math.random() * words.length)]
    return `${pick()}-${pick()}-${Math.floor(Math.random() * 1000)}`
}

/**
 * Validate and normalise parsed JSON into a WorldDef.
 *
 * `as: 'world'` (a file from worlds/, or an export): a fresh game in it, with
 * the `mode` and `skirmish` picked at the start, on day 1 with full lives and
 * the world's starting kit. `as: 'save'` (the autosave): the game as it was
 * saved; a save with no game in it (a lab town) starts fresh, like a world.
 * Version 1 files kept the game at the top level: read as a save, that is the
 * game; read as a world, only the inventory is kept, as the starting kit.
 * @param {string | object} json
 * @param {{as?: 'world'|'save', mode?: 'survival'|'creative', skirmish?: boolean}} [opts]
 * @returns {WorldDef}
 */
export function parseWorld(json, { as = 'world', mode = FRESH_GAME.mode, skirmish = FRESH_GAME.skirmish } = {}) {
    const o = typeof json === 'string' ? JSON.parse(json) : json
    if (o.format !== FORMAT) throw new Error('Not a block world file')
    if (o.formatVersion > FORMAT_VERSION) throw new Error(`World format ${o.formatVersion} is newer than this game supports`)
    const size = Number(o.size) || 192
    const version = (o.generator && o.generator.version) || 1
    const edits = []
    for (const e of o.edits || []) {
        if (!Array.isArray(e) || e.length !== 4) continue
        const [x, y, z, name] = e
        if (name !== 'air' && !BLOCK_BY_NAME[name]) {
            console.warn('World file: skipping unknown block', name)
            continue
        }
        edits.push([x | 0, y | 0, z | 0, name])
    }
    const units = []
    for (const u of o.units || []) {
        if (!UNITS[u.type]) continue
        units.push({ id: String(u.id), type: u.type, pos: u.pos.map(Number), yaw: Number(u.yaw) || 0 })
    }
    let townCenter = o.townCenter
    if (!Array.isArray(townCenter)) {
        townCenter = [0, createGenerator(version, String(o.seed), size).plazaHeight + 1, 0]
    }
    const v1 = (o.formatVersion || 1) < 2
    const kit = v1 ? (o.player && o.player.inventory) || {} : (o.start && o.start.inventory) || {}
    // the game: a save's own, or a fresh one
    const game = as === 'save' ? (v1 ? o : o.game) : null
    return {
        name: String(o.name || 'Untitled'),
        description: String(o.description || ''),
        seed: String(o.seed),
        generator: { version },
        size,
        townCenter,
        edits,
        units,
        start: { inventory: { ...kit } },
        ...(game ? {
            mode: game.mode === 'creative' ? 'creative' : 'survival',
            skirmish: !!game.skirmish,
            day: Math.max(1, game.day | 0),
            nightLevel: Math.max(1, game.nightLevel | 0),
            // missing (older files) or used up (a finished game): a full set
            lives: (game.lives | 0) >= 1 ? Math.min(99, game.lives | 0) : LIVES,
            player: {
                pos: game.player && Array.isArray(game.player.pos) ? game.player.pos.map(Number) : null,
                inventory: (game.player && game.player.inventory) || {},
            },
        } : {
            mode: mode === 'creative' ? 'creative' : 'survival',
            skirmish: !!skirmish,
            day: 1,
            nightLevel: 1,
            lives: LIVES,
            player: { pos: null, inventory: startingKit(kit) },
        }),
    }
}

/**
 * Stable edit order: grouped by chunk column, then y, z, x. A change in one
 * area of the world only touches nearby lines of the file.
 */
export function sortEdits(edits) {
    const ck = (v) => Math.floor(v / CHUNK_SIZE)
    return [...edits].sort((a, b) =>
        ck(a[0]) - ck(b[0]) || ck(a[2]) - ck(b[2]) || a[1] - b[1] || a[2] - b[2] || a[0] - b[0])
}

/** an inventory as a file keeps it: what you have, sorted */
const inventoryJSON = (inv) => Object.fromEntries(Object.entries(inv || {}).filter(([, n]) => n > 0).sort())

/**
 * The world part of a file, as lines: pretty JSON with one edit / unit per line.
 * @param {WorldDef} def
 */
function worldLines(def) {
    const j = (v) => JSON.stringify(v)
    const lines = []
    lines.push('{')
    lines.push(`  "format": ${j(FORMAT)},`)
    lines.push(`  "formatVersion": ${FORMAT_VERSION},`)
    lines.push(`  "name": ${j(def.name)},`)
    lines.push(`  "description": ${j(def.description || '')},`)
    lines.push(`  "seed": ${j(def.seed)},`)
    lines.push(`  "generator": ${j({ id: 'terrain', version: def.generator.version })},`)
    lines.push(`  "size": ${def.size},`)
    const list = (key, arr) => {
        if (arr.length === 0) {
            lines.push(`  "${key}": [],`)
            return
        }
        lines.push(`  "${key}": [`)
        arr.forEach((v, i) => lines.push(`    ${j(v)}${i < arr.length - 1 ? ',' : ''}`))
        lines.push('  ],')
    }
    list('edits', sortEdits(def.edits))
    const units = [...def.units].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((u) => ({ id: u.id, type: u.type, pos: u.pos.map((v) => Math.round(v * 100) / 100), yaw: Math.round(u.yaw) }))
    list('units', units)
    lines.push(`  "start": ${j({ inventory: inventoryJSON(def.start && def.start.inventory) })}`)
    return lines
}

/**
 * Serialise the world alone (Export world, and worlds/): no game in it.
 * @param {WorldDef} def
 */
export function serializeWorld(def) {
    return [...worldLines(def), '}'].join('\n') + '\n'
}

/**
 * Serialise a save (the autosave behind Continue): the world, and the game
 * being played in it.
 * @param {WorldDef} def
 */
export function serializeSave(def) {
    const j = (v) => JSON.stringify(v)
    const lines = worldLines(def)
    lines[lines.length - 1] += ','
    const pos = def.player.pos ? def.player.pos.map((v) => Math.round(v * 100) / 100) : null
    lines.push(`  "game": ${j({
        mode: def.mode, skirmish: !!def.skirmish, day: def.day, nightLevel: def.nightLevel, lives: def.lives ?? LIVES,
        player: { pos, inventory: inventoryJSON(def.player.inventory) },
    })}`)
    lines.push('}')
    return lines.join('\n') + '\n'
}
