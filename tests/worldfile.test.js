import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { newWorldDef, parseWorld, serializeWorld, sortEdits, slugify } from '../src/world/worldFile.js'
import { buildDefaultWorld } from '../src/world/defaultWorld.js'

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
