// Playing in a room (plan p3p2): the parts of it that are plain logic. A cycle that follows
// another page's game, and the SyncService that sends ops through a room's log.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { pack } from '@p3p2/client/pack'
import { DayCycle } from '../src/game/cycle.js'
import { RoomSync, ownThings, fits, newcomerSpot } from '../src/net/room.js'
import { nextAct, readHero, heroSound, heroShotSound, HERO_ACTIONS } from '../src/net/replica.js'
import { parseWorld, serializeSave } from '../src/world/worldFile.js'
import { STARTING_INVENTORY } from '../src/game/balance.js'
import { moreGames, roomsLine, MAIZE, P3P2_SITE } from '../src/ui/fork.js'
import { SHIRTS, pickShirt, recolorShirt, rgbOf } from '../src/characters/shirt.js'

const fresh = () => new DayCycle({ mode: 'survival', day: 3, nightLevel: 4, lives: 3 })

describe('a cycle that follows another page', () => {
    it('never changes phase by itself, however long it waits', () => {
        const c = fresh()
        c.follower = true
        c.update(1e6, { damageRemaining: 0 })
        expect(c.phase).toBe('day')
        // a cycle that leads would have started the night long ago
        const lead = fresh()
        lead.update(1e6, { damageRemaining: 0 })
        expect(lead.phase).toBe('dusk')
    })

    it('goes through the phases it is told, and everything that listens hears them', () => {
        const lead = fresh(), c = fresh()
        c.follower = true
        const heard = []
        c.on('phase', (p) => heard.push(p))
        c.on('nightOver', (result, level) => heard.push(`over:${result}:${level}`))

        lead.startNight()
        c.follow(lead.state)
        lead.update(1e6, { damageRemaining: 0 })
        c.follow(lead.state)
        lead.endNight('survived')
        c.follow(lead.state)
        lead.update(1e6, { damageRemaining: 0 })
        c.follow(lead.state)

        expect(heard).toEqual(['dusk', 'night', 'over:survived:4', 'dawn', 'day'])
        expect([c.day, c.nightLevel, c.lives, c.phase]).toEqual([lead.day, lead.nightLevel, lead.lives, 'day'])
        expect([c.day, c.nightLevel]).toEqual([4, 5])
    })

    it('a lost night costs a life there too, and the last one ends the game', () => {
        const lead = new DayCycle({ mode: 'survival', day: 1, nightLevel: 2, lives: 1 }), c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 2, lives: 1 })
        c.follower = true
        lead.startNight()
        lead.update(1e6, { damageRemaining: 0 })
        c.follow(lead.state)
        lead.endNight('lost')
        c.follow(lead.state)
        expect([c.phase, c.lives, c.over, c.nightsLost]).toEqual(['over', 0, true, 1])
    })

    it('a page that walks into the middle of a night is put there, with the leading page\'s numbers', () => {
        const lead = fresh(), c = new DayCycle({ mode: 'survival', day: 1, nightLevel: 1, lives: 3 })
        c.follower = true
        lead.startNight()
        lead.update(1e6, { damageRemaining: 0 })
        lead.update(42, { damageRemaining: 0 })
        c.follow(lead.state)
        expect([c.phase, c.activeLevel, c.day, c.nightLevel]).toEqual(['night', 4, 3, 4])
        expect(c.t).toBeCloseTo(lead.t, 1)
    })
})

/** a room's log, as far as RoomSync uses it: what was submitted, and a way to refuse */
function fakeRoom() {
    const room = { isHost: true, sent: [], up: true, log: { submit: (op) => (room.up ? (room.sent.push(op), true) : false) } }
    return room
}

