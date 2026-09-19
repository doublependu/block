import { describe, it, expect } from 'vitest'
import {
    AERIAL, viewDir, screenDir, cameraPos, reanchor, zoomStep, panAxis,
    terrainFloor, blocksFloor, smoothDamp, liftFrame, cameraAhead, motionFrom,
} from '../src/game/aerialCam.js'

const state = (o = {}) => ({ x: 3, y: 9, z: -4, zoom: 38, shown: 38, lift: 0, liftV: 0, heading: 0.6, pitch: 0.9, tx: undefined, tz: undefined, ...o })

/** small deterministic random numbers */
function rng(seed) {
    let s = seed >>> 0
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

const randomState = (r) => state({
    x: (r() - 0.5) * 150, z: (r() - 0.5) * 150, y: 2 + r() * 40,
    zoom: 12 + r() * 58, heading: r() * Math.PI * 2, pitch: 0.35 + r() * 1.1, lift: r() < 0.5 ? 0 : r() * 20,
})

const close = (a, b, eps = 1e-9) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps))

/** distance from point p to the line through `from` along unit `dir` */
function offRay(p, from, dir) {
    const v = [p[0] - from[0], p[1] - from[1], p[2] - from[2]]
    const t = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2]
    return Math.hypot(v[0] - dir[0] * t, v[1] - dir[1] * t, v[2] - dir[2] * t)
}

describe('aerial camera height', () => {
    it('panning never changes it', () => {
        const r = rng(1)
        for (let i = 0; i < 200; i++) {
            const a = randomState(r)
            a.shown = a.zoom
            const y = cameraPos(a)[1]
            a.x += (r() - 0.5) * 80
            a.z += (r() - 0.5) * 80
            expect(Math.abs(cameraPos(a)[1] - y)).toBeLessThan(1e-9)
        }
    })

    it('turning around the pivot doesn\'t change it either', () => {
        const a = state()
        const y = cameraPos(a)[1]
        for (let i = 0; i < 20; i++) {
            a.heading += 0.4
            expect(Math.abs(cameraPos(a)[1] - y)).toBeLessThan(1e-9)
        }
    })
})

describe('re-anchoring the aerial pivot', () => {
    it('slides the pivot along the line of sight without moving the camera', () => {
        const r = rng(2)
        for (let i = 0; i < 200; i++) {
            const a = randomState(r)
            a.shown = a.zoom * (0.5 + r())
            const before = cameraPos(a)
            const gy = a.y + a.lift - r() * 30
            expect(reanchor(a, gy)).toBe(true)
            close(cameraPos(a), before)
            expect(Math.abs(a.y + a.lift - gy)).toBeLessThan(1e-9)
            // the pivot is on the line of sight
            expect(offRay([a.x, a.y + a.lift, a.z], before, viewDir(a.heading, a.pitch))).toBeLessThan(1e-9)
        }
    })

    it('keeps an ongoing zoom going (shown and zoom move together)', () => {
        const a = state({ zoom: 50, shown: 30 })
        reanchor(a, 0)
        expect(a.zoom - a.shown).toBeCloseTo(20, 9)
    })

    it('then turning keeps the anchored ground point in the middle of the screen, at the same height', () => {
        const a = state({ y: 20 })
        const g = 4
        reanchor(a, g)
        const ground = [a.x, a.y + a.lift, a.z]
        const y = cameraPos(a)[1]
        for (let i = 0; i < 10; i++) {
            a.heading += 0.7
            const eye = cameraPos(a)
            expect(Math.abs(eye[1] - y)).toBeLessThan(1e-9)
            expect(offRay(ground, eye, viewDir(a.heading, a.pitch))).toBeLessThan(1e-9)
        }
    })

    it('moves a click-pan target with it, so the pan still ends in the same place', () => {
        const a = state({ tx: 10, tz: 12 })
        const end = cameraPos({ ...a, x: a.tx, z: a.tz })
        reanchor(a, 1)
        close(cameraPos({ ...a, x: a.tx, z: a.tz }), end)
    })

    it('refuses a point behind the camera, and an almost level view', () => {
        const a = state()
        const before = { ...a }
        expect(reanchor(a, cameraPos(a)[1] + 1)).toBe(false)
        expect(a).toEqual(before)
        const flat = state({ pitch: 0.02 })
        expect(reanchor(flat, 0)).toBe(false)
    })
})

