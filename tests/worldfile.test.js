import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { newWorldDef, parseWorld, serializeWorld, serializeSave, sortEdits, slugify, startingKit, FORMAT_VERSION } from '../src/world/worldFile.js'
import { STARTING_INVENTORY, OPENING_RAID } from '../src/game/balance.js'
import { shouldPlayOpening, scriptedLoss } from '../src/game/opening.js'
import { defenceParts } from '../src/game/waves.js'
import { buildDefaultWorld } from '../src/world/defaultWorld.js'
import { FAMILIES } from '../src/game/balance.js'

describe('world file', () => {
    it('a save round-trips the world and the game in it', () => {
        const def = newWorldDef({ seed: 'round-trip', name: 'Round Trip', size: 128, mode: 'creative', skirmish: true })
        def.edits = [[3, 4, 5, 'planks'], [-10, 2, 7, 'air'], [30, 1, -30, 'arrow_tower']]
        def.units = [{ id: 'u1', type: 'archer', pos: [1.5, 8, 2.5], yaw: 90 }]
        def.player = { pos: [0.5, 9, 4.5], inventory: { planks: 3, gold: 1 } }
        def.day = 4
        def.nightLevel = 3
        const text = serializeSave(def)
        const back = parseWorld(text, { as: 'save' })
        expect(back.seed).toBe('round-trip')
        expect(back.mode).toBe('creative')
        expect(back.skirmish).toBe(true)
        expect(back.day).toBe(4)
        expect(back.nightLevel).toBe(3)
        expect(back.player.pos).toEqual([0.5, 9, 4.5])
        expect(sortEdits(back.edits)).toEqual(sortEdits(def.edits))
        expect(back.units).toEqual(def.units)
        expect(back.player.inventory).toEqual({ gold: 1, planks: 3 })
        // serialising again gives the identical file (stable for git)
        expect(serializeSave(back)).toBe(text)
    })

    it('writes one edit per line', () => {
        const def = newWorldDef({ seed: 'lines' })
        def.edits = [[1, 2, 3, 'dirt'], [4, 5, 6, 'sand']]
        const lines = serializeWorld(def).split('\n')
        expect(lines).toContain('    [1,2,3,"dirt"],')
        expect(lines).toContain('    [4,5,6,"sand"]')
    })

    it('skips unknown blocks and unit types instead of failing', () => {
        const def = newWorldDef({ seed: 'x' })
        const o = JSON.parse(serializeWorld(def))
        o.edits = [[1, 1, 1, 'unobtainium'], [2, 2, 2, 'dirt']]
        o.units = [{ id: 'a', type: 'dragon', pos: [0, 0, 0], yaw: 0 }]
        const back = parseWorld(o)
        expect(back.edits).toEqual([[2, 2, 2, 'dirt']])
        expect(back.units).toEqual([])
    })

    it('a save keeps the lives left; older saves and used-up games get a full set', () => {
        const def = newWorldDef({ seed: 'lives' })
        expect(def.lives).toBe(3)
        def.lives = 2
        expect(parseWorld(serializeSave(def), { as: 'save' }).lives).toBe(2)
        const o = JSON.parse(serializeSave(def))
        delete o.game.lives
        expect(parseWorld(o, { as: 'save' }).lives).toBe(3)
        o.game.lives = 0
        expect(parseWorld(o, { as: 'save' }).lives).toBe(3)
    })

    it('rejects other files', () => {
        expect(() => parseWorld('{"hello":1}')).toThrow()
    })

    it('committed default world matches its generator script', () => {
        const committed = readFileSync(new URL('../worlds/default.world.json', import.meta.url), 'utf8')
        expect(serializeWorld(buildDefaultWorld())).toBe(committed)
    })

    it('slugifies names for file names', () => {
        expect(slugify('My Big World!')).toBe('my-big-world')
        expect(slugify('***')).toBe('world')
    })
})

describe('the defence tiers in a world file', () => {
    it('round-trips every new block, and a file written before them still loads', () => {
        const names = [...FAMILIES.wall, ...FAMILIES.gate, ...FAMILIES.spikes, ...FAMILIES.arrow_tower, ...FAMILIES.cannon_tower]
        const def = newWorldDef({ seed: 'tiers', name: 'Tiers', size: 128 })
        def.edits = names.map((n, i) => [i, 5, 0, n])
        const back = parseWorld(serializeWorld(def))
        expect(back.edits.map((e) => e[3])).toEqual(names)
        // ids are append-only: a file from before this iteration reads the same
        const old = newWorldDef({ seed: 'old', name: 'Old', size: 128 })
        old.edits = [[0, 5, 0, 'arrow_tower'], [1, 5, 0, 'iron_wall'], [2, 5, 0, 'gate']]
        const text = serializeWorld(old)
        expect(parseWorld(text).edits).toEqual(old.edits)
    })
})

