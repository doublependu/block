/*
 *  Plan 12's effects, looked at and measured without playing (plan 12 §5.2, §8):
 *
 *    fireball  a fire mage throwing at a wall: its beats caught at set points
 *              (the gathering, the arc, the three lumps, the ring, the crater
 *              and its scorch), on one sheet
 *    frost     a frost tower and an ice wall at work: an ice arrow in flight,
 *              attackers frozen against the ice, a frozen sapper's keg going
 *              off short of the wall, and the ×1.5 measured on a frozen brute
 *    volley    three fire mages throwing at once on a phone (390 × 844, the CPU
 *              4× slower): frame times with and without them
 *
 *  Like the lab it writes game state directly, so it's a development tool.
 *
 *  Usage: node tools/autoplay/fx12.mjs [--no-build] [--out=recordings/lab12] [--only=fireball,frost,volley]
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { skipToDay } from './lab.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'lab12')
const only = args.only ? new Set(String(args.only).split(',')) : null
const want = (part) => !only || only.has(part)
mkdirSync(out, { recursive: true })
if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4197) })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] })

const tile = (files, labels, cols, sheet) => {
    // drawtext reads a colon as the end of its text, and a quote as the end of the quoting
    const safe = (label) => label.replace(/:/g, ' -').replace(/'/g, '')
    const vf = (label) => `scale=960:-2,drawtext=text='${safe(label)}':x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6`
    const tmp = files.map((f, i) => {
        const o = f.replace(/\.png$/, '-t.png')
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', vf(labels[i]), o])
        return o
    })
    const layout = tmp.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|')
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...tmp.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${tmp.length}:layout=${layout}:fill=black`, '-q:v', '3', join(out, sheet)])
    console.log(`${sheet}: ${files.length} frames`)
}

/** a game on the default world at day 1, the HUD hidden */
async function open(viewport = { width: 1280, height: 720 }) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(server.url + '?quality=high&tips=0')
    await page.click('[data-go="play"]')
    await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
    await skipToDay(page)
    await page.evaluate(() => {
        document.getElementById('hud').style.visibility = 'hidden'
        // a helper in the page: pause the game the frame a condition holds
        window.__pauseWhen = (src) => new Promise((resolve) => {
            const test = new Function('g', `return (${src})`)
            const g = window.game
            const step = () => {
                if (test(g)) {
                    g.setPaused(true)
                    resolve(true)
                } else requestAnimationFrame(step)
            }
            step()
        })
    })
    return { page, ctx }
}

const aerial = (page, view) => page.evaluate((v) => {
    const c = window.game.control
    if (c.mode !== 'aerial') c.enterAerial()
    Object.assign(c.aerial, { ...v, tx: v.x, tz: v.z, shown: v.zoom })
    c.glide = null
    c.orbit = null
}, view)

/** catch moments: for each [label, condition], pause when it holds, shoot, resume */
async function catchBeats(page, beats, prefix) {
    const files = [], labels = []
    for (const [label, cond] of beats) {
        const ok = await Promise.race([page.evaluate((c) => window.__pauseWhen(c), cond), new Promise((r) => setTimeout(() => r(false), 20000))])
        if (!ok) {
            console.log(`missed: ${label}`)
            continue
        }
        await page.waitForTimeout(120)
        const f = join(out, `${prefix}-${files.length}.png`)
        await page.screenshot({ path: f })
        files.push(f)
        labels.push(label)
        await page.evaluate(() => window.game.setPaused(false))
    }
    return { files, labels }
}

// ---- the fireball's beats ---------------------------------------------------------------
if (want('fireball')) {
    const { page, ctx } = await open()
    await page.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        const z = tc[2] + 18
        const y = g.world.surfaceY(tc[0], z)
        for (let x = -4; x <= 4; x++) for (let k = 0; k < 3; k++) g.sync.submit({ t: 'block', x: tc[0] + x, y: y + k, z, b: k === 0 ? 'stone_wall' : 'snow_brick' })
        g.units.combat = true
        const pz = tc[2] + 29
        window.__pyro = g.units.spawn('pyro', [tc[0] + 0.5, g.world.surfaceY(tc[0], pz), pz + 0.5])
    })
    await aerial(page, { x: 3, y: 10, z: 24, heading: -Math.PI / 2, zoom: 17, pitch: 0.28 })
    const { files, labels } = await catchBeats(page, [
        ['the wind-up: a ball gathers at the staff', '[...g.fireballs.gathers.values()].some((x) => x.t > 0.9)'],
        ['the lob: a coal with a flame on it', 'g.fireballs.casts.some((k) => k.t / k.T > 0.25)'],
        ['heating up on the way in', 'g.fireballs.casts.some((k) => k.t / k.T > 0.75)'],
        ['the fireball: three lumps (0.1 s)', 'g.fireballs.bursts.some((b) => b.t > 0.1)'],
        ['the ring rolling out (0.3 s)', 'g.fireballs.bursts.some((b) => b.t > 0.3)'],
        ['holding, then going (0.6 s)', 'g.fireballs.bursts.some((b) => b.t > 0.6)'],
        ['the crater and its scorch (2 s)', 'g.fireballs.marks.some((m) => m.t > 2)'],
    ], 'fireball')
    tile(files, labels, 2, 'sheet-fireball.jpg')
    const st = await page.evaluate(() => ({ stats: window.game.units.stats, damage: window.game.world.damageCount }))
    console.log('fireball:', JSON.stringify(st))
    await ctx.close()
}

