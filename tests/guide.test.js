import { describe, it, expect } from 'vitest'
import { TIPS, STEPS, newTipState, stepTips, noteProgress, openStep, completes, suggestCrafts, tipText, wallSteps } from '../src/game/guide.js'
import { Inventory } from '../src/game/inventory.js'
import { buildDefaultWorld } from '../src/world/defaultWorld.js'
import { createGenerator } from '../src/world/gen/index.js'
import { blockId } from '../src/world/blocks.js'

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

describe('the wall walk tips', () => {
    it('suggests shooting from the wall, with whatever you shoot with', () => {
        expect(tipText('wall', { ranged: 'musket' }).text).toMatch(/step beside a gate.*musket/)
        expect(tipText('wall', { ranged: 'bow' }).after).toMatch(/raider/)
    })

    it('the night reminder mentions a bow only when you have nothing to shoot with', () => {
        expect(tipText('prep', { ranged: null }).text).toMatch(/bow/i)
        expect(tipText('prep', { ranged: 'bow' }).text).not.toMatch(/A bow/)
    })

    it('patching a hole is progress but completes no step', () => {
        expect(completes('patched', 'stone_wall')).toBe(null)
    })
})

describe('the default town: wood, stone and the wall walk', () => {
    const def = buildDefaultWorld()
    const gen = createGenerator(def.generator.version, def.seed, def.size)
    const edits = new Map(def.edits.map(([x, y, z, b]) => [`${x},${y},${z}`, blockId(b)]))
    const getBlock = (x, y, z) => edits.get(`${x},${y},${z}`) ?? gen.blockAt(x, y, z)
    const tc = def.townCenter
    const world = {
        townCenter: tc,
        getBlock,
        edits: { forEach: (fn) => def.edits.forEach(([x, y, z, b]) => fn(x, y, z, blockId(b))) },
    }

    it('has a step up onto the wall on both sides of every gate', () => {
        const steps = wallSteps(/** @type {any} */ (world))
        expect(steps).toHaveLength(8)
    })

    it('grows trees and a stone outcrop with iron near the town, off the gate lanes', () => {
        const near = (b) => def.edits.filter((e) => e[3] === b)
        const trunks = near('log').filter((e) => getBlock(e[0], e[1] - 1, e[2]) === blockId('grass'))
        expect(trunks.length).toBeGreaterThanOrEqual(6)
        for (const [x, , z] of [...near('log'), ...near('iron_ore')]) {
            const d = Math.hypot(x - tc[0], z - tc[2])
            expect(d).toBeGreaterThan(18)
            expect(d).toBeLessThan(42)
        }
        expect(near('iron_ore').length).toBeGreaterThanOrEqual(2)
        // nothing new stands in a gate lane (the straight line out from each gate) or in the ditch
        for (const [x, y, z, b] of def.edits) {
            const dx = Math.abs(x - tc[0]), dz = Math.abs(z - tc[2])
            // (stone under the wall ring is its base, not the outcrop)
            if (!['log', 'leaves', 'iron_ore'].includes(b) && !(b === 'stone' && y >= gen.surfaceY(x, z) && Math.max(dx, dz) > 13)) continue
            expect(Math.min(dx, dz)).toBeGreaterThan(4)
            expect(Math.max(dx, dz)).toBeGreaterThan(15)
        }
    })
})
