/*
 *  Playing together through p3p2 (plan 15 §5.3), in the running game: a p3p2
 *  server on this machine, the game served on this machine's LAN address,
 *  and players who are each a browser profile of their own (two tabs of one
 *  browser are one player to p3p2).
 *
 *  It asks the pages what they hold (window.game, and window.game.net.replica.list())
 *  and never judges a picture. What it does, in order:
 *
 *    alone      an ordinary visit asks the server nothing, and plays as before
 *    room       a host opens a room from the menu and starts; two guests join by the
 *               invite: no opening raid, the same world everywhere, three builders apart
 *    building   a block from a guest, one dug by the host, a tower and its column as one
 *               op, a troop; the same troops in the same places; each builder where its
 *               player stands, holding what it holds, swinging when it swings; names
 *    shirts     (plan 16) three players in three colours, the host in the builder's blue,
 *               drawn the same on every page, on the body and on the name's ring; the
 *               names from above too
 *    night      asked for by a guest; the same attackers; a wall down for everybody, the
 *               cracks, a guest's blow and arrow, an attacker's blow on a guest, a patch, a
 *               fireball and a keg seen by guests, the sounds of the fight; a menu that
 *               doesn't stop the night; a lost night's dawn with the winners' cheer, a
 *               skip asked by a guest, the new day's numbers
 *    host leaves  in the middle of a night: the next player carries the units on
 *    reload     of a guest, and of the host, each in the colour they wore
 *    come back  everybody leaves; a newcomer finds the town; a player finds their things;
 *               one who comes back to find their colour taken by somebody who came
 *               before them wears another
 *    quit       the pause panel's quit leaves the room, to the menu
 *    --lag      two players building through 150 ms each way, cut every 30 s
 *    --phone    a phone joins by the link; the panel fits upright and on its side
 *    --firefox  a Firefox player builds the same land and the same town
 *    --measure  from an invite to playable on the load test's phone; a night with three players:
 *               frames on each page, and what each sends and gets a second
 *
 *  The p3p2 server comes from .temp/p3p2 (cloned from GitHub and installed on the first
 *  run) and runs on a data folder of its own for each run.
 *
 *  Usage: node tools/autoplay/room-check.mjs [--no-build] [--lag] [--phone] [--firefox] [--measure] [--all]
 *         [--p3p2=<checkout>] [--keep] [--shots=<folder>]
 *  Exits non-zero when something fails.
 */

