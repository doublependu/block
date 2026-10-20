/*
 *  Touch that doesn't attack (plan 16 §2): on a phone held upright and held
 *  sideways, a finger held on the look area or on the stick never presses
 *  fire. The builder doesn't swing or dig, the block under the crosshair stays,
 *  and the troop under it isn't picked up. The ⛏ button still digs, ▣ still
 *  places, and a tap from above still builds. At a desktop window, the mouse
 *  still digs.
 *
 *  Usage: node tools/autoplay/touch-check.mjs [--no-build | --dist=<a build>] [--out=recordings/touch16]
 *  Exits non-zero when one fails.
 */

import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { skipToDay } from './lab.mjs'
import { blockId } from '../../src/world/blocks.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'touch16')
mkdirSync(out, { recursive: true })
// --dist: another build (an older one, to see a check fail on what it fixes)
const dist = args.dist ? resolve(String(args.dist)) + '/' : DIST
if (!args.dist && (!args['no-build'] || !existsSync(join(DIST, 'index.html')))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4196), dir: dist })
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
})

const SCREENS = [
    ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
    ['phone-land', { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }],
    ['desktop', { viewport: { width: 1280, height: 720 } }],
]

let bad = 0
const report = (ok, what) => {
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

/**
 * Clear ground away from the town, the builder on it facing +z, and `front`
 * ([dy, block]) placed two cells ahead. Returns the builder's cell.
 */
async function scene(page, front = []) {
    const at = await page.evaluate((front) => {
        const g = window.game
        const tc = g.world.townCenter
        const bx = Math.floor(tc[0] + 22), bz = Math.floor(tc[2] - 14)
        const y = g.world.surfaceY(bx, bz)
        for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 5; dz++) for (let cy = y - 2; cy < y + 4; cy++) {
            g.sync.submit({ t: 'block', x: bx + dx, y: cy, z: bz + dz, b: cy < y ? 'stone' : 'air' })
        }
        for (const [dy, b] of front) g.sync.submit({ t: 'block', x: bx, y: y + dy, z: bz + 2, b })
        g.noa.entities.setPosition(g.player.entity, [bx + 0.5, y, bz + 0.5])
        return { x: bx, y, z: bz }
    }, front)
    // the camera follows the builder a frame or two later
    await page.waitForTimeout(400)
    return at
}

/** look at a point from the eye */
const aim = (page, p) => page.evaluate((p) => {
    const g = window.game
    const e = g.noa.camera.getTargetPosition()
    const dx = p[0] - e[0], dy = p[1] - e[1], dz = p[2] - e[2]
    g.noa.camera.heading = Math.atan2(dx, dz)
    g.noa.camera.pitch = -Math.atan2(dy, Math.hypot(dx, dz))
}, p)

const blockAt = (page, c) => page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]), c)

/** record, every 30 ms, whether fire was down or the builder dug or swung */
const startProbe = (page) => page.evaluate(() => {
    const g = window.game
    const seen = { fire: false, dig: false, swing: false }
    const cool = g.player.cooldown
    const id = setInterval(() => {
        if (g.noa.inputs.state.fire) seen.fire = true
        if (g.control.chopping || g.control.mining) seen.dig = true
        if (g.player.cooldown > cool + 0.01) seen.swing = true
    }, 30)
    window.__probe = { seen, stop: () => clearInterval(id) }
})
const stopProbe = (page) => page.evaluate(() => {
    window.__probe.stop()
    return window.__probe.seen
})

/** a finger held still at (x, y) for `ms` */
async function hold(page, cdp, x, y, ms) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] })
    await page.waitForTimeout(ms)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await page.waitForTimeout(200)
}

/** what is under a screen point: the game's canvas, or the HUD element's class */
const under = (page, x, y) => page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y)
    return el && el.tagName === 'CANVAS' ? 'canvas' : el ? `${el.tagName.toLowerCase()}.${el.className}` : 'nothing'
}, [x, y])

