/*
 *  Nobody stands in the ground (plan 13 §1.4). On every tick, every living unit
 *  whose feet are in a solid block is counted: in terrain that's loaded (what
 *  you'd see: buried to the waist) and in terrain that isn't (where it is when
 *  the terrain loads under it). The test is the game's own `buriedDepth`
 *  (src/game/units.js), injected into the page, against the world's own blocks
 *  (loaded chunks, else the generator with the edits and the damage).
 *
 *  Each run plays, in one game, without the bot:
 *    1. the opening raid and its dawn
 *    2. night 9 (sappers and fire mages) watched from above, and its dawn
 *    3. night 5, and its dawn ended with Skip (N) as soon as it starts
 *  A night still on after --night-cap seconds is ended by knocking the Town
 *  Center down (a lost night: the winners cheer, then the rebuild).
 *
 *  The first buried unit of a run is framed from above and saved as a picture.
 *
 *  Usage: node tools/autoplay/buried-check.mjs [--no-build] [--dist=<dir>]
 *           [--quality=low,med,high] [--worlds=default,large] [--out=recordings/buried13]
 *           [--night-cap=150] [--port=4194]
 *  Exits non-zero when any unit was buried on any tick.
 */

import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'
import { buriedDepth, BURIED_SLACK } from '../../src/game/ground.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'buried13')
mkdirSync(out, { recursive: true })
const dist = args.dist ? resolve(String(args.dist)) + '/' : DIST
if (!args.dist && (!args['no-build'] || !existsSync(join(DIST, 'index.html')))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const qualities = String(args.quality || 'low,med,high').split(',')
const worlds = String(args.worlds || 'default,large').split(',')
const nightCap = Number(args['night-cap'] || 150)

const server = await serveDist({ port: Number(args.port || 4194), dir: dist })
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
})

/** the check, run in the page after every tick of the game */
const HOOK = `(() => {
    const BURIED_SLACK = ${BURIED_SLACK}
    const buriedDepth = ${buriedDepth.toString()}
    const g = window.game
    const B = window.__buried = { ticks: 0, samples: 0, unloadedSamples: 0, buried: 0, buriedLoaded: 0, buriedUnloaded: 0,
        maxDepth: 0, units: 0, byPhase: {}, events: [], first: null, scene: '', scenes: {} }
    const seen = new Set()
    const solid = (x, y, z) => g.noa.registry.getBlockSolidity(g.world.peek(x, y, z))
    const orig = g.tick.bind(g)
    g.tick = (dt) => {
        orig(dt)
        B.ticks++
        // what each scene went through: its ticks, the phases seen and the most attackers out at once
        const sc = (B.scenes[B.scene] ||= { ticks: 0, phases: {}, attackers: 0 })
        sc.ticks++
        sc.phases[g.cycle.phase] = (sc.phases[g.cycle.phase] || 0) + 1
        sc.attackers = Math.max(sc.attackers, g.units.aliveAttackers())
        for (const u of g.units.units) {
            if (!u.alive || !u.active) continue
            const p = g.units.posOf(u)
            const loaded = g.units.chunkLoaded(p[0], p[1] - 0.5, p[2])
            B.samples++
            if (!loaded) B.unloadedSamples++
            const d = buriedDepth(solid, p)
            if (d <= 0) continue
            B.buried++
            if (loaded) B.buriedLoaded++
            else B.buriedUnloaded++
            B.maxDepth = Math.max(B.maxDepth, d)
            const phase = g.cycle.phase
            B.byPhase[phase] = (B.byPhase[phase] || 0) + 1
            if (!seen.has(u)) {
                seen.add(u)
                B.units++
                const e = { scene: B.scene, phase, t: +g.cycle.t.toFixed(2), type: u.type, side: u.side, loaded,
                    depth: +d.toFixed(2), pos: p.map((v) => +v.toFixed(2)), rebuilt: g.rebuild.done }
                if (B.events.length < 40) B.events.push(e)
                if (!B.first && loaded) B.first = e
            }
        }
    }
})()`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** wait for a phase, taking the first buried unit's picture on the way */
async function until(page, test, seconds, shot) {
    const from = Date.now()
    for (;;) {
        if (await page.evaluate(test)) return true
        await shot()
        if (Date.now() - from > seconds * 1000) return false
        await sleep(250)
    }
}