import { chromium, firefox } from 'playwright-core'
import { execSync, spawn } from 'node:child_process'
import { mkdirSync, existsSync, rmSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { blockId } from '../../src/world/blocks.js'
import { SHIRTS } from '../../src/characters/shirt.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
if (args.all) args.lag = args.phone = args.firefox = args.measure = true
const ROOT = new URL('../../', import.meta.url).pathname
const P3P2 = args.p3p2 || join(ROOT, '.temp', 'p3p2')
const PASSWORD = 'room-check-' + Date.now().toString(36)
const SERVER_PORT = Number(args['server-port'] || 8091)
const GAME_PORT = Number(args['game-port'] || 4198)
const shots = args.shots || join(ROOT, 'recordings', 'room16')
mkdirSync(shots, { recursive: true })

/** this machine's address on the LAN: a room is made for the address its players open the game at */
function lanAddress() {
    for (const [name, list] of Object.entries(networkInterfaces())) {
        if (/^(docker|br-|veth|virbr|tailscale)/.test(name)) continue
        for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
    }
    throw new Error('no LAN address: p3p2 rooms are made for one')
}
const LAN = lanAddress()

// ---- the servers -------------------------------------------------------------------

if (!existsSync(join(P3P2, 'server'))) {
    console.log(`cloning p3p2 into ${P3P2}…`)
    execSync(`git clone --depth 1 https://github.com/doublependu/p3p2.git "${P3P2}"`, { stdio: 'inherit' })
}
if (!existsSync(join(P3P2, 'node_modules'))) execSync('npm install', { cwd: P3P2, stdio: ['ignore', 'ignore', 'inherit'] })
if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const dataDir = join(ROOT, '.temp', `room-check-data-${Date.now().toString(36)}`)
const SERVER = `http://${LAN}:${SERVER_PORT}`
const p3p2 = spawn(process.execPath, ['src/main.ts'], {
    cwd: join(P3P2, 'server'),
    env: { ...process.env, P3P2_PORT: String(SERVER_PORT), P3P2_OWNER_PASSWORD: PASSWORD, P3P2_DATA_DIR: dataDir, P3P2_PUBLIC_URL: SERVER, P3P2_LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
})
const game = await serveDist({ port: GAME_PORT, plain: LAN })
const GAME = game.url
for (let i = 0; ; i++) {
    try {
        if ((await fetch(SERVER + '/')).status < 500) break
    } catch { /* not up yet */ }
    if (i > 100) throw new Error('the p3p2 server did not start')
    await new Promise((r) => setTimeout(r, 100))
}
console.log(`p3p2 at ${SERVER}, the game at ${GAME}`)

const LAUNCH = { headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist'] }
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', ...LAUNCH })
const contexts = []
/** browsers of their own (the measuring part's players), closed at the end */
const browsers = []
/** a player: a browser profile of their own */
async function profile(b = browser, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, ...opts })
    contexts.push(ctx)
    return ctx
}

let bad = 0
const report = (ok, what, extra = '') => {
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${extra ? `  (${extra})` : ''}`)
    return ok
}
/** run a part; a part that throws is a failure, and the rest still run */
async function part(name, fn) {
    console.log(`\n-- ${name}`)
    try {
        await fn()
    } catch (err) {
        report(false, `${name}: ${String(err && err.message || err).split('\n')[0]}`)
    }
}
/** ask until `ok` holds of the answer, or `ms` runs out; the last answer either way */
async function until(ask, ok, ms = 10000) {
    const end = Date.now() + ms
    let v
    for (;;) {
        v = await ask()
        if (ok(v) || Date.now() > end) return v
        await new Promise((r) => setTimeout(r, 150))
    }
}

// ---- what a page holds ---------------------------------------------------------------

/** every block edit and every troop, in one number: the same world reads the same */
const fingerprint = (page) => page.evaluate(() => {
    const g = window.game
    let h = 0
    const add = (s) => {
        for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
    }
    for (const [x, y, z, b] of g.world.sortedEdits()) add(`${x},${y},${z},${b};`)
    for (const id of [...g.placements.keys()].sort()) add(id)
    return { edits: g.world.edits.count, troops: g.placements.size, hash: h }
})
const list = (page) => page.evaluate(() => window.game.net.replica.list())
const phase = (page) => page.evaluate(() => window.game.cycle.phase)
const numbers = (page) => page.evaluate(() => {
    const c = window.game.cycle
    return [c.phase, c.day, c.nightLevel, c.lives].join(' ')
})
const playable = (page) => page.waitForFunction(() => window.__timings && window.__timings.playable > 0 && window.game, null, { timeout: 120000 })
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
/** sounds a page plays, by name (counted from now) */
const listen = (page) => page.evaluate(() => {
    const g = window.game
    window.__heard = {}
    if (g.audio.__wrapped) return
    g.audio.__wrapped = true
    const play = g.audio.play.bind(g.audio)
    g.audio.play = (name, ...rest) => {
        window.__heard[name] = (window.__heard[name] || 0) + 1
        return play(name, ...rest)
    }
})
const heard = (page) => page.evaluate(() => window.__heard || {})
/** what a page wears and how it draws the others (plan 16 §3): the colour, what the body was asked to wear, its materials, the name's tag */
const dress = (page) => page.evaluate(() => {
    const g = window.game, r = g.net.replica
    const mats = (c) => c.meshes.map((m) => (m._baseMat ?? m.material).name)
    return {
        name: g.net.room.self.name, order: g.net.room.self.order, shirt: r.shirt, wears: g.player.char.shirt, mats: mats(g.player.char),
        others: [...r.heroes.values()].map((u) => ({ name: u.name, shirt: u.netShirt, wears: u.char.shirt, mats: mats(u.char), tag: u.tag.shown() })),
    }
})
/** a body in colour `i` wears it: asked to, and in the material of that colour (the blue is the model's own) */
const inColour = (d, i) => d.wears === SHIRTS[i] && d.mats.length > 0 && d.mats.every((n) => (i === 0 ? !n.includes('#') : n.endsWith(SHIRTS[i])))
/** every page draws every other player in the colour that player wears */
const agreed = (ds) => ds.every((d) => d.others.every((o) => {
    const them = ds.find((x) => x.name === o.name)
    return !them || (o.shirt === them.shirt && inColour(o, them.shirt))
}))

/** a room in the portal, for the game's address */
async function makeRoom(name, gameUrl = GAME) {
    const portal = await (await profile()).newPage()
    await portal.goto(SERVER + '/')
    await portal.getByLabel('Password').fill(PASSWORD)
    await portal.getByRole('button', { name: 'Log in' }).click()
    await portal.getByLabel('Game URL').fill(gameUrl)
    await portal.getByLabel('Room name').fill(name)
    await portal.getByRole('button', { name: 'Create room' }).click()
    await portal.getByRole('heading', { name }).waitFor()
    const url = await portal.getByLabel('Room URL').inputValue()
    await portal.close()
    return url
}

/** a page of the game with its errors on the console */
async function open(ctx, url, who) {
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error(`  ${who}: page error: ${e.message}`))
    await page.goto(url)
    return page
}

/** host a room from the menu's "Play with friends…" (or, `button`, another way into the panel): the invite link */
async function host(page, roomUrl, name, button = '[data-go="friends"]') {
    await page.click(button)
    await page.getByLabel('Your name').fill(name)
    await page.getByLabel('Room URL').fill(roomUrl)
    await page.getByRole('status').filter({ hasText: '✓' }).waitFor({ timeout: 15000 })
    await page.getByRole('button', { name: 'Create a multiplayer game room for my friends' }).click()
    const link = page.getByLabel('Invite link', { exact: true })
    await link.waitFor()
    const invite = await link.inputValue()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    return invite
}

/** open an invite and say yes */
async function joinRoom(ctx, invite, name) {
    const page = await open(ctx, invite, name)
    await page.getByRole('button', { name: 'Join', exact: true }).waitFor({ timeout: 15000 })
    await page.getByLabel('Your name').fill(name)
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await playable(page)
    return page
}

/** an empty cell on the ground a few metres from this page's builder, and a block for it */
const groundCell = (page, dx, dz) => page.evaluate(({ dx, dz }) => {
    const g = window.game
    const p = g.noa.entities.getPosition(g.noa.playerEntity)
    const x = Math.floor(p[0]) + dx, z = Math.floor(p[2]) + dz
    let y = Math.floor(p[1]) + 4
    while (y > 0 && !g.noa.getBlock(x, y - 1, z)) y--
    return [x, y, z]
}, { dx, dz })

/** place what's in hand, as a click does (session.placeSelected), with `item` put in hand first */
const place = (page, item, at, n = 1) => page.evaluate(({ item, at, n }) => {
    const g = window.game
    g.inventory.add(item, n)
    if (!g.inventory.hotbar.includes(item)) g.inventory.assign(8, item)
    g.inventory.select(g.inventory.hotbar.indexOf(item))
    g.placeSelected(at)
}, { item, at, n })

const blockAt = (page, c) => page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]), c)

/** the same view from above on each page, at the same moment, side by side in one picture (for a person to judge) */
async function sideBySide(pages, labels, file) {
    const view = await pages[0].evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        return { x: tc[0] + 0.5, y: tc[1] + 1, z: tc[2] + 0.5, zoom: 46, pitch: 0.95, heading: 0.6 }
    })
    for (const p of pages) {
        await p.evaluate((v) => {
            const c = window.game.control
            if (c.mode !== 'aerial') c.enterAerial()
            Object.assign(c.aerial, { ...v, tx: v.x, tz: v.z, shown: v.zoom })
        }, view)
    }
    await pages[0].waitForTimeout(1500)
    const shots = await Promise.all(pages.map((p) => p.screenshot({ type: 'jpeg', quality: 80 })))
    const sheet = await (await profile(browser, { viewport: { width: 1280 * pages.length, height: 760 } })).newPage()
    await sheet.setContent(`<body style="margin:0;background:#111;display:flex;font:600 16px system-ui;color:#eee">${shots.map((b, i) => `<figure style="margin:0"><img src="data:image/jpeg;base64,${b.toString('base64')}" width="1280" height="720" style="display:block"><figcaption style="padding:10px 14px">${labels[i]}</figcaption></figure>`).join('')}</body>`)
    await sheet.screenshot({ path: file, type: 'jpeg', quality: 82 })
    await sheet.close()
    for (const p of pages) await p.evaluate(() => window.game.control.returnToSelf())
}

// ---- alone ---------------------------------------------------------------------------

await part('alone', async () => {
    const page = await open(await profile(), GAME, 'alone')
    const asked = []
    page.on('request', (r) => {
        if (r.url().startsWith(SERVER)) asked.push(r.url())
    })
    await page.click('[data-go="play"]')
    await playable(page)
    await page.waitForTimeout(1500)
    const s = await page.evaluate(() => ({ room: window.game.net.inRoom(), leads: window.game.net.leads(), edits: window.game.world.edits.count }))
    report(!asked.length, 'an ordinary visit asks the p3p2 server nothing', asked.length ? asked[0] : '')
    report(!s.room && s.leads && s.edits > 0, 'the game alone is in no room, and decides everything', JSON.stringify(s))
    await page.close()
})

// ---- a room: a host and two guests ---------------------------------------------------

const roomUrl = await makeRoom('Room check ' + Date.now().toString(36))
const ada = { ctx: await profile() }, grace = { ctx: await profile() }, lin = { ctx: await profile() }
let invite = ''

await part('room', async () => {
    ada.page = await open(ada.ctx, GAME, 'Ada')
    invite = await host(ada.page, roomUrl, 'Ada')
    report(invite.includes('?room='), 'the panel gives an invite link', invite)
    await ada.page.click('[data-go="play"]', { force: true })
    await playable(ada.page)
    report(await until(() => ada.page.evaluate(() => window.game.net.inRoom() && !!window.game.net.sync.room), (v) => v, 15000), 'the host\'s world is now the room\'s')
    report((await phase(ada.page)) === 'day', 'no opening raid for a world started in a room', await phase(ada.page))
    grace.page = await joinRoom(grace.ctx, invite, 'Grace')
    lin.page = await joinRoom(lin.ctx, invite, 'Lin')
    const prints = await until(() => Promise.all([ada, grace, lin].map((p) => fingerprint(p.page))), (v) => same(v[0], v[1]) && same(v[0], v[2]), 15000)
    report(same(prints[0], prints[1]) && same(prints[0], prints[2]), 'the same world on all three pages', JSON.stringify(prints[0]))
    const phases = await Promise.all([ada, grace, lin].map((p) => phase(p.page)))
    report(phases.every((p) => p === 'day'), 'a guest walks into the host\'s day: no opening raid', phases.join(' '))
    const views = await until(() => Promise.all([ada, grace, lin].map((p) => list(p.page))), (v) => v.every((l) => l.heroes.length === 2), 10000)
    report(views.every((l) => l.heroes.length === 2), 'each page draws the two other builders', views.map((l) => l.heroes.map((h) => h.name).join('+')).join(', '))
    report(views[0].leads && !views[1].leads && !views[2].leads, 'the host leads, the guests draw')
    const at = await Promise.all([ada, grace, lin].map((p) => p.page.evaluate(() => [...window.game.noa.entities.getPosition(window.game.noa.playerEntity)])))
    const apart = Math.min(...[[0, 1], [0, 2], [1, 2]].map(([i, j]) => Math.hypot(at[i][0] - at[j][0], at[i][2] - at[j][2])))
    report(apart > 1, 'three builders, each in a place of their own', `nearest two ${apart.toFixed(2)} m apart`)
})

// ---- building together ------------------------------------------------------------------

await part('building', async () => {
    const pages = [ada.page, grace.page, lin.page]
    const cobble = blockId('cobble')
    // a block from a guest
    const c1 = await groundCell(grace.page, 3, 0)
    await place(grace.page, 'cobble', c1)
    const got = await until(() => Promise.all(pages.map((p) => blockAt(p, c1))), (v) => v.every((b) => b === cobble))
    report(got.every((b) => b === cobble), 'a block a guest places is there for everybody', got.join(' '))
    // dug out by the host
    await ada.page.evaluate((c) => window.game.breakBlock(c[0], c[1], c[2], window.game.noa.getBlock(c[0], c[1], c[2])), c1)
    const gone = await until(() => Promise.all(pages.map((p) => blockAt(p, c1))), (v) => v.every((b) => b === 0))
    report(gone.every((b) => b === 0), 'a block the host digs out is gone for everybody', gone.join(' '))
    // a tower and its column, as one op in the room's log
    const seq0 = await lin.page.evaluate(() => window.game.net.room.log.seq)
    const c2 = await groundCell(lin.page, -3, 2)
    await lin.page.evaluate(() => window.game.inventory.add('cobble', 10))
    await place(lin.page, 'arrow_tower', c2)
    const tops = await until(() => Promise.all(pages.map((p) => p.evaluate((c) => {
        const g = window.game
        let y = c[1]
        while (g.noa.getBlock(c[0], y, c[2]) && y < c[1] + 6) y++
        return y - c[1]
    }, c2))), (v) => v.every((n) => n > 0 && n === v[0]))
    const seq1 = await lin.page.evaluate(() => window.game.net.room.log.seq)
    report(tops.every((n) => n > 0 && n === tops[0]), 'a guest\'s tower stands on every page, with its column', `${tops[0]} blocks high`)
    report(seq1 - seq0 === 1, 'the tower and its column are one op in the room\'s log', `${seq1 - seq0} ops`)
    // a troop from a guest
    const c3 = await groundCell(grace.page, 0, 4)
    await place(grace.page, 'swordsman', c3)
    const troops = await until(() => Promise.all(pages.map((p) => p.evaluate(() => window.game.placements.size))), (v) => v.every((n) => n === v[0]) && v[0] > 0)
    report(troops.every((n) => n === troops[0]), 'a troop a guest places is in everybody\'s town', `${troops[0]} troops`)
    // the same troops in the same places
    const far = await until(async () => {
        const [h, g] = await Promise.all([list(ada.page), list(grace.page)])
        const real = new Map(h.units.filter((u) => u.alive).map((u) => [u.id, u]))
        let worst = 0, missing = 0
        for (const u of g.units) {
            const r = real.get(u.id)
            if (!r) {
                missing++
                continue
            }
            worst = Math.max(worst, Math.hypot(r.pos[0] - u.pos[0], r.pos[2] - u.pos[2]))
        }
        return { worst, missing, n: g.units.length, host: real.size }
    }, (v) => v.missing === 0 && v.n === v.host && v.worst < 1.5, 15000)
    report(far.missing === 0 && far.n === far.host && far.worst < 1.5, 'the same troops in the same places on a guest\'s page', `${far.n} troops, farthest ${far.worst.toFixed(2)} m off`)
    // a builder where its player stands, holding what it holds
    const spot = await grace.page.evaluate(() => {
        const g = window.game
        const p = g.noa.entities.getPosition(g.noa.playerEntity)
        const to = [p[0] + 2, p[1] + 0.2, p[2] - 2]
        g.noa.entities.setPosition(g.noa.playerEntity, to)
        g.inventory.select(g.inventory.hotbar.indexOf('cobble'))
        return to
    })
    const seen = await until(() => list(ada.page).then((l) => l.heroes.find((h) => h.name === 'Grace')), (h) => h && Math.hypot(h.pos[0] - spot[0], h.pos[2] - spot[2]) < 1 && h.item === 'block', 8000)
    report(!!seen && Math.hypot(seen.pos[0] - spot[0], seen.pos[2] - spot[2]) < 1, 'a builder is drawn where its player stands', seen && JSON.stringify(seen.pos))
    report(!!seen && seen.item === 'block' && seen.tile === 'cobble', 'holding the block its player holds, with that block\'s face', seen && `${seen.item} ${seen.tile}`)
    // a swing, seen and heard
    await listen(ada.page)
    const act0 = seen ? seen.act : 0
    await grace.page.evaluate(() => {
        const g = window.game
        g.inventory.select(g.inventory.hotbar.indexOf(g.inventory.bestWeapon))
    })
    await grace.page.waitForTimeout(400)
    await grace.page.evaluate(() => window.game.control._playAction(window.game.player, 'attack'))
    const swung = await until(() => ada.page.evaluate((act0) => {
        const r = window.game.net.replica
        const u = [...r.heroes.values()].find((h) => h.name === 'Grace')
        return { act: u.netAct, action: u.char.action, changed: u.netAct !== act0 }
    }, act0), (v) => v.changed, 5000)
    report(swung.changed && swung.action === 'attack', 'a friend\'s swing plays on the others\' pages', JSON.stringify(swung))
    const h = await heard(ada.page)
    report(Object.keys(h).some((n) => n.startsWith('swing')), 'and is heard there', Object.keys(h).join(' '))
    // names over heads
    const tags = await ada.page.evaluate(() => [...document.querySelectorAll('.name-tag')].map((e) => e.textContent).sort())
    report(same(tags, ['Grace', 'Lin']), 'the host sees each friend\'s name', tags.join(' '))
    await ada.page.screenshot({ path: join(shots, 'building-host.jpg'), quality: 80 })
})

// ---- shirts and names (plan 16 §3, §4) -------------------------------------------------------

await part('shirts', async () => {
    const pages = [ada.page, grace.page, lin.page]
    const ds = await until(() => Promise.all(pages.map(dress)), (ds) => ds.every((d) => d.shirt !== null && inColour(d, d.shirt)) && agreed(ds), 10000)
    report(ds[0].shirt === 0, 'the host wears the builder\'s own blue', `${ds[0].name}: ${ds[0].shirt}`)
    report(new Set(ds.map((d) => d.shirt)).size === 3, 'three players, three colours', ds.map((d) => `${d.name} ${SHIRTS[d.shirt]}`).join(', '))
    report(ds.every((d) => inColour(d, d.shirt)), 'each wears their own on their own page (their own arms in first person)', ds.map((d) => d.mats.join('+')).join(', '))
    report(agreed(ds), 'every page draws each friend in the colour that friend wears')
    const rings = ds.every((d) => d.others.every((o) => o.tag.ring === SHIRTS[o.shirt]))
    report(rings, 'each friend\'s name is ringed in their colour', ds[0].others.map((o) => `${o.name} ${o.tag.ring}`).join(', '))
    // on foot, a few metres back from the two friends, for a person to look at
    await ada.page.evaluate(() => {
        const g = window.game
        const at = [...g.net.replica.heroes.values()].map((u) => u.netPos)
        const mid = [(at[0][0] + at[1][0]) / 2, (at[0][1] + at[1][1]) / 2, (at[0][2] + at[1][2]) / 2]
        const side = [at[1][2] - at[0][2], at[0][0] - at[1][0]]
        const len = Math.hypot(side[0], side[1]) || 1
        const back = Math.max(4, Math.hypot(at[0][0] - at[1][0], at[0][2] - at[1][2]) * 1.2)
        const p = [mid[0] + (side[0] / len) * back, mid[1] + 0.5, mid[2] + (side[1] / len) * back]
        g.noa.entities.setPosition(g.noa.playerEntity, p)
        g.noa.camera.heading = Math.atan2(mid[0] - p[0], mid[2] - p[2])
        g.noa.camera.pitch = 0.08
    })
    await ada.page.waitForTimeout(1200)
    const near = await dress(ada.page)
    report(near.others.every((o) => o.tag.visible && o.tag.font === '16px' && o.tag.h >= 24), 'names big enough to read: 16 px, over each friend in view', near.others.map((o) => `${o.name} ${o.tag.visible ? `${o.tag.font} ${o.tag.w}×${o.tag.h}` : 'hidden'}`).join(', '))
    await ada.page.screenshot({ path: join(shots, 'shirts-on-foot.jpg'), quality: 82 })
    // from above: the names show wherever the friends are on the screen
    await ada.page.evaluate(() => window.game.control.enterAerial())
    await ada.page.waitForTimeout(2000)
    const above = await dress(ada.page)
    const vw = await ada.page.evaluate(() => [innerWidth, innerHeight])
    const onScreen = (t) => t.visible && t.x >= 0 && t.y >= 0 && t.x + t.w <= vw[0] && t.y + t.h <= vw[1]
    report(above.others.every((o) => onScreen(o.tag)), 'from above, every friend\'s name shows', above.others.map((o) => `${o.name} ${o.tag.visible ? `${o.tag.x},${o.tag.y}` : 'hidden'}`).join(', '))
    await ada.page.screenshot({ path: join(shots, 'shirts-from-above.jpg'), quality: 82 })
    await ada.page.evaluate(() => window.game.control.returnToSelf())
})

// ---- a night ---------------------------------------------------------------------------

await part('night', async () => {
    const pages = [ada.page, grace.page, lin.page]
    for (const p of pages) await listen(p)
    // a guest asks; the host's N starts it for everybody
    await grace.page.evaluate(() => window.game.requestNight())
    const dusk = await until(() => Promise.all(pages.map(phase)), (v) => v.every((p) => p === 'dusk'), 5000)
    report(dusk.every((p) => p === 'dusk'), 'a guest asks for the night, and dusk comes for everybody', dusk.join(' '))
    const night = await until(() => Promise.all(pages.map(phase)), (v) => v.every((p) => p === 'night'), 15000)
    report(night.every((p) => p === 'night'), 'and the night', night.join(' '))
    // the same attackers
    const att = await until(async () => {
        const [h, g, l] = await Promise.all(pages.map(list))
        const ids = (x, remote) => x.units.filter((u) => u.alive && u.remote === remote && /grunt|raider|brute|sapper|pyro/.test(u.type)).map((u) => u.id).sort().join()
        return { host: ids(h, false), grace: ids(g, true), lin: ids(l, true) }
    }, (v) => v.host && v.host === v.grace && v.host === v.lin, 20000)
    report(!!att.host && att.host === att.grace && att.host === att.lin, 'the same attackers on every page', `${att.host.split(',').length} attackers`)
    // the count at the top of the screen, waves still to come included; the fronts the edge markers point to
    const counts = await until(() => Promise.all([ada.page, grace.page].map((p) => p.evaluate(() => {
        const g = window.game
        return { left: g.waves.remaining, fronts: g.waves.frontGroups().map((f) => f.count).sort((a, b) => a - b).join() }
    }))), (v) => v[0].left === v[1].left && v[0].fronts === v[1].fronts, 5000)
    report(counts[0].left === counts[1].left, 'a guest counts the attackers the host does, those still to come included', `${counts[0].left} / ${counts[1].left}`)
    report(counts[0].fronts === counts[1].fronts, 'and groups them by the same fronts', `${counts[0].fronts} / ${counts[1].fronts}`)
    // a menu doesn't stop a room's night
    const t0 = await ada.page.evaluate(() => {
        window.game.hud.openPanel('pause')
        return window.game.cycle.t
    })
    await ada.page.waitForTimeout(1200)
    const menu = await ada.page.evaluate(() => ({ t: window.game.cycle.t, paused: window.game.paused, title: document.querySelector('.pause-title').textContent, quit: document.querySelector('[data-a="quit"]').textContent }))
    report(menu.t > t0 + 0.8 && !menu.paused, 'the host\'s menu doesn\'t stop the night', `${(menu.t - t0).toFixed(1)} s went by`)
    report(menu.title === 'Menu' && menu.quit === 'Leave room & quit to menu', 'the pause panel says it is a room\'s', `${menu.title} / ${menu.quit}`)
    await ada.page.screenshot({ path: join(shots, 'menu-in-room.jpg'), quality: 80 })
    await ada.page.evaluate(() => window.game.hud.closePanel())
    // a wall down for everybody, with the dust; and cracks
    const [down, cracked] = await ada.page.evaluate(() => {
        const g = window.game
        // built of something a builder carries, so that a guest can patch it
        const out = g.world.sortedEdits().filter(([x, y, z, b]) => /^(cobble|planks|stone_wall)$/.test(b) && g.noa.getBlock(x, y, z) && !g.noa.getBlock(x, y + 1, z)).slice(0, 2).map((e) => e.slice(0, 3))
        const [a, b] = out
        g.demolition.add(a[0], a[1], a[2])
        g.world.damageBlock(b[0], b[1], b[2], g.world.maxHp(g.noa.getBlock(b[0], b[1], b[2])) * 0.6)
        return out
    })
    const downs = await until(() => Promise.all(pages.map((p) => blockAt(p, down))), (v) => v.every((b) => b === 0))
    report(downs.every((b) => b === 0), 'a wall block the night knocks down is down for everybody', downs.join(' '))
    const cracks = await until(() => Promise.all([grace.page, lin.page].map((p) => p.evaluate((c) => window.game.cracks.damaged.has(c.join()), cracked))), (v) => v.every(Boolean))
    report(cracks.every(Boolean), 'a cracked block shows its cracks on the guests\' pages too')
    // a guest's blow lands on the host's attacker, and the host counts it
    const target = await grace.page.evaluate(() => {
        const g = window.game
        const u = g.units.units.find((u) => u.remote && u.alive && u.side === 'attacker')
        if (!u) return null
        const id = u.netId
        g.units.damage(u, 3, g.player)
        return id
    })
    const hp = await until(() => ada.page.evaluate((id) => {
        const u = window.game.units.units.find((u) => u.uid === id)
        return u ? u.maxHp - u.hp : -1
    }, target), (v) => v >= 3, 5000)
    report(target !== null && hp >= 3, 'a guest\'s blow on an attacker counts on the host', `${hp} hp off`)
    // a guest's arrow flies on the host's page
    await grace.page.evaluate(() => {
        const g = window.game
        const p = g.noa.entities.getPosition(g.noa.playerEntity)
        g.effects.fireDir('arrow', [p[0], p[1] + 1.5, p[2]], [0.6, 0.3, 0.74], { damage: 5, side: 'defender', owner: g.player })
    })
    const flown = await until(() => ada.page.evaluate(() => window.game.effects.projectiles.filter((p) => p.drawn).length), (n) => n > 0, 4000)
    report(flown > 0, 'a guest\'s arrow flies on the host\'s page (drawn: what it hits is the guest\'s to say)')
    // an attacker's blow on a guest's builder counts on that guest's page
    const hp0 = await lin.page.evaluate(() => window.game.player.hp)
    await ada.page.evaluate(() => {
        const g = window.game
        const hero = [...g.net.replica.heroes.values()].find((h) => h.name === 'Lin')
        const a = g.units.units.find((u) => u.alive && u.side === 'attacker' && !u.remote)
        g.units.damage(hero, 4, a)
    })
    const hp1 = await until(() => lin.page.evaluate(() => window.game.player.hp), (v) => v <= hp0 - 4, 5000)
    report(hp1 <= hp0 - 4, 'an attacker\'s blow on a guest\'s builder hurts it on that guest\'s page', `${hp0} → ${hp1}`)
    // a patch from a guest, with the same block from their stock
    const patchItem = await grace.page.evaluate((c) => window.game.world.sortedEdits().find((e) => e[0] === c[0] && e[1] === c[1] && e[2] === c[2])[3], down)
    await place(grace.page, patchItem, down)
    const back = await until(() => Promise.all(pages.map((p) => blockAt(p, down))), (v) => v.every((b) => b !== 0))
    report(back.every((b) => b !== 0), 'a hole a guest patches is mended for everybody', `${patchItem}: ${back.join(' ')}`)
    // a fireball, and a keg, seen by the guests
    await ada.page.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        const u = g.units.units.find((u) => u.alive && u.side === 'attacker' && !u.remote)
        g.fireballs.throw([tc[0] + 8, tc[1] + 6, tc[2] + 8], [tc[0] + 12, tc[1], tc[2] + 12], u)
        g.demolition.explode([tc[0] + 20, tc[1] + 1, tc[2] + 20], { radius: 0.5, unitDamage: 0, unitRadius: 0, townDamage: 0, townRadius: 0 })
    })
    const balls = await until(() => grace.page.evaluate(() => window.game.fireballs.casts.length + window.game.fireballs.bursts.length), (n) => n > 0, 4000)
    report(balls > 0, 'the host\'s fireball flies on a guest\'s page')
    // the sounds of the fight
    await grace.page.waitForTimeout(4000)
    const sounds = await heard(grace.page)
    report(sounds.explosion > 0, 'a keg goes off on a guest\'s page too', `explosion ×${sounds.explosion || 0}`)
    report(sounds.fireball_blast > 0, 'and the fireball\'s blast', `×${sounds.fireball_blast || 0}`)
    const fight = Object.keys(sounds).filter((n) => /^(swing|hit_|bash|break|fire_|string|clash|town_bell)/.test(n))
    report(fight.length > 0, 'a guest hears the host\'s fight', fight.join(' '))
    await sideBySide([ada.page, grace.page], ['Ada, the host: the night as it runs', 'Grace, a guest: drawn from Ada\'s reports'], join(shots, 'night-side-by-side.jpg'))
    // a lost night: the winners cheer on every page, then leave; a guest asks to skip the dawn
    await ada.page.evaluate(() => window.game.cycle.endNight('lost'))
    const dawn = await until(() => Promise.all(pages.map(phase)), (v) => v.every((p) => p === 'dawn'), 5000)
    report(dawn.every((p) => p === 'dawn'), 'a lost night: dawn on every page', dawn.join(' '))
    const cheer = await until(() => grace.page.evaluate(() => window.game.units.units.filter((u) => u.remote && u.alive && u.side === 'attacker' && u.cheer).length), (n) => n > 0, 3000)
    report(cheer > 0, 'the winners cheer on a guest\'s page (the host\'s, not killed by the guest)', `${cheer} cheering`)
    const left = await until(() => grace.page.evaluate(() => window.game.units.units.filter((u) => u.remote && u.side === 'attacker').length), (n) => n === 0, 8000)
    report(left === 0, 'and then they leave', `${left} left`)
    await lin.page.evaluate(() => window.game.skipDawn())
    const day = await until(() => Promise.all(pages.map(numbers)), (v) => v.every((n) => n.startsWith('day') && n === v[0]), 15000)
    report(day.every((n) => n.startsWith('day') && n === day[0]), 'a guest\'s Skip asks the host, and the new day comes for everybody, with the same numbers', day[0])
})

// ---- the host leaves in the middle of a night ---------------------------------------------

await part('host leaves', async () => {
    await ada.page.evaluate(() => window.game.requestNight())
    await until(() => phase(grace.page), (p) => p === 'night', 20000)
    const before = await until(() => list(grace.page), (l) => l.units.some((u) => u.alive && /grunt|raider|brute|sapper|pyro/.test(u.type)), 20000)
    const attackers = before.units.filter((u) => u.alive && /grunt|raider|brute|sapper|pyro/.test(u.type))
    await ada.page.close()
    const after = await until(async () => {
        const [g, l] = await Promise.all([list(grace.page), list(lin.page)])
        return g.leads ? { who: 'Grace', l: g } : l.leads ? { who: 'Lin', l: l } : null
    }, (v) => !!v, 20000)
    report(!!after, 'the next player takes the night over', after ? after.who : 'nobody leads')
    if (!after) return
    const carried = after.l.units.filter((u) => u.alive && !u.remote && /grunt|raider|brute|sapper|pyro/.test(u.type))
    report(carried.length >= Math.max(1, attackers.length - 2), 'and carries the attackers on', `${attackers.length} before, ${carried.length} now`)
    const lead = after.who === 'Grace' ? grace : lin, other = after.who === 'Grace' ? lin : grace
    const drawn = await until(() => list(other.page), (l) => l.units.filter((u) => u.remote && u.alive && /grunt|raider|brute|sapper|pyro/.test(u.type)).length === carried.length, 10000)
    report(drawn.units.filter((u) => u.remote && u.alive && /grunt|raider|brute|sapper|pyro/.test(u.type)).length === carried.length, 'the other page draws the new host\'s attackers')
    // the attackers that are left go: the night ends
    await lead.page.evaluate(() => {
        const g = window.game
        for (const u of g.units.units) if (u.alive && u.side === 'attacker') g.units.kill(u)
    })
    const end = await until(() => Promise.all([grace.page, lin.page].map(phase)), (v) => v.every((p) => p === 'dawn' || p === 'day'), 15000)
    report(end.every((p) => p === 'dawn' || p === 'day'), 'and the night ends when they are gone', end.join(' '))
    await lead.page.evaluate(() => window.game.skipDawn())
    await until(() => Promise.all([grace.page, lin.page].map(phase)), (v) => v.every((p) => p === 'day'), 15000)
})

// ---- reloads ----------------------------------------------------------------------------

await part('reload', async () => {
    for (const p of [grace, lin]) {
        const before = await fingerprint(p.page)
        const inv = await p.page.evaluate(() => {
            window.game.net.keep()
            return window.game.inventory.toJSON()
        })
        await p.page.waitForTimeout(500)
        const wasHost = (await list(p.page)).leads
        const shirt = (await list(p.page)).shirt
        await p.page.reload()
        await playable(p.page)
        const after = await until(() => fingerprint(p.page), (v) => same(v, before), 15000)
        const back = await p.page.evaluate(() => ({ room: window.game.net.inRoom(), inv: window.game.inventory.toJSON(), menu: !document.querySelector('#menu').hidden }))
        const name = await p.page.evaluate(() => window.game.net.room.self.name)
        report(back.room && !back.menu && same(after, before), `${name}${wasHost ? ' (the host)' : ''} reloads, and comes back into the room's town`)
        report(same(back.inv, inv), `with what ${name} carried`)
        const now = await until(() => dress(p.page), (d) => d.shirt === shirt && inColour(d, shirt), 8000)
        report(now.shirt === shirt && inColour(now, shirt), `and in the colour ${name} wore`, `${SHIRTS[shirt]} -> ${SHIRTS[now.shirt]}`)
    }
    const leads = await Promise.all([grace, lin].map((p) => list(p.page).then((l) => l.leads)))
    report(leads.filter(Boolean).length === 1, 'one of them leads after the reloads', leads.join(' '))
})

