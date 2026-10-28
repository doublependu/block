import { describe, it, expect } from 'vitest'
import { DayCycle, livesAfter } from '../src/game/cycle.js'
import { newWorldDef, parseWorld, serializeSave, serializeWorld } from '../src/world/worldFile.js'
import { LIVES } from '../src/game/balance.js'
import { livesChip } from '../src/ui/hud.js'

/** play a cycle to a lost night and through its dawn */
function loseNight(c) {
    c.startNight()
    c.update(100, { damageRemaining: 0 })
    c.endNight('lost')
}

describe('unlimited lives (plan 12 §5.5)', () => {
    it('a lost night costs nothing, and is counted', () => {
        expect(livesAfter(3, 'lost', { unlimited: true })).toBe(3)
        expect(livesAfter(3, 'lost')).toBe(2)
    })

    it('a game with unlimited lives loses four nights in a row and goes on', () => {
        const c = new DayCycle({ mode: 'survival', day: 5, nightLevel: 5, unlimitedLives: true })
        for (let i = 0; i < 4; i++) {
            loseNight(c)
            expect(c.over).toBe(false)
            expect(c.phase).toBe('dawn')
            c.update(1000, { damageRemaining: 0 })
            expect(c.phase).toBe('day')
        }
        expect(c.nightsLost).toBe(4)
        expect(c.lives).toBe(LIVES)
        // the lost night comes again
        expect(c.nightLevel).toBe(5)
    })

    it('with 3 lives the third lost night still ends the game', () => {
        const c = new DayCycle({ mode: 'survival', day: 5, nightLevel: 5 })
        for (let i = 0; i < 3; i++) {
            loseNight(c)
            if (i < 2) c.update(1000, { damageRemaining: 0 })
        }
        expect(c.over).toBe(true)
        expect(c.phase).toBe('over')
    })

    it('the opening raid is never counted as a lost night', () => {
        const c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1, unlimitedLives: true })
        c.startOpening()
        c.endNight('lost')
        expect(c.nightsLost).toBe(0)
    })

    it('is a setting of the game: a save keeps it, a world export never holds it', () => {
        const def = { ...newWorldDef({ seed: 'frost-1', unlimitedLives: true }), nightsLost: 2 }
        const save = serializeSave(def)
        expect(save).toContain('"unlimitedLives":true')
        const back = parseWorld(save, { as: 'save' })
        expect(back.unlimitedLives).toBe(true)
        expect(back.nightsLost).toBe(2)
        const world = serializeWorld(def)
        expect(world).not.toContain('unlimited')
        expect(world).not.toContain('nightsLost')
        // a world started with it picked
        expect(parseWorld(world, { as: 'world', unlimitedLives: true }).unlimitedLives).toBe(true)
        // and without: Play
        expect(parseWorld(world, { as: 'world' }).unlimitedLives).toBe(false)
    })

    it('old saves and ordinary games start with 3 lives and read as before', () => {
        const def = newWorldDef({ seed: 'plain-1' })
        const save = serializeSave(def)
        expect(save).not.toContain('unlimited')
        const back = parseWorld(save, { as: 'save' })
        expect(back.unlimitedLives).toBe(false)
        expect(back.lives).toBe(LIVES)
    })

    it('the HUD shows ∞ and the nights lost, or a diamond a life', () => {
        expect(livesChip({ lives: 3, unlimitedLives: true, nightsLost: 0 }).html).toContain('∞')
        expect(livesChip({ lives: 3, unlimitedLives: true, nightsLost: 2 }).html).toContain('2 lost')
        expect(livesChip({ lives: 3, unlimitedLives: true, nightsLost: 1 }).title).toContain('1 night lost')
        const plain = livesChip({ lives: 2 })
        expect(plain.html.match(/<i/g)).toHaveLength(3)
        expect(plain.html.match(/lost/g)).toHaveLength(1)
        expect(plain.title).toContain('2 lives left')
    })
})
