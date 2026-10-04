/*
 *  The aerial camera's framing of the town, looked at (plan b2_0 §5):
 *
 *    opening   the opening raid's first view
 *    dawn      the camera circling the town at the dawn after it
 *    close     the aerial view by day as it opens (where blocks are placed from)
 *    build     the aerial view by day, zoomed all the way out
 *    ground    back in first person after it (the tier's own fog and chunks)
 *    wave      a later night's first wave, from above
 *
 *  at three screen shapes (desktop, phone landscape, phone portrait) and the
 *  three quality tiers: one contact sheet per screen shape (rows: tiers,
 *  columns: situations). Each shot also counts the town's chunks that aren't
 *  loaded (the chunks its built blocks are in).
 *
 *  Usage: node tools/autoplay/framing.mjs [--no-build] [--out=recordings/framingb2] [--tiers=low,med,high] [--views=desktop,landscape,portrait]
 *                                          [--world=<id in worlds/, default: the default world>]
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../serve-dist.mjs'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'framingb2')
const TIERS = String(args.tiers || 'low,med,high').split(',')
const VIEWS = {
    desktop: { width: 1920, height: 1080 },
    landscape: { width: 844, height: 390 },
    portrait: { width: 390, height: 844 },
}
const views = String(args.views || Object.keys(VIEWS).join(',')).split(',')
const SITUATIONS = ['opening', 'dawn', 'close', 'build', 'ground', 'wave']
mkdirSync(out, { recursive: true })
if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4198) })
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--use-angle=gl', '--ignore-gpu-blocklist', '--ignore-certificate-errors'] })

/** the town's chunks (those its built blocks are in) that aren't loaded */
const missingChunks = (page) => page.evaluate(() => {
    const g = window.game
    const w = g.noa.world
    const s = w._chunkSize
    const want = new Set()
    g.world.edits.forEach((x, y, z, id) => {
        if (id) want.add(`${Math.floor(x / s)},${Math.floor(y / s)},${Math.floor(z / s)}`)
    })
    const missing = [...want].filter((k) => {
        const [i, j, l] = k.split(',').map(Number)
        return !w._storage.getChunkByIndexes(i, j, l)
    })
    return { total: want.size, missing }
})

/** the camera as it is: what a shot was taken with */
const camState = (page) => page.evaluate(() => {
    const c = window.game.control
    const a = c.aerial
    return { mode: c.mode, zoom: +a.zoom.toFixed(1), shown: +a.shown.toFixed(1), pitch: +a.pitch.toFixed(2), y: +(a.y + a.lift).toFixed(1) }
})

const results = []

async function run(view, tier) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: VIEWS[view] })
    const page = await ctx.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    if (args.world) await page.goto(server.url + `?quality=${tier}&tips=0&play=${args.world}`)
    else {
        await page.goto(server.url + `?quality=${tier}&tips=0`)
        await page.click('[data-go="play"]')
    }
    await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
    const files = {}
    const shoot = async (name) => {
        await page.evaluate(() => (document.getElementById('hud').style.visibility = 'hidden'))
        const f = join(out, `${view}-${tier}-${name}.png`)
        await page.screenshot({ path: f })
        await page.evaluate(() => (document.getElementById('hud').style.visibility = ''))
        files[name] = f
        const r = { view, tier, name, ...(await camState(page)), chunks: await missingChunks(page), fog: await page.evaluate(() => [Math.round(window.game.sky.scene.fogStart), Math.round(window.game.sky.scene.fogEnd)]) }
        results.push(r)
        console.log(`${view} ${tier} ${name}: ${r.mode} zoom ${r.zoom} pitch ${r.pitch} fog ${r.fog.join('-')} · town chunks missing ${r.chunks.missing.length}/${r.chunks.total}${r.chunks.missing.length ? ' (' + r.chunks.missing.join(' ') + ')' : ''}`)
    }
    // the opening raid's first view
    await page.waitForFunction(() => window.game.opening && window.game.cycle.phase === 'night', null, { timeout: 30000 })
    await page.waitForTimeout(4000)
    await shoot('opening')
    // the dawn after it
    await page.evaluate(() => window.game.skipOpening())
    await page.waitForFunction(() => window.game.cycle.phase === 'dawn', null, { timeout: 15000 })
    // a skipped raid leaves little to rebuild: hold the dawn long enough to see it
    await page.evaluate(() => (window.game.cycle.dawn.total = window.game.cycle.t + 60))
    await page.waitForTimeout(4000)
    await shoot('dawn')
    // by day, from above, zoomed all the way out
    await page.evaluate(() => window.game.skipDawn())
    await page.waitForFunction(() => window.game.cycle.phase === 'day', null, { timeout: 30000 })
    await page.evaluate(() => {
        const g = window.game
        g.hud.closePanel()
        g.hud.hideBanner()
        const c = g.control
        if (c.mode !== 'aerial') c.enterAerial()
    })
    await page.waitForTimeout(3000)
    await shoot('close')
    await page.evaluate(() => {
        const c = window.game.control
        for (let i = 0; i < 60; i++) c._zoomAerial(1.12)
    })
    await page.waitForTimeout(4000)
    await shoot('build')
    await page.evaluate(() => {
        const g = window.game
        g.control.returnToSelf()
        g.noa.camera.pitch = 0.05
    })
    await page.waitForTimeout(3000)
    await shoot('ground')
    await page.evaluate(() => {
        const c = window.game.control
        c.enterAerial()
    })
    // a night's first wave, watched from above
    await page.evaluate(() => {
        const g = window.game
        g.control.cameraTouched = 0
        g.requestNight()
        window.__wave = false
        g.waves.once('subwave', () => (window.__wave = true))
    })
    await page.waitForFunction(() => window.__wave, null, { timeout: 60000 })
    await page.waitForTimeout(4000)
    await shoot('wave')
    await ctx.close()
    return files
}

const tile = (files, labels, cols, sheet) => {
    const safe = (label) => label.replace(/:/g, ' -').replace(/'/g, '')
    const vf = (label) => `scale=640:-2,drawtext=text='${safe(label)}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6`
    const tmp = files.map((f, i) => {
        const o = f.replace(/\.png$/, '-t.png')
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', vf(labels[i]), o])
        return o
    })
    const layout = tmp.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|')
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...tmp.flatMap((f) => ['-i', f]), '-filter_complex', `xstack=inputs=${tmp.length}:layout=${layout}:fill=black`, '-q:v', '3', join(out, sheet)])
    console.log(`${sheet}: ${files.length} frames`)
}

try {
    for (const view of views) {
        const files = [], labels = []
        for (const tier of TIERS) {
            const shots = await run(view, tier)
            for (const name of SITUATIONS) {
                if (!shots[name]) continue
                const r = results.find((x) => x.view === view && x.tier === tier && x.name === name)
                files.push(shots[name])
                labels.push(`${tier} · ${name} · zoom ${r.zoom}${r.chunks.missing.length ? ` · ${r.chunks.missing.length} town chunks missing` : ''}`)
            }
        }
        tile(files, labels, SITUATIONS.length, `sheet-${view}.jpg`)
    }
    writeFileSync(join(out, 'framing.json'), JSON.stringify(results, null, 1))
} finally {
    await browser.close()
    server.close()
}