describe('RoomSync', () => {
    it('alone, an op comes straight back, numbered', () => {
        const sync = new RoomSync(), got = []
        sync.onOp((env) => got.push([env.seq, env.op.t]))
        sync.submit({ t: 'block' })
        sync.submit({ t: 'unit+' })
        expect(got).toEqual([[1, 'block'], [2, 'unit+']])
        expect(sync.isHost()).toBe(true)
    })

    it('ops that arrive before the game listens wait for it, in order', () => {
        const sync = new RoomSync(), got = []
        sync.take({ t: 'block', x: 1 })
        sync.take({ t: 'many', ops: [{ t: 'block', x: 2 }, { t: 'block', x: 3 }] })
        sync.onOp((env) => got.push(env.op.x))
        sync.take({ t: 'block', x: 4 })
        expect(got).toEqual([1, 2, 3, 4])
    })

    it('in a room nothing is applied until it comes back, and what is submitted in one go is one op', async () => {
        const sync = new RoomSync(), room = fakeRoom(), got = []
        sync.onOp((env) => got.push(env.op.x))
        sync.room = room
        sync.submit({ t: 'block', x: 1 })
        sync.submit({ t: 'block', x: 2 })
        sync.submit({ t: 'block', x: 3 })
        expect(got).toEqual([])
        await Promise.resolve()
        expect(room.sent).toEqual([{ t: 'many', ops: [{ t: 'block', x: 1 }, { t: 'block', x: 2 }, { t: 'block', x: 3 }] }])
        // one by itself is sent as it is
        sync.submit({ t: 'block', x: 4 })
        await Promise.resolve()
        expect(room.sent[1]).toEqual({ t: 'block', x: 4 })
        // and the room's log is what applies them
        for (const op of room.sent) sync.take(op)
        expect(got).toEqual([1, 2, 3, 4])
        room.isHost = false
        expect(sync.isHost()).toBe(false)
    })

    it('what could not be sent waits, and goes when the room can be reached again', async () => {
        const sync = new RoomSync(), room = fakeRoom()
        sync.room = room
        room.up = false
        sync.submit({ t: 'block', x: 1 })
        await Promise.resolve()
        sync.submit({ t: 'block', x: 2 })
        await Promise.resolve()
        expect(room.sent).toEqual([])
        room.up = true
        sync.flush()
        expect(room.sent).toEqual([{ t: 'many', ops: [{ t: 'block', x: 1 }, { t: 'block', x: 2 }] }])
    })

    it('while a world is being handed to a room, what is built waits for the room', async () => {
        const sync = new RoomSync(), room = fakeRoom(), got = []
        sync.onOp((env) => got.push(env.op.x))
        sync.holding = true
        sync.submit({ t: 'block', x: 1 })
        await Promise.resolve()
        expect(got).toEqual([])
        sync.room = room
        sync.holding = false
        sync.flush()
        expect(room.sent).toEqual([{ t: 'block', x: 1 }])
    })
})

describe('RoomSync, a world that never reached the room (plan 15 §3.2)', () => {
    it('what was held while it was being offered is this page\'s alone again, in order', async () => {
        const sync = new RoomSync(), got = []
        sync.onOp((env) => got.push(env.op.x))
        sync.holding = true
        sync.submit({ t: 'block', x: 1 })
        sync.submit({ t: 'block', x: 2 })
        await Promise.resolve()
        expect(got).toEqual([])
        sync.release()
        expect(got).toEqual([1, 2])
        // and from then on, alone as before
        sync.submit({ t: 'block', x: 3 })
        expect(got).toEqual([1, 2, 3])
    })
})

describe('a world has to fit one message (plan 15 §0.4)', () => {
    it('fits the frame with room for the envelope, and anywhere a server sets no limit', () => {
        expect(fits('x'.repeat(40 * 1024), 64 * 1024)).toBe(true)
        expect(fits('x'.repeat(64 * 1024), 64 * 1024)).toBe(false)
        expect(fits('x'.repeat(1e6), Infinity)).toBe(true)
    })

    it('every world the game ships can be brought into a room on a server with default settings', async () => {
        const dir = new URL('../worlds/', import.meta.url)
        const files = readdirSync(dir).filter((f) => f.endsWith('.world.json'))
        expect(files.length).toBeGreaterThan(0)
        for (const f of files) {
            const def = parseWorld(readFileSync(new URL(f, dir), 'utf8'), { as: 'world' })
            const packed = await pack(serializeSave({ ...def, player: { pos: null, inventory: {} } }))
            expect(fits(packed, 64 * 1024), `${f}: ${packed.length} bytes packed`).toBe(true)
        }
    })
})