// ---- frost ------------------------------------------------------------------------------
if (want('frost')) {
    const { page, ctx } = await open()
    await page.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        const z = tc[2] + 18
        const at = (x, z) => g.world.surfaceY(tc[0] + x, tc[2] + z)
        // an ice wall, and a frost tower behind it
        for (let x = -5; x <= 5; x++) for (let k = 0; k < 2; k++) g.sync.submit({ t: 'block', x: tc[0] + x, y: at(x, 18) + k, z, b: k === 0 ? 'ice' : 'snow_brick' })
        const fy = at(6, 15)
        g.sync.submit({ t: 'block', x: tc[0] + 6, y: fy, z: tc[2] + 15, b: 'cobble' })
        g.sync.submit({ t: 'block', x: tc[0] + 6, y: fy + 1, z: tc[2] + 15, b: 'cobble' })
        g.sync.submit({ t: 'block', x: tc[0] + 6, y: fy + 2, z: tc[2] + 15, b: 'frost_tower' })
        g.units.combat = true
        // what the ×1.5 does: every hit on an attacker, frozen or not
        window.__hits = []
        g.units.on('hit', (u, amount, source, frozen) => { if (u.side === 'attacker') window.__hits.push({ type: u.type, amount, frozen: !!frozen }) })
        const spawn = (type, x, z) => g.units.spawn(type, [tc[0] + x + 0.5, at(x, z), tc[2] + z + 0.5])
        for (const x of [-3, -1, 1]) spawn('grunt', x, 25)
        window.__brute = spawn('brute', 3, 27)
        window.__sapper = spawn('sapper', -4, 24)
    })
    await aerial(page, { x: 0, y: 10, z: 20, heading: Math.PI * 0.75, zoom: 16, pitch: 0.42 })
    const { files, labels } = await catchBeats(page, [
        ['an ice arrow from the frost tower', 'g.effects.projectiles.some((p) => p.kind === "ice_arrow")'],
        ['frozen: no moving, no blows', 'g.units.units.filter((u) => u.frozenT > 0.5).length >= 2'],
        ['the brute frozen', 'window.__brute.alive && window.__brute.frozenT > 0.3'],
        ["the sapper's keg lit", '!!window.__sapper.charge'],
        ['shattering free', 'g.units.units.some((u) => u.frostImmuneT > 2.85)'],
    ], 'frost')
    await page.waitForTimeout(6000)
    files.push(join(out, `frost-${files.length}.png`))
    await page.screenshot({ path: files[files.length - 1] })
    labels.push('after: what the keg did')
    tile(files, labels, 2, 'sheet-frost.jpg')
    const hits = await page.evaluate(() => window.__hits)
    const byKind = {}
    for (const h of hits.filter((h) => h.type === 'brute')) {
        const k = h.frozen ? 'frozen' : 'not frozen'
        byKind[k] = byKind[k] || []
        byKind[k].push(Math.round(h.amount * 10) / 10)
    }
    console.log('hits on the brute by the frost tower (6 a hit, ×0.5 brute armour, ×1.5 frozen):', JSON.stringify(byKind))
    writeFileSync(join(out, 'frost.json'), JSON.stringify({ hits }, null, 1))
    await ctx.close()
}

// ---- three fire mages at once, on a phone -----------------------------------------------
if (want('volley')) {
    const { page, ctx } = await open({ width: 390, height: 844 })
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    const measure = (seconds) => page.evaluate((s) => new Promise((resolve) => {
        const times = []
        let last = performance.now()
        const t0 = last
        const step = (now) => {
            times.push(now - last)
            last = now
            if (now - t0 < s * 1000) requestAnimationFrame(step)
            else {
                times.sort((a, b) => a - b)
                resolve({ frames: times.length, p50: +times[Math.floor(times.length * 0.5)].toFixed(1), p95: +times[Math.floor(times.length * 0.95)].toFixed(1), max: +times[times.length - 1].toFixed(1) })
            }
        }
        requestAnimationFrame(step)
    }), seconds)
    await page.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        const z = tc[2] + 16
        for (let x = -8; x <= 8; x++) for (let k = 0; k < 3; k++) g.sync.submit({ t: 'block', x: tc[0] + x, y: g.world.surfaceY(tc[0] + x, z) + k, z, b: 'snow_brick' })
    })
    await aerial(page, { x: 0, y: 10, z: 20, heading: Math.PI, zoom: 28, pitch: 0.5 })
    await page.waitForTimeout(3000)
    const base = await measure(6)
    await page.evaluate(() => {
        const g = window.game
        const tc = g.world.townCenter
        g.units.combat = true
        for (const x of [-5, 0, 5]) g.units.spawn('pyro', [tc[0] + x + 0.5, g.world.surfaceY(tc[0] + x, tc[2] + 27), tc[2] + 27.5])
    })
    // the casts start about a second after they arrive; measure through three rounds of them
    await page.waitForFunction(() => window.game.fireballs.gathers.size > 0, null, { timeout: 20000 }).catch(() => {})
    const volley = await measure(14)
    const stats = await page.evaluate(() => window.game.units.stats)
    const res = { cpuThrottle: 4, viewport: '390x844', without: base, threeMages: volley, casts: stats }
    console.log('volley (frame ms):', JSON.stringify(res))
    writeFileSync(join(out, 'volley.json'), JSON.stringify(res, null, 1))
    await ctx.close()
}

await browser.close()
server.close()
console.log(`output: ${out}`)
