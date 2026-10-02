import { describe, it, expect } from 'vitest'
import { classify, solveSpeeds, segments, viewShare, shortTitle } from '../tools/autoplay/edit.mjs'
import { pickCheckpoint, cutParts } from '../tools/autoplay/long-run.mjs'
import { readonly, violations } from '../tools/autoplay/bot/readonly.js'
import { findPath, stepCells } from '../tools/autoplay/bot/nav.js'
import { B, blockId } from '../src/world/blocks.js'

describe('autoplay: the read-only view', () => {
    class Thing {
        constructor() {
            this.hp = 10
            this.list = [{ a: 1 }, { a: 2 }]
            this.map = new Map([['k', { v: 3 }]])
        }
        getBlock(x) {
            return x * 2
        }
        heal() {
            this.hp = 100
        }
        get double() {
            return this.hp * 2
        }
    }

    it('reads, and calls methods that only read', () => {
        const t = readonly(new Thing())
        expect(t.hp).toBe(10)
        expect(t.double).toBe(20)
        expect(t.getBlock(4)).toBe(8)
        expect(t.list.map((x) => x.a)).toEqual([1, 2])
        expect([...t.list].length).toBe(2)
        expect(t.map.get('k').v).toBe(3)
        expect([...t.map.values()][0].v).toBe(3)
        expect(t.map.size).toBe(1)
    })

    it('refuses to change anything, however deep', () => {
        const raw = new Thing()
        const t = readonly(raw)
        const before = violations.count
        expect(() => (t.hp = 0)).toThrow()
        expect(() => t.heal()).toThrow()
        expect(() => (t.list[0].a = 5)).toThrow()
        expect(() => t.list.push(1)).toThrow()
        expect(() => t.map.get('k').v++).toThrow()
        expect(() => delete t.hp).toThrow()
        expect(raw.hp).toBe(10)
        expect(raw.list[0].a).toBe(1)
        expect(raw.map.get('k').v).toBe(3)
        expect(violations.count - before).toBe(6)
    })
})

describe('autoplay: path finding', () => {
    const WALL = blockId('stone_wall')
    /** a small world: stone below y = 0, grass at y = 0, and whatever `extra` adds */
    const world = (extra = {}) => (x, y, z) => {
        const k = `${x},${y},${z}`
        if (k in extra) return extra[k]
        if (y < 0) return B.stone
        if (y === 0) return B.grass
        return 0
    }
    const at = (p) => (x, y, z) => x === p[0] && y === p[1] && z === p[2]

    it('walks across open ground', () => {
        const path = findPath({ getBlock: world(), start: [0, 1, 0], isGoal: at([6, 1, 3]), toward: [6, 1, 3] })
        expect(path).not.toBeNull()
        expect(path[path.length - 1]).toMatchObject({ x: 6, y: 1, z: 3 })
        expect(path.every((s) => s.dig.length === 0)).toBe(true)
    })

    it('goes round a built wall and never digs it', () => {
        const extra = {}
        for (let z = -6; z <= 6; z++) for (const y of [1, 2]) extra[`3,${y},${z}`] = WALL
        const path = findPath({ getBlock: world(extra), start: [0, 1, 0], isGoal: at([6, 1, 0]), toward: [6, 1, 0] })
        expect(path).not.toBeNull()
        expect(path.some((s) => s.x === 3 && Math.abs(s.z) <= 6)).toBe(false)
        expect(path.every((s) => s.dig.every(([x, , z]) => !(x === 3 && Math.abs(z) <= 6)))).toBe(true)
    })

    it('digs a staircase down to a block underground, and not without digging', () => {
        const goal = [4, -4, 0]
        const isGoal = (x, y, z) => Math.abs(x - goal[0]) <= 1 && y === goal[1] + 1 && z === goal[2]
        const path = findPath({ getBlock: world(), start: [0, 1, 0], isGoal, toward: goal })
        expect(path).not.toBeNull()
        const dug = path.flatMap((s) => s.dig)
        expect(dug.length).toBeGreaterThan(4)
        // each step down is at most one block
        let y = 1
        for (const s of path) {
            expect(Math.abs(s.y - y)).toBeLessThanOrEqual(1)
            y = s.y
        }
        expect(findPath({ getBlock: world(), start: [0, 1, 0], isGoal, toward: goal, dig: false, maxNodes: 3000 })).toBeNull()
    })

    it('steps off a wall top of any height when it may (maxDrop), and not past 2 otherwise', () => {
        // standing on a pillar six high (the ground is walked on at y = 1), the goal on the ground beside it
        const extra = {}
        for (let y = 1; y < 7; y++) extra[`0,${y},0`] = WALL
        const o = { getBlock: world(extra), start: [0, 7, 0], isGoal: (x, y, z) => x === 3 && y === 1 && z === 0, toward: [3, 1, 0], dig: false, maxNodes: 2000 }
        expect(findPath(o)).toBe(null)
        const path = findPath({ ...o, maxDrop: 16 })
        expect(path).toBeTruthy()
        expect(path[0]).toMatchObject({ kind: 'drop', y: 1 })
    })

    it('lists what a step needs open, top first', () => {
        expect(stepCells([0, 1, 0], { x: 1, y: 2, z: 0, kind: 'up', dig: [] })).toEqual([[0, 3, 0], [1, 3, 0], [1, 2, 0]])
        expect(stepCells([0, 1, 0], { x: 1, y: 0, z: 0, kind: 'down', dig: [] })).toEqual([[1, 2, 0], [1, 1, 0], [1, 0, 0]])
    })
})