describe('what the room keeps of each player (plan 15 §3.1)', () => {
    it('where they stood, what they carried and their hotbar come back as they were', () => {
        const hotbar = ['pickaxe', null, 'cobble', 'wood_sword', null, null, null, null, null]
        const mine = ownThings({ pos: [1, 8, 2], inventory: { cobble: 3 }, hotbar }, {})
        expect(mine).toEqual({ pos: [1, 8, 2], inventory: { cobble: 3 }, hotbar })
    })

    it('somebody new starts with the world\'s kit, nowhere in particular, with no hotbar of their own', () => {
        expect(ownThings(undefined, { cobble: 5 })).toEqual({ pos: null, inventory: { cobble: 5 } })
        expect(ownThings(null, {}).inventory).toEqual(STARTING_INVENTORY)
    })

    it('is somebody else\'s data: what isn\'t the shape it should be is left out', () => {
        const odd = ownThings({ pos: [1, 'x', 2], inventory: [1, 2], hotbar: ['pickaxe', 3, {}, ...Array(6).fill(null)] }, {})
        expect(odd.pos).toBe(null)
        expect(odd.inventory).toEqual(STARTING_INVENTORY)
        expect(odd.hotbar).toEqual(['pickaxe', null, null, ...Array(6).fill(null)])
        expect(ownThings({ hotbar: Array(20).fill('cobble') }, {}).hotbar).toBeUndefined()
    })

    it('somebody new stands beside the others: a place each, near where a game alone starts', () => {
        const tc = [10, 8, -4]
        expect(newcomerSpot(tc, 0)).toEqual([10.5, 8, 1.5])
        const spots = Array.from({ length: 12 }, (_, n) => newcomerSpot(tc, n))
        for (let i = 0; i < spots.length; i++) {
            expect(Math.hypot(spots[i][0] - 10.5, spots[i][2] - 1.5)).toBeLessThan(5)
            for (let j = 0; j < i; j++) expect(Math.hypot(spots[i][0] - spots[j][0], spots[i][2] - spots[j][2])).toBeGreaterThan(1)
        }
        // whoever has been coming for weeks (a high order) still stands near
        expect(Math.hypot(newcomerSpot(tc, 1000)[0] - 10.5, newcomerSpot(tc, 1000)[2] - 1.5)).toBeLessThan(5)
    })
})

