import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    AERIAL, FRAME, screenPoint, cameraPos, zoomStep, townShape, fitZoom, fitZoomAround, ringReach, groundFogRange, pinnedBox,
} from '../src/game/aerialCam.js'
import { BLOCK_BY_ID, blockId } from '../src/world/blocks.js'

const isBuilt = (id) => !!BLOCK_BY_ID[id]?.built
const FOV = 0.8
const LANDSCAPE = 16 / 9, PORTRAIT = 9 / 19.5

/** a world file's edits as VoxelOverlay.forEach would give them */
function worldEdits(file) {
    const def = JSON.parse(readFileSync(new URL(`../worlds/${file}.world.json`, import.meta.url), 'utf8'))
    const edits = def.edits.map(([x, y, z, b]) => [x, y, z, blockId(b)])
    return (fn) => edits.forEach(([x, y, z, id]) => fn(x, y, z, id))
}
const editsOf = (list) => (fn) => list.forEach(([x, y, z, b]) => fn(x, y, z, blockId(b)))

const palace = townShape(worldEdits('default'), isBuilt, [0, 8, 0])

/** where every point lands on screen with the camera `zoom` back from `pivot` */
function onScreen(points, pivot, heading, pitch, aspect, zoom) {
    const eye = cameraPos({ x: pivot[0], y: pivot[1], z: pivot[2], lift: 0, shown: zoom, heading, pitch })
    return points.map((p) => screenPoint(heading, pitch, FOV, aspect, eye, p))
}
const fits = (shots) => shots.every((q) => q.depth > 0 && Math.abs(q.nx) <= FRAME.fillWidth + 1e-9 && Math.abs(q.ny) <= FRAME.fillHeight + 1e-9)

describe("the town's shape", () => {
    it('is the Ice Palace in the default world', () => {
        expect(palace.min[0]).toBe(-29)
        expect(palace.max[0]).toBe(30)
        expect(palace.min[2]).toBe(-29)
        expect(palace.max[2]).toBe(30)
        // up to the top of the spire
        expect(palace.max[1]).toBe(65)
        expect(palace.blocks).toBeGreaterThan(6000)
        // the outer wall is a circle round it
        expect(palace.radius).toBeGreaterThan(29)
        expect(palace.radius).toBeLessThan(31)
    })

    it('leaves out trees, ore and earth, and anything far from the town center', () => {
        const shape = townShape(editsOf([
            ...Array.from({ length: 10 }, (_, i) => [i - 5, 8, 3, 'stone_wall']),
            [20, 8, 20, 'log'], [21, 13, 21, 'leaves'], [-20, 8, -20, 'iron_ore'], [0, 7, -15, 'dirt'],
            [90, 8, 0, 'cobble'],
            [2, 8, 2, 'air'],
        ]), isBuilt, [0, 8, 0])
        expect(shape.blocks).toBe(10)
        expect(shape.min).toEqual([-5, 7, 0])
        expect(shape.max).toEqual([5, 10, 4])
    })

    it("frames an empty town as the starter town's wall ring", () => {
        const shape = townShape(editsOf([[3, 8, 3, 'planks']]), isBuilt, [10, 8, -4])
        const r = FRAME.fallbackRadius
        expect(shape.min[0]).toBe(10 - r)
        expect(shape.max[2]).toBe(-4 + r + 1)
        expect(shape.center[0]).toBeCloseTo(10.5, 9)
    })
})

describe('the distance that fits the town on screen', () => {
    it('puts every point on screen, inside the fill, and no nearer would', () => {
        for (const [aspect, heading, pitch] of [[LANDSCAPE, 0, 1], [PORTRAIT, 0.7, 1], [LANDSCAPE, 2.4, 0.6], [4 / 3, 4, 1.3]]) {
            const zoom = fitZoom(palace.points, palace.center, heading, pitch, FOV, aspect)
            expect(fits(onScreen(palace.points, palace.center, heading, pitch, aspect, zoom))).toBe(true)
            expect(fits(onScreen(palace.points, palace.center, heading, pitch, aspect, zoom - 1))).toBe(false)
        }
    })

    it('needs more on a portrait phone than on a landscape screen', () => {
        const at = (aspect) => fitZoomAround(palace.points, palace.center, FRAME.pitch, FOV, aspect)
        expect(at(PORTRAIT)).toBeGreaterThan(at(LANDSCAPE) * 1.1)
    })

    it('is shorter looking at the middle of a tall town than at its foot', () => {
        const ground = [palace.center[0], 8, palace.center[2]]
        const mid = fitZoomAround(palace.points, palace.center, FRAME.pitch, FOV, LANDSCAPE)
        expect(mid).toBeLessThan(fitZoomAround(palace.points, ground, FRAME.pitch, FOV, LANDSCAPE) * 0.85)
    })

    it('for a turning view, covers every heading', () => {
        const around = fitZoomAround(palace.points, palace.center, FRAME.pitch, FOV, LANDSCAPE)
        for (let h = 0; h < Math.PI * 2; h += 0.3) {
            expect(fitZoom(palace.points, palace.center, h, FRAME.pitch, FOV, LANDSCAPE)).toBeLessThan(around * 1.05)
        }
    })

    it('needs far more than the old aerial limit for the palace', () => {
        // the old framings were 34 to 58 blocks back, and zoom stopped at 70
        expect(fitZoomAround(palace.points, palace.center, FRAME.pitch, FOV, LANDSCAPE)).toBeGreaterThan(AERIAL.maxZoom * 1.5)
    })
})

