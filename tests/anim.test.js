import { describe, it, expect } from 'vitest'
import { alignQuaternionKeys, countQuaternionFlips, sampleCurve, smoothLoopSeam, isLoopCurve } from '../src/characters/animFix.js'
import { nextGait, gaitRate, groundSpeeds, WALK_ON, WALK_OFF, RUN_ON, RUN_OFF } from '../src/characters/contract.js'

const RAD = Math.PI / 180
/** rotation about X as [x, y, z, w], written the way exporters do (w >= 0) */
const qx = (deg) => {
    const q = [Math.sin((deg * RAD) / 2), 0, 0, Math.cos((deg * RAD) / 2)]
    return q[3] < 0 ? q.map((v) => -v) : q
}
/** angle about X in degrees, continuous around 180 */
const angleX = (q) => {
    let a = (2 * Math.atan2(q[0], q[3])) / RAD
    if (a < 0) a += 360
    return a
}

/** the walk thigh curve as exported: 150° → 180° → 210° → 180° → 150° (rest 180°), tangents taken across the flip */
function exportedWalkThigh() {
    const angles = [150, 180, 210, 180, 150]
    const keys = angles.map((a, k) => ({ t: k * 0.2, v: qx(a), i: [0, 0, 0, 0], o: [0, 0, 0, 0] }))
    // what the exporter wrote at the 180° keys: slopes computed from the w >= 0 values
    for (const k of [1, 3]) {
        const d = keys[k + 1].v.map((v, c) => (v - keys[k - 1].v[c]) / 0.4)
        keys[k].i = d.slice()
        keys[k].o = d.slice()
    }
    return keys
}

/** largest change in angle between samples 1/60 s apart */
function maxStep(keys) {
    let prev = angleX(sampleCurve(keys, 0)), worst = 0
    for (let t = 1 / 60; t <= keys[keys.length - 1].t + 1e-9; t += 1 / 60) {
        const a = angleX(sampleCurve(keys, t))
        worst = Math.max(worst, Math.abs(a - prev))
        prev = a
    }
    return worst
}

describe('rotation key hemisphere fix', () => {
    it('reproduces the limb flick in the exported curve', () => {
        const keys = exportedWalkThigh()
        expect(countQuaternionFlips(keys.map((k) => k.v))).toBe(2)
        expect(maxStep(keys)).toBeGreaterThan(30)
    })

    it('aligns the keys and gives a smooth swing between the authored angles', () => {
        const keys = exportedWalkThigh()
        expect(alignQuaternionKeys(keys)).toBe(1)
        expect(countQuaternionFlips(keys.map((k) => k.v))).toBe(0)
        expect(isLoopCurve(keys)).toBe(true)
        // every key still means the same rotation
        ;[150, 180, 210, 180, 150].forEach((a, k) => expect(angleX(keys[k].v)).toBeCloseTo(a, 3))
        expect(maxStep(keys)).toBeLessThan(6)
        for (let t = 0; t <= 0.8; t += 0.01) {
            const a = angleX(sampleCurve(keys, t))
            expect(a).toBeGreaterThan(149)
            expect(a).toBeLessThan(211)
        }
    })

    it('leaves a clean curve untouched', () => {
        const keys = [0, 20, 40, 20, 0].map((a, k) => ({ t: k, v: qx(a), i: [0, 0.1, 0, 0], o: [0, 0.1, 0, 0] }))
        const before = JSON.stringify(keys)
        expect(alignQuaternionKeys(keys)).toBe(0)
        expect(JSON.stringify(keys)).toBe(before)
    })

    it('works on linear curves (no tangents)', () => {
        const keys = [170, 190, 170].map((a, k) => ({ t: k, v: qx(a) }))
        expect(alignQuaternionKeys(keys)).toBe(1)
        expect(keys[1].i).toBeUndefined()
        expect(angleX(sampleCurve(keys, 0.5))).toBeCloseTo(180, 0)
    })
})

describe('loop seams', () => {
    it('gives the start/end key of a looping curve a slope instead of a flat stop', () => {
        // a swing that passes through its middle value at the loop point
        const keys = [0, 30, 0, -30, 0].map((a, k) => ({ t: k * 0.2, v: [a, 0, 0], i: [0, 0, 0], o: [0, 0, 0] }))
        expect(smoothLoopSeam(keys)).toBe(true)
        expect(keys[0].o[0]).toBeCloseTo((30 - -30) / 0.4, 5)
        expect(keys[4].i[0]).toBeCloseTo(keys[0].o[0], 5)
    })

    it('ignores curves that do not loop', () => {
        const keys = [0, 10, 20].map((a, k) => ({ t: k, v: [a], i: [0], o: [0] }))
        expect(smoothLoopSeam(keys)).toBe(false)
    })
})

describe('gait selection and playback rate', () => {
    const player = groundSpeeds('player')

    it('uses hysteresis around the walk and run thresholds', () => {
        expect(nextGait('idle', WALK_ON - 0.01, player)).toBe('idle')
        expect(nextGait('idle', WALK_ON, player)).toBe('walk')
        // between off and on: keep what we had
        const mid = (WALK_ON + WALK_OFF) / 2
        expect(nextGait('walk', mid, player)).toBe('walk')
        expect(nextGait('idle', mid, player)).toBe('idle')
        const runMid = player.walk * (RUN_ON + RUN_OFF) / 2
        expect(nextGait('walk', runMid, player)).toBe('walk')
        expect(nextGait('run', runMid, player)).toBe('run')
        expect(nextGait('walk', player.walk * RUN_ON, player)).toBe('run')
        expect(nextGait('run', player.walk * RUN_OFF, player)).toBe('walk')
        expect(nextGait('run', 0, player)).toBe('idle')
    })

    it('brutes walk at full speed, grunts run, wandering troops walk', () => {
        expect(nextGait('walk', 2.6, groundSpeeds('attacker_brute'))).toBe('walk')
        expect(nextGait('walk', 3.6, groundSpeeds('attacker_grunt'))).toBe('run')
        expect(nextGait('walk', 2.25, groundSpeeds('defender_swordsman'))).toBe('walk')
    })

    it('plays the clip at the rate that matches the stride', () => {
        expect(gaitRate('walk', player.walk, player)).toBeCloseTo(1)
        expect(gaitRate('run', player.run * 1.5, player)).toBeCloseTo(1.5)
        expect(gaitRate('run', 100, player)).toBe(2.8)
        expect(gaitRate('walk', 0.1, player)).toBe(0.5)
        expect(gaitRate('idle', 3, player)).toBe(1)
    })

    it('scales unknown models by height', () => {
        const big = groundSpeeds('https://example.com/avatar.glb', 3.5)
        expect(big.walk).toBeCloseTo(player.walk * 2)
    })
})