describe('a builder, as its player\'s presence says (plan 15 §3.2)', () => {
    it('counts actions, so that the same one twice running is two', () => {
        const attack = HERO_ACTIONS.indexOf('attack')
        const a = nextAct(0, attack), b = nextAct(a, attack)
        expect(a & 7).toBe(attack)
        expect(b & 7).toBe(attack)
        expect(b).not.toBe(a)
        // it goes round, and stays a byte
        let n = 0
        for (let i = 0; i < 40; i++) n = nextAct(n, attack)
        expect(n).toBeLessThan(256)
        expect(HERO_ACTIONS.length).toBeLessThanOrEqual(8)
    })

    it('reads what a presence holds, and nothing that isn\'t that', () => {
        const h = readHero([1, 8, 2, 0.5, 3, 1, 'block', [1, 0.5, 0.5], 'cobble', 17, 1.2, 'cobble'])
        expect(h).toEqual({ pos: [1, 8, 2], yaw: 0.5, speed: 3, alive: true, item: 'block', tint: [1, 0.5, 0.5], tile: 'cobble', act: 17, actSpeed: 1.2, name: 'cobble', shirt: 0 })
        expect(readHero(null)).toBe(null)
        expect(readHero([1, 2, 'x', 0, 0, 1])).toBe(null)
        expect(readHero({ x: 1 })).toBe(null)
        // an older page's presence, without the newer fields
        const old = readHero([1, 8, 2, 0, 0, 0, 'wood_sword', null])
        expect([old.alive, old.item, old.act, old.actSpeed, old.tile]).toEqual([false, 'wood_sword', 0, 1, null])
        expect(readHero([0, 0, 0, 0, 0, 1, 'x'.repeat(500), 'not a tint', 7, 1.5, 99, 2]).item.length).toBe(32)
        expect(readHero([0, 0, 0, 0, 0, 1, '', [1, 'a'], '', 0, 50, '']).tint).toBe(null)
        expect(readHero([0, 0, 0, 0, 0, 1, '', null, '', 0, 50, '']).actSpeed).toBe(1)
    })

    it('a friend\'s swing, draw and placing sound as they would from your own hands', () => {
        expect(heroSound('attack', 'iron_sword')).toBe('swing_iron')
        expect(heroSound('attack_fist', 'none')).toBe('swing_wood')
        expect(heroSound('shoot_draw', 'war_bow')).toBe('bow_draw_3')
        expect(heroSound('place', 'cobble')).toMatch(/^place_/)
        // a chop's sound needs the block under it, which only its own page knows
        expect(heroSound('mine', 'pickaxe')).toBe(null)
        expect(heroSound('hit', null)).toBe(null)
    })

    it('a friend\'s shot leaves with its string, or its bang', () => {
        expect(heroShotSound('arrow', 'recurve_bow')).toBe('string_2')
        expect(heroShotSound('ice_arrow', 'frost_bow')).toBe('string_ice')
        expect(heroShotSound('bullet', 'musket')).toBe('musket')
        expect(heroShotSound('arrow', null)).toBe('string_1')
    })
})