describe('the zoom-out limit', () => {
    it('can be raised past AERIAL.maxZoom', () => {
        expect(zoomStep(150, 1.12, 160)).toBe(160)
        expect(zoomStep(65, 1.12, 160)).toBeCloseTo(72.8, 9)
        expect(zoomStep(65, 1.12)).toBe(AERIAL.maxZoom)
    })
})

describe('keeping the town loaded', () => {
    const size = 24
    it("pins every chunk with a block of the palace in it, from the ground and from above", () => {
        for (const margin of [8, AERIAL.townMargin]) {
            const { chunks } = pinnedBox(palace, margin, size)
            for (const p of palace.points) {
                // the corner points are block corners: the block they belong to is just inside
                const x = Math.min(p[0], palace.max[0] - 1), y = Math.min(p[1], palace.max[1] - 1), z = Math.min(p[2], palace.max[2] - 1)
                const c = [Math.floor(x / size), Math.floor(y / size), Math.floor(z / size)]
                for (let i = 0; i < 3; i++) {
                    expect(c[i]).toBeGreaterThanOrEqual(chunks.min[i])
                    expect(c[i]).toBeLessThanOrEqual(chunks.max[i])
                }
            }
        }
    })

    it('pins the top of the spire, which the low and medium tiers never loaded from the ground', () => {
        // the spire's row of chunks, 2 above the ground's: past the low/med vertical reach of 1.5
        expect(pinnedBox(palace, 8, size).chunks.max[1]).toBe(2)
    })

    it('leaves the land round the town in the box, from above', () => {
        const { blocks } = pinnedBox(palace, AERIAL.townMargin, size)
        expect(palace.min[0] - blocks.min[0]).toBeGreaterThanOrEqual(AERIAL.townMargin)
        expect(blocks.max[2] - palace.max[2]).toBeGreaterThanOrEqual(AERIAL.townMargin)
    })
})

describe('the ground fog', () => {
    const size = 24
    it("ends where noa's loading is sure to have land, wherever the target is in its chunk", () => {
        const r = [2, 2.5, 3, 3.5].map((reach) => ringReach(reach, size))
        expect(r[0]).toBeCloseTo(24, 0)
        expect(r).toEqual([...r].sort((a, b) => a - b))
        // random points within the reach of random targets are in loaded chunks
        let seed = 7
        const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
        for (const reach of [2, 2.5, 3.5]) {
            const sure = ringReach(reach, size)
            for (let n = 0; n < 2000; n++) {
                const t = [rnd() * 200 - 100, rnd() * 200 - 100]
                const a = rnd() * Math.PI * 2, d = rnd() * sure
                const p = [t[0] + Math.cos(a) * d, t[1] + Math.sin(a) * d]
                const i = Math.floor(p[0] / size) - Math.floor(t[0] / size), k = Math.floor(p[1] / size) - Math.floor(t[1] / size)
                expect(i * i + k * k).toBeLessThanOrEqual(reach * reach)
            }
        }
    })

    it('over the town: clear past the whole palace, gone before the pinned land ends', () => {
        const { blocks } = pinnedBox(palace, AERIAL.townMargin, size)
        const [start, end] = groundFogRange([palace.center[0], palace.center[2]], blocks, ringReach(3, size), palace)
        expect(start).toBeGreaterThanOrEqual(palace.radius)
        expect(end).toBeLessThanOrEqual(Math.min(palace.center[0] - blocks.min[0], blocks.max[0] - palace.center[0]))
        expect(end - start).toBeGreaterThanOrEqual(AERIAL.fogBand[0])
    })

    it('away from the town: within what loads round the camera anyway', () => {
        const ring = ringReach(3, size)
        const { blocks } = pinnedBox(palace, AERIAL.townMargin, size)
        const [start, end] = groundFogRange([110, -100], blocks, ring, palace)
        expect(end).toBe(ring)
        expect(end - start).toBeLessThanOrEqual(AERIAL.fogBand[1])
        expect(end - start).toBeGreaterThanOrEqual(AERIAL.fogBand[0])
    })
})
