/*
 *  The crosshair lands on everything you build (plan 13 §4), in the running
 *  game, by mouse: spikes and a gate with stone behind them are mined (the
 *  spikes or the gate go, and come back to you; the stone stays), spikes are
 *  upgraded with a click, and a spike block has no top face to look at.
 *
 *  Usage: node tools/autoplay/target-check.mjs [--no-build] [--out=recordings/target13]
 *  Exits non-zero when one fails.
 */

import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { skipToDay } from './lab.mjs'
import { blockId } from '../../src/world/blocks.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'target13')
mkdirSync(out, { recursive: true })
if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4195) })
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
})
const page = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } })).newPage()
page.on('pageerror', (e) => console.error('page error:', e.message))
await page.goto(server.url + '?quality=high')
await page.click('[data-go="play"]')
await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
await skipToDay(page)
// the game takes the pointer on a real click
await page.mouse.click(640, 360)
await page.waitForTimeout(500)

let bad = 0
const report = (ok, what) => {
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

/**
 * Clear ground away from the town, the builder on it, `front` placed one and
 * two cells ahead, and the crosshair on the nearer one. Returns the cells.
 */
async function scene(front, { x = 22, z = -14 } = {}) {
    return page.evaluate(({ front, x, z }) => {
        const g = window.game
        const tc = g.world.townCenter
        const bx = Math.floor(tc[0] + x), bz = Math.floor(tc[2] + z)
        const y = g.world.surfaceY(bx, bz)
        for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 5; dz++) for (let cy = y - 2; cy < y + 4; cy++) {
            g.sync.submit({ t: 'block', x: bx + dx, y: cy, z: bz + dz, b: cy < y ? 'stone' : 'air' })
        }
        for (const [dz, dy, b] of front) g.sync.submit({ t: 'block', x: bx, y: y + dy, z: bz + 2 + dz, b })
        g.noa.entities.setPosition(g.player.entity, [bx + 0.5, y, bz + 0.5])
        return { x: bx, y, z: bz }
    }, { front, x, z }).then(async (at) => {
        // the camera follows the builder a frame or two later
        await page.waitForTimeout(400)
        return at
    })
}

/** look at the middle of a cell from the eye */
const aim = (cell) => page.evaluate((c) => {
    const g = window.game
    const e = g.noa.camera.getTargetPosition()
    const dx = c[0] + 0.5 - e[0], dy = c[1] + 0.5 - e[1], dz = c[2] + 0.5 - e[2]
    g.noa.camera.heading = Math.atan2(dx, dz)
    g.noa.camera.pitch = -Math.atan2(dy, Math.hypot(dx, dz))
}, cell)
const target = () => page.evaluate(() => {
    const t = window.game.noa.targetedBlock
    return t ? t.position.slice() : null
})
const count = (item) => page.evaluate((item) => window.game.inventory.count(item), item)
const ID = Object.fromEntries(['stone', 'spikes', 'iron_spikes', 'gate'].map((n) => [n, blockId(n)]))

/** hold the left button until the cell is mined (or give up) */
async function mine(cell, ms = 4000) {
    await page.evaluate(() => window.game.inventory.selectTool())
    await aim(cell)
    await page.waitForTimeout(150)
    await page.mouse.down()
    const from = Date.now()
    while (Date.now() - from < ms) {
        await page.waitForTimeout(100)
        if (await page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]) === 0, cell)) break
    }
    await page.mouse.up()
    await page.waitForTimeout(200)
}

// ---- spikes with stone behind them ----
for (const [label, b, h] of [['spikes', 'spikes', 1], ['a gate', 'gate', 2]]) {
    const at = await scene([...Array.from({ length: h }, (_, i) => [0, i, b]), [1, 0, 'stone'], [1, 1, 'stone']])
    const cell = [at.x, at.y, at.z + 2], behind = [at.x, at.y, at.z + 3]
    await aim(cell)
    await page.waitForTimeout(200)
    const t = await target()
    report(!!t && t.join() === cell.join(), `${label}: the crosshair lands on it, not on the stone behind (${t ? t.join(',') : 'nothing'})`)
    const had = await count(b)
    await mine(cell)
    const gone = await page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]) === 0, cell)
    const stone = await page.evaluate(({ c, id }) => window.game.noa.getBlock(c[0], c[1], c[2]) === id, { c: behind, id: ID.stone })
    report(gone, `${label}: mined, it goes`)
    report(stone, `${label}: the stone behind it stays`)
    report((await count(b)) === had + 1, `${label}: you get it back (${had} -> ${await count(b)})`)
    await page.screenshot({ path: join(out, `mined-${b}.png`) })
}

// ---- spikes upgraded with a click ----
{
    const at = await scene([[0, 0, 'spikes']])
    const cell = [at.x, at.y, at.z + 2]
    await page.evaluate(() => {
        const inv = window.game.inventory
        inv.add('iron_spikes', 1)
        inv.assign(2, 'iron_spikes')
        inv.select(2)
    })
    await aim(cell)
    await page.waitForTimeout(200)
    await page.mouse.click(640, 360, { button: 'right' })
    await page.waitForTimeout(400)
    const now = await page.evaluate((c) => window.game.noa.getBlock(c[0], c[1], c[2]), cell)
    report(now === ID.iron_spikes, `spikes: a click with iron spikes in hand upgrades them in place (${now === ID.iron_spikes ? 'iron spikes' : now})`)
    // from above: no top face, the ground shows between the spikes
    await page.evaluate((c) => {
        const g = window.game
        g.noa.entities.setPosition(g.player.entity, [c[0] + 0.5, c[1] + 1, c[2] - 2.5])
        // a second row of plain spikes beside them, to see both from above
        g.sync.submit({ t: 'block', x: c[0] + 1, y: c[1], z: c[2], b: 'spikes' })
        g.sync.submit({ t: 'block', x: c[0] - 1, y: c[1], z: c[2], b: 'steel_spikes' })
        g.inventory.selectTool()
    }, cell)
    await page.waitForTimeout(400)
    await aim([cell[0], cell[1] - 1, cell[2] + 0.5])
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(out, 'spikes-from-above.png') })
}

await browser.close()
server.close()
console.log(`output: ${out}`)
if (bad) process.exitCode = 1
