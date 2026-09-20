import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { newWorldDef, parseWorld, serializeWorld, sortEdits, slugify } from '../src/world/worldFile.js'
import { buildDefaultWorld } from '../src/world/defaultWorld.js'
import { FAMILIES } from '../src/game/balance.js'

describe('world file', () => {
    it('round-trips through serialize/parse', () => {
        const def = newWorldDef({ seed: 'round-trip', name: 'Round Trip', size: 128, mode: 'creative', skirmish: true })
        def.edits = [[3, 4, 5, 'planks'], [-10, 2, 7, 'air'], [30, 1, -30, 'arrow_tower']]
        def.units = [{ id: 'u1', type: 'archer', pos: [1.5, 8, 2.5], yaw: 90 }]
        def.player = { pos: [0.5, 9, 4.5], inventory: { planks: 3, gold: 1 } }
        def.day = 4
        def.nightLevel = 3
        const text = serializeWorld(def)
        const back = parseWorld(text)
        expect(back.seed).toBe('round-trip')
        expect(back.mode).toBe('creative')
        expect(back.skirmish).toBe(true)
        expect(back.day).toBe(4)
        expect(back.nightLevel).toBe(3)
        expect(sortEdits(back.edits)).toEqual(sortEdits(def.edits))
        expect(back.units).toEqual(def.units)
        expect(back.player.inventory).toEqual({ gold: 1, planks: 3 })
        // serialising again gives the identical file (stable for git)
        expect(serializeWorld(back)).toBe(text)
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

    it('keeps the lives left; older files and used-up games get a full set', () => {
        const def = newWorldDef({ seed: 'lives' })
        expect(def.lives).toBe(3)
        def.lives = 2
        expect(parseWorld(serializeWorld(def)).lives).toBe(2)
        const o = JSON.parse(serializeWorld(def))
        delete o.lives
        expect(parseWorld(o).lives).toBe(3)
        o.lives = 0
        expect(parseWorld(o).lives).toBe(3)
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