describe('a world export is a world, not a save (plan 10 §3.9)', () => {
    /** a game in progress, as a session holds it */
    const played = () => {
        const def = newWorldDef({ seed: 'played', name: 'Played', size: 128, mode: 'creative', skirmish: true })
        def.edits = [[1, 8, 1, 'stone_wall'], [2, 7, 2, 'air']]
        def.units = [{ id: 'u1', type: 'archer', pos: [1.5, 8, 2.5], yaw: 90 }]
        def.day = 14
        def.nightLevel = 14
        def.lives = 2
        def.player = { pos: [3.5, 9, 4.5], inventory: { cobble: 40, iron: 3 } }
        // what Export world writes: what you hold now, as the kit a player starts with
        def.start = { inventory: { cobble: 40, iron: 3 } }
        return def
    }
    it('holds the name, description, seed (with its generator and size), blocks, troops and the starting kit, and nothing else', () => {
        const o = JSON.parse(serializeWorld(played()))
        expect(Object.keys(o).sort()).toEqual(['description', 'edits', 'format', 'formatVersion', 'generator', 'name', 'seed', 'size', 'start', 'units'].sort())
        expect(o.formatVersion).toBe(FORMAT_VERSION)
        expect(o.start).toEqual({ inventory: { cobble: 40, iron: 3 } })
    })
    it('export, load, export again: the same text', () => {
        const text = serializeWorld(played())
        expect(serializeWorld(parseWorld(text))).toBe(text)
    })
    it('loaded, it is a fresh game: the settings picked, day 1, full lives, the kit, at the Town Center', () => {
        const def = parseWorld(serializeWorld(played()), { as: 'world', mode: 'survival', skirmish: false })
        expect([def.mode, def.skirmish, def.day, def.nightLevel, def.lives]).toEqual(['survival', false, 1, 1, 3])
        expect(def.player).toEqual({ pos: null, inventory: { cobble: 40, iron: 3 } })
        expect(def.townCenter).toEqual(newWorldDef({ seed: 'played', size: 128 }).townCenter)
        expect(parseWorld(serializeWorld(played()), { as: 'world', mode: 'creative', skirmish: true }).mode).toBe('creative')
    })
    it('the starting kit: its own, or the standard one when it has none or an empty one', () => {
        expect(startingKit({ cobble: 5 })).toEqual({ cobble: 5 })
        expect(startingKit({})).toEqual(STARTING_INVENTORY)
        expect(startingKit(undefined)).toEqual(STARTING_INVENTORY)
        const def = played()
        def.start = { inventory: {} }
        expect(parseWorld(serializeWorld(def)).player.inventory).toEqual(STARTING_INVENTORY)
    })
    it('a save with no game in it (a lab town) starts fresh, like a world', () => {
        const def = parseWorld(serializeWorld(played()), { as: 'save' })
        expect([def.day, def.nightLevel]).toEqual([1, 1])
        expect(def.player.inventory).toEqual({ cobble: 40, iron: 3 })
    })
    it('version 1 files still load: as a save with their game, as a world with their inventory as its kit', () => {
        const v1 = {
            format: 'block-world', formatVersion: 1, name: 'Old', description: '', seed: 'old', generator: { id: 'terrain', version: 1 },
            size: 128, mode: 'creative', skirmish: true, day: 6, nightLevel: 5, lives: 2, townCenter: [0, 9, 0],
            edits: [[1, 9, 1, 'planks']], units: [], player: { pos: [1, 2, 3], inventory: { planks: 7 } },
        }
        const save = parseWorld(v1, { as: 'save' })
        expect([save.mode, save.skirmish, save.day, save.nightLevel, save.lives]).toEqual(['creative', true, 6, 5, 2])
        expect(save.player).toEqual({ pos: [1, 2, 3], inventory: { planks: 7 } })
        const world = parseWorld(v1)
        expect([world.mode, world.day, world.nightLevel, world.lives]).toEqual(['survival', 1, 1, 3])
        expect(world.player).toEqual({ pos: null, inventory: { planks: 7 } })
        expect(world.start.inventory).toEqual({ planks: 7 })
    })
})

describe('the default world starts exactly as before', () => {
    const def = parseWorld(readFileSync(new URL('../worlds/default.world.json', import.meta.url), 'utf8'))
    it('survival, no daytime attacks, day 1, three lives, its own kit, spawning by the Town Center', () => {
        expect([def.mode, def.skirmish, def.day, def.nightLevel, def.lives]).toEqual(['survival', false, 1, 1, 3])
        expect(def.player).toEqual({ pos: null, inventory: { cobble: 12, log: 4, planks: 12, wood_sword: 1 } })
        expect(def.townCenter).toEqual([0, 8, 0])
    })
    it('opens with the raid, scripted to be lost', () => {
        expect(shouldPlayOpening(def)).toBe(true)
        const built = def.edits.map((e) => e[3])
        // + the wooden sword it starts with (weapon value 3)
        expect(scriptedLoss(defenceParts(built, def.units.map((u) => u.type), 3).total)).toBe(true)
    })
})

describe('the opening raid against a strong town', () => {
    it('always comes on a fresh survival start, never on Continue', () => {
        const fresh = parseWorld(serializeWorld(newWorldDef({ seed: 'raid' })))
        expect(shouldPlayOpening(fresh)).toBe(true)
        expect(shouldPlayOpening(fresh, { resumed: true })).toBe(false)
        expect(shouldPlayOpening({ ...fresh, mode: 'creative' })).toBe(false)
    })
    it('is only scripted to be lost up to a little above the starter town (222)', () => {
        expect(OPENING_RAID.scripted).toBeGreaterThan(225)
        expect(scriptedLoss(0)).toBe(true)
        expect(scriptedLoss(225)).toBe(true)
        expect(scriptedLoss(OPENING_RAID.scripted + 1)).toBe(false)
        expect(scriptedLoss(900)).toBe(false)
    })
})