for (const [name, opts] of SCREENS) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...opts })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(server.url)
    await page.waitForSelector('[data-go="play"]')
    if (opts.hasTouch) await page.tap('[data-go="play"]')
    else await page.click('[data-go="play"]')
    await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
    await skipToDay(page)
    const { width: W, height: H } = opts.viewport
    if (opts.hasTouch) {
        // a touch turns the touch controls on, as on a real phone
        await page.touchscreen.tap(W * 0.7, H * 0.3)
    } else {
        // the game takes the pointer on a real click
        await page.mouse.click(W / 2, H / 2)
    }
    await page.waitForTimeout(500)
    await page.evaluate(() => window.game.inventory.selectTool())

    if (!opts.hasTouch) {
        // ---- the desktop: the mouse still digs ----
        const at = await scene(page, [[0, 'stone']])
        const cell = [at.x, at.y, at.z + 2]
        await aim(page, [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5])
        await page.waitForTimeout(200)
        await page.mouse.down()
        const from = Date.now()
        while (Date.now() - from < 5000 && (await blockAt(page, cell)) !== 0) await page.waitForTimeout(100)
        await page.mouse.up()
        report((await blockAt(page, cell)) === 0, `${name}: the left button held on stone digs it out`)
        await ctx.close()
        continue
    }

    const cdp = await ctx.newCDPSession(page)
    const look = [W * 0.62, H * 0.3], stick = [W * 0.15, H * 0.72]
    report((await under(page, ...look)) === 'canvas', `${name}: the look point (${look.map(Math.round)}) is on the game, not the HUD (${await under(page, ...look)})`)
    report((await under(page, ...stick)) === 'canvas', `${name}: the stick point (${stick.map(Math.round)}) is on the game, not the HUD (${await under(page, ...stick)})`)

    // ---- a finger on the look area, then on the stick, with stone under the crosshair ----
    for (const [where, p] of [['the look area', look], ['the stick', stick]]) {
        const at = await scene(page, [[0, 'stone']])
        const cell = [at.x, at.y, at.z + 2]
        await aim(page, [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5])
        await page.waitForTimeout(200)
        await startProbe(page)
        await hold(page, cdp, p[0], p[1], 1500)
        const seen = await stopProbe(page)
        report(!seen.fire && !seen.dig && !seen.swing, `${name}: a finger held on ${where} doesn't fire, dig or swing (${JSON.stringify(seen)})`)
        report((await blockAt(page, cell)) !== 0, `${name}: the stone under the crosshair is still there after a finger on ${where}`)
    }

    // ---- by day, a troop under the crosshair isn't picked up by a touch to look ----
    {
        const at = await scene(page)
        await page.evaluate((at) => window.game.sync.submit({ t: 'unit+', id: 'touch-check-1', type: 'swordsman', pos: [at.x + 0.5, at.y, at.z + 2.5], yaw: Math.PI }), at)
        await page.waitForTimeout(500)
        await aim(page, [at.x + 0.5, at.y + 1.1, at.z + 2.5])
        await page.waitForTimeout(200)
        const had = await page.evaluate(() => window.game.inventory.count('swordsman'))
        await page.touchscreen.tap(...look)
        await page.waitForTimeout(400)
        const placed = await page.evaluate(() => window.game.placements.has('touch-check-1'))
        const now = await page.evaluate(() => window.game.inventory.count('swordsman'))
        report(placed && now === had, `${name}: a tap to look leaves the troop under the crosshair where it is (${placed ? 'placed' : 'picked up'}, ${had} -> ${now} in hand)`)
        await page.evaluate(() => window.game.sync.submit({ t: 'unit-', id: 'touch-check-1' }))
    }

    // ---- ⛏ still digs ----
    {
        const at = await scene(page, [[0, 'stone']])
        const cell = [at.x, at.y, at.z + 2]
        await aim(page, [cell[0] + 0.5, cell[1] + 0.5, cell[2] + 0.5])
        await page.waitForTimeout(200)
        const b = await page.evaluate(() => {
            const r = document.querySelector('.t-fire').getBoundingClientRect()
            return [r.left + r.width / 2, r.top + r.height / 2]
        })
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b[0], y: b[1], id: 8 }] })
        const from = Date.now()
        while (Date.now() - from < 5000 && (await blockAt(page, cell)) !== 0) await page.waitForTimeout(100)
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        report((await blockAt(page, cell)) === 0, `${name}: ⛏ held on stone digs it out`)
    }

    // ---- ▣ still places ----
    {
        const at = await scene(page)
        const floor = [at.x, at.y - 1, at.z + 2], cell = [at.x, at.y, at.z + 2]
        await page.evaluate(() => {
            const inv = window.game.inventory
            inv.add('cobble', 5)
            inv.assign(2, 'cobble')
            inv.select(2)
        })
        await aim(page, [floor[0] + 0.5, floor[1] + 1, floor[2] + 0.5])
        await page.waitForTimeout(200)
        await page.tap('.t-alt')
        await page.waitForTimeout(400)
        report((await blockAt(page, cell)) === blockId('cobble'), `${name}: ▣ places the cobble on the ground ahead`)
        await page.screenshot({ path: join(out, `${name}-placed.png`) })
    }

    // ---- from above, a tap still builds ----
    {
        await scene(page)
        await page.evaluate(() => {
            const g = window.game
            g.inventory.add('cobble', 5)
            g.inventory.select(2)
            g.control.toggleAerial()
        })
        await page.waitForTimeout(1500)
        const had = await page.evaluate(() => window.game.inventory.count('cobble'))
        const p = [W * 0.5, H * 0.55]
        report((await under(page, ...p)) === 'canvas', `${name}: the aerial tap point is on the game (${await under(page, ...p)})`)
        await page.touchscreen.tap(...p)
        await page.waitForTimeout(500)
        const now = await page.evaluate(() => window.game.inventory.count('cobble'))
        report(now === had - 1, `${name}: a tap from above builds one block (${had} -> ${now} cobble)`)
        await page.screenshot({ path: join(out, `${name}-aerial.png`) })
        await page.evaluate(() => window.game.control.toggleAerial())
    }
    await ctx.close()
}

await browser.close()
server.close?.()
console.log(bad ? `${bad} failed` : 'all passed')
process.exit(bad ? 1 : 0)
