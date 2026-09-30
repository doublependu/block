/*
 *  Looks at castle sites and castle designs without playing (plan 10 §3.3–3.4).
 *
 *    --seeds=a,b,c   a fresh world per seed, from the menu, seen from above from
 *                    four sides: which site to build on
 *    --blueprint     the castle blueprint written straight into the world (lab
 *                    only: a recorded game builds it block by block), seen from
 *                    the photo's viewpoint and from around, next to ref/castle.jpg
 *                    in compare.jpg (a local picture for choosing, never shown in
 *                    the video)
 *
 *  Usage: node tools/autoplay/castle/preview.mjs [--seeds=swan-rock-2946] [--blueprint] [--seed=<castle seed>]
 *                                                [--no-build] [--out=<dir>] [--headed]
 *  Output: <out>/ (default recordings/castle10/)
 */

import { chromium } from 'playwright-core'
import { execSync, execFileSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { serveDist, DIST } from '../../serve-dist.mjs'
import { buildCastle, SEED } from './blueprint.js'
import { createGenerator } from '../../../src/world/gen/index.js'

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]))
const ROOT = new URL('../../../', import.meta.url).pathname
const out = args.out || join(ROOT, 'recordings', 'castle10')
mkdirSync(out, { recursive: true })

if (!args['no-build'] || !existsSync(join(DIST, 'index.html'))) {
    console.log('building…')
    execSync('npm run build', { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
}
const server = await serveDist({ port: Number(args.port || 4195) })
const browser = await chromium.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: !args.headed,
    args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--ignore-certificate-errors', ...(args.headed ? [] : ['--use-angle=gl'])],
})
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 })

/** a fresh world from the menu (no opening raid), on day 1, the HUD hidden */
async function openWorld(seed) {
    const page = await context.newPage()
    page.on('pageerror', (e) => console.error('page error:', e.message))
    await page.goto(server.url + '?quality=high&intro=0&tips=0')
    await page.click('[data-go="new"]')
    await page.fill('.f-seed', seed)
    await page.fill('.f-name', 'Castle site')
    await page.click('[data-go="create"]')
    await page.waitForFunction(() => window.__timings && window.__timings.playable > 0, null, { timeout: 180000 })
    await page.evaluate(() => {
        document.getElementById('hud').style.visibility = 'hidden'
        const g = window.game
        // light the scene like the photo: late morning
        g.cycle.t = g.cycle.dayLength * 0.3
    })
    return page
}

/** the aerial camera looking at (x, y, z) from `heading`, `zoom` blocks back, `pitch` down */
async function look(page, { x, y, z, heading, zoom, pitch, wait = 2500 }) {
    await page.evaluate(({ x, y, z, heading, zoom, pitch }) => {
        const c = window.game.control
        if (c.mode !== 'aerial') c.enterAerial()
        Object.assign(c.aerial, { x, y, z, tx: x, tz: z, zoom, shown: zoom, pitch, heading })
        c.glide = null
        c.orbit = null
    }, { x, y, z, heading, zoom, pitch })
    await page.waitForTimeout(wait)
}

const tile = (files, labels, cols, sheet) => {
    const vf = (label) => `scale=960:-2,drawtext=text='${label}':x=10:y=10:fontsize=24:fontcolor=white:box=1:boxcolor=black@0.6`
    const tmp = files.map((f, i) => {
        const o = f.replace(/\.(png|jpg)$/, '-t.png')
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-vf', vf(labels[i]), o])
        return o
    })
    const layout = tmp.map((_, i) => `${(i % cols) ? Array.from({ length: i % cols }, () => 'w0').join('+') : '0'}_${Math.floor(i / cols) ? Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+') : '0'}`).join('|')
    execFileSync('ffmpeg', ['-v', 'error', '-y', ...tmp.flatMap((f) => ['-i', f]),
        '-filter_complex', tmp.length > 1 ? `xstack=inputs=${tmp.length}:layout=${layout}:fill=black` : 'null', '-q:v', '3', join(out, sheet)])
    console.log(`${sheet}: ${files.length} views`)
}

// ---- sites -------------------------------------------------------------------------
if (args.seeds) {
    for (const seed of String(args.seeds).split(',')) {
        const page = await openWorld(seed)
        const files = [], labels = []
        for (const [name, heading] of [['north', Math.PI], ['east', -Math.PI / 2], ['south', 0], ['west', Math.PI / 2]]) {
            await look(page, { x: 0, y: 8, z: 0, heading, zoom: 70, pitch: 0.45, wait: 4000 })
            const f = join(out, `site-${seed}-${name}.png`)
            await page.screenshot({ path: f })
            files.push(f)
            labels.push(`${seed} from the ${name}`)
        }
        tile(files, labels, 2, `site-${seed}.jpg`)
        await page.close()
    }
}

// ---- the blueprint -------------------------------------------------------------------
if (args.blueprint) {
    const seed = String(args.seed || SEED)
    const page = await openWorld(seed)
    const gen = createGenerator(1, seed, 192)
    const castle = buildCastle({ groundAt: (x, z) => gen.surfaceY(x, z) })
    console.log(`blueprint: ${castle.cells.length} blocks, ${castle.towers.length} tower spots`, castle.counts)
    await page.evaluate(({ cells, towers }) => {
        const g = window.game
        const put = (x, y, z, b) => g.sync.submit({ t: 'block', x, y, z, b })
        for (const [x, y, z, b] of cells) put(x, y, z, b)
        for (const t of towers) put(t.x, t.y, t.z, t.block)
    }, castle)
    await page.waitForTimeout(4000)
    const files = [], labels = []
    const v = castle.views
    for (const [name, view] of Object.entries(v)) {
        await look(page, { ...view, wait: 3500 })
        const f = join(out, `blueprint-${name}.png`)
        await page.screenshot({ path: f })
        files.push(f)
        labels.push(`blueprint ${name}`)
    }
    tile(files, labels, 2, 'blueprint.jpg')
    // the photo next to the matching view, for choosing (never in the video: it isn't ours)
    const ref = join(ROOT, 'ref', 'castle.jpg')
    if (existsSync(ref)) {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', ref, '-i', files[0],
            '-filter_complex', '[0:v]scale=-2:720[a];[1:v]scale=-2:720[b];[a][b]hstack=inputs=2', '-q:v', '3', join(out, 'compare.jpg')])
        console.log('compare.jpg: the photo and the blueprint from its viewpoint')
    }
    await page.close()
}

await browser.close()
server.close()
console.log(`output: ${out}`)