describe('the 30-minute cut (edit.mjs)', () => {
    // an hour: a day of mining with a build in the middle, then a night
    const tele = []
    for (let t = 0; t < 3600; t++) {
        const night = t >= 3000
        tele.push({ t, phase: night ? 'night' : 'day', day: 1, level: 1, attackers: night && t > 3010 ? (t === 3300 ? 40 : 10) : 0,
            activity: night ? 'night' : t >= 1000 && t < 1400 ? 'building:Palas' : 'mining' })
    }
    const events = [{ t: 1000, type: 'bot', what: 'chapter', title: 'building: Palas', day: 1, part: 'Palas' },
        { t: 1200, type: 'bot', what: 'placed', item: 'arrow_tower' }]
    const { cls, captions } = classify(tele, events, 3600)
    it('keeps the key moments at 1×: the start, a new part, a tower, the night coming, its peak, the end', () => {
        for (const t of [5, 1003, 1201, 3015, 3300, 3590]) expect(cls[t], `second ${t}`).toBe('key')
        expect(cls[500]).toBe('boring')
        expect(cls[1300]).toBe('build')
        expect(cls[3100]).toBe('night')
        expect(captions.map((c) => c.text)).toEqual(['Day 1 · Palas', 'Night 1'])
    })
    it('solves the speeds so the cut comes out at the target', () => {
        const speeds = solveSpeeds(cls, 600)
        expect(speeds.key).toBe(1)
        expect(speeds.boring).toBeGreaterThan(speeds.build)
        const segs = segments(cls, speeds)
        const length = segs.reduce((a, s) => a + (s.end - s.start) / s.speed, 0)
        expect(Math.abs(length - 600)).toBeLessThan(60)
        // every source second is in exactly one segment, in order
        expect(segs[0].start).toBe(0)
        for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBe(segs[i - 1].end)
        expect(segs[segs.length - 1].end).toBe(3600)
    })
    it('folds sped-up stretches too short to read into a sped-up neighbour, never into a 1× moment', () => {
        const segs = segments(['boring', 'boring', 'key', 'key', 'key', 'boring', 'build', 'build', 'build', 'build'], { key: 1, boring: 10, build: 2 }, 1.5)
        // the two seconds before the moment (0.2 s at 10×) are cut out; the one after it goes into the building
        expect(segs.map((s) => [s.start, s.end, s.cls])).toEqual([[0, 2, 'skip'], [2, 5, 'key'], [5, 10, 'build']])
        // 30 s of mining between two moments: 3 s at 10×, kept as it is, and the moments stay 5 s each
        const cls = [...Array(5).fill('key'), ...Array(30).fill('boring'), ...Array(5).fill('key')]
        expect(segments(cls, { key: 1, boring: 10 }, 5).map((s) => [s.start, s.end, s.cls])).toEqual([[0, 5, 'key'], [5, 35, 'boring'], [35, 40, 'key']])
    })
    it('a caption names two parts of a building trip at most', () => {
        expect(shortTitle('the staircase · first person')).toBe('the staircase · first person')
        expect(shortTitle('level 2, the roof · from above')).toBe('level 2, the roof · from above')
        expect(shortTitle('the great spire, crystal spires, level 1, the floor · from above')).toBe('the great spire, crystal spires and more · from above')
        expect(shortTitle('home for the night')).toBe('home for the night')
    })
    it('a game too long for the speed limits: the ceilings go up until it fits', () => {
        const long = [...Array(600).fill('key'), ...Array(100000).fill('boring'), ...Array(20000).fill('build')]
        const speeds = solveSpeeds(long, 1800)
        const length = 600 + 100000 / speeds.boring + 20000 / speeds.build
        expect(speeds.boring).toBeGreaterThan(80)
        expect(Math.abs(length - 1800)).toBeLessThan(60)
    })
    it('joins resumed recordings: each part shown once, the end only at the end, a lost night said', () => {
        const parts = new Set()
        const first = classify(tele, events, 3600, { last: false, parts })
        // the one before a resume ends at a checkpoint: no 1× ending there
        expect(first.cls[3590]).toBe('night')
        // the same part again in the next recording: not shown again, no caption
        const lost = [...events, { t: 3500, type: 'nightOver', result: 'lost', level: 1, lives: 2 }]
        const next = classify(tele, lost, 3600, { from: 30, first: false, parts })
        expect(next.cls[1003]).toBe('build')
        expect(next.cls[10]).toBe('skip')
        expect(next.cls[3590]).toBe('key')
        expect(next.captions.map((c) => c.text)).toEqual(['Day 1', 'Night 1', 'Night 1 lost · 2 lives left'])
    })
    it('the palace: on-foot placing is building, and building time is told by view (plan 12 §6.10)', () => {
        // 100 s placing on foot in first person, then 200 s building from above
        const pt = []
        for (let t = 0; t < 400; t++) pt.push({ t, phase: 'day', day: 2, level: 0, attackers: 0, activity: t < 100 ? 'placing' : t < 300 ? 'building:the roof' : 'mining' })
        const ev = [{ t: 0, type: 'bot', what: 'chapter', title: 'level 1 · first person', day: 2, part: 'level 1', view: 'first' },
            { t: 100, type: 'bot', what: 'chapter', title: 'the roof · from above', day: 2, part: 'the roof', view: 'aerial' }]
        const c = classify(pt, ev, 400, { first: false, last: false })
        // (first-person building is a class of its own: it plays slower than the rest)
        expect(c.cls[50]).toBe('build1')
        expect(c.cls[150]).toBe('build')
        expect(c.cls[350]).toBe('boring')
        expect(c.views[50]).toBe('first')
        expect(c.views[150]).toBe('aerial')
        expect(c.captions.map((x) => x.text)).toEqual(['Day 2 · level 1 · first person', 'Day 2 · the roof · from above'])
        const share = viewShare(segments(c.cls, { key: 1, build: 10, build1: 10, boring: 50 }), c.views, c.cls, [{ offset: 0 }])
        // (10 s at 1× for each new part, the rest at 10×)
        expect(share.first).toBeCloseTo(10 + 90 / 10, 0)
        expect(share.aerial).toBeCloseTo(10 + 190 / 10, 0)
    })
})

