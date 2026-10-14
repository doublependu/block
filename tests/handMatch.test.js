/*
 *  The hands you see and the body's hands do the same thing (plan 13 §2).
 *  Until plan 13 nothing compared them: first person was drawn from curves
 *  (src/game/handPose.js), third person from clips made in Blender, and the
 *  swords were 66° apart at rest. This reads each character GLB, poses its
 *  skeleton at the clip's key moments with the item on the hand socket
 *  (src/characters/itemPose.js), and holds it to first person, which is the
 *  reference (tools/hand-match.mjs does the measuring; run it to see the table).
 *
 *  "The same", for every item and every model that holds it:
 *    at rest          the item points within 25°, the forearm within 35°
 *    the stroke       at the wind-up, the blow and the end: within 35° both
 *    the blow         the tip travels within 35° of the same direction, and
 *                     lands at the same moment (within 0.05 s, as the game plays the clip)
 *  A bare fist has nothing to point and its arm hangs at rest, so only its
 *  strike is held to first person.
 */

import { describe, it, expect } from 'vitest'
import { strokes, measure, cuts, loadModel, tpFrame } from '../tools/hand-match.mjs'
import { WEAPONS, UNITS } from '../src/game/balance.js'
import { ITEM_POSE } from '../src/characters/itemPose.js'

const label = (s) => `${s.item} on ${s.model}, ${s.motion}${s.back ? ' (backhand)' : ''} / ${s.clip}`

describe('first person and third person match (plan 13 §2.1)', () => {
    const list = strokes()

    it('covers every item and every model that holds it', () => {
        const pairs = new Set(list.map((s) => `${s.item}|${s.model}`))
        for (const w of Object.values(WEAPONS)) if (w.motion) expect(pairs.has(`${w.item}|player`), w.item).toBe(true)
        for (const u of Object.values(UNITS)) expect(pairs.has(`${u.item || 'fist'}|${u.model}`), u.type).toBe(true)
        expect(pairs.has('pickaxe|player')).toBe(true)
    })

    for (const s of list) {
        describe(label(s), () => {
            const r = measure(s)
            it('has the clip it plays', () => expect(r.clip).toBe(s.clip))
            if (s.item !== 'fist') {
                it('at rest: the item points the same way, and the forearm', () => {
                    expect(r.rest).toBeLessThanOrEqual(25)
                    expect(r.forearmRest).toBeLessThanOrEqual(35)
                })
            }
            it('through the stroke: the item and the forearm at the wind-up, the blow and the end', () => {
                for (const k of ['windUp', 'blow', 'end']) {
                    expect(r.moments[k].axis, k).toBeLessThanOrEqual(35)
                    expect(r.moments[k].forearm, k).toBeLessThanOrEqual(35)
                }
            })
            it('at the blow: the tip goes the same way, at the same moment', () => {
                expect(r.travel).toBeLessThanOrEqual(35)
                expect(Math.abs(r.blowFP - r.blowTP)).toBeLessThanOrEqual(0.05)
                // and the clip isn't played at a speed that would show it
                expect(s.speed).toBeGreaterThan(0.5)
                expect(s.speed).toBeLessThan(2)
            })
        })
    }

    it('the check catches the sword stood straight up out of the fist (until plan 13)', () => {
        const old = { pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0], roll: (55 * Math.PI) / 180, scale: 1 }
        const s = list.find((x) => x.item === 'wood_sword')
        expect(measure(s, { pose: old }).rest).toBeGreaterThan(25)
    })
})

describe('every sword swings the same, in every model that holds one (plan 13 §2.3)', () => {
    const swordModels = ['player', 'defender_swordsman']
    it('one pose in the hand for every sword', () => {
        for (const item of ['wood_sword', 'stone_sword', 'iron_sword']) expect(ITEM_POSE[item]).toEqual(ITEM_POSE.sword)
    })
    for (const name of swordModels) {
        const m = loadModel(name)
        it(`${name}: carries the forehand and the backhand, and no stroke of a tier`, () => {
            expect(m.clips.attack).toBeTruthy()
            expect(m.clips.attack_back).toBeTruthy()
            expect(m.clips.attack_heavy).toBeUndefined()
            expect(m.clips.attack_flourish).toBeUndefined()
        })
    }
    for (const s of strokes().filter((x) => x.item.endsWith('sword'))) {
        it(`${label(s)}: a cut, not a wave, in both views`, () => {
            const c = cuts(s)
            for (const v of [c.fp, c.tp]) {
                // the blade laid out from the arm, the tip going much farther than the hand,
                // the blade lying in the plane it sweeps
                expect(v.lean).toBeLessThanOrEqual(40)
                expect(v.reach).toBeGreaterThanOrEqual(1.5)
                expect(v.flat).toBeLessThanOrEqual(30)
            }
        })
    }
    it('the swords differ only in their mesh: the same blade direction at rest on the builder', () => {
        const m = loadModel('player')
        const a = tpFrame(m, 'wood_sword').axis, b = tpFrame(m, 'iron_sword').axis
        expect(a.subtract(b).length()).toBeLessThan(1e-6)
    })
})
