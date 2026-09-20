import { describe, it, expect } from 'vitest'
import { alignQuaternionKeys, countQuaternionFlips, sampleCurve, retangentLoop, isLoopCurve } from '../src/characters/animFix.js'
import { nextGait, gaitRate, groundSpeeds, WALK_ON, WALK_OFF, RUN_ON, RUN_OFF } from '../src/characters/contract.js'
import { PLAYER_GAIT, UNITS, HERO, DEFENDER_IDLE } from '../src/game/balance.js'

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

describe('looping curve tangents', () => {
    it('gives the start/end key of a looping curve a slope instead of a flat stop', () => {
        // a swing that passes through its middle value at the loop point
        const keys = [0, 30, 0, -30, 0].map((a, k) => ({ t: k * 0.2, v: [a, 0, 0], i: [0, 0, 0], o: [0, 0, 0] }))
        expect(retangentLoop(keys)).toBe(true)
        expect(keys[0].o[0]).toBeCloseTo((30 - -30) / 0.4, 5)
        expect(keys[4].i[0]).toBeCloseTo(keys[0].o[0], 5)
    })

    it('slopes the keys in between too, and stays flat where the curve turns', () => {
        const keys = [0, 30, 0, -30, 0].map((a, k) => ({ t: k * 0.2, v: [a, 0, 0], i: [0, 0, 0], o: [0, 0, 0] }))
        retangentLoop(keys)
        expect(keys[1].o[0]).toBeCloseTo(0, 5)             // peak: no overshoot past it
        expect(keys[2].o[0]).toBeCloseTo((-30 - 30) / 0.4, 5)
    })

    it('ignores curves that do not loop', () => {
        const keys = [0, 10, 20].map((a, k) => ({ t: k, v: [a], i: [0], o: [0] }))
        expect(retangentLoop(keys)).toBe(false)
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

describe('walking and running', () => {
    const player = groundSpeeds('player')

    it('walks the builder by default and runs it on Shift', () => {
        expect(nextGait('idle', PLAYER_GAIT.walk, player)).toBe('walk')
        expect(nextGait('walk', PLAYER_GAIT.run, player)).toBe('run')
        // and no flicker either way round at the speeds actually used
        expect(nextGait('run', PLAYER_GAIT.walk, player)).toBe('walk')
        expect(nextGait('walk', PLAYER_GAIT.run, player)).toBe('run')
    })

    it('keeps a possessed unit on a gait its own speed implies', () => {
        const order = { idle: 0, walk: 1, run: 2 }
        for (const def of Object.values(UNITS)) {
            const speeds = groundSpeeds(def.model)
            // possessed: 0.55x walking, 1.25x running (POSSESSED_GAIT in control.js)
            const walk = nextGait('idle', def.speed * 0.55, speeds)
            const run = nextGait(walk, def.speed * 1.25, speeds)
            expect(walk, `${def.type} possessed, walking`).toBe('walk')
            // a brute is slow enough to walk even flat out; nobody gets slower for running
            expect(order[run], `${def.type} possessed, running`).toBeGreaterThanOrEqual(order[walk])
        }
    })

    /**
     * A clip is honest while `gaitRate` doesn't have to clamp it: past the cap
     * the feet skate. This reads the measured GROUND_SPEED table, so re-cutting
     * a stride that leaves some unit behind fails here.
     */
    const honest = (speed, model) => {
        const speeds = groundSpeeds(model)
        const gait = nextGait('idle', speed, speeds)
        const rate = gaitRate(gait, speed, speeds)
        return gait === 'idle' || (rate > 0.5 && rate < (gait === 'walk' ? 2 : 2.8))
    }

    it('keeps every speed in the game inside the clip that plays it', () => {
        expect(honest(PLAYER_GAIT.walk, 'player')).toBe(true)
        expect(honest(PLAYER_GAIT.run, 'player')).toBe(true)
        expect(honest(HERO.speed, 'player')).toBe(true)
        for (const def of Object.values(UNITS)) {
            expect(honest(def.speed, def.model), `${def.type} at full speed`).toBe(true)
            expect(honest(def.speed * 1.25, def.model), `${def.type} possessed, running`).toBe(true)
            expect(honest(def.speed * 0.55, def.model), `${def.type} possessed, walking`).toBe(true)
            if (def.side === 'defender') {
                expect(honest(def.speed * DEFENDER_IDLE.dayWalk, def.model), `${def.type} wandering`).toBe(true)
                expect(honest(def.speed * DEFENDER_IDLE.nightWalk, def.model), `${def.type} patrolling`).toBe(true)
            }
        }
    })
})