// ---- everybody leaves; who comes back ----------------------------------------------------

let town = null
await part('come back', async () => {
    // Grace arranges her things, and everybody goes
    const mine = await grace.page.evaluate(() => {
        const g = window.game
        g.inventory.add('iron', 7)
        g.inventory.assign(5, 'cobble')
        g.net.keep()
        const p = g.noa.entities.getPosition(g.noa.playerEntity)
        return { inv: g.inventory.toJSON(), hotbar: g.inventory.hotbar.slice(), pos: [p[0], p[2]], shirt: g.net.replica.shirt }
    })
    town = await fingerprint(grace.page)
    await grace.page.waitForTimeout(800)
    await grace.page.close()
    await lin.page.close()
    await new Promise((r) => setTimeout(r, 2000))
    // somebody new finds the town
    const max = { ctx: await profile() }
    max.page = await joinRoom(max.ctx, invite, 'Max')
    const theirs = await until(() => fingerprint(max.page), (v) => same(v, town), 15000)
    report(same(theirs, town), 'a newcomer after everybody has left finds the town', JSON.stringify(theirs))
    report((await list(max.page)).leads, 'and runs it, alone')
    // and somebody else new, who takes the first colour nobody here wears: Grace's, while she is away
    const ken = { ctx: await profile() }
    ken.page = await joinRoom(ken.ctx, invite, 'Ken')
    const kenWore = (await until(() => dress(ken.page), (d) => d.shirt !== null, 8000)).shirt
    // Grace comes back, in her own browser, to her own things
    grace.page = await joinRoom(grace.ctx, invite, 'Grace')
    const back = await grace.page.evaluate(() => {
        const g = window.game
        const p = g.noa.entities.getPosition(g.noa.playerEntity)
        return { inv: g.inventory.toJSON(), hotbar: g.inventory.hotbar.slice(), pos: [p[0], p[2]] }
    })
    // her colour, taken while she was away: whoever joined first keeps it, and every page agrees
    const three = await until(() => Promise.all([max.page, ken.page, grace.page].map(dress)), (ds) => new Set(ds.map((d) => d.shirt)).size === 3 && agreed(ds) && ds.every((d) => inColour(d, d.shirt)), 10000)
    const [, k, gr] = three
    const first = k.order < gr.order ? k : gr
    report(new Set(three.map((d) => d.shirt)).size === 3 && agreed(three), 'one who comes back to find their colour taken wears another, and the same on every page',
        three.map((d) => `${d.name} ${SHIRTS[d.shirt]}`).join(', '))
    report(kenWore === mine.shirt && first.shirt === mine.shirt, 'the one who joined first keeps it', `Grace wore ${SHIRTS[mine.shirt]}, Ken took ${SHIRTS[kenWore]}; ${first.name} joined first and wears ${SHIRTS[first.shirt]}`)
    report(same(back.inv, mine.inv), 'a player who comes back has what they carried', `iron ${back.inv.iron}`)
    report(same(back.hotbar, mine.hotbar), 'and their hotbar as they arranged it', back.hotbar.join(','))
    report(Math.hypot(back.pos[0] - mine.pos[0], back.pos[1] - mine.pos[1]) < 1, 'where they stood')
    // the room keeps a closed page's place a while (in case it was a reload): none of those is drawn
    const ghosts = (await list(grace.page)).heroes.map((h) => h.name)
    report(!ghosts.includes('Grace') && !ghosts.includes('Lin'), 'nobody sees a builder whose page is gone, nor their own from before', ghosts.join(' ') || 'nobody')
    // the pause panel's quit: out of the room, to the menu
    await max.page.evaluate(() => window.game.hud.openPanel('pause'))
    await max.page.click('[data-a="quit"]')
    // (window.game is the <div id="game"> until a game starts)
    await max.page.waitForFunction(() => !document.querySelector('#menu').hidden && !(window.game && window.game.net), null, { timeout: 15000 })
    await max.page.waitForTimeout(1500)
    const out = await max.page.evaluate(() => ({ menu: !document.querySelector('#menu').hidden, room: new URLSearchParams(location.search).has('room'), launched: !!(window.game && window.game.net) }))
    report(out.menu && !out.room && !out.launched, 'quitting in a room leaves it, and the menu stays', JSON.stringify(out))
    // (one who closed the page keeps their place for 30 s, in case it was a reload: Max left)
    const still = await until(() => list(grace.page), (l) => !l.heroes.some((h) => h.name === 'Max'), 15000)
    report(!still.heroes.some((h) => h.name === 'Max'), 'and the others see that player go at once', still.heroes.map((h) => h.name).join(' ') || 'nobody else')
    await ken.page.close()
})