/** a night: up to `nightCap` s, then the Town Center goes (a lost night) */
async function playNight(page, level, shot) {
    await page.evaluate((n) => {
        const g = window.game
        g.hud.closePanel()
        g.hud.hideBanner()
        g.cycle.day = n
        g.cycle.nightLevel = n
        g.startNight(n)
    }, level)
    await until(page, () => window.game.cycle.phase === 'night', 30, shot)
    // watch from above: the builder fights on its own, terrain loads round the camera
    await page.evaluate(() => {
        const c = window.game.control
        c.enterAerial()
        c.frameFront(window.game.waves.angle ?? 0, true)
    }).catch(() => {})
    const ended = await until(page, () => window.game.cycle.phase !== 'night', nightCap, shot)
    if (!ended) await page.evaluate(() => (window.game.units.town.hp = 0))
    await until(page, () => window.game.cycle.phase !== 'night', 20, shot)
}

const results = []
for (const world of worlds) {
    for (const quality of qualities) {
        const name = `${world}-${quality}`
        const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.goto(`${server.url}?quality=${quality}`)
        await page.waitForSelector('[data-go="play"]', { state: 'visible', timeout: 60000 })
        if (world === 'large') {
            await page.click('[data-go="new"]')
            await page.fill('.f-name', 'buried check')
            await page.fill('.f-seed', 'buried-13')
            await page.selectOption('.f-size', '256')
            await page.click('[data-go="create"]')
        } else await page.click('[data-go="play"]')
        await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
        await page.addScriptTag({ content: HOOK })

        let shotTaken = false
        const shot = async () => {
            if (shotTaken) return
            const first = await page.evaluate(() => window.__buried.first)
            if (!first) return
            shotTaken = true
            // frame it from above, close in
            await page.evaluate((p) => {
                const c = window.game.control
                if (c.mode !== 'aerial') c.enterAerial()
                c.orbit = c.glide = null
                Object.assign(c.aerial, { x: p[0], y: p[1] + 1, z: p[2], zoom: 9, shown: 9, pitch: 0.45, tx: undefined, tz: undefined })
            }, first.pos)
            await sleep(700)
            await page.screenshot({ path: join(out, `${name}-first.jpg`), type: 'jpeg', quality: 80 })
        }

        const scene = (s) => page.evaluate((s) => (window.__buried.scene = s), s)
        await scene('opening')
        await until(page, () => window.game.cycle.phase === 'dawn', 200, shot)
        await scene('opening dawn')
        await until(page, () => window.game.cycle.phase === 'day', 60, shot)
        await scene('night 9')
        await playNight(page, 9, shot)
        await scene('night 9 dawn')
        await until(page, () => window.game.cycle.phase === 'day', 60, shot)
        await scene('night 5')
        await playNight(page, 5, shot)
        await scene('night 5 dawn (Skip)')
        await page.evaluate(() => window.game.skipDawn())
        await until(page, () => window.game.cycle.phase === 'day', 30, shot)
        await scene('day')
        await sleep(3000)
        await shot()

        const r = await page.evaluate(() => ({ ...window.__buried, tier: window.game.tier?.name }))
        r.name = name
        r.errors = errors.slice(0, 5)
        results.push(r)
        console.log(`${r.buried ? 'FAIL' : 'ok  '} ${name}: ${r.ticks} ticks, ${r.samples} unit-ticks (${r.unloadedSamples} in unloaded terrain): ` +
            `${r.buried} buried (${r.buriedLoaded} loaded, ${r.buriedUnloaded} not), ${r.units} units, deepest ${r.maxDepth.toFixed(2)}` +
            (errors.length ? ` · ${errors.length} page errors` : ''))
        for (const [name, sc] of Object.entries(r.scenes)) console.log(`      ${name.padEnd(20)} ${String(sc.ticks).padStart(6)} ticks, up to ${sc.attackers} attackers, ${Object.entries(sc.phases).map(([p, n]) => `${p} ${n}`).join(', ')}`)
        for (const e of r.events.slice(0, 6)) console.log('     ', JSON.stringify(e))
        await context.close()
    }
}
writeFileSync(join(out, 'buried.json'), JSON.stringify(results, null, 1))
await browser.close()
server.close()
process.exit(results.some((r) => r.buried) ? 1 : 0)
