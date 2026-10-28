import { describe, it, expect, beforeEach, vi } from 'vitest'
import { crackStage, STAGES } from '../src/game/cracks.js'
import { BAR, barLayers, farToNear } from '../src/game/healthBars.js'

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

describe('health bar drawing order', () => {
    const layers = (...args) => {
        const out = []
        barLayers(...args, (frac, color, back) => out.push({ frac, color, back }))
        return out
    }

    it('draws the back plate, then the damage chip, then the fill', () => {
        const q = layers(0.6, 0.9, false, 'defender')
        expect(q.map((x) => x.color)).toEqual([BAR.colors.back, BAR.colors.chip, BAR.colors.defender])
        expect(q.map((x) => x.frac)).toEqual([1, 0.9, 0.6])
        expect(q.map((x) => x.back)).toEqual([true, false, false])
    })

    it('leaves out a chip with no recent damage, and a fill with no health', () => {
        expect(layers(0.6, 0.6, false, 'attacker').map((x) => x.color)).toEqual([BAR.colors.back, BAR.colors.attacker])
        expect(layers(0, 0.4, false, 'attacker').map((x) => x.color)).toEqual([BAR.colors.back, BAR.colors.chip])
    })

    it('flashes the fill on a hit', () => {
        expect(layers(0.5, 0.5, true, 'attacker').at(-1).color).toEqual(BAR.colors.flash)
    })

    it('sorts bars far to near, so nearer bars cover farther ones', () => {
        const bars = [{ dist: 5 }, { dist: 40 }, { dist: 12 }]
        expect(bars.sort(farToNear).map((b) => b.dist)).toEqual([40, 12, 5])
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

    it('remembers which tips were done, and turns tips off for a run with ?tips=0', async () => {
        const { getSetting, setSetting, resetSettings } = await import('../src/core/settings.js')
        resetSettings()
        expect(getSetting('tips')).toBe(true)
        expect(getSetting('tipsDone')).toEqual([])
        setSetting('tipsDone', ['wood', 'stone'])
        resetSettings()
        expect(getSetting('tipsDone')).toEqual(['wood', 'stone'])
        vi.stubGlobal('location', { search: '?tips=0' })
        resetSettings()
        expect(getSetting('tips')).toBe(false)
    })

    it('can be forced off for a run with ?hpbars=0', async () => {
        const { getSetting, resetSettings } = await import('../src/core/settings.js')
        vi.stubGlobal('location', { search: '?hpbars=0' })
        resetSettings()
        expect(getSetting('hpBars')).toBe(false)
    })
})