// ---- a slow connection that drops ---------------------------------------------------------

if (args.lag) await part('lag', async () => {
    const { startLagProxy } = await import(join(P3P2, 'e2e', 'tools', 'lag-proxy.ts'))
    const proxy = await startLagProxy({ listen: 0, to: { host: LAN, port: SERVER_PORT }, latency: 150, jitter: 50 })
    const url = (await makeRoom('Lag ' + Date.now().toString(36))).replace(`:${SERVER_PORT}/`, `:${proxy.port}/`)
    // Ann is playing alone, in the middle of the opening raid, and opens a room from the pause panel
    const a = await open(await profile(), GAME, 'Ann')
    await a.click('[data-go="play"]')
    await playable(a)
    const raid = await until(() => a.evaluate(() => window.game.cycle.opening && window.game.cycle.phase === 'night'), (v) => v, 10000)
    await a.evaluate(() => window.game.hud.openPanel('pause'))
    const inv = await host(a, url, 'Ann', '.friends-row [data-a="friends"]')
    const offered = await until(() => a.evaluate(() => !!window.game.net.sync.room), (v) => v, 20000)
    report(raid && offered, 'a game going on alone (in its opening raid) is opened to friends from the pause panel')
    await a.evaluate(() => window.game.hud.closePanel())
    const after = await until(() => a.evaluate(() => ({ phase: window.game.cycle.phase, opening: window.game.cycle.opening })), (v) => !v.opening || v.phase !== 'night', 10000)
    report(after.phase !== 'night', 'and the opening raid, a lesson for one, gives way to its dawn', after.phase)
    const b = await joinRoom(await profile(), inv, 'Bo')
    // building is for the day: past the raid's dawn first
    await a.evaluate(() => window.game.skipDawn())
    await until(() => Promise.all([a, b].map(phase)), (v) => v.every((p) => p === 'day'), 20000)
    const start = (await fingerprint(a)).edits
    const t0 = Date.now()
    let n = 0
    while (Date.now() - t0 < 36000) {
        for (const [p, dx] of [[a, 2], [b, -2]]) {
            const c = await groundCell(p, dx, (n % 12) - 6)
            await place(p, 'planks', c)
        }
        n++
        if (n === 8) report(proxy.drop() > 0, 'the connections are cut', '')
        await a.waitForTimeout(900)
    }
    const prints = await until(() => Promise.all([a, b].map(fingerprint)), (v) => same(v[0], v[1]), 30000)
    report(same(prints[0], prints[1]) && prints[0].edits - start >= n, 'two players building through 150 ms each way and a cut connection end with the same town', `${n * 2} blocks placed, ${prints[0].edits - start} new edits`)
    await proxy.close()
})

