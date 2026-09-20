/*
 *  World file format (`worlds/<slug>.world.json`), see docs/world-format.md.
 *
 *  A world is `seed + generator version + edits`. Edits are the compacted
 *  final difference from generated terrain, one per line, sorted, so a
 *  change in the game produces a small git diff.
 */

import { BLOCK_BY_NAME } from './blocks.js'
import { LATEST_GENERATOR, createGenerator } from './gen/index.js'
import { UNITS, LIVES } from '../game/balance.js'
import { CHUNK_SIZE } from '../core/constants.js'

export const FORMAT = 'block-world'
export const FORMAT_VERSION = 1

/**
 * @typedef {object} UnitPlacement
 * @property {string} id
 * @property {string} type
 * @property {number[]} pos
 * @property {number} yaw  degrees
 */

/**
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
 */

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
        player: { pos: null, inventory: {} },
    }
}

export function randomSeed() {
    const words = ['amber', 'basalt', 'cedar', 'dune', 'ember', 'fjord', 'grove', 'heath', 'iris', 'juniper', 'kestrel', 'lichen', 'marsh', 'nettle', 'oak', 'pine', 'quartz', 'reed', 'slate', 'thistle', 'umber', 'vale', 'willow', 'yarrow']
    const pick = () => words[Math.floor(Math.random() * words.length)]
    return `${pick()}-${pick()}-${Math.floor(Math.random() * 1000)}`
}

/**
 * Validate and normalise parsed JSON into a WorldDef.
 * @returns {WorldDef}
 */
export function parseWorld(json) {
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
    return {
        name: String(o.name || 'Untitled'),
        description: String(o.description || ''),
        seed: String(o.seed),
        generator: { version },
        size,
        mode: o.mode === 'creative' ? 'creative' : 'survival',
        skirmish: !!o.skirmish,
        day: Math.max(1, o.day | 0),
        nightLevel: Math.max(1, o.nightLevel | 0),
        // missing (older files) or used up (a finished game's export): a full set
        lives: (o.lives | 0) >= 1 ? Math.min(99, o.lives | 0) : LIVES,
        townCenter,
        edits,
        units,
        player: {
            pos: o.player && Array.isArray(o.player.pos) ? o.player.pos.map(Number) : null,
            inventory: (o.player && o.player.inventory) || {},
        },
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

/**
 * Serialise a WorldDef: pretty JSON with one edit / unit per line.
 * @param {WorldDef} def
 */
export function serializeWorld(def) {
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
    lines.push(`  "mode": ${j(def.mode)},`)
    lines.push(`  "skirmish": ${j(!!def.skirmish)},`)
    lines.push(`  "day": ${def.day},`)
    lines.push(`  "nightLevel": ${def.nightLevel},`)
    lines.push(`  "lives": ${def.lives ?? LIVES},`)
    lines.push(`  "townCenter": ${j(def.townCenter)},`)
    const list = (key, arr, last) => {
        if (arr.length === 0) {
            lines.push(`  "${key}": []${last ? '' : ','}`)
            return
        }
        lines.push(`  "${key}": [`)
        arr.forEach((v, i) => lines.push(`    ${j(v)}${i < arr.length - 1 ? ',' : ''}`))
        lines.push(`  ]${last ? '' : ','}`)
    }
    list('edits', sortEdits(def.edits), false)
    const units = [...def.units].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((u) => ({ id: u.id, type: u.type, pos: u.pos.map((v) => Math.round(v * 100) / 100), yaw: Math.round(u.yaw) }))
    list('units', units, false)
    const inv = Object.fromEntries(Object.entries(def.player.inventory || {}).filter(([, n]) => n > 0).sort())
    const pos = def.player.pos ? def.player.pos.map((v) => Math.round(v * 100) / 100) : null
    lines.push(`  "player": ${j({ pos, inventory: inv })}`)
    lines.push('}')
    return lines.join('\n') + '\n'
}