describe('click to pan at the same height', () => {
    for (const dy of [20, -20]) {
        it(`centres a block ${Math.abs(dy)} ${dy > 0 ? 'higher' : 'lower'} without the camera changing height`, () => {
            const a = state({ y: 30, zoom: 50, shown: 50 })
            const target = [a.x + 25, a.y + dy, a.z - 18]
            const y = cameraPos(a)[1]
            // as Control.aerialClick and the render loop do it
            expect(reanchor(a, target[1])).toBe(true)
            a.tx = target[0]
            a.tz = target[2]
            for (let f = 0; f < 240; f++) {
                a.x += (a.tx - a.x) * (5 / 60)
                a.z += (a.tz - a.z) * (5 / 60)
                expect(Math.abs(cameraPos(a)[1] - y)).toBeLessThan(0.01)
            }
            const eye = cameraPos(a)
            expect(offRay(target, eye, viewDir(a.heading, a.pitch))).toBeLessThan(0.01)
        })
    }
})

describe('aerial zoom limits', () => {
    it('stop the input at 12 and 70', () => {
        expect(zoomStep(38, 0.5)).toBe(19)
        expect(zoomStep(20, 0.5)).toBe(AERIAL.minZoom)
        expect(zoomStep(65, 1.12)).toBe(AERIAL.maxZoom)
    })

    it('never move the camera back in after a re-anchor left the zoom outside them', () => {
        expect(zoomStep(8, 0.89)).toBe(8)
        expect(zoomStep(8, 1.12)).toBeCloseTo(8.96, 9)
        expect(zoomStep(90, 1.12)).toBe(90)
        expect(zoomStep(90, 0.89)).toBeCloseTo(80.1, 9)
    })
})

describe('aerial panning at the world edge', () => {
    it('stops at the edge', () => {
        expect(panAxis(90, 10, 96)).toBe(96)
        expect(panAxis(-90, -10, 96)).toBe(-96)
        expect(panAxis(10, 5, 96)).toBe(15)
    })

    it('doesn\'t pull a pivot that is already outside back in, but lets you pan back', () => {
        expect(panAxis(120, 5, 96)).toBe(120)
        expect(panAxis(120, -5, 96)).toBe(115)
    })
})

describe('the direction through a point on the screen', () => {
    const fov = 0.8, aspect = 16 / 9
    it('is the view direction in the middle', () => {
        close(screenDir(0.6, 0.9, fov, aspect, 0, 0), viewDir(0.6, 0.9), 1e-12)
    })

    it('points higher at the top, and to the right on the right', () => {
        const mid = screenDir(0, 0.9, fov, aspect, 0, 0)
        expect(screenDir(0, 0.9, fov, aspect, 0, 1)[1]).toBeGreaterThan(mid[1])
        // heading 0 looks along +z; right is +x
        expect(screenDir(0, 0.9, fov, aspect, 1, 0)[0]).toBeGreaterThan(0.3)
    })

    it('reaches the edge of the view at the edge of the screen', () => {
        const top = screenDir(0, 0, fov, aspect, 0, 1)
        expect(Math.atan2(top[1], top[2])).toBeCloseTo(fov / 2, 9)
    })
})

