/*
 *  An attacker you play breaks what it strikes (plan 14 §4), in the running
 *  game, by mouse: at night, a grunt, a brute and a sapper played beside a
 *  cobblestone wall, the button held on it, in first person and in third. The
 *  block cracks, then breaks. A grunt does the same to a gate, a sapper to the
 *  natural ground, and a skeleton archer's arrows chip the wall. And each one
 *  played holds its hold pose (until plan 14 a troop's hold never reached its
 *  bones: its arms hung whatever it held).
 *
 *  Usage: node tools/autoplay/possess-check.mjs [--no-build] [--out=recordings/possess14] [--only=wall|dig|archer] [--trace]
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
const out = args.out || join(ROOT, 'recordings', 'possess14')
mkdirSync(out, { recursive: true })
if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4196) })
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

let bad = 0
const report = (ok, what) => {
    if (!ok) bad++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
}

/**
 * clear ground away from the town, with a row of `b` (two high) three cells ahead of where the
 * unit stands: toward +z, or toward -z with `back` (the old blow read the right cell only one way)
 */
const scene = (b, { x = 22, z = -14, back = false } = {}) => page.evaluate(({ b, x, z, back, stone }) => {
    const g = window.game
    const tc = g.world.townCenter
    const bx = Math.floor(tc[0] + x), bz = Math.floor(tc[2] + z)
    const y = g.world.surfaceY(bx, bz)
    const s = back ? -1 : 1
    for (let dx = -2; dx <= 2; dx++) for (let dz = -1; dz <= 5; dz++) for (let cy = y - 2; cy < y + 4; cy++) {
        g.world.applyBlockEdit(bx + dx, cy, bz + dz * s, cy < y ? stone : 0)
    }
    if (b) for (let dx = -1; dx <= 1; dx++) for (let dy = 0; dy < 2; dy++) g.world.applyBlockEdit(bx + dx, y + dy, bz + 3 * s, b)
    return { x: bx, y, z: bz, s }
}, { b: b && blockId(b), x, z, back, stone: blockId('stone') })

// night: you can only play a troop or an attacker from dusk on
await page.evaluate(() => window.game.startNight())
await page.waitForFunction(() => ['dusk', 'night'].includes(window.game.cycle.phase), null, { timeout: 10000 })

/**
 * play a fresh attacker of `type` standing at `at`, facing +z; nobody else can hurt it. The one
 * played before goes, or troops come out to fight it and take the blows meant for the wall
 */
async function play(type, at) {
    await page.evaluate(({ type, at }) => {
        const g = window.game
        if (window.__played) g.units.remove(window.__played)
        const u = g.units.spawn(type, [at.x + 0.5, at.y, at.z + 0.5], { yaw: 0 })
        u.maxHp = u.hp = 1e6
        window.__played = u
        g.control.possess(u)
    }, { type, at })
    // the camera follows a frame or two later, and the model loads
    await page.waitForTimeout(700)
    if (!(await page.evaluate(() => !!document.pointerLockElement))) await page.mouse.click(640, 360)
    await page.waitForTimeout(300)
}

/** look at a cell from the eye: its middle, give or take `wobble` (m), as a hand on a mouse does */
const aim = (cell, wobble = 0) => page.evaluate(({ c, w }) => {
    const g = window.game
    const e = g.noa.camera.getTargetPosition()
    const r = () => (Math.random() * 2 - 1) * w
    const dx = c[0] + 0.5 + r() - e[0], dy = c[1] + 0.5 + r() - e[1], dz = c[2] + 0.5 - e[2]
    g.noa.camera.heading = Math.atan2(dx, dz)
    g.noa.camera.pitch = -Math.atan2(dy, Math.hypot(dx, dz))
}, { c: cell, w: wobble })

/** what's left of a block: 1 untouched, 0 gone */
const left = (c) => page.evaluate((c) => {
    const g = window.game
    const id = g.noa.getBlock(c[0], c[1], c[2])
    if (!id) return 0
    const hp = g.world.blockHp.get(`${c[0]},${c[1]},${c[2]}`)
    return hp === undefined ? 1 : hp / g.world.maxHp(id)
}, c)

