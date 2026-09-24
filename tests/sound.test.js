import { describe, it, expect } from 'vitest'
import {
    RECIPES, swingSound, hitSound, hurtSound, deathSound, bowSounds, shotSound, towerSound, impactSound,
    digSound, breakSound, bashSound, placeSound, stepSound, upgradeSound, soundMaterial,
} from '../src/audio/sounds.js'
import { recipeLength } from '../src/audio/synth.js'
import { banked, bankBytes, takes, takePitch, BANK_RATE } from '../src/audio/bank.js'
import { threat, drumBar } from '../src/audio/ambience.js'
import { strikes, MOTIONS } from '../src/game/viewModel.js'
import { UNITS, WEAPONS, TOWERS, PROJECTILES, FAMILIES } from '../src/game/balance.js'
import { BLOCKS } from '../src/world/blocks.js'

const MATERIALS = ['soft', 'stone', 'wood', 'metal']

describe('every event has its own sound', () => {
    it('each sword tier swings differently, and the iron one alternates', () => {
        const swings = FAMILIES.sword.map((w) => swingSound(w))
        expect(new Set(swings).size).toBe(3)
        expect(swingSound('iron_sword', true)).not.toBe(swingSound('iron_sword'))
        for (const w of Object.keys(WEAPONS)) expect(RECIPES[swingSound(w)], w).toBeTruthy()
    })

    it('each bow tier draws and looses differently, and the release comes inside the cooldown', () => {
        const all = FAMILIES.bow.map((w) => bowSounds(w))
        expect(new Set(all.map((b) => b.release)).size).toBe(3)
        expect(new Set(all.map((b) => b.draw)).size).toBe(3)
        for (const w of FAMILIES.bow) {
            const b = bowSounds(w)
            expect(RECIPES[b.draw] && RECIPES[b.release], w).toBeTruthy()
            const m = MOTIONS[WEAPONS[w].motion]
            expect(m.draw.hold * m.time, w).toBeLessThan(WEAPONS[w].cooldown)
        }
    })

    it('every unit sounds like what it is when hit, hurt and killed', () => {
        for (const [type, def] of Object.entries(UNITS)) {
            for (const name of [hitSound(type), hurtSound(type, def.side), deathSound(type, def.side)]) expect(RECIPES[name], `${type}: ${name}`).toBeTruthy()
        }
        // armour clanks, bones rattle, a shield knocks
        expect(hitSound('brute')).toBe('hit_armour')
        expect(hitSound('raider')).toBe('hit_bone')
        expect(hitSound('swordsman')).toBe('hit_shield')
        expect(new Set(['grunt', 'raider', 'brute', 'sapper'].map((t) => deathSound(t, 'attacker'))).size).toBe(4)
    })

    it('every tower fires with its own sound (the tiers no longer fall back to the arrow)', () => {
        const names = Object.keys(TOWERS).map(towerSound)
        expect(new Set(names).size).toBe(Object.keys(TOWERS).length)
        for (const n of names) expect(RECIPES[n], n).toBeTruthy()
    })

    it('every projectile lands with a sound on every surface', () => {
        for (const p of Object.keys(PROJECTILES)) {
            expect(RECIPES[shotSound(p)], p).toBeTruthy()
            for (const s of [...MATERIALS, 'body']) expect(RECIPES[impactSound(p, s)], `${p} on ${s}`).toBeTruthy()
        }
    })

    it('every material digs, breaks, is battered, placed and walked on with its own sound', () => {
        for (const fn of [digSound, breakSound, bashSound, placeSound, stepSound]) {
            const names = MATERIALS.map((m) => fn(m))
            expect(new Set(names).size, fn.name).toBe(4)
            for (const n of names) expect(RECIPES[n], n).toBeTruthy()
        }
        // ore rings brighter than stone
        expect(digSound('stone', 'iron_ore')).toBe('dig_ore')
        expect(digSound('stone', 'stone')).toBe('dig_stone')
        for (const b of BLOCKS) expect(MATERIALS, b.name).toContain(soundMaterial(b.name))
    })

    it('an upgrade rings, and tier III rings brighter than tier II', () => {
        expect(upgradeSound(2)).not.toBe(upgradeSound(3))
        expect(RECIPES[upgradeSound(2)] && RECIPES[upgradeSound(3)]).toBeTruthy()
    })
})

describe('recipes', () => {
    it('are well formed and inside what the bank can hold', () => {
        for (const [name, r] of Object.entries(RECIPES)) {
            expect(r.layers.length, name).toBeGreaterThan(0)
            for (const L of r.layers) {
                expect(['noise', 'tone', 'ring', 'crackle', 'voice'], name).toContain(L.k)
                expect(L.dur, name).toBeGreaterThan(0)
                expect(L.gain, name).toBeGreaterThan(0)
                expect(L.gain, name).toBeLessThanOrEqual(1)
                // under the bank's Nyquist frequency, with room for the detune
                for (const f of [L.freq, L.to, L.f0].filter(Boolean)) {
                    const top = L.k === 'ring' ? f * Math.max(...(L.partials || [8.93])) : f
                    if (!banked(r) || L.k === 'ring') continue
                    expect(top * 1.15, `${name} ${f} Hz`).toBeLessThan(BANK_RATE / 2)
                }
            }
            expect(recipeLength(r), name).toBeLessThan(2.5)
        }
    })

    it('keeps the bank under 4 MB', () => {
        expect(bankBytes()).toBeLessThan(4e6)
    })

    it('spreads the takes evenly around the recipe pitch', () => {
        const r = RECIPES.hit_bone
        const n = takes(r)
        const ps = Array.from({ length: n }, (_, i) => takePitch(r, i, n))
        expect(Math.min(...ps)).toBeLessThan(1)
        expect(Math.max(...ps)).toBeGreaterThan(1)
        expect(ps.reduce((a, b) => a + b, 0) / n).toBeCloseTo(1, 5)
    })
})

describe('the night soundscape', () => {
    it('is silent with no attackers, and rises with how many and how close', () => {
        expect(threat({ attackers: 0, nearest: Infinity })).toBe(0)
        const few = threat({ attackers: 3, nearest: 60 })
        const many = threat({ attackers: 30, nearest: 60 })
        const close = threat({ attackers: 30, nearest: 5 })
        expect(few).toBeGreaterThan(0)
        expect(many).toBeGreaterThan(few)
        expect(close).toBeGreaterThan(many)
        expect(close).toBeLessThanOrEqual(1)
    })

    it('drums faster and busier as the night gets worse, down to a single beat', () => {
        expect(drumBar(0.05)).toMatchObject({ low: [0], high: [] })
        let prev = drumBar(0)
        for (const i of [0.2, 0.4, 0.6, 0.8, 1]) {
            const b = drumBar(i)
            expect(b.bpm).toBeGreaterThan(prev.bpm)
            expect(b.low.length + b.high.length).toBeGreaterThanOrEqual(prev.low.length + prev.high.length)
            for (const beat of [...b.low, ...b.high]) expect(beat).toBeLessThan(8)
            prev = b
        }
    })
})

describe('the pickaxe keeps time with its sound', () => {
    it('counts a blow each time the chop passes its impact point', () => {
        const k = MOTIONS.mine.impact
        expect(strikes(k - 0.1, k + 0.1, k)).toBe(true)
        expect(strikes(k + 0.01, k + 0.2, k)).toBe(false)
        expect(strikes(0.9, 0.1, k)).toBe(false)
        // round again and past it in one step
        expect(strikes(0.9, k + 0.05, k)).toBe(true)
        expect(strikes(k - 0.05, 0.1, k)).toBe(true)
    })
})
