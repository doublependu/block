import { describe, it, expect } from 'vitest'
import { TIPS, STEPS, newTipState, stepTips, noteProgress, openStep, completes, suggestCrafts, tipText } from '../src/game/guide.js'
import { Inventory } from '../src/game/inventory.js'

/** run the tips for `seconds` in 0.1 s steps; returns what was shown last */
function run(st, seconds, over = {}) {
    let shown = null
    for (let t = 0; t < seconds - 1e-9; t += 0.1) {
        shown = stepTips(st, { dt: 0.1, enabled: true, day: 1, phase: 'day', busy: false, timeToNight: 400, ...over })
    }
    return shown
}

describe('tips for the first days', () => {
    it('waits before the first tip, and shows it only when nothing happens', () => {
        const st = newTipState()
        expect(run(st, TIPS.firstDelay - 1)).toBeNull()
        expect(run(st, 1.5)).toBe('wood')
        // it stays up until the step is done
        expect(run(st, 30)).toBe('wood')
    })

    it('never shows one to a busy player: any progress restarts the wait', () => {
        const st = newTipState()
        for (let i = 0; i < 10; i++) {
            expect(run(st, TIPS.firstDelay - 5)).toBeNull()
            noteProgress(st, 'gained', 'dirt')
        }
    })

    it('takes a tip down when its step is done, and waits longer for the next', () => {
        const st = newTipState()
        run(st, TIPS.firstDelay + 1)
        expect(noteProgress(st, 'gained', 'log')).toBe('wood')
        expect(st.shown).toBeNull()
        expect(run(st, TIPS.delay - 1)).toBeNull()
        expect(run(st, 1.5)).toBe('stone')
    })

    it('stays quiet at dusk and night, while busy, in creative, and after day 3', () => {
        for (const over of [{ phase: 'dusk' }, { phase: 'night' }, { busy: true }, { enabled: false }, { day: TIPS.days + 1 }]) {
            expect(run(newTipState(), 120, over)).toBeNull()
        }
        // being busy doesn't count as waiting
        const st = newTipState()
        run(st, 100, { busy: true })
        expect(run(st, TIPS.firstDelay - 1)).toBeNull()
    })

    it('skips steps already done, and keeps iron and gold for day 2 or after the basics', () => {
        expect(openStep(new Set(['wood']), 1)).toBe('stone')
        expect(openStep(new Set(['wood', 'stone', 'craft']), 1)).toBe('defend')
        expect(openStep(new Set(['wood', 'stone', 'craft', 'defend']), 1)).toBe('ore')
        expect(openStep(new Set(['wood', 'stone']), 2)).toBe('craft')
        expect(openStep(new Set(['wood', 'stone', 'craft', 'defend']), 2)).toBe('ore')
        expect(openStep(new Set(STEPS), 2)).toBeNull()
        const st = newTipState(['wood', 'stone', 'craft', 'defend', 'ore'])
        expect(run(st, 200)).toBeNull()
    })

    it('knows what completes each step', () => {
        expect(completes('gained', 'log')).toBe('wood')
        expect(completes('gained', 'cobble')).toBe('stone')
        expect(completes('gained', 'gold')).toBe('ore')
        expect(completes('gained', 'dirt')).toBeNull()
        expect(completes('crafted', 'planks')).toBe('craft')
        expect(completes('placed', 'stone_wall')).toBe('defend')
        expect(completes('placed', 'archer')).toBe('defend')
        expect(completes('placed', 'dirt')).toBeNull()
    })

    it('reminds you once a day, a minute before night', () => {
        const st = newTipState(STEPS)
        expect(run(st, 1, { timeToNight: TIPS.prepAt + 5 })).toBeNull()
        expect(run(st, 1, { timeToNight: TIPS.prepAt - 1 })).toBe('prep')
        expect(run(st, TIPS.prepFor + 1, { timeToNight: 30 })).toBeNull()
        // not again the same day, again the next
        expect(run(st, 5, { timeToNight: 20 })).toBeNull()
        expect(run(st, 1, { timeToNight: 50, day: 2 })).toBe('prep')
    })

    it('suggests useful crafts you can afford right now', () => {
        const start = new Inventory({ cobble: 12, log: 4, planks: 12, wood_sword: 1 }, false)
        const outs = suggestCrafts(start).map((r) => r.out)
        expect(outs[0]).toBe('arrow_tower')
        expect(outs).toContain('stone_wall')
        expect(outs.length).toBe(3)
        expect(suggestCrafts(new Inventory({}, false))).toEqual([])
        // named in the tip, with their costs
        const text = tipText('craft', { crafts: suggestCrafts(start) }).text
        expect(text).toContain('Arrow tower (6 planks, 4 cobblestone)')
    })

    it('words the controls for touch', () => {
        expect(tipText('wood').text).toContain('left click')
        expect(tipText('wood', { touch: true }).text).toContain('⛏')
        expect(tipText('defend', { touch: true }).text).toContain('▣')
        for (const id of [...STEPS, 'prep']) expect(tipText(id).title.length).toBeGreaterThan(0)
    })
})