/** hold the button on `cell` until it breaks or `ms` runs out; returns [first crack after (ms), broken after (ms)] */
async function strike(cell, ms) {
    await aim(cell)
    await page.waitForTimeout(150)
    await page.mouse.down()
    const from = Date.now()
    let cracked = -1, broken = -1
    while (Date.now() - from < ms) {
        await aim(cell, 0.3)
        await page.waitForTimeout(100)
        const l = await left(cell)
        if (args.trace) console.log('  ', Date.now() - from, l.toFixed(2), await page.evaluate(() => window.__played.cooldown.toFixed(2)))
        if (cracked < 0 && l < 1) cracked = Date.now() - from
        if (l === 0) {
            broken = Date.now() - from
            break
        }
    }
    await page.mouse.up()
    return [cracked, broken]
}

/** does the played unit's hold pose reach its bones (the upper arm as the hold clip keys it)? */
const holding = () => page.evaluate(() => {
    const c = window.__played.char
    const g = c.hold && c.groups[c.hold]
    if (!g) return { hold: c.hold, ok: false }
    const n = c.root.getChildTransformNodes(false).find((n) => n.name === 'upper_arm.R')
    const ta = g.targetedAnimations.find((t) => t.target === n && t.animation.targetProperty === 'rotationQuaternion')
    const k = ta.animation.getKeys()[0].value, q = n.rotationQuaternion
    return { hold: c.hold, ok: Math.abs(k.x * q.x + k.y * q.y + k.z * q.z + k.w * q.w) > 0.999 }
})

const view = (third) => page.evaluate((third) => {
    const c = window.game.control
    if (c.thirdPerson !== third) c.toggleView()
}, third)

for (const third of [false, true]) {
    await view(third)
    const v = third ? 'third person' : 'first person'
    const walls = [['grunt', 'cobble', 14000, false], ['grunt', 'cobble', 14000, true], ['brute', 'cobble', 6000, false], ['sapper', 'cobble', 8000, false], ['grunt', 'gate', 12000, true]]
    if (!args.only || args.only === 'wall') for (const [type, b, ms, back] of walls) {
        const at = await scene(b, { back })
        await play(type, at)
        if (!third && !back) {
            const h = await holding()
            report(h.ok, `${v}: a ${type} you play holds its ${h.hold} (the pose reaches its arms)`)
        }
        if (back) await page.evaluate(() => (window.game.noa.camera.heading = Math.PI))
        const cell = [at.x, at.y + 1, at.z + 3 * at.s]
        const [cracked, broken] = await strike(cell, ms)
        // one blow fells it (the brute's on cobblestone), or it cracks first and breaks blow by blow
        const ok = broken >= 0 && cracked >= 0 && (type === 'brute' || cracked < broken)
        const t = (ms) => (ms < 0 ? 'never' : `after ${(ms / 1000).toFixed(1)} s`)
        report(ok, `${v}: a ${type} facing ${back ? '-z' : '+z'} breaks a ${b} it strikes (cracked ${t(cracked)}, broken ${t(broken)})`)
        if (!third && !back) await page.screenshot({ path: join(out, `${type}-${b}.png`) })
    }
    // a sapper digs the ground too; nobody else does
    if (!args.only || args.only === 'dig') for (const [type, digs] of [['sapper', true], ['grunt', false]]) {
        const at = await scene(null)
        await play(type, at)
        const cell = [at.x, at.y - 1, at.z + 2]
        const [cracked, broken] = await strike(cell, 8000)
        report(digs ? broken >= 0 : cracked < 0, `${v}: a ${type} ${digs ? 'digs' : "doesn't dig"} the natural ground (${broken >= 0 ? 'dug' : cracked >= 0 ? 'cracked' : 'untouched'})`)
    }
}

// a skeleton archer's arrows chip a wall
if (!args.only || args.only === 'archer') {
    await view(false)
    const at = await scene('cobble', { x: 22, z: -24 })
    await page.evaluate((at) => {
        // stand it back from the wall: an arrow needs room to fly
        const g = window.game
        for (let dz = -6; dz < 0; dz++) for (let cy = at.y; cy < at.y + 3; cy++) for (let dx = -1; dx <= 1; dx++) g.world.applyBlockEdit(at.x + dx, cy, at.z + dz, 0)
    }, at)
    await play('raider', { ...at, z: at.z - 4 })
    const cell = [at.x, at.y + 1, at.z + 3]
    const [cracked] = await strike(cell, 8000)
    report(cracked >= 0, `first person: a skeleton archer's arrows chip the wall (${cracked >= 0 ? `after ${(cracked / 1000).toFixed(1)} s` : 'untouched'})`)
}

await browser.close()
server.close()
console.log(bad ? `${bad} failed` : 'all passed')
process.exit(bad ? 1 : 0)