describe('shirts (plan 16 §3)', () => {
    const at = (order, shirt) => ({ order, shirt })

    it('the host wears the builder\'s own blue, and those who come after the first colours nobody wears', () => {
        expect(SHIRTS[0]).toBe('#3d8fd6')
        expect(new Set(SHIRTS).size).toBe(8)
        expect(pickShirt(null, 0, [])).toBe(0)
        expect(pickShirt(null, 1, [at(0, 0)])).toBe(1)
        expect(pickShirt(undefined, 5, [at(0, 0), at(2, 1), at(3, 3)])).toBe(2)
    })

    it('a colour the room kept for you is yours again, unless somebody who came before you wears it', () => {
        expect(pickShirt(4, 3, [at(0, 0), at(1, 1)])).toBe(4)
        // somebody who joined after you gives it up to you
        expect(pickShirt(4, 3, [at(0, 0), at(7, 4)])).toBe(4)
        expect(pickShirt(7, 9, [at(0, 7), at(4, 1)])).toBe(0)
        expect(pickShirt(7, 9, [at(0, 7), at(4, 0)])).toBe(1)
        // somebody else's data
        expect(pickShirt(42, 1, [at(0, 0)])).toBe(1)
        expect(pickShirt(-1, 1, [])).toBe(0)
    })

    it('a clash settles in one round, the same on every page: the first to join keeps it', () => {
        // two who came at once, both in pink
        const a = pickShirt(2, 4, [at(0, 0), at(5, 2)])
        const b = pickShirt(2, 5, [at(0, 0), at(4, 2)])
        expect(a).toBe(2)
        expect(b).toBe(1)
        expect(pickShirt(b, 5, [at(0, 0), at(4, a)])).toBe(b)
    })

    it('a ninth player shares a colour with somebody who came after them, or by their order', () => {
        const eight = SHIRTS.map((_, i) => at(i, i))
        expect(pickShirt(null, 8, eight)).toBe(0)
        expect(pickShirt(null, 3, eight.filter((o) => o.order !== 3).map((o) => ({ ...o, order: o.order + 10 })).concat([at(0, 3)]))).toBe(0)
    })

    it('kept by the room with your other things, and only if it is one of the colours', () => {
        expect(ownThings({ pos: [1, 8, 2], inventory: { cobble: 3 }, shirt: 5 }, {}).shirt).toBe(5)
        expect(ownThings({ shirt: 8 }, {}).shirt).toBeUndefined()
        expect(ownThings({ shirt: '2' }, {}).shirt).toBeUndefined()
        expect(ownThings({ shirt: 1.5 }, {}).shirt).toBeUndefined()
    })

    it('says what it wears in its presence; a presence without one (or a wrong one) is the blue', () => {
        expect(readHero([1, 8, 2, 0, 0, 1, '', null, '', 0, 1, '', 3]).shirt).toBe(3)
        expect(readHero([1, 8, 2, 0, 0, 1, '', null, '', 0, 1, '']).shirt).toBe(0)
        expect(readHero([1, 8, 2, 0, 0, 1, '', null, '', 0, 1, '', 99]).shirt).toBe(0)
        expect(readHero([1, 8, 2, 0, 0, 1, '', null, '', 0, 1, '', 'pink']).shirt).toBe(0)
    })

    it('repaints the shirt\'s blue in each pixel\'s own shade, and nothing else', () => {
        // the blue, a lighter and a darker pixel of it, skin, an eye, the trousers, the belt, hair
        const before = [[0x3d, 0x8f, 0xd6], [0x40, 0x95, 0xdf], [0x3a, 0x89, 0xcd], [0xe0, 0xac, 0x7e], [0x1d, 0x27, 0x33], [0x3b, 0x3b, 0x58], [0x3a, 0x2a, 0x1a], [0x4a, 0x2f, 0x1b]]
        const px = new Uint8Array(before.flatMap((c) => [...c, 255]))
        recolorShirt(px, SHIRTS[1])
        const after = before.map((_, i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]])
        expect(after[0]).toEqual(rgbOf(SHIRTS[1]))
        // the shades stay in their order, channel by channel
        for (let c = 0; c < 3; c++) {
            expect(after[1][c]).toBeGreaterThanOrEqual(after[0][c])
            expect(after[2][c]).toBeLessThanOrEqual(after[0][c])
        }
        for (let i = 3; i < before.length; i++) expect(after[i]).toEqual(before[i])
        expect([...px].filter((_, i) => i % 4 === 3).every((a) => a === 255)).toBe(true)
        // the blue repainted in the blue is the blue
        const same = new Uint8Array([0x3d, 0x8f, 0xd6, 255])
        expect([...recolorShirt(same, SHIRTS[0])]).toEqual([0x3d, 0x8f, 0xd6, 255])
    })
})

describe('the links (plan 15 §4)', () => {
    it('more games on Maize.Live, and where rooms come from: the whole phrase the link, in a new tab', () => {
        expect(moreGames()).toContain(`href="${MAIZE}"`)
        expect(moreGames()).toContain('>More games on Maize.Live</a>')
        expect(roomsLine()).toContain(`href="${P3P2_SITE}"`)
        expect(roomsLine()).toContain('>Rooms come from p3p2.me</a>')
        for (const html of [moreGames(), roomsLine()]) {
            expect(html).toContain('target="_blank" rel="noopener"')
            expect(html).not.toMatch(/<img|url\(/)
        }
        expect([MAIZE, P3P2_SITE]).toEqual(['https://maize.live', 'https://p3p2.me'])
    })

    it('index.html carries the same lines, before any script runs: the loading screen and the menu', () => {
        const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
        const loading = html.slice(html.indexOf('<div id="loading"'))
        expect(loading.slice(0, loading.indexOf('\n'))).toContain(moreGames())
        const menu = html.slice(html.indexOf('data-view="main"'), html.indexOf('data-view="new"'))
        expect(menu).toContain('data-go="friends"')
        expect(menu).toContain(roomsLine())
    })
})