describe('a long run in parts (long-run.mjs)', () => {
    // part 1: a new game, to day 3. Part 2 continued from day 3 and died before a dawn. Part 3
    // never started. Part 4 continued from part 2's own day-3 checkpoint and played on to day 5
    const parts = [
        { dir: 'part-01', resumedDay: null, playable: 4, end: 2000, checkpoints: [{ day: 1, wall: 60 }, { day: 2, wall: 700 }, { day: 3, wall: 1300 }] },
        { dir: 'part-02', resumedDay: 3, playable: 5, end: 300, checkpoints: [{ day: 3, wall: 5.4 }] },
        { dir: 'part-03', resumedDay: null, playable: null, end: 0, checkpoints: [] },
        { dir: 'part-04', resumedDay: 3, playable: 5, end: 1500, checkpoints: [{ day: 3, wall: 5.3 }, { day: 4, wall: 600 }, { day: 5, wall: 1200 }] },
    ]
    it('continues from the last dawn of the newest part that has a checkpoint', () => {
        expect(pickCheckpoint([])).toBe(null)
        expect(pickCheckpoint(parts.slice(0, 1))).toEqual({ dir: 'part-01', day: 3 })
        expect(pickCheckpoint(parts.slice(0, 3))).toEqual({ dir: 'part-02', day: 3 })
        expect(pickCheckpoint(parts)).toEqual({ dir: 'part-04', day: 5 })
    })
    it('ends each part where the next one took over, and leaves out a part that was played again whole', () => {
        const cuts = cutParts(parts)
        expect(cuts.map((c) => c.kept)).toEqual([true, false, false, true])
        // part 1 ends at its day-3 checkpoint: what it played after that, part 4 played again
        expect(cuts[0]).toMatchObject({ from: 4, to: 1300 })
        // the last part runs to its end
        expect(cuts[3]).toMatchObject({ from: 5, to: 1500 })
    })
    it('the cut: a part\'s log past where the next one took over is left out, and a first moment is shown once', () => {
        const tele = []
        for (let t = 0; t < 600; t++) tele.push({ t, phase: t >= 500 ? 'night' : 'day', day: 3, level: 3, attackers: t > 510 ? 5 : 0, activity: t >= 500 ? 'night' : 'mining' })
        const events = [{ t: 100, type: 'bot', what: 'milestone', name: 'flights', caption: 'The two flights meet', len: 8 }, { t: 520, type: 'cast', level: 3 }]
        const shown = new Set()
        // cut at 400: the night after it isn't in this part
        const a = classify(tele, events, 400, { last: false, shown })
        expect(a.cls).toHaveLength(400)
        expect(a.cls[399]).toBe('boring')
        expect(a.captions.map((c) => c.text)).toEqual(['The two flights meet'])
        // the part that took over: the milestone isn't shown again, the first fire mage is
        const b = classify(tele, events, 600, { from: 10, first: false, shown })
        expect(b.cls[102]).toBe('boring')
        expect(b.captions.map((c) => c.text)).toEqual(['Day 3', 'Night 3', 'Night 3 · the first fire mage'])
    })
})