describe('the aerial camera over hills', () => {
    const noBlocks = () => false

    it('keeps clear of the terrain around it', () => {
        const flat = terrainFloor(() => 8, [[0, 0]])
        expect(flat.floor).toBe(8 + AERIAL.clearTerrain)
        // a hill 4 blocks away counts
        const hill = terrainFloor((x) => (x >= 4 ? 30 : 8), [[0, 0]])
        expect(hill.ground).toBe(30)
        // and so does one around any of the points given
        expect(terrainFloor((x) => (x >= 15 ? 30 : 8), [[0, 0], [12, 0]]).ground).toBe(30)
    })

    it('looks ahead along the path the camera is on: straight when panning, round the circle when turning', () => {
        const a = state({ x: 0, z: 0, heading: 0 })
        const c = cameraPos(a)
        const pan = cameraAhead(a, { x: 10, z: 0, heading: 0, shown: 0 }, 0.5)
        expect(pan[0] - c[0]).toBeCloseTo(5, 9)
        expect(pan[2]).toBeCloseTo(c[2], 9)
        const turn = cameraAhead(a, { x: 0, z: 0, heading: 1.6, shown: 0 }, 0.5)
        expect(Math.hypot(turn[0], turn[2])).toBeCloseTo(Math.hypot(c[0], c[2]), 9)
        expect(turn[1]).toBeCloseTo(c[1], 9)
    })

    it('keeps clear of trees and buildings under it, only when near them', () => {
        // a trunk up to y 15 next to the camera's column
        const tree = (x, y, z) => x === 1 && z === 0 && y <= 15
        expect(blocksFloor(tree, 0.5, 0.5, 14, 8)).toBe(16 + AERIAL.clearBlocks)
        expect(blocksFloor(noBlocks, 0.5, 0.5, 14, 8)).toBe(-Infinity)
        expect(blocksFloor(tree, 0.5, 0.5, 8 + AERIAL.blocksBand + 1, 8)).toBe(-Infinity)
    })

    it('rises smoothly over a ridge it would fly into, and settles back after', () => {
        // camera flies +z at 34 blocks/s (the pan speed at zoom 38), about 41 up; a 60-high ridge from z 60 to 90
        const groundAt = (x, z) => (z >= 60 && z < 90 ? 60 : 8)
        const a = state({ x: 0, z: 0, y: 11, heading: 0, pitch: 0.9, zoom: 38, shown: 38 })
        const prev = motionFrom(a)
        const dt = 1 / 60
        let maxStep = 0, minClear = Infinity, lastLift = 0
        for (let f = 0; f < 60 * 8; f++) {
            if (f < 60 * 4) a.z += 34 * dt
            liftFrame(a, prev, groundAt, noBlocks, dt)
            maxStep = Math.max(maxStep, Math.abs(a.lift - lastLift))
            lastLift = a.lift
            const eye = cameraPos(a)
            minClear = Math.min(minClear, eye[1] - groundAt(Math.floor(eye[0]), Math.floor(eye[2])))
        }
        expect(maxStep).toBeLessThanOrEqual(AERIAL.maxLiftSpeed * dt + 1e-9)
        // never inside the ridge; it was 41 - 60 = 19 blocks too low without the lift
        expect(minClear).toBeGreaterThan(1)
        // well past it and stopped: back down
        expect(a.lift).toBeLessThan(0.01)
    })

    it('lifts straight up, so turning next to a hill still turns around the same spot', () => {
        // a hill west of the pivot that the camera passes over as it turns
        const groundAt = (x) => (x <= -15 ? 45 : 8)
        const a = state({ x: 0, z: 0, y: 9, heading: 0, pitch: 0.9, zoom: 38, shown: 38 })
        const prev = motionFrom(a)
        let maxLift = 0
        for (let f = 0; f < 60 * 4; f++) {
            a.heading += 1.6 / 60
            liftFrame(a, prev, groundAt, noBlocks, 1 / 60)
            maxLift = Math.max(maxLift, a.lift)
            expect(a.x).toBe(0)
            expect(a.z).toBe(0)
        }
        expect(maxLift).toBeGreaterThan(5)
    })

    it('turning inside a ring of hills it never flies over doesn\'t lift it', () => {
        // the camera circles about 23 blocks out; the hills start at 33 (out of its reach of 4, and of a
        // look-ahead along the tangent, which would have been 7 blocks outside the circle)
        const a = state({ x: 0, z: 0, y: 9, heading: 0, pitch: 0.9, zoom: 38, shown: 38 })
        const r = Math.hypot(cameraPos(a)[0], cameraPos(a)[2])
        const groundAt = (x, z) => (Math.hypot(x, z) > r + 10 ? 60 : 8)
        const prev = motionFrom(a)
        for (let f = 0; f < 60 * 4; f++) {
            a.heading += 1.6 / 60
            liftFrame(a, prev, groundAt, noBlocks, 1 / 60)
            expect(a.lift).toBe(0)
        }
    })

    it('doesn\'t move over ground below its height', () => {
        const a = state({ x: 0, z: 0, y: 11, heading: 0, pitch: 0.9 })
        const prev = motionFrom(a)
        for (let f = 0; f < 120; f++) {
            a.z += 0.5
            liftFrame(a, prev, (x, z) => 8 + Math.sin(z / 10) * 6, noBlocks, 1 / 60)
            expect(a.lift).toBe(0)
        }
    })
})

describe('smoothDamp', () => {
    it('gets there without overshooting or going faster than the cap', () => {
        let v = 0, x = 0
        for (let f = 0; f < 240; f++) {
            const next = smoothDamp(x, 10, v, 0.12, 40, 1 / 60)
            expect(next[0]).toBeLessThanOrEqual(10)
            expect(next[0] - x).toBeLessThanOrEqual(40 / 60 + 1e-9)
            x = next[0]
            v = next[1]
        }
        expect(x).toBeCloseTo(10, 6)
    })

    it('is stable on a long frame', () => {
        const [x] = smoothDamp(0, 10, 0, 0.12, 1000, 0.5)
        expect(x).toBeGreaterThan(0)
        expect(x).toBeLessThanOrEqual(10)
    })
})
