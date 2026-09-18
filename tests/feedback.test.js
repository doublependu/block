import { describe, it, expect, beforeEach, vi } from 'vitest'
import { crackStage, STAGES } from '../src/game/cracks.js'
import { BAR } from '../src/game/healthBars.js'

describe('crack stages', () => {
    it('shows nothing until a block is damaged, then one stage per quarter', () => {
        expect(crackStage(1)).toBe(-1)
        expect(crackStage(0.8)).toBe(-1)
        expect(crackStage(0.74)).toBe(0)
        expect(crackStage(0.5)).toBe(1)
        expect(crackStage(0.4)).toBe(1)
        expect(crackStage(0.25)).toBe(2)
        expect(crackStage(0.1)).toBe(2)
        expect(crackStage(0)).toBe(3)
    })

    it('has a stage for every threshold', () => {
        expect(STAGES.length).toBe(4)
        // just below each threshold, the next stage is showing
        for (const t of STAGES) expect(crackStage(t - 0.001)).toBeGreaterThanOrEqual(0)
        expect(new Set(STAGES.map((t) => crackStage(t - 0.001))).size).toBe(STAGES.length)
    })
})

describe('health bar colours', () => {
    it('tells the two sides apart', () => {
        expect(BAR.colors.attacker).not.toEqual(BAR.colors.defender)
        // blue for defenders, red for attackers (distinct in red-green colour blindness)
        expect(BAR.colors.defender[2]).toBeGreaterThan(BAR.colors.defender[0])
        expect(BAR.colors.attacker[0]).toBeGreaterThan(BAR.colors.attacker[2])
    })
})

describe('settings', () => {
    /** @type {Record<string, string>} */
    let store = {}
    beforeEach(() => {
        store = {}
        vi.stubGlobal('localStorage', {
            getItem: (k) => store[k] ?? null,
            setItem: (k, v) => {
                store[k] = v
            },
        })
        vi.stubGlobal('location', { search: '' })
    })

    it('defaults to health bars on, and remembers a change', async () => {
        const { getSetting, setSetting, resetSettings } = await import('../src/core/settings.js')
        resetSettings()
        expect(getSetting('hpBars')).toBe(true)
        setSetting('hpBars', false)
        expect(getSetting('hpBars')).toBe(false)
        resetSettings()
        expect(getSetting('hpBars')).toBe(false)
        expect(JSON.parse(store['block.settings']).hpBars).toBe(false)
    })

    it('still works when storage is blocked', async () => {
        const { getSetting, setSetting, resetSettings } = await import('../src/core/settings.js')
        vi.stubGlobal('localStorage', {
            getItem: () => {
                throw new Error('blocked')
            },
            setItem: () => {
                throw new Error('blocked')
            },
        })
        resetSettings()
        expect(getSetting('hpBars')).toBe(true)
        expect(() => setSetting('hpBars', false)).not.toThrow()
        expect(getSetting('hpBars')).toBe(false)
    })

    it('can be forced off for a run with ?hpbars=0', async () => {
        const { getSetting, resetSettings } = await import('../src/core/settings.js')
        vi.stubGlobal('location', { search: '?hpbars=0' })
        resetSettings()
        expect(getSetting('hpBars')).toBe(false)
    })
})