// ---- a phone ---------------------------------------------------------------------------------

if (args.phone) await part('phone', async () => {
    const host2 = (await list(grace.page)).leads ? grace.page : null
    for (const [w, h] of [[390, 844], [844, 390]]) {
        const ctx = await profile(browser, { viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
        const page = await joinRoom(ctx, invite, `Phone${w}`)
        const button = page.locator('#hud .corner [data-a="friends"]')
        const b = await button.boundingBox()
        const free = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-a'), { x: b.x + b.width / 2, y: b.y + b.height / 2 })
        report(free === 'friends', `${w}×${h}: 👥 is on top, under no touch control`)
        // the friends' names: 14 px on a phone, and inside the screen when shown (plan 16 §4)
        const d = await until(() => dress(page), (d) => d.others.length > 0 && d.others.every((o) => o.tag.ring), 8000)
        const fits = d.others.every((o) => o.tag.font === '14px' && (!o.tag.visible || (o.tag.x >= 0 && o.tag.y >= 0 && o.tag.x + o.tag.w <= w && o.tag.y + o.tag.h <= h)))
        report(d.others.length > 0 && fits, `${w}×${h}: friends' names are 14 px, and inside the screen when shown`, d.others.map((o) => `${o.name} ${o.tag.font}${o.tag.visible ? ` at ${o.tag.x},${o.tag.y} ${o.tag.w}×${o.tag.h}` : ' (not in view)'}`).join(', '))
        await button.tap()
        const panel = page.locator('p3p2-panel')
        await page.getByPlaceholder('Say something…').waitFor({ timeout: 10000 })
        const box = await page.evaluate(() => {
            const el = document.querySelector('p3p2-panel')
            const inner = el && (el.shadowRoot ? el.shadowRoot.querySelector('*:not(style)') : el)
            const r = (inner || el).getBoundingClientRect()
            return [r.left, r.top, r.right, r.bottom]
        })
        report(box[0] >= 0 && box[1] >= 0 && box[2] <= w + 1 && box[3] <= h + 1, `${w}×${h}: the panel fits the screen`, box.map(Math.round).join(','))
        await page.getByPlaceholder('Say something…').fill(`hello from ${w}`)
        await page.getByRole('button', { name: 'Send' }).tap()
        if (host2) {
            const said = await until(() => host2.evaluate(() => window.game.net.room.chat.messages.map((m) => m.text)), (m) => m.includes(`hello from ${w}`), 8000)
            report(said.includes(`hello from ${w}`), `${w}×${h}: chat from the phone arrives`)
        }
        await page.screenshot({ path: join(shots, `phone-${w}x${h}.jpg`), quality: 80 })
        void panel
        await page.close()
    }
})

// ---- another browser engine ---------------------------------------------------------------------

if (args.firefox) await part('firefox', async () => {
    const fx = await firefox.launch({ headless: true })
    const ctx = await fx.newContext({ viewport: { width: 1280, height: 720 } })
    contexts.push(ctx)
    const page = await joinRoom(ctx, invite, 'Fox')
    const land = (p) => p.evaluate(() => {
        const g = window.game
        const half = g.world.half
        let h = 0, s = 12345
        const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296)
        for (let i = 0; i < 3000; i++) {
            const x = Math.floor((rnd() * 2 - 1) * half), z = Math.floor((rnd() * 2 - 1) * half)
            const top = g.world.surfaceY(x, z)
            h = (Math.imul(h, 31) + top) | 0
            for (const dy of [-3, -1, 0, 2]) h = (Math.imul(h, 31) + g.world.gen.blockAt(x, top + dy, z)) | 0
        }
        return h
    })
    const [c, f] = [await land(grace.page), await land(page)]
    report(c === f, 'Chrome and Firefox build the same land, at 3,000 places', `${c} / ${f}`)
    const prints = await until(() => Promise.all([grace.page, page].map(fingerprint)), (v) => same(v[0], v[1]), 15000)
    report(same(prints[0], prints[1]), 'and hold the same town', JSON.stringify(prints[1]))
    const c4 = await groundCell(page, 2, -2)
    await place(page, 'cobble', c4)
    const cobble = blockId('cobble')
    const there = await until(() => blockAt(grace.page, c4), (b) => b === cobble, 8000)
    report(there === cobble, 'a block placed in Firefox is there in Chrome')
    await fx.close()
})

// ---- what it costs ------------------------------------------------------------------------------

if (args.measure) await part('measure', async () => {
    // Nothing else open, and a browser of its own for each player and each load (as the load test
    // has): the pages of one browser share its frames, and the other players' pages its time
    for (const c of contexts.splice(0)) await c.close().catch(() => { })
    const own = async (opts) => {
        const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', ...LAUNCH })
        browsers.push(b)
        return profile(b, opts)
    }
    // from an invite link to playable, on the load test's phone (tools/perf/load-test.mjs: 10 Mbps
    // down, 70 ms, the CPU 4× slower), with the room's server on this network. Nobody else is in
    // the room by now: whoever comes in loads the room's world and runs it
    const times = []
    for (let i = 0; i < 5; i++) {
        const ctx = await own({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2.6 })
        const page = await ctx.newPage()
        const cdp = await ctx.newCDPSession(page)
        await cdp.send('Network.enable')
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 70, downloadThroughput: (10 * 1024 * 1024) / 8, uploadThroughput: (3 * 1024 * 1024) / 8 })
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
        await page.goto(invite)
        await page.getByRole('button', { name: 'Join', exact: true }).waitFor({ timeout: 15000 })
        await page.getByLabel('Your name').fill(`Timed${i}`)
        await page.getByRole('button', { name: 'Join', exact: true }).click()
        const clicked = await page.evaluate(() => performance.now())
        await playable(page)
        const t = await page.evaluate(() => ({ playable: window.__timings.playable, menu: window.__timings.menuInteractive }))
        times.push({ join: (t.playable - clicked) / 1000, all: t.playable / 1000 })
        await ctx.close()
        await ctx.browser().close()
    }
    times.sort((a, b) => a.all - b.all)
    const mid = times[2]
    report(mid.all < 3, 'a phone opens an invite and plays within the spec\'s 3 s, the "Join?" answered at once', `median of 5 ${mid.all.toFixed(2)} s from opening the link (${times[0].all.toFixed(2)}–${times[4].all.toFixed(2)}), ${mid.join.toFixed(2)} s from Join`)
    // a night with three players: frames on each page, and what each sends and gets a second
    const room = await makeRoom('Measure ' + Date.now().toString(36))
    const hp = await open(await own(), GAME, 'M-host')
    const inv = await host(hp, room, 'Host')
    await hp.click('[data-go="play"]', { force: true })
    await playable(hp)
    await until(() => hp.evaluate(() => !!window.game.net.sync.room), (v) => v, 15000)
    const g1 = await joinRoom(await own(), inv, 'Guest1')
    const g2 = await joinRoom(await own(), inv, 'Guest2')
    const players = [hp, g1, g2]
    const traffic = players.map(() => ({ sent: 0, got: 0, framesSent: 0, framesGot: 0 }))
    for (const [i, p] of players.entries()) {
        const cdp = await p.context().newCDPSession(p)
        await cdp.send('Network.enable')
        const size = (e) => (e.response.opcode === 2 ? Math.floor(e.response.payloadData.length * 3 / 4) : Buffer.byteLength(e.response.payloadData))
        cdp.on('Network.webSocketFrameSent', (e) => {
            if (!traffic[i].on) return
            traffic[i].sent += size(e)
            traffic[i].framesSent++
        })
        cdp.on('Network.webSocketFrameReceived', (e) => {
            if (!traffic[i].on) return
            traffic[i].got += size(e)
            traffic[i].framesGot++
        })
    }
    await hp.evaluate(() => window.game.startNight(6))
    await until(() => phase(g2), (p) => p === 'night', 20000)
    // a late night's crowd: 40 more, all round the town, on their way in
    await hp.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        const kinds = ['grunt', 'grunt', 'raider', 'brute', 'sapper', 'pyro']
        for (let i = 0; i < 40; i++) {
            const a = (i / 40) * Math.PI * 2, x = tc[0] + Math.sin(a) * 34, z = tc[2] + Math.cos(a) * 34
            const u = g.units.spawn(kinds[i % kinds.length], [x, g.world.surfaceY(Math.floor(x), Math.floor(z)) + 0.5, z])
            u.maxHp = u.hp = u.maxHp * 4
        }
    })
    await hp.waitForTimeout(8000)
    for (const p of players) await p.evaluate(() => {
        window.__frames = 0
        const count = () => {
            window.__frames++
            requestAnimationFrame(count)
        }
        requestAnimationFrame(count)
    })
    for (const t of traffic) t.on = true
    const T = 20
    await hp.waitForTimeout(T * 1000)
    for (const t of traffic) t.on = false
    const fps = await Promise.all(players.map((p) => p.evaluate((T) => window.__frames / T, T)))
    const attackers = await hp.evaluate(() => window.game.units.aliveAttackers())
    const names = ['host', 'guest', 'guest']
    for (const [i, t] of traffic.entries()) {
        console.log(`     ${names[i].padEnd(6)} ${fps[i].toFixed(0).padStart(3)} fps   sends ${(t.framesSent / T).toFixed(1)} frames, ${(t.sent / T / 1024).toFixed(2)} KB a second   gets ${(t.framesGot / T).toFixed(1)} frames, ${(t.got / T / 1024).toFixed(2)} KB a second`)
    }
    report(fps.every((f) => f > 25), 'a night with three players on one machine: every page draws smoothly', `${attackers} attackers, ${fps.map((f) => f.toFixed(0)).join(' / ')} fps`)
    const most = Math.max(...traffic.map((t) => (t.sent + t.got) / T / 1024))
    report(most < 40, 'and no player sends and gets more than a modest connection carries', `${most.toFixed(1)} KB/s at most`)
})

// ---- done -------------------------------------------------------------------------------------

for (const c of contexts) await c.close().catch(() => { })
for (const b of browsers) await b.close().catch(() => { })
await browser.close()
game.close()
p3p2.kill()
if (!args.keep) rmSync(dataDir, { recursive: true, force: true })
console.log(bad ? `\n${bad} failed` : '\nall passed')
process.exit(bad ? 1 : 0)
