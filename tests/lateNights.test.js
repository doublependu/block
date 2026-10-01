import { describe, it, expect } from 'vitest'
import { streamCount, planWave, overflowMults } from '../src/game/waves.js'
import { WAVE_STREAMS, WAVE_OVERFLOW, UNITS } from '../src/game/balance.js'

/** the grunt stream as it was before plan 12 */
const oldGrunts = (n) => 14 * Math.pow(1.18, n - 1)

describe('late nights (plan 12 §5.4)', () => {
    it('nothing changes up to night 12: the grunts compound as before', () => {
        for (let n = 1; n <= 12; n++) expect(streamCount('grunt', n)).toBeCloseTo(oldGrunts(n), 9)
    })

    it('from night 13 the grunts grow by night 12\'s step, not ×1.18 a night', () => {
        const step = oldGrunts(12) - oldGrunts(11)
        expect(step).toBeCloseTo(13.2, 0)
        for (let n = 13; n <= 30; n++) expect(streamCount('grunt', n)).toBeCloseTo(oldGrunts(12) + step * (n - 12), 9)
        // still more every night
        for (let n = 2; n <= 30; n++) expect(streamCount('grunt', n)).toBeGreaterThan(streamCount('grunt', n - 1))
        expect(streamCount('grunt', 24)).toBeLessThan(oldGrunts(24) / 2)
    })

    it('every other stream is as it was (none of them compound)', () => {
        for (const [type, s] of Object.entries(WAVE_STREAMS)) if (type !== 'grunt') expect(s.growth, type).toBe(1)
    })

    it('the same rolls plan the same nights 1–12 for a town with and without the change', () => {
        // a deterministic roll, and the same defence each night
        const seq = () => {
            let i = 0
            return () => ((i++ * 0.618034) % 1)
        }
        const parts = { arrow: 200, cannon: 100, troops: 60, walls: 300, frost: 0, weapon: 10, total: 670 }
        for (let n = 1; n <= 12; n++) {
            const plan = planWave(n, parts, seq())
            const grunts = plan.counts.grunt - (plan.answer.grunt || 0)
            expect(Math.abs(grunts - oldGrunts(n)), `night ${n}`).toBeLessThan(1)
        }
    })

    it('past the cap the extra attackers come back as HP, their blows at most ×1.25', () => {
        expect(overflowMults(100, 140)).toEqual({ hp: 1, dmg: 1 })
        const m = overflowMults(350, 140)
        expect(m.hp).toBeCloseTo(2.5)
        expect(m.dmg).toBe(WAVE_OVERFLOW.maxDamage)
        expect(overflowMults(154, 140).dmg).toBeCloseTo(1.1)
    })

    it('the fire mage comes from night 7, one a night and 0.35 more each night after', () => {
        expect(streamCount('pyro', 6)).toBe(0)
        expect(streamCount('pyro', 7)).toBe(1)
        expect(streamCount('pyro', 17)).toBeCloseTo(1 + 0.35 * 10)
        expect(UNITS.pyro.caster).toBe(true)
    })
})
